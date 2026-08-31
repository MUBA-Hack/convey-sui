import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { fetchShieldRecommendationWith, type ShieldReader } from "@/lib/strategy/thetanuts-shield";
import { buildProtectionOrderFingerprint } from "@/lib/strategy/protection-purchase";
import { BASE_USDC_ADDRESS, type ShieldAsset } from "@/lib/strategy/shield-recommendation";

const ETH_PRICE_FEED = "0x" + "1".repeat(40);
const BTC_PRICE_FEED = "0x" + "2".repeat(40);
const OPTION_BOOK = "0x" + "b".repeat(40);
const NOW = 1_800_000_000;
const HORIZON_30_MIN_EXPIRY = NOW + 30 * 86_400;

function rawOrder(overrides: Partial<OrderWithSignature["order"]> = {}): OrderWithSignature {
  return {
    order: {
      maker: "0x" + "a".repeat(40),
      taker: "0x0000000000000000000000000000000000000000",
      option: "",
      isBuyer: false,
      numContracts: 0n,
      price: 125000000n, // 1.25 USD per contract
      expiry: BigInt(HORIZON_30_MIN_EXPIRY),
      nonce: 1n,
      optionType: 1,
      strikes: [400000000000n],
      collateralToken: BASE_USDC_ADDRESS,
      underlyingToken: "0x" + "4".repeat(40),
      ...overrides,
    },
    signature: "0x" + "5".repeat(130),
    availableAmount: 2000000n,
    makerAddress: "0x" + "a".repeat(40),
    rawApiData: {
      collateral: BASE_USDC_ADDRESS,
      priceFeed: ETH_PRICE_FEED,
      implementation: "0x" + "3".repeat(40),
      strikes: ["400000000000"],
      isCall: false,
      isLong: true,
      orderExpiryTimestamp: HORIZON_30_MIN_EXPIRY,
      extraOptionData: "0x",
      maxCollateralUsable: "2000000",
    },
  };
}

const underlyingResolver = (order: OrderWithSignature): ShieldAsset | null => {
  const feed = order.rawApiData?.priceFeed;
  if (feed === ETH_PRICE_FEED) return "ETH";
  if (feed === BTC_PRICE_FEED) return "BTC";
  return null;
};

function previewReturn(overrides: Record<string, unknown> = {}) {
  return {
    numContracts: 2400000n,
    maxContracts: 5000000n,
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

const constraints = {
  asset: "ETH" as const,
  horizonDays: 30,
  premiumBudgetUsd: 3,
};

function makeReader(preview = vi.fn().mockReturnValue(previewReturn()), orders: OrderWithSignature[] = [rawOrder()]) {
  return {
    optionBook: OPTION_BOOK,
    fetchOrders: vi.fn().mockResolvedValue(orders),
    previewFillOrder: preview,
  };
}

async function runWith(
  orders: OrderWithSignature[],
  previewImpl: ShieldReader["previewFillOrder"],
) {
  return fetchShieldRecommendationWith(
    { optionBook: OPTION_BOOK, fetchOrders: vi.fn().mockResolvedValue(orders), previewFillOrder: previewImpl },
    underlyingResolver,
    constraints,
    { now: NOW, timeoutMs: 100 },
  );
}

describe("fetchShieldRecommendationWith — delegation seam + trust boundaries", () => {
  it("returns live and passes the exact 3.00 USD budget as 3_000_000n micro", async () => {
    const preview = vi.fn().mockReturnValue(previewReturn());
    const result = await fetchShieldRecommendationWith(
      makeReader(preview),
      underlyingResolver,
      constraints,
      { now: NOW, timeoutMs: 100 },
    );

    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.premiumBudgetUsd).toBe(3);
      expect(result.premiumAmountUsdc).toBe("3000000");
      expect(result.maximumLossUsdc).toBe("3000000");
      expect(result.numContracts).toBe("2400000");
      expect(result.chainId).toBe(8453);
      expect(result.execution).toBe("none");
      expect(result.approvalRequired).toBe(true);
      expect(result.offerFingerprint).toBe(buildProtectionOrderFingerprint(rawOrder(), OPTION_BOOK));
    }
    expect(preview).toHaveBeenCalledTimes(1);
    const [, usdcAmount, referrer] = preview.mock.calls[0]!;
    expect(usdcAmount).toBe(3_000_000n);
    expect(referrer).toBeUndefined();
  });

  it("rejects an over-budget preview (totalCollateral > budget) as no_match", async () => {
    const result = await runWith(
      [rawOrder()],
      vi.fn().mockReturnValue(previewReturn({ totalCollateral: 3_000_001n })),
    );
    expect(result.kind).toBe("no_match");
  });

  it("rejects a zero-contract preview as no_match", async () => {
    const result = await runWith(
      [rawOrder()],
      vi.fn().mockReturnValue(previewReturn({ numContracts: 0n })),
    );
    expect(result.kind).toBe("no_match");
  });

  it("returns unavailable when previewFillOrder throws", async () => {
    const result = await runWith(
      [rawOrder()],
      vi.fn().mockImplementation(() => { throw new Error("preview failed"); }),
    );
    expect(result.kind).toBe("unavailable");
  });

  it("returns unavailable when fetchOrders times out, with no fabricated live claim", async () => {
    const preview = vi.fn();
    const result = await fetchShieldRecommendationWith(
      { optionBook: OPTION_BOOK, fetchOrders: () => new Promise<never>(() => undefined), previewFillOrder: preview },
      underlyingResolver,
      constraints,
      { now: NOW, timeoutMs: 5 },
    );
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toMatch(/timed out|unavailable/i);
    }
    expect(preview).not.toHaveBeenCalled();
  });

  it("returns unavailable when fetchOrders rejects (SDK/TLS error)", async () => {
    const preview = vi.fn();
    const result = await fetchShieldRecommendationWith(
      { optionBook: OPTION_BOOK, fetchOrders: vi.fn().mockRejectedValue(new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE")), previewFillOrder: preview },
      underlyingResolver,
      constraints,
      { now: NOW, timeoutMs: 100 },
    );
    expect(result.kind).toBe("unavailable");
    expect(preview).not.toHaveBeenCalled();
  });

  it("returns no_match when an order cannot be resolved to ETH/BTC (malformed provider data)", async () => {
    const preview = vi.fn();
    const unresolved = rawOrder();
    unresolved.rawApiData = { ...unresolved.rawApiData!, priceFeed: "0xunknownfeed" };
    const result = await runWith([unresolved], preview);
    expect(result.kind).toBe("no_match");
    expect(preview).not.toHaveBeenCalled();
  });

  it("returns no_match when collateral is not Base USDC", async () => {
    const preview = vi.fn();
    const wrongCollateral = rawOrder({ collateralToken: "0x" + "b".repeat(40) });
    wrongCollateral.rawApiData = { ...wrongCollateral.rawApiData!, collateral: "0x" + "b".repeat(40) };
    const result = await runWith([wrongCollateral], preview);
    expect(result.kind).toBe("no_match");
    expect(preview).not.toHaveBeenCalled();
  });

  it("distinguishes duplicate nonces across makers and previews the exact selected raw entry", async () => {
    const makerA = rawOrder({ maker: "0x" + "a".repeat(40), price: 200000000n });
    const makerB = rawOrder({ maker: "0x" + "b".repeat(40), price: 100000000n });
    makerB.makerAddress = "0x" + "b".repeat(40);
    makerB.rawApiData = { ...makerB.rawApiData!, priceFeed: ETH_PRICE_FEED };

    const preview = vi.fn().mockImplementation((order: OrderWithSignature) => ({
      ...previewReturn({
        maker: order.makerAddress,
        pricePerContract: order.order.price,
        numContracts: order.order.price === 100000000n ? 3000000n : 1500000n,
      }),
    }));
    const result = await runWith([makerA, makerB], preview);

    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.offerFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.pricePerContractUsd).toBe(1);
    }
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]![0]).toBe(makerB);
  });

  it("bounds the inspected collection to 200 orders (resolver called exactly 200, one preview)", async () => {
    const preview = vi.fn().mockReturnValue(previewReturn());
    const many = Array.from({ length: 250 }, (_, i) =>
      rawOrder({ nonce: BigInt(i + 1), price: 125000000n }),
    );
    const countingResolver = vi.fn(underlyingResolver);
    await fetchShieldRecommendationWith(
      { optionBook: OPTION_BOOK, fetchOrders: vi.fn().mockResolvedValue(many), previewFillOrder: preview },
      countingResolver,
      constraints,
      { now: NOW, timeoutMs: 100 },
    );
    // The collection bound is proven by exactly 200 resolver calls (not 250).
    expect(countingResolver).toHaveBeenCalledTimes(200);
    // Only the selected order is previewed.
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when preview price does not match the selected order price", async () => {
    const result = await runWith(
      [rawOrder()],
      vi.fn().mockReturnValue(previewReturn({ pricePerContract: 130000000n })),
    );
    expect(result.kind).toBe("unavailable");
  });

  it("returns no_match when numContracts exceeds maxContracts (impossible count)", async () => {
    const result = await runWith(
      [rawOrder()],
      vi.fn().mockReturnValue(previewReturn({ numContracts: 6_000_000n, maxContracts: 5_250_000n })),
    );
    expect(result.kind).toBe("no_match");
  });
});

describe("fetchShieldRecommendationWith — invalid constraints fail closed at the seam", () => {
  // Every invalid-constraints case: result must be `unavailable`, and neither
  // fetchOrders nor previewFillOrder may be called. The strict parse at the seam
  // gates all provider/network access.
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "null", value: null },
    { name: "string primitive", value: "not-an-object" },
    { name: "number primitive", value: 42 },
    { name: "missing premiumBudgetUsd", value: { asset: "ETH", horizonDays: 30 } },
    { name: "missing horizonDays", value: { asset: "ETH", premiumBudgetUsd: 3 } },
    { name: "invalid asset SOL", value: { asset: "SOL", horizonDays: 30, premiumBudgetUsd: 3 } },
    { name: "fractional horizon 30.5", value: { asset: "ETH", horizonDays: 30.5, premiumBudgetUsd: 3 } },
    { name: "out-of-range horizon 999", value: { asset: "ETH", horizonDays: 999, premiumBudgetUsd: 3 } },
    { name: "budget >2 fractional decimals 1.001", value: { asset: "ETH", horizonDays: 30, premiumBudgetUsd: 1.001 } },
    { name: "extra key (strict)", value: { asset: "ETH", horizonDays: 30, premiumBudgetUsd: 3, extra: "bad" } },
  ];

  for (const { name, value } of cases) {
    it(`rejects ${name} with unavailable and zero provider calls`, async () => {
      const reader = makeReader();
      const result = await fetchShieldRecommendationWith(
        reader,
        underlyingResolver,
        value,
        { now: NOW, timeoutMs: 100 },
      );
      expect(result.kind).toBe("unavailable");
      expect(reader.fetchOrders).not.toHaveBeenCalled();
      expect(reader.previewFillOrder).not.toHaveBeenCalled();
    });
  }
});
