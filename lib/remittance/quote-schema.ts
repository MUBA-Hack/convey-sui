/**
 * Client-safe strict Zod schemas, derived types, and the pure expiry helper.
 * No HMAC, no secrets, no server-only imports.
 */

import { z } from "zod";

export const ATTESTATION_VERSION = 1;

/** Sui address: 0x + 64 hex, optional leading zeros already present. */
const SuiAddressString = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).max(66);

/** Non-negative integer string with an explicit upper length bound. */
const MinorAmountString = z.string().regex(/^\d{1,20}$/);
const UsdcMicroString = z.string().regex(/^\d{1,20}$/);
const RateString = z.string().regex(/^\d{1,20}$/);

export const AttestationSchema = z.strictObject({
  v: z.literal(ATTESTATION_VERSION),
  hmac: z.string().regex(/^0x[0-9a-f]{64}$/),
});

export type Attestation = z.infer<typeof AttestationSchema>;

export const ExchangeRateSchema = z.strictObject({
  fromCurrency: z.literal("MYR"),
  toCurrency: z.literal("PHP"),
  rateText: z.string().min(1).max(40),
});

export const ProvenanceSchema = z.strictObject({
  pricing: z.literal("reference"),
  sourceLabel: z.string().min(1).max(80),
  myrPerUsdc: RateString,
  phpPerUsdc: RateString,
  fixedFeeMyr: RateString,
  feeBps: z.number().int().min(0).max(10_000),
});

/**
 * Client-safe intent review — compact, consumer-aligned metadata that tells
 * the customer who reviewed their request and what family rule applied.
 *
 * Discriminated on `reviewer`:
 *  - `gonka`  → live GonkaRouter review. Carries only safe provider metadata
 *    (request id, response model) plus detected language, confidence, and a
 *    short explanation. Never carries wallet addresses, secrets, raw model
 *    output, or attempt trails.
 *  - `local`  → honest deterministic fallback. Carries a safe fallback reason
 *    enum; never implies Gonka ran.
 *
 * Both variants carry the consumer-facing family-rule fields: an optional
 * purpose, an optional maximum-family-limit in minor MYR, and a within-limit /
 * not-set rule status. Settlement logic (parse/buildQuote/attestation) stays
 * authoritative; this object never authorizes payment.
 */
export const IntentReviewLiveSchema = z.strictObject({
  reviewer: z.literal("gonka"),
  mode: z.literal("live"),
  provider: z.literal("gonkarouter"),
  requestId: z.string().min(1).max(120),
  responseModel: z.string().min(1).max(120),
  detectedLanguage: z.string().min(1).max(32),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
  purpose: z.string().min(1).max(120).nullable(),
  maximumFamilyLimitMinor: MinorAmountString.nullable(),
  ruleStatus: z.enum(["within_limit", "not_set"]),
});

export const IntentReviewLocalSchema = z.strictObject({
  reviewer: z.literal("local"),
  mode: z.literal("fallback"),
  provider: z.literal("deterministic"),
  fallbackReason: z.enum([
    "not_configured",
    "provider_error",
    "candidate_rejected",
    // User supplied structured controls, so deterministic parse is the
    // intended path — not a Gonka failure or misconfiguration.
    "structured_input",
  ]),
  purpose: z.string().min(1).max(120).nullable(),
  maximumFamilyLimitMinor: MinorAmountString.nullable(),
  ruleStatus: z.enum(["within_limit", "not_set"]),
});

export const IntentReviewSchema = z.discriminatedUnion("reviewer", [
  IntentReviewLiveSchema,
  IntentReviewLocalSchema,
]);

export type IntentReview = z.infer<typeof IntentReviewSchema>;
export type IntentReviewLive = z.infer<typeof IntentReviewLiveSchema>;
export type IntentReviewLocal = z.infer<typeof IntentReviewLocalSchema>;

const IntentBindingLiveInterpretationSchema = z.strictObject({
  kind: z.literal("gonka"),
  provider: z.literal("gonkarouter"),
  requestId: z.string().min(1).max(120),
  modelId: z.string().min(1).max(120),
  detectedLanguage: z.string().min(1).max(32),
});

const IntentBindingLocalInterpretationSchema = z.strictObject({
  kind: z.literal("deterministic"),
  provider: z.literal("deterministic"),
  fallbackReason: z.enum([
    "not_configured",
    "provider_error",
    "candidate_rejected",
    "structured_input",
  ]),
});

export const FinancialIntentBindingSchema = z.strictObject({
  version: z.literal("convey.financial-intent.v1"),
  originalIntent: z.string().min(1).max(500),
  interpretation: z.discriminatedUnion("kind", [
    IntentBindingLiveInterpretationSchema,
    IntentBindingLocalInterpretationSchema,
  ]),
  policy: z.strictObject({
    engine: z.literal("convey.remittance-policy.v1"),
    result: z.literal("quote_ready"),
    ruleStatus: z.enum(["within_limit", "not_set"]),
    purpose: z.string().min(1).max(120).nullable(),
    maximumFamilyLimitMinor: MinorAmountString.nullable(),
  }),
});

export type FinancialIntentBinding = z.infer<typeof FinancialIntentBindingSchema>;

export function buildFinancialIntentBinding(
  originalIntent: string,
  review: IntentReview,
): FinancialIntentBinding {
  const normalizedIntent = originalIntent.replace(/\s+/gu, " ").trim();
  const interpretation =
    review.reviewer === "gonka"
      ? {
          kind: "gonka" as const,
          provider: "gonkarouter" as const,
          requestId: review.requestId,
          modelId: review.responseModel,
          detectedLanguage: review.detectedLanguage,
        }
      : {
          kind: "deterministic" as const,
          provider: "deterministic" as const,
          fallbackReason: review.fallbackReason,
        };
  return FinancialIntentBindingSchema.parse({
    version: "convey.financial-intent.v1",
    originalIntent: normalizedIntent,
    interpretation,
    policy: {
      engine: "convey.remittance-policy.v1",
      result: "quote_ready",
      ruleStatus: review.ruleStatus,
      purpose: review.purpose,
      maximumFamilyLimitMinor: review.maximumFamilyLimitMinor,
    },
  });
}

export const CorridorSchema = z.strictObject({
  source: z.literal("MYR"),
  destination: z.literal("PHP"),
});

export const QuoteEnvelopeSchema = z.strictObject({
  kind: z.literal("quote"),
  recipient: z.string().min(1).max(40),
  destinationCity: z.string().min(1).max(40),
  destinationCountry: z.string().min(1).max(40),
  youPayMinor: MinorAmountString,
  youPayCurrency: z.literal("MYR"),
  familyReceivesMinor: MinorAmountString,
  familyReceivesCurrency: z.literal("PHP"),
  exchangeRate: ExchangeRateSchema,
  totalFeeMinor: MinorAmountString,
  feeCurrency: z.literal("MYR"),
  fixedFeeMinor: MinorAmountString,
  feeBps: z.number().int().min(0).max(10_000),
  usdcMicro: UsdcMicroString,
  usdcAmount: z.string().min(1).max(40),
  settlementRail: z.string().min(1).max(60),
  payoutMethod: z.string().min(1).max(60),
  estimatedArrival: z.string().min(1).max(80),
  payoutStatus: z.literal("Awaiting payout partner"),
  issuedAt: z.number().int().finite().safe(),
  expiresAt: z.number().int().finite().safe(),
  provenance: ProvenanceSchema,
  corridor: CorridorSchema,
  recipientAddress: SuiAddressString.nullable(),
  beneficiaryRef: z.string().regex(/^R-[A-Z0-9]{8}$/),
  attestation: AttestationSchema.nullable(),
  intentReview: IntentReviewSchema,
  intentBinding: FinancialIntentBindingSchema.optional(),
  clarification: z.null(),
});

export type QuoteEnvelope = z.infer<typeof QuoteEnvelopeSchema>;

/**
 * Canonical authorization — the verified, HMAC-bound fields the client builds a
 * transfer from. The family-rule fields (`purpose`, `maximumFamilyLimitMinor`)
 * are bound into the signed canonical message so a tampered rule invalidates
 * the attestation. Both are nullable: `null` means no rule was stated for this
 * transfer (the common case), and the canonical representation uses JSON `null`
 * unambiguously — never an empty string or omitted key.
 */
export const CanonicalAuthorizationSchema = z.strictObject({
  kind: z.literal("authorization"),
  recipientAddress: SuiAddressString,
  usdcMicro: UsdcMicroString,
  coinType: z.string().min(1).max(200),
  beneficiaryRef: z.string().regex(/^R-[A-Z0-9]{8}$/),
  issuedAt: z.number().int().finite().safe(),
  expiresAt: z.number().int().finite().safe(),
  corridor: CorridorSchema,
  youPayMinor: MinorAmountString,
  familyReceivesMinor: MinorAmountString,
  totalFeeMinor: MinorAmountString,
  myrPerUsdc: RateString,
  phpPerUsdc: RateString,
  fixedFeeMyr: RateString,
  feeBps: z.number().int().min(0).max(10_000),
  recipient: z.string().min(1).max(40),
  destinationCity: z.string().min(1).max(40),
  purpose: z.string().min(1).max(120).nullable(),
  maximumFamilyLimitMinor: MinorAmountString.nullable(),
  intentBinding: FinancialIntentBindingSchema.optional(),
});

export type CanonicalAuthorization = z.infer<typeof CanonicalAuthorizationSchema>;

export const RemittanceClarificationSchema = z.strictObject({
  kind: z.literal("clarification"),
  clarification: z.strictObject({
    code: z.enum([
      "empty",
      "oversized",
      "injection",
      "missing_action",
      "missing_amount",
      "unsupported_currency",
      "ambiguous_currency",
      "missing_recipient",
      "missing_destination",
      "unsupported_corridor",
      "amount_too_small",
      "amount_exceeds_max",
      "invalid_recipient",
    ]),
    reason: z.string().min(1).max(200),
  }),
  action: z.enum(["send"]).nullable(),
  amountMinor: z.string().regex(/^\d{1,20}$/).nullable(),
  currency: z.literal("MYR").nullable(),
  recipient: z.string().min(1).max(40).nullable(),
  destinationCity: z.string().min(1).max(40).nullable(),
});

export type RemittanceClarification = z.infer<typeof RemittanceClarificationSchema>;

export const VerifyRejectedSchema = z.strictObject({
  kind: z.literal("rejected"),
  reason: z.enum([
    "expired",
    "unverified",
    "unmapped_recipient",
    "invalid_envelope",
    "not_configured",
  ]),
});

export type VerifyRejected = z.infer<typeof VerifyRejectedSchema>;

/**
 * Honest boundary note for historical evidence: a verified-but-expired quote
 * cannot authorize execution. Defined once here so the schema literal and the
 * evaluator share one source of truth.
 */
export const EVIDENCE_NOTE =
  "Quote verified as a historical record. The quote has expired and can no longer be used for payment.";

/**
 * Historical evidence verification result. Returned by
 * `/api/remittance/quote/verify?evidence=1` when a quote's attestation,
 * recipient mapping, corridor, and config binding all verify, but the quote
 * is expired. This NEVER authorizes execution — it only confirms the quote
 * was genuinely attested by the server, so a receipt inspector can present
 * "signed/verified authorization" wording truthfully for historical
 * evidence. The `expired` field is always true when this is returned; an
 * unexpired quote that verifies returns `kind: "authorization"` instead.
 */
export const EvidenceVerifiedSchema = z.strictObject({
  kind: z.literal("evidence"),
  expired: z.literal(true),
  /** The canonical recipient address the attestation was bound to. */
  recipientAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).max(66),
  /** The beneficiary reference bound into the attestation. */
  beneficiaryRef: z.string().regex(/^R-[A-Z0-9]{8}$/),
  /** The quote expiry timestamp that has passed. */
  expiresAt: z.number().int().finite().safe(),
  /** Honest boundary: this does not authorize execution. */
  note: z.literal(EVIDENCE_NOTE),
});

export type EvidenceVerified = z.infer<typeof EvidenceVerifiedSchema>;

export function isExpired(expiresAt: number, now: number): boolean {
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)) return true;
  return now >= expiresAt;
}
