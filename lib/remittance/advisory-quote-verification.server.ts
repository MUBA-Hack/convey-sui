import "server-only";

import { USDC_COIN_TYPE_TESTNET } from "./constants";
import { verifyAttestation } from "./attestation.server";
import {
  QuoteEnvelopeSchema,
  isExpired,
  type QuoteEnvelope,
  type VerifyRejected,
} from "./quote-schema";
import { resolveRemittanceConfig, validateConfig } from "./server-config";

export interface VerifyAdvisoryQuoteInput {
  body: unknown;
  nowMs: number;
  env: NodeJS.ProcessEnv;
}

export type VerifyAdvisoryQuoteResult =
  | { kind: "verified_advisory" }
  | VerifyRejected;

function reject(reason: VerifyRejected["reason"]): VerifyRejected {
  return { kind: "rejected", reason };
}

function configMatches(
  envelope: QuoteEnvelope,
  config: ReturnType<typeof resolveRemittanceConfig>,
): boolean {
  return (
    envelope.provenance.myrPerUsdc === config.myrPerUsdc.toString() &&
    envelope.provenance.phpPerUsdc === config.phpPerUsdc.toString() &&
    envelope.provenance.fixedFeeMyr === config.fixedFeeMyr.toString() &&
    envelope.provenance.feeBps === config.feeBps &&
    envelope.corridor.source === config.sourceCurrency &&
    envelope.corridor.destination === config.destinationCurrency
  );
}

export function verifyAdvisoryRemittanceQuote(
  input: VerifyAdvisoryQuoteInput,
): VerifyAdvisoryQuoteResult {
  const parsed = QuoteEnvelopeSchema.safeParse(input.body);
  if (!parsed.success) return reject("invalid_envelope");

  const envelope = parsed.data;
  const config = resolveRemittanceConfig(input.env);
  if (validateConfig(config)) return reject("not_configured");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < envelope.issuedAt) {
    return reject("expired");
  }
  if (isExpired(envelope.expiresAt, input.nowMs)) return reject("expired");
  if (!configMatches(envelope, config)) return reject("unverified");
  const hasRecipientAddress = envelope.recipientAddress !== null;
  const hasAttestation = envelope.attestation !== null;
  if (hasRecipientAddress !== hasAttestation) return reject("unverified");
  if (!hasRecipientAddress) return { kind: "verified_advisory" };
  if (!verifyAttestation(config.quoteSigningKeyHex, envelope, USDC_COIN_TYPE_TESTNET)) {
    return reject("unverified");
  }
  return { kind: "verified_advisory" };
}
