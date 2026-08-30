import { NextResponse } from "next/server";
import {
  QuoteEnvelopeSchema,
  CanonicalAuthorizationSchema,
  VerifyRejectedSchema,
  isExpired,
  type QuoteEnvelope,
  type VerifyRejected,
} from "@/lib/remittance/quote-schema";
import {
  resolveRemittanceConfig,
  resolveRecipientForAlias,
  validateConfig,
} from "@/lib/remittance/server-config";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  verifyAttestation,
  toAuthorization,
} from "@/lib/remittance/attestation.server";

/**
 * POST /api/remittance/quote/verify
 *
 * The single verification seam between a viewable quote and an executable
 * transfer. Strictly parses the quote envelope with the shared Zod schema,
 * verifies the HMAC-SHA256 attestation in constant time, enforces expiry,
 * amount/config/corridor/recipient binding, and returns a minimal canonical
 * authorization. The client builds a transaction ONLY from the returned
 * authorization — never from the raw envelope.
 *
 * Fail closed: any validation failure, an absent signing key, a missing or
 * mismatched attestation, an expired quote, or an unmapped recipient returns a
 * 200 with `kind: "rejected"` and a safe reason. No secret, signature, or
 * HMAC implementation detail is exposed in the response.
 */

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { kind: "rejected", reason: "invalid_envelope" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Strict parse against the shared schema — no unchecked cast.
  const parsed = QuoteEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "rejected", reason: "invalid_envelope" } satisfies VerifyRejected,
      { status: 200 },
    );
  }
  const envelope: QuoteEnvelope = parsed.data;

  // Resolve server-only config to re-bind config fields.
  const config = resolveRemittanceConfig(process.env);
  const configError = validateConfig(config);
  if (configError) {
    return NextResponse.json(
      { kind: "rejected", reason: "not_configured" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Enforce expiry before anything else.
  if (isExpired(envelope.expiresAt, Date.now())) {
    return NextResponse.json(
      { kind: "rejected", reason: "expired" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // A real execution requires an attested mapped recipient. Re-resolve the
  // per-beneficiary address from the server-only mapping and bind it to the
  // envelope's recipient address.
  const mappedAddress = resolveRecipientForAlias(config.recipients, envelope.recipient);
  if (!mappedAddress) {
    return NextResponse.json(
      { kind: "rejected", reason: "unmapped_recipient" } satisfies VerifyRejected,
      { status: 200 },
    );
  }
  if (!envelope.recipientAddress || mappedAddress !== envelope.recipientAddress) {
    return NextResponse.json(
      { kind: "rejected", reason: "unmapped_recipient" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Bind config fields: the envelope's provenance must match the resolved
  // config's reference rates and fees.
  if (
    envelope.provenance.myrPerUsdc !== config.myrPerUsdc.toString() ||
    envelope.provenance.phpPerUsdc !== config.phpPerUsdc.toString() ||
    envelope.provenance.fixedFeeMyr !== config.fixedFeeMyr.toString() ||
    envelope.provenance.feeBps !== config.feeBps
  ) {
    return NextResponse.json(
      { kind: "rejected", reason: "unverified" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Bind corridor.
  if (
    envelope.corridor.source !== config.sourceCurrency ||
    envelope.corridor.destination !== config.destinationCurrency
  ) {
    return NextResponse.json(
      { kind: "rejected", reason: "unverified" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Verify the HMAC-SHA256 attestation in constant time. Fails closed when the
  // key is absent, the attestation is missing, the version is wrong, or the
  // HMAC does not match.
  const ok = verifyAttestation(config.quoteSigningKeyHex, envelope, USDC_COIN_TYPE_TESTNET);
  if (!ok) {
    return NextResponse.json(
      { kind: "rejected", reason: "unverified" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  // Reduce to the minimal canonical authorization.
  const auth = toAuthorization(envelope, USDC_COIN_TYPE_TESTNET);

  // Validate the authorization against its strict schema before returning.
  const authResult = CanonicalAuthorizationSchema.safeParse(auth);
  if (!authResult.success) {
    return NextResponse.json(
      { kind: "rejected", reason: "invalid_envelope" } satisfies VerifyRejected,
      { status: 200 },
    );
  }

  return NextResponse.json(authResult.data, { status: 200 });
}

export type { VerifyRejected };
export { VerifyRejectedSchema };
