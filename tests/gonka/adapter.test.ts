import { describe, expect, it } from "vitest";
import {
  createGonkaCommerceRouter,
  gonkaConfigFromEnv,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
} from "@/lib/gonka/adapter";
import { isGonkaRunOk, isGonkaRunErr } from "@/lib/gonka/types";
import {
  fakeFetch,
  timeoutError,
  httpErrorBody,
  validCandidateJson,
  TEST_INPUT,
  TEST_MANIFEST,
  TEST_MODEL,
  type FetchResponseSpec,
} from "./fake-fetch";

const CFG = {
  apiKey: "test-key",
  modelId: TEST_MODEL,
  timeoutMs: 5_000,
  maxRetries: 1,
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

function okSpec(content: string, requestId = "req_abc123", model = TEST_MODEL) {
  return { kind: "ok" as const, body: content, requestId, model };
}

describe("createGonkaCommerceRouter — config validation", () => {
  it("throws on empty apiKey", () => {
    expect(() => createGonkaCommerceRouter({ apiKey: "", modelId: TEST_MODEL })).toThrow();
  });
  it("throws on empty modelId", () => {
    expect(() => createGonkaCommerceRouter({ apiKey: "k", modelId: "" })).toThrow();
  });
  it("throws on non-positive timeout", () => {
    expect(() =>
      createGonkaCommerceRouter({ apiKey: "k", modelId: TEST_MODEL, timeoutMs: 0 }),
    ).toThrow();
  });
  it("throws on maxRetries outside [0,1]", () => {
    expect(() =>
      createGonkaCommerceRouter({ apiKey: "k", modelId: TEST_MODEL, maxRetries: 2 }),
    ).toThrow();
    expect(() =>
      createGonkaCommerceRouter({ apiKey: "k", modelId: TEST_MODEL, maxRetries: -1 }),
    ).toThrow();
  });
});

describe("gonkaConfigFromEnv", () => {
  it("reports not configured when key is missing/empty", () => {
    const { config, configured } = gonkaConfigFromEnv({});
    expect(configured).toBe(false);
    expect(config.apiKey).toBe("");
  });
  it("reports configured and applies defaults", () => {
    const { config, configured } = gonkaConfigFromEnv({ GONKA_ROUTER_API_KEY: "k" });
    expect(configured).toBe(true);
    expect(config.apiKey).toBe("k");
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.modelId).toBe(DEFAULT_MODEL_ID);
  });
  it("honors explicit overrides", () => {
    const { config } = gonkaConfigFromEnv({
      GONKA_ROUTER_API_KEY: "k",
      GONKA_ROUTER_BASE_URL: "https://example/v1",
      GONKA_MODEL_ID: "other/model",
      GONKA_REQUEST_TIMEOUT_MS: "12000",
      GONKA_MAX_RETRIES: "0",
    });
    expect(config.baseUrl).toBe("https://example/v1");
    expect(config.modelId).toBe("other/model");
    expect(config.timeoutMs).toBe(12_000);
    expect(config.maxRetries).toBe(0);
  });
  it("clamps invalid timeout/retries to safe defaults", () => {
    const { config } = gonkaConfigFromEnv({
      GONKA_ROUTER_API_KEY: "k",
      GONKA_REQUEST_TIMEOUT_MS: "not-a-number",
      GONKA_MAX_RETRIES: "9",
    });
    expect(config.timeoutMs).toBe(30_000);
    expect(config.maxRetries).toBe(1);
  });
});

describe("createGonkaCommerceRouter — successful run", () => {
  it("returns a valid candidate with captured metadata", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.candidate.itemId).toBe("iced-coffee");
    expect(result.candidate.quantity).toBe(2);
    expect(result.metadata.gonkaRequestId).toBe("req_abc123");
    expect(result.metadata.responseModel).toBe(TEST_MODEL);
    expect(result.metadata.usage.inputTokens).toBe(42);
    expect(result.metadata.usage.outputTokens).toBe(7);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe("SCHEMA_VALID");
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
  });
});

describe("createGonkaCommerceRouter — missing request id", () => {
  it("fails closed with MISSING_REQUEST_ID", async () => {
    const deps = DEPS([okSpec(validCandidateJson(), "")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("MISSING_REQUEST_ID");
    expect(result.attempts.at(-1)?.status).toBe("PROVIDER_ERROR");
  });
});

describe("createGonkaCommerceRouter — model mismatch", () => {
  it("fails closed with MODEL_MISMATCH when response model differs", async () => {
    const deps = DEPS([okSpec(validCandidateJson(), "req_1", "other/model")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("MODEL_MISMATCH");
  });
});

describe("createGonkaCommerceRouter — malformed/extra fields", () => {
  it("repairs once then succeeds when the first response has extra fields", async () => {
    const extra = JSON.stringify({
      ...JSON.parse(validCandidateJson()),
      extraField: "nope",
    });
    const deps = DEPS([okSpec(extra), okSpec(validCandidateJson(), "req_2")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.status).toBe("INVALID_SCHEMA");
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
    expect(result.attempts[1]?.kind).toBe("REPAIR");
    expect(result.attempts[1]?.status).toBe("SCHEMA_VALID");
  });

  it("fails closed with REPAIR_FAILED when repair output is still malformed", async () => {
    const malformed = JSON.stringify({ itemId: "iced-coffee" });
    const deps = DEPS([okSpec(malformed), okSpec(malformed, "req_2")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });
});

describe("createGonkaCommerceRouter — forbidden authority fields", () => {
  it("rejects a candidate that smuggles transaction authority via extra keys", async () => {
    const smuggled = JSON.stringify({
      ...JSON.parse(validCandidateJson()),
      recipient: "0xABC",
      transactionBytes: "deadbeef",
      digest: "xyz",
    });
    const deps = DEPS([okSpec(smuggled), okSpec(smuggled, "req_2")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });

  it("rejects a candidate whose ids were invented (not in manifest)", async () => {
    const invented = validCandidateJson({ itemId: "ghost-item", merchantId: "ghost-merchant" });
    const deps = DEPS([okSpec(invented), okSpec(invented, "req_2")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("REPAIR_FAILED");
  });
});

describe("createGonkaCommerceRouter — timeout/retry policy", () => {
  it("retries once on timeout then succeeds", async () => {
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      okSpec(validCandidateJson(), "req_after_retry"),
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
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
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("PROVIDER_ERROR");
    expect(result.attempts.filter((a) => a.status === "TIMEOUT")).toHaveLength(2);
  });

  it("retries once on 429 then succeeds", async () => {
    const deps = DEPS([
      { kind: "http", status: 429, body: httpErrorBody(429, "rate limited") },
      okSpec(validCandidateJson(), "req_after_429"),
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
  });
});

describe("createGonkaCommerceRouter — nonretryable 4xx", () => {
  it("fails closed immediately on 400 without retrying", async () => {
    const deps = DEPS([
      { kind: "http", status: 400, body: httpErrorBody(400, "bad request") },
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("PROVIDER_ERROR");
    // Only one attempt: no retry on 400.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.error?.category).toBe("HTTP_ERROR");
    expect(result.attempts[0]?.error?.httpStatus).toBe(400);
  });

  it("fails closed immediately on 401", async () => {
    const deps = DEPS([
      { kind: "http", status: 401, body: httpErrorBody(401, "unauthorized") },
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    expect(result.attempts).toHaveLength(1);
  });
});

describe("createGonkaCommerceRouter — JSON mode fallback", () => {
  it("falls back to a JSON-prompt request when response_format is unsupported", async () => {
    const unsupportedBody = httpErrorBody(
      400,
      "response_format json_object is not supported by this model",
    );
    const deps = DEPS([
      { kind: "http", status: 400, body: unsupportedBody },
      okSpec(validCandidateJson(), "req_fallback"),
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
    expect(result.attempts[0]?.status).toBe("PROVIDER_ERROR");
    expect(result.attempts[1]?.kind).toBe("JSON_PROMPT_FALLBACK");
    expect(result.attempts[1]?.status).toBe("SCHEMA_VALID");
    // The fallback request must NOT carry response_format.
    const fallbackCall = (deps as unknown as { _calls: { body: unknown }[] })._calls[1];
    expect(fallbackCall).toBeDefined();
  });

  it("preserves retry consumption: timeout->retry->400 leaves no retry budget for the fallback", async () => {
    const unsupportedBody = httpErrorBody(
      400,
      "response_format json_object is not supported by this model",
    );
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      { kind: "http", status: 400, body: unsupportedBody },
      { kind: "throw", error: timeoutError() },
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    expect(result.reason).toBe("PROVIDER_ERROR");
    // Exactly 3 fetch calls: primary timeout, primary retry 400, fallback
    // timeout (no second retry — the single retry was already consumed).
    const calls = (deps as unknown as { _calls: unknown[] })._calls;
    expect(calls).toHaveLength(3);
  });

  it("preserves retry consumption and still succeeds when the fallback responds on first attempt", async () => {
    const unsupportedBody = httpErrorBody(
      400,
      "response_format json_object is not supported by this model",
    );
    const deps = DEPS([
      { kind: "throw", error: timeoutError() },
      { kind: "http", status: 400, body: unsupportedBody },
      okSpec(validCandidateJson(), "req_fallback"),
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    const calls = (deps as unknown as { _calls: unknown[] })._calls;
    expect(calls).toHaveLength(3);
  });
});

describe("createGonkaCommerceRouter — repair", () => {
  it("repairs unparseable content into a valid candidate", async () => {
    const prose = "I am unable to produce a structured response for that request.";
    const deps = DEPS([okSpec(prose, "req_1"), okSpec(validCandidateJson(), "req_2")]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunOk(result)).toBe(true);
    if (!isGonkaRunOk(result)) return;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.kind).toBe("PRIMARY");
    expect(result.attempts[0]?.status).toBe("INVALID_SCHEMA");
    expect(result.attempts[1]?.kind).toBe("REPAIR");
    expect(result.attempts[1]?.status).toBe("SCHEMA_VALID");
  });
});

describe("createGonkaCommerceRouter — prompt excludes sensitive fields", () => {
  it("never sends wallet addresses, keys, digests, or transaction bytes in the user payload", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaCommerceRouter(CFG, deps);
    await router.run(TEST_INPUT);
    const call = (deps as unknown as { _calls: { body: unknown }[] })._calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const body = call.body as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = body.messages.find((m) => m.role === "user")?.content ?? "";
    const systemContent = body.messages.find((m) => m.role === "system")?.content ?? "";
    // The user payload (the only model input carrying catalog/prompt data) must
    // contain no secrets or transaction authority.
    expect(userContent).not.toContain("test-key");
    expect(userContent).not.toMatch(/0x[0-9a-fA-F]{32,}/);
    expect(userContent.toLowerCase()).not.toContain("transactionbytes");
    expect(userContent.toLowerCase()).not.toContain("digest");
    expect(userContent.toLowerCase()).not.toContain("signature");
    expect(userContent.toLowerCase()).not.toContain("recipient");
    // The catalog manifest must not carry merchant addresses.
    const parsedUser = JSON.parse(userContent);
    expect(JSON.stringify(parsedUser.catalog)).not.toContain("address");
    // The system prompt must explicitly forbid authority fields.
    expect(systemContent.toLowerCase()).toContain("wallet addresses");
    expect(systemContent.toLowerCase()).toContain("signatures");
    expect(systemContent.toLowerCase()).toContain("transaction commands");
  });

  it("the catalog manifest carries only public item/merchant names and prices", async () => {
    const deps = DEPS([okSpec(validCandidateJson())]);
    const router = createGonkaCommerceRouter(CFG, deps);
    await router.run(TEST_INPUT);
    const call = (deps as unknown as { _calls: { body: unknown }[] })._calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const body = call.body as { messages: Array<{ role: string; content: string }> };
    const userContent = body.messages.find((m) => m.role === "user")!.content;
    const parsed = JSON.parse(userContent);
    expect(parsed.catalog).toEqual(TEST_MANIFEST);
    for (const item of parsed.catalog.items) {
      expect(Object.keys(item).sort()).toEqual(["id", "name", "priceSui"]);
    }
    for (const merchant of parsed.catalog.merchants) {
      expect(Object.keys(merchant).sort()).toEqual(["id", "itemIds", "name"]);
    }
  });
});

describe("createGonkaCommerceRouter — error redaction", () => {
  it("never returns the API key or raw provider error body to the caller", async () => {
    const deps = DEPS([
      { kind: "http", status: 500, body: { error: { message: "internal leak: test-key" } } },
      { kind: "http", status: 500, body: { error: { message: "internal leak: test-key" } } },
    ]);
    const router = createGonkaCommerceRouter(CFG, deps);
    const result = await router.run(TEST_INPUT);
    expect(isGonkaRunErr(result)).toBe(true);
    if (!isGonkaRunErr(result)) return;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain("internal leak");
  });
});
