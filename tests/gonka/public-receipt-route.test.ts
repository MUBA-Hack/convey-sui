import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/companion/receipt/verify/route";

const publicReceipt = {
  x_request_id: "req-1788163015848361746-40652",
  x_devshard_id: "67670",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731",
  created_at: "2026-08-31T07:57:46Z",
  outcome: "success",
  status_code: 200,
  stream: true,
  total_tokens: 34064,
  ttft_ms: 15650,
  duration_ms: 50920,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/companion/receipt/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST companion public receipt verification", () => {
  it("does one fixed-host no-store read and returns matched public metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(publicReceipt), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(
      request({ requestId: publicReceipt.x_request_id, expectedModel: publicReceipt.model }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      kind: "verified",
      receipt: {
        requestId: publicReceipt.x_request_id,
        model: publicReceipt.model,
        nodeId: publicReceipt.x_devshard_id,
        timestamp: publicReceipt.created_at,
        outcome: publicReceipt.outcome,
        statusCode: publicReceipt.status_code,
        stream: publicReceipt.stream,
        totalTokens: publicReceipt.total_tokens,
        ttftMs: publicReceipt.ttft_ms,
        durationMs: publicReceipt.duration_ms,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.gonkarouter.io/v1/receipts/${publicReceipt.x_request_id}`,
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns mismatch when the public model differs from expected provenance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(publicReceipt), { status: 200 })),
    );
    const response = await POST(
      request({ requestId: publicReceipt.x_request_id, expectedModel: "another/model" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "mismatch",
      fields: ["model"],
    });
  });

  it("returns not_found for a 404 without leaking provider text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("provider says internal account 123", { status: 404 })),
    );
    const response = await POST(
      request({ requestId: publicReceipt.x_request_id, expectedModel: publicReceipt.model }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "not_found" });
  });

  it.each([
    ["rate limit", new Response("quota for secret tenant", { status: 429 })],
    ["provider error", new Response("upstream stack trace", { status: 500 })],
    ["malformed body", new Response(JSON.stringify({ ...publicReceipt, prompt: "secret" }))],
  ])("maps %s to a safe unavailable result", async (_name, providerResponse) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse));
    const response = await POST(
      request({ requestId: publicReceipt.x_request_id, expectedModel: publicReceipt.model }),
    );
    const body = await response.json();
    expect(body).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/quota|secret|stack|prompt/i);
  });

  it("rejects malformed, extra, and oversized requests before any provider read", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    for (const body of [
      { requestId: "../chat", expectedModel: publicReceipt.model },
      { requestId: publicReceipt.x_request_id, expectedModel: publicReceipt.model, url: "https://evil.test" },
      { requestId: publicReceipt.x_request_id, expectedModel: "x".repeat(129) },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ kind: "unavailable" });
    }
    const oversized = new Request("http://localhost/api/companion/receipt/verify", {
      method: "POST",
      body: JSON.stringify({
        requestId: publicReceipt.x_request_id,
        expectedModel: publicReceipt.model,
        padding: "x".repeat(17_000),
      }),
    });
    expect((await POST(oversized)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps network failures to unavailable and never retries", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("DNS included secret-host"));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await POST(
      request({ requestId: publicReceipt.x_request_id, expectedModel: publicReceipt.model }),
    );
    expect(await response.json()).toEqual({ kind: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
