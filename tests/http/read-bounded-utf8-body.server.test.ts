import { describe, expect, it } from "vitest";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";

/**
 * readBoundedUtf8Body — exhaustive transport-policy table.
 *
 * This suite is the single owner of the streamed-body transport contract:
 * Content-Length grammar, declared/actual byte equality, byte cap, read/cancel
 * rejection handling, UTF-8 fatality, missing body, and programmer maxBytes
 * misuse. Route suites rely on this coverage and keep only one representative
 * endpoint-specific transport propagation case.
 */

const MAX = 16;

function request(
  body: string | null,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: body === null ? undefined : body,
    headers,
  });
}

/** Build a Request whose body is a ReadableStream with the given controller hooks. */
function streamRequest(
  start: (controller: ReadableStreamController<Uint8Array>) => void,
  headers: Record<string, string> = {},
  cancel?: () => void,
): Request {
  const stream = new ReadableStream<Uint8Array>({ start, cancel });
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: stream,
    headers,
    // @ts-expect-error: duplex is a non-standard but widely supported flag
    duplex: "half",
  });
}

describe("readBoundedUtf8Body — success", () => {
  it("returns the exact string at the exact cap", async () => {
    const payload = "x".repeat(MAX);
    const res = await readBoundedUtf8Body(request(payload), MAX);
    expect(res).toBe(payload);
  });

  it("returns the exact string for an honest declared length", async () => {
    const payload = "hello";
    const res = await readBoundedUtf8Body(
      request(payload, { "content-length": String(payload.length) }),
      MAX,
    );
    expect(res).toBe(payload);
  });

  it("returns the exact string for a multi-byte UTF-8 body", async () => {
    const payload = "héllo";
    const res = await readBoundedUtf8Body(request(payload), MAX);
    expect(res).toBe(payload);
  });
});

describe("readBoundedUtf8Body — missing body", () => {
  it("returns null when req.body is absent", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST" });
    const res = await readBoundedUtf8Body(req, MAX);
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — invalid UTF-8", () => {
  it("returns null for invalid UTF-8 bytes", async () => {
    const res = await readBoundedUtf8Body(
      streamRequest((controller) => {
        controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]));
        controller.close();
      }),
      MAX,
    );
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — declared Content-Length grammar", () => {
  it.each([
    ["empty", ""],
    ["signed", "+5"],
    ["negative", "-1"],
    ["exponent", "1e3"],
    ["decimal", "1.0"],
    ["leading whitespace", " 5"],
    ["trailing whitespace", "5 "],
    ["inner whitespace", "5 5"],
    ["unsafe integer", "9007199254740993"],
    ["over-cap", String(MAX + 1)],
  ])("rejects malformed/over-cap declared length %s before reading", async (_label, header) => {
    const res = await readBoundedUtf8Body(
      request("x".repeat(3), { "content-length": header }),
      MAX,
    );
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — declared/actual mismatch", () => {
  it("rejects a declared length smaller than actual bytes", async () => {
    const res = await readBoundedUtf8Body(
      request("hello", { "content-length": "3" }),
      MAX,
    );
    expect(res).toBeNull();
  });

  it("rejects a declared length larger than actual bytes", async () => {
    const res = await readBoundedUtf8Body(
      request("hello", { "content-length": "6" }),
      MAX,
    );
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — actual byte cap", () => {
  it("rejects actual streamed bytes over the cap and observes cancellation", async () => {
    let cancelled = false;
    // Leave the stream open (no close()) so reader.cancel() is meaningful and
    // the cancel callback fires.
    const res = await readBoundedUtf8Body(
      streamRequest(
        (controller) => {
          controller.enqueue(new Uint8Array(MAX + 1));
        },
        {},
        () => {
          cancelled = true;
        },
      ),
      MAX,
    );
    expect(res).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("still returns null when reader.cancel() rejects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX + 1));
      },
      cancel() {
        throw new Error("cancel rejected");
      },
    });
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: stream,
      // @ts-expect-error: duplex is a non-standard but widely supported flag
      duplex: "half",
    });
    const res = await readBoundedUtf8Body(req, MAX);
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — read rejection", () => {
  it("returns null when reader.read() rejects", async () => {
    // Error the stream via the controller so read() rejects with this error
    // rather than throwing synchronously during stream construction.
    const res = await readBoundedUtf8Body(
      streamRequest((controller) => {
        controller.error(new Error("read rejected"));
      }),
      MAX,
    );
    expect(res).toBeNull();
  });
});

describe("readBoundedUtf8Body — programmer maxBytes misuse", () => {
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("throws RangeError for maxBytes %s", async (_label, maxBytes) => {
    await expect(readBoundedUtf8Body(request("x"), maxBytes)).rejects.toThrow(
      RangeError,
    );
  });
});
