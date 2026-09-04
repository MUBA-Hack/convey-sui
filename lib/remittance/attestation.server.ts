/**
 * Server-only HMAC-SHA256 attestation for remittance quotes.
 *
 * Never imported by client components (`server-only` fails the build). Uses Node
 * `createHmac` + `timingSafeEqual` on fixed-length buffers. The HMAC value is
 * returned inside the quote envelope so the client can gate UI mode; the key
 * itself never leaves the server.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ATTESTATION_VERSION,
  type CanonicalAuthorization,
  type FinancialIntentBinding,
  type QuoteEnvelope,
} from "./quote-schema";

export interface CanonicalFields {
  recipientAddress: string;
  usdcMicro: string;
  coinType: string;
  beneficiaryRef: string;
  corridor: { source: "MYR"; destination: "PHP" };
  youPayMinor: string;
  familyReceivesMinor: string;
  totalFeeMinor: string;
  myrPerUsdc: string;
  phpPerUsdc: string;
  fixedFeeMyr: string;
  feeBps: number;
  issuedAt: number;
  expiresAt: number;
  recipient: string;
  destinationCity: string;
  /** Verified family-rule purpose, or null when no rule was stated. */
  purpose: string | null;
  /** Verified family-rule max cap in minor MYR, or null when no cap was stated. */
  maximumFamilyLimitMinor: string | null;
  intentBinding?: FinancialIntentBinding;
}

const CONTROL_OR_NEWLINE = /[\x00-\x1F\x7F]/;
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
const HMAC_HEX_RE = /^0x[0-9a-f]{64}$/;

function assertSafeString(value: string, field: string): void {
  if (CONTROL_OR_NEWLINE.test(value)) {
    throw new Error(`Canonical field ${field} contains a control character or newline.`);
  }
}

/** Fixed-order JSON object over schema-constrained fields. */
export function canonicalMessage(fields: CanonicalFields): string {
  assertSafeString(fields.recipientAddress, "recipientAddress");
  assertSafeString(fields.usdcMicro, "usdcMicro");
  assertSafeString(fields.coinType, "coinType");
  assertSafeString(fields.beneficiaryRef, "beneficiaryRef");
  assertSafeString(fields.youPayMinor, "youPayMinor");
  assertSafeString(fields.familyReceivesMinor, "familyReceivesMinor");
  assertSafeString(fields.totalFeeMinor, "totalFeeMinor");
  assertSafeString(fields.myrPerUsdc, "myrPerUsdc");
  assertSafeString(fields.phpPerUsdc, "phpPerUsdc");
  assertSafeString(fields.fixedFeeMyr, "fixedFeeMyr");
  assertSafeString(fields.recipient, "recipient");
  assertSafeString(fields.destinationCity, "destinationCity");
  if (fields.purpose !== null) assertSafeString(fields.purpose, "purpose");
  if (fields.maximumFamilyLimitMinor !== null) {
    assertSafeString(fields.maximumFamilyLimitMinor, "maximumFamilyLimitMinor");
  }

  return JSON.stringify({
    v: ATTESTATION_VERSION,
    recipientAddress: fields.recipientAddress,
    usdcMicro: fields.usdcMicro,
    coinType: fields.coinType,
    beneficiaryRef: fields.beneficiaryRef,
    corridor: `${fields.corridor.source}/${fields.corridor.destination}`,
    youPayMinor: fields.youPayMinor,
    familyReceivesMinor: fields.familyReceivesMinor,
    totalFeeMinor: fields.totalFeeMinor,
    myrPerUsdc: fields.myrPerUsdc,
    phpPerUsdc: fields.phpPerUsdc,
    fixedFeeMyr: fields.fixedFeeMyr,
    feeBps: fields.feeBps,
    issuedAt: fields.issuedAt,
    expiresAt: fields.expiresAt,
    recipient: fields.recipient,
    destinationCity: fields.destinationCity,
    purpose: fields.purpose,
    maximumFamilyLimitMinor: fields.maximumFamilyLimitMinor,
    ...(fields.intentBinding === undefined
      ? {}
      : {
          intentBinding: {
            version: fields.intentBinding.version,
            originalIntent: fields.intentBinding.originalIntent,
            interpretation:
              fields.intentBinding.interpretation.kind === "gonka"
                ? {
                    kind: fields.intentBinding.interpretation.kind,
                    provider: fields.intentBinding.interpretation.provider,
                    requestId: fields.intentBinding.interpretation.requestId,
                    modelId: fields.intentBinding.interpretation.modelId,
                    detectedLanguage: fields.intentBinding.interpretation.detectedLanguage,
                  }
                : {
                    kind: fields.intentBinding.interpretation.kind,
                    provider: fields.intentBinding.interpretation.provider,
                    fallbackReason: fields.intentBinding.interpretation.fallbackReason,
                  },
            policy: {
              engine: fields.intentBinding.policy.engine,
              result: fields.intentBinding.policy.result,
              ruleStatus: fields.intentBinding.policy.ruleStatus,
              purpose: fields.intentBinding.policy.purpose,
              maximumFamilyLimitMinor:
                fields.intentBinding.policy.maximumFamilyLimitMinor,
            },
          },
        }),
  });
}

function keyBytes(keyHex: string): Buffer {
  if (!KEY_HEX_RE.test(keyHex)) {
    throw new Error("Signing key must be exactly 64 lowercase hex characters.");
  }
  return Buffer.from(keyHex, "hex");
}

/** HMAC-SHA256 over the canonical message. Returns `0x` + 64 lowercase hex. */
export function computeAttestation(keyHex: string, fields: CanonicalFields): string {
  const mac = createHmac("sha256", keyBytes(keyHex))
    .update(Buffer.from(canonicalMessage(fields), "utf8"))
    .digest();
  return `0x${mac.toString("hex")}`;
}

/** Constant-time compare of two `0x`+64hex digests. */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (!HMAC_HEX_RE.test(a) || !HMAC_HEX_RE.test(b)) return false;
  const aBuf = Buffer.from(a.slice(2), "hex");
  const bBuf = Buffer.from(b.slice(2), "hex");
  if (aBuf.length !== 32 || bBuf.length !== 32) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyAttestation(
  keyHex: string | null,
  envelope: QuoteEnvelope,
  coinType: string,
): boolean {
  if (!keyHex) return false;
  if (!envelope.attestation) return false;
  if (envelope.attestation.v !== ATTESTATION_VERSION) return false;
  if (!envelope.recipientAddress) return false;
  try {
    const expected = computeAttestation(keyHex, {
      recipientAddress: envelope.recipientAddress,
      usdcMicro: envelope.usdcMicro,
      coinType,
      beneficiaryRef: envelope.beneficiaryRef,
      corridor: envelope.corridor,
      youPayMinor: envelope.youPayMinor,
      familyReceivesMinor: envelope.familyReceivesMinor,
      totalFeeMinor: envelope.totalFeeMinor,
      myrPerUsdc: envelope.provenance.myrPerUsdc,
      phpPerUsdc: envelope.provenance.phpPerUsdc,
      fixedFeeMyr: envelope.provenance.fixedFeeMyr,
      feeBps: envelope.provenance.feeBps,
      issuedAt: envelope.issuedAt,
      expiresAt: envelope.expiresAt,
      recipient: envelope.recipient,
      destinationCity: envelope.destinationCity,
      purpose: envelope.intentReview.purpose,
      maximumFamilyLimitMinor: envelope.intentReview.maximumFamilyLimitMinor,
      ...(envelope.intentBinding === undefined
        ? {}
        : { intentBinding: envelope.intentBinding }),
    });
    return constantTimeHexEqual(expected, envelope.attestation.hmac);
  } catch {
    return false;
  }
}

export function toAuthorization(envelope: QuoteEnvelope, coinType: string): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: envelope.recipientAddress ?? "",
    usdcMicro: envelope.usdcMicro,
    coinType,
    beneficiaryRef: envelope.beneficiaryRef,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    corridor: envelope.corridor,
    youPayMinor: envelope.youPayMinor,
    familyReceivesMinor: envelope.familyReceivesMinor,
    totalFeeMinor: envelope.totalFeeMinor,
    myrPerUsdc: envelope.provenance.myrPerUsdc,
    phpPerUsdc: envelope.provenance.phpPerUsdc,
    fixedFeeMyr: envelope.provenance.fixedFeeMyr,
    feeBps: envelope.provenance.feeBps,
    recipient: envelope.recipient,
    destinationCity: envelope.destinationCity,
    purpose: envelope.intentReview.purpose,
    maximumFamilyLimitMinor: envelope.intentReview.maximumFamilyLimitMinor,
    ...(envelope.intentBinding === undefined
      ? {}
      : { intentBinding: envelope.intentBinding }),
  };
}
