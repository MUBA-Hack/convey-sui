import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/strategy/thetanuts-readonly", () => ({
  fetchThetanutsSnapshot: vi.fn(),
}));
vi.mock("@/lib/strategy/thetanuts-shield", () => ({
  fetchShieldRecommendation: vi.fn(),
}));

import { fetchThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import { fetchShieldRecommendation } from "@/lib/strategy/thetanuts-shield";
import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";
import { POST } from "@/app/api/strategy/route";

const mockedSnapshot = vi.mocked(fetchThetanutsSnapshot);
const mockedShield = vi.mocked(fetchShieldRecommendation);

const unavailableSnapshot = {
  status: "unavailable",
  source: "Thetanuts Finance SDK",
  sdkVersion: "0.3.0",
  chain: "Base mainnet",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  reason: "Live market data is currently unavailable.",
} as const;

function post(body: unknown) {
  return POST(new Request("http://localhost/api/strategy", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

describe("POST /api/strategy", () => {
  beforeEach(() => {
    mockedSnapshot.mockReset();
    mockedShield.mockReset();
  });

  it("returns the deterministic mapping with live read-only market context (backwards compatible)", async () => {
    mockedSnapshot.mockResolvedValue({
      status: "live",
      source: "Thetanuts Finance SDK",
      sdkVersion: "0.3.0",
      chain: "Base mainnet",
      fetchedAt: "2026-08-30T00:00:00.000Z",
      marketUpdatedAt: "2026-08-30T00:00:00.000Z",
      prices: { ETH: 4000, BTC: 110000 },
      orderCount: 7,
      samples: [],
    });
    const response = await post({ goal: "Protect ETH downside for 30 days" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      intent: { kind: "strategy", objective: "protect_downside" },
      market: { status: "live", orderCount: 7 },
      execution: "none",
    });
    expect(mockedShield).not.toHaveBeenCalled();
  });

  it("does not call the SDK when the goal needs clarification", async () => {
    const response = await post({ goal: "Show me ETH" });
    expect(response.status).toBe(200);
    expect(mockedSnapshot).not.toHaveBeenCalled();
    expect(mockedShield).not.toHaveBeenCalled();
  });

  it("rejects malformed goal input", async () => {
    const response = await post({ goal: 42 });
    expect(response.status).toBe(400);
  });

  it("rejects extra keys in the request body (strict schema)", async () => {
    const response = await post({ goal: "Protect ETH downside for 30 days", extra: "bad" });
    expect(response.status).toBe(400);
    expect(mockedShield).not.toHaveBeenCalled();
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an invalid premium budget", async () => {
    const response = await post({ goal: "Protect ETH downside for 30 days", premiumBudgetUsd: -1 });
    expect(response.status).toBe(400);
    expect(mockedShield).not.toHaveBeenCalled();
  });

  it("runs the shield branch when premiumBudgetUsd is provided for protect_downside with a horizon", async () => {
    mockedShield.mockResolvedValue({
      kind: "live",
      fetchedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2030-03-17T17:46:40.000Z",
      asset: "ETH",
      optionType: "put",
      strikeUsd: 4000,
      pricePerContractUsd: 1.25,
      premiumBudgetUsd: 3,
      premiumAmountUsdc: "3000000",
      maximumLossUsdc: "3000000",
      numContracts: "5250000",
      collateralToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      chainId: 8453,
      execution: "none",
      approvalRequired: true,
      disclosure: "Read-only protective-put preflight.",
      orderBinding: { compositeId: "0x" + "a".repeat(40) + ":0x1" },
    });
    const response = await post({ goal: "Protect ETH downside for 30 days", premiumBudgetUsd: 3 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      intent: { kind: "strategy", objective: "protect_downside", asset: "ETH" },
      recommendation: { kind: "live", asset: "ETH", optionType: "put" },
      execution: "none",
    });
    expect(body).not.toHaveProperty("market");
    expect(mockedSnapshot).not.toHaveBeenCalled();
    expect(mockedShield).toHaveBeenCalledTimes(1);
  });

  it("does not run the shield branch when horizon is missing (no recommendation)", async () => {
    mockedSnapshot.mockResolvedValue(unavailableSnapshot);
    const response = await post({ goal: "Protect ETH downside", premiumBudgetUsd: 3 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intent.objective).toBe("protect_downside");
    expect(body).toHaveProperty("market");
    expect(body).not.toHaveProperty("recommendation");
    expect(mockedShield).not.toHaveBeenCalled();
    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not run the shield branch for earn_premium goals (falls back to educational)", async () => {
    mockedSnapshot.mockResolvedValue(unavailableSnapshot);
    const response = await post({ goal: "Earn premium on ETH", premiumBudgetUsd: 5 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intent.objective).toBe("earn_premium");
    expect(body).toHaveProperty("market");
    expect(body).not.toHaveProperty("recommendation");
    expect(mockedShield).not.toHaveBeenCalled();
  });

  it("does not run the shield branch when premiumBudgetUsd is absent (backwards compatible)", async () => {
    mockedSnapshot.mockResolvedValue(unavailableSnapshot);
    const response = await post({ goal: "Protect ETH downside for 30 days" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("market");
    expect(body).not.toHaveProperty("recommendation");
    expect(mockedShield).not.toHaveBeenCalled();
    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when the shield branch returns a malformed recommendation (fail closed)", async () => {
    mockedShield.mockResolvedValue({
      kind: "live",
      asset: "ETH",
    } as ShieldRecommendation);
    const response = await post({ goal: "Protect ETH downside for 30 days", premiumBudgetUsd: 3 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recommendation.kind).toBe("unavailable");
    expect(body.execution).toBe("none");
  });

  it("returns unavailable when the shield branch returns a live with non-Base-USDC collateral (tightened public union)", async () => {
    mockedShield.mockResolvedValue({
      kind: "live",
      fetchedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2030-03-17T17:46:40.000Z",
      asset: "ETH",
      optionType: "put",
      strikeUsd: 4000,
      pricePerContractUsd: 1.25,
      premiumBudgetUsd: 3,
      premiumAmountUsdc: "3000000",
      maximumLossUsdc: "3000000",
      numContracts: "5250000",
      collateralToken: "0x" + "b".repeat(40),
      chainId: 8453,
      execution: "none",
      approvalRequired: true,
      disclosure: "Read-only protective-put preflight.",
      orderBinding: { compositeId: "0x" + "a".repeat(40) + ":0x1" },
    } as ShieldRecommendation);
    const response = await post({ goal: "Protect ETH downside for 30 days", premiumBudgetUsd: 3 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recommendation.kind).toBe("unavailable");
    expect(body.execution).toBe("none");
  });

  it("rejects a budget with more than 2 fractional decimals as 400 and never calls the provider", async () => {
    const response = await post({ goal: "Protect ETH downside for 30 days", premiumBudgetUsd: 1.001 });
    expect(response.status).toBe(400);
    expect(mockedShield).not.toHaveBeenCalled();
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  // Out-of-range / fractional / zero horizons: parseStrategyGoal returns a
  // safe-goal clarification, so neither Shield nor market is ever called.
  const invalidHorizons: Array<{ name: string; goal: string }> = [
    { name: "out-of-range 999 days", goal: "Protect ETH downside for 999 days" },
    { name: "zero-day horizon", goal: "Protect ETH downside for 0 days" },
    { name: "fractional horizon 30.5 days", goal: "Protect ETH downside for 30.5 days" },
    { name: "oversized 4-digit horizon 9999 days", goal: "Protect ETH downside for 9999 days" },
  ];

  for (const { name, goal } of invalidHorizons) {
    it(`returns a safe clarification and never calls Shield/market for ${name}`, async () => {
      const response = await post({ goal, premiumBudgetUsd: 3 });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.intent.kind).toBe("clarification");
      expect(body.intent.missing).toBe("safe_goal");
      expect(body).not.toHaveProperty("recommendation");
      expect(mockedShield).not.toHaveBeenCalled();
      expect(mockedSnapshot).not.toHaveBeenCalled();
    });
  }
});
