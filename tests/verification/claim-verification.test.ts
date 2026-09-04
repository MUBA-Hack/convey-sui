import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setClaimVerificationFactoriesForTest,
  POST,
} from "@/app/api/verify/route";
import {
  CLAIM_REPORT_REQUEST_MAX_BYTES,
  ClaimVerificationResponseSchema,
} from "@/lib/verification/claim-report";
import { readPublicClaimSource } from "@/lib/verification/public-source.server";

const MODEL_A = "gonka/model-a";
const MODEL_B = "gonka/model-b";
const SOURCE = "Independent auditors confirmed the relief fund paid for 42 water filters.";

function request(body: unknown): Request {
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function metadata(model: string, requestId: string) {
  return {
    gonkaRequestId: requestId,
    responseModel: model,
    latencyMs: 28,
    usage: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.stubEnv("GONKA_ROUTER_API_KEY", "test-key");
  vi.stubEnv("GONKA_ROUTER_BASE_URL", "https://provider.invalid/v1");
  vi.stubEnv("GONKA_VERIFY_MODEL_A", MODEL_A);
  vi.stubEnv("GONKA_VERIFY_MODEL_B", MODEL_B);
});

afterEach(() => {
  __setClaimVerificationFactoriesForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("public claim sources", () => {
  it("normalizes pasted text without a network request", async () => {
    await expect(
      readPublicClaimSource({ inputType: "text", input: "  A claim\nwith   spacing.  " }),
    ).resolves.toEqual({
      kind: "ready",
      source: { kind: "text", label: "Pasted text" },
      sourceText: "A claim with spacing.",
    });
  });

  it("rejects local and credential-bearing URLs before fetch", async () => {
    const fetchImpl = vi.fn();
    for (const input of [
      "http://127.0.0.1/admin",
      "http://localhost/secret",
      "https://user:pass@example.com/private",
      "https://example.com:8443/claim",
    ]) {
      await expect(
        readPublicClaimSource(
          { inputType: "url", input },
          { fetch: fetchImpl as unknown as typeof fetch },
        ),
      ).resolves.toEqual({ kind: "rejected", reason: "unsafe_url" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts bounded text from a public HTML source", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        "<html><head><title>Relief audit</title><script>ignore()</script></head><body><h1>Funds delivered</h1><p>42 filters reached families.</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );

    await expect(
      readPublicClaimSource(
        { inputType: "url", input: "https://reports.example.org/relief" },
        {
          fetch: fetchImpl as unknown as typeof fetch,
          lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
        },
      ),
    ).resolves.toEqual({
      kind: "ready",
      source: {
        kind: "url",
        url: "https://reports.example.org/relief",
        host: "reports.example.org",
        title: "Relief audit",
      },
      sourceText: "Relief audit Funds delivered 42 filters reached families.",
    });
  });

  it("rejects a hostname when DNS resolves to a private address", async () => {
    const fetchImpl = vi.fn();

    await expect(
      readPublicClaimSource(
        { inputType: "url", input: "https://claims.example.org/report" },
        {
          fetch: fetchImpl as unknown as typeof fetch,
          lookup: vi.fn().mockResolvedValue([{ address: "10.0.0.8", family: 4 }]),
        },
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "unsafe_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("POST /api/verify", () => {
  it("rejects malformed and oversized input before Gonka", async () => {
    const extraction = vi.fn();
    const review = vi.fn();
    __setClaimVerificationFactoriesForTest({ extraction, review });
    for (const body of ["{", "x".repeat(CLAIM_REPORT_REQUEST_MAX_BYTES + 1)]) {
      const result = await POST(request(body));
      expect(await result.json()).toEqual({ kind: "rejected", reason: "invalid_input" });
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
    expect(extraction).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("extracts once, cross-checks with two models, and exposes all request ids", async () => {
    const extraction = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue({
        type: "gonka-run-ok",
        candidate: {
          claim: { text: SOURCE, occurrence: 1 },
          claimType: "factual",
          detectedLanguage: "en",
          confidence: 0.94,
        },
        metadata: metadata(config.modelId, "request-extract"),
        attempts: [],
      }),
    }));
    const review = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue({
        type: "gonka-run-ok",
        candidate: {
          verdict: "supported",
          truthScore: config.modelId === MODEL_A ? 88 : 82,
          reasoningTrace: [
            "The sentence attributes the result to an independent audit.",
            "The exact quantity and use are stated in the supplied source.",
          ],
          evidence: [{ text: "42 water filters", occurrence: 1 }],
          limitations: ["The underlying audit document is not included."],
          confidence: 0.84,
        },
        metadata: metadata(
          config.modelId,
          config.modelId === MODEL_A ? "request-review-a" : "request-review-b",
        ),
        attempts: [],
      }),
    }));
    __setClaimVerificationFactoriesForTest({ extraction, review });

    const result = await POST(request({ inputType: "text", input: SOURCE }));
    const body: unknown = await result.json();

    expect(ClaimVerificationResponseSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      kind: "verified_report",
      truthScore: 85,
      verdict: "supported",
      consensus: { status: "aligned", scoreSpread: 6 },
      steps: [
        { step: "claim_extraction", requestId: "request-extract", modelId: MODEL_A },
        { step: "review_a", requestId: "request-review-a", modelId: MODEL_A },
        { step: "review_b", requestId: "request-review-b", modelId: MODEL_B },
      ],
    });
    expect(review.mock.calls.map(([config]) => config.modelId)).toEqual([MODEL_A, MODEL_B]);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toMatch(/test-key|provider\.invalid/i);
  });

  it("runs reviewers sequentially so provider concurrency limits cannot drop a council member", async () => {
    const events: string[] = [];
    let activeReviews = 0;
    const extraction = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue({
        type: "gonka-run-ok",
        candidate: {
          claim: { text: SOURCE, occurrence: 1 },
          claimType: "factual",
          detectedLanguage: "en",
          confidence: 0.94,
        },
        metadata: metadata(config.modelId, "request-extract"),
        attempts: [],
      }),
    }));
    const review = vi.fn((config: { modelId: string }) => ({
      run: vi.fn(async () => {
        events.push(`start:${config.modelId}`);
        activeReviews += 1;
        if (activeReviews > 1) {
          activeReviews -= 1;
          throw new Error("provider concurrency exceeded");
        }
        await Promise.resolve();
        activeReviews -= 1;
        events.push(`end:${config.modelId}`);
        return {
          type: "gonka-run-ok" as const,
          candidate: {
            verdict: "supported" as const,
            truthScore: config.modelId === MODEL_A ? 88 : 82,
            reasoningTrace: ["The source contains the claim.", "Independent proof is limited."],
            evidence: [{ text: "42 water filters", occurrence: 1 }],
            limitations: ["The audit attachment is not included."],
            confidence: 0.84,
          },
          metadata: metadata(config.modelId, `request-${config.modelId}`),
          attempts: [],
        };
      }),
    }));
    __setClaimVerificationFactoriesForTest({ extraction, review });

    const result = await POST(request({ inputType: "text", input: SOURCE }));

    expect(await result.json()).toMatchObject({ kind: "verified_report" });
    expect(events).toEqual([
      `start:${MODEL_A}`,
      `end:${MODEL_A}`,
      `start:${MODEL_B}`,
      `end:${MODEL_B}`,
    ]);
  });

  it("fails closed when the review models are not distinct", async () => {
    vi.stubEnv("GONKA_VERIFY_MODEL_B", MODEL_A);
    const extraction = vi.fn();
    const review = vi.fn();
    __setClaimVerificationFactoriesForTest({ extraction, review });

    const result = await POST(request({ inputType: "text", input: SOURCE }));

    expect(await result.json()).toEqual({ kind: "unavailable", reason: "not_configured" });
    expect(extraction).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
});
