import { describe, expect, it } from "vitest";
import {
  CanonicalAuthorizationSchema,
  QuoteEnvelopeSchema,
  RemittanceClarificationSchema,
  isExpired,
} from "./quote-schema";
import { USDC_COIN_TYPE_TESTNET } from "./constants";

const ADDR = "0x" + "ab".repeat(32);

describe("strict schemas", () => {
  it("rejects unknown keys on quote envelopes", () => {
    const result = QuoteEnvelopeSchema.safeParse({
      kind: "quote",
      recipient: "Ana",
      destinationCity: "manila",
      destinationCountry: "Philippines",
      youPayMinor: "50000",
      youPayCurrency: "MYR",
      familyReceivesMinor: "610400",
      familyReceivesCurrency: "PHP",
      exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.44 PHP" },
      totalFeeMinor: "950",
      feeCurrency: "MYR",
      fixedFeeMinor: "200",
      feeBps: 150,
      usdcMicro: "109000000",
      usdcAmount: "109",
      settlementRail: "Sui testnet USDC",
      payoutMethod: "Bank deposit",
      estimatedArrival: "Soon",
      payoutStatus: "Awaiting payout partner",
      issuedAt: 1,
      expiresAt: 2,
      provenance: {
        pricing: "reference",
        sourceLabel: "ref",
        myrPerUsdc: "450",
        phpPerUsdc: "5600",
        fixedFeeMyr: "200",
        feeBps: 150,
      },
      corridor: { source: "MYR", destination: "PHP" },
      recipientAddress: null,
      beneficiaryRef: "R-ABCD1234",
      attestation: null,
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
      smuggled: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malicious authorization with only kind set", () => {
    expect(CanonicalAuthorizationSchema.safeParse({ kind: "authorization" }).success).toBe(false);
  });

  it("rejects oversized numeric strings", () => {
    const result = CanonicalAuthorizationSchema.safeParse({
      kind: "authorization",
      recipientAddress: ADDR,
      usdcMicro: "1".repeat(21),
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: "R-ABCD1234",
      issuedAt: 1,
      expiresAt: 2,
      corridor: { source: "MYR", destination: "PHP" },
      youPayMinor: "50000",
      familyReceivesMinor: "610400",
      totalFeeMinor: "950",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
      recipient: "Ana",
      destinationCity: "manila",
      purpose: null,
      maximumFamilyLimitMinor: null,
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid clarification and rejects unknown keys", () => {
    const ok = RemittanceClarificationSchema.safeParse({
      kind: "clarification",
      clarification: { code: "missing_amount", reason: "Need amount." },
      action: null,
      amountMinor: null,
      currency: null,
      recipient: null,
      destinationCity: null,
    });
    expect(ok.success).toBe(true);
    const bad = RemittanceClarificationSchema.safeParse({
      kind: "clarification",
      clarification: { code: "missing_amount", reason: "Need amount." },
      action: null,
      amountMinor: null,
      currency: null,
      recipient: null,
      destinationCity: null,
      extra: 1,
    });
    expect(bad.success).toBe(false);
  });

  it("isExpired is fail-closed on unsafe numbers", () => {
    expect(isExpired(Number.NaN, Date.now())).toBe(true);
    expect(isExpired(10, 11)).toBe(true);
    expect(isExpired(20, 10)).toBe(false);
  });
});
