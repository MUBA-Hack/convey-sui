import { describe, expect, it } from "vitest";
import {
  REMITTANCE_HANDOFF_KIND,
  REMITTANCE_HANDOFF_MAX_BYTES,
  REMITTANCE_HANDOFF_VERSION,
  RemittanceHandoffError,
  decodeHandoff,
  encodeHandoff,
  sniffHandoffKind,
  wrapQuote,
} from "./offline-handoff";
import type { QuoteEnvelope } from "./quote-schema";

const ADDR = "0x" + "ab".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };

function baseQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
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
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR,
    beneficiaryRef: "R-ABCD1234",
    attestation: VALID_ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    },
    clarification: null,
    ...overrides,
  };
}

describe("remittance offline handoff — strict wrapper", () => {
  it("round-trips a valid quote unchanged through wrap/encode/decode", () => {
    const quote = baseQuote();
    const handoff = wrapQuote(quote);
    expect(handoff.kind).toBe(REMITTANCE_HANDOFF_KIND);
    expect(handoff.version).toBe(REMITTANCE_HANDOFF_VERSION);
    const json = encodeHandoff(handoff);
    const decoded = decodeHandoff(json);
    expect(decoded.quote).toEqual(quote);
  });

  it("decoded quote is byte-for-byte the carried quote (no added fields)", () => {
    const quote = baseQuote();
    const decoded = decodeHandoff(encodeHandoff(wrapQuote(quote)));
    // The wrapper must not mutate or augment the inner quote.
    expect(JSON.stringify(decoded.quote)).toBe(JSON.stringify(quote));
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeHandoff("{not json")).toThrow(RemittanceHandoffError);
    try {
      decodeHandoff("{not json");
    } catch (e) {
      expect((e as RemittanceHandoffError).reason).toBe("malformed_json");
    }
  });

  it("rejects empty payload", () => {
    expect(() => decodeHandoff("")).toThrow(RemittanceHandoffError);
  });

  it("rejects wrong kind", () => {
    const json = JSON.stringify({
      kind: "convey.something-else",
      version: REMITTANCE_HANDOFF_VERSION,
      quote: baseQuote(),
    });
    expect(() => decodeHandoff(json)).toThrow(RemittanceHandoffError);
    try {
      decodeHandoff(json);
    } catch (e) {
      expect((e as RemittanceHandoffError).reason).toBe("wrong_kind");
    }
  });

  it("rejects wrong version", () => {
    const json = JSON.stringify({
      kind: REMITTANCE_HANDOFF_KIND,
      version: 2,
      quote: baseQuote(),
    });
    expect(() => decodeHandoff(json)).toThrow(RemittanceHandoffError);
    try {
      decodeHandoff(json);
    } catch (e) {
      expect((e as RemittanceHandoffError).reason).toBe("unsupported_version");
    }
  });

  it("rejects extra top-level fields (strict)", () => {
    const handoff = wrapQuote(baseQuote());
    const json = encodeHandoff(handoff);
    const withExtra = JSON.stringify({
      ...JSON.parse(json),
      smuggled: true,
    });
    expect(() => decodeHandoff(withExtra)).toThrow(RemittanceHandoffError);
    try {
      decodeHandoff(withExtra);
    } catch (e) {
      expect((e as RemittanceHandoffError).reason).toBe("invalid_shape");
    }
  });

  it("rejects extra fields inside the inner quote (strict)", () => {
    const handoff = wrapQuote(baseQuote());
    const obj = JSON.parse(encodeHandoff(handoff));
    obj.quote.smuggled = true;
    expect(() => decodeHandoff(JSON.stringify(obj))).toThrow(RemittanceHandoffError);
  });

  it("rejects oversized input", () => {
    const huge = "x".repeat(REMITTANCE_HANDOFF_MAX_BYTES + 1);
    expect(() => decodeHandoff(huge)).toThrow(RemittanceHandoffError);
    try {
      decodeHandoff(huge);
    } catch (e) {
      expect((e as RemittanceHandoffError).reason).toBe("oversized");
    }
  });

  it("rejects a non-object payload", () => {
    expect(() => decodeHandoff("[]")).toThrow(RemittanceHandoffError);
    expect(() => decodeHandoff("null")).toThrow(RemittanceHandoffError);
    expect(() => decodeHandoff('"string"')).toThrow(RemittanceHandoffError);
  });

  it("rejects a wrapper whose inner quote is invalid", () => {
    const obj = {
      kind: REMITTANCE_HANDOFF_KIND,
      version: REMITTANCE_HANDOFF_VERSION,
      quote: { ...baseQuote(), recipient: "" },
    };
    expect(() => decodeHandoff(JSON.stringify(obj))).toThrow(RemittanceHandoffError);
  });

  it("wrapQuote rejects a partial/foreign quote object", () => {
    expect(() => wrapQuote({} as QuoteEnvelope)).toThrow(RemittanceHandoffError);
  });

  describe("sniffHandoffKind", () => {
    it("identifies a remittance handoff payload", () => {
      const json = encodeHandoff(wrapQuote(baseQuote()));
      expect(sniffHandoffKind(json)).toBe("convey.remittance-quote");
    });

    it("loosely identifies a commerce QR Ferry payload (numeric version, no kind)", () => {
      const qrJson = JSON.stringify({
        version: 1,
        item: "Iced Coffee",
        quantity: 2,
        totalMist: "6000000000",
        merchantAddress: ADDR,
        nonce: "n",
        createdAt: 1,
        expiresAt: 2,
        checksum: "0x" + "0".repeat(64),
      });
      expect(sniffHandoffKind(qrJson)).toBe("qr-ferry");
    });

    it("returns unknown for malformed/empty/foreign payloads", () => {
      expect(sniffHandoffKind("")).toBe("unknown");
      expect(sniffHandoffKind("{not json")).toBe("unknown");
      expect(sniffHandoffKind(JSON.stringify({ foo: 1 }))).toBe("unknown");
      expect(sniffHandoffKind("[]")).toBe("unknown");
    });

    it("returns unknown for oversized input", () => {
      expect(sniffHandoffKind("x".repeat(REMITTANCE_HANDOFF_MAX_BYTES + 1))).toBe("unknown");
    });
  });
});
