import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("Thetanuts read-only adapter", () => {
  let fetchThetanutsSnapshotWith: typeof import("@/lib/strategy/thetanuts-readonly").fetchThetanutsSnapshotWith;

  beforeAll(async () => {
    ({ fetchThetanutsSnapshotWith } = await import("@/lib/strategy/thetanuts-readonly"));
  });

  it("normalizes live SDK reads without exposing signatures or transaction data", async () => {
    const reader = {
      getMarketData: vi.fn().mockResolvedValue({
        prices: { ETH: 4123.45, BTC: 112000 },
        metadata: { lastUpdated: 1_777_777_777_000, currentTime: 1_777_777_778_000 },
      }),
      fetchOrders: vi.fn().mockResolvedValue([
        {
          order: {
            isBuyer: false,
            optionType: 1,
            price: 125000000n,
            strikes: [400000000000n],
            expiry: 1_800_000_000n,
          },
          availableAmount: 2000000n,
          signature: "secret-signature",
          rawApiData: {
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
          },
        },
      ]),
    };

    const result = await fetchThetanutsSnapshotWith(reader, 100);
    expect(result).toMatchObject({
      status: "live",
      source: "Thetanuts Finance SDK",
      chain: "Base mainnet",
      prices: { ETH: 4123.45, BTC: 112000 },
      orderCount: 1,
      samples: [{ asset: "ETH" }],
    });
    expect(JSON.stringify(result)).not.toContain("signature");
    expect(JSON.stringify(result)).not.toContain("calldata");
  });

  it("keeps representative ETH and BTC orders even when one asset dominates the feed", async () => {
    const makeOrder = (priceFeed: string, strike: bigint, nonce: number) => ({
      order: {
        isBuyer: true,
        optionType: 0,
        price: 100000000n,
        strikes: [strike],
        expiry: BigInt(1_800_000_000 + nonce),
      },
      availableAmount: 1000000n,
      signature: `signature-${nonce}`,
      rawApiData: { priceFeed },
    });
    const ethFeed = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
    const btcFeed = "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F";
    const orders = [
      ...Array.from({ length: 13 }, (_, index) =>
        makeOrder(ethFeed, 400000000000n, index),
      ),
      makeOrder(btcFeed, 11000000000000n, 99),
    ];
    const result = await fetchThetanutsSnapshotWith(
      {
        getMarketData: vi.fn().mockResolvedValue({
          prices: { ETH: 4000, BTC: 110000 },
          metadata: { lastUpdated: 1_777_777_777_000 },
        }),
        fetchOrders: vi.fn().mockResolvedValue(orders),
      },
      100,
    );

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.samples.some((sample) => sample.asset === "ETH")).toBe(true);
    expect(result.samples.some((sample) => sample.asset === "BTC")).toBe(true);
    expect(result.samples.filter((sample) => sample.asset === "ETH")).toHaveLength(3);
  });

  it("returns an honest unavailable state when the SDK times out", async () => {
    const never = new Promise<never>(() => undefined);
    const result = await fetchThetanutsSnapshotWith(
      { getMarketData: () => never, fetchOrders: () => never },
      5,
    );
    expect(result).toMatchObject({
      status: "unavailable",
      source: "Thetanuts Finance SDK",
      reason: "Market data timed out.",
    });
  });
});
