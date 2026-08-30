import { describe, expect, it } from "vitest";
import {
  buildQuote,
  formatMyr,
  formatPhp,
  formatUsdc,
  deriveBeneficiaryRef,
  type RemittanceQuoteError,
} from "./quote";
import type { QuoteEnvelope } from "./quote-schema";
import { DEFAULT_CONFIG, USDC_COIN_TYPE_TESTNET } from "./constants";
import { computeAttestation, verifyAttestation, type CanonicalFields } from "./attestation.server";
import type { RemittanceConfig } from "./server-config";
import { validateConfig } from "./server-config";
import type { RemittanceIntentInput } from "./parser";

/**
 * Integer fee/FX math, rounding, cap, expiry, exact USDC micro-units,
 * attestation, beneficiary reference, and configuration validation. No
 * floating point anywhere.
 */

const NOW = 1_700_000_000_000;
// A valid 256-bit (64 hex char) test signing key. NOT a real secret.
const KEY_HEX = "a".repeat(64);
const ADDR_A = "0x" + "ab".repeat(32);

function config(overrides: Partial<RemittanceConfig> = {}): RemittanceConfig {
  return {
    ...DEFAULT_CONFIG,
    quoteSigningKeyHex: null,
    recipients: new Map(),
    ...overrides,
  };
}

function intent(
  amountMinor: string,
  recipient = "Ana",
  city = "manila",
): RemittanceIntentInput {
  return {
    kind: "intent",
    action: "send",
    amountMinor,
    currency: "MYR",
    recipient,
    destinationCity: city,
  };
}

describe("buildQuote — RM500 golden path (default reference pricing)", () => {
  const q = buildQuote(intent("50000"), null, config(), NOW);
  expect(q.kind).toBe("quote");

  it("You pay = 500.00 MYR (the stated send amount)", () => {
    if (q.kind === "quote") expect(formatMyr(q.youPayMinor)).toBe("500");
  });

  it("total fee = fixed 2.00 + 1.5% of 500 = 2.00 + 7.50 = 9.50 MYR", () => {
    if (q.kind === "quote") {
      expect(q.totalFeeMinor).toBe("950");
      expect(formatMyr(q.totalFeeMinor)).toBe("9.5");
      expect(q.fixedFeeMinor).toBe("200");
      expect(q.feeBps).toBe(150);
    }
  });

  it("convertible = 500 - 9.50 = 490.50 MYR -> exact USDC micro-units", () => {
    if (q.kind === "quote") {
      expect(q.usdcMicro).toBe("109000000");
      expect(formatUsdc(q.usdcMicro)).toBe("109");
    }
  });

  it("Family receives = usdcMicro * 5600 / 1_000_000 (floor) PHP centavos", () => {
    if (q.kind === "quote") {
      expect(q.familyReceivesMinor).toBe("610400");
      expect(formatPhp(q.familyReceivesMinor)).toBe("6104");
    }
  });

  it("exchange rate text is 1 MYR = 12.444444 PHP (six decimals reconcile)", () => {
    if (q.kind === "quote") {
      expect(q.exchangeRate.rateText).toBe("1 MYR = 12.444444 PHP");
    }
  });

  it("carries all required customer-facing fields", () => {
    if (q.kind === "quote") {
      expect(q.recipient).toBe("Ana");
      expect(q.destinationCity).toBe("manila");
      expect(q.destinationCountry).toBe("Philippines");
      expect(q.settlementRail).toBe("Sui testnet USDC");
      expect(q.payoutMethod).toBe("Bank payout · Not available yet");
      expect(q.estimatedArrival).toBeTruthy();
      expect(q.payoutStatus).toBe("Awaiting payout partner");
      expect(q.corridor).toEqual({ source: "MYR", destination: "PHP" });
    }
  });

  it("expiry = issuedAt + quoteTtlMs", () => {
    if (q.kind === "quote") {
      expect(q.issuedAt).toBe(NOW);
      expect(q.expiresAt).toBe(NOW + DEFAULT_CONFIG.quoteTtlMs);
    }
  });

  it("default quoteTtlMs is 10 minutes (600_000 ms)", () => {
    expect(DEFAULT_CONFIG.quoteTtlMs).toBe(600_000);
  });

  it("provenance is labelled reference, never live, with the rate integers", () => {
    if (q.kind === "quote") {
      expect(q.provenance.pricing).toBe("reference");
      expect(q.provenance.sourceLabel).toMatch(/reference/i);
      expect(q.provenance.myrPerUsdc).toBe("450");
      expect(q.provenance.phpPerUsdc).toBe("5600");
      expect(q.provenance.fixedFeeMyr).toBe("200");
      expect(q.provenance.feeBps).toBe(150);
    }
  });

  it("recipientAddress is null when no recipient is mapped", () => {
    if (q.kind === "quote") expect(q.recipientAddress).toBeNull();
  });

  it("beneficiaryRef is a non-PII R-XXXXXXXX reference", () => {
    if (q.kind === "quote") {
      expect(q.beneficiaryRef).toMatch(/^R-[A-Z0-9]{8}$/);
    }
  });

  it("attestation is null (the builder never signs; the route attaches it)", () => {
    if (q.kind === "quote") expect(q.attestation).toBeNull();
  });
});

describe("buildQuote — rounding floors at each FX step", () => {
  it("floors USDC micro and PHP centavos (never rounds up)", () => {
    const q = buildQuote(intent("10000"), null, config(), NOW);
    expect(q.kind).toBe("quote");
    if (q.kind === "quote") {
      expect(q.usdcMicro).toBe("21444444");
      expect(q.familyReceivesMinor).toBe("120088");
    }
  });
});

describe("buildQuote — displayed FX reconciliation (no floating point)", () => {
  /**
   * Parse "1 MYR = 12.444444 PHP" into an exact rational numerator/scale
   * (BigInt), then prove that multiplying the displayed converted MYR amount
   * by the displayed rate rounds (half-up, to centavos) to the displayed PHP
   * centavos. Pure integer arithmetic — never float.
   */
  function parseRate(rateText: string): { num: bigint; scale: bigint } {
    const m = /^1 MYR = (\d+)\.(\d+) PHP$/.exec(rateText);
    if (!m) throw new Error(`unparseable rate text: ${rateText}`);
    const frac = m[2] as string;
    const scale = 10n ** BigInt(frac.length);
    const num = BigInt(m[1] as string) * scale + BigInt(frac);
    return { num, scale };
  }

  it("RM500 golden path: RM490.50 × 12.444444 rounds to ₱6,104.00 (610400 centavos)", () => {
    const q = buildQuote(intent("50000"), null, config(), NOW);
    expect(q.kind).toBe("quote");
    if (q.kind !== "quote") return;
    const convertedSen = BigInt(q.youPayMinor) - BigInt(q.totalFeeMinor);
    const { num, scale } = parseRate(q.exchangeRate.rateText);
    // centavos = round((convertedSen * num) / scale)  (half-up)
    const numerator = convertedSen * num;
    const centavos = (numerator + scale / 2n) / scale;
    expect(centavos).toBe(BigInt(q.familyReceivesMinor));
  });

  it("the displayed rate is the exact rational phpPerUsdc/myrPerUsdc truncated to 6 decimals", () => {
    const q = buildQuote(intent("50000"), null, config(), NOW);
    expect(q.kind).toBe("quote");
    if (q.kind !== "quote") return;
    const { num, scale } = parseRate(q.exchangeRate.rateText);
    // num/scale must equal floor(phpPerUsdc * 10^6 / myrPerUsdc) / 10^6.
    const phpPerUsdc = BigInt(q.provenance.phpPerUsdc);
    const myrPerUsdc = BigInt(q.provenance.myrPerUsdc);
    const expectedNum = (phpPerUsdc * scale) / myrPerUsdc;
    expect(num).toBe(expectedNum);
    expect(scale).toBe(1_000_000n);
  });
});

describe("buildQuote — bounds and cap", () => {
  it("rejects zero send amount", () => {
    const q = buildQuote(intent("0"), null, config(), NOW);
    expect(q.kind).toBe("clarification");
    if (q.kind === "clarification") expect(q.clarification.code).toBe("amount_too_small");
  });

  it("rejects an amount below the minimum", () => {
    const q = buildQuote(intent("50"), null, config(), NOW);
    expect(q.kind).toBe("clarification");
    if (q.kind === "clarification") expect(q.clarification.code).toBe("amount_too_small");
  });

  it("rejects an amount above the maximum cap", () => {
    const q = buildQuote(intent("100001"), null, config(), NOW);
    expect(q.kind).toBe("clarification");
    if (q.kind === "clarification") expect(q.clarification.code).toBe("amount_exceeds_max");
  });

  it("accepts the exact maximum cap", () => {
    const q = buildQuote(intent("100000"), null, config(), NOW);
    expect(q.kind).toBe("quote");
  });

  it("rejects when the fee consumes the entire send (tiny amount, huge fee)", () => {
    const q = buildQuote(intent("100"), null, config({ fixedFeeMyr: 1000n }), NOW);
    expect(q.kind).toBe("clarification");
    if (q.kind === "clarification") expect(q.clarification.code).toBe("amount_too_small");
  });
});

describe("buildQuote — custom rates and fees", () => {
  it("uses env-overridden rates and fees", () => {
    const q = buildQuote(
      intent("50000"),
      null,
      config({ myrPerUsdc: 400n, phpPerUsdc: 6000n, fixedFeeMyr: 0n, feeBps: 0 }),
      NOW,
    );
    expect(q.kind).toBe("quote");
    if (q.kind === "quote") {
      expect(q.usdcMicro).toBe("125000000");
      expect(q.familyReceivesMinor).toBe("750000");
      expect(q.totalFeeMinor).toBe("0");
      expect(q.exchangeRate.rateText).toBe("1 MYR = 15.000000 PHP");
    }
  });
});

describe("buildQuote — per-beneficiary recipient (passed explicitly)", () => {
  it("carries the mapped recipient address when present", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    expect(q.kind).toBe("quote");
    if (q.kind === "quote") expect(q.recipientAddress).toBe(ADDR_A);
  });

  it("attestation is null from the builder even with a recipient (route attaches it)", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    expect(q.kind).toBe("quote");
    if (q.kind === "quote") expect(q.attestation).toBeNull();
  });
});

describe("attestation.server — sign and verify (server-only)", () => {
  function fieldsFor(q: QuoteEnvelope, recipientAddress: string): CanonicalFields {
    return {
      recipientAddress,
      usdcMicro: q.usdcMicro,
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: q.beneficiaryRef,
      corridor: q.corridor,
      youPayMinor: q.youPayMinor,
      familyReceivesMinor: q.familyReceivesMinor,
      totalFeeMinor: q.totalFeeMinor,
      myrPerUsdc: q.provenance.myrPerUsdc,
      phpPerUsdc: q.provenance.phpPerUsdc,
      fixedFeeMyr: q.provenance.fixedFeeMyr,
      feeBps: q.provenance.feeBps,
      issuedAt: q.issuedAt,
      expiresAt: q.expiresAt,
      recipient: q.recipient,
      destinationCity: q.destinationCity,
      purpose: q.intentReview.purpose,
      maximumFamilyLimitMinor: q.intentReview.maximumFamilyLimitMinor,
    };
  }

  it("matches an independently precomputed HMAC-SHA256 vector", () => {
    const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const fields: CanonicalFields = {
      recipientAddress: `0x${"11".repeat(32)}`,
      usdcMicro: "1234567",
      coinType: "0x2::usdc::USDC",
      beneficiaryRef: "R-ABCD1234",
      corridor: { source: "MYR", destination: "PHP" },
      youPayMinor: "50000",
      familyReceivesMinor: "610400",
      totalFeeMinor: "950",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_120_000,
      recipient: "Ana",
      destinationCity: "manila",
      purpose: null,
      maximumFamilyLimitMinor: null,
    };
    expect(computeAttestation(key, fields)).toBe(
      "0xbb87b6d502b5f89f28c38acf8b09e90a6e3f1ec39e55d5d8b1b93ab8aa17cf81",
    );
  });

  it("computes and verifies an attestation with the same key and fields", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const attested: QuoteEnvelope = { ...q, attestation: { v: 1, hmac } };
    expect(verifyAttestation(KEY_HEX, attested, USDC_COIN_TYPE_TESTNET)).toBe(true);
  });

  it("fails against a different key", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const attested: QuoteEnvelope = { ...q, attestation: { v: 1, hmac } };
    const wrongKey = "b".repeat(64);
    expect(verifyAttestation(wrongKey, attested, USDC_COIN_TYPE_TESTNET)).toBe(false);
  });

  it("fails when the key is absent (fail closed)", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const attested: QuoteEnvelope = { ...q, attestation: { v: 1, hmac } };
    expect(verifyAttestation(null, attested, USDC_COIN_TYPE_TESTNET)).toBe(false);
  });

  it("fails when a field is tampered (amount)", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const tampered: QuoteEnvelope = { ...q, attestation: { v: 1, hmac }, usdcMicro: "999999999" };
    expect(verifyAttestation(KEY_HEX, tampered, USDC_COIN_TYPE_TESTNET)).toBe(false);
  });

  it("fails when a field is tampered (recipient)", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const tampered: QuoteEnvelope = {
      ...q,
      attestation: { v: 1, hmac },
      recipientAddress: "0x" + "99".repeat(32),
    };
    expect(verifyAttestation(KEY_HEX, tampered, USDC_COIN_TYPE_TESTNET)).toBe(false);
  });

  it("fails when a field is tampered (rates)", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    if (q.kind !== "quote") throw new Error("expected quote");
    const fields = fieldsFor(q, ADDR_A);
    const hmac = computeAttestation(KEY_HEX, fields);
    const tampered: QuoteEnvelope = {
      ...q,
      attestation: { v: 1, hmac },
      provenance: { ...q.provenance, myrPerUsdc: "1" },
    };
    expect(verifyAttestation(KEY_HEX, tampered, USDC_COIN_TYPE_TESTNET)).toBe(false);
  });
});

describe("canonicalMessage — control/newline rejection", () => {
  function baseFields(): CanonicalFields {
    return {
      recipientAddress: ADDR_A,
      usdcMicro: "109000000",
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: "R-ABCD1234",
      corridor: { source: "MYR", destination: "PHP" },
      youPayMinor: "50000",
      familyReceivesMinor: "610400",
      totalFeeMinor: "950",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
      issuedAt: NOW,
      expiresAt: NOW + 120_000,
      recipient: "Ana",
      destinationCity: "manila",
      purpose: null,
      maximumFamilyLimitMinor: null,
    };
  }

  it("rejects a newline in the recipient field", () => {
    const fields = { ...baseFields(), recipient: "Ana\nX" };
    expect(() => computeAttestation(KEY_HEX, fields)).toThrow(/control character or newline/i);
  });

  it("rejects a control char in the destinationCity field", () => {
    const fields = { ...baseFields(), destinationCity: "manila\x00" };
    expect(() => computeAttestation(KEY_HEX, fields)).toThrow(/control character or newline/i);
  });

  it("rejects a newline in the recipientAddress field", () => {
    const fields = { ...baseFields(), recipientAddress: `${ADDR_A}\n` };
    expect(() => computeAttestation(KEY_HEX, fields)).toThrow(/control character or newline/i);
  });
});

describe("buildQuote — no secret leakage", () => {
  it("the quote JSON never contains the signing key", () => {
    const q = buildQuote(intent("50000", "Ana", "manila"), ADDR_A, config(), NOW);
    const json = JSON.stringify(q);
    expect(json).not.toContain(KEY_HEX);
  });
});

describe("deriveBeneficiaryRef", () => {
  it("produces a stable R-XXXXXXXX reference for the same alias and issuedAt", () => {
    const a = deriveBeneficiaryRef("Ana", NOW);
    const b = deriveBeneficiaryRef("Ana", NOW);
    expect(a).toBe(b);
    expect(a).toMatch(/^R-[A-Z0-9]{8}$/);
  });

  it("produces different references for different aliases", () => {
    const a = deriveBeneficiaryRef("Ana", NOW);
    const b = deriveBeneficiaryRef("Maria", NOW);
    expect(a).not.toBe(b);
  });

  it("produces different references for different issuedAt", () => {
    const a = deriveBeneficiaryRef("Ana", NOW);
    const b = deriveBeneficiaryRef("Ana", NOW + 1);
    expect(a).not.toBe(b);
  });
});

describe("validateConfig", () => {
  it("accepts the default config", () => {
    expect(validateConfig(config())).toBeNull();
  });

  it("rejects a non-positive MYR rate", () => {
    expect(validateConfig(config({ myrPerUsdc: 0n }))).not.toBeNull();
  });

  it("rejects a non-positive PHP rate", () => {
    expect(validateConfig(config({ phpPerUsdc: 0n }))).not.toBeNull();
  });

  it("rejects fee bps outside [0, 10000]", () => {
    expect(validateConfig(config({ feeBps: -1 }))).not.toBeNull();
    expect(validateConfig(config({ feeBps: 10_001 }))).not.toBeNull();
  });

  it("rejects min > max", () => {
    expect(validateConfig(config({ minSendMyr: 200_000n, maxSendMyr: 100_000n }))).not.toBeNull();
  });

  it("rejects a non-testnet USDC coin type", () => {
    expect(
      validateConfig(config({ usdcCoinType: "0xwrong::usdc::USDC" })),
    ).not.toBeNull();
  });

  it("rejects a TTL below the minimum", () => {
    expect(validateConfig(config({ quoteTtlMs: 5_000 }))).not.toBeNull();
  });

  it("rejects a TTL above the maximum", () => {
    expect(validateConfig(config({ quoteTtlMs: 700_000 }))).not.toBeNull();
  });

  it("accepts the minimum TTL", () => {
    expect(validateConfig(config({ quoteTtlMs: 10_000 }))).toBeNull();
  });

  it("accepts the maximum TTL", () => {
    expect(validateConfig(config({ quoteTtlMs: 600_000 }))).toBeNull();
  });
});

export type { QuoteEnvelope, RemittanceQuoteError };
