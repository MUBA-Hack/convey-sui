import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setGonkaRouterFactoryForTest,
  type GonkaRouterFactory,
} from "@/app/api/commerce/intent/route";
import type {
  GonkaCommerceRouter,
  GonkaIntentCandidate,
  GonkaRunResult,
  GonkaTokenUsage,
} from "@/lib/gonka/types";

const GOLDEN = "Buy two iced coffees under 8 SUI from River Cafe";

/** Build a GonkaRunOk with actual adapter shapes. */
function okResult(
  candidate: GonkaIntentCandidate,
  opts: {
    requestId?: string;
    responseModel?: string;
    latencyMs?: number;
    usage?: GonkaTokenUsage;
  } = {},
): Extract<GonkaRunResult, { type: "gonka-run-ok" }> {
  return {
    type: "gonka-run-ok",
    candidate,
    metadata: {
      gonkaRequestId: opts.requestId ?? "req_abc123",
      responseModel: opts.responseModel ?? "deepseek-ai/DeepSeek-V4-Flash-0731",
      latencyMs: opts.latencyMs ?? 420,
      usage: opts.usage ?? { inputTokens: 42, outputTokens: 7 },
    },
    attempts: [
      {
        type: "gonka-attempt",
        kind: "PRIMARY",
        status: "SCHEMA_VALID",
        requestedAtMs: 1_700_000_000_000,
        completedAtMs: 1_700_000_000_420,
        latencyMs: 420,
        gonkaRequestId: opts.requestId ?? "req_abc123",
        responseModel: opts.responseModel ?? "deepseek-ai/DeepSeek-V4-Flash-0731",
        usage: opts.usage ?? { inputTokens: 42, outputTokens: 7 },
      },
    ],
  };
}

/** Build a GonkaRunErr with actual adapter shapes. */
function errResult(
  reason: Extract<GonkaRunResult, { type: "gonka-run-err" }>["reason"],
  attempts: Extract<GonkaRunResult, { type: "gonka-run-err" }>["attempts"] = [],
): Extract<GonkaRunResult, { type: "gonka-run-err" }> {
  return { type: "gonka-run-err", reason, attempts };
}

/** A candidate that matches the golden prompt against catalog truth. */
function goldenCandidate(overrides: Partial<GonkaIntentCandidate> = {}): GonkaIntentCandidate {
  return {
    itemId: "iced-coffee",
    itemName: "Iced Coffee",
    merchantId: "river-cafe",
    merchantName: "River Cafe",
    quantity: 2,
    maxSpendSui: "8",
    detectedLanguage: "en",
    explanation: "User asked for two iced coffees from River Cafe.",
    confidence: 0.95,
    ...overrides,
  };
}

/** Build a fake router factory that returns a fixed run result. */
function fakeRouterFactory(result: GonkaRunResult): GonkaRouterFactory {
  return () => {
    const router: GonkaCommerceRouter = {
      run: vi.fn(async () => result),
    };
    return router;
  };
}

/** Build a fake router factory whose router captures the input it received. */
function capturingFactory(
  result: GonkaRunResult,
  captured: { prompt?: string; localeHint?: string; catalog?: unknown },
): GonkaRouterFactory {
  return () => {
    const router: GonkaCommerceRouter = {
      run: vi.fn(async (input) => {
        captured.prompt = input.prompt;
        captured.localeHint = input.localeHint;
        captured.catalog = input.catalog;
        return result;
      }),
    };
    return router;
  };
}

function postReq(text: string, locale?: string): Request {
  const body = locale ? { text, locale } : { text };
  return new Request("http://localhost/api/commerce/intent", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // Ensure no real GonkaRouter API key is present so the only way to reach the
  // live path is the test-injected factory. No network calls are made.
  vi.stubEnv("GONKA_ROUTER_API_KEY", "");
  __setGonkaRouterFactoryForTest(null);
});

afterEach(() => {
  __setGonkaRouterFactoryForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Missing config → deterministic fallback (honest, no Gonka implication)
// ---------------------------------------------------------------------------

describe("POST /api/commerce/intent — missing config fallback", () => {
  it("returns the deterministic preview with routing provider=deterministic, mode=fallback, reason=not_configured", async () => {
    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("iced-coffee");
    expect(body.routing.provider).toBe("deterministic");
    expect(body.routing.mode).toBe("fallback");
    expect(body.routing.fallbackReason).toBe("not_configured");
    // Fallback must NOT imply Gonka ran.
    expect(body.routing.requestId).toBeUndefined();
    expect(body.routing.responseModel).toBeUndefined();
  });

  it("returns a deterministic clarification with fallback routing for a missing-quantity prompt", async () => {
    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq("Buy iced coffee from River Cafe"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("missing_quantity");
    expect(body.routing.provider).toBe("deterministic");
    expect(body.routing.mode).toBe("fallback");
  });

  it("preserves the original submitted message exactly (no prompt drift)", async () => {
    const { POST } = await import("@/app/api/commerce/intent/route");
    const weird = "  Buy  TWO  iced coffees  under 8 SUI from River Cafe  ";
    const res = await POST(postReq(weird));
    const body = await res.json();
    // The deterministic parser normalizes internally but the route must not
    // mutate the input; the response is derived from the original text. The
    // routing metadata has no `prompt` field, and the preview reflects the
    // original intent (2 iced coffees, river-cafe, 8 SUI cap).
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("iced-coffee");
    expect(body.quantity).toBe(2);
    expect(body.merchant.id).toBe("river-cafe");
  });
});

// ---------------------------------------------------------------------------
// Configured success via the injected router seam (no network calls)
// ---------------------------------------------------------------------------

describe("POST /api/commerce/intent — configured Gonka success", () => {
  it("routes the original prompt to Gonka and returns a live-routed preview + metadata", async () => {
    const captured: { prompt?: string; localeHint?: string; catalog?: unknown } = {};
    __setGonkaRouterFactoryForTest(
      capturingFactory(okResult(goldenCandidate()), captured),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN, "en"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("iced-coffee");
    expect(body.quantity).toBe(2);
    expect(body.routing.provider).toBe("gonkarouter");
    expect(body.routing.mode).toBe("live");
    expect(body.routing.requestId).toBe("req_abc123");
    expect(body.routing.responseModel).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(body.routing.requestedModel).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(body.routing.latencyMs).toBe(420);
    expect(body.routing.usage.inputTokens).toBe(42);
    expect(body.routing.usage.outputTokens).toBe(7);
    expect(body.routing.detectedLanguage).toBe("en");
    expect(body.routing.confidence).toBe(0.95);
    expect(body.routing.explanation).toContain("two iced coffees");
  });

  it("passes the ORIGINAL prompt and a bounded public catalog manifest to the router", async () => {
    const captured: { prompt?: string; localeHint?: string; catalog?: unknown } = {};
    __setGonkaRouterFactoryForTest(
      capturingFactory(okResult(goldenCandidate()), captured),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    await POST(postReq(GOLDEN, "fr"));

    expect(captured.prompt).toBe(GOLDEN);
    expect(captured.localeHint).toBe("fr");
    // The manifest carries only public item/merchant names + prices.
    const catalog = captured.catalog as {
      merchants: Array<{ id: string; name: string; itemIds: string[] }>;
      items: Array<{ id: string; name: string; priceSui: string }>;
    };
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain("address");
    expect(serialized).not.toContain("priceMist");
    for (const item of catalog.items) {
      expect(Object.keys(item).sort()).toEqual(["id", "name", "priceSui"]);
    }
    for (const merchant of catalog.merchants) {
      expect(Object.keys(merchant).sort()).toEqual(["id", "itemIds", "name"]);
    }
  });

  it("defaults the locale hint to 'en' when no locale is supplied", async () => {
    const captured: { prompt?: string; localeHint?: string; catalog?: unknown } = {};
    __setGonkaRouterFactoryForTest(
      capturingFactory(okResult(goldenCandidate()), captured),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    await POST(postReq(GOLDEN));
    expect(captured.localeHint).toBe("en");
  });

  it("the live preview total is derived from catalog truth, not model truth", async () => {
    // Model claims maxSpendSui 8 but the catalog truth is 3 SUI/unit * 2 = 6 SUI.
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(okResult(goldenCandidate({ maxSpendSui: "8" }))),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.unitPriceMist).toBe("3000000000");
    expect(body.totalMist).toBe("6000000000");
    expect(body.priceCeilingMist).toBe("8000000000");
  });

  it("never returns transaction bytes, recipients, digests, or signatures", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(okResult(goldenCandidate())));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    const json = JSON.stringify(body);
    expect(json).not.toContain("txBytes");
    expect(json).not.toContain("signature");
    expect(json).not.toContain("transactionBytes");
    expect(json.toLowerCase()).not.toContain('"recipient"');
  });

  it("never exposes the API key or raw provider error in the response", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(okResult(goldenCandidate())));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const json = JSON.stringify(await res.json());
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("apiKey");
    expect(json).not.toMatch(/GONKA_ROUTER_API_KEY/i);
  });
});

// ---------------------------------------------------------------------------
// Provider failure / integrity failure → deterministic fallback
// ---------------------------------------------------------------------------

describe("POST /api/commerce/intent — provider failure fallback", () => {
  it("falls back on PROVIDER_ERROR with reason=provider_error", async () => {
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(
        errResult("PROVIDER_ERROR", [
          {
            type: "gonka-attempt",
            kind: "PRIMARY",
            status: "PROVIDER_ERROR",
            requestedAtMs: 1,
            completedAtMs: 2,
            latencyMs: 1,
            error: { category: "HTTP_ERROR", httpStatus: 500 },
          },
        ]),
      ),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("iced-coffee");
    expect(body.routing.provider).toBe("deterministic");
    expect(body.routing.mode).toBe("fallback");
    expect(body.routing.fallbackReason).toBe("provider_error");
  });

  it("falls back on timeout with reason=timeout (honest timeout label)", async () => {
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(
        errResult("PROVIDER_ERROR", [
          {
            type: "gonka-attempt",
            kind: "PRIMARY",
            status: "TIMEOUT",
            requestedAtMs: 1,
            completedAtMs: 2,
            latencyMs: 1,
            error: { category: "TIMEOUT" },
          },
        ]),
      ),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("timeout");
  });

  it("falls back on MODEL_MISMATCH with reason=model_mismatch", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(errResult("MODEL_MISMATCH")));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("model_mismatch");
  });

  it("falls back on MISSING_REQUEST_ID with reason=missing_request_id", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(errResult("MISSING_REQUEST_ID")));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("missing_request_id");
  });

  it("falls back on INVALID_SCHEMA with reason=invalid_schema", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(errResult("INVALID_SCHEMA")));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("invalid_schema");
  });

  it("falls back on REPAIR_FAILED with reason=repair_failed", async () => {
    __setGonkaRouterFactoryForTest(fakeRouterFactory(errResult("REPAIR_FAILED")));

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("repair_failed");
  });

  it("falls back when the router seam throws unexpectedly (fail closed)", async () => {
    __setGonkaRouterFactoryForTest(
      () =>
        ({
          run: async () => {
            throw new Error("unexpected seam blowup leaking test-key");
          },
        }) as GonkaCommerceRouter,
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.kind).toBe("preview");
    expect(body.routing.provider).toBe("deterministic");
    expect(body.routing.fallbackReason).toBe("provider_error");
    // The raw error text must NOT leak.
    const json = JSON.stringify(body);
    expect(json).not.toContain("seam blowup");
    expect(json).not.toContain("test-key");
  });
});

// ---------------------------------------------------------------------------
// Candidate policy rejection → deterministic fallback
// ---------------------------------------------------------------------------

describe("POST /api/commerce/intent — candidate rejection fallback", () => {
  it("rejects an unknown itemId candidate and falls back to deterministic", async () => {
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(
        okResult(goldenCandidate({ itemId: "ghost-item", itemName: "Ghost" })),
      ),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    // The deterministic parser still resolves the golden prompt.
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("iced-coffee");
    expect(body.routing.provider).toBe("deterministic");
    expect(body.routing.fallbackReason).toBe("candidate_rejected");
  });

  it("rejects an item_merchant_mismatch candidate and falls back", async () => {
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(
        okResult(goldenCandidate({ itemId: "croissant", itemName: "Croissant" })),
      ),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq("Buy two croissants from Harbor Bakery"));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("candidate_rejected");
    // Deterministic fallback resolves the croissant from Harbor Bakery.
    expect(body.kind).toBe("preview");
    expect(body.item.id).toBe("croissant");
    expect(body.merchant.id).toBe("harbor-bakery");
  });

  it("rejects a price_ceiling_exceeded candidate and falls back", async () => {
    // Candidate says maxSpendSui 5 but 2 iced coffees cost 6 SUI.
    __setGonkaRouterFactoryForTest(
      fakeRouterFactory(okResult(goldenCandidate({ maxSpendSui: "5" }))),
    );

    const { POST } = await import("@/app/api/commerce/intent/route");
    const res = await POST(postReq(GOLDEN));
    const body = await res.json();
    expect(body.routing.fallbackReason).toBe("candidate_rejected");
  });
});

// ---------------------------------------------------------------------------
// All three canned examples resolve via the API (fallback path, no env key)
// ---------------------------------------------------------------------------

describe("POST /api/commerce/intent — all three canned examples resolve (fallback)", () => {
  const CANNED = [
    {
      label: "Two iced coffees",
      command: "Buy two iced coffees under 8 SUI from River Cafe",
      expectItem: "iced-coffee",
      expectMerchant: "river-cafe",
      expectQuantity: 2,
    },
    {
      label: "Lunch bowl",
      command: "Order one lunch bowl under 12 SUI from Green Kitchen",
      expectItem: "lunch-bowl",
      expectMerchant: "green-kitchen",
      expectQuantity: 1,
    },
    {
      label: "Three cold brews",
      command: "Get three cold brews under 6 SUI from Daybreak Coffee",
      expectItem: "cold-brew",
      expectMerchant: "daybreak-coffee",
      expectQuantity: 3,
    },
  ];

  it.each(CANNED)(
    "$label: API returns a 200 preview with displayed merchant/item/qty and fallback routing",
    async (ex) => {
      const { POST } = await import("@/app/api/commerce/intent/route");
      const res = await POST(postReq(ex.command));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.kind).toBe("preview");
      expect(body.item.id).toBe(ex.expectItem);
      expect(body.merchant.id).toBe(ex.expectMerchant);
      expect(body.quantity).toBe(ex.expectQuantity);
      expect(BigInt(body.totalMist) <= BigInt(body.priceCeilingMist)).toBe(true);
      expect(body.routing.provider).toBe("deterministic");
      expect(body.routing.mode).toBe("fallback");
    },
  );
});

// ---------------------------------------------------------------------------
// GET status endpoint — secret-free configured-state proof
// ---------------------------------------------------------------------------

describe("GET /api/commerce/intent — secret-free status", () => {
  it("reports not configured and never reveals the API key", async () => {
    vi.stubEnv("GONKA_ROUTER_API_KEY", "");
    const { GET } = await import("@/app/api/commerce/intent/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gonkaConfigured).toBe(false);
    expect(body.liveRouteReady).toBe(false);
    expect(typeof body.requestedModel).toBe("string");
    const json = JSON.stringify(body);
    expect(json).not.toContain("api_key");
    expect(json).not.toMatch(/GONKA_ROUTER_API_KEY/i);
  });

  it("reports configured when a key is present, without leaking the key", async () => {
    vi.stubEnv("GONKA_ROUTER_API_KEY", "super-secret-key-value");
    const { GET } = await import("@/app/api/commerce/intent/route");
    const res = await GET();
    const body = await res.json();
    expect(body.gonkaConfigured).toBe(true);
    expect(body.liveRouteReady).toBe(true);
    const json = JSON.stringify(body);
    expect(json).not.toContain("super-secret-key-value");
  });
});
