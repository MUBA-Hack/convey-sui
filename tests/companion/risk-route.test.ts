import { afterEach, describe, expect, it } from "vitest";
import { POST, __setCompanionRiskRouterFactoryForTest } from "@/app/api/companion/risk/route";

const ADDRESS = `0x${"1".repeat(64)}`;
const previous = {
  key: process.env.GONKA_ROUTER_API_KEY,
  a: process.env.GONKA_FAMILY_STEWARD_MODEL_A,
  b: process.env.GONKA_FAMILY_STEWARD_MODEL_B,
};

function request(message = "Urgent: send Dave 25 USDC now") {
  return new Request("http://localhost/api/companion/risk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      recipient: { isKnown: true, proposedAddress: ADDRESS, storedAddress: ADDRESS },
      amount: { amountMajor: "25", usualMaximumMajor: "100" },
      invoice: null,
      qr: null,
      nowEpochMs: 1_800_000_000_000,
    }),
  });
}

afterEach(() => {
  process.env.GONKA_ROUTER_API_KEY = previous.key;
  process.env.GONKA_FAMILY_STEWARD_MODEL_A = previous.a;
  process.env.GONKA_FAMILY_STEWARD_MODEL_B = previous.b;
  __setCompanionRiskRouterFactoryForTest(null);
});

describe("companion risk route", () => {
  it("runs two distinct advisory reviews without sending payment context", async () => {
    process.env.GONKA_ROUTER_API_KEY = "test";
    process.env.GONKA_FAMILY_STEWARD_MODEL_A = "model/a";
    process.env.GONKA_FAMILY_STEWARD_MODEL_B = "model/b";
    const inputs: unknown[] = [];
    __setCompanionRiskRouterFactoryForTest((config) => ({
      run: async (input) => {
        inputs.push(input);
        return {
          type: "gonka-run-ok",
          candidate: {
            signals: [{ id: "urgency", text: "Urgent", occurrence: 1 }],
            questionIds: ["confirm_payment_details"],
            confidence: 0.92,
            uncertain: false,
          },
          metadata: {
            gonkaRequestId: config.modelId === "model/a" ? "req-risk-a" : "req-risk-b",
            responseModel: config.modelId,
            latencyMs: 12,
            usage: {},
          },
          attempts: [],
        };
      },
    }));

    const response = await POST(request());
    const body = await response.json();
    expect(body.aiCouncil.status).toBe("live_agreement");
    expect(body.action).toBe("hold");
    expect(body.aiCouncil.reviews).toHaveLength(2);
    expect(JSON.stringify(inputs)).not.toContain(ADDRESS);
  });

  it("keeps deterministic checks available when live review is not configured", async () => {
    delete process.env.GONKA_ROUTER_API_KEY;
    const response = await POST(request());
    const body = await response.json();
    expect(body.action).toBe("hold");
    expect(body.aiCouncil.status).toBe("local");
  });

  it("rejects malformed context without provider detail", async () => {
    const malformed = new Request("http://localhost/api/companion/risk", {
      method: "POST",
      body: JSON.stringify({ message: "pay", signer: "server" }),
    });
    const response = await POST(malformed);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
