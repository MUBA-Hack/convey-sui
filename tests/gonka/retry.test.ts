import { describe, expect, it } from "vitest";
import {
  VisibleRetryError,
  getGonkaErrorStatus,
  isGonkaTimeoutError,
  isRetryableGonkaError,
  runWithVisibleRetry,
} from "@/lib/gonka/retry";

function errWith(status?: number, name?: string, message?: string, cause?: unknown): unknown {
  const e = new Error(message ?? "");
  if (name) e.name = name;
  if (status !== undefined) (e as { status?: number }).status = status;
  if (cause !== undefined) (e as { cause?: unknown }).cause = cause;
  return e;
}

describe("getGonkaErrorStatus", () => {
  it("reads numeric status", () => {
    expect(getGonkaErrorStatus(errWith(429))).toBe(429);
  });
  it("returns undefined for non-record or missing status", () => {
    expect(getGonkaErrorStatus("boom")).toBeUndefined();
    expect(getGonkaErrorStatus(new Error("x"))).toBeUndefined();
  });
});

describe("isGonkaTimeoutError", () => {
  it("detects AbortError by name", () => {
    expect(isGonkaTimeoutError(errWith(undefined, "AbortError"))).toBe(true);
  });
  it("detects timeout by message when status is undefined", () => {
    expect(isGonkaTimeoutError(errWith(undefined, "Error", "Request timed out."))).toBe(true);
  });
  it("does not flag a status-bearing error as timeout by message", () => {
    expect(isGonkaTimeoutError(errWith(500, "Error", "timed out"))).toBe(false);
  });
  it("walks the cause chain", () => {
    const cause = errWith(undefined, "AbortError");
    expect(isGonkaTimeoutError(errWith(undefined, "Error", "wrapper", cause))).toBe(true);
  });
});

describe("isRetryableGonkaError", () => {
  it("retries timeout, 429, and transient 5xx", () => {
    expect(isRetryableGonkaError(errWith(undefined, "AbortError"))).toBe(true);
    for (const s of [429, 500, 502, 503, 504]) {
      expect(isRetryableGonkaError(errWith(s))).toBe(true);
    }
  });
  it("does not retry 400/401/403/404", () => {
    for (const s of [400, 401, 403, 404]) {
      expect(isRetryableGonkaError(errWith(s))).toBe(false);
    }
  });
});

describe("runWithVisibleRetry", () => {
  it("returns the value on first success with one attempt", async () => {
    const result = await runWithVisibleRetry(async () => "ok", { maxRetries: 1 });
    expect(result.value).toBe("ok");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.ok).toBe(true);
  });

  it("retries once on a retryable error then succeeds", async () => {
    let calls = 0;
    const result = await runWithVisibleRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw errWith(503);
        return "ok";
      },
      { maxRetries: 1, sleep: async () => {} },
    );
    expect(result.value).toBe("ok");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.ok).toBe(false);
    expect(result.attempts[1]?.ok).toBe(true);
  });

  it("does not retry a non-retryable 4xx and throws VisibleRetryError", async () => {
    let calls = 0;
    await expect(
      runWithVisibleRetry(
        async () => {
          calls += 1;
          throw errWith(400);
        },
        { maxRetries: 1, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(VisibleRetryError);
    expect(calls).toBe(1);
  });

  it("throws after exhausting the single retry on retryable errors", async () => {
    let calls = 0;
    await expect(
      runWithVisibleRetry(
        async () => {
          calls += 1;
          throw errWith(429);
        },
        { maxRetries: 1, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(VisibleRetryError);
    expect(calls).toBe(2);
  });

  it("clamps maxRetries to at most 1", async () => {
    let calls = 0;
    await expect(
      runWithVisibleRetry(
        async () => {
          calls += 1;
          throw errWith(500);
        },
        { maxRetries: 5, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(VisibleRetryError);
    expect(calls).toBe(2);
  });
});
