import { describe, expect, it } from "vitest";
import { createGonkaCompanionRouter } from "@/lib/gonka/companion";
import { fakeFetch } from "./fake-fetch";

const MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";

const INPUT = {
  message: "Pay Dave 12 USDC for dinner",
  prompt: "Pay Dave 12 USDC for dinner",
  localeHint: "en",
  workspaceId: "ngo" as const,
  organization: {
    id: "river-aid-1",
    name: "River Aid",
    kind: "ngo" as const,
    memberRole: "owner" as const,
  },
  memory: {
    version: "convey.companion-memory.v1" as const,
    ownerLabel: null,
    contacts: [
      {
        id: "sample-dave",
        displayName: "Dave",
        aliases: [],
        relationshipLabel: "friend",
        address: `0x${"1".repeat(64)}`,
        previousAddress: null,
        confirmation: "confirmed" as const,
        confirmedAt: 1_700_000_000_000,
      },
    ],
    interactions: [],
  },
};

describe("Gonka companion prompt contract", () => {
  it("gives the model the exact closed JSON shape and parses a valid candidate", async () => {
    const candidate = {
      toolId: "payments.propose",
      contactId: "sample-dave",
      contactRef: "Dave",
      amountMajor: "12",
      asset: "USDC",
      purpose: "dinner",
      missingFields: [],
      confidence: 0.98,
      explanation: "Confirmed payment proposal.",
    };
    const transport = fakeFetch([
      { kind: "ok", body: JSON.stringify(candidate), requestId: "req_companion_1", model: MODEL },
    ]);
    const router = createGonkaCompanionRouter(
      { apiKey: "test", modelId: MODEL, timeoutMs: 5_000, maxRetries: 0 },
      { fetch: transport.fetch as unknown as typeof fetch, now: () => 1_700_000_000_000 },
    );

    const result = await router.run(INPUT);

    expect(result.type).toBe("gonka-run-ok");
    const request = transport.calls[0]?.body as {
      messages?: Array<{ role: string; content: string }>;
    };
    const system = request.messages?.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain('"missingFields"');
    expect(system).toContain('"confidence"');
    expect(system).toContain("Return exactly one JSON object");
    const user = request.messages?.find((message) => message.role === "user")?.content ?? "";
    expect(JSON.parse(user)).toMatchObject({
      memory: {
        workspace: {
          id: "ngo",
          label: "River Aid",
          role: "NGO operations",
          organization: {
            id: "river-aid-1",
            name: "River Aid",
            kind: "ngo",
            memberRole: "owner",
          },
        },
      },
    });
  });
});
