import { describe, expect, it } from "vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  buildRemittanceReceipt,
  decodeRemittanceReceiptPayload,
  encodeRemittanceReceiptPayload,
  REMITTANCE_RECEIPT_KIND,
  REMITTANCE_RECEIPT_MAX_BYTES,
  REMITTANCE_RECEIPT_MAX_PAYLOAD_LENGTH,
  REMITTANCE_RECEIPT_VERSION,
  sniffProofKind,
  verifyRemittanceReceipt,
  type RemittanceReceiptDocument,
} from "@/lib/remittance/receipt-proof";
import { buildExplorerUrl } from "@/lib/remittance/transfer";

const RECIPIENT_ADDRESS = "0x" + "1234567890abcdef".repeat(4);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };
const ISSUED_AT = 1_700_000_000_000;

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.444444 PHP" },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: "109000000",
    usdcAmount: "109",
    settlementRail: "Sui testnet USDC",
    payoutMethod: "Bank payout · Not available yet",
    estimatedArrival: "Within minutes after on-chain confirmation",
    payoutStatus: "Awaiting payout partner",
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: RECIPIENT_ADDRESS,
    beneficiaryRef: "R-ABCD1234",
    attestation: ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: "rent",
      maximumFamilyLimitMinor: "50000",
      ruleStatus: "within_limit",
    },
    clarification: null,
    ...overrides,
  };
}

function settlement(overrides: Partial<RemittanceReceiptDocument["settlement"]> = {}) {
  const q = quote();
  return {
    digest: DIGEST,
    explorerUrl: buildExplorerUrl(DIGEST),
    recipientAddress: q.recipientAddress!,
    usdcMicro: q.usdcMicro,
    beneficiaryRef: q.beneficiaryRef,
    quoteExpiresAt: q.expiresAt,
    payoutStatus: q.payoutStatus,
    purpose: q.intentReview.purpose,
    maximumFamilyLimitMinor: q.intentReview.maximumFamilyLimitMinor,
    confirmedAt: q.issuedAt + 60_000,
    ...overrides,
  };
}

function receipt(overrides: Partial<RemittanceReceiptDocument> = {}): RemittanceReceiptDocument {
  return buildRemittanceReceipt({
    quote: overrides.quote ?? quote(),
    settlement: overrides.settlement ?? settlement(),
    exportedAt: overrides.exportedAt ?? new Date(ISSUED_AT + 90_000).toISOString(),
  });
}

describe("remittance receipt proof — good receipt", () => {
  it("verifies a canonical confirmed-settlement receipt and stays honest about Sui tx state", () => {
    const doc = receipt();
    const result = verifyRemittanceReceipt(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("remittance_settlement");
    expect(result.claim).toMatch(/did not check the sui ledger/i);
    expect(result.claim).not.toMatch(/settled on-chain|queried/i);
    // Truthful structural/binding language: includes a server seal, and
    // seal verification is a separate step.
    expect(result.claim).toMatch(/includes a server seal/i);
    expect(result.claim).toMatch(/seal verification is a separate step/i);
    expect(result.document.kind).toBe(REMITTANCE_RECEIPT_KIND);
    expect(result.document.version).toBe(REMITTANCE_RECEIPT_VERSION);
    expect(result.document.network).toBe("testnet");
  });

  it("binds family rule purpose and cap into the verified evidence", () => {
    const result = verifyRemittanceReceipt(receipt());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rule = result.evidence.find((e) => e.label === "Family rule");
    // Local evidence is structural: the server seal is present, but the
    // "server seal verified" claim is gated on server verification.
    expect(rule?.value).toMatch(/includes server seal/i);
    expect(rule?.value).toMatch(/verification separate/i);
  });
});

describe("remittance receipt proof — tampering and mismatch", () => {
  it.each([
    ["digest mismatch", { settlement: settlement({ explorerUrl: buildExplorerUrl("OtherDigest1234567890abcdefGHIJKLMNopqrstuv") }) }, /explorer/i],
    ["explorer url mismatch", { settlement: settlement({ explorerUrl: "https://suiscan.testnet.sui.io/tx/anotherDigest" }) }, /explorer/i],
    ["recipient address mismatch", { settlement: settlement({ recipientAddress: "0x" + "22".repeat(32) }) }, /recipient/i],
    ["usdc micro mismatch", { settlement: settlement({ usdcMicro: "1" }) }, /usdc micro/i],
    ["beneficiary mismatch", { settlement: settlement({ beneficiaryRef: "R-ZZZ9999" }) }, /beneficiary/i],
    ["quote expiry mismatch", { settlement: settlement({ quoteExpiresAt: 0 }) }, /quote expiry/i],
    ["purpose mismatch", { settlement: settlement({ purpose: "school" }) }, /purpose/i],
    ["cap mismatch", { settlement: settlement({ maximumFamilyLimitMinor: "1" }) }, /cap/i],
    ["unattested quote", { quote: quote({ attestation: null }) }, /attestation/i],
    ["unmapped quote recipient", { quote: quote({ recipientAddress: null }) }, /recipient address/i],
    ["wrong kind", { kind: "convey.other" as unknown as typeof REMITTANCE_RECEIPT_KIND }, /kind/i],
    ["wrong version", { version: 2 as unknown as typeof REMITTANCE_RECEIPT_VERSION }, /version/i],
    ["unexpected field", { extra: "field" } as unknown as RemittanceReceiptDocument, /unrecognized|unexpected/i],
  ])("rejects %s with a field-specific error", (label, overrides, expected) => {
    void label;
    // Always build a valid base receipt first, then apply the breaking override
    // on the spread so construction never throws on the tampered value.
    const base = receipt();
    const tampered = { ...base, ...overrides } as unknown as RemittanceReceiptDocument;
    const result = verifyRemittanceReceipt(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(expected);
  });

  it("rejects a settlement whose confirmedAt precedes the quote issuedAt", () => {
    const doc = {
      ...receipt(),
      settlement: settlement({ confirmedAt: ISSUED_AT - 1 }),
    } as unknown as RemittanceReceiptDocument;
    const result = verifyRemittanceReceipt(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/confirmedAt/i);
  });
});

describe("remittance receipt proof — malformed and oversized payloads", () => {
  it("rejects unparseable JSON", () => {
    const result = verifyRemittanceReceipt("{not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/parse/i);
  });

  it("fails closed for a malformed URL payload", () => {
    expect(() => decodeRemittanceReceiptPayload("not-a-receipt")).toThrow(/payload/i);
  });

  it("fails closed for an oversized URL payload", () => {
    const huge = "A".repeat(REMITTANCE_RECEIPT_MAX_PAYLOAD_LENGTH + 1);
    expect(() => decodeRemittanceReceiptPayload(huge)).toThrow(/payload/i);
  });

  it("round-trips a verified receipt as a URL-safe payload without storage", () => {
    const doc = receipt();
    const payload = encodeRemittanceReceiptPayload(doc);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRemittanceReceiptPayload(payload)).toEqual(doc);
  });

  it("sniffs receipt, quote, commerce, and unknown kinds without inferring success", () => {
    expect(sniffProofKind(JSON.stringify(receipt()))).toBe("remittance-receipt");
    expect(sniffProofKind(JSON.stringify({ kind: "convey.protected-transfer-created-receipt" }))).toBe("protected-transfer-created-receipt");
    expect(sniffProofKind(JSON.stringify({ kind: "convey.remittance-quote", version: 1, quote: {} }))).toBe("remittance-quote");
    expect(sniffProofKind(JSON.stringify({ mode: "demo", digest: "x" }))).toBe("commerce");
    expect(sniffProofKind("garbage")).toBe("unknown");
    expect(sniffProofKind("A".repeat(REMITTANCE_RECEIPT_MAX_BYTES + 1))).toBe("unknown");
  });
});
