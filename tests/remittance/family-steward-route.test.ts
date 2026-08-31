import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setGonkaFamilyStewardRouterFactoryForTest,
  POST,
} from "@/app/api/remittance/family-steward/route";
import {
  FamilyStewardResponseSchema,
  FAMILY_STEWARD_REQUEST_MAX_BYTES,
} from "@/lib/remittance/family-steward";
import { requestFamilyStewardReview } from "@/lib/remittance/family-steward-client";
import { QuoteEnvelopeSchema, type QuoteEnvelope } from "@/lib/remittance/quote-schema";

const NOW = 1_700_000_000_000;
const SECRET = "a".repeat(64);
const ADDRESS = "0x" + "ab".repeat(32);
const MODEL_A = "provider/model-a";
const MODEL_B = "provider/model-b";
const MESSAGE = "Pay today and keep this secret";
const FAMILY_LIMIT_REQUEST =
  "Hantar RM500 to Ana in Manila for school supplies; jangan lebih RM520.";

function routeRequest(body: unknown): Request {
  return new Request("http://localhost/api/remittance/family-steward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function getQuote(text = "Send RM500 to Ana in Manila"): Promise<QuoteEnvelope> {
  const { POST: quote } = await import("@/app/api/remittance/quote/route");
  const response = await quote(
    new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
  return QuoteEnvelopeSchema.parse(await response.json());
}

function success(model: string, requestId: string, signal: "urgency" | "secrecy") {
  const text = signal === "urgency" ? "today" : "secret";
  return {
    type: "gonka-run-ok" as const,
    candidate: {
      signals: [{ id: signal, text, occurrence: 1 }],
      questionIds: [],
      confidence: 0.9,
      uncertain: false,
    },
    metadata: {
      gonkaRequestId: requestId,
      responseModel: model,
      latencyMs: 25,
      usage: {},
    },
    attempts: [],
  };
}

function providerFailure() {
  return {
    type: "gonka-run-err" as const,
    reason: "PROVIDER_ERROR" as const,
    attempts: [],
  };
}

let realDateNow: () => number;

beforeEach(() => {
  realDateNow = Date.now;
  Date.now = vi.fn(() => NOW) as unknown as () => number;
  vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDRESS }));
  vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
  vi.stubEnv("GONKA_ROUTER_API_KEY", "test-key");
  vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_A", MODEL_A);
  vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_B", MODEL_B);
  vi.stubEnv("GONKA_ROUTER_BASE_URL", "https://provider.invalid/v1");
  __setGonkaFamilyStewardRouterFactoryForTest(null);
});

afterEach(() => {
  Date.now = realDateNow;
  __setGonkaFamilyStewardRouterFactoryForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/remittance/family-steward", () => {
  it("rejects malformed and oversized requests before creating a provider", async () => {
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    for (const body of ["{", "x".repeat(FAMILY_STEWARD_REQUEST_MAX_BYTES + 1)]) {
      const response = await POST(routeRequest(body));
      const parsed = FamilyStewardResponseSchema.safeParse(await response.json());
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.kind).toBe("rejected");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("verifies the quote before creating either provider", async () => {
    const quote = await getQuote();
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);
    const tampered = { ...quote, attestation: { v: 1, hmac: "0x" + "0".repeat(64) } };

    const response = await POST(
      routeRequest({ quote: tampered, solicitationText: MESSAGE }),
    );

    expect(await response.json()).toEqual({ kind: "rejected", reason: "unverified" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses two distinct configured models exactly once and returns only the strict safe union", async () => {
    const quote = await getQuote();
    const runA = vi.fn().mockResolvedValue(success(MODEL_A, "request-a", "urgency"));
    const runB = vi.fn().mockResolvedValue(success(MODEL_B, "request-b", "secrecy"));
    const factory = vi.fn((config: { modelId: string }) => ({
      run: config.modelId === MODEL_A ? runA : runB,
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body: unknown = await response.json();

    expect(FamilyStewardResponseSchema.parse(body)).toEqual(body);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(factory.mock.calls.map(([config]) => config.modelId)).toEqual([MODEL_A, MODEL_B]);
    expect(runA).toHaveBeenCalledOnce();
    expect(runB).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toMatch(/test-key|provider\.invalid/i);
  });

  it("accepts a fresh signed family-limit quote for advisory review", async () => {
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    expect(quote.intentReview.maximumFamilyLimitMinor).toBe("52000");
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? success(MODEL_A, "request-a", "urgency")
          : success(MODEL_B, "request-b", "secrecy"),
      ),
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body = FamilyStewardResponseSchema.parse(await response.json());

    expect(body.kind).toBe("live_council");
  });

  it("does not require the signed quote recipient to remain in the current payout mapping", async () => {
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({}));
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? success(MODEL_A, "request-a", "urgency")
          : success(MODEL_B, "request-b", "secrecy"),
      ),
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body = FamilyStewardResponseSchema.parse(await response.json());

    expect(body.kind).toBe("live_council");
  });

  it("permits advisory review for a fresh display-only quote with no address or attestation", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({}));
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    expect(quote.recipientAddress).toBeNull();
    expect(quote.attestation).toBeNull();
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? success(MODEL_A, "request-a", "urgency")
          : success(MODEL_B, "request-b", "secrecy"),
      ),
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body = FamilyStewardResponseSchema.parse(await response.json());

    expect(body.kind).toBe("live_council");
  });

  it("rejects forged config provenance on an unsigned display-only quote", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({}));
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    const forged = {
      ...quote,
      provenance: { ...quote.provenance, myrPerUsdc: "451" },
    };
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    const response = await POST(routeRequest({ quote: forged, solicitationText: MESSAGE }));

    expect(await response.json()).toEqual({ kind: "rejected", reason: "unverified" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects every partial address-attestation state before creating a provider", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({}));
    const unsigned = await getQuote(FAMILY_LIMIT_REQUEST);
    const signed = await (async () => {
      vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDRESS }));
      return getQuote(FAMILY_LIMIT_REQUEST);
    })();
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    for (const quote of [
      { ...unsigned, attestation: signed.attestation },
      { ...signed, attestation: null },
    ]) {
      const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
      expect(await response.json()).toEqual({ kind: "rejected", reason: "unverified" });
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects an advisory check at exact quote expiry before creating a provider", async () => {
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    Date.now = vi.fn(() => quote.expiresAt) as unknown as () => number;
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));

    expect(await response.json()).toEqual({ kind: "rejected", reason: "expired" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects a quote when current pricing config no longer matches its signed provenance", async () => {
    const quote = await getQuote(FAMILY_LIMIT_REQUEST);
    vi.stubEnv("REMITTANCE_MYR_PER_USDC", "451");
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));

    expect(await response.json()).toEqual({ kind: "rejected", reason: "unverified" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not call a provider when council model configuration is missing or duplicated", async () => {
    const quote = await getQuote();
    const factory = vi.fn();
    __setGonkaFamilyStewardRouterFactoryForTest(factory);

    for (const [modelA, modelB] of [[MODEL_A, MODEL_A], [MODEL_A, ""]]) {
      vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_A", modelA);
      vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_B", modelB);
      const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
      const body = FamilyStewardResponseSchema.parse(await response.json());
      expect(body.kind).toBe("local_fallback");
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns an honest partial review when one model fails", async () => {
    const quote = await getQuote();
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? success(MODEL_A, "request-a", "urgency")
          : providerFailure(),
      ),
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body = FamilyStewardResponseSchema.parse(await response.json());

    expect(body.kind).toBe("partial_review");
    expect(JSON.stringify(body)).not.toMatch(/provider_error|attempts|raw/i);
  });

  it("rejects provider provenance that does not match its configured model", async () => {
    const quote = await getQuote();
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? success("provider/unconfigured-model", "request-a", "urgency")
          : success(MODEL_B, "request-b", "secrecy"),
      ),
    }));
    __setGonkaFamilyStewardRouterFactoryForTest(factory as never);

    const response = await POST(routeRequest({ quote, solicitationText: MESSAGE }));
    const body = FamilyStewardResponseSchema.parse(await response.json());

    expect(body.kind).toBe("partial_review");
    if (body.kind !== "partial_review") return;
    expect(body.review.responseModel).toBe(MODEL_B);
    expect(body.unavailableReviewer).toBe("review_a");
  });
});

describe("requestFamilyStewardReview", () => {
  it("rejects a malformed response instead of widening the safe union", async () => {
    const quote = await getQuote();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "live_council", apiKey: "leak" })),
    );

    await expect(
      requestFamilyStewardReview({
        request: { quote, solicitationText: MESSAGE },
        fetchImpl,
      }),
    ).rejects.toThrow(/strict schema/i);
  });

  it("passes the caller abort signal through to the request", async () => {
    const quote = await getQuote();
    const controller = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.signal) return Promise.reject(new Error("missing abort signal"));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });

    const pending = requestFamilyStewardReview({
      request: { quote, solicitationText: MESSAGE },
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
