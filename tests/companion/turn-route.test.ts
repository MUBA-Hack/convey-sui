import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, __setGonkaCompanionRouterFactoryForTest } from "@/app/api/companion/turn/route";
import { EMPTY_COMPANION_MEMORY } from "@/lib/companion/memory";

function request(body: unknown): Request {
  return new Request("http://localhost/api/companion/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  __setGonkaCompanionRouterFactoryForTest(null);
});

afterEach(() => {
  __setGonkaCompanionRouterFactoryForTest(null);
  vi.restoreAllMocks();
});

describe("POST /api/companion/turn", () => {
  it("rejects malformed bodies without widening the response", async () => {
    const response = await POST(request({ nope: true }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("falls back to deterministic clarification when no Gonka router is configured", async () => {
    const response = await POST(
      request({
        message: "Pay Dave 12 USDC for dinner",
        localeHint: "en",
        memory: {
          ...EMPTY_COMPANION_MEMORY,
          contacts: [],
        },
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ outcome: "clarification" });
  });

  it("uses the injected router when available", async () => {
    const run = vi.fn().mockResolvedValue({
      type: "gonka-run-ok",
      candidate: {
        toolId: "payments.propose",
        contactId: "dave",
        contactRef: "Dave",
        amountMajor: "12",
        asset: "USDC",
        purpose: "dinner",
        missingFields: [],
        confidence: 0.96,
        explanation: "ok",
      },
      metadata: {
        gonkaRequestId: "req_companion_1",
        responseModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
        latencyMs: 42,
        usage: {},
      },
      attempts: [],
    });
    __setGonkaCompanionRouterFactoryForTest(() => ({ run }));

    const response = await POST(
      request({
        message: "Please take care of dinner for David",
        localeHint: "en",
        memory: {
          ...EMPTY_COMPANION_MEMORY,
          contacts: [
            {
              id: "dave",
              displayName: "Dave",
              aliases: [],
              relationshipLabel: "friend",
              address: "0x" + "1".repeat(64),
              previousAddress: null,
              confirmation: "confirmed",
              confirmedAt: 1_700_000_000_000,
            },
          ],
        },
      }),
    );

    expect(run).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      outcome: "proposal",
      routing: {
        provider: "gonkarouter",
        mode: "live",
      },
      proposal: {
        contactId: "dave",
        amountMajor: "12",
        asset: "USDC",
        requiresUserApproval: true,
      },
    });
  });
});
