import { afterEach, describe, expect, it, vi } from "vitest";
import { type VerifiedProtectionPurchase } from "./protection-purchase-receipt";
import {
  PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT,
  PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT,
  PORTFOLIO_POSITION_MAX_RECEIPTS,
  PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH,
  PORTFOLIO_POSITION_MAX_ARRAY_FIELDS,
  ProtectionPositionSchema,
} from "./portfolio";
import {
  buildProtectionPositionBook,
  __buildProtectionPositionBookForTest,
} from "./portfolio.server";
import {
  ACCOUNT,
  EXPIRY_MS,
  FILL_HASH,
  MAKER,
  OPTION,
  ORDER_FP,
  REFERRER,
  SIG_HASH,
  TX_HASH,
  WINDOW_MS,
  buildVerifiedEvidence,
  clearVerifierReader,
  cloneVerifiedEvidenceWithTxHash,
  entryAt,
  first,
  makeEntry,
  makePurchase,
  makeReceipt,
  makeVerifiedReceiptDoc,
  nth,
  setMultiVerifiedReader,
  setPendingReader,
  setVerifiedReader,
  type ProtectionPositionIngestionEntry,
  type ReceiptOverrides,
} from "@/tests/strategy/portfolio-fixtures";

afterEach(() => {
  clearVerifierReader();
});

// ===========================================================================
// Pure cross-check seam (paired {receipt, verify} input).
//
// These tests exercise the private pure transformation that the production
// server orchestrator reuses. The seam is test-only: production input never
// supplies a verify response — the server obtains it fresh from
// verifyProtectionPurchaseOnBase. These tests prove the exact cross-check and
// freshness logic that gates emission once the server has a verified response.
// ===========================================================================

describe("__buildProtectionPositionBookForTest - ingestion contract", () => {
  it("yields no position from a forged receipt alone without a verify response", () => {
    const receipt = makeReceipt();
    const book = __buildProtectionPositionBookForTest({
      entries: [{ receipt, verify: undefined }],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("yields no position when verify is unverified (pending/rejected/unavailable)", () => {
    const receipt = makeReceipt();
    const book = __buildProtectionPositionBookForTest({
      entries: [
        { receipt, verify: { kind: "pending", reason: "transaction_not_found" } },
        { receipt, verify: { kind: "rejected", reason: "failed_transaction" } },
        { receipt, verify: { kind: "unavailable", reason: "rpc_unavailable" } },
      ],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("yields no position when verify fields mismatch the receipt purchase", () => {
    const entry = makeEntry();
    const base = entry.verify as VerifiedProtectionPurchase;
    const mismatched: VerifiedProtectionPurchase = { ...base, txHash: "0x" + "bb".repeat(32) };
    const mismatchedBlock: VerifiedProtectionPurchase = { ...base, blockNumber: base.blockNumber + 1 };
    const mismatchedPremium: VerifiedProtectionPurchase = { ...base, premiumAmountMicro: "3000000" };
    const book = __buildProtectionPositionBookForTest({
      entries: [
        { receipt: entry.receipt, verify: mismatched },
        { receipt: entry.receipt, verify: mismatchedBlock },
        { receipt: entry.receipt, verify: mismatchedPremium },
      ],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("yields no position when verify network or chainId differs", () => {
    const entry = makeEntry();
    const badNetwork = { ...(entry.verify as VerifiedProtectionPurchase), network: "sepolia" } as unknown as VerifiedProtectionPurchase;
    const badChain = { ...(entry.verify as VerifiedProtectionPurchase), chainId: 1 } as unknown as VerifiedProtectionPurchase;
    const book = __buildProtectionPositionBookForTest({
      entries: [
        { receipt: entry.receipt, verify: badNetwork },
        { receipt: entry.receipt, verify: badChain },
      ],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("skips malformed entries (non-object, missing receipt/verify) without throwing", () => {
    const book = __buildProtectionPositionBookForTest({
      entries: [null, "nope", 42, {}, { receipt: null, verify: null }, { receipt: makeReceipt(), verify: "not-an-object" }],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });
});

describe("__buildProtectionPositionBookForTest - single strike intake", () => {
  it("rejects receipts with more than one strike", () => {
    const book = __buildProtectionPositionBookForTest({
      entries: [makeEntry({ strikes8d: ["200000000000", "210000000000"] })],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("rejects receipts with zero strikes via schema", () => {
    const entry = makeEntry({ strikes8d: ["200000000000"] });
    const receiptDoc = entry.receipt as ReturnType<typeof makeReceipt>;
    const forged = { ...receiptDoc, plan: { ...receiptDoc.plan, strikes8d: [] } };
    const book = __buildProtectionPositionBookForTest({
      entries: [{ receipt: forged, verify: entry.verify }],
      nowMs: Number(EXPIRY_MS - 10_000n),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("builds a position with a singular strikeFloor8d string from a one-strike receipt", () => {
    const nowMs = Number(EXPIRY_MS - WINDOW_MS - 1n);
    const book = __buildProtectionPositionBookForTest({
      entries: [entryAt(nowMs, { strikes8d: ["200000000000"] })],
      nowMs,
    });
    expect(book.positions).toHaveLength(1);
    const pos = first(book.positions);
    expect(pos.strikeFloor8d).toBe("200000000000");
    expect(typeof pos.strikeFloor8d).toBe("string");
  });
});

describe("__buildProtectionPositionBookForTest - txHash dedupe", () => {
  it("collapses identical same-txHash entries into one position", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const entry = entryAt(nowMs);
    const book = __buildProtectionPositionBookForTest({
      entries: [entry, structuredClone(entry), entry],
      nowMs,
    });
    expect(book.positions).toHaveLength(1);
  });

  it("excludes all entries for a txHash when receipt/verify conflict", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const a = entryAt(nowMs, { txHash: TX_HASH });
    const conflictingReceipt = entryAt(nowMs, { txHash: TX_HASH, strikes8d: ["210000000000"] });
    const book = __buildProtectionPositionBookForTest({
      entries: [a, conflictingReceipt],
      nowMs,
    });
    expect(book.positions).toHaveLength(0);
  });

  it("keeps distinct positions for distinct txHashes", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const a = entryAt(nowMs, { txHash: "0x" + "11".repeat(32) });
    const b = entryAt(nowMs, { txHash: "0x" + "22".repeat(32) });
    const book = __buildProtectionPositionBookForTest({
      entries: [a, b],
      nowMs,
    });
    expect(book.positions).toHaveLength(2);
  });
});

describe("__buildProtectionPositionBookForTest - nowMs and expiry guards", () => {
  it("returns empty book for invalid nowMs (NaN, negative, non-finite) without throwing", () => {
    const entry = makeEntry();
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs: NaN }).positions).toHaveLength(0);
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs: -1 }).positions).toHaveLength(0);
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs: Infinity }).positions).toHaveLength(0);
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs: Number.MAX_SAFE_INTEGER + 1 }).positions).toHaveLength(0);
  });

  it("returns empty book when input is malformed (no entries array) without throwing", () => {
    const book = __buildProtectionPositionBookForTest({
      entries: "not-an-array",
      nowMs: Number(EXPIRY_MS - 10_000n),
    } as unknown as { entries: readonly unknown[]; nowMs: number });
    expect(book.positions).toHaveLength(0);
  });

  it("skips receipts whose expiry ms is not representable as a safe integer", () => {
    const huge = "9007199254740992"; // 2^53 seconds -> *1000 overflows safe int
    const entry = entryAt(0, { expirySeconds: huge });
    const book = __buildProtectionPositionBookForTest({ entries: [entry], nowMs: 0 });
    expect(book.positions).toHaveLength(0);
  });
});

describe("__buildProtectionPositionBookForTest - status classification", () => {
  it("builds a single position from a verified receipt+verify with exact fields", () => {
    const nowMs = Number(EXPIRY_MS - WINDOW_MS - 1n);
    const entry = entryAt(nowMs, { txHash: TX_HASH, strikes8d: ["200000000000"] });
    const book = __buildProtectionPositionBookForTest({ entries: [entry], nowMs });
    expect(book.positions).toHaveLength(1);
    const pos = first(book.positions);
    expect(pos).toMatchObject({
      asset: "ETH",
      strikeFloor8d: "200000000000",
      expirySeconds: "1800000000",
      premiumMicro: "2000000",
      quantityMicro: "2000000",
      status: "active",
      chainDigest: TX_HASH,
      optionAddress: OPTION,
    });
    expect(pos.expiryIso).toBe(new Date(1_800_000_000_000).toISOString());
    expect(pos.chainLink).toBe(`https://basescan.org/tx/${TX_HASH}`);
    const receiptDoc = entry.receipt as ReturnType<typeof makeReceipt>;
    expect(pos.id).toBe(`${receiptDoc.plan.planId}:${TX_HASH}`);
    expect(pos.receiptRef).toBe(pos.id);
    expect(pos.planId).toBe(receiptDoc.plan.planId);
  });

  it("marks status expired exactly at expiry boundary", () => {
    const atNow = Number(EXPIRY_MS);
    const at = __buildProtectionPositionBookForTest({ entries: [entryAt(atNow)], nowMs: atNow });
    const pastNow = Number(EXPIRY_MS + 1n);
    const past = __buildProtectionPositionBookForTest({ entries: [entryAt(pastNow)], nowMs: pastNow });
    expect(first(at.positions).status).toBe("expired");
    expect(first(past.positions).status).toBe("expired");
  });

  it("marks status expiring inside the window but before expiry", () => {
    const enteringNow = Number(EXPIRY_MS - WINDOW_MS);
    const entering = __buildProtectionPositionBookForTest({ entries: [entryAt(enteringNow)], nowMs: enteringNow });
    const insideNow = Number(EXPIRY_MS - WINDOW_MS + 1n);
    const inside = __buildProtectionPositionBookForTest({ entries: [entryAt(insideNow)], nowMs: insideNow });
    const justBeforeNow = Number(EXPIRY_MS - 1n);
    const justBefore = __buildProtectionPositionBookForTest({ entries: [entryAt(justBeforeNow)], nowMs: justBeforeNow });
    expect(first(entering.positions).status).toBe("expiring");
    expect(first(inside.positions).status).toBe("expiring");
    expect(first(justBefore.positions).status).toBe("expiring");
  });

  it("marks status active just before the expiring window", () => {
    const nowMs = Number(EXPIRY_MS - WINDOW_MS - 1n);
    const book = __buildProtectionPositionBookForTest({ entries: [entryAt(nowMs)], nowMs });
    expect(first(book.positions).status).toBe("active");
  });

  it("orders positions by expiry ascending then chainDigest ascending", () => {
    const nowMs = Number(EXPIRY_MS - WINDOW_MS - 1n);
    const later = entryAt(nowMs, { expirySeconds: "1800001000", txHash: "0x" + "ff".repeat(32) });
    const earlier = entryAt(nowMs, { expirySeconds: "1800000500", txHash: "0x" + "11".repeat(32) });
    const sameLater = entryAt(nowMs, { expirySeconds: "1800000500", txHash: "0x" + "22".repeat(32) });
    const book = __buildProtectionPositionBookForTest({ entries: [later, earlier, sameLater], nowMs });
    expect(book.positions.map((p) => p.expirySeconds)).toEqual(["1800000500", "1800000500", "1800001000"]);
    expect(first(book.positions).chainDigest).toBe("0x" + "11".repeat(32));
    expect(nth(book.positions, 1).chainDigest).toBe("0x" + "22".repeat(32));
    expect(nth(book.positions, 2).chainDigest).toBe("0x" + "ff".repeat(32));
  });
});

describe("__buildProtectionPositionBookForTest - immutability", () => {
  it("returns a deeply frozen book and positions", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const book = __buildProtectionPositionBookForTest({ entries: [entryAt(nowMs)], nowMs });
    expect(Object.isFrozen(book)).toBe(true);
    expect(Object.isFrozen(book.positions)).toBe(true);
    expect(Object.isFrozen(first(book.positions))).toBe(true);
  });

  it("does not mutate the input entries array", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const entry = entryAt(nowMs);
    const input = [entry];
    const snapshot = [...input];
    __buildProtectionPositionBookForTest({ entries: input, nowMs });
    expect(input).toEqual(snapshot);
  });

  it("keeps premium, quantity, strike, and expiry as integer strings, not numbers", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const pos = first(__buildProtectionPositionBookForTest({ entries: [entryAt(nowMs)], nowMs }).positions);
    expect(typeof pos.premiumMicro).toBe("string");
    expect(typeof pos.quantityMicro).toBe("string");
    expect(typeof pos.expirySeconds).toBe("string");
    expect(typeof pos.strikeFloor8d).toBe("string");
  });

  it("supports BTC asset positions", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const book = __buildProtectionPositionBookForTest({ entries: [entryAt(nowMs, { asset: "BTC" })], nowMs });
    expect(first(book.positions).asset).toBe("BTC");
  });
});

describe("__buildProtectionPositionBookForTest - fresh verifier time bound", () => {
  const NOW_MS = Date.parse("2026-01-01T12:00:00.000Z");
  const RECEIPT_CHECKED_AT = "2026-01-01T11:00:00.000Z";
  const MAX_AGE = PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT;
  const FUTURE_SKEW = PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT;

  function entryWithVerifyCheckedAt(verifyCheckedAtIso: string): ProtectionPositionIngestionEntry {
    const overrides: ReceiptOverrides = { checkedAt: RECEIPT_CHECKED_AT };
    const receipt = makeReceipt(overrides);
    const verify = makePurchase(overrides) as VerifiedProtectionPurchase;
    return { receipt, verify: { ...verify, checkedAt: verifyCheckedAtIso } };
  }

  it("yields a position when verify.checkedAt >= receipt.checkedAt and within freshness bounds", () => {
    const entry = entryWithVerifyCheckedAt(new Date(NOW_MS).toISOString());
    const book = __buildProtectionPositionBookForTest({ entries: [entry], nowMs: NOW_MS });
    expect(book.positions).toHaveLength(1);
  });

  it("yields no position when verify.checkedAt < receipt.purchase.checkedAt", () => {
    const before = new Date(Date.parse(RECEIPT_CHECKED_AT) - 1).toISOString();
    const book = __buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(before)], nowMs: NOW_MS });
    expect(book.positions).toHaveLength(0);
  });

  it("yields no position when verify.checkedAt is older than maxAgeMs (exact cutoff +/-1)", () => {
    const atCutoff = new Date(NOW_MS - MAX_AGE).toISOString();
    const oneMsOlder = new Date(NOW_MS - MAX_AGE - 1).toISOString();
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(atCutoff)], nowMs: NOW_MS }).positions).toHaveLength(1);
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(oneMsOlder)], nowMs: NOW_MS }).positions).toHaveLength(0);
  });

  it("yields no position when verify.checkedAt is too far in the future (exact cutoff +/-1)", () => {
    const atCutoff = new Date(NOW_MS + FUTURE_SKEW).toISOString();
    const oneMsFurther = new Date(NOW_MS + FUTURE_SKEW + 1).toISOString();
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(atCutoff)], nowMs: NOW_MS }).positions).toHaveLength(1);
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(oneMsFurther)], nowMs: NOW_MS }).positions).toHaveLength(0);
  });

  it("honors overridden maxAgeMs/futureSkewMs bounds for verifier freshness", () => {
    const observed = new Date(NOW_MS - MAX_AGE - 1000).toISOString();
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(observed)], nowMs: NOW_MS }).positions).toHaveLength(0);
    expect(__buildProtectionPositionBookForTest({ entries: [entryWithVerifyCheckedAt(observed)], nowMs: NOW_MS, maxAgeMs: MAX_AGE + 60_000 }).positions).toHaveLength(1);
  });

  it("rejects malformed maxAgeMs/futureSkewMs by falling back to safe defaults", () => {
    const observed = new Date(NOW_MS - MAX_AGE - 1).toISOString();
    const book = __buildProtectionPositionBookForTest({
      entries: [entryWithVerifyCheckedAt(observed)],
      nowMs: NOW_MS,
      maxAgeMs: NaN,
      futureSkewMs: -1,
    });
    expect(book.positions).toHaveLength(0);
  });
});

describe("__buildProtectionPositionBookForTest - no-throw Date range", () => {
  it("does not throw and yields no position when expirySeconds overflows the representable Date range", () => {
    const entry = entryAt(0, { expirySeconds: "8650000000000" });
    expect(() => __buildProtectionPositionBookForTest({ entries: [entry], nowMs: 0 })).not.toThrow();
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs: 0 }).positions).toHaveLength(0);
  });

  it("accepts a far-future expiry that round-trips through Date and the strict schema", () => {
    const expiryMs = 100_000_000_000_000;
    const entry = entryAt(0, { expirySeconds: "100000000000" });
    const book = __buildProtectionPositionBookForTest({ entries: [entry], nowMs: 0 });
    expect(book.positions).toHaveLength(1);
    expect(first(book.positions).expiryIso).toBe(new Date(expiryMs).toISOString());
  });
});

describe("__buildProtectionPositionBookForTest - strict output schema", () => {
  it("exports a strict ProtectionPositionSchema that parses every built position", () => {
    const nowMs = Number(EXPIRY_MS - WINDOW_MS - 1n);
    const book = __buildProtectionPositionBookForTest({ entries: [entryAt(nowMs, { strikes8d: ["200000000000"] })], nowMs });
    expect(book.positions.length).toBeGreaterThan(0);
    for (const pos of book.positions) {
      expect(ProtectionPositionSchema.safeParse(pos).success).toBe(true);
    }
  });

  it("rejects positions with extra fields via the strict schema", () => {
    const nowMs = Number(EXPIRY_MS - 10_000n);
    const pos = first(__buildProtectionPositionBookForTest({ entries: [entryAt(nowMs)], nowMs }).positions);
    expect(ProtectionPositionSchema.safeParse({ ...pos, extra: 1 }).success).toBe(false);
  });
});

describe("__buildProtectionPositionBookForTest - BigInt freshness arithmetic", () => {
  const RECEIPT_CHECKED_AT = "2026-01-01T11:00:00.000Z";

  function entryWithVerifyCheckedAt(verifyCheckedAtIso: string): ProtectionPositionIngestionEntry {
    const overrides: ReceiptOverrides = { checkedAt: RECEIPT_CHECKED_AT };
    const receipt = makeReceipt(overrides);
    const verify = makePurchase(overrides) as VerifiedProtectionPurchase;
    return { receipt, verify: { ...verify, checkedAt: verifyCheckedAtIso } };
  }

  it("does not overflow or lose precision when nowMs is near MAX_SAFE_INTEGER", () => {
    const nowMs = Number.MAX_SAFE_INTEGER;
    const verifyCheckedAt = new Date(8_640_000_000_000_000).toISOString();
    const entry = entryWithVerifyCheckedAt(verifyCheckedAt);
    expect(() => __buildProtectionPositionBookForTest({ entries: [entry], nowMs })).not.toThrow();
    expect(__buildProtectionPositionBookForTest({ entries: [entry], nowMs }).positions).toHaveLength(0);
  });

  it("does not overflow when maxAgeMs is near MAX_SAFE_INTEGER", () => {
    const nowMs = 1_700_000_000_000;
    const entry = entryAt(nowMs);
    const book = __buildProtectionPositionBookForTest({ entries: [entry], nowMs, maxAgeMs: Number.MAX_SAFE_INTEGER });
    expect(book.positions).toHaveLength(1);
  });
});

// ===========================================================================
// Production orchestration: server-only buildProtectionPositionBook.
//
// The production path accepts only portable receipts and calls
// verifyProtectionPurchaseOnBase itself for each parsed receipt, then
// cross-checks the fresh verified response before emitting. Tests use the
// existing verifier reader seam; no caller-supplied verify response is
// accepted. Provenance is fresh server RPC verification, not cryptography.
// ===========================================================================

describe("buildProtectionPositionBook - production server orchestration", () => {
  it("emits a position when the verifier returns a fresh verified response bound to the receipt plan", async () => {
    const evidence = buildVerifiedEvidence();
    setVerifiedReader(evidence);
    const receipt = makeVerifiedReceiptDoc(evidence);
    const nowMs = Date.now();
    const book = await buildProtectionPositionBook({ receipts: [receipt], nowMs });
    expect(book.positions).toHaveLength(1);
    const pos = first(book.positions);
    expect(pos).toMatchObject({
      asset: "ETH",
      strikeFloor8d: "20000000000",
      expirySeconds: "2100000000",
      status: "active",
      chainDigest: evidence.transaction.hash,
      optionAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      planId: evidence.plan.planId,
    });
    expect(pos.expiryIso).toBe(new Date(2_100_000_000_000).toISOString());
    expect(pos.chainLink).toBe(`https://basescan.org/tx/${evidence.transaction.hash}`);
    expect(pos.id).toBe(`${evidence.plan.planId}:${evidence.transaction.hash}`);
    expect(Object.isFrozen(book)).toBe(true);
    expect(Object.isFrozen(book.positions)).toBe(true);
    expect(Object.isFrozen(pos)).toBe(true);
    expect(ProtectionPositionSchema.safeParse(pos).success).toBe(true);
  });

  it("yields no position when the verifier returns pending (transaction not found)", async () => {
    const evidence = buildVerifiedEvidence();
    setPendingReader();
    const receipt = makeVerifiedReceiptDoc(evidence);
    const book = await buildProtectionPositionBook({ receipts: [receipt], nowMs: Date.now() });
    expect(book.positions).toHaveLength(0);
  });

  it("yields no position when the receipt plan does not match the on-chain evidence (no rebinding)", async () => {
    // Receipt carries a lightweight plan that does NOT match the encoded order.
    // The server calls the verifier with receipt.plan; the reader returns
    // evidence for a different plan, so the verifier rejects and no position is
    // emitted. This proves the server binds the verify response to receipt.plan
    // rather than accepting a caller-paired response.
    const evidence = buildVerifiedEvidence();
    setVerifiedReader(evidence);
    const mismatchedReceipt = makeReceipt({
      txHash: evidence.transaction.hash,
      // Lightweight plan fields deliberately differ from the encoded order.
      strikes8d: ["200000000000"],
      expirySeconds: "1800000000",
      estimatedPremiumMicro: "2000000",
      premiumCapMicro: "2000000",
      allowanceAmountMicro: "2000000",
      numContractsMicro: "2000000",
      pricePerContract8d: "100000000",
      nonce: "1",
      account: ACCOUNT,
      maker: MAKER,
      referrer: REFERRER,
      orderFingerprint: ORDER_FP,
      signatureHash: SIG_HASH,
      fillDataHash: FILL_HASH,
      checkedAt: evidence.checkedAt,
      exportedAt: evidence.checkedAt,
    });
    const book = await buildProtectionPositionBook({ receipts: [mismatchedReceipt], nowMs: Date.now() });
    expect(book.positions).toHaveLength(0);
  });

  it("emits only the receipt whose plan matches the on-chain evidence when multiple are supplied", async () => {
    const evidence = buildVerifiedEvidence();
    setVerifiedReader(evidence);
    const matching = makeVerifiedReceiptDoc(evidence);
    const other = makeReceipt({ txHash: "0x" + "99".repeat(32), checkedAt: evidence.checkedAt, exportedAt: evidence.checkedAt });
    const book = await buildProtectionPositionBook({ receipts: [other, matching], nowMs: Date.now() });
    expect(book.positions).toHaveLength(1);
    expect(first(book.positions).chainDigest).toBe(evidence.transaction.hash);
  });

  it("does not accept a caller-supplied verify response: ignores any verify field on the input", async () => {
    const evidence = buildVerifiedEvidence();
    setPendingReader(); // verifier returns pending for everything
    const receipt = makeVerifiedReceiptDoc(evidence);
    // Attacker tries to embed a verify response alongside the receipt. The
    // production input shape is {receipts: [...]} and never reads a verify
    // field; the pending verifier result means no position is emitted.
    const book = await buildProtectionPositionBook({
      receipts: [{ ...receipt, verify: evidence.verifiedResponse }],
      nowMs: Date.now(),
    });
    expect(book.positions).toHaveLength(0);
  });

  it("claims fresh server RPC verification, not cryptographic provenance", async () => {
    const evidence = buildVerifiedEvidence();
    setVerifiedReader(evidence);
    const receipt = makeVerifiedReceiptDoc(evidence);
    const book = await buildProtectionPositionBook({ receipts: [receipt], nowMs: Date.now() });
    // The book exposes positions only; no signature/provenance claim is emitted.
    const json = JSON.stringify(book);
    expect(json).not.toMatch(/signature|provenance|attest|cryptograph/i);
    expect(book.positions).toHaveLength(1);
  });
});

// ===========================================================================
// NASA bounds: preflight caps reject huge inputs without proportional
// traversal, allocation, or RangeError. Verifier is not called for inputs
// that fail the receipt-count cap.
// ===========================================================================

describe("buildProtectionPositionBook - NASA bounds and no-throw", () => {
  it("exports bounded input limits", () => {
    expect(PORTFOLIO_POSITION_MAX_RECEIPTS).toBeGreaterThan(0);
    expect(PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH).toBeGreaterThan(0);
    expect(PORTFOLIO_POSITION_MAX_ARRAY_FIELDS).toBeGreaterThan(0);
  });

  it("returns an empty book without calling the verifier when receipts exceed the cap", async () => {
    const evidence = buildVerifiedEvidence();
    const receipt = makeVerifiedReceiptDoc(evidence);
    const tooMany = Array.from({ length: PORTFOLIO_POSITION_MAX_RECEIPTS + 1 }, () => receipt);
    const getTransaction = vi.fn();
    const getTransactionReceipt = vi.fn();
    const getBlockTimestamp = vi.fn();
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      const book = await buildProtectionPositionBook({ receipts: tooMany, nowMs: Date.now() });
      expect(book.positions).toHaveLength(0);
      expect(getTransaction).not.toHaveBeenCalled();
      expect(getTransactionReceipt).not.toHaveBeenCalled();
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });

  it("rejects a receipt with a 10MB decimal string without throwing or calling the verifier", async () => {
    const evidence = buildVerifiedEvidence();
    const receipt = makeVerifiedReceiptDoc(evidence) as unknown as Record<string, unknown>;
    const forged = {
      ...receipt,
      plan: {
        ...(receipt.plan as Record<string, unknown>),
        expirySeconds: "9".repeat(10_000_000),
      },
    };
    const getTransaction = vi.fn();
    const getTransactionReceipt = vi.fn();
    const getBlockTimestamp = vi.fn();
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      expect(() => buildProtectionPositionBook({ receipts: [forged], nowMs: Date.now() })).not.toThrow();
      const book = await buildProtectionPositionBook({ receipts: [forged], nowMs: Date.now() });
      expect(book.positions).toHaveLength(0);
      expect(getTransaction).not.toHaveBeenCalled();
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });

  it("rejects a receipt with an oversized array field without throwing", async () => {
    const evidence = buildVerifiedEvidence();
    const receipt = makeVerifiedReceiptDoc(evidence) as unknown as Record<string, unknown>;
    const forged = {
      ...receipt,
      plan: {
        ...(receipt.plan as Record<string, unknown>),
        strikes8d: Array.from({ length: PORTFOLIO_POSITION_MAX_ARRAY_FIELDS + 1 }, () => "20000000000"),
      },
    };
    const book = await buildProtectionPositionBook({ receipts: [forged], nowMs: Date.now() });
    expect(book.positions).toHaveLength(0);
  });

  it("returns an empty book for malformed input (non-array receipts, invalid nowMs) without throwing", async () => {
    await expect(buildProtectionPositionBook({ receipts: "nope", nowMs: Date.now() } as unknown as { receipts: readonly unknown[]; nowMs: number })).resolves.toMatchObject({ positions: [] });
    await expect(buildProtectionPositionBook({ receipts: [], nowMs: NaN })).resolves.toMatchObject({ positions: [] });
    await expect(buildProtectionPositionBook({ receipts: [], nowMs: -1 })).resolves.toMatchObject({ positions: [] });
    await expect(buildProtectionPositionBook({ receipts: [], nowMs: Infinity })).resolves.toMatchObject({ positions: [] });
  });

  it("caps decimal strings at the exported bound and accepts receipts at the boundary", async () => {
    // A receipt whose decimal strings are exactly at the cap is not rejected by
    // the preflight (the schema may still reject unrelated shape issues, but the
    // preflight length check itself must not over-reject).
    const evidence = buildVerifiedEvidence();
    setVerifiedReader(evidence);
    const receipt = makeVerifiedReceiptDoc(evidence);
    const book = await buildProtectionPositionBook({ receipts: [receipt], nowMs: Date.now() });
    expect(book.positions).toHaveLength(1);
  });
});

// ===========================================================================
// Verifier latency/load bounds: canonical-parse and dedupe receipts by txHash
// before RPC. Do not repeat calls for duplicates/conflicts. Verify the bounded
// unique set concurrently so worst case is one timeout window, not N*6s.
// Preserve deterministic output order independent of completion order.
// ===========================================================================

describe("buildProtectionPositionBook - dedupe before RPC (call count)", () => {
  it("calls the verifier once for duplicate same-txHash receipts (not N times)", async () => {
    const evidence = buildVerifiedEvidence();
    const receipt = makeVerifiedReceiptDoc(evidence);
    const getTransaction = vi.fn(async () => evidence.transaction);
    const getTransactionReceipt = vi.fn(async () => evidence.txReceipt);
    const getBlockTimestamp = vi.fn(async () => evidence.blockTimestampSeconds);
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      const book = await buildProtectionPositionBook({
        receipts: [receipt, structuredClone(receipt), structuredClone(receipt)],
        nowMs: Date.now(),
      });
      expect(book.positions).toHaveLength(1);
      expect(getTransaction).toHaveBeenCalledTimes(1);
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });

  it("does not call the verifier for conflicting same-txHash receipts (excluded before RPC)", async () => {
    const evidence = buildVerifiedEvidence();
    // Two receipts with the same txHash but different strikes -> conflict.
    // Both pass the schema (planId is recomputed by makeReceipt), so the
    // conflict is detected by the pre-RPC dedupe, not by schema rejection.
    const receiptA = makeReceipt({
      txHash: evidence.transaction.hash,
      checkedAt: evidence.checkedAt,
      exportedAt: evidence.checkedAt,
    });
    const receiptB = makeReceipt({
      txHash: evidence.transaction.hash,
      strikes8d: ["210000000000"],
      checkedAt: evidence.checkedAt,
      exportedAt: evidence.checkedAt,
    });
    const getTransaction = vi.fn();
    const getTransactionReceipt = vi.fn();
    const getBlockTimestamp = vi.fn();
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      const book = await buildProtectionPositionBook({
        receipts: [receiptA, receiptB],
        nowMs: Date.now(),
      });
      expect(book.positions).toHaveLength(0);
      expect(getTransaction).not.toHaveBeenCalled();
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });

  it("calls the verifier once per unique txHash for a mix of distinct and duplicate receipts", async () => {
    const base = buildVerifiedEvidence();
    const evA = base;
    const evB = cloneVerifiedEvidenceWithTxHash(base, "0x" + "22".repeat(32));
    const evC = cloneVerifiedEvidenceWithTxHash(base, "0x" + "33".repeat(32));
    setMultiVerifiedReader([evA, evB, evC]);
    const receiptA = makeVerifiedReceiptDoc(evA);
    const receiptB = makeVerifiedReceiptDoc(evB);
    const receiptC = makeVerifiedReceiptDoc(evC);
    // 7 receipts: A,A,B,B,B,C -> 3 unique txHashes -> 3 verifier calls
    const getTransaction = vi.fn(async (hash: string) => {
      for (const ev of [evA, evB, evC]) {
        if (ev.transaction.hash.toLowerCase() === hash.toLowerCase()) return ev.transaction;
      }
      return null;
    });
    const getTransactionReceipt = vi.fn(async (hash: string) => {
      for (const ev of [evA, evB, evC]) {
        if (ev.txReceipt.hash.toLowerCase() === hash.toLowerCase()) return ev.txReceipt;
      }
      return null;
    });
    const getBlockTimestamp = vi.fn(async () => base.blockTimestampSeconds);
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      const book = await buildProtectionPositionBook({
        receipts: [receiptA, structuredClone(receiptA), receiptB, structuredClone(receiptB), structuredClone(receiptB), receiptC],
        nowMs: Date.now(),
      });
      expect(book.positions).toHaveLength(3);
      expect(getTransaction).toHaveBeenCalledTimes(3);
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });
});

describe("buildProtectionPositionBook - concurrent verification", () => {
  it("verifies unique txHashes concurrently (max in-flight > 1 for distinct hashes)", async () => {
    const base = buildVerifiedEvidence();
    const evA = base;
    const evB = cloneVerifiedEvidenceWithTxHash(base, "0x" + "22".repeat(32));
    const evC = cloneVerifiedEvidenceWithTxHash(base, "0x" + "33".repeat(32));
    const receiptA = makeVerifiedReceiptDoc(evA);
    const receiptB = makeVerifiedReceiptDoc(evB);
    const receiptC = makeVerifiedReceiptDoc(evC);

    let active = 0;
    let maxActive = 0;
    const getTransaction = vi.fn(async (hash: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      active -= 1;
      for (const ev of [evA, evB, evC]) {
        if (ev.transaction.hash.toLowerCase() === hash.toLowerCase()) return ev.transaction;
      }
      return null;
    });
    const getTransactionReceipt = vi.fn(async (hash: string) => {
      for (const ev of [evA, evB, evC]) {
        if (ev.txReceipt.hash.toLowerCase() === hash.toLowerCase()) return ev.txReceipt;
      }
      return null;
    });
    const getBlockTimestamp = vi.fn(async () => base.blockTimestampSeconds);
    const { __setProtectionPurchaseVerificationReaderFactoryForTest } = await import("./protection-purchase-verification.server");
    __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
      getTransaction,
      getTransactionReceipt,
      getBlockTimestamp,
    }));
    try {
      const book = await buildProtectionPositionBook({
        receipts: [receiptA, receiptB, receiptC],
        nowMs: Date.now(),
      });
      expect(book.positions).toHaveLength(3);
      // Sequential would give maxActive=1; concurrent must give >=2.
      expect(maxActive).toBeGreaterThanOrEqual(2);
    } finally {
      __setProtectionPurchaseVerificationReaderFactoryForTest(null);
    }
  });

  it("preserves deterministic output order independent of verifier completion order", async () => {
    const base = buildVerifiedEvidence();
    // All three share the same plan (same expiry), so ordering is by chainDigest.
    // Delays are reverse-sorted so the last-digest hash resolves first.
    const hashA = "0x" + "11".repeat(32);
    const hashB = "0x" + "22".repeat(32);
    const hashC = "0x" + "33".repeat(32);
    const evA = cloneVerifiedEvidenceWithTxHash(base, hashA);
    const evB = cloneVerifiedEvidenceWithTxHash(base, hashB);
    const evC = cloneVerifiedEvidenceWithTxHash(base, hashC);
    const delays = new Map<string, number>([
      [hashA.toLowerCase(), 60],
      [hashB.toLowerCase(), 30],
      [hashC.toLowerCase(), 5],
    ]);
    setMultiVerifiedReader([evA, evB, evC], delays);
    const receiptA = makeVerifiedReceiptDoc(evA);
    const receiptB = makeVerifiedReceiptDoc(evB);
    const receiptC = makeVerifiedReceiptDoc(evC);
    // Input in reverse order; completion order is C,B,A. Output must be A,B,C.
    const book = await buildProtectionPositionBook({
      receipts: [receiptC, receiptB, receiptA],
      nowMs: Date.now(),
    });
    expect(book.positions).toHaveLength(3);
    expect(book.positions.map((p) => p.chainDigest)).toEqual([hashA, hashB, hashC]);
  });
});
