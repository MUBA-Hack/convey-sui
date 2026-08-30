/**
 * Generic GonkaRouter structured-router core.
 *
 * One hardened OpenAI-compatible transport/retry/provenance stack shared by
 * thin domain wrappers (commerce, remittance). A domain supplies its strict
 * input/candidate/manifest Zod schemas, system + repair prompts, user-message
 * builder, manifest validator, and repair-message builder. The core preserves
 * request id, requested/response model ids, usage, latency, the full visible
 * attempt trail, JSON-mode fallback, one repair, and the safe failure enums.
 *
 * The model never receives wallet addresses, keys, digests, transaction bytes,
 * or signing/confirmation authority — the domain manifest is the only data the
 * user message carries. Malformed output never becomes an executable payload.
 */

import OpenAI from "openai";
import type { z } from "zod";
import {
  getGonkaErrorStatus,
  isGonkaTimeoutError,
  runWithVisibleRetry,
  VisibleRetryError,
  type VisibleRetryAttempt,
} from "./retry";
import type {
  GonkaAdapterConfig,
  GonkaAdapterDependencies,
  GonkaAttemptError,
  GonkaAttemptKind,
  GonkaAttemptRecord,
  GonkaResponseMetadata,
  GonkaRunErr,
  GonkaTokenUsage,
} from "./types";

export const DEFAULT_BASE_URL = "https://api.gonkarouter.io/v1";
export const DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash-0731";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_TOKENS = 1_024;

const JSON_PROMPT_FALLBACK_SUFFIX =
  " JSON only; no markdown fences or prose outside the object.";

/**
 * Domain spec supplied by a thin wrapper. The schemas, prompts, and message
 * builders are the only things that vary between commerce and remittance.
 */
export interface GonkaDomainSpec<
  TInput extends { prompt: string; localeHint: string },
  TManifest,
  TCandidate,
> {
  manifestSchema: z.ZodType<TManifest>;
  inputSchema: z.ZodType<TInput>;
  candidateSchema: z.ZodType<TCandidate>;
  systemPrompt: string;
  repairSystemPrompt: string;
  /** Optional suffix appended to the system prompt on the JSON-prompt fallback. */
  jsonPromptFallbackSuffix?: string;
  /** Build the user message from the validated input. Carries only public data. */
  buildUserMessage(input: TInput): string;
  /** Extract the manifest payload from the input (e.g. `catalog` or `manifest`). */
  getManifest(input: TInput): TManifest;
  /** Throw if the candidate references ids absent from the frozen manifest. */
  validateCandidateAgainstManifest(candidate: TCandidate, manifest: TManifest): void;
  /** Build the repair user message from the invalid content + manifest. */
  buildRepairUserMessage(invalidContent: string, manifest: TManifest): string;
  /** Key name used to prefer a candidate object when extracting JSON from prose. */
  candidateKeyHint?: string;
}

export interface GonkaRunOkGeneric<TCandidate> {
  type: "gonka-run-ok";
  candidate: TCandidate;
  metadata: GonkaResponseMetadata;
  attempts: GonkaAttemptRecord[];
}

export type GonkaRunResultGeneric<TCandidate> =
  | GonkaRunOkGeneric<TCandidate>
  | GonkaRunErr;

export interface GonkaStructuredRouter<TInput, TCandidate> {
  run(input: TInput): Promise<GonkaRunResultGeneric<TCandidate>>;
}

type GonkaMessage = {
  role: "system" | "user";
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseMetadata(response: unknown): {
  gonkaRequestId: string;
  responseModel?: string;
  content?: string;
} {
  if (!isRecord(response)) return { gonkaRequestId: "" };
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices[0];
  const message =
    isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined;

  return {
    gonkaRequestId: typeof response.id === "string" ? response.id : "",
    ...(typeof response.model === "string" ? { responseModel: response.model } : {}),
    ...(typeof message?.content === "string" ? { content: message.content } : {}),
  };
}

function tokenUsage(response: unknown): GonkaTokenUsage {
  if (!isRecord(response) || !isRecord(response.usage)) return {};
  const inputTokens = response.usage.prompt_tokens;
  const outputTokens = response.usage.completion_tokens;
  const usage: GonkaTokenUsage = {};
  if (typeof inputTokens === "number" && Number.isInteger(inputTokens) && inputTokens >= 0) {
    usage.inputTokens = inputTokens;
  }
  if (typeof outputTokens === "number" && Number.isInteger(outputTokens) && outputTokens >= 0) {
    usage.outputTokens = outputTokens;
  }
  return usage;
}

/**
 * Extract the LAST balanced top-level JSON object from model content. Reasoning
 * models may stream deliberation prose or fences around the final object even
 * under response_format. When `candidateKeyHint` is supplied, prefer objects
 * containing that key. The raw content is never returned to the UI.
 */
export function extractJsonObject(content: string, candidateKeyHint?: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    // fall through to candidate extraction
  }
  const visible = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const candidates: unknown[] = [];
  let index = visible.indexOf("{");
  while (index !== -1) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = index; i < visible.length; i += 1) {
      const ch = visible[i];
      if (inString) {
        if (ch === "\\") i += 1;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    let next = index + 1;
    try {
      candidates.push(JSON.parse(visible.slice(index, end + 1)) as unknown);
      next = end + 1;
    } catch {
      // keep next = index + 1
    }
    index = visible.indexOf("{", next);
  }
  const keyed =
    candidateKeyHint !== undefined
      ? candidates.filter(
          (candidate) =>
            typeof candidate === "object" && candidate !== null && candidateKeyHint in candidate,
        )
      : candidates;
  const chosen = keyed.at(-1) ?? candidates.at(-1);
  if (chosen === undefined) {
    throw new Error("no parseable JSON object in model content");
  }
  return chosen;
}

function errorText(error: unknown): string {
  if (!isRecord(error)) return String(error);
  const pieces = [
    typeof error.message === "string" ? error.message : "",
    typeof error.code === "string" ? error.code : "",
  ];
  if ("error" in error) {
    try {
      pieces.push(JSON.stringify(error.error));
    } catch {
      pieces.push("");
    }
  }
  return pieces.join(" ").toLowerCase();
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (getGonkaErrorStatus(error) !== 400) return false;
  const text = errorText(error);
  return (
    (text.includes("response_format") ||
      text.includes("json_object") ||
      text.includes("json mode")) &&
    (text.includes("unsupported") || text.includes("not support"))
  );
}

function errorSummary(error: unknown): GonkaAttemptError {
  const httpStatus = getGonkaErrorStatus(error);
  if (isGonkaTimeoutError(error)) {
    return { category: "TIMEOUT", ...(httpStatus ? { httpStatus } : {}) };
  }
  if (httpStatus !== undefined) return { category: "HTTP_ERROR", httpStatus };
  return { category: "CONNECTION_ERROR" };
}

type ProviderExecution =
  | { ok: true; response: unknown; requestedAtMs: number; completedAtMs: number; kind: GonkaAttemptKind; retriesConsumed: number }
  | { ok: false; error: unknown; kind: GonkaAttemptKind; retriesConsumed: number };

/**
 * Create a generic GonkaRouter structured router. Server-only — the API key
 * never leaves this closure and is never logged or returned to the UI.
 */
export function createGonkaStructuredRouter<TInput extends { prompt: string; localeHint: string }, TManifest, TCandidate>(
  spec: GonkaDomainSpec<TInput, TManifest, TCandidate>,
  cfg: GonkaAdapterConfig,
  dependencies: GonkaAdapterDependencies = {},
): GonkaStructuredRouter<TInput, TCandidate> {
  if (cfg.apiKey.trim().length === 0) {
    throw new Error("GonkaRouter apiKey is required");
  }
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const modelId = cfg.modelId;
  if (modelId.trim().length === 0) {
    throw new Error("GonkaRouter modelId is required");
  }
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }
  const maxRetries = cfg.maxRetries ?? 1;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
    throw new RangeError("maxRetries must be 0 or 1");
  }

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: baseUrl,
    timeout: timeoutMs,
    // SDK retries stay disabled so every application retry is visible.
    maxRetries: 0,
    // All application logs are redacted by the caller; keep the SDK quiet.
    logLevel: "off",
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });
  const now = dependencies.now ?? Date.now;
  const fallbackSuffix = spec.jsonPromptFallbackSuffix ?? JSON_PROMPT_FALLBACK_SUFFIX;

  async function executeProviderRequest(
    kind: GonkaAttemptKind,
    messages: GonkaMessage[],
    includeResponseFormat: boolean,
    retriesRemaining: number,
    attempts: GonkaAttemptRecord[],
  ): Promise<ProviderExecution> {
    try {
      const result = await runWithVisibleRetry(
        async () =>
          client.chat.completions.create({
            model: modelId,
            temperature: 0,
            max_tokens: MAX_OUTPUT_TOKENS,
            messages,
            ...(includeResponseFormat
              ? { response_format: { type: "json_object" as const } }
              : {}),
          }),
        {
          maxRetries: retriesRemaining,
          now,
          random: dependencies.random,
          sleep: dependencies.sleep,
        },
      );

      result.attempts.forEach((visible, index) => {
        if (!visible.ok) {
          appendProviderFailure(
            visible as Extract<VisibleRetryAttempt<unknown>, { ok: false }>,
            index === 0 ? kind : "RETRY",
            attempts,
          );
        }
      });
      const success = result.attempts.at(-1);
      if (!success?.ok) throw new Error("visible retry result has no successful attempt");
      const retried = result.attempts.length > 1;
      return {
        ok: true,
        response: result.value,
        requestedAtMs: success.requestedAtMs,
        completedAtMs: success.completedAtMs,
        kind: retried ? "RETRY" : kind,
        retriesConsumed: result.attempts.length - 1,
      };
    } catch (error) {
      if (!(error instanceof VisibleRetryError)) {
        return { ok: false, error, kind, retriesConsumed: 0 };
      }
      error.attempts.forEach((visible, index) => {
        if (!visible.ok) {
          appendProviderFailure(
            visible as Extract<VisibleRetryAttempt<unknown>, { ok: false }>,
            index === 0 ? kind : "RETRY",
            attempts,
          );
        }
      });
      const last = error.attempts.at(-1);
      const cause = last && !last.ok ? last.error : error;
      return { ok: false, error: cause, kind, retriesConsumed: error.attempts.length - 1 };
    }
  }

  function appendProviderFailure(
    visible: Extract<VisibleRetryAttempt<unknown>, { ok: false }>,
    kind: GonkaAttemptKind,
    attempts: GonkaAttemptRecord[],
  ): void {
    attempts.push({
      type: "gonka-attempt",
      kind,
      status: isGonkaTimeoutError(visible.error) ? "TIMEOUT" : "PROVIDER_ERROR",
      requestedAtMs: visible.requestedAtMs,
      completedAtMs: visible.completedAtMs,
      latencyMs: Math.max(0, visible.completedAtMs - visible.requestedAtMs),
      error: errorSummary(visible.error),
    });
  }

  function appendReceivedResponse(
    response: unknown,
    kind: GonkaAttemptKind,
    requestedAtMs: number,
    completedAtMs: number,
    status: GonkaAttemptRecord["status"],
    attempts: GonkaAttemptRecord[],
  ): { metadata: ReturnType<typeof responseMetadata>; usage: GonkaTokenUsage } {
    const metadata = responseMetadata(response);
    const usage = tokenUsage(response);
    attempts.push({
      type: "gonka-attempt",
      kind,
      status,
      requestedAtMs,
      completedAtMs,
      latencyMs: Math.max(0, completedAtMs - requestedAtMs),
      ...(metadata.gonkaRequestId.trim().length > 0
        ? { gonkaRequestId: metadata.gonkaRequestId }
        : {}),
      ...(metadata.responseModel ? { responseModel: metadata.responseModel } : {}),
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    });
    return { metadata, usage };
  }

  type ProcessOutcome =
    | { valid: true; candidate: TCandidate; metadata: GonkaResponseMetadata }
    | { valid: false; content: string; reason: GonkaRunErr["reason"] };

  function processResponse(
    response: unknown,
    kind: GonkaAttemptKind,
    requestedAtMs: number,
    completedAtMs: number,
    manifest: TManifest,
    attempts: GonkaAttemptRecord[],
  ): ProcessOutcome {
    const { metadata, usage } = appendReceivedResponse(
      response,
      kind,
      requestedAtMs,
      completedAtMs,
      "INVALID_SCHEMA",
      attempts,
    );

    if (metadata.gonkaRequestId.trim().length === 0) {
      const last = attempts.at(-1);
      if (last) {
        last.status = "PROVIDER_ERROR";
        last.error = { category: "INVALID_RESPONSE" };
      }
      return { valid: false, content: metadata.content ?? "null", reason: "MISSING_REQUEST_ID" };
    }
    if (metadata.responseModel !== modelId) {
      const last = attempts.at(-1);
      if (last) {
        last.status = "PROVIDER_ERROR";
        last.error = { category: "INVALID_RESPONSE" };
      }
      return { valid: false, content: metadata.content ?? "null", reason: "MODEL_MISMATCH" };
    }
    if (metadata.content === undefined) {
      const last = attempts.at(-1);
      if (last) {
        last.status = "PROVIDER_ERROR";
        last.error = { category: "INVALID_RESPONSE" };
      }
      return { valid: false, content: "null", reason: "INVALID_SCHEMA" };
    }

    let decoded: unknown;
    try {
      decoded = extractJsonObject(metadata.content, spec.candidateKeyHint);
    } catch {
      return { valid: false, content: metadata.content, reason: "INVALID_SCHEMA" };
    }

    let parsed: TCandidate;
    try {
      parsed = spec.candidateSchema.parse(decoded) as TCandidate;
    } catch {
      return { valid: false, content: metadata.content, reason: "INVALID_SCHEMA" };
    }

    try {
      spec.validateCandidateAgainstManifest(parsed, manifest);
    } catch {
      return { valid: false, content: metadata.content, reason: "INVALID_SCHEMA" };
    }

    const last = attempts.at(-1);
    if (last) last.status = "SCHEMA_VALID";

    const responseMetadata_: GonkaResponseMetadata = {
      gonkaRequestId: metadata.gonkaRequestId,
      responseModel: metadata.responseModel ?? modelId,
      latencyMs: Math.max(0, completedAtMs - requestedAtMs),
      usage,
    };
    return { valid: true, candidate: parsed, metadata: responseMetadata_ };
  }

  async function run(input: TInput): Promise<GonkaRunResultGeneric<TCandidate>> {
    // Validate input through the strict schema before touching the provider.
    const manifest = spec.manifestSchema.parse(spec.getManifest(input)) as TManifest;
    const validatedInput = spec.inputSchema.parse(input) as TInput;

    const attempts: GonkaAttemptRecord[] = [];
    let retriesRemaining = maxRetries;
    let jsonResponseFormat = true;

    const primaryMessages: GonkaMessage[] = [
      { role: "system", content: spec.systemPrompt },
      { role: "user", content: spec.buildUserMessage(validatedInput) },
    ];

    let provider = await executeProviderRequest(
      "PRIMARY",
      primaryMessages,
      true,
      retriesRemaining,
      attempts,
    );
    retriesRemaining = Math.max(0, retriesRemaining - provider.retriesConsumed);

    if (!provider.ok && isResponseFormatUnsupported(provider.error)) {
      jsonResponseFormat = false;
      provider = await executeProviderRequest(
        "JSON_PROMPT_FALLBACK",
        [
          { role: "system", content: `${spec.systemPrompt}${fallbackSuffix}` },
          primaryMessages[1] as GonkaMessage,
        ],
        false,
        retriesRemaining,
        attempts,
      );
      retriesRemaining = Math.max(0, retriesRemaining - provider.retriesConsumed);
    }

    if (!provider.ok) {
      return failClosed("PROVIDER_ERROR", attempts);
    }

    const initial = processResponse(
      provider.response,
      provider.kind,
      provider.requestedAtMs,
      provider.completedAtMs,
      manifest,
      attempts,
    );
    if (initial.valid) {
      return { type: "gonka-run-ok", candidate: initial.candidate, metadata: initial.metadata, attempts };
    }

    // Provider integrity failures (missing request id, model mismatch) are not
    // schema issues and must NOT trigger a repair — the response itself is
    // untrustworthy. Fail closed immediately.
    if (initial.reason === "MISSING_REQUEST_ID" || initial.reason === "MODEL_MISMATCH") {
      return failClosed(initial.reason, attempts);
    }

    // Invalid schema -> at most one repair attempt. The repair prompt cannot
    // add facts or authority.
    const repairMessages: GonkaMessage[] = [
      { role: "system", content: spec.repairSystemPrompt },
      { role: "user", content: spec.buildRepairUserMessage(initial.content.slice(0, 4_000), manifest) },
    ];
    const repair = await executeProviderRequest(
      "REPAIR",
      repairMessages,
      jsonResponseFormat,
      retriesRemaining,
      attempts,
    );

    if (!repair.ok) {
      return failClosed("REPAIR_FAILED", attempts);
    }

    const repaired = processResponse(
      repair.response,
      "REPAIR",
      repair.requestedAtMs,
      repair.completedAtMs,
      manifest,
      attempts,
    );
    if (repaired.valid) {
      return {
        type: "gonka-run-ok",
        candidate: repaired.candidate,
        metadata: repaired.metadata,
        attempts,
      };
    }
    return failClosed("REPAIR_FAILED", attempts);
  }

  function failClosed(
    reason: GonkaRunErr["reason"],
    attempts: GonkaAttemptRecord[],
  ): GonkaRunErr {
    // Never leak the API key or raw provider error body. The reason enum is
    // the only signal the UI receives; full detail stays in the attempt trail
    // which contains only redacted categories and HTTP statuses.
    return { type: "gonka-run-err", reason, attempts };
  }

  return { run };
}
