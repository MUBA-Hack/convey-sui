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
  clarification: z.null(),
});

export type QuoteEnvelope = z.infer<typeof QuoteEnvelopeSchema>;

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

export function isExpired(expiresAt: number, now: number): boolean {
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)) return true;
  return now >= expiresAt;
}
