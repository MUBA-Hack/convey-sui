/**
 * Server-only remittance quote verification evaluator.
 *
 * The single verification policy between a viewable quote and an executable
 * transfer, extracted out of the route handler so it can be tested directly
 * without a Web Request/Response. Strictly parses the quote envelope with the
 * shared Zod schema, verifies the HMAC-SHA256 attestation in constant time,
 * enforces the freshness interval, amount/config/corridor/recipient binding,
 * and returns a minimal canonical authorization (or historical evidence).
 *
 * Imports `server-only` so any accidental client import fails the build. It
 * never imports Next, Request/Response, fetch, signing/submission, or UI. The
 * route handler only derives evidence mode, parses JSON, and serializes the
 * result.
 *
 * Fail closed: any validation failure, an absent signing key, a missing or
 * mismatched attestation, an expired or not-yet-issued quote, or an unmapped
 * recipient returns `kind: "rejected"` with a safe reason. No secret,
 * signature, or HMAC implementation detail is present in any returned value.
 */

import "server-only";

import {
  QuoteEnvelopeSchema,
  CanonicalAuthorizationSchema,
  EvidenceVerifiedSchema,
  EVIDENCE_NOTE,
  isExpired,
  type QuoteEnvelope,
  type CanonicalAuthorization,
  type VerifyRejected,
  type EvidenceVerified,
} from "./quote-schema";
import {
  resolveRemittanceConfig,
  resolveRecipientForAlias,
  validateConfig,
} from "./server-config";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import { verifyAttestation, toAuthorization } from "./attestation.server";

export interface VerifyRemittanceQuoteInput {
  body: unknown;
  evidenceMode: boolean;
  /** Injected current time in ms so tests are deterministic. */
  nowMs: number;
  env: NodeJS.ProcessEnv;
}

export type VerifyRemittanceQuoteResult =
  | CanonicalAuthorization
  | VerifyRejected
  | EvidenceVerified;

/** Fresh rejection per call so no caller mutation can poison later calls. */
function reject(reason: VerifyRejected["reason"]): VerifyRejected {
  return { kind: "rejected", reason };
}

/**
 * Verify a remittance quote envelope and return a canonical authorization,
 * historical evidence, or a safe rejection. Pure with respect to the network
 * and the clock: `nowMs` and `env` are injected by the caller.
 */
export function verifyRemittanceQuote(
  input: VerifyRemittanceQuoteInput,
): VerifyRemittanceQuoteResult {
  const { body, evidenceMode, env } = input;

  // Strict parse against the shared schema — no unchecked cast. A malformed
  // or extra-field body fails closed as invalid_envelope.
  const parsed = QuoteEnvelopeSchema.safeParse(body);
  if (!parsed.success) return reject("invalid_envelope");
  const envelope: QuoteEnvelope = parsed.data;

  // Re-bind config fields from the server-only config. An invalid resolved
  // config can never back a quote.
  const config = resolveRemittanceConfig(env);
  if (validateConfig(config)) return reject("not_configured");

  // Injected clock freshness: the authoritative interval is
  // issuedAt <= nowMs < expiresAt. An unsafe or pre-issuance time cannot make
  // a trustworthy timing decision, so fail closed as `expired` without
  // inventing a new public reason. Evidence mode must NOT produce evidence
  // here either — a clock before issuance is not a genuine expiry.
  const now = input.nowMs;
  if (!Number.isSafeInteger(now) || now < envelope.issuedAt) {
    return reject("expired");
  }
  const expired = isExpired(envelope.expiresAt, now);

  // Enforce expiry before anything else unless historical evidence mode is
  // explicitly requested. Evidence mode still verifies the attestation and
  // binding below; it only relaxes the upper-bound expiry gate so an
  // expired-but-genuine quote can be confirmed as historical evidence. It
  // NEVER returns an executable authorization for an expired quote.
  if (expired && !evidenceMode) return reject("expired");

  // A real execution requires an attested mapped recipient. Re-resolve the
  // per-beneficiary address from the server-only mapping and bind it to the
  // envelope's recipient address.
  const mappedAddress = resolveRecipientForAlias(config.recipients, envelope.recipient);
  if (!mappedAddress || !envelope.recipientAddress || mappedAddress !== envelope.recipientAddress) {
    return reject("unmapped_recipient");
  }

  // Bind config provenance and corridor to the resolved config.
  if (
    envelope.provenance.myrPerUsdc !== config.myrPerUsdc.toString() ||
    envelope.provenance.phpPerUsdc !== config.phpPerUsdc.toString() ||
    envelope.provenance.fixedFeeMyr !== config.fixedFeeMyr.toString() ||
    envelope.provenance.feeBps !== config.feeBps
  ) {
    return reject("unverified");
  }
  if (
    envelope.corridor.source !== config.sourceCurrency ||
    envelope.corridor.destination !== config.destinationCurrency
  ) {
    return reject("unverified");
  }

  // Verify the HMAC-SHA256 attestation in constant time. Fails closed when
  // the key is absent, the attestation is missing, the version is wrong, or
  // the HMAC does not match.
  if (!verifyAttestation(config.quoteSigningKeyHex, envelope, USDC_COIN_TYPE_TESTNET)) {
    return reject("unverified");
  }

  // Historical evidence mode: an expired-but-genuine quote returns evidence,
  // never an executable authorization. An unexpired quote that verifies still
  // returns the canonical authorization so the normal Pay flow is unaffected.
  if (expired && evidenceMode) {
    const evidence: EvidenceVerified = {
      kind: "evidence",
      expired: true,
      recipientAddress: envelope.recipientAddress,
      beneficiaryRef: envelope.beneficiaryRef,
      expiresAt: envelope.expiresAt,
      note: EVIDENCE_NOTE,
    };
    const evidenceResult = EvidenceVerifiedSchema.safeParse(evidence);
    if (!evidenceResult.success) return reject("invalid_envelope");
    return evidenceResult.data;
  }

  // Reduce to the minimal canonical authorization. The strict schema parse
  // below is a programmer-drift firewall: it never turns a verified quote into
  // success — a mismatch here means our own reduction is wrong, so fail closed
  // rather than emit unverified output.
  const auth = toAuthorization(envelope, USDC_COIN_TYPE_TESTNET);
  const authResult = CanonicalAuthorizationSchema.safeParse(auth);
  if (!authResult.success) return reject("invalid_envelope");
  return authResult.data;
}
