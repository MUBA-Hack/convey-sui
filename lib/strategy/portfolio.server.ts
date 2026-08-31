import "server-only";

import {
  PORTFOLIO_MAX_DATE_MS,
  PORTFOLIO_POSITION_MAX_ARRAY_FIELDS,
  PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH,
  PORTFOLIO_POSITION_MAX_RECEIPTS,
  PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT,
  PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT,
  ProtectionPositionSchema,
  buildBaseScanTransactionUrl,
  classifyPositionStatus,
  type ProtectionPosition,
  type ProtectionPositionBook,
} from "./portfolio";
import {
  ProtectionPurchaseReceiptSchema,
  ProtectionPurchaseVerifyResponseSchema,
  type ProtectionPurchaseReceiptDocument,
  type ProtectionPurchaseVerifyResponse,
  type VerifiedProtectionPurchase,
} from "./protection-purchase-receipt";
import { verifyProtectionPurchaseOnBase } from "./protection-purchase-verification.server";

// ---------------------------------------------------------------------------
// Trust boundary.
//
// The production entry point `buildProtectionPositionBook` is server-only and
// accepts portable receipts only. For each parsed receipt it calls the existing
// `verifyProtectionPurchaseOnBase({txHash, plan})` itself, then cross-checks
// the fresh verified response against the receipt before emitting a position.
// A caller can never pair an arbitrary `{receipt, verify}` and have it accepted
// as chain evidence: the verify response is obtained fresh from the server-only
// verifier and rebound to receipt.plan inside this boundary. Provenance is fresh
// server RPC verification, not a cryptographic signature.
//
// The pure transformation (cross-check, freshness, position assembly) is
// private to this module. `__buildProtectionPositionBookForTest` is the only
// test seam and is named so production input cannot accidentally reach the
// paired-input path; it is never imported by app code.
// ---------------------------------------------------------------------------

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

// Parse an ISO datetime to a BigInt ms value within the representable Date
// range. Returns null for unparseable, non-finite, negative, or
// Date-overflowing values. Round-trip is enforced only where the value is used
// to produce a canonical ISO string (expiry); checkedAt only needs an exact ms.
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

// Exact cross-check: every immutable verifier field must match the receipt
// purchase/plan. The receipt schema already binds plan<->purchase; here we bind
// the fresh verifier output to the receipt purchase so a forged receipt paired
// with a mismatched (or unverified) response cannot create a position. The
// verifier checkedAt is NOT required to equal the receipt checkedAt; instead
// the receipt check must precede (or equal) the fresh verifier check, and the
// verifier check must fall within the deterministic freshness window of nowMs.
function verifyMatchesReceipt(
  verify: ProtectionPurchaseVerifyResponse,
  receipt: ProtectionPurchaseReceiptDocument,
): verify is VerifiedProtectionPurchase {
  if (verify.kind !== "verified") return false;
  const purchase = receipt.purchase;
  const plan = receipt.plan;
  return (
    verify.network === purchase.network &&
    verify.chainId === purchase.chainId &&
    verify.chainId === plan.chainId &&
    verify.txHash === purchase.txHash &&
    verify.blockNumber === purchase.blockNumber &&
    verify.buyerAddress === purchase.buyerAddress &&
    verify.buyerAddress === plan.account &&
    verify.makerAddress === purchase.makerAddress &&
    verify.makerAddress === plan.maker &&
    verify.optionAddress === purchase.optionAddress &&
    verify.nonce === purchase.nonce &&
    verify.nonce === plan.nonce &&
    verify.premiumAmountMicro === purchase.premiumAmountMicro &&
    verify.premiumAmountMicro === plan.estimatedPremiumMicro &&
    verify.feeCollectedMicro === purchase.feeCollectedMicro &&
    verify.referralFeePaidMicro === purchase.referralFeePaidMicro &&
    verify.referrerAddress === purchase.referrerAddress &&
    verify.referrerAddress === plan.referrer &&
    verify.sellerWasMaker === purchase.sellerWasMaker
  );
}

// BigInt freshness: verifyCheckedAt must be >= receiptCheckedAt and within
// [nowMs - maxAge, nowMs + futureSkew]. All comparisons are BigInt so
// near-MAX_SAFE nowMs/bounds cannot overflow or lose precision.
function verifierFreshnessOk(
  verifyCheckedAtMs: bigint,
  receiptCheckedAtMs: bigint,
  nowMs: bigint,
  maxAge: bigint,
  futureSkew: bigint,
): boolean {
  if (verifyCheckedAtMs < receiptCheckedAtMs) return false;
  if (verifyCheckedAtMs < nowMs - maxAge) return false;
  if (verifyCheckedAtMs > nowMs + futureSkew) return false;
  return true;
}

function positionFromEntry(
  receipt: ProtectionPurchaseReceiptDocument,
  verify: VerifiedProtectionPurchase,
  nowMs: bigint,
): ProtectionPosition | null {
  const { plan, purchase } = receipt;
  // Reject unless exactly one strike, matching the actual purchase intake.
  if (plan.strikes8d.length !== 1) return null;
  const expirySecondsBig = BigInt(plan.expirySeconds);
  const expiryMs = expirySecondsBig * 1000n;
  // Expiry ms must be representable as a Date and round-trip before emitting
  // an ISO string; values above the Date max (8.64e15 ms) are rejected.
  if (expiryMs < 0n || expiryMs > PORTFOLIO_MAX_DATE_MS) return null;
  const expiryMsNumber = Number(expiryMs);
  let expiryIso: string;
  try {
    expiryIso = new Date(expiryMsNumber).toISOString();
  } catch {
    return null;
  }
  if (new Date(expiryIso).getTime() !== expiryMsNumber) return null;
  const status = classifyPositionStatus(expiryMs, nowMs);
  const id = `${plan.planId}:${purchase.txHash}`;
  return {
    id,
    asset: plan.asset,
    strikeFloor8d: plan.strikes8d[0] as string,
    expirySeconds: plan.expirySeconds,
    expiryIso,
    premiumMicro: purchase.premiumAmountMicro,
    quantityMicro: plan.numContractsMicro,
    status,
    receiptRef: id,
    chainDigest: purchase.txHash,
    chainLink: buildBaseScanTransactionUrl(purchase.txHash),
    optionAddress: purchase.optionAddress,
    planId: plan.planId,
  };
}

function comparePositions(a: ProtectionPosition, b: ProtectionPosition): number {
  const expiryA = BigInt(a.expirySeconds);
  const expiryB = BigInt(b.expirySeconds);
  if (expiryA < expiryB) return -1;
  if (expiryA > expiryB) return 1;
  if (a.chainDigest < b.chainDigest) return -1;
  if (a.chainDigest > b.chainDigest) return 1;
  return 0;
}

function deepFreezePosition(position: ProtectionPosition): ProtectionPosition {
  return Object.freeze({ ...position });
}

function emptyBook(): ProtectionPositionBook {
  return Object.freeze({ positions: Object.freeze([]) });
}

// Bounded preflight: reject oversized strings/arrays/objects in O(1) per
// length check so a 10MB decimal string or huge array fails closed before Zod
// or BigInt traversal. The walk is bounded by MAX_ITERATIONS so a deeply nested
// forged receipt cannot cause proportional work.
const PREFLIGHT_MAX_ITERATIONS = 256;
const PREFLIGHT_MAX_OBJECT_KEYS = 64;

function preflightReceiptShape(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const stack: unknown[] = [raw];
  let iterations = 0;
  while (stack.length > 0) {
    if (++iterations > PREFLIGHT_MAX_ITERATIONS) return false;
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      if (node.length > PORTFOLIO_POSITION_MAX_ARRAY_FIELDS) return false;
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

// Shared pure core: given a parsed receipt and a fresh verified response that
// already passed the cross-check + freshness gate, assemble and dedupe
// positions into the by-txHash buckets. Returns the mutated map for the caller
// to finalize, or null if this entry produced no position.
function ingestVerifiedPair(
  byTx: Map<string, ProtectionPosition[]>,
  receipt: ProtectionPurchaseReceiptDocument,
  verify: VerifiedProtectionPurchase,
  nowMs: bigint,
): void {
  const position = positionFromEntry(receipt, verify, nowMs);
  if (position === null) return;
  if (!ProtectionPositionSchema.safeParse(position).success) return;
  const bucket = byTx.get(position.chainDigest);
  if (bucket === undefined) {
    byTx.set(position.chainDigest, [position]);
  } else {
    bucket.push(position);
  }
}

function finalizeBook(byTx: Map<string, ProtectionPosition[]>): ProtectionPositionBook {
  const positions: ProtectionPosition[] = [];
  for (const bucket of byTx.values()) {
    if (bucket.length === 0) continue;
    const firstPos = bucket[0] as ProtectionPosition;
    let consistent = true;
    for (let i = 1; i < bucket.length; i += 1) {
      if (JSON.stringify(bucket[i]) !== JSON.stringify(firstPos)) {
        consistent = false;
        break;
      }
    }
    if (consistent) positions.push(firstPos);
  }
  positions.sort(comparePositions);
  return Object.freeze({
    positions: Object.freeze(positions.map(deepFreezePosition)),
  });
}

// ---------------------------------------------------------------------------
// Production entry point: server-only, fresh verifier orchestration.
// ---------------------------------------------------------------------------

export interface BuildProtectionPositionBookInput {
  // Each element is parsed by ProtectionPurchaseReceiptSchema after a bounded
  // preflight; arbitrary junk is skipped so malformed entries never throw. The
  // server calls verifyProtectionPurchaseOnBase for each parsed receipt and
  // cross-checks the response before emitting. No caller-supplied verify
  // response is read.
  readonly receipts: readonly unknown[];
  readonly nowMs: number;
  readonly maxAgeMs?: number;
  readonly futureSkewMs?: number;
}

// Ingest only strict, fresh server-verified protection-purchase evidence. Each
// receipt is parsed, then verified on Base via the existing server-only
// verifier bound to receipt.plan. Only an exact cross-check between the fresh
// verified response and the receipt purchase/plan/tx/block, plus a deterministic
// freshness window on the verifier checkedAt, yields a position. Unverified,
// pending, rejected, unavailable, stale, or malformed payloads never become a
// position. Dedupe is by canonical chain identity (txHash): identical same-tx
// receipts collapse to one; same-tx conflicting receipts are excluded so two
// positions can never share a txHash. Provenance is fresh server RPC
// verification, not a cryptographic signature.
//
// Latency bound: receipts are canonical-parsed and deduped by txHash BEFORE any
// RPC call, so duplicates and conflicts never reach the verifier. The bounded
// unique set is verified concurrently via Promise.all, so the worst-case wall
// time is one verifier timeout window (6s), not N*6s. Output order is
// deterministic (sorted by expiry then chainDigest) regardless of completion
// order.
export async function buildProtectionPositionBook(
  input: BuildProtectionPositionBookInput,
): Promise<ProtectionPositionBook> {
  if (input === null || typeof input !== "object") return emptyBook();
  if (!Array.isArray(input.receipts)) return emptyBook();
  if (input.receipts.length > PORTFOLIO_POSITION_MAX_RECEIPTS) return emptyBook();
  if (!isSafeNonNegativeInt(input.nowMs)) return emptyBook();

  const nowMs = BigInt(input.nowMs);
  const maxAge = resolveBound(input.maxAgeMs, PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT);
  const futureSkew = resolveBound(input.futureSkewMs, PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT);

  // Phase 1: Canonical parse — preflight + Zod for each receipt. Malformed
  // entries are skipped so forged junk never reaches the verifier.
  const parsedReceipts: ProtectionPurchaseReceiptDocument[] = [];
  for (const raw of input.receipts) {
    if (!preflightReceiptShape(raw)) continue;
    const parsedReceipt = ProtectionPurchaseReceiptSchema.safeParse(raw);
    if (!parsedReceipt.success) continue;
    parsedReceipts.push(parsedReceipt.data);
  }

  // Phase 2: Dedupe by txHash BEFORE RPC. Group by canonical chain identity;
  // identical same-txHash receipts collapse to one representative, while
  // conflicting same-txHash receipts exclude the entire bucket so the verifier
  // is never called for a conflict and two positions can never share a txHash.
  const byTxBuckets = new Map<string, ProtectionPurchaseReceiptDocument[]>();
  for (const receipt of parsedReceipts) {
    const txHash = receipt.purchase.txHash;
    const bucket = byTxBuckets.get(txHash);
    if (bucket === undefined) {
      byTxBuckets.set(txHash, [receipt]);
    } else {
      bucket.push(receipt);
    }
  }
  const representatives: ProtectionPurchaseReceiptDocument[] = [];
  for (const bucket of byTxBuckets.values()) {
    if (bucket.length === 0) continue;
    const firstReceipt = bucket[0] as ProtectionPurchaseReceiptDocument;
    let consistent = true;
    for (let i = 1; i < bucket.length; i += 1) {
      if (JSON.stringify(bucket[i]) !== JSON.stringify(firstReceipt)) {
        consistent = false;
        break;
      }
    }
    // Conflicting same-txHash receipts are excluded entirely; the verifier is
    // not called for a conflicted txHash.
    if (consistent) representatives.push(firstReceipt);
  }

  // Phase 3: Concurrent verification of the bounded unique set. Each
  // representative is verified independently; Promise.all runs them
  // concurrently so the worst-case wall time is one timeout window, not N*6s.
  // The caller cannot supply or rebind a verify response: the verifier is
  // invoked with the receipt's own txHash and plan.
  const verifiedPairs = await Promise.all(
    representatives.map(async (receipt) => {
      const verify = await verifyProtectionPurchaseOnBase({
        txHash: receipt.purchase.txHash,
        plan: receipt.plan,
      });
      return { receipt, verify };
    }),
  );

  // Phase 4: Cross-check + freshness + ingest. Deterministic order is
  // preserved by finalizeBook's sort, independent of concurrent completion.
  const byTx = new Map<string, ProtectionPosition[]>();
  for (const { receipt, verify } of verifiedPairs) {
    if (!verifyMatchesReceipt(verify, receipt)) continue;
    const verifyCheckedAtMs = isoToMsBig(verify.checkedAt);
    const receiptCheckedAtMs = isoToMsBig(receipt.purchase.checkedAt);
    if (verifyCheckedAtMs === null || receiptCheckedAtMs === null) continue;
    if (!verifierFreshnessOk(verifyCheckedAtMs, receiptCheckedAtMs, nowMs, maxAge, futureSkew)) {
      continue;
    }
    ingestVerifiedPair(byTx, receipt, verify as VerifiedProtectionPurchase, nowMs);
  }

  return finalizeBook(byTx);
}

// ---------------------------------------------------------------------------
// Test-only seam: paired {receipt, verify} input without the verifier call.
//
// This exercises the private pure cross-check, freshness, and assembly logic so
// the exact-match invariants can be unit-tested deterministically without
// wiring the Base reader. The double-underscore prefix marks it as test-only;
// production code must call `buildProtectionPositionBook` instead. The verify
// response is parsed by ProtectionPurchaseVerifyResponseSchema so only
// schema-shaped responses are considered, but no server RPC provenance is
// implied here — the seam is for testing the cross-check, not for production.
// ---------------------------------------------------------------------------

const PairedEntrySchema = (function makePairedEntrySchema() {
  // Local strict schema pairing a receipt with a verify response. Defined here
  // (not exported) so the test seam is the only consumer.
  return {
    safeParse: (raw: unknown) => {
      if (raw === null || typeof raw !== "object") return { success: false as const };
      const obj = raw as Record<string, unknown>;
      const receiptResult = ProtectionPurchaseReceiptSchema.safeParse(obj.receipt);
      if (!receiptResult.success) return { success: false as const };
      const verifyResult = ProtectionPurchaseVerifyResponseSchema.safeParse(obj.verify);
      if (!verifyResult.success) return { success: false as const };
      return { success: true as const, data: { receipt: receiptResult.data, verify: verifyResult.data } };
    },
  };
})();

export interface BuildProtectionPositionBookForTestInput {
  readonly entries: readonly unknown[];
  readonly nowMs: number;
  readonly maxAgeMs?: number;
  readonly futureSkewMs?: number;
}

export function __buildProtectionPositionBookForTest(
  input: BuildProtectionPositionBookForTestInput,
): ProtectionPositionBook {
  if (input === null || typeof input !== "object") return emptyBook();
  if (!Array.isArray(input.entries)) return emptyBook();
  if (!isSafeNonNegativeInt(input.nowMs)) return emptyBook();

  const nowMs = BigInt(input.nowMs);
  const maxAge = resolveBound(input.maxAgeMs, PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT);
  const futureSkew = resolveBound(input.futureSkewMs, PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT);

  const byTx = new Map<string, ProtectionPosition[]>();

  for (const raw of input.entries) {
    const parsed = PairedEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const { receipt, verify } = parsed.data;
    if (!verifyMatchesReceipt(verify, receipt)) continue;
    const verifyCheckedAtMs = isoToMsBig(verify.checkedAt);
    const receiptCheckedAtMs = isoToMsBig(receipt.purchase.checkedAt);
    if (verifyCheckedAtMs === null || receiptCheckedAtMs === null) continue;
    if (!verifierFreshnessOk(verifyCheckedAtMs, receiptCheckedAtMs, nowMs, maxAge, futureSkew)) {
      continue;
    }
    ingestVerifiedPair(byTx, receipt, verify, nowMs);
  }

  return finalizeBook(byTx);
}
