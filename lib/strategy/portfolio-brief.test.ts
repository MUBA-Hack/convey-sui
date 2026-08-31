import { describe, expect, it } from "vitest";
import { __buildProtectionPositionBookForTest } from "./portfolio.server";
import {
  PORTFOLIO_BRIEF_MAX_POSITIONS,
  PORTFOLIO_BRIEF_MAX_REASONS,
  PORTFOLIO_BRIEF_MAX_DECIMAL_LENGTH,
  buildProtectionPositionBrief,
  MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT,
  MARKET_SNAPSHOT_FUTURE_SKEW_MS_DEFAULT,
  PositionBriefSchema,
  PositionBriefReasonSchema,
  REVIEW_APPROACH_BASIS_POINTS,
} from "./portfolio-brief";
import {
  EXPIRY_MS,
  FLOOR,
  NOW_MS,
  WINDOW_MS,
  entryAt,
  first,
  nth,
  type ReceiptOverrides,
} from "@/tests/strategy/portfolio-fixtures";

// Build a single position via the test seam so brief tests do not wire the Base
// verifier. The position is constructed at NOW_MS (well before expiry) unless
// an override is supplied.
function position(overrides: ReceiptOverrides = {}, nowMs: number = NOW_MS) {
  return first(
    __buildProtectionPositionBookForTest({
      entries: [entryAt(nowMs, { strikes8d: [FLOOR], ...overrides })],
      nowMs,
    }).positions,
  );
}

describe("buildProtectionPositionBrief - nowMs and snapshot freshness", () => {
  it("returns empty briefs when nowMs is invalid (cannot recompute expiry status)", () => {
    const pos = position();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NaN,
    });
    expect(book.briefs).toHaveLength(0);
  });

  it("returns unavailable when the snapshot is stale beyond maxAgeMs (exact cutoff +/-1)", () => {
    const pos = position();
    const observedAt = NOW_MS - MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT;
    const fresh = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    const oneMsStale = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt - 1).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(fresh.briefs).action).toBe("hold");
    expect(first(oneMsStale.briefs).action).toBe("unavailable");
    expect(first(oneMsStale.briefs).reasons).toEqual(["market_snapshot_stale"]);
  });

  it("returns unavailable when the snapshot is too far in the future (exact cutoff +/-1)", () => {
    const pos = position();
    const observedAt = NOW_MS + MARKET_SNAPSHOT_FUTURE_SKEW_MS_DEFAULT;
    const ok = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    const oneMsFuture = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt + 1).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(ok.briefs).action).toBe("hold");
    expect(first(oneMsFuture.briefs).action).toBe("unavailable");
    expect(first(oneMsFuture.briefs).reasons).toEqual(["market_snapshot_future"]);
  });

  it("honors overridden maxAgeMs and futureSkewMs bounds", () => {
    const pos = position();
    const observedAt = NOW_MS - 400_000;
    const staleDefault = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    const freshWithWideMaxAge = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
      maxAgeMs: 600_000,
    });
    expect(first(staleDefault.briefs).action).toBe("unavailable");
    expect(first(staleDefault.briefs).reasons).toEqual(["market_snapshot_stale"]);
    expect(first(freshWithWideMaxAge.briefs).action).toBe("hold");
  });

  it("rejects malformed maxAgeMs/futureSkewMs by falling back to safe defaults", () => {
    const pos = position();
    const observedAt = NOW_MS - MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT - 1;
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(observedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
      maxAgeMs: NaN,
      futureSkewMs: -1,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_stale"]);
  });
});

describe("buildProtectionPositionBrief - strict schemas and immutability", () => {
  it("skips malformed positions without throwing", () => {
    const valid = position();
    const book = buildProtectionPositionBrief({
      positions: [valid, { id: "x" }, null, "nope", 42, { ...valid, strikeFloor8d: 123 }],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(1);
    expect(first(book.briefs).positionId).toBe(valid.id);
  });

  it("returns empty briefs when positions input is not an array, without throwing", () => {
    const book = buildProtectionPositionBrief({
      positions: "not-an-array",
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    } as unknown as { positions: readonly unknown[]; snapshot: unknown; nowMs: number });
    expect(book.briefs).toHaveLength(0);
  });

  it("returns unavailable when the snapshot is malformed (non-ISO observedAt)", () => {
    const pos = position();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: "not-a-date", ethPrice8d: "100" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });

  it("returns a deeply frozen brief graph (briefs, observed, reasons)", () => {
    const pos = position();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "205000000000" },
      nowMs: NOW_MS,
    });
    expect(Object.isFrozen(book)).toBe(true);
    expect(Object.isFrozen(book.briefs)).toBe(true);
    const brief = first(book.briefs);
    expect(Object.isFrozen(brief)).toBe(true);
    expect(Object.isFrozen(brief.reasons)).toBe(true);
    expect(Object.isFrozen(brief.observed)).toBe(true);
  });

  it("does not mutate the input positions array", () => {
    const pos = position();
    const input = [pos];
    const snapshot = [...input];
    buildProtectionPositionBrief({
      positions: input,
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(input).toEqual(snapshot);
  });
});

describe("buildProtectionPositionBrief - actions and reasons", () => {
  it("returns expired action for an expired position regardless of snapshot", () => {
    const pos = position({}, Number(EXPIRY_MS));
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: Number(EXPIRY_MS),
    });
    expect(first(book.briefs).action).toBe("expired");
    expect(first(book.briefs).reasons).toEqual(["position_expired"]);
    expect(first(book.briefs).observed.status).toBe("expired");
    expect(first(book.briefs).observed.price8d).toBeNull();
  });

  it("returns unavailable when the asset price is missing from the snapshot", () => {
    const pos = position();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), btcPrice8d: "300000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_unavailable"]);
    expect(first(book.briefs).observed.price8d).toBeNull();
  });

  it("returns review with price_at_or_below_floor when price is at or below the floor", () => {
    const atFloor = position();
    const below = position({ txHash: "0x" + "bb".repeat(32), asset: "BTC" });
    const book = buildProtectionPositionBrief({
      positions: [atFloor, below],
      snapshot: {
        observedAt: new Date(NOW_MS).toISOString(),
        ethPrice8d: "200000000000",
        btcPrice8d: "190000000000",
      },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("review");
    expect(first(book.briefs).reasons).toEqual(["price_at_or_below_floor"]);
    expect(nth(book.briefs, 1).action).toBe("review");
    expect(nth(book.briefs, 1).reasons).toEqual(["price_at_or_below_floor"]);
  });

  it("returns review with price_approaching_floor inside the approach band", () => {
    const pos = position();
    const boundary = (BigInt(FLOOR) * (10000n + REVIEW_APPROACH_BASIS_POINTS)) / 10000n;
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: boundary.toString() },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("review");
    expect(first(book.briefs).reasons).toEqual(["price_approaching_floor"]);
  });

  it("returns hold when price is safely above the floor and not expiring", () => {
    const pos = position();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("hold");
    expect(first(book.briefs).reasons).toEqual(["within_protection_range"]);
  });

  it("returns review with position_expiring for an expiring position even above the floor", () => {
    const expiringNow = Number(EXPIRY_MS - WINDOW_MS + 1n);
    const pos = position({}, expiringNow);
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(expiringNow).toISOString(), ethPrice8d: "250000000000" },
      nowMs: expiringNow,
    });
    expect(first(book.briefs).action).toBe("review");
    expect(first(book.briefs).reasons).toEqual(["position_expiring"]);
  });

  it("combines position_expiring and price_approaching_floor reasons", () => {
    const expiringNow = Number(EXPIRY_MS - WINDOW_MS + 1n);
    const pos = position({}, expiringNow);
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(expiringNow).toISOString(), ethPrice8d: "205000000000" },
      nowMs: expiringNow,
    });
    expect(first(book.briefs).action).toBe("review");
    expect(first(book.briefs).reasons).toEqual(["price_approaching_floor", "position_expiring"]);
  });

  it("uses the singular strikeFloor8d directly as the floor", () => {
    const pos = position();
    expect(pos.strikeFloor8d).toBe(FLOOR);
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "200000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("review");
    expect(first(book.briefs).reasons).toEqual(["price_at_or_below_floor"]);
  });

  it("preserves input position order in the brief output", () => {
    const a = position({ txHash: "0x" + "11".repeat(32), expirySeconds: "1800000500" });
    const b = position({ txHash: "0x" + "22".repeat(32), expirySeconds: "1800001000" });
    const book = buildProtectionPositionBrief({
      positions: [a, b],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs.map((p) => p.positionId)).toEqual([a.id, b.id]);
  });

  it("cites exact observed inputs on each brief", () => {
    const pos = position();
    const iso = new Date(NOW_MS).toISOString();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: iso, ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).observed).toStrictEqual({
      asset: "ETH",
      status: "active",
      strikeFloor8d: FLOOR,
      expirySeconds: "1800000000",
      expiryIso: new Date(1_800_000_000_000).toISOString(),
      price8d: "250000000000",
      observedAt: iso,
    });
  });
});

describe("buildProtectionPositionBrief - never trust supplied status, cross-check fields", () => {
  it("recomputes status from expiry + brief nowMs, ignoring a stale supplied active status", () => {
    const activePos = position();
    expect(activePos.status).toBe("active");
    const book = buildProtectionPositionBrief({
      positions: [activePos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: Number(EXPIRY_MS),
    });
    expect(first(book.briefs).action).toBe("expired");
    expect(first(book.briefs).observed.status).toBe("expired");
    expect(first(book.briefs).reasons).toEqual(["position_expired"]);
  });

  it("recomputes status from expiry + brief nowMs, ignoring a stale supplied expired status", () => {
    const expiredPos = position({}, Number(EXPIRY_MS));
    expect(expiredPos.status).toBe("expired");
    const book = buildProtectionPositionBrief({
      positions: [expiredPos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("hold");
    expect(first(book.briefs).observed.status).toBe("active");
  });

  it("skips positions whose expiryIso does not match expirySeconds", () => {
    const pos = position();
    const forged = { ...pos, expiryIso: "2030-01-01T00:00:00.000Z" };
    const book = buildProtectionPositionBrief({
      positions: [forged],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(0);
  });

  it("skips positions whose chainLink does not match chainDigest", () => {
    const pos = position();
    const forged = { ...pos, chainLink: `https://basescan.org/tx/${"0x" + "99".repeat(32)}` };
    const book = buildProtectionPositionBrief({
      positions: [forged],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(0);
  });

  it("skips positions whose id does not match receiptRef", () => {
    const pos = position();
    const forged = { ...pos, receiptRef: "mismatched-reference" };
    const book = buildProtectionPositionBrief({
      positions: [forged],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(0);
  });
});

describe("buildProtectionPositionBrief - expiry evidence independent of snapshot freshness", () => {
  it("keeps an already-expired position expired when the snapshot is stale", () => {
    const expiredPos = position({}, Number(EXPIRY_MS));
    const staleObservedAt = NOW_MS - MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT - 1;
    const book = buildProtectionPositionBrief({
      positions: [expiredPos],
      snapshot: { observedAt: new Date(staleObservedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: Number(EXPIRY_MS),
    });
    expect(first(book.briefs).action).toBe("expired");
    expect(first(book.briefs).reasons).toEqual(["position_expired"]);
  });

  it("keeps an already-expired position expired when the snapshot is too far future", () => {
    const expiredPos = position({}, Number(EXPIRY_MS));
    const futureObservedAt = Number(EXPIRY_MS) + MARKET_SNAPSHOT_FUTURE_SKEW_MS_DEFAULT + 1;
    const book = buildProtectionPositionBrief({
      positions: [expiredPos],
      snapshot: { observedAt: new Date(futureObservedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: Number(EXPIRY_MS),
    });
    expect(first(book.briefs).action).toBe("expired");
    expect(first(book.briefs).reasons).toEqual(["position_expired"]);
  });

  it("applies snapshot freshness only to non-expired positions (one per-position path)", () => {
    const expiredPos = position({}, Number(EXPIRY_MS));
    const activePos = position({ txHash: "0x" + "11".repeat(32), expirySeconds: "2800000000" });
    const staleObservedAt = NOW_MS - MARKET_SNAPSHOT_MAX_AGE_MS_DEFAULT - 1;
    const book = buildProtectionPositionBrief({
      positions: [expiredPos, activePos],
      snapshot: { observedAt: new Date(staleObservedAt).toISOString(), ethPrice8d: "250000000000" },
      nowMs: Number(EXPIRY_MS),
    });
    expect(nth(book.briefs, 0).action).toBe("expired");
    expect(nth(book.briefs, 0).reasons).toEqual(["position_expired"]);
    expect(nth(book.briefs, 1).action).toBe("unavailable");
    expect(nth(book.briefs, 1).reasons).toEqual(["market_snapshot_stale"]);
  });
});

// ===========================================================================
// Semantic-invariant schema: PositionBriefSchema is a discriminated/refined
// invariant between action/status/reasons/observed. These tests prove the
// schema itself rejects impossible combinations, independent of the builder.
// ===========================================================================

const VALID_OBSERVED_ACTIVE = {
  asset: "ETH",
  status: "active",
  strikeFloor8d: "200000000000",
  expirySeconds: "1800000000",
  expiryIso: new Date(1_800_000_000_000).toISOString(),
  price8d: "250000000000",
  observedAt: new Date(NOW_MS).toISOString(),
};
const VALID_OBSERVED_EXPIRED = {
  ...VALID_OBSERVED_ACTIVE,
  status: "expired",
  price8d: null,
  observedAt: null,
};

describe("PositionBriefSchema - semantic invariant between action/status/reasons/observed", () => {
  it("accepts a valid hold brief with within_protection_range and a priced active observation", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(true);
  });

  it("accepts a valid review brief with bounded price/expiring reasons and a priced non-expired observation", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_approaching_floor", "position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(true);
  });

  it("accepts a valid expired brief with position_expired, expired status, and null price/observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "expired",
        reasons: ["position_expired"],
        observed: VALID_OBSERVED_EXPIRED,
      }).success,
    ).toBe(true);
  });

  it("accepts a valid unavailable brief with one market_snapshot_* reason and null price", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(true);
  });

  it("rejects an expired brief that carries a price (expired cannot hold/review)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "expired",
        reasons: ["position_expired"],
        observed: { ...VALID_OBSERVED_EXPIRED, price8d: "250000000000" },
      }).success,
    ).toBe(false);
  });

  it("rejects an expired brief whose observed status is not expired", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "expired",
        reasons: ["position_expired"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("rejects an expired brief with reasons other than [position_expired]", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "expired",
        reasons: ["position_expired", "position_expiring"],
        observed: VALID_OBSERVED_EXPIRED,
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief that carries a price (unavailable cannot masquerade as hold)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with a non-market_snapshot reason", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["within_protection_range"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with more than one reason", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale", "market_snapshot_invalid"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief with empty reasons (reasons must be nonempty)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: [],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief with reasons other than [within_protection_range]", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["price_at_or_below_floor"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief whose observed status is expired", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: VALID_OBSERVED_EXPIRED,
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief without a price", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with empty reasons", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: [],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief whose observed status is expired", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor"],
        observed: VALID_OBSERVED_EXPIRED,
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief without a price", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with a non-price/expiring reason", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["market_snapshot_stale"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects reasons arrays longer than the bounded max", () => {
    const tooMany = Array.from({ length: PORTFOLIO_BRIEF_MAX_REASONS + 1 }, () => "price_at_or_below_floor");
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: tooMany,
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("exports a reason-code enum that rejects unknown reason codes", () => {
    expect(PositionBriefReasonSchema.safeParse("position_expired").success).toBe(true);
    expect(PositionBriefReasonSchema.safeParse("market_snapshot_stale").success).toBe(true);
    expect(PositionBriefReasonSchema.safeParse("not_a_reason").success).toBe(false);
  });

  it("parses and freezes every brief emitted by the builder", () => {
    const book = buildProtectionPositionBrief({
      positions: [position()],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "205000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs.length).toBeGreaterThan(0);
    for (const brief of book.briefs) {
      expect(PositionBriefSchema.safeParse(brief).success).toBe(true);
      expect(Object.isFrozen(brief)).toBe(true);
      expect(Object.isFrozen(brief.reasons)).toBe(true);
      expect(Object.isFrozen(brief.observed)).toBe(true);
    }
  });

  it("rejects briefs with extra fields via the strict schema", () => {
    const book = buildProtectionPositionBrief({
      positions: [position()],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    const brief = first(book.briefs);
    expect(PositionBriefSchema.safeParse({ ...brief, extra: 1 }).success).toBe(false);
  });
});

describe("PositionBriefSchema - adversarial exactness (builder-emittable states only)", () => {
  it("rejects a review brief with position_expiring when status is not expiring", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "active" },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with position_expiring when status is expired", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["position_expiring"],
        observed: { ...VALID_OBSERVED_EXPIRED, price8d: "250000000000", observedAt: new Date(NOW_MS).toISOString() },
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief with a null observedAt (hold requires non-null observedAt)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: { ...VALID_OBSERVED_ACTIVE, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with a null observedAt (review requires non-null observedAt)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor"],
        observed: { ...VALID_OBSERVED_ACTIVE, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with duplicate reasons (reasons must be unique)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor", "price_at_or_below_floor"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with duplicate position_expiring reasons", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_approaching_floor", "position_expiring", "position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief where price_at_or_below_floor and price_approaching_floor coexist (mutually exclusive)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor", "price_approaching_floor"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief where both price reasons coexist with position_expiring", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor", "price_approaching_floor", "position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("rejects a hold brief with within_protection_range plus any other reason", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range", "price_at_or_below_floor"],
        observed: VALID_OBSERVED_ACTIVE,
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with position_expiring (unavailable allows only market_snapshot_* reasons)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(false);
  });

  it("rejects an expired brief with a non-null observedAt (expired cannot carry observedAt)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "expired",
        reasons: ["position_expired"],
        observed: { ...VALID_OBSERVED_EXPIRED, observedAt: new Date(NOW_MS).toISOString() },
      }).success,
    ).toBe(false);
  });

  it("accepts a review brief with position_expiring only when status is expiring", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(true);
  });

  it("rejects a hold brief with expiring status (builder emits review, never hold, when expiring)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("accepts an unavailable brief with a non-null observedAt (stale/future snapshot carries observedAt)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null },
      }).success,
    ).toBe(true);
  });

  it("accepts an unavailable brief with a null observedAt (invalid snapshot has no observedAt)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_invalid"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: null },
      }).success,
    ).toBe(true);
  });
});

// ===========================================================================
// Critic blockers: schema must reject states the builder cannot emit.
// Bidirectional status/reason coupling and reason-specific observedAt
// semantics. These RED tests fail until the schema is tightened.
// ===========================================================================

describe("PositionBriefSchema - critic blockers (builder-emittable state coupling)", () => {
  it("rejects a hold brief with expiring status (hold is active-only; expiring forces review)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "hold",
        reasons: ["within_protection_range"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with expiring status but no position_expiring reason", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_at_or_below_floor"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("rejects a review brief with expiring status and only price_approaching_floor (no position_expiring)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["price_approaching_floor"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with market_snapshot_invalid and a non-null observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_invalid"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: new Date(NOW_MS).toISOString() },
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with market_snapshot_stale and a null observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with market_snapshot_future and a null observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_future"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("rejects an unavailable brief with market_snapshot_unavailable and a null observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_unavailable"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: null },
      }).success,
    ).toBe(false);
  });

  it("accepts a review brief with expiring status and position_expiring (bidirectional coupling holds)", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "review",
        reasons: ["position_expiring"],
        observed: { ...VALID_OBSERVED_ACTIVE, status: "expiring" },
      }).success,
    ).toBe(true);
  });

  it("accepts an unavailable brief with market_snapshot_stale and a non-null observedAt", () => {
    expect(
      PositionBriefSchema.safeParse({
        positionId: "id",
        action: "unavailable",
        reasons: ["market_snapshot_stale"],
        observed: { ...VALID_OBSERVED_ACTIVE, price8d: null, observedAt: new Date(NOW_MS).toISOString() },
      }).success,
    ).toBe(true);
  });
});

// ===========================================================================
// NASA bounds: preflight caps reject huge position arrays and decimal strings
// without proportional traversal, allocation, or RangeError.
// ===========================================================================

describe("buildProtectionPositionBrief - NASA bounds and no-throw", () => {
  it("exports bounded input limits", () => {
    expect(PORTFOLIO_BRIEF_MAX_POSITIONS).toBeGreaterThan(0);
    expect(PORTFOLIO_BRIEF_MAX_REASONS).toBeGreaterThan(0);
    expect(PORTFOLIO_BRIEF_MAX_DECIMAL_LENGTH).toBeGreaterThan(0);
  });

  it("returns empty briefs without throwing when positions exceed the cap", () => {
    const pos = position();
    const tooMany = Array.from({ length: PORTFOLIO_BRIEF_MAX_POSITIONS + 1 }, () => pos);
    expect(() =>
      buildProtectionPositionBrief({
        positions: tooMany,
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: tooMany,
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(0);
  });

  it("rejects a position with a 10MB decimal string without throwing", () => {
    const pos = position();
    const forged = { ...pos, strikeFloor8d: "9".repeat(10_000_000) };
    expect(() =>
      buildProtectionPositionBrief({
        positions: [forged],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [forged],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(0);
  });

  it("returns empty briefs for malformed input (non-array positions, invalid nowMs) without throwing", () => {
    expect(
      buildProtectionPositionBrief({
        positions: "nope",
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: NOW_MS,
      } as unknown as { positions: readonly unknown[]; snapshot: unknown; nowMs: number }).briefs,
    ).toHaveLength(0);
    expect(
      buildProtectionPositionBrief({
        positions: [],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: NaN,
      }).briefs,
    ).toHaveLength(0);
    expect(
      buildProtectionPositionBrief({
        positions: [],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: -1,
      }).briefs,
    ).toHaveLength(0);
    expect(
      buildProtectionPositionBrief({
        positions: [],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: "250000000000" },
        nowMs: Infinity,
      }).briefs,
    ).toHaveLength(0);
  });
});

describe("buildProtectionPositionBrief - snapshot preflight bounds", () => {
  it("rejects a snapshot with a 10MB ethPrice8d string without throwing (no Zod/BigInt proportional work)", () => {
    const pos = position();
    const huge = "9".repeat(10_000_000);
    expect(() =>
      buildProtectionPositionBrief({
        positions: [pos],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: huge },
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: huge },
      nowMs: NOW_MS,
    });
    expect(book.briefs).toHaveLength(1);
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });

  it("rejects a snapshot with a 10MB btcPrice8d string without throwing", () => {
    const btcPos = position({ asset: "BTC", txHash: "0x" + "bb".repeat(32) });
    const huge = "9".repeat(10_000_000);
    expect(() =>
      buildProtectionPositionBrief({
        positions: [btcPos],
        snapshot: { observedAt: new Date(NOW_MS).toISOString(), btcPrice8d: huge },
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [btcPos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), btcPrice8d: huge },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });

  it("rejects a snapshot with a 10MB observedAt string without throwing", () => {
    const pos = position();
    const huge = "9".repeat(10_000_000);
    expect(() =>
      buildProtectionPositionBrief({
        positions: [pos],
        snapshot: { observedAt: huge, ethPrice8d: "250000000000" },
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: huge, ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });

  it("rejects a snapshot with too many keys without throwing", () => {
    const pos = position();
    const bloated: Record<string, unknown> = {
      observedAt: new Date(NOW_MS).toISOString(),
      ethPrice8d: "250000000000",
    };
    for (let i = 0; i < 64; i += 1) bloated[`extra${i}`] = "x";
    expect(() =>
      buildProtectionPositionBrief({
        positions: [pos],
        snapshot: bloated,
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: bloated,
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });

  it("accepts a snapshot whose string fields are exactly at the decimal-length boundary", () => {
    const pos = position();
    // A price string at exactly the cap length is not over-rejected by preflight.
    // The schema regex still applies, so use a valid unsigned-integer shape.
    const boundary = "1".repeat(PORTFOLIO_BRIEF_MAX_DECIMAL_LENGTH);
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: boundary },
      nowMs: NOW_MS,
    });
    // The position is priced (price above floor since the boundary string is huge),
    // so it should produce a hold brief, not unavailable.
    expect(first(book.briefs).action).toBe("hold");
    expect(first(book.briefs).observed.price8d).toBe(boundary);
  });

  it("rejects a snapshot whose ethPrice8d is one char over the decimal-length boundary", () => {
    const pos = position();
    const over = "1".repeat(PORTFOLIO_BRIEF_MAX_DECIMAL_LENGTH + 1);
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt: new Date(NOW_MS).toISOString(), ethPrice8d: over },
      nowMs: NOW_MS,
    });
    expect(first(book.briefs).action).toBe("unavailable");
    expect(first(book.briefs).reasons).toEqual(["market_snapshot_invalid"]);
  });
});

describe("buildProtectionPositionBrief - BigInt freshness arithmetic", () => {
  it("does not overflow when nowMs is near MAX_SAFE_INTEGER", () => {
    const expiredPos = position({}, Number(EXPIRY_MS));
    const observedAt = new Date(NOW_MS).toISOString();
    expect(() =>
      buildProtectionPositionBrief({
        positions: [expiredPos],
        snapshot: { observedAt, ethPrice8d: "250000000000" },
        nowMs: Number.MAX_SAFE_INTEGER,
      }),
    ).not.toThrow();
    const book = buildProtectionPositionBrief({
      positions: [expiredPos],
      snapshot: { observedAt, ethPrice8d: "250000000000" },
      nowMs: Number.MAX_SAFE_INTEGER,
    });
    expect(first(book.briefs).action).toBe("expired");
  });

  it("does not overflow when maxAgeMs is near MAX_SAFE_INTEGER", () => {
    const pos = position();
    const observedAt = new Date(NOW_MS).toISOString();
    const book = buildProtectionPositionBrief({
      positions: [pos],
      snapshot: { observedAt, ethPrice8d: "250000000000" },
      nowMs: NOW_MS,
      maxAgeMs: Number.MAX_SAFE_INTEGER,
    });
    expect(first(book.briefs).action).toBe("hold");
  });
});
