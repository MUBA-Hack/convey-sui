import { z } from "zod";
import {
  PORTFOLIO_MAX_DATE_MS,
  PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH,
  ProtectionPositionSchema,
  PositionStatusSchema,
  buildBaseScanTransactionUrl,
  classifyPositionStatus,
  type PositionStatus,
  type ProtectionPosition,
} from "./portfolio";

// Re-export the shared decimal-length bound under a brief-owned name so callers
// see one consistent limit. The single policy owner is portfolio.ts.
export {
  PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH as PORTFOLIO_BRIEF_MAX_DECIMAL_LENGTH,
} from "./portfolio";

// Approach band: a position is flagged for review when the observed price is
// within this many basis points above the strike floor. 500 bps = 5%.
export const REVIEW_APPROACH_BASIS_POINTS = 500n;
const BPS_SCALE = 10000n;

// Deterministic freshness bounds for market snapshots. Defaults are safe and
// overridable per call; malformed overrides fall back to these constants.
export const MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT = 5 * 60 * 1000;
export const MARKET_SNAPSHOT_FUTURE_SKEW_MS_DEFAULT = 30 * 1000;

// NASA bounds for brief inputs. The positions array cap rejects huge inputs in
// O(1) before any traversal; the reasons cap is enforced by the output schema.
export const PORTFOLIO_BRIEF_MAX_POSITIONS = 64;
export const PORTFOLIO_BRIEF_MAX_REASONS = 4;

export type PositionBriefAction = "hold" | "review" | "expired" | "unavailable";

// Literal reason-code union. Every emitted reason is one of these exact codes;
// the schema rejects any other string so a malformed internal state can never
// leak a freeform reason.
export const PositionBriefReasonSchema = z.enum([
  "position_expired",
  "position_expiring",
  "price_at_or_below_floor",
  "price_approaching_floor",
  "within_protection_range",
  "market_snapshot_invalid",
  "market_snapshot_unavailable",
  "market_snapshot_stale",
  "market_snapshot_future",
]);
export type PositionBriefReason = z.infer<typeof PositionBriefReasonSchema>;

const UNAVAILABLE_REASONS = new Set<PositionBriefReason>([
  "market_snapshot_invalid",
  "market_snapshot_unavailable",
  "market_snapshot_stale",
  "market_snapshot_future",
]);
const REVIEW_REASONS = new Set<PositionBriefReason>([
  "price_at_or_below_floor",
  "price_approaching_floor",
  "position_expiring",
]);

export interface PositionBriefObserved {
  readonly asset: "ETH" | "BTC";
  readonly status: PositionStatus;
  readonly strikeFloor8d: string;
  readonly expirySeconds: string;
  readonly expiryIso: string;
  readonly price8d: string | null;
  readonly observedAt: string | null;
}

export interface PositionBrief {
  readonly positionId: string;
  readonly action: PositionBriefAction;
  readonly reasons: readonly PositionBriefReason[];
  readonly observed: PositionBriefObserved;
}

export interface ProtectionPositionBriefBook {
  readonly briefs: readonly PositionBrief[];
}

const ActionSchema = z.enum(["hold", "review", "expired", "unavailable"]);

// Observed schema reuses the authoritative position field policies (asset,
// strike, expiry, status) from ProtectionPositionSchema/PositionStatusSchema
// instead of redefining them. price8d and observedAt are market-snapshot
// fields owned here.
const PositionBriefObservedSchema = z.strictObject({
  asset: ProtectionPositionSchema.shape.asset,
  status: PositionStatusSchema,
  strikeFloor8d: ProtectionPositionSchema.shape.strikeFloor8d,
  expirySeconds: ProtectionPositionSchema.shape.expirySeconds,
  expiryIso: ProtectionPositionSchema.shape.expiryIso,
  price8d: z.string().regex(/^(?:0|[1-9]\d*)$/u).nullable(),
  observedAt: z.iso.datetime().nullable(),
});

// Semantically exact brief schema: a discriminated/refined invariant between
// action, status, reasons, and observed values. The builder parses every
// emitted brief through this schema, so an impossible combination can never
// leak. Invariants:
//   - expired: status expired, price/observedAt null, reasons [position_expired]
//   - unavailable: one market_snapshot_* reason, price null, status not expired,
//     observedAt null iff reason is market_snapshot_invalid (invalid snapshot
//     carries no usable timestamp; stale/future/unavailable carry the observedAt
//     of a parsed-but-unfresh/priceless snapshot)
//   - hold: reasons [within_protection_range], price+observedAt present,
//     status active (not expiring, not expired)
//   - review: nonempty bounded price/expiring reasons, price+observedAt present,
//     not expired, reasons unique, price_at_or_below_floor and
//     price_approaching_floor mutually exclusive, position_expiring iff
//     status is expiring (bidirectional coupling).
export const PositionBriefSchema = z
  .strictObject({
    positionId: z.string().min(1),
    action: ActionSchema,
    reasons: z.array(PositionBriefReasonSchema).min(1).max(PORTFOLIO_BRIEF_MAX_REASONS),
    observed: PositionBriefObservedSchema,
  })
  .superRefine((brief, ctx) => {
    const { action, reasons, observed } = brief;

    // Reasons uniqueness: no duplicate reason code can ever appear. The builder
    // pushes each reason at most once, so a duplicate is an impossible state.
    if (new Set(reasons).size !== reasons.length) {
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "reasons must be unique" });
    }

    if (action === "expired") {
      if (observed.status !== "expired") {
        ctx.addIssue({ code: "custom", path: ["observed", "status"], message: "expired brief requires expired status" });
      }
      if (observed.price8d !== null) {
        ctx.addIssue({ code: "custom", path: ["observed", "price8d"], message: "expired brief cannot carry a price" });
      }
      if (observed.observedAt !== null) {
        ctx.addIssue({ code: "custom", path: ["observed", "observedAt"], message: "expired brief cannot carry an observedAt" });
      }
      if (reasons.length !== 1 || reasons[0] !== "position_expired") {
        ctx.addIssue({ code: "custom", path: ["reasons"], message: "expired brief requires exactly [position_expired]" });
      }
      return;
    }
    if (action === "unavailable") {
      if (observed.price8d !== null) {
        ctx.addIssue({ code: "custom", path: ["observed", "price8d"], message: "unavailable brief cannot carry a price" });
      }
      if (observed.status === "expired") {
        ctx.addIssue({ code: "custom", path: ["observed", "status"], message: "unavailable brief cannot be expired" });
      }
      if (reasons.length !== 1 || !UNAVAILABLE_REASONS.has(reasons[0] as PositionBriefReason)) {
        ctx.addIssue({ code: "custom", path: ["reasons"], message: "unavailable brief requires exactly one market_snapshot_* reason" });
      }
      // Reason-specific observedAt semantics matching builder-emittable states:
      // market_snapshot_invalid means no usable snapshot timestamp (null);
      // stale/future/unavailable carry the observedAt of a parsed snapshot.
      const unavailableReason = reasons[0] as PositionBriefReason;
      if (unavailableReason === "market_snapshot_invalid") {
        if (observed.observedAt !== null) {
          ctx.addIssue({ code: "custom", path: ["observed", "observedAt"], message: "market_snapshot_invalid requires null observedAt" });
        }
      } else if (observed.observedAt === null) {
        ctx.addIssue({ code: "custom", path: ["observed", "observedAt"], message: "stale/future/unavailable snapshot requires non-null observedAt" });
      }
      return;
    }
    if (action === "hold") {
      if (observed.price8d === null) {
        ctx.addIssue({ code: "custom", path: ["observed", "price8d"], message: "hold brief requires a price" });
      }
      if (observed.observedAt === null) {
        ctx.addIssue({ code: "custom", path: ["observed", "observedAt"], message: "hold brief requires an observedAt" });
      }
      // The builder emits hold only for active positions: an expiring status
      // always pushes position_expiring and routes to review, never hold.
      if (observed.status !== "active") {
        ctx.addIssue({ code: "custom", path: ["observed", "status"], message: "hold brief requires active status" });
      }
      if (reasons.length !== 1 || reasons[0] !== "within_protection_range") {
        ctx.addIssue({ code: "custom", path: ["reasons"], message: "hold brief requires exactly [within_protection_range]" });
      }
      return;
    }
    // action === "review"
    if (observed.price8d === null) {
      ctx.addIssue({ code: "custom", path: ["observed", "price8d"], message: "review brief requires a price" });
    }
    if (observed.observedAt === null) {
      ctx.addIssue({ code: "custom", path: ["observed", "observedAt"], message: "review brief requires an observedAt" });
    }
    if (observed.status === "expired") {
      ctx.addIssue({ code: "custom", path: ["observed", "status"], message: "review brief cannot be expired" });
    }
    if (reasons.length === 0) {
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "review brief requires nonempty reasons" });
    }
    let hasBelowFloor = false;
    let hasApproaching = false;
    for (const reason of reasons) {
      if (reason === "price_at_or_below_floor") hasBelowFloor = true;
      else if (reason === "price_approaching_floor") hasApproaching = true;
      if (!REVIEW_REASONS.has(reason as PositionBriefReason)) {
        ctx.addIssue({ code: "custom", path: ["reasons"], message: "review brief allows only price/expiring reasons" });
        break;
      }
    }
    // The builder pushes at most one of the two price reasons (below-floor is
    // checked first and short-circuits the approaching-band branch), so both
    // can never coexist in a builder-emittable state.
    if (hasBelowFloor && hasApproaching) {
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "price_at_or_below_floor and price_approaching_floor are mutually exclusive" });
    }
    // position_expiring is pushed only when classifyPositionStatus returns
    // "expiring"; an active or expired status carrying it is impossible.
    if (reasons.includes("position_expiring") && observed.status !== "expiring") {
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "position_expiring requires expiring status" });
    }
    // Bidirectional coupling: the builder always pushes position_expiring when
    // status is expiring, so a review brief with expiring status but no
    // position_expiring reason is an impossible builder state.
    if (observed.status === "expiring" && !reasons.includes("position_expiring")) {
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "expiring status requires position_expiring reason in review" });
    }
  });

// Strict exact-key market snapshot. No extra keys permitted. Prices are
// unsigned integer strings in 8-decimal scaled units (matching plan strikes8d).
// observedAt is a strict canonical ISO datetime; never validated via loose
// Date.parse.
export const MarketSnapshotSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  ethPrice8d: z.string().regex(/^(?:0|[1-9]\d*)$/u).optional(),
  btcPrice8d: z.string().regex(/^(?:0|[1-9]\d*)$/u).optional(),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

export interface BuildProtectionPositionBriefInput {
  readonly positions: readonly unknown[];
  readonly snapshot: unknown;
  readonly nowMs: number;
  readonly maxAgeMs?: number;
  readonly futureSkewMs?: number;
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function resolveBound(value: unknown, fallback: number): bigint {
  return isSafeNonNegativeInt(value) ? BigInt(value) : BigInt(fallback);
}

// Parse an ISO datetime to a BigInt ms value. Returns null for unparseable,
// non-finite, negative, or non-safe-integer ms.
function isoToMsBig(iso: string): bigint | null {
  if (typeof iso !== "string") return null;
  let ms: number;
  try {
    ms = new Date(iso).getTime();
  } catch {
    return null;
  }
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms > Number.MAX_SAFE_INTEGER) return null;
  return BigInt(ms);
}

// Bounded preflight: reject oversized strings/arrays/objects in O(1) per
// length check so a 10MB decimal string or huge array fails closed before Zod
// or BigInt traversal. The walk is bounded so a nested forged position cannot
// cause proportional work.
const PREFLIGHT_MAX_ITERATIONS = 256;
const PREFLIGHT_MAX_OBJECT_KEYS = 64;

// Snapshot preflight: the market snapshot is a flat object with at most three
// string fields (observedAt, ethPrice8d, btcPrice8d). A 10MB decimal string
// would otherwise reach the Zod regex and BigInt parse and do proportional
// work; this O(1) length+shape gate fails closed before any schema traversal.
// The key cap is small and fixed because the snapshot is a known flat shape,
// not an arbitrary nested receipt.
const SNAPSHOT_MAX_KEYS = 4;
const SNAPSHOT_MAX_STRING_LENGTH = PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH;

function preflightSnapshotShape(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > SNAPSHOT_MAX_KEYS) return false;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") {
      if (value.length > SNAPSHOT_MAX_STRING_LENGTH) return false;
    } else if (value !== null && typeof value !== "undefined") {
      // The snapshot is flat: only string fields are valid. Any non-string,
      // non-null, non-undefined value is rejected here so a nested object or
      // array cannot reach the schema walk.
      return false;
    }
  }
  return true;
}

function preflightPositionShape(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const stack: unknown[] = [raw];
  let iterations = 0;
  while (stack.length > 0) {
    if (++iterations > PREFLIGHT_MAX_ITERATIONS) return false;
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      if (node.length > PORTFOLIO_BRIEF_MAX_POSITIONS) return false;
      for (const item of node) stack.push(item);
      continue;
    }
    const keys = Object.keys(node as Record<string, unknown>);
    if (keys.length > PREFLIGHT_MAX_OBJECT_KEYS) return false;
    for (const key of keys) {
      const value = (node as Record<string, unknown>)[key];
      if (typeof value === "string") {
        if (value.length > PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH) return false;
      } else if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }
  return true;
}

function priceForAsset(snapshot: MarketSnapshot, asset: "ETH" | "BTC"): string | null {
  return asset === "ETH" ? snapshot.ethPrice8d ?? null : snapshot.btcPrice8d ?? null;
}

// Recompute the canonical expiry ISO from expirySeconds. Returns null if the
// expiry ms is not representable as a Date or does not round-trip; the caller
// skips such a position so a forged expiryIso can never be trusted.
function recomputeExpiryIso(expirySeconds: string): { iso: string; ms: bigint } | null {
  const expiryMs = BigInt(expirySeconds) * 1000n;
  if (expiryMs < 0n || expiryMs > PORTFOLIO_MAX_DATE_MS) return null;
  const expiryMsNumber = Number(expiryMs);
  let iso: string;
  try {
    iso = new Date(expiryMsNumber).toISOString();
  } catch {
    return null;
  }
  if (new Date(iso).getTime() !== expiryMsNumber) return null;
  return { iso, ms: expiryMs };
}

function buildObserved(
  position: ProtectionPosition,
  status: PositionStatus,
  expiryIso: string,
  price8d: string | null,
  observedAt: string | null,
): PositionBriefObserved {
  return {
    asset: position.asset,
    status,
    strikeFloor8d: position.strikeFloor8d,
    expirySeconds: position.expirySeconds,
    expiryIso,
    price8d,
    observedAt,
  };
}

function expiredBrief(position: ProtectionPosition, status: PositionStatus, expiryIso: string): PositionBrief {
  return {
    positionId: position.id,
    action: "expired",
    reasons: ["position_expired"],
    observed: buildObserved(position, status, expiryIso, null, null),
  };
}

function unavailableBrief(
  position: ProtectionPosition,
  status: PositionStatus,
  expiryIso: string,
  reason: PositionBriefReason,
  observedAt: string | null,
): PositionBrief {
  return {
    positionId: position.id,
    action: "unavailable",
    reasons: [reason],
    observed: buildObserved(position, status, expiryIso, null, observedAt),
  };
}

function pricedBrief(
  position: ProtectionPosition,
  status: PositionStatus,
  expiryIso: string,
  snapshot: MarketSnapshot,
  price8d: string,
): PositionBrief {
  const price = BigInt(price8d);
  const floor = BigInt(position.strikeFloor8d);
  const reasons: PositionBriefReason[] = [];
  if (price <= floor) {
    reasons.push("price_at_or_below_floor");
  } else if (price * BPS_SCALE <= floor * (BPS_SCALE + REVIEW_APPROACH_BASIS_POINTS)) {
    reasons.push("price_approaching_floor");
  }
  if (status === "expiring") {
    reasons.push("position_expiring");
  }
  const action: PositionBriefAction = reasons.length > 0 ? "review" : "hold";
  return {
    positionId: position.id,
    action,
    reasons: reasons.length > 0 ? reasons : ["within_protection_range"],
    observed: buildObserved(position, status, expiryIso, price8d, snapshot.observedAt),
  };
}

function deepFreezeBrief(brief: PositionBrief): PositionBrief {
  return Object.freeze({
    ...brief,
    reasons: Object.freeze([...brief.reasons]),
    observed: Object.freeze({ ...brief.observed }),
  });
}

function emptyBook(): ProtectionPositionBriefBook {
  return Object.freeze({ briefs: Object.freeze([]) });
}

// Pure, bounded brief: no fetch, env, storage, React, or new dependencies.
// Output is limited to hold/review/expired/unavailable per position with exact
// reason codes and observed inputs. No autonomous trade, signer, approval,
// return/profit claim, invented news, or generic freeform advice is produced.
//
// Positions are parsed through the authoritative ProtectionPositionSchema
// (single owner of position shape/status/integer/hash/address policy). The
// supplied status is NEVER trusted: active/expiring/expired is recomputed from
// expirySeconds + nowMs using the shared classifier. expirySeconds<->expiryIso,
// chainDigest<->explorer link, and id<->receiptRef are strictly cross-checked;
// any mismatch skips the position. Expiry evidence is independent of
// market-snapshot freshness: an expired position stays expired even when the
// snapshot is stale, too future, or missing. Snapshot freshness is applied
// only to non-expired positions through one per-position path. All freshness
// arithmetic uses BigInt so near-MAX_SAFE nowMs/bounds cannot overflow or lose
// precision. nowMs must be a safe non-negative integer; otherwise no brief can
// be recomputed and the book is empty. Malformed positions, snapshots, or
// requests never throw. Every emitted brief is parsed through the semantically
// exact PositionBriefSchema and frozen before return.
export function buildProtectionPositionBrief(
  input: BuildProtectionPositionBriefInput,
): ProtectionPositionBriefBook {
  if (input === null || typeof input !== "object") return emptyBook();
  if (!Array.isArray(input.positions)) return emptyBook();
  if (input.positions.length > PORTFOLIO_BRIEF_MAX_POSITIONS) return emptyBook();
  if (!isSafeNonNegativeInt(input.nowMs)) return emptyBook();

  const nowMs = BigInt(input.nowMs);
  const maxAge = resolveBound(input.maxAgeMs, MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT);
  const futureSkew = resolveBound(input.futureSkewMs, MARKET_SNAPSHOT_FUTURE_SKEW_MS_DEFAULT);

  const parsedSnapshot = preflightSnapshotShape(input.snapshot)
    ? MarketSnapshotSchema.safeParse(input.snapshot)
    : { success: false as const };
  const snapshot: MarketSnapshot | null = parsedSnapshot.success ? parsedSnapshot.data : null;
  const observedAtIso = snapshot?.observedAt ?? null;
  const observedAtMs = snapshot === null ? null : isoToMsBig(snapshot.observedAt);
  const snapshotFreshness: "fresh" | "stale" | "future" | "invalid" =
    snapshot === null || observedAtMs === null
      ? "invalid"
      : observedAtMs < nowMs - maxAge
        ? "stale"
        : observedAtMs > nowMs + futureSkew
          ? "future"
          : "fresh";

  const briefs: PositionBrief[] = [];
  for (const raw of input.positions) {
    if (!preflightPositionShape(raw)) continue;
    const parsed = ProtectionPositionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const position = parsed.data;

    // Strict cross-checks: recompute expiryIso from expirySeconds and require
    // chainLink to match chainDigest and id to match receiptRef. The supplied
    // status is ignored; status is recomputed from expiry + nowMs below.
    const expiry = recomputeExpiryIso(position.expirySeconds);
    if (expiry === null || expiry.iso !== position.expiryIso) continue;
    if (position.chainLink !== buildBaseScanTransactionUrl(position.chainDigest)) continue;
    if (position.id !== position.receiptRef) continue;

    const status = classifyPositionStatus(expiry.ms, nowMs);

    // Expiry evidence is independent of snapshot freshness: an expired position
    // stays expired regardless of a stale, future, or missing snapshot.
    if (status === "expired") {
      briefs.push(expiredBrief(position, status, expiry.iso));
      continue;
    }

    // One per-position path for non-expired positions: apply snapshot freshness.
    // market_snapshot_invalid means no usable snapshot timestamp: pass null
    // observedAt so the emitted brief matches the schema's reason-specific
    // observedAt semantics (invalid <=> null). This also covers the edge case
    // where the snapshot parses via Zod but observedAt ms overflows MAX_SAFE,
    // leaving observedAtMs null with a non-null observedAtIso string.
    if (snapshotFreshness === "invalid") {
      briefs.push(unavailableBrief(position, status, expiry.iso, "market_snapshot_invalid", null));
      continue;
    }
    if (snapshotFreshness === "stale") {
      briefs.push(unavailableBrief(position, status, expiry.iso, "market_snapshot_stale", observedAtIso));
      continue;
    }
    if (snapshotFreshness === "future") {
      briefs.push(unavailableBrief(position, status, expiry.iso, "market_snapshot_future", observedAtIso));
      continue;
    }

    const price8d = priceForAsset(snapshot as MarketSnapshot, position.asset);
    if (price8d === null) {
      briefs.push(unavailableBrief(position, status, expiry.iso, "market_snapshot_unavailable", observedAtIso));
      continue;
    }

    briefs.push(pricedBrief(position, status, expiry.iso, snapshot as MarketSnapshot, price8d));
  }

  // Parse every emitted brief through the semantically exact output schema so a
  // malformed or impossible internal state can never leak a structurally
  // invalid brief.
  const verified = briefs.filter((brief) => PositionBriefSchema.safeParse(brief).success);
  return Object.freeze({
    briefs: Object.freeze(verified.map(deepFreezeBrief)),
  });
}
