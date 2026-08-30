import { describe, expect, it } from "vitest";
import {
  createGonkaRemittanceRouter,
  type GonkaRemittanceInput,
  type GonkaRemittanceManifest,
} from "@/lib/gonka/remittance";
import { isGonkaRunOk, isGonkaRunErr } from "@/lib/gonka/types";
import {
  fakeFetch,
  timeoutError,
  httpErrorBody,
  type FetchResponseSpec,
} from "./fake-fetch";

const TEST_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";

const CFG = {
  apiKey: "test-key",
  modelId: TEST_MODEL,
  timeoutMs: 5_000,
  maxRetries: 1,
};

const TEST_MANIFEST: GonkaRemittanceManifest = {
  recipients: [
    { alias: "Ana", destinationCities: ["Manila"], destinationCountry: "Philippines" },
    { alias: "Maria", destinationCities: ["Cebu", "Quezon City"], destinationCountry: "Philippines" },
  ],
  corridor: {
    source: "MYR",
    destination: "PHP",
    destinationCountry: "Philippines",
    destinationCities: ["manila", "cebu", "quezon city"],
  },
};

const GOLDEN_PROMPT = "Hantar RM500 to Ana for school supplies; jangan lebih RM520.";

const TEST_INPUT: GonkaRemittanceInput = {
  prompt: GOLDEN_PROMPT,
  localeHint: "ms",
  manifest: TEST_MANIFEST,
};

const DEPS = (specs: FetchResponseSpec[]) => {
  const ff = fakeFetch(specs);
  return {
    fetch: ff.fetch as unknown as typeof fetch,
    now: () => 1_700_000_000_000,
    random: () => 0,
    sleep: async () => {},
    _calls: ff.calls,
  };
};

function okSpec(content: string, requestId = "req_rem_1", model = TEST_MODEL) {
  return { kind: "ok" as const, body: content, requestId, model };
}

function validCandidateJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    recipientAlias: "Ana",
    destinationCity: "Manila",
    destinationCountry: "Philippines",
    sendAmountMyr: "500",
    purpose: "school supplies",
    maxAmountMyr: "520",
    detectedLanguage: "ms",
    explanation: "User wants to send RM500 to Ana in Manila for school supplies.",
    confidence: 0.92,
    uncertain: false,
    needsReview: false,
    ...overrides,
  });
}

describe("createGonkaRemittanceRouter — config validation", () => {
  it("throws on empty apiKey", () => {
    expect(() => createGonkaRemittanceRouter({ apiKey: "", modelId: TEST_MODEL })).toThrow();
  });
  it("throws on empty modelId", () => {
    expect(() => createGonkaRemittanceRouter({ apiKey: "k", modelId: "" })).toThrow();
  });
  it("throws on maxRetries outside [0,1]", () => {
    expect(() =>
      createGonkaRemittanceRouter({ apiKey: "k", modelId: TEST_MODEL, maxRetries: 2 }),
    ).toThrow();
  });
});

describe("createGonkaRemittanceRouter — successful run", () => {
  it("returns a valid candidate with captured metadata", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.candidate.recipientAlias).toBe("Ana");
    expect(result.candidate.sendAmountMyr).toBe("500");
    expect(result.candidate.purpose).toBe("school supplies");
    expect(result.candidate.maxAmountMyr).toBe("520");
    expect(result.candidate.uncertain).toBe(false);
    expect(result.metadata.gonkaRequestId).toBe("req_rem_1");
    expect(result.metadata.responseModel).toBe(TEST_MODEL);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe("SCHEMA_VALID");
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
  });
});

describe("createGonkaRemittanceRouter — missing request id", () => {
  it("fails closed with MISSING_REQUEST_ID", async () => {
    const deps = DEPS([okSpec(validCandidateJson(), "")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("MISSING_REQUEST_ID");
  });
});

describe("createGonkaRemittanceRouter — model mismatch", () => {
  it("fails closed with MODEL_MISMATCH when response model differs", async () => {
    const deps = DEPS([okSpec(validCandidateJson(), "req_1", "other/model")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("MODEL_MISMATCH");
  });
});

describe("createGonkaRemittanceRouter — forbidden authority fields", () => {
  it("rejects a candidate that smuggles wallet/transaction/digest extras", async () => {
    const smuggled = JSON.stringify({
      ...JSON.parse(validCandidateJson()),
      walletAddress: "0xABC",
      transactionBytes: "deadbeef",
      digest: "xyz",
    });
    const deps = DEPS([okSpec(smuggled), okSpec(smuggled, "req_2")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });

  it("rejects a candidate whose recipient was invented (not in manifest)", async () => {
    const invented = validCandidateJson({ recipientAlias: "Ghost" });
    const deps = DEPS([okSpec(invented), okSpec(invented, "req_2")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });
});

describe("createGonkaRemittanceRouter — repair", () => {
  it("repairs unparseable prose into a valid candidate", async () => {
    const prose = "I cannot structure that remittance request.";
    const deps = DEPS([okSpec(prose, "req_1"), okSpec(validCandidateJson(), "req_2")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.status).toBe("INVALID_SCHEMA");
    expect(result.attempts[1]?.kind).toBe("REPAIR");
    expect(result.attempts[1]?.status).toBe("SCHEMA_VALID");
  });

  it("fails closed with REPAIR_FAILED when repair output is still malformed", async () => {
    const malformed = JSON.stringify({ recipientAlias: "Ana" });
    const deps = DEPS([okSpec(malformed), okSpec(malformed, "req_2")]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });
});

describe("createGonkaRemittanceRouter — timeout/retry policy", () => {
  it("retries once on timeout then succeeds", async () => {
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      okSpec(validCandidateJson(), "req_after_retry"),
    ]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.status).toBe("TIMEOUT");
    expect(result.attempts[1]?.kind).toBe("RETRY");
  });

  it("fails closed after a single retry on persistent timeout", async () => {
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      { kind: "throw", error: timeoutError() },
    ]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("PROVIDER_ERROR");
    expect(result.attempts.filter((a) => a.status === "TIMEOUT")).toHaveLength(2);
  });

  it("does not retry the repair after a successful retry consumed the budget", async () => {
    const malformed = "I cannot structure that remittance request.";
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      okSpec(malformed, "req_after_retry"),
      { kind: "throw", error: timeoutError() },
    ]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
    const calls = (deps as unknown as { _calls: unknown[] })._calls;
    expect(calls).toHaveLength(3);
    const repairTimeouts = result.attempts.filter(
      (a) => a.kind === "REPAIR" && a.status === "TIMEOUT",
    );
    expect(repairTimeouts).toHaveLength(1);
    expect(result.attempts.some((a) => a.kind === "RETRY" && a.status === "TIMEOUT")).toBe(false);
  });
});

describe("createGonkaRemittanceRouter — JSON mode fallback", () => {
  it("falls back to a JSON-prompt request when response_format is unsupported", async () => {
    const unsupportedBody = httpErrorBody(
      400,
      "response_format json_object is not supported by this model",
    );
    const deps = DEPS([
      { kind: "http", status: 400, body: unsupportedBody },
      okSpec(validCandidateJson(), "req_fallback"),
    ]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
    expect(result.attempts[1]?.kind).toBe("JSON_PROMPT_FALLBACK");
    expect(result.attempts[1]?.status).toBe("SCHEMA_VALID");
  });
});

describe("createGonkaRemittanceRouter — prompt excludes sensitive fields", () => {
  it("never sends wallet addresses, account refs, keys, or transaction bytes", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    await router.run(TEST_INPUT);
    const call = (deps as unknown as { _calls: { body: unknown }[] })._calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const body = call.body as { messages: Array<{ role: string; content: string }> };
    const userContent = body.messages.find((m) => m.role === "user")?.content ?? "";
    const systemContent = body.messages.find((m) => m.role === "system")?.content ?? "";
    expect(userContent).not.toContain("test-key");
    expect(userContent).not.toMatch(/0x[0-9a-fA-F]{32,}/);
    expect(userContent.toLowerCase()).not.toContain("walletaddress");
    expect(userContent.toLowerCase()).not.toContain("accountref");
    expect(userContent.toLowerCase()).not.toContain("transactionbytes");
    expect(userContent.toLowerCase()).not.toContain("digest");
    expect(userContent.toLowerCase()).not.toContain("signature");
    const parsedUser = JSON.parse(userContent);
    expect(JSON.stringify(parsedUser.manifest)).not.toContain("address");
    expect(JSON.stringify(parsedUser.manifest)).not.toContain("account");
    expect(systemContent.toLowerCase()).toContain("wallet addresses");
    expect(systemContent.toLowerCase()).toContain("signatures");
  });

  it("the manifest carries only public aliases, cities, and country", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    await router.run(TEST_INPUT);
    const call = (deps as unknown as { _calls: { body: unknown }[] })._calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const body = call.body as { messages: Array<{ role: string; content: string }> };
    const userContent = body.messages.find((m) => m.role === "user")!.content;
    const parsed = JSON.parse(userContent);
    expect(parsed.manifest).toEqual(TEST_MANIFEST);
    for (const r of parsed.manifest.recipients) {
      expect(Object.keys(r).sort()).toEqual(["alias", "destinationCities", "destinationCountry"]);
    }
  });
});

describe("createGonkaRemittanceRouter — error redaction", () => {
  it("never returns the API key or raw provider error body", async () => {
    const deps = DEPS([
      { kind: "http", status: 500, body: { error: { message: "internal leak: test-key" } } },
      { kind: "http", status: 500, body: { error: { message: "internal leak: test-key" } } },
    ]);
    const router = createGonkaRemittanceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain("internal leak");
  });
});
