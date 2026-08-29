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
    });
    expect(JSON.stringify(result)).not.toContain("signature");
    expect(JSON.stringify(result)).not.toContain("calldata");
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
