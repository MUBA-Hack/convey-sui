import { describe, expect, it } from "vitest";
import {
  BASE_USDC_ADDRESS,
  buildRecommendation,
  parsePreviewEconomics,
  parseProviderOrder,
  parseShieldRecommendation,
  premiumBudgetUsdToMicro,
  selectShieldOrder,
  type ProviderOrder,
  type ShieldConstraints,
} from "@/lib/strategy/shield-recommendation";

const NOW = 1_800_000_000;
const fetchedAt = "2026-08-31T00:00:00.000Z";
const HORIZON_30_MIN_EXPIRY = NOW + 30 * 86_400; // 1_802_592_000
const FINGERPRINT_A = "0x" + "1".repeat(64);
const FINGERPRINT_B = "0x" + "2".repeat(64);

function ethPut(overrides: Partial<ProviderOrder> = {}): ProviderOrder {
  return {
    offerFingerprint: FINGERPRINT_A,
    makerAddress: "0x" + "a".repeat(40),
    isBuyer: false,
    optionType: 1,
    underlying: "ETH",
    strikes: [400000000000n],
    expiry: BigInt(HORIZON_30_MIN_EXPIRY),
    pricePerContract8d: 125000000n, // 1.25 USD per contract
    collateralToken: BASE_USDC_ADDRESS,
    ...overrides,
  };
}

describe("premiumBudgetUsdToMicro", () => {
  it("converts 3.00 USD to exact 3_000_000 micro", () => {
    expect(premiumBudgetUsdToMicro(3)).toBe(3_000_000n);
  });

  it("converts 0.01 USD to 10_000 micro", () => {
    expect(premiumBudgetUsdToMicro(0.01)).toBe(10_000n);
  });

  it("converts 1_000_000 USD to 1_000_000_000_000 micro", () => {
    expect(premiumBudgetUsdToMicro(1_000_000)).toBe(1_000_000_000_000n);
  });

  it("rejects more than 2 fractional display decimals", () => {
    expect(() => premiumBudgetUsdToMicro(3.001)).toThrow();
    expect(() => premiumBudgetUsdToMicro(0.005)).toThrow();
  });

  it("rejects non-positive or non-finite budgets", () => {
    expect(() => premiumBudgetUsdToMicro(0)).toThrow();
    expect(() => premiumBudgetUsdToMicro(-1)).toThrow();
    expect(() => premiumBudgetUsdToMicro(Number.NaN)).toThrow();
    expect(() => premiumBudgetUsdToMicro(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("parseProviderOrder (strict-normalize)", () => {
  it("accepts a well-formed USDC-collateralized maker-sell put", () => {
    expect(parseProviderOrder(ethPut())).not.toBeNull();
  });

  const rejections: Array<{ name: string; overrides: Partial<ProviderOrder> | unknown }> = [
    { name: "empty strikes", overrides: { strikes: [] } },
    { name: "zero price", overrides: { pricePerContract8d: 0n } },
    { name: "negative price", overrides: { pricePerContract8d: -1n } },
    { name: "zero expiry", overrides: { expiry: 0n } },
    { name: "negative expiry", overrides: { expiry: -1n } },
    { name: "invalid maker address", overrides: { makerAddress: "0xdead" } },
    { name: "non-USDC collateral", overrides: { collateralToken: "0x" + "b".repeat(40) } },
  ];

  for (const { name, overrides } of rejections) {
    it(`rejects ${name}`, () => {
      expect(parseProviderOrder(ethPut(overrides as Partial<ProviderOrder>))).toBeNull();
    });
  }

  it("rejects extra keys (strict)", () => {
    expect(parseProviderOrder({ ...ethPut(), signature: "0xsig" })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(parseProviderOrder(null)).toBeNull();
    expect(parseProviderOrder("order")).toBeNull();
  });
});

describe("selectShieldOrder", () => {
  const constraints = {
    asset: "ETH" as const,
    horizonDays: 30,
    premiumBudgetUsd: 5,
  };

  it("selects a fresh maker-sell put matching asset and binding horizon", () => {
    const result = selectShieldOrder([ethPut()], constraints, NOW);
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.order.offerFingerprint).toBe(FINGERPRINT_A);
    }
  });

  it("selects at the exact horizon boundary (expiry === now + horizon*86400)", () => {
    const boundary = ethPut({ expiry: BigInt(HORIZON_30_MIN_EXPIRY) });
    expect(selectShieldOrder([boundary], constraints, NOW).kind).toBe("selected");
  });

  it("returns no_match for too-short expiry (one second before boundary)", () => {
    const tooShort = ethPut({ expiry: BigInt(HORIZON_30_MIN_EXPIRY - 1) });
    expect(selectShieldOrder([tooShort], constraints, NOW).kind).toBe("no_match");
  });

  // Order-level rejections: wrong side, wrong type, wrong asset → no_match.
  const orderRejections: Array<{ name: string; overrides: Partial<ProviderOrder> }> = [
    { name: "maker-buy (wrong side)", overrides: { isBuyer: true } },
    { name: "maker-sell call (wrong option type)", overrides: { optionType: 0 } },
    { name: "wrong asset BTC", overrides: { underlying: "BTC" } },
  ];

  for (const { name, overrides } of orderRejections) {
    it(`returns no_match for ${name}`, () => {
      expect(selectShieldOrder([ethPut(overrides)], constraints, NOW).kind).toBe("no_match");
    });
  }

  it("returns no_match when no orders are present", () => {
    expect(selectShieldOrder([], constraints, NOW).kind).toBe("no_match");
  });

  it("prefers the lowest per-contract price among multiple qualifying orders", () => {
    const cheaper = ethPut({ offerFingerprint: FINGERPRINT_A, pricePerContract8d: 80000000n });
    const pricier = ethPut({ offerFingerprint: FINGERPRINT_B, pricePerContract8d: 200000000n });
    const result = selectShieldOrder([pricier, cheaper], constraints, NOW);
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.order.offerFingerprint).toBe(FINGERPRINT_A);
    }
  });

  it("distinguishes duplicate nonces across makers by composite id", () => {
    const makerA = ethPut({
      offerFingerprint: FINGERPRINT_A,
      makerAddress: "0x" + "a".repeat(40),
      pricePerContract8d: 200000000n,
    });
    const makerB = ethPut({
      offerFingerprint: FINGERPRINT_B,
      makerAddress: "0x" + "b".repeat(40),
      pricePerContract8d: 100000000n,
    });
    const result = selectShieldOrder([makerA, makerB], constraints, NOW);
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.order.offerFingerprint).toBe(FINGERPRINT_B);
    }
  });

  // Adversarial constraints: must fail closed to no_match, never throw or reach BigInt.
  const constraintRejections: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "fractional horizon 30.5", overrides: { horizonDays: 30.5 } },
    { name: "out-of-range budget >2 decimals", overrides: { premiumBudgetUsd: 1.001 } },
    { name: "invalid asset SOL", overrides: { asset: "SOL" } },
    { name: "extra key (strict)", overrides: { extra: "bad" } },
    { name: "out-of-range horizon 999", overrides: { horizonDays: 999 } },
  ];

  for (const { name, overrides } of constraintRejections) {
    it(`fails closed to no_match for ${name}`, () => {
      const bad = { ...constraints, ...overrides } as unknown as ShieldConstraints;
      expect(selectShieldOrder([ethPut()], bad, NOW).kind).toBe("no_match");
    });
  }
});

describe("parsePreviewEconomics (strict-normalize + cross-check)", () => {
  const expected = {
    makerAddress: "0x" + "a".repeat(40),
    expiry: BigInt(HORIZON_30_MIN_EXPIRY),
    isCall: false,
    strikes: [400000000000n],
    pricePerContract8d: 125000000n,
  };

  function rawPreview(overrides: Record<string, unknown> = {}) {
    return {
      numContracts: 5250000n,
      maxContracts: 5250000n,
      collateralToken: BASE_USDC_ADDRESS,
      pricePerContract: 125000000n,
      totalCollateral: 3_000_000n,
      referrer: "0x" + "0".repeat(40),
      maker: "0x" + "a".repeat(40),
      expiry: BigInt(HORIZON_30_MIN_EXPIRY),
      isCall: false,
      strikes: [400000000000n],
      ...overrides,
    };
  }

  it("accepts a well-formed preview bound to the selected order", () => {
    expect(parsePreviewEconomics(rawPreview(), expected)).not.toBeNull();
  });

  const rejections: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "negative numContracts", overrides: { numContracts: -1n } },
    { name: "zero totalCollateral", overrides: { totalCollateral: 0n } },
    { name: "non-USDC collateral", overrides: { collateralToken: "0x" + "b".repeat(40) } },
    { name: "mismatched maker", overrides: { maker: "0x" + "c".repeat(40) } },
    { name: "mismatched expiry", overrides: { expiry: BigInt(HORIZON_30_MIN_EXPIRY + 1) } },
    { name: "mismatched isCall", overrides: { isCall: true } },
    { name: "mismatched strikes", overrides: { strikes: [410000000000n] } },
    { name: "mismatched per-contract price", overrides: { pricePerContract: 130000000n } },
  ];

  for (const { name, overrides } of rejections) {
    it(`rejects ${name}`, () => {
      expect(parsePreviewEconomics(rawPreview(overrides), expected)).toBeNull();
    });
  }

  it("rejects extra keys (strict)", () => {
    expect(parsePreviewEconomics({ ...rawPreview(), extraField: "bad" }, expected)).toBeNull();
  });
});

describe("buildRecommendation", () => {
  const constraints = {
    asset: "ETH" as const,
    horizonDays: 30,
    premiumBudgetUsd: 3,
  };

  function buildWith(overrides: Partial<ProviderOrder> = {}) {
    return buildRecommendation({
      constraints,
      order: ethPut(overrides),
      preview: {
        numContracts: 5250000n,
        collateralToken: BASE_USDC_ADDRESS,
        pricePerContract: 125000000n,
        totalCollateral: 3_000_000n,
      },
      fetchedAt,
    });
  }

  it("builds a strict live bound to order identity and exact preview", () => {
    const order = ethPut();
    expect(buildRecommendation({
      constraints,
      order,
      preview: {
        numContracts: 5250000n,
        collateralToken: BASE_USDC_ADDRESS,
        pricePerContract: 125000000n,
        totalCollateral: 3_000_000n,
      },
      fetchedAt,
    })).toEqual({
      kind: "live",
      fetchedAt,
      expiresAt: new Date(Number(order.expiry) * 1_000).toISOString(),
      asset: "ETH",
      optionType: "put",
      strikeUsd: 4000,
      pricePerContractUsd: 1.25,
      premiumBudgetUsd: 3,
      premiumAmountUsdc: "3000000",
      maximumLossUsdc: "3000000",
      numContracts: "5250000",
      collateralToken: BASE_USDC_ADDRESS,
      chainId: 8453,
      execution: "none",
      approvalRequired: true,
      disclosure: expect.any(String),
      offerFingerprint: FINGERPRINT_A,
    });
  });

  it("never exposes signatures, calldata, or raw provider blobs", () => {
    const serialized = JSON.stringify(buildWith());
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("calldata");
    expect(serialized).not.toContain("rawApiData");
  });

  it("serializes without throwing or producing NaN/Infinity", () => {
    const serialized = JSON.stringify(buildWith());
    expect(serialized).not.toContain("NaN");
    expect(serialized).not.toContain("Infinity");
  });
});

describe("parseShieldRecommendation (final strict union)", () => {
  function buildLive() {
    return buildRecommendation({
      constraints: { asset: "ETH", horizonDays: 30, premiumBudgetUsd: 3 },
      order: ethPut(),
      preview: {
        numContracts: 1n,
        collateralToken: BASE_USDC_ADDRESS,
        pricePerContract: 125000000n,
        totalCollateral: 3_000_000n,
      },
      fetchedAt,
    });
  }

  it("accepts a well-formed live", () => {
    expect(parseShieldRecommendation(buildLive())).not.toBeNull();
  });

  it("accepts a well-formed no_match", () => {
    expect(parseShieldRecommendation({ kind: "no_match", fetchedAt, asset: "ETH" })).not.toBeNull();
  });

  it("accepts a well-formed unavailable", () => {
    expect(parseShieldRecommendation({ kind: "unavailable", fetchedAt, reason: "x" })).not.toBeNull();
  });

  it("rejects extra keys in live (strict)", () => {
    expect(parseShieldRecommendation({ ...buildLive(), extra: "bad" })).toBeNull();
  });

  it("rejects NaN/Infinity in numeric public fields", () => {
    const live = buildLive();
    expect(parseShieldRecommendation({ ...live, strikeUsd: Number.NaN })).toBeNull();
    expect(parseShieldRecommendation({ ...live, pricePerContractUsd: Number.POSITIVE_INFINITY })).toBeNull();
  });

  // Tightened public-union contract: collateralToken must be Base USDC and
  // premiumBudgetUsd must pass the shared exact-cents budget schema. A
  // non-Base-USDC collateral or an invalid budget can never become a live
  // public recommendation.
  const tightenedRejections: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "non-Base-USDC collateral", overrides: { collateralToken: "0x" + "b".repeat(40) } },
    { name: "zero premium budget", overrides: { premiumBudgetUsd: 0 } },
    { name: "negative premium budget", overrides: { premiumBudgetUsd: -1 } },
    { name: "premium budget >2 decimals", overrides: { premiumBudgetUsd: 1.001 } },
    { name: "premium budget over max", overrides: { premiumBudgetUsd: 1_000_001 } },
    { name: "NaN premium budget", overrides: { premiumBudgetUsd: Number.NaN } },
    { name: "Infinity premium budget", overrides: { premiumBudgetUsd: Number.POSITIVE_INFINITY } },
  ];

  for (const { name, overrides } of tightenedRejections) {
    it(`rejects live with ${name}`, () => {
      expect(parseShieldRecommendation({ ...buildLive(), ...overrides })).toBeNull();
    });
  }
});
