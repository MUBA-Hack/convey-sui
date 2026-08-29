/**
 * GonkaRouter commerce intent router — public type surface.
 *
 * Server-only. The adapter sends a bounded catalog manifest (public item and
 * merchant names/prices) plus the user prompt and a locale hint to GonkaRouter
 * and returns a strictly typed candidate intent. It never receives wallet
 * addresses, keys, digests, transaction bytes, or signing/confirmation
 * authority. Malformed output never becomes a payment — the route layer must
 * re-validate every candidate against the canonical catalog before checkout.
 */

/** A single public catalog entry the model is allowed to see. */
export interface GonkaCatalogItemRef {
  id: string;
  name: string;
  priceSui: string;
}

/** A single public merchant entry the model is allowed to see. */
export interface GonkaCatalogMerchantRef {
  id: string;
  name: string;
  itemIds: string[];
}

/** Bounded manifest shipped to the model. No addresses, no keys, no authority. */
export interface GonkaCatalogManifest {
  merchants: GonkaCatalogMerchantRef[];
  items: GonkaCatalogItemRef[];
}

/** Free-text purchase request the route layer hands to the adapter. */
export interface GonkaIntentInput {
  prompt: string;
  localeHint: string;
  catalog: GonkaCatalogManifest;
}

/** Candidate intent the model is allowed to emit. */
export interface GonkaIntentCandidate {
  itemId: string;
  itemName: string;
  merchantId: string;
  merchantName: string;
  quantity: number;
  maxSpendSui: string;
  detectedLanguage: string;
  explanation: string;
  confidence: number;
}

/** Token usage captured from a valid response. */
export interface GonkaTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Metadata captured from a valid GonkaRouter response. */
export interface GonkaResponseMetadata {
  gonkaRequestId: string;
  responseModel: string;
  latencyMs: number;
  usage: GonkaTokenUsage;
}

/** A single visible attempt in the run audit trail. */
export type GonkaAttemptKind =
  | "PRIMARY"
  | "RETRY"
  | "JSON_PROMPT_FALLBACK"
  | "REPAIR";

export type GonkaAttemptErrorCategory =
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "CONNECTION_ERROR"
  | "INVALID_RESPONSE";

export interface GonkaAttemptError {
  category: GonkaAttemptErrorCategory;
  httpStatus?: number;
}

export interface GonkaAttemptRecord {
  type: "gonka-attempt";
  kind: GonkaAttemptKind;
  status:
    | "SCHEMA_VALID"
    | "INVALID_SCHEMA"
    | "TIMEOUT"
    | "PROVIDER_ERROR";
  requestedAtMs: number;
  completedAtMs: number;
  latencyMs: number;
  gonkaRequestId?: string;
  responseModel?: string;
  usage?: GonkaTokenUsage;
  error?: GonkaAttemptError;
}

/** Successful run result. Carries the validated candidate and full audit trail. */
export interface GonkaRunOk {
  type: "gonka-run-ok";
  candidate: GonkaIntentCandidate;
  metadata: GonkaResponseMetadata;
  attempts: GonkaAttemptRecord[];
}

/** Failed run result. Never carries a candidate; route layer must fail closed. */
export interface GonkaRunErr {
  type: "gonka-run-err";
  reason:
    | "MISSING_API_KEY"
    | "MISSING_CONFIG"
    | "PROVIDER_ERROR"
    | "MISSING_REQUEST_ID"
    | "MODEL_MISMATCH"
    | "INVALID_SCHEMA"
    | "REPAIR_FAILED"
    | "JSON_FALLBACK_FAILED";
  attempts: GonkaAttemptRecord[];
}

export type GonkaRunResult = GonkaRunOk | GonkaRunErr;

/** Adapter configuration derived from server-only env. */
export interface GonkaAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Injectable dependencies for offline tests. */
export interface GonkaAdapterDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

/** Public adapter surface, ready for route integration in phase 2. */
export interface GonkaCommerceRouter {
  run(input: GonkaIntentInput): Promise<GonkaRunResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isGonkaRunOk(value: unknown): value is GonkaRunOk {
  return isRecord(value) && value.type === "gonka-run-ok";
}

export function isGonkaRunErr(value: unknown): value is GonkaRunErr {
  return isRecord(value) && value.type === "gonka-run-err";
}
