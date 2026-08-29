import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseIntent,
  MAX_INPUT_LENGTH,
  type PurchaseIntentResult,
  type RoutingMetadata,
  type FallbackReason,
} from "@/lib/commerce/intent";
import { getCatalog } from "@/lib/commerce/catalog";
import {
  buildGonkaCatalogManifest,
  resolveGonkaCandidate,
} from "@/lib/commerce/gonka-resolver";
import {
  createGonkaCommerceRouter,
  gonkaConfigFromEnv,
  type GonkaAdapterConfig,
  type GonkaCommerceRouter,
  type GonkaRunResult,
} from "@/lib/gonka";
import { isGonkaRunErr, isGonkaRunOk } from "@/lib/gonka/types";

/**
 * POST /api/commerce/intent
 *
 * Accepts a free-text purchase command and returns a strictly typed preview
 * or a specific clarification, plus honest routing provenance metadata.
 *
 * Routing policy:
 *  - If GonkaRouter is configured (a non-empty server-only API key) AND a
 *    router is available, the original user prompt is routed to GonkaRouter
 *    with a bounded public catalog manifest and a locale hint. The model never
 *    receives wallet addresses, keys, digests, transaction bytes, or signing
 *    authority.
 *  - The Gonka candidate is UNTRUSTED. It is re-resolved against the canonical
 *    catalog truth (ids, merchant-item relation, quantity, maxSpendSui cap)
 *    before any preview is shown. Gonka never creates tx bytes, recipients,
 *    digests, signatures, confirmations, or settlement.
 *  - On a valid Gonka route, the response carries the normal pending preview
 *    plus live routing metadata (provider gonkarouter, mode live, requestId,
 *    requestedModel/responseModel, latencyMs, usage, and compact
 *    detectedLanguage/confidence/explanation).
 *  - On missing config, provider failure, invalid metadata/schema/candidate,
 *    or deterministic policy rejection, the route falls back to the existing
 *    deterministic offline parser on the ORIGINAL text and returns the same
 *    functional result plus honest fallback routing metadata
 *    (provider deterministic, mode fallback, safe reason enum). The fallback
 *    never breaks offline/PWA demo and never implies Gonka ran.
 *  - The original submitted message is preserved exactly. No API key or raw
 *    provider error body ever reaches the UI.
 */

const RequestSchema = z.object({
  text: z.string().max(MAX_INPUT_LENGTH * 4),
  locale: z.string().max(32).optional(),
});

/**
 * Test-only dependency injection seam.
 *
 * Allows tests to inject a mockable router factory that produces a router with
 * the actual adapter shapes (GonkaRunOk / GonkaRunErr) WITHOUT making network
 * calls or mutating process.env. This is an internal export (prefixed `__`) and
 * is NOT part of the public API. Tests MUST clear it (pass null) in afterEach
 * to avoid module-global mutation leakage across files.
 */
export type GonkaRouterFactory = (config: GonkaAdapterConfig) => GonkaCommerceRouter;

const TEST_ROUTER_FACTORY: { current: GonkaRouterFactory | null } = { current: null };

/** @internal Test-only seam. Set to null after each test to avoid leakage. */
export function __setGonkaRouterFactoryForTest(factory: GonkaRouterFactory | null): void {
  TEST_ROUTER_FACTORY.current = factory;
}

/**
 * Map a Gonka run-err reason to a safe fallback reason enum. Never echoes raw
 * provider error text. A provider error whose last attempt was a timeout is
 * reported as `timeout` so the UI can label it honestly.
 */
function mapGonkaReasonToFallback(result: GonkaRunResult): FallbackReason {
  if (isGonkaRunOk(result)) return "provider_error";
  const reason = result.reason;
  if (reason === "MISSING_API_KEY" || reason === "MISSING_CONFIG") return "not_configured";
  if (reason === "MODEL_MISMATCH") return "model_mismatch";
  if (reason === "MISSING_REQUEST_ID") return "missing_request_id";
  if (reason === "INVALID_SCHEMA") return "invalid_schema";
  if (reason === "REPAIR_FAILED" || reason === "JSON_FALLBACK_FAILED") return "repair_failed";
  // PROVIDER_ERROR — inspect the attempt trail for an honest timeout label.
  const hadTimeout = result.attempts.some((attempt) => attempt.status === "TIMEOUT");
  return hadTimeout ? "timeout" : "provider_error";
}

function fallbackRouting(reason: FallbackReason): RoutingMetadata {
  return { provider: "deterministic", mode: "fallback", fallbackReason: reason };
}

function liveRouting(
  result: Extract<GonkaRunResult, { type: "gonka-run-ok" }>,
  requestedModel: string,
): RoutingMetadata {
  return {
    provider: "gonkarouter",
    mode: "live",
    requestId: result.metadata.gonkaRequestId,
    requestedModel,
    responseModel: result.metadata.responseModel,
    latencyMs: result.metadata.latencyMs,
    usage: result.metadata.usage,
    detectedLanguage: result.candidate.detectedLanguage,
    confidence: result.candidate.confidence,
    explanation: result.candidate.explanation,
  };
}

export async function POST(req: Request) {
  // --- Validate input exactly as before. ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Body must be { text: string }" },
      { status: 400 },
    );
  }

  // Preserve the original submitted message exactly.
  const text = parsed.data.text;
  const localeHint =
    typeof parsed.data.locale === "string" && parsed.data.locale.trim().length > 0
      ? parsed.data.locale.trim().slice(0, 32)
      : "en";

  // The deterministic fallback is always available and always runs on the
  // ORIGINAL text. It never breaks offline/PWA demo.
  const deterministic: PurchaseIntentResult = parseIntent(text);

  // --- Resolve Gonka configuration from server-only env (no secrets leaked). ---
  const env = process.env;
  const { config, configured } = gonkaConfigFromEnv(env);

  // Not configured AND no test-injected router → honest fallback immediately.
  // The app stays fully functional via the deterministic parser; the routing
  // metadata honestly reports `not_configured` so the UI never implies Gonka ran.
  if (!configured && TEST_ROUTER_FACTORY.current === null) {
    return NextResponse.json(
      { ...deterministic, routing: fallbackRouting("not_configured") },
      { status: 200 },
    );
  }

  // --- Build the router (real for production, injected for tests). ---
  let router: GonkaCommerceRouter;
  try {
    const factory =
      TEST_ROUTER_FACTORY.current ??
      ((cfg: GonkaAdapterConfig) => createGonkaCommerceRouter(cfg));
    router = factory(config);
  } catch {
    // Factory threw (e.g. bad config) — fail closed to deterministic.
    return NextResponse.json(
      { ...deterministic, routing: fallbackRouting("not_configured") },
      { status: 200 },
    );
  }

  // --- Route the original prompt with a bounded public catalog manifest. ---
  const manifest = buildGonkaCatalogManifest(getCatalog());
  let result: GonkaRunResult;
  try {
    result = await router.run({ prompt: text, localeHint, catalog: manifest });
  } catch {
    // Unexpected throw from the router seam — fail closed to deterministic.
    return NextResponse.json(
      { ...deterministic, routing: fallbackRouting("provider_error") },
      { status: 200 },
    );
  }

  // --- Provider failure / integrity failure → deterministic fallback. ---
  if (isGonkaRunErr(result)) {
    return NextResponse.json(
      { ...deterministic, routing: fallbackRouting(mapGonkaReasonToFallback(result)) },
      { status: 200 },
    );
  }

  // --- Valid candidate: treat as UNTRUSTED. Re-resolve against catalog truth. ---
  const resolved = resolveGonkaCandidate(result.candidate, getCatalog());
  if (!resolved.ok) {
    // Candidate ids/cap/quantity/merchant mismatch — fail closed to deterministic.
    return NextResponse.json(
      { ...deterministic, routing: fallbackRouting("candidate_rejected") },
      { status: 200 },
    );
  }

  // --- Valid Gonka-routed preview + honest live routing metadata. ---
  return NextResponse.json(
    { ...resolved.preview, routing: liveRouting(result, config.modelId) },
    { status: 200 },
  );
}

/**
 * GET /api/commerce/intent
 *
 * A small, secret-free status response that lets judges verify the configured
 * GonkaRouter state WITHOUT revealing the API key, base URL secrets, or any
 * provider error detail. It reports only whether a server-only API key is
 * present and which model id would be requested. This is secondary proof; the
 * primary proof of a live route is the `routing` metadata returned by the real
 * POST path (provider gonkarouter, mode live, requestId, responseModel).
 */
export async function GET() {
  const { config, configured } = gonkaConfigFromEnv(process.env);
  return NextResponse.json(
    {
      gonkaConfigured: configured,
      // The model id is a public, non-secret identifier (also in .env.example).
      // The API key, base URL, and any error detail are never exposed.
      requestedModel: config.modelId,
      // Honest label: the live route is only real when a key is configured AND
      // a POST succeeds with provider=gonkarouter; this status only reports
      // configuration, not a successful live call.
      liveRouteReady: configured,
    },
    { status: 200 },
  );
}
