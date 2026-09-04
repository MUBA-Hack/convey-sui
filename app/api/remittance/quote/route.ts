import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseRemittance,
  extractRemittanceFields,
  MAX_REMITTANCE_INPUT_LENGTH,
  type RemittanceParseResult,
  type RemittanceIntentInput,
} from "@/lib/remittance/parser";
import { buildQuote } from "@/lib/remittance/quote";
import {
  resolveRemittanceConfig,
  resolveRecipientForAlias,
  resolveGonkaRemittanceManifest,
  validateConfig,
} from "@/lib/remittance/server-config";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  QuoteEnvelopeSchema,
  buildFinancialIntentBinding,
  type QuoteEnvelope,
  type IntentReviewLive,
  type IntentReviewLocal,
} from "@/lib/remittance/quote-schema";
import { computeAttestation, type CanonicalFields } from "@/lib/remittance/attestation.server";
import {
  resolveGonkaRemittanceCandidate,
  type RemittanceReboundIntent,
} from "@/lib/remittance/gonka-resolver";
import {
  createGonkaRemittanceRouter,
  type GonkaRemittanceRouter,
  type GonkaRemittanceInput,
} from "@/lib/gonka/remittance";
import { gonkaConfigFromEnv, type GonkaAdapterConfig } from "@/lib/gonka";
import { isGonkaRunErr, isGonkaRunOk } from "@/lib/gonka/types";

/**
 * POST /api/remittance/quote
 *
 * Accepts a free-text remittance command (typed or spoken) and returns a
 * strictly typed reference quote envelope or a specific clarification.
 *
 * Routing policy:
 *  - When GonkaRouter is configured (a non-empty server-only API key) AND a
 *    router is available, the original user prompt is routed through
 *    createGonkaRemittanceRouter with a PUBLIC, non-sensitive manifest
 *    (recipient aliases, destination cities, corridor country — no wallet
 *    addresses, keys, or authority). The Gonka candidate is UNTRUSTED; it is
 *    re-resolved against the original text and the canonical manifest by
 *    resolveGonkaRemittanceCandidate before any quote is built. Gonka
 *    interprets intent; it never authorizes payment.
 *  - Deterministic parse/buildQuote/attestation stays authoritative settlement
 *    logic. The quote is always built from the deterministic builder; Gonka
 *    only influences which intent fields (destination city, purpose, max cap)
 *    are carried forward after fail-closed resolution.
 *  - When Gonka is absent, fails, or the candidate is rejected, the route
 *    preserves the working deterministic quote and returns honest local-review
 *    provenance (intentReview.reviewer = "local"). No fabricated live claim.
 *  - The response carries an intentReview object: live Gonka vs local review,
 *    purpose, optional maximum-family-limit in minor MYR, within-limit/not-set
 *    rule status, detected language, confidence/explanation (live only), and
 *    only safe provider metadata. Wallet addresses, secrets, raw model output,
 *    and attempt trails are never exposed to the model or the response.
 */

/**
 * Inference-attempt budget for the Gonka router adapter. The route clones the
 * resolved Gonka config and caps `timeoutMs` at this value (and `maxRetries`
 * at 0) before constructing the router, so a single inference attempt cannot
 * exceed the interactive-demo budget. A lower configured timeout is preserved.
 * This caps only the adapter's per-call timeout contract; it does not promise
 * that every response completes within this bound end-to-end.
 */
export const GONKA_INFERENCE_TIMEOUT_CAP_MS = 30_000;

const RequestSchema = z.strictObject({
  text: z.string().max(MAX_REMITTANCE_INPUT_LENGTH),
  /**
   * Optional interpretation mode. Omitted defaults to `"gonka"` for backward
   * compatibility. `"deterministic"` skips Gonka router construction/run even
   * when configured or a test factory is injected, and uses the deterministic
   * parse/build/attestation path with an honest `structured_input` local
   * review. Extra fields are still rejected by the strict object.
   */
  interpretationMode: z.enum(["deterministic", "gonka"]).optional(),
});

/**
 * Test-only dependency injection seam. Allows tests to inject a mockable
 * router factory that produces a router with the actual adapter shapes
 * WITHOUT making network calls or mutating process.env. This is an internal
 * export (prefixed `__`) and is NOT part of the public API. Tests MUST clear
 * it (pass null) in afterEach to avoid module-global mutation leakage.
 */
export type GonkaRemittanceRouterFactory = (
  config: GonkaAdapterConfig,
) => GonkaRemittanceRouter;

const TEST_ROUTER_FACTORY: { current: GonkaRemittanceRouterFactory | null } = {
  current: null,
};

/** @internal Test-only seam. Set to null after each test to avoid leakage. */
export function __setGonkaRemittanceRouterFactoryForTest(
  factory: GonkaRemittanceRouterFactory | null,
): void {
  TEST_ROUTER_FACTORY.current = factory;
}

/** Build a local intentReview from deterministic field extraction. */
function buildLocalIntentReview(
  text: string,
  fallbackReason: IntentReviewLocal["fallbackReason"],
): IntentReviewLocal {
  const extracted = extractRemittanceFields(text);
  if (!extracted.ok) {
    return {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason,
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    };
  }
  const f = extracted.fields;
  const ruleStatus: IntentReviewLocal["ruleStatus"] =
    f.maxAmountMinor !== null &&
    BigInt(f.amountMinor) <= BigInt(f.maxAmountMinor)
      ? "within_limit"
      : "not_set";
  return {
    reviewer: "local",
    mode: "fallback",
    provider: "deterministic",
    fallbackReason,
    purpose: f.purpose,
    maximumFamilyLimitMinor: f.maxAmountMinor,
    ruleStatus,
  };
}

/** Build a live intentReview from a resolved Gonka candidate. */
function buildLiveIntentReview(
  rebound: RemittanceReboundIntent,
  requestId: string,
  responseModel: string,
  detectedLanguage: string,
  confidence: number,
  explanation: string,
): IntentReviewLive {
  const ruleStatus: IntentReviewLive["ruleStatus"] =
    rebound.maxAmountMinor !== null &&
    BigInt(rebound.amountMinor) <= BigInt(rebound.maxAmountMinor)
      ? "within_limit"
      : "not_set";
  return {
    reviewer: "gonka",
    mode: "live",
    provider: "gonkarouter",
    requestId,
    responseModel,
    detectedLanguage,
    confidence,
    explanation,
    purpose: rebound.purpose,
    maximumFamilyLimitMinor: rebound.maxAmountMinor,
    ruleStatus,
  };
}

/** Convert a resolved rebound intent to a deterministic builder intent. */
function reboundToIntent(rebound: RemittanceReboundIntent): RemittanceIntentInput {
  return {
    kind: "intent",
    action: "send",
    amountMinor: rebound.amountMinor,
    currency: "MYR",
    recipient: rebound.recipient,
    destinationCity: rebound.destinationCity,
  };
}

export async function POST(req: Request) {
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

  const text = parsed.data.text;
  const interpretationMode = parsed.data.interpretationMode ?? "gonka";

  // Resolve reference-pricing config from server-only env (with safe defaults).
  const config = resolveRemittanceConfig(process.env);

  // Fail closed on a broken config: never build a quote on invalid pricing.
  const configError = validateConfig(config);
  if (configError) {
    return NextResponse.json(
      {
        kind: "clarification",
        clarification: {
          code: "unsupported_corridor",
          reason: "Remittance pricing is not available.",
        },
        action: null,
        amountMinor: null,
        currency: null,
        recipient: null,
        destinationCity: null,
      },
      { status: 200 },
    );
  }

  // --- Deterministic mode: skip Gonka entirely, even if configured or a test
  // router is injected. Honest `structured_input` local review — the user
  // supplied structured controls, so deterministic parse is the intended path,
  // not a Gonka failure or misconfiguration. ---
  if (interpretationMode === "deterministic") {
    return deterministicQuote(text, config, "structured_input");
  }

  // --- Resolve Gonka configuration from server-only env (no secrets leaked). ---
  const env = process.env;
  const { config: gonkaConfig, configured } = gonkaConfigFromEnv(env);

  // --- Attempt Gonka live review when configured (or test router injected). ---
  if (configured || TEST_ROUTER_FACTORY.current !== null) {
    let router: GonkaRemittanceRouter;
    try {
      const factory =
        TEST_ROUTER_FACTORY.current ??
        ((cfg: GonkaAdapterConfig) => createGonkaRemittanceRouter(cfg));
      // Clone the resolved config and cap the inference-attempt budget. Do not
      // mutate the shared env-derived config: a lower configured timeout is
      // preserved, maxRetries is forced to 0, and the per-call timeout is
      // capped at GONKA_INFERENCE_TIMEOUT_CAP_MS.
      const cappedConfig: GonkaAdapterConfig = {
        ...gonkaConfig,
        timeoutMs: Math.min(
          gonkaConfig.timeoutMs ?? GONKA_INFERENCE_TIMEOUT_CAP_MS,
          GONKA_INFERENCE_TIMEOUT_CAP_MS,
        ),
        maxRetries: 0,
      };
      router = factory(cappedConfig);
    } catch {
      // Factory threw (e.g. bad config) — fail closed to deterministic.
      return deterministicQuote(text, config, "not_configured");
    }

    const manifest = resolveGonkaRemittanceManifest(env);
    const gonkaInput: GonkaRemittanceInput = {
      prompt: text,
      localeHint: "ms",
      manifest,
    };

    let result;
    try {
      result = await router.run(gonkaInput);
    } catch {
      // Unexpected throw from the router seam — fail closed to deterministic.
      return deterministicQuote(text, config, "provider_error");
    }

    if (isGonkaRunErr(result)) {
      return deterministicQuote(text, config, "provider_error");
    }

    if (isGonkaRunOk(result)) {
      // UNTRUSTED candidate — re-resolve against original text + manifest.
      const resolved = resolveGonkaRemittanceCandidate(
        text,
        result.candidate,
        manifest,
      );
      if (resolved.ok) {
        // Build the quote from the deterministic builder using the rebound
        // intent. Gonka interprets intent; the builder is authoritative.
        const intent = reboundToIntent(resolved.intent);
        const recipientAddress = resolveRecipientForAlias(
          config.recipients,
          intent.recipient,
        );
        const quote = buildQuote(intent, recipientAddress, config, Date.now());
        if (quote.kind === "clarification") {
          return NextResponse.json(quote, { status: 200 });
        }
        const intentReview = buildLiveIntentReview(
          resolved.intent,
          result.metadata.gonkaRequestId,
          result.metadata.responseModel,
          result.candidate.detectedLanguage,
          result.candidate.confidence,
          result.candidate.explanation,
        );
        return finalizeQuote(quote, recipientAddress, config, intentReview, text);
      }
      // Candidate rejected — fail closed to deterministic.
      return deterministicQuote(text, config, "candidate_rejected");
    }
  }

  // --- No Gonka configured — honest local-review fallback. ---
  return deterministicQuote(text, config, "not_configured");
}

/**
 * Build and return a deterministic quote with local-review intentReview.
 * Preserves the working deterministic parse/buildQuote/attestation flow.
 */
async function deterministicQuote(
  text: string,
  config: ReturnType<typeof resolveRemittanceConfig>,
  fallbackReason: IntentReviewLocal["fallbackReason"],
) {
  const parseResult: RemittanceParseResult = parseRemittance(text);

  if (parseResult.kind === "clarification") {
    return NextResponse.json(parseResult, { status: 200 });
  }

  const recipientAddress = resolveRecipientForAlias(
    config.recipients,
    parseResult.recipient,
  );

  const quote = buildQuote(parseResult, recipientAddress, config, Date.now());

  if (quote.kind === "clarification") {
    return NextResponse.json(quote, { status: 200 });
  }

  const intentReview = buildLocalIntentReview(text, fallbackReason);
  return finalizeQuote(quote, recipientAddress, config, intentReview, text);
}

/**
 * Attach the server-issued attestation (when a signing key and mapped
 * recipient exist), overwrite the intentReview, validate against the strict
 * schema, and return the final envelope.
 */
async function finalizeQuote(
  quote: QuoteEnvelope,
  recipientAddress: string | null,
  config: ReturnType<typeof resolveRemittanceConfig>,
  intentReview: QuoteEnvelope["intentReview"],
  originalIntent: string,
) {
  const intentBinding = buildFinancialIntentBinding(originalIntent, intentReview);
  let envelope = { ...quote, intentReview, intentBinding };
  if (config.quoteSigningKeyHex && recipientAddress) {
    const fields: CanonicalFields = {
      recipientAddress,
      usdcMicro: quote.usdcMicro,
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: quote.beneficiaryRef,
      corridor: quote.corridor,
      youPayMinor: quote.youPayMinor,
      familyReceivesMinor: quote.familyReceivesMinor,
      totalFeeMinor: quote.totalFeeMinor,
      myrPerUsdc: quote.provenance.myrPerUsdc,
      phpPerUsdc: quote.provenance.phpPerUsdc,
      fixedFeeMyr: quote.provenance.fixedFeeMyr,
      feeBps: quote.provenance.feeBps,
      issuedAt: quote.issuedAt,
      expiresAt: quote.expiresAt,
      recipient: quote.recipient,
      destinationCity: quote.destinationCity,
      purpose: intentReview.purpose,
      maximumFamilyLimitMinor: intentReview.maximumFamilyLimitMinor,
      intentBinding,
    };
    const hmac = computeAttestation(config.quoteSigningKeyHex, fields);
    envelope = { ...envelope, attestation: { v: 1, hmac } };
  }

  // Validate the outgoing envelope against the strict shared schema. This
  // catches any drift between the builder and the schema at the seam.
  const envelopeResult = QuoteEnvelopeSchema.safeParse(envelope);
  if (!envelopeResult.success) {
    return NextResponse.json(
      {
        kind: "clarification",
        clarification: {
          code: "unsupported_corridor",
          reason: "Remittance pricing is not available.",
        },
        action: null,
        amountMinor: null,
        currency: null,
        recipient: null,
        destinationCity: null,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(envelopeResult.data, { status: 200 });
}
