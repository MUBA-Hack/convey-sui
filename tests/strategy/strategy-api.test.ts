import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/strategy/thetanuts-readonly", () => ({
  fetchThetanutsSnapshot: vi.fn(),
}));

import { fetchThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import { POST } from "@/app/api/strategy/route";

const mockedSnapshot = vi.mocked(fetchThetanutsSnapshot);

describe("POST /api/strategy", () => {
  beforeEach(() => mockedSnapshot.mockReset());

  it("returns the deterministic mapping with live read-only market context", async () => {
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
    const response = await POST(new Request("http://localhost/api/strategy", {
      method: "POST",
      body: JSON.stringify({ goal: "Protect ETH downside for 30 days" }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      intent: { kind: "strategy", objective: "protect_downside" },
      market: { status: "live", orderCount: 7 },
      execution: "none",
    });
  });

  it("does not call the SDK when the goal needs clarification", async () => {
    const response = await POST(new Request("http://localhost/api/strategy", {
      method: "POST",
      body: JSON.stringify({ goal: "Show me ETH" }),
    }));
    expect(response.status).toBe(200);
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    const response = await POST(new Request("http://localhost/api/strategy", {
      method: "POST",
      body: JSON.stringify({ goal: 42 }),
    }));
    expect(response.status).toBe(400);
  });
});
