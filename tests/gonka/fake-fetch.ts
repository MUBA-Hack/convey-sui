/**
 * Test harness: a minimal fetch double compatible with the OpenAI SDK v7
 * client. No network. The SDK calls `fetch(url, init)` and consumes a
 * Response-like object with `.ok`, `.status`, `.headers.get()`, `.text()`.
 */

export type FetchResponseSpec =
  | { kind: "ok"; body: unknown; requestId?: string; bodyId?: string; model?: string }
  | { kind: "http"; status: number; body?: unknown }
  | { kind: "throw"; error: unknown };

export interface FakeFetchLog {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

class FakeHeaders {
  private readonly map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k.toLowerCase(), v);
  }
  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }
  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), value);
  }
  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }
  *entries(): IterableIterator<[string, string]> {
    for (const [k, v] of this.map) yield [k, v];
  }
  forEach(callback: (value: string, key: string, parent: Map<string, string>) => void): void {
    this.map.forEach((v, k) => callback(v, k, this.map));
  }
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

class FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
  readonly headers: FakeHeaders;
  private readonly bodyText: string;
  constructor(ok: boolean, status: number, url: string, headers: FakeHeaders, bodyText: string) {
    this.ok = ok;
    this.status = status;
    this.url = url;
    this.headers = headers;
    this.bodyText = bodyText;
  }
  async text(): Promise<string> {
    return this.bodyText;
  }
  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText);
  }
}

function chatCompletionBody(
  payload: { id: string; model: string; content: string; usage?: unknown },
): unknown {
  return {
    id: payload.id,
    object: "chat.completion",
    created: 1_700_000_000,
    model: payload.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: payload.content },
        finish_reason: "stop",
      },
    ],
    usage: payload.usage ?? { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
  };
}

function buildResponse(spec: FetchResponseSpec, url: string): FakeResponse {
  if (spec.kind === "throw") {
    throw spec.error instanceof Error ? spec.error : new Error(String(spec.error));
  }
  if (spec.kind === "http") {
    const bodyText = spec.body === undefined ? "" : JSON.stringify(spec.body);
    return new FakeResponse(
      false,
      spec.status,
      url,
      new FakeHeaders({ "content-type": "application/json" }),
      bodyText,
    );
  }
  const body = chatCompletionBody({
    id: spec.bodyId ?? spec.requestId ?? "req_abc123",
    model: spec.model ?? "deepseek-ai/DeepSeek-V4-Flash-0731",
    content: typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body),
  });
  return new FakeResponse(
    true,
    200,
    url,
    new FakeHeaders({ "content-type": "application/json", "x-request-id": spec.requestId ?? "req_abc123" }),
    JSON.stringify(body),
  );
}

export interface FakeFetch {
  /** Permissive fetch double; cast at the OpenAI client seam. */
  fetch: (url: string, init?: RequestInit) => Promise<unknown>;
  calls: FakeFetchLog[];
}

/**
 * Build a fake fetch that returns responses in order. If more calls arrive
 * than specs, the last spec is reused.
 */
export function fakeFetch(specs: FetchResponseSpec[]): FakeFetch {
  const calls: FakeFetchLog[] = [];
  let index = 0;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const url = typeof input === "string" ? input : input.toString();
    let parsedBody: unknown = undefined;
    let headers: Record<string, string> = {};
    if (init) {
      if (typeof init.body === "string") {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => (headers[k] = v));
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) headers[k] = String(v);
        } else {
          headers = { ...(init.headers as Record<string, string>) };
        }
      }
    }
    calls.push({ url, method: init?.method ?? "GET", body: parsedBody, headers });
    const spec = specs[Math.min(index, specs.length - 1)];
    if (!spec) throw new Error("fake-fetch received no specs");
    index += 1;
    return buildResponse(spec, url);
  };
  return { fetch: fetch as unknown as FakeFetch["fetch"], calls };
}

/** A timeout-shaped error the SDK will wrap as APIConnectionTimeoutError. */
export function timeoutError(): Error {
  const err = new Error("The user aborted a request.");
  err.name = "AbortError";
  return err;
}

/** A non-retryable 4xx HTTP error body. */
export function httpErrorBody(status: number, message: string): unknown {
  return { error: { message, type: "invalid_request_error", code: `http_${status}` } };
}

export function validCandidateJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    itemId: "iced-coffee",
    itemName: "Iced Coffee",
    merchantId: "river-cafe",
    merchantName: "River Cafe",
    quantity: 2,
    maxSpendSui: "10",
    detectedLanguage: "en",
    explanation: "User asked for two iced coffees from River Cafe.",
    confidence: 0.95,
    ...overrides,
  });
}

export const TEST_MANIFEST = {
  merchants: [
    {
      id: "river-cafe",
      name: "River Cafe",
      itemIds: ["iced-coffee", "latte"],
    },
    {
      id: "harbor-bakery",
      name: "Harbor Bakery",
      itemIds: ["croissant"],
    },
  ],
  items: [
    { id: "iced-coffee", name: "Iced Coffee", priceSui: "3" },
    { id: "latte", name: "Latte", priceSui: "4" },
    { id: "croissant", name: "Croissant", priceSui: "2" },
  ],
};

export const TEST_INPUT = {
  prompt: "Buy two iced coffees from River Cafe under 10 SUI.",
  localeHint: "en",
  catalog: TEST_MANIFEST,
};

export const TEST_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
