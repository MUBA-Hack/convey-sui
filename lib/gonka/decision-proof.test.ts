import { describe, expect, it } from "vitest";
import {
  buildReceiptUrl,
  canonicalizeDecisionProofResult,
  compareDecisionProofs,
  computeDecisionProofDigest,
  DECISION_IDS,
  DECISION_PROOF_STATUSES,
  MAX_ALLOWLIST_ENTRIES,
  MAX_ALLOWLIST_ENTRY_BYTES,
  MAX_EVIDENCE_TEXT_INPUT_LENGTH,
  parseDecisionProofResult,
  resolveDecisionProofEvidence,
  safeParseDecisionProofResult,
} from "./decision-proof";

const ALLOWLIST = [
  "https://convey.example",
  "https://proof.convey.example",
] as const;

// Source text that contains every default snippet exactly once.
const EV = "Aisha Rahman pays MYR 500 to Aisha Rahman again.";

function live(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: "live",
    modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    requestId: "req_abc123",
    decision: "confirm",
    evidence: [
      { id: "recipient", text: "Aisha Rahman", occurrence: 1 },
      { id: "amount", text: "MYR 500", occurrence: 1 },
    ],
    observedAt: "2026-09-01T12:00:00.000Z",
    origin: "https://convey.example",
    ...overrides,
  };
}

function fallback(overrides: Record<string, unknown> = {}): unknown {
  return { status: "local_fallback", reason: "provider timeout", ...overrides };
}

// Parse a live input with the default evidence source text.
function parseLive(
  input: unknown,
  allowlist: readonly string[] = ALLOWLIST,
  evidenceText: string = EV,
) {
  return parseDecisionProofResult(input, allowlist, evidenceText);
}

function safeLive(
  input: unknown,
  allowlist: readonly string[] = ALLOWLIST,
  evidenceText: string = EV,
) {
  return safeParseDecisionProofResult(input, allowlist, evidenceText);
}

describe("decision-proof constants", () => {
  it("exposes the exact status and decision enums", () => {
    expect([...DECISION_PROOF_STATUSES]).toEqual([
      "live",
      "local_fallback",
      "unavailable",
      "rejected",
    ]);
    expect([...DECISION_IDS]).toEqual(["confirm", "deny", "uncertain"]);
  });
});

describe("parseDecisionProofResult live", () => {
  it("parses a valid live result with an approved origin", () => {
    const result = parseLive(live());
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.modelId).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(result.requestId).toBe("req_abc123");
    expect(result.decision).toBe("confirm");
    expect(result.origin).toBe("https://convey.example");
    expect(result.evidence).toHaveLength(2);
  });

  it("freezes the parsed result and its evidence", () => {
    const result = parseLive(live());
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== "live") return;
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(Object.isFrozen(result.evidence[0])).toBe(true);
  });

  it("rejects an origin not on the approved allowlist", () => {
    const res = safeLive(live({ origin: "https://evil.example" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/origin/i);
  });

  it("rejects a javascript: scheme origin even if allowlist is malformed", () => {
    const res = safeLive(live({ origin: "javascript:alert(1)" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a data: scheme origin", () => {
    const res = safeLive(live({ origin: "data:text/html,<script>" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an origin carrying a query string", () => {
    const res = safeLive(live({ origin: "https://convey.example?x=1" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an origin carrying a fragment", () => {
    const res = safeLive(live({ origin: "https://convey.example#sec" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an origin carrying a path", () => {
    const res = safeLive(live({ origin: "https://convey.example/proof" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an origin with credentials", () => {
    const res = safeLive(live({ origin: "https://u:p@convey.example" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with query-injection characters", () => {
    const res = safeLive(live({ requestId: "req?receipt=pwned&x=1" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with url path traversal", () => {
    const res = safeLive(live({ requestId: "req/../../etc" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an API-key-shaped requestId (sk-)", () => {
    const res = safeLive(live({ requestId: "sk-live-abc123" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an API-key-shaped requestId (sk_)", () => {
    const res = safeLive(live({ requestId: "sk_live_abc123" }));
    expect(res.ok).toBe(false);
  });

  // Gap 4: a request id that carries a key-like `sk-` or `sk_` segment AFTER
  // the `req_` prefix is rejected syntactically. The runtime cannot prove
  // arbitrary opaque token content is never a secret, so the boundary is
  // syntactic. Case-insensitive. Legit ids without an `sk` segment still pass.
  it("rejects a requestId with a key-like sk- segment after req_ (lowercase)", () => {
    const res = safeLive(live({ requestId: "req_sk-secret" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with a key-like sk_ segment after req_ (lowercase)", () => {
    const res = safeLive(live({ requestId: "req_sk_secret" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with a key-like SK- segment after req_ (uppercase)", () => {
    const res = safeLive(live({ requestId: "req_SK-secret" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with a key-like SK_ segment after req_ (uppercase)", () => {
    const res = safeLive(live({ requestId: "req_SK_secret" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a requestId with a key-like sk- segment mid-token after req_", () => {
    const res = safeLive(live({ requestId: "req_prefix-sk-leak" }));
    expect(res.ok).toBe(false);
  });

  it("accepts a legit requestId whose token merely contains the letters sk without a key segment", () => {
    // "task-123" contains "sk" as part of "task" but no `sk-`/`sk_` segment.
    const res = safeLive(live({ requestId: "req_task-123" }));
    expect(res.ok).toBe(true);
  });

  it("rejects a requestId without the req_ prefix", () => {
    const res = safeLive(live({ requestId: "abc123" }));
    expect(res.ok).toBe(false);
  });

  it("rejects extra keys on the live object (strict)", () => {
    const res = safeLive(live({ secret: "sk_live_abc" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a missing required field on live", () => {
    const { modelId: _omit, ...withoutModel } = live() as Record<string, unknown>;
    void _omit;
    const res = safeLive(withoutModel);
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown decision id", () => {
    const res = safeLive(live({ decision: "approve" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown status", () => {
    const res = safeLive(live({ status: "approved" }));
    expect(res.ok).toBe(false);
  });

  it("rejects an empty evidence array", () => {
    const res = safeLive(live({ evidence: [] }));
    expect(res.ok).toBe(false);
  });

  it("rejects evidence with a duplicate id", () => {
    const res = safeLive(
      live({
        evidence: [
          { id: "recipient", text: "Aisha Rahman", occurrence: 1 },
          { id: "recipient", text: "Aisha Rahman", occurrence: 1 },
        ],
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects an out-of-range occurrence", () => {
    const res = safeLive(
      live({ evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 99 }] }),
    );
    expect(res.ok).toBe(false);
  });

  it("requires evidenceText for a live result (no source => fail closed)", () => {
    const res = safeParseDecisionProofResult(live(), ALLOWLIST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/evidenceText|source/i);
  });

  it("does not require evidenceText for a non-live result", () => {
    const result = parseDecisionProofResult(fallback(), ALLOWLIST);
    expect(result.status).toBe("local_fallback");
  });

  it("preserves unicode evidence text exactly", () => {
    const text = "Aïsha Rähman — 500€";
    const source = `prefix ${text} suffix`;
    const result = parseLive(
      live({ evidence: [{ id: "recipient", text, occurrence: 1 }] }),
      ALLOWLIST,
      source,
    );
    if (result.status !== "live") throw new Error("expected live");
    const first = result.evidence[0];
    if (!first) throw new Error("expected at least one evidence entry");
    expect(first.text).toBe(text);
  });
});

describe("canonical allowlist validation", () => {
  it("rejects an http scheme allowlist entry", () => {
    expect(() => parseLive(live(), ["http://convey.example"] as const)).toThrow(
      /allowlist/i,
    );
  });

  it("rejects an allowlist entry with a path", () => {
    expect(() =>
      parseLive(live(), ["https://convey.example/proof"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with a query string", () => {
    expect(() =>
      parseLive(live(), ["https://convey.example?q=1"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with a fragment", () => {
    expect(() =>
      parseLive(live(), ["https://convey.example#s"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with credentials", () => {
    expect(() =>
      parseLive(live(), ["https://u:p@convey.example"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with an explicit default port (noncanonical)", () => {
    expect(() =>
      parseLive(live(), ["https://convey.example:443"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with uppercase host (noncanonical)", () => {
    expect(() =>
      parseLive(live(), ["https://CONVEY.EXAMPLE"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an allowlist entry with uppercase scheme (noncanonical)", () => {
    expect(() =>
      parseLive(live(), ["HTTPS://convey.example"] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects duplicate canonical origins in the allowlist", () => {
    expect(() =>
      parseLive(live(), [
        "https://convey.example",
        "https://convey.example",
      ] as const),
    ).toThrow(/allowlist/i);
  });

  it("rejects an empty allowlist", () => {
    expect(() => parseLive(live(), [] as const)).toThrow(/allowlist/i);
  });

  it("accepts a canonical bare https origin and matches a parsed origin canonically", () => {
    const result = parseLive(live(), ["https://convey.example"] as const);
    expect(result.status).toBe("live");
  });
});

describe("parseDecisionProofResult non-live", () => {
  it.each([
    ["local_fallback", fallback()],
    ["unavailable", { status: "unavailable", reason: "provider error" }],
    ["rejected", { status: "rejected", reason: "policy violation" }],
  ])("parses a %s result and freezes it", (_status, input) => {
    const result = parseDecisionProofResult(input, ALLOWLIST);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects extra keys on a non-live result", () => {
    const res = safeParseDecisionProofResult(
      { status: "unavailable", reason: "x", leak: "sk" },
      ALLOWLIST,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a non-live result missing a reason", () => {
    const res = safeParseDecisionProofResult({ status: "rejected" }, ALLOWLIST);
    expect(res.ok).toBe(false);
  });
});

describe("strict canonical ISO observedAt", () => {
  it("accepts an exact UTC ISO timestamp with milliseconds", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T12:00:00.000Z" }));
    expect(res.ok).toBe(true);
  });

  it("rejects the numeric string 0", () => {
    const res = safeLive(live({ observedAt: "0" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a locale date string", () => {
    const res = safeLive(live({ observedAt: "September 1, 2026 12:00:00" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a timestamp without the Z UTC designator", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T12:00:00.000" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a timestamp without milliseconds (noncanonical)", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T12:00:00Z" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a timestamp with a timezone offset (noncanonical)", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T12:00:00.000+00:00" }));
    expect(res.ok).toBe(false);
  });

  it("produces a stable digest for canonical timestamps only", () => {
    const a = parseLive(live({ observedAt: "2026-09-01T12:00:00.000Z" }));
    const b = parseLive(live({ observedAt: "2026-09-01T12:00:00.000Z" }));
    expect(computeDecisionProofDigest(a)).toBe(computeDecisionProofDigest(b));
  });

  // Gap 2: the regex alone accepts impossible calendar values. A valid
  // canonical instant requires a finite Date AND `new Date(value).toISOString()
  // === value`, so Feb 30, month 13, hour 24, and any normalization drift fail.
  it("rejects Feb 30 (impossible day, passes regex but not a valid instant)", () => {
    const res = safeLive(live({ observedAt: "2026-02-30T12:00:00.000Z" }));
    expect(res.ok).toBe(false);
  });

  it("rejects month 13 (impossible month)", () => {
    const res = safeLive(live({ observedAt: "2026-13-01T12:00:00.000Z" }));
    expect(res.ok).toBe(false);
  });

  it("rejects hour 24 (impossible time)", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T24:00:00.000Z" }));
    expect(res.ok).toBe(false);
  });

  it("rejects minute 60 (impossible time)", () => {
    const res = safeLive(live({ observedAt: "2026-09-01T12:60:00.000Z" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a value that Date normalizes to a different canonical string", () => {
    // 2026-01-32 normalizes to 2026-02-01; toISOString() !== input.
    const res = safeLive(live({ observedAt: "2026-01-32T12:00:00.000Z" }));
    expect(res.ok).toBe(false);
  });

  it("accepts a leap-second-shaped but Date-valid end-of-month instant", () => {
    const res = safeLive(live({ observedAt: "2026-09-30T23:59:59.999Z" }));
    expect(res.ok).toBe(true);
  });
});

describe("canonical modelId grammar", () => {
  // Gap 3: modelId is a bounded provider identifier. Only letters, digits,
  // slash, dot, underscore, hyphen. No control chars, no leading/trailing
  // whitespace, no internal whitespace. A trailing newline must NOT let the
  // "same" model become a distinct live result or fabricate agreement.

  it("accepts a provider/path model id with slash, dot, hyphen", () => {
    const res = safeLive(
      live({ modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a modelId with a trailing newline", () => {
    const res = safeLive(live({ modelId: "model-a\n" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with a leading newline", () => {
    const res = safeLive(live({ modelId: "\nmodel-a" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with an embedded newline", () => {
    const res = safeLive(live({ modelId: "model\na" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with a leading space", () => {
    const res = safeLive(live({ modelId: " model-a" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with a trailing space", () => {
    const res = safeLive(live({ modelId: "model-a " }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with an embedded space", () => {
    const res = safeLive(live({ modelId: "model a" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with a control character", () => {
    const res = safeLive(live({ modelId: "model\x07a" }));
    expect(res.ok).toBe(false);
  });

  it("rejects a modelId with a query-injecting character", () => {
    const res = safeLive(live({ modelId: "model?a=1" }));
    expect(res.ok).toBe(false);
  });

  it("does not let a trailing-newline modelId become a live result for agreement", () => {
    // "model-a" parses live; "model-a\n" is rejected, so it can never form a
    // second live result and cannot fabricate agreement/disagreement.
    const a = safeLive(live({ modelId: "model-a", requestId: "req_r1" }));
    const b = safeLive(live({ modelId: "model-a\n", requestId: "req_r2" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });
});

describe("resolveDecisionProofEvidence occurrences", () => {
  const evidenceText = "Aisha Rahman pays MYR 500 to Aisha Rahman again.";

  it("resolves occurrence 2 to the exact match span (start=index, end=start+len)", () => {
    const result = parseLive(
      live({
        evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 2 }],
      }),
      ALLOWLIST,
      evidenceText,
    );
    const spans = resolveDecisionProofEvidence(result, evidenceText);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(evidenceText.slice(span.start, span.end)).toBe("Aisha Rahman");
    expect(span.end - span.start).toBe("Aisha Rahman".length);
  });

  it("resolves occurrence 1 to the first exact match span", () => {
    const result = parseLive(
      live({
        evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 1 }],
      }),
      ALLOWLIST,
      evidenceText,
    );
    const spans = resolveDecisionProofEvidence(result, evidenceText);
    const span = spans[0]!;
    expect(evidenceText.slice(span.start, span.end)).toBe("Aisha Rahman");
    expect(span.start).toBe(0);
    expect(span.end).toBe("Aisha Rahman".length);
  });

  it("handles astral (surrogate-pair) unicode snippets by UTF-16 length", () => {
    const source = "Send 🎁 to Aisha today";
    const snippet = "🎁";
    const result = parseLive(
      live({ evidence: [{ id: "gift", text: snippet, occurrence: 1 }] }),
      ALLOWLIST,
      source,
    );
    const spans = resolveDecisionProofEvidence(result, source);
    const span = spans[0]!;
    expect(source.slice(span.start, span.end)).toBe(snippet);
    expect(span.end - span.start).toBe(snippet.length);
  });

  it("fails closed (throws) when the occurrence does not exist at resolve time", () => {
    const result = parseLive(
      live({ evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 1 }] }),
      ALLOWLIST,
      evidenceText,
    );
    expect(() =>
      resolveDecisionProofEvidence(result, "totally different text"),
    ).toThrow();
  });

  it("fails closed (parse) when the occurrence does not exist", () => {
    const res = safeLive(
      live({ evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 5 }] }),
      ALLOWLIST,
      evidenceText,
    );
    expect(res.ok).toBe(false);
  });

  it("fails closed (parse) when the snippet text is absent from evidence", () => {
    const res = safeLive(
      live({ evidence: [{ id: "recipient", text: "Not Present", occurrence: 1 }] }),
      ALLOWLIST,
      evidenceText,
    );
    expect(res.ok).toBe(false);
  });

  it("returns [] for a non-live result", () => {
    const result = parseDecisionProofResult(fallback(), ALLOWLIST);
    expect(resolveDecisionProofEvidence(result, evidenceText)).toEqual([]);
  });
});

describe("buildReceiptUrl", () => {
  it("builds a clickable https receipt URL for a live result", () => {
    const result = parseLive(live());
    expect(buildReceiptUrl(result, ALLOWLIST)).toBe(
      "https://convey.example/proof?receipt=req_abc123",
    );
  });

  it("returns null for local_fallback", () => {
    const result = parseDecisionProofResult(fallback(), ALLOWLIST);
    expect(buildReceiptUrl(result, ALLOWLIST)).toBeNull();
  });

  it("returns null for unavailable", () => {
    const result = parseDecisionProofResult(
      { status: "unavailable", reason: "provider error" },
      ALLOWLIST,
    );
    expect(buildReceiptUrl(result, ALLOWLIST)).toBeNull();
  });

  it("returns null for rejected", () => {
    const result = parseDecisionProofResult(
      { status: "rejected", reason: "policy" },
      ALLOWLIST,
    );
    expect(buildReceiptUrl(result, ALLOWLIST)).toBeNull();
  });

  it("uses the second allowlisted origin when chosen", () => {
    const result = parseLive(live({ origin: "https://proof.convey.example" }));
    expect(buildReceiptUrl(result, ALLOWLIST)).toBe(
      "https://proof.convey.example/proof?receipt=req_abc123",
    );
  });

  it("fails closed (null) when the live origin is not on the supplied allowlist", () => {
    const result = parseLive(live());
    expect(buildReceiptUrl(result, ["https://proof.convey.example"] as const)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast javascript: origin", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "javascript:alert(1)",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast data: origin", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "data:text/html,<script>",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast query-injecting requestId", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req?receipt=pwned&x=1",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast path-traversing requestId", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req/../../etc",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast origin with a path", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://convey.example/proof",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a structurally-cast origin with credentials", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://u:p@convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  // Gap 1: a plain/cast forged object with an allowlisted origin and a
  // req_-grammar requestId but NO module-private provenance membership and
  // bogus observedAt / unresolved evidence must NOT get a receipt URL. The
  // membership check revalidates complete live provenance, not only
  // safe-looking origin and request id.
  it("fails closed (null) for a forged live object missing provenance membership", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "not-in-source", occurrence: 1 }],
      observedAt: "2026-02-30T12:00:00.000Z",
      origin: "https://convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a forged live object with valid fields but no brand", () => {
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  // Provenance-forgery gap: a discoverable brand symbol can be copied off a
  // valid live result and onto a forged object. The URL boundary must rely on
  // module-private membership by object identity, not any copyable property.
  it("fails closed (null) when a forged object copies a discoverable symbol from a valid result", () => {
    const valid = parseLive(live());
    const forged = {
      status: "live",
      modelId: "m",
      requestId: "req_abc123",
      decision: "confirm",
      evidence: [{ id: "x", text: "x", occurrence: 1 }],
      observedAt: "2026-09-01T12:00:00.000Z",
      origin: "https://convey.example",
    } as unknown as ReturnType<typeof parseLive>;
    for (const sym of Object.getOwnPropertySymbols(valid)) {
      Object.defineProperty(forged, sym, {
        value: (valid as unknown as Record<symbol, unknown>)[sym],
        configurable: true,
        writable: true,
        enumerable: true,
      });
    }
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) when a forged object copies own properties via Object.assign from a valid result", () => {
    const valid = parseLive(live());
    const forged = Object.assign(
      {
        status: "live",
        modelId: "m",
        requestId: "req_abc123",
        decision: "confirm",
        evidence: [{ id: "x", text: "x", occurrence: 1 }],
        observedAt: "2026-09-01T12:00:00.000Z",
        origin: "https://convey.example",
      },
      valid,
    ) as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(forged, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a shallow (spread) clone of a valid live result", () => {
    const valid = parseLive(live());
    const clone = { ...valid } as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(clone, ALLOWLIST)).toBeNull();
  });

  it("fails closed (null) for a JSON round-trip clone of a valid live result", () => {
    const valid = parseLive(live());
    const clone = JSON.parse(JSON.stringify(valid)) as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(clone, ALLOWLIST)).toBeNull();
  });

  it("still builds a URL for the original valid object after clone attempts", () => {
    const valid = parseLive(live());
    // Cloning must not transfer provenance, but the original keeps it.
    void { ...valid };
    void JSON.parse(JSON.stringify(valid));
    expect(buildReceiptUrl(valid, ALLOWLIST)).toBe(
      "https://convey.example/proof?receipt=req_abc123",
    );
  });
});

describe("compareDecisionProofs", () => {
  it("returns unavailable when neither result is live", () => {
    const a = parseDecisionProofResult(fallback(), ALLOWLIST);
    const b = parseDecisionProofResult(
      { status: "unavailable", reason: "x" },
      ALLOWLIST,
    );
    expect(compareDecisionProofs(a, b)).toBe("unavailable");
  });

  it("returns partial when only one result is live", () => {
    const a = parseLive(live());
    const b = parseDecisionProofResult(fallback(), ALLOWLIST);
    expect(compareDecisionProofs(a, b)).toBe("partial");
  });

  it("returns agreement for two live results with distinct model ids, distinct request ids, same decision and evidence", () => {
    const a = parseLive(
      live({ modelId: "model-a", requestId: "req_r1" }),
    );
    const b = parseLive(
      live({ modelId: "model-b", requestId: "req_r2" }),
    );
    expect(compareDecisionProofs(a, b)).toBe("agreement");
  });

  it("returns partial for two live results with the SAME model id but distinct request ids (non-independent)", () => {
    const a = parseLive(live({ modelId: "same-model", requestId: "req_r1" }));
    const b = parseLive(live({ modelId: "same-model", requestId: "req_r2" }));
    expect(compareDecisionProofs(a, b)).toBe("partial");
  });

  it("returns disagreement for two live results with distinct model ids and different decisions", () => {
    const a = parseLive(
      live({ modelId: "model-a", requestId: "req_r1", decision: "confirm" }),
    );
    const b = parseLive(
      live({ modelId: "model-b", requestId: "req_r2", decision: "deny" }),
    );
    expect(compareDecisionProofs(a, b)).toBe("disagreement");
  });

  it("returns partial when both live, distinct model ids, same decision, but differing evidence", () => {
    const a = parseLive(
      live({
        modelId: "model-a",
        requestId: "req_r1",
        evidence: [{ id: "recipient", text: "Aisha Rahman", occurrence: 1 }],
      }),
    );
    const b = parseLive(
      live({
        modelId: "model-b",
        requestId: "req_r2",
        evidence: [{ id: "amount", text: "MYR 500", occurrence: 1 }],
      }),
    );
    expect(compareDecisionProofs(a, b)).toBe("partial");
  });

  it("returns partial when both live share the same requestId (non-independent)", () => {
    const a = parseLive(live({ modelId: "model-a", requestId: "req_shared" }));
    const b = parseLive(live({ modelId: "model-b", requestId: "req_shared" }));
    expect(compareDecisionProofs(a, b)).toBe("partial");
  });

  it("is symmetric for agreement", () => {
    const a = parseLive(live({ modelId: "model-a", requestId: "req_r1" }));
    const b = parseLive(live({ modelId: "model-b", requestId: "req_r2" }));
    expect(compareDecisionProofs(a, b)).toBe(compareDecisionProofs(b, a));
  });

  it("is symmetric for disagreement", () => {
    const a = parseLive(
      live({ modelId: "model-a", requestId: "req_r1", decision: "confirm" }),
    );
    const b = parseLive(
      live({ modelId: "model-b", requestId: "req_r2", decision: "deny" }),
    );
    expect(compareDecisionProofs(a, b)).toBe(compareDecisionProofs(b, a));
  });

  it("never returns approval, authorization, truth, settlement, or trade proof", () => {
    const a = parseLive(live());
    const b = parseLive(live({ modelId: "model-b", requestId: "req_r2" }));
    const outcome = compareDecisionProofs(a, b);
    expect(["agreement", "disagreement", "partial", "unavailable"]).toContain(
      outcome,
    );
  });
});

describe("computeDecisionProofDigest determinism", () => {
  it("produces a stable 0x-prefixed 64-hex digest for the same live result", () => {
    const a = parseLive(live());
    const b = parseLive(live());
    expect(computeDecisionProofDigest(a)).toBe(computeDecisionProofDigest(b));
    expect(computeDecisionProofDigest(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes the digest when the decision changes", () => {
    const a = parseLive(live({ decision: "confirm" }));
    const b = parseLive(live({ decision: "deny" }));
    expect(computeDecisionProofDigest(a)).not.toBe(computeDecisionProofDigest(b));
  });

  it("keeps the digest stable when evidence order changes but content is same (canonical)", () => {
    const a = parseLive(
      live({
        evidence: [
          { id: "recipient", text: "Aisha Rahman", occurrence: 1 },
          { id: "amount", text: "MYR 500", occurrence: 1 },
        ],
      }),
    );
    const b = parseLive(
      live({
        evidence: [
          { id: "amount", text: "MYR 500", occurrence: 1 },
          { id: "recipient", text: "Aisha Rahman", occurrence: 1 },
        ],
      }),
    );
    expect(computeDecisionProofDigest(a)).toBe(computeDecisionProofDigest(b));
  });

  it("produces a stable digest for non-live results", () => {
    const a = parseDecisionProofResult(fallback(), ALLOWLIST);
    const b = parseDecisionProofResult(fallback(), ALLOWLIST);
    expect(computeDecisionProofDigest(a)).toBe(computeDecisionProofDigest(b));
    expect(computeDecisionProofDigest(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("canonicalizeDecisionProofResult immutability", () => {
  it("returns a frozen canonical object with a digest", () => {
    const result = parseLive(live());
    const canonical = canonicalizeDecisionProofResult(result);
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(canonical.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(canonical.advisoryOnly).toBe(true);
  });

  it("freezes the canonical evidence array and each evidence entry", () => {
    const result = parseLive(live());
    const canonical = canonicalizeDecisionProofResult(result);
    if (canonical.status !== "live" || !canonical.evidence) throw new Error("expected live");
    expect(Object.isFrozen(canonical.evidence)).toBe(true);
    expect(Object.isFrozen(canonical.evidence[0])).toBe(true);
  });

  it("throws on mutation of the canonical object (strict mode)", () => {
    const result = parseLive(live());
    const canonical = canonicalizeDecisionProofResult(result);
    expect(() => {
      (canonical as { digest?: string }).digest = "0x0";
    }).toThrow();
  });

  it("throws on mutation of a frozen evidence entry (strict mode)", () => {
    const result = parseLive(live());
    const canonical = canonicalizeDecisionProofResult(result);
    if (canonical.status !== "live" || !canonical.evidence) throw new Error("expected live");
    const first = canonical.evidence[0]!;
    expect(() => {
      (first as { id?: string }).id = "tampered";
    }).toThrow();
  });

  it("throws on mutation of the parsed live result (strict mode)", () => {
    const result = parseLive(live());
    expect(() => {
      (result as { decision?: string }).decision = "deny";
    }).toThrow();
  });

  it("throws on mutation of a parsed evidence entry (strict mode)", () => {
    const result = parseLive(live());
    if (result.status !== "live") throw new Error("expected live");
    expect(() => {
      (result.evidence[0] as { id?: string }).id = "tampered";
    }).toThrow();
  });

  it("digest stays consistent after a rejected mutation attempt", () => {
    const result = parseLive(live());
    const before = computeDecisionProofDigest(result);
    try {
      (result as { decision?: string }).decision = "deny";
    } catch {
      /* expected throw in strict mode */
    }
    const after = computeDecisionProofDigest(result);
    expect(after).toBe(before);
  });

  it("never exposes approval, authorization, truth, settlement, or trade proof claims", () => {
    const result = parseLive(live());
    const canonical = canonicalizeDecisionProofResult(result);
    const serialized = JSON.stringify(canonical);
    expect(serialized).not.toMatch(
      /approval|authorization|truth|settlement|trade proof/i,
    );
  });
});

describe("evidence-set comparison collision resistance", () => {
  // Adversarial: a single evidence whose text embeds the delimiter and newline
  // mimics the structural signature of two distinct entries under the old
  // `${id}|${text}|${occurrence}` + `\n`.join encoding. Canonical structural
  // encoding (JSON) must distinguish them -> partial, not agreement.
  it("does not collide when one evidence text embeds the delimiter and newline of two entries", () => {
    const sourceA = "x|1\ny|z";
    const a = parseLive(
      live({
        modelId: "model-a",
        requestId: "req_r1",
        decision: "confirm",
        evidence: [{ id: "a", text: "x|1\ny|z", occurrence: 1 }],
      }),
      ALLOWLIST,
      sourceA,
    );
    const sourceB = "x and z";
    const b = parseLive(
      live({
        modelId: "model-b",
        requestId: "req_r2",
        decision: "confirm",
        evidence: [
          { id: "a", text: "x", occurrence: 1 },
          { id: "y", text: "z", occurrence: 1 },
        ],
      }),
      ALLOWLIST,
      sourceB,
    );
    expect(compareDecisionProofs(a, b)).toBe("partial");
  });

  it("still returns agreement for genuinely identical evidence sets", () => {
    const a = parseLive(
      live({ modelId: "model-a", requestId: "req_r1" }),
    );
    const b = parseLive(
      live({ modelId: "model-b", requestId: "req_r2" }),
    );
    expect(compareDecisionProofs(a, b)).toBe("agreement");
  });
});

describe("preflight bounds", () => {
  it("rejects an allowlist exceeding the maximum entry cardinality", () => {
    const big = Array.from(
      { length: MAX_ALLOWLIST_ENTRIES + 1 },
      (_, i) => `https://c${i}.example`,
    );
    const res = safeLive(live(), big, EV);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/allowlist/i);
  });

  it("accepts an allowlist at the maximum entry cardinality", () => {
    const max = Array.from(
      { length: MAX_ALLOWLIST_ENTRIES },
      (_, i) => `https://c${i}.example`,
    );
    const res = safeLive(live({ origin: max[0]! }), max, EV);
    expect(res.ok).toBe(true);
  });

  it("rejects an allowlist entry exceeding the maximum entry length", () => {
    const tooLong = `https://${"x".repeat(MAX_ALLOWLIST_ENTRY_BYTES)}.example`;
    const res = safeLive(live(), [tooLong], EV);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/allowlist/i);
  });

  it("rejects a non-string evidenceText", () => {
    const res = safeParseDecisionProofResult(
      live(),
      ALLOWLIST,
      123 as unknown as string,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/evidenceText/i);
  });

  it("rejects evidenceText exceeding the maximum input length", () => {
    const over = "x".repeat(MAX_EVIDENCE_TEXT_INPUT_LENGTH + 1);
    const res = safeLive(live(), ALLOWLIST, over);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/evidenceText/i);
  });

  it("rejects a hostile huge evidenceText without proportional allocation", () => {
    const hostile = "x".repeat(10 * 1024 * 1024);
    const res = safeLive(live(), ALLOWLIST, hostile);
    expect(res.ok).toBe(false);
  });
});

// Cheap shallow preflight on untrusted result fields must run before Zod parse
// (and its TextEncoder allocations) and before the Zod array schema traverses
// over-long evidence. UTF-8 byte length >= UTF-16 unit count, so a char-length
// overage is a strict over-limit signal. Only type/length/cardinality gates —
// semantic validation stays in Zod.
describe("preflight result-field bounds", () => {
  // MAX_MODEL_ID_BYTES = 128. Preflight message is distinct from Zod's
  // "modelId too long" so this asserts the cheap gate ran, not just rejection.
  it("rejects a hostile huge modelId before Zod/TextEncoder allocation", () => {
    const res = safeLive(live({ modelId: "x".repeat(129) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/modelId exceeds maximum length/);
  });

  // MAX_REQUEST_ID_BYTES = 128; `req_` prefix + 125 chars = 129 chars.
  it("rejects a hostile huge requestId before Zod/TextEncoder allocation", () => {
    const res = safeLive(live({ requestId: `req_${"x".repeat(125)}` }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/requestId exceeds maximum length/);
  });

  // MAX_ORIGIN_BYTES = 256
  it("rejects a hostile huge origin before Zod/TextEncoder allocation", () => {
    const res = safeLive(live({ origin: `https://${"x".repeat(250)}.example` }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/origin exceeds maximum length/);
  });

  // MAX_OBSERVED_AT_BYTES = 64
  it("rejects a hostile huge observedAt before Zod/TextEncoder allocation", () => {
    const res = safeLive(live({ observedAt: "x".repeat(65) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/observedAt exceeds maximum length/);
  });

  // MAX_REASON_BYTES = 256
  it("rejects a hostile huge reason on a non-live result before Zod/TextEncoder allocation", () => {
    const res = safeParseDecisionProofResult(
      { status: "rejected", reason: "x".repeat(257) },
      ALLOWLIST,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/reason exceeds maximum length/);
  });

  // MAX_EVIDENCE = 8. Preflight rejects on cardinality before Zod traverses
  // the array; the message is distinct from Zod's array-max error.
  it("rejects an evidence array over the schema max immediately", () => {
    const evidence = Array.from({ length: 9 }, (_, i) => ({
      id: `e${i}`,
      text: "Aisha Rahman",
      occurrence: 1,
    }));
    const res = safeLive(live({ evidence }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/cardinality/);
  });

  // MAX_EVIDENCE_ID_BYTES = 64
  it("rejects a hostile huge evidence entry id before Zod/TextEncoder allocation", () => {
    const res = safeLive(
      live({
        evidence: [{ id: "x".repeat(65), text: "Aisha Rahman", occurrence: 1 }],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/id exceeds maximum length/);
  });

  // MAX_EVIDENCE_TEXT_BYTES = 512
  it("rejects a hostile huge evidence entry text before Zod/TextEncoder allocation", () => {
    const res = safeLive(
      live({
        evidence: [{ id: "recipient", text: "x".repeat(513), occurrence: 1 }],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/text exceeds maximum length/);
  });

  it("does not throw uncaught on a proxy input that throws on property access", () => {
    const trap = new Proxy({}, { get() { throw new Error("boom"); } });
    const res = safeParseDecisionProofResult(trap, ALLOWLIST, EV);
    expect(res.ok).toBe(false);
  });
});

describe("buildReceiptUrl input hardening", () => {
  it("returns null for null", () => {
    expect(buildReceiptUrl(null, ALLOWLIST)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(buildReceiptUrl(undefined, ALLOWLIST)).toBeNull();
  });

  it("returns null for a non-object primitive", () => {
    expect(
      buildReceiptUrl("live" as unknown as ReturnType<typeof parseLive>, ALLOWLIST),
    ).toBeNull();
  });

  it("returns null for a proxy that throws on property access", () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    ) as unknown as ReturnType<typeof parseLive>;
    expect(buildReceiptUrl(trap, ALLOWLIST)).toBeNull();
  });

  it("returns null for an object whose status is not a string", () => {
    expect(
      buildReceiptUrl(
        { status: 123 } as unknown as ReturnType<typeof parseLive>,
        ALLOWLIST,
      ),
    ).toBeNull();
  });
});
