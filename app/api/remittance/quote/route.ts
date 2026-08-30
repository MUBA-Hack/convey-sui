import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseRemittance,
  MAX_REMITTANCE_INPUT_LENGTH,
  type RemittanceParseResult,
} from "@/lib/remittance/parser";
import { buildQuote } from "@/lib/remittance/quote";
import {
  resolveRemittanceConfig,
  resolveRecipientForAlias,
  validateConfig,
} from "@/lib/remittance/server-config";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import { QuoteEnvelopeSchema } from "@/lib/remittance/quote-schema";
import { computeAttestation, type CanonicalFields } from "@/lib/remittance/attestation.server";

/**
 * POST /api/remittance/quote
 *
 * Accepts a free-text remittance command (typed or spoken) and returns a
 * strictly typed reference quote envelope or a specific clarification.
 * Deterministic and offline — no network, no model. Pricing is explicit
 * server-side reference configuration; the response carries provenance, an
 * expiry, a non-PII beneficiary reference, and a server-issued HMAC-SHA256
 * attestation over the canonical execution fields (null when no signing key
 * is configured).
 *
 * The route never returns transaction bytes, signatures, or any executable
 * payload. The recipient Sui address is resolved per-beneficiary from the
 * server-only `REMITTANCE_RECIPIENTS_JSON` mapping; it is descriptive in the
 * envelope and re-verified by the verify seam before any transfer.
 */

const RequestSchema = z.strictObject({
  text: z.string().max(MAX_REMITTANCE_INPUT_LENGTH),
});

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

  const parseResult: RemittanceParseResult = parseRemittance(text);

  if (parseResult.kind === "clarification") {
    return NextResponse.json(parseResult, { status: 200 });
  }

  // Resolve the per-beneficiary recipient address from the server-only mapping.
  const recipientAddress = resolveRecipientForAlias(config.recipients, parseResult.recipient);

  const quote = buildQuote(parseResult, recipientAddress, config, Date.now());

  if (quote.kind === "clarification") {
    return NextResponse.json(quote, { status: 200 });
  }

  // Attach the server-issued attestation when a signing key and a mapped
  // recipient address exist. Without a key the quote is viewable but not
  // executable; without a mapped recipient there is nothing to attest.
  let envelope = quote;
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
    };
    const hmac = computeAttestation(config.quoteSigningKeyHex, fields);
    envelope = { ...quote, attestation: { v: 1, hmac } };
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
