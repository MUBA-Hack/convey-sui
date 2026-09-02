/**
 * Decision provenance for advisory model results — pure, strict, client-safe.
 *
 * Models one or two advisory model results so the UI can render inspectable
 * decision evidence without leaking secrets or implying payment authority. A
 * live result carries bounded model/request ids, a decision, exact evidence
 * snippets with their occurrence index, an observed timestamp, and an approved
 * receipt origin. A clickable receipt URL is constructed only for a live result
 * whose origin is on an explicit allowlist; everything else fails closed.
 *
 * Trust boundaries:
 * - Advisory only. Never approval, authorization, truth, settlement, or trade
 *   proof. `compareDecisionProofs` returns agreement/disagreement/partial/
 *   unavailable — never a release signal.
 * - The receipt URL is a navigation link to an approved origin only. No
 *   client-selected arbitrary origin, javascript/data schemes, query injection,
 *   path traversal, or secret/prompt payload is accepted.
 * - A live result is opaque/branded: only `parseDecisionProofResult` can mint
 *   one, by adding the frozen result to a module-private `WeakSet` after the
 *   existing exact parser/validator has passed. `buildReceiptUrl` requires
 *   that membership (by object identity) and revalidates origin + requestId
 *   against the supplied allowlist before emitting any link. A copied symbol,
 *   copied property bag, or shallow/deep clone is not a member and fails
 *   closed.
 * - No fetch, env, storage, React, or new dependency. Pure functions plus the
 *   shared blake2b256 from `lib/protocol/hash`.
 */

import { z } from "zod";
import { blake2b256, toHex } from "../protocol/hash";

export const DECISION_PROOF_STATUSES = [
  "live",
  "local_fallback",
  "unavailable",
  "rejected",
] as const;
export type DecisionProofStatus = (typeof DECISION_PROOF_STATUSES)[number];

export const DECISION_IDS = ["confirm", "deny", "uncertain"] as const;
export type DecisionId = (typeof DECISION_IDS)[number];

const MAX_MODEL_ID_BYTES = 128;
const MAX_REQUEST_ID_BYTES = 128;
const MAX_REASON_BYTES = 256;
const MAX_EVIDENCE_ID_BYTES = 64;
const MAX_EVIDENCE_TEXT_BYTES = 512;
const MAX_EVIDENCE = 8;
const MAX_OCCURRENCE = 8;
const MAX_ORIGIN_BYTES = 256;
const MAX_OBSERVED_AT_BYTES = 64;

// Cheap preflight bounds checked before expensive parsing/allocation so
// obviously oversized or mistyped inputs fail closed without proportional
// work. Lengths are UTF-16 unit counts (string.length); since UTF-8 byte
// length is always >= UTF-16 unit count, a char-length overage is a strict
// over-limit signal and needs no TextEncoder allocation to reject.
export const MAX_ALLOWLIST_ENTRIES = 32;
export const MAX_ALLOWLIST_ENTRY_BYTES = 256;
export const MAX_EVIDENCE_TEXT_INPUT_LENGTH = 65536;

const byteLengthAtMost =
  (limit: number) =>
  (value: string): boolean =>
    new TextEncoder().encode(value).byteLength <= limit;

// Evidence ids are opaque tokens. Restrict to a safe charset so they cannot
// carry query strings, path traversal, or prompt payloads.
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

// Request/receipt ids use a conservative `req_` prefix grammar aligned with the
// Gonka/OpenAI-style request id shape (`req_<token>`). It excludes API-key
// shapes (`sk-...`, `sk_...`) and any query/path-injecting character. The id is
// the only payload ever placed in the receipt URL, so it must be a safe token.
const REQUEST_ID_PATTERN = /^req[-_][A-Za-z0-9_-]+$/;

// Syntactic no-secret boundary on the token after `req_`. The runtime cannot
// prove arbitrary opaque token content is never a secret, so any key-like
// `sk-`/`sk_` segment (case-insensitive, at the token start or after a `-`/`_`
// separator) is rejected. Segment-boundary matching avoids false positives on
// legit ids like `req_task-123` where `sk` is part of a larger segment.
const REQUEST_ID_KEY_SEGMENT_PATTERN = /^(sk[-_])|([-_]sk[-_])/i;

// Canonical modelId grammar: a bounded provider identifier allowing letters,
// digits, slash, dot, underscore, hyphen. No control chars and no whitespace
// (leading, trailing, or internal) so a trailing newline cannot make the
// "same" model a distinct live result or fabricate agreement/disagreement.
const MODEL_ID_PATTERN = new RegExp("^[A-Za-z0-9._/-]+$");

// Strict canonical UTC ISO-8601: `YYYY-MM-DDTHH:mm:ss.sssZ` exactly. No offsets,
// no missing milliseconds, no locale forms, no numeric-only strings. Keeps the
// digest stable by requiring canonical input rather than normalizing.
const CANONICAL_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// A canonical ISO string must also denote a valid instant: a finite Date whose
// `toISOString()` round-trips to the exact input. This rejects impossible
// calendar values (Feb 30, month 13, hour 24) that satisfy the regex alone and
// any value Date would normalize to a different canonical string.
function isCanonicalInstant(value: string): boolean {
  const d = new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return false;
  return d.toISOString() === value;
}

const evidenceSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_EVIDENCE_ID_BYTES), `evidence id too long`)
    .refine((v) => SAFE_TOKEN_PATTERN.test(v), `evidence id has unsafe chars`),
  text: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_EVIDENCE_TEXT_BYTES), `evidence text too long`),
  occurrence: z.number().int().min(1).max(MAX_OCCURRENCE),
});

const liveSchema = z.strictObject({
  status: z.literal("live"),
  modelId: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_MODEL_ID_BYTES), `modelId too long`)
    .refine((v) => MODEL_ID_PATTERN.test(v), `modelId has unsafe chars or whitespace`),
  requestId: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_REQUEST_ID_BYTES), `requestId too long`)
    .refine((v) => REQUEST_ID_PATTERN.test(v), `requestId must match req_<token>`)
    .refine(
      (v) => !REQUEST_ID_KEY_SEGMENT_PATTERN.test(v.slice(4)),
      `requestId must not contain a key-like sk- or sk_ segment`,
    ),
  decision: z.enum(["confirm", "deny", "uncertain"]),
  evidence: z.array(evidenceSchema).min(1).max(MAX_EVIDENCE),
  observedAt: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_OBSERVED_AT_BYTES), `observedAt too long`)
    .refine((v) => CANONICAL_ISO_PATTERN.test(v), `observedAt is not canonical ISO-8601 UTC`)
    .refine(isCanonicalInstant, `observedAt is not a valid canonical instant`),
  origin: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_ORIGIN_BYTES), `origin too long`),
});

const nonLiveSchema = z.strictObject({
  status: z.enum(["local_fallback", "unavailable", "rejected"]),
  reason: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_REASON_BYTES), `reason too long`),
});

const resultSchema = z.union([liveSchema, nonLiveSchema]);

// Module-private provenance registry. Only `parseDecisionProofResult` adds a
// frozen live result here, and only after the existing exact parser/validator
// has passed. Membership is by object identity: a copied brand symbol, a
// copied property bag, or a shallow/deep clone is not a member and fails
// closed at the URL boundary. Kept out-of-band so no enumerable or symbol
// property on the result can be discovered and copied to forge provenance.
const liveProvenance = new WeakSet<object>();

export interface DecisionProofEvidence {
  readonly id: string;
  readonly text: string;
  readonly occurrence: number;
}

export interface LiveDecisionProofResult {
  readonly status: "live";
  readonly modelId: string;
  readonly requestId: string;
  readonly decision: DecisionId;
  readonly evidence: readonly DecisionProofEvidence[];
  readonly observedAt: string;
  readonly origin: string;
}

export interface NonLiveDecisionProofResult {
  readonly status: "local_fallback" | "unavailable" | "rejected";
  readonly reason: string;
}

export type DecisionProofResult =
  | LiveDecisionProofResult
  | NonLiveDecisionProofResult;

export type DecisionProofComparison =
  | "agreement"
  | "disagreement"
  | "partial"
  | "unavailable";

export interface DecisionProofEvidenceSpan {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CanonicalDecisionProof {
  readonly status: DecisionProofStatus;
  readonly digest: `0x${string}`;
  readonly advisoryOnly: true;
  readonly modelId?: string;
  readonly requestId?: string;
  readonly decision?: DecisionId;
  readonly evidence?: readonly DecisionProofEvidence[];
  readonly observedAt?: string;
  readonly origin?: string;
  readonly reason?: string;
}

export type SafeParseOk = { ok: true; value: DecisionProofResult };
export type SafeParseErr = { ok: false; errors: string[] };
export type SafeParseResult = SafeParseOk | SafeParseErr;

/**
 * Canonicalize an allowlist entry to its `https://` origin and require the raw
 * entry to equal that canonical origin exactly. Rejects `?`, `#`, paths,
 * credentials, uppercase host/scheme, explicit default ports, and duplicates.
 * Returns the deduplicated canonical origin set.
 */
function canonicalAllowlist(allowlist: readonly string[]): readonly string[] {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    throw new Error("allowlist must be a non-empty array of origins");
  }
  if (allowlist.length > MAX_ALLOWLIST_ENTRIES) {
    throw new Error(
      `allowlist exceeds maximum entry cardinality: ${MAX_ALLOWLIST_ENTRIES}`,
    );
  }
  const seen = new Set<string>();
  for (const entry of allowlist) {
    if (typeof entry !== "string") {
      throw new Error(`allowlist entry must be a string: ${String(entry)}`);
    }
    // Cheap char-length preflight: UTF-8 byte length >= UTF-16 unit count, so
    // an over-length entry is definitely over the byte bound without encoding.
    if (entry.length > MAX_ALLOWLIST_ENTRY_BYTES) {
      throw new Error(
        `allowlist entry exceeds maximum length: ${MAX_ALLOWLIST_ENTRY_BYTES}`,
      );
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`malformed allowlist origin: ${entry}`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`allowlist origin must use https: ${entry}`);
    }
    if (url.username !== "" || url.password !== "") {
      throw new Error(`allowlist origin must not carry credentials: ${entry}`);
    }
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      throw new Error(`allowlist origin must be a bare origin: ${entry}`);
    }
    const canonical = url.origin;
    // Require the raw entry to equal the canonical origin so uppercase hosts,
    // explicit default ports, and other noncanonical spellings are rejected.
    if (entry !== canonical) {
      throw new Error(`allowlist origin is not canonical: ${entry}`);
    }
    if (seen.has(canonical)) {
      throw new Error(`allowlist origin is duplicated: ${canonical}`);
    }
    seen.add(canonical);
  }
  return [...seen];
}

/**
 * Canonical origin of a parsed `origin` string. Throws if it is not a bare
 * `https://` origin (no path/query/fragment/credentials/non-https scheme).
 */
function canonicalOriginOf(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`malformed origin: ${origin}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`origin must use https: ${origin}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`origin must not carry credentials: ${origin}`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`origin must be a bare origin: ${origin}`);
  }
  return url.origin;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  let idx = haystack.indexOf(needle, from);
  while (idx !== -1) {
    count += 1;
    from = idx + needle.length;
    idx = haystack.indexOf(needle, from);
  }
  return count;
}

function findNthOccurrence(haystack: string, needle: string, n: number): number {
  if (needle.length === 0 || n < 1) return -1;
  let idx = -1;
  for (let i = 0; i < n; i += 1) {
    idx = haystack.indexOf(needle, idx === -1 ? 0 : idx + needle.length);
    if (idx === -1) return -1;
  }
  return idx;
}

function deepFreezeLive(value: {
  readonly status: "live";
  readonly modelId: string;
  readonly requestId: string;
  readonly decision: DecisionId;
  readonly evidence: readonly DecisionProofEvidence[];
  readonly observedAt: string;
  readonly origin: string;
}): LiveDecisionProofResult {
  const evidence = Object.freeze(
    value.evidence.map((e) => Object.freeze({ ...e })),
  );
  const frozen = Object.freeze({ ...value, evidence }) as LiveDecisionProofResult;
  liveProvenance.add(frozen);
  return frozen;
}

function deepFreezeNonLive(
  value: NonLiveDecisionProofResult,
): NonLiveDecisionProofResult {
  return Object.freeze({ ...value });
}

// Cheap shallow preflight on untrusted result fields. Rejects obviously
// oversized or over-cardinality inputs before Zod parsing or TextEncoder
// allocation. UTF-8 byte length >= UTF-16 unit count, so a char-length overage
// is a strict over-limit signal and needs no encoding. Never throws out of
// band: hostile getters/proxies are caught and skipped, leaving the existing
// strict Zod parser to reject. Only type/length/cardinality gates — no
// semantic validation is duplicated.
function preflightStringOver(obj: object, key: string, maxChars: number): void {
  let value: unknown;
  try {
    value = (obj as Record<string, unknown>)[key];
  } catch {
    return;
  }
  if (typeof value === "string" && value.length > maxChars) {
    throw new Error(`${key} exceeds maximum length: ${maxChars}`);
  }
}

function preflightResultFields(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  let status: unknown;
  try {
    status = (input as { status?: unknown }).status;
  } catch {
    return;
  }
  if (status === "live") {
    preflightStringOver(input, "modelId", MAX_MODEL_ID_BYTES);
    preflightStringOver(input, "requestId", MAX_REQUEST_ID_BYTES);
    preflightStringOver(input, "origin", MAX_ORIGIN_BYTES);
    preflightStringOver(input, "observedAt", MAX_OBSERVED_AT_BYTES);
    let evidence: unknown;
    try {
      evidence = (input as { evidence?: unknown }).evidence;
    } catch {
      return;
    }
    if (!Array.isArray(evidence)) return;
    if (evidence.length > MAX_EVIDENCE) {
      throw new Error(`evidence exceeds maximum cardinality: ${MAX_EVIDENCE}`);
    }
    for (const ev of evidence) {
      if (typeof ev !== "object" || ev === null) continue;
      preflightStringOver(ev, "id", MAX_EVIDENCE_ID_BYTES);
      preflightStringOver(ev, "text", MAX_EVIDENCE_TEXT_BYTES);
    }
    return;
  }
  if (
    status === "local_fallback" ||
    status === "unavailable" ||
    status === "rejected"
  ) {
    preflightStringOver(input, "reason", MAX_REASON_BYTES);
  }
}

/**
 * Parse and validate a decision-proof result. Throws on any violation.
 *
 * A `live` result requires `evidenceText`: the source text the model claims its
 * snippets occur in. Every snippet must be present and its occurrence index
 * must not exceed the actual count. Arbitrary snippets cannot gain a live
 * receipt without exact occurrence validation. Non-live results do not require
 * `evidenceText`.
 */
export function parseDecisionProofResult(
  input: unknown,
  allowlist: readonly string[],
  evidenceText?: string,
): DecisionProofResult {
  const canonical = canonicalAllowlist(allowlist);
  const canonicalSet = new Set(canonical);
  preflightResultFields(input);
  const parsed = resultSchema.parse(input) as
    | z.infer<typeof liveSchema>
    | z.infer<typeof nonLiveSchema>;

  if (parsed.status === "live") {
    if (evidenceText === undefined) {
      throw new Error("live result requires evidenceText for occurrence validation");
    }
    if (typeof evidenceText !== "string") {
      throw new Error("evidenceText must be a string");
    }
    // Cheap char-length preflight before the O(n*m) occurrence scan so a
    // hostile huge source cannot force proportional work or allocation.
    if (evidenceText.length > MAX_EVIDENCE_TEXT_INPUT_LENGTH) {
      throw new Error(
        `evidenceText exceeds maximum input length: ${MAX_EVIDENCE_TEXT_INPUT_LENGTH}`,
      );
    }
    const origin = canonicalOriginOf(parsed.origin);
    if (!canonicalSet.has(origin)) {
      throw new Error(`origin not on approved allowlist: ${parsed.origin}`);
    }
    const ids = parsed.evidence.map((e) => e.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("duplicate evidence id");
    }
    for (const ev of parsed.evidence) {
      const count = countOccurrences(evidenceText, ev.text);
      if (count === 0) {
        throw new Error(`evidence text absent from source: ${ev.id}`);
      }
      if (ev.occurrence > count) {
        throw new Error(`occurrence out of range: ${ev.id}`);
      }
    }
    return deepFreezeLive({
      status: "live",
      modelId: parsed.modelId,
      requestId: parsed.requestId,
      decision: parsed.decision as DecisionId,
      evidence: parsed.evidence.map((e) => ({
        id: e.id,
        text: e.text,
        occurrence: e.occurrence,
      })),
      observedAt: parsed.observedAt,
      origin,
    });
  }

  return deepFreezeNonLive({
    status: parsed.status,
    reason: parsed.reason,
  });
}

export function safeParseDecisionProofResult(
  input: unknown,
  allowlist: readonly string[],
  evidenceText?: string,
): SafeParseResult {
  try {
    const value = parseDecisionProofResult(input, allowlist, evidenceText);
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [message] };
  }
}

/**
 * Resolve each evidence snippet to its exact span in `evidenceText`. The span
 * starts at the actual match index and ends at `start + snippet` UTF-16 length,
 * so `evidenceText.slice(start, end) === snippet`. Throws if any occurrence is
 * absent (fail closed — no `-1` sentinel). Returns `[]` for non-live results.
 */
export function resolveDecisionProofEvidence(
  result: DecisionProofResult,
  evidenceText: string,
): readonly DecisionProofEvidenceSpan[] {
  if (result.status !== "live") return [];
  const spans: DecisionProofEvidenceSpan[] = [];
  for (const ev of result.evidence) {
    const matchIndex = findNthOccurrence(evidenceText, ev.text, ev.occurrence);
    if (matchIndex === -1) {
      throw new Error(`evidence occurrence not found in source: ${ev.id}`);
    }
    const start = matchIndex;
    const end = matchIndex + ev.text.length;
    spans.push(
      Object.freeze({ id: ev.id, start, end, text: ev.text }),
    );
  }
  return Object.freeze(spans);
}

/**
 * Build a clickable receipt URL for a live result only. Revalidates complete
 * live provenance: module-private `WeakSet` membership (only
 * `parseDecisionProofResult` can add a frozen live result, and only after the
 * existing exact parser/validator has passed), the origin (canonical https
 * bare origin on the supplied allowlist), and the requestId (`req_<token>`
 * grammar with no key-like `sk-`/`sk_` segment) before emitting any link.
 * Non-live, missing, forged, cloned, or malformed results get no external
 * link (fail closed → null). No key or prompt payload is ever placed in the
 * URL.
 */
export function buildReceiptUrl(
  result: unknown,
  allowlist: readonly string[],
): string | null {
  // Accept unknown and never throw: null, undefined, primitives, proxies that
  // trap throws, or any malformed shape fails closed to null. The docstring
  // promises "malformed -> null", so the guard must precede every dereference.
  if (typeof result !== "object" || result === null) return null;
  let status: unknown;
  try {
    status = (result as { status?: unknown }).status;
  } catch {
    return null;
  }
  if (status !== "live") return null;
  // Revalidate complete live provenance, not only a safe-looking origin and
  // request id. Membership is by object identity in a module-private WeakSet
  // populated only inside `parseDecisionProofResult` after exact validation.
  // A copied symbol, copied property bag, or shallow/deep clone is not a
  // member and fails closed even if its origin and requestId look valid.
  if (!liveProvenance.has(result as object)) return null;
  let canonicalSet: Set<string>;
  try {
    canonicalSet = new Set(canonicalAllowlist(allowlist));
  } catch {
    return null;
  }
  let origin: string;
  let requestId: string;
  try {
    origin = canonicalOriginOf((result as { origin: string }).origin);
    requestId = (result as { requestId: string }).requestId;
  } catch {
    return null;
  }
  if (typeof requestId !== "string") return null;
  if (!canonicalSet.has(origin)) return null;
  if (!REQUEST_ID_PATTERN.test(requestId)) return null;
  // Defense-in-depth at the URL emission boundary: reject any key-like
  // `sk-`/`sk_` segment even if a future caller bypasses parse validation.
  if (REQUEST_ID_KEY_SEGMENT_PATTERN.test(requestId.slice(4))) return null;
  return `${origin}/proof?receipt=${requestId}`;
}

function canonicalEvidenceList(
  evidence: readonly DecisionProofEvidence[],
): DecisionProofEvidence[] {
  return [...evidence]
    .map((e) => ({ id: e.id, text: e.text, occurrence: e.occurrence }))
    .sort((a, b) =>
      a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : a.text < b.text
            ? -1
            : a.text > b.text
              ? 1
              : a.occurrence - b.occurrence,
    );
}

/**
 * Deterministic canonical JSON for digesting. Evidence is sorted by
 * (id, text, occurrence) so reordering does not change the digest. Keys are
 * emitted in a fixed order.
 */
function canonicalJson(result: DecisionProofResult): string {
  if (result.status === "live") {
    const evidence = canonicalEvidenceList(result.evidence);
    return JSON.stringify({
      status: result.status,
      modelId: result.modelId,
      requestId: result.requestId,
      decision: result.decision,
      observedAt: result.observedAt,
      origin: result.origin,
      evidence,
    });
  }
  return JSON.stringify({
    status: result.status,
    reason: result.reason,
  });
}

export function computeDecisionProofDigest(
  result: DecisionProofResult,
): `0x${string}` {
  const bytes = new TextEncoder().encode(canonicalJson(result));
  return toHex(blake2b256(bytes));
}

export function canonicalizeDecisionProofResult(
  result: DecisionProofResult,
): CanonicalDecisionProof {
  const digest = computeDecisionProofDigest(result);
  if (result.status === "live") {
    return Object.freeze({
      status: result.status,
      digest,
      advisoryOnly: true,
      modelId: result.modelId,
      requestId: result.requestId,
      decision: result.decision,
      evidence: Object.freeze(
        canonicalEvidenceList(result.evidence).map((e) => Object.freeze({ ...e })),
      ),
      observedAt: result.observedAt,
      origin: result.origin,
    });
  }
  return Object.freeze({
    status: result.status,
    digest,
    advisoryOnly: true,
    reason: result.reason,
  });
}

// Collision-free structural encoding of the canonical evidence set. JSON
// escapes `|`, newlines, quotes, and backslashes inside strings and preserves
// the tuple array structure, so no evidence text can mimic a field or entry
// boundary (the failure mode of the old `id|text|occurrence` + `\n`.join).
function evidenceSetSignature(
  evidence: readonly DecisionProofEvidence[],
): string {
  return JSON.stringify(
    canonicalEvidenceList(evidence).map((e) => [e.id, e.text, e.occurrence]),
  );
}

/**
 * Compare two results deterministically. Never returns approval, authorization,
 * truth, settlement, or trade proof — only advisory agreement states.
 *
 * - neither live -> `unavailable`
 * - exactly one live -> `partial`
 * - both live, same requestId -> `partial` (non-independent provenance)
 * - both live, same modelId -> `partial` (non-independent model, even with
 *   distinct request ids — agreement requires distinct model provenance)
 * - both live, distinct model + request ids, different decisions -> `disagreement`
 * - both live, distinct model + request ids, same decision, same evidence -> `agreement`
 * - both live, distinct model + request ids, same decision, differing evidence -> `partial`
 */
export function compareDecisionProofs(
  a: DecisionProofResult,
  b: DecisionProofResult,
): DecisionProofComparison {
  const aLive = a.status === "live";
  const bLive = b.status === "live";
  if (!aLive && !bLive) return "unavailable";
  if (aLive !== bLive) return "partial";

  const liveA = a as LiveDecisionProofResult;
  const liveB = b as LiveDecisionProofResult;
  if (liveA.requestId === liveB.requestId) return "partial";
  if (liveA.modelId === liveB.modelId) return "partial";
  if (liveA.decision !== liveB.decision) return "disagreement";
  if (evidenceSetSignature(liveA.evidence) === evidenceSetSignature(liveB.evidence)) {
    return "agreement";
  }
  return "partial";
}
