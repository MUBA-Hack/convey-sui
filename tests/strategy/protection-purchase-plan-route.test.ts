import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/strategy/thetanuts-purchase.server", () => ({
  prepareProtectionPurchasePlan: vi.fn(),
}));

import { createRateConcurrencyGate } from "@/lib/http/rate-concurrency-gate.server";
import { POST } from "@/app/api/strategy/protection/plan/route";
import { __setStrategyBaseGateForTest } from "@/lib/strategy/strategy-base-gate.server";
import { prepareProtectionPurchasePlan } from "@/lib/strategy/thetanuts-purchase.server";

const prepare = vi.mocked(prepareProtectionPurchasePlan);
const valid = {
  goal: "Protect ETH downside for 30 days",
  premiumBudgetUsd: 3,
  account: "0x" + "A".repeat(40),
  offerFingerprint: "0x" + "1".repeat(64),
};

function request(body: string, contentType: string | null = "application/json") {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  return new Request("http://localhost/api/strategy/protection/plan", {
    method: "POST",
    body,
    headers,
  });
}

describe("POST /api/strategy/protection/plan", () => {
  beforeEach(() => {
    prepare.mockReset();
    prepare.mockResolvedValue({ kind: "unavailable", checkedAt: "2026-08-31T00:00:00.000Z" });
    __setStrategyBaseGateForTest(null);
  });

  it("normalizes account, returns typed no-store response, and calls adapter once", async () => {
    const response = await POST(request(JSON.stringify(valid), "application/json; charset=utf-8"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ kind: "unavailable", checkedAt: "2026-08-31T00:00:00.000Z" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0]).toMatchObject({ account: valid.account.toLowerCase() });
  });

  it.each([null, "text/plain", "application/json; profile=x", "application/json; charset=utf-16"])(
    "rejects content type %s before provider access",
    async (contentType) => {
      const response = await POST(request(JSON.stringify(valid), contentType));
      expect((await response.json()).kind).toBe("rejected");
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed, extra-key, and oversized bodies before provider access", async () => {
    const bodies = [
      "{",
      JSON.stringify({ ...valid, extra: true }),
      JSON.stringify({ ...valid, goal: "x".repeat(5_000) }),
    ];
    for (const body of bodies) {
      const response = await POST(request(body));
      expect((await response.json()).kind).toBe("rejected");
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("fails closed before provider access when shared Base gate denies", async () => {
    __setStrategyBaseGateForTest(createRateConcurrencyGate({
      maxConcurrent: 1,
      maxRequestsPerWindow: 1,
      windowMs: 10_000,
    }));
    expect((await (await POST(request(JSON.stringify(valid)))).json()).kind).toBe("unavailable");
    expect((await (await POST(request(JSON.stringify(valid)))).json()).kind).toBe("unavailable");
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
