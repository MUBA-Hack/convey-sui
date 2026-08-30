/**
 * Asset-aware remittance receipt proof — a strict, versioned document distinct
 * from the legacy commerce receipt proof (`lib/commerce/receipt-proof.ts`).
 *
 * The document carries the existing `QuoteEnvelope` plus confirmed on-chain
 * settlement evidence, and binds the settlement evidence against the quote so a
 * tampered digest, recipient, USDC amount, beneficiary, quote expiry, payout
 * status, or family rule is rejected with a field-specific fail-closed error.
 *
 * Pure helpers only: build, parse, encode/decode (URL-safe base64), and
 * structural verify. No HMAC, no secret, no network. The verifier UI calls
 * `/api/remittance/quote/verify` separately to recheck the signed quote; this
 * module never turns the absence of a server check into success.
 */

import { z } from "zod";
import {
  QuoteEnvelopeSchema,
  isExpired,
  type QuoteEnvelope,
} from "./quote-schema";
import {
  buildExplorerUrl,
  isValidDigest,
  validateRecipientAddress,
} from "./transfer";

export const REMITTANCE_RECEIPT_KIND = "convey.remittance-receipt" as const;
export const REMITTANCE_RECEIPT_VERSION = 1 as const;
/** Hard upper bound on the raw JSON payload (bytes). */
export const REMITTANCE_RECEIPT_MAX_BYTES = 16 * 1024;
/** Hard upper bound on the URL-safe base64 payload (chars). */
export const REMITTANCE_RECEIPT_MAX_PAYLOAD_LENGTH = 24_576;

const SuiAddressString = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).max(66);
const UsdcMicroString = z.string().regex(/^\d{1,20}$/);
const MinorAmountString = z.string().regex(/^\d{1,20}$/);

/**
 * Confirmed on-chain settlement evidence. Every field that the payment seam
 * captured at finality is echoed here AND cross-bound against the quote in
 * `bindSettlementToQuote`, so a receipt that edits only one side is rejected.
 */
export const RemittanceSettlementSchema = z.strictObject({
  digest: z.string().min(1).max(80),
  explorerUrl: z.string().url().max(200),
  recipientAddress: SuiAddressString,
  usdcMicro: UsdcMicroString,
  beneficiaryRef: z.string().regex(/^R-[A-Z0-9]{8}$/),
  quoteExpiresAt: z.number().int().finite().safe(),
  payoutStatus: z.literal("Awaiting payout partner"),
  purpose: z.string().min(1).max(120).nullable(),
  maximumFamilyLimitMinor: MinorAmountString.nullable(),
  confirmedAt: z.number().int().finite().safe(),
});

export type RemittanceSettlement = z.infer<typeof RemittanceSettlementSchema>;

export const RemittanceReceiptSchema = z
  .strictObject({
    kind: z.literal(REMITTANCE_RECEIPT_KIND),
    version: z.literal(REMITTANCE_RECEIPT_VERSION),
    network: z.literal("testnet"),
    quote: QuoteEnvelopeSchema,
    settlement: RemittanceSettlementSchema,
    exportedAt: z.iso.datetime(),
  })
  .superRefine((doc, ctx) => {
    // The quote in a confirmed-settlement receipt must be attested. A real
    // transfer only proceeds after the server verifies the HMAC attestation;
    // a receipt with attestation: null cannot represent a confirmed settlement.
    if (!doc.quote.attestation) {
      ctx.addIssue({
        code: "custom",
        path: ["quote", "attestation"],
        message: "A confirmed settlement receipt must carry an attested quote.",
      });
    }

    const s = doc.settlement;
    const q = doc.quote;

    if (!isValidDigest(s.digest)) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "digest"],
        message: "Settlement digest is not a valid Sui transaction digest.",
      });
    }
    const expectedExplorer = buildExplorerUrl(s.digest);
    if (s.explorerUrl !== expectedExplorer) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "explorerUrl"],
        message: "Explorer URL must match the settlement digest on Sui testnet.",
      });
    }
    const canonicalRecipient = validateRecipientAddress(s.recipientAddress);
    if (!canonicalRecipient) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "recipientAddress"],
        message: "Settlement recipient address is not a valid Sui address.",
      });
    } else if (canonicalRecipient !== s.recipientAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "recipientAddress"],
        message: "Settlement recipient address must use canonical lowercase 0x form.",
      });
    }

    // Cross-bind settlement evidence against the quote. A mismatch on any bound
    // field is a field-specific fail-closed error, never a silent success.
    if (!q.recipientAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["quote", "recipientAddress"],
        message: "Quote must carry a mapped recipient address for a confirmed settlement.",
      });
    } else if (canonicalRecipient && q.recipientAddress !== s.recipientAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "recipientAddress"],
        message: "Settlement recipient address must match the quote recipient address.",
      });
    }
    if (s.usdcMicro !== q.usdcMicro) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "usdcMicro"],
        message: "Settlement USDC micro amount must match the quote.",
      });
    }
    if (s.beneficiaryRef !== q.beneficiaryRef) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "beneficiaryRef"],
        message: "Settlement beneficiary reference must match the quote.",
      });
    }
    if (s.quoteExpiresAt !== q.expiresAt) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "quoteExpiresAt"],
        message: "Settlement quote expiry must match the quote expiresAt.",
      });
    }
    if (s.payoutStatus !== q.payoutStatus) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "payoutStatus"],
        message: "Settlement payout status must match the quote.",
      });
    }
    if (s.purpose !== q.intentReview.purpose) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "purpose"],
        message: "Settlement family-rule purpose must match the quote intent review.",
      });
    }
    if (s.maximumFamilyLimitMinor !== q.intentReview.maximumFamilyLimitMinor) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "maximumFamilyLimitMinor"],
        message: "Settlement family-rule cap must match the quote intent review.",
      });
    }

    // A receipt may be exported after the quote expired (settlement confirmed
    // near expiry); that is not a structural error. But the confirmedAt and
    // exportedAt timestamps must be at or after the quote issue time.
    if (s.confirmedAt < q.issuedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["settlement", "confirmedAt"],
        message: "Settlement confirmedAt cannot precede the quote issuedAt.",
      });
    }
    const exportedMs = Date.parse(doc.exportedAt);
    if (Number.isNaN(exportedMs) || exportedMs < q.issuedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["exportedAt"],
        message: "Export time must be a valid timestamp at or after the quote issuedAt.",
      });
    }
  });

export type RemittanceReceiptDocument = z.infer<typeof RemittanceReceiptSchema>;

export interface RemittanceReceiptEvidence {
  label: string;
  value: string;
}

export interface VerifiedRemittanceReceipt {
  ok: true;
  kind: "remittance_settlement";
  /** Honest claim: structural + binding verified locally; no Sui tx query. */
  claim: string;
  document: RemittanceReceiptDocument;
  evidence: RemittanceReceiptEvidence[];
}

export interface InvalidRemittanceReceipt {
  ok: false;
  errors: string[];
}

export type RemittanceReceiptResult =
  | VerifiedRemittanceReceipt
  | InvalidRemittanceReceipt;

function parseInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return Symbol.for("invalid-remittance-json");
  }
}

function formatErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string[] {
  return issues.map((issue) => {
    const field = issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ` : "";
    return `${field}${issue.message}`;
  });
}

/**
 * Structurally verify a remittance receipt document. Accepts a parsed object or
 * a JSON string. Fails closed with field-specific errors on any schema or
 * cross-binding violation. Never claims on-chain settlement was queried.
 */
export function verifyRemittanceReceipt(input: unknown): RemittanceReceiptResult {
  const parsedInput = parseInput(input);
  if (parsedInput === Symbol.for("invalid-remittance-json")) {
    return { ok: false, errors: ["Remittance receipt JSON could not be parsed."] };
  }

  const parsed = RemittanceReceiptSchema.safeParse(parsedInput);
  if (!parsed.success) {
    return { ok: false, errors: formatErrors(parsed.error.issues) };
  }

  const doc = parsed.data;
  const q = doc.quote;
  const hasRule = q.intentReview.purpose !== null || q.intentReview.maximumFamilyLimitMinor !== null;
  const expired = isExpired(q.expiresAt, Date.now());

  return {
    ok: true,
    kind: "remittance_settlement",
    claim:
      "Receipt details and quote binding checked. The quote includes a server seal; " +
      "seal verification is a separate step. This page did not check the Sui ledger; " +
      "the transaction ID was carried in by the receipt.",
    document: doc,
    evidence: [
      { label: "Recipient", value: q.recipient },
      { label: "Destination", value: q.destinationCity },
      { label: "USDC", value: q.usdcAmount },
      { label: "Digest", value: "Bound to explorer URL" },
      { label: "Beneficiary", value: q.beneficiaryRef },
      { label: "Quote expiry", value: expired ? "Expired after settlement" : "Within validity" },
      { label: "Payout", value: q.payoutStatus },
      { label: "Family rule", value: hasRule ? "Includes server seal (verification separate)" : "Not stated" },
      { label: "Network", value: "Sui testnet" },
    ],
  };
}

/**
 * Build a remittance receipt document from a confirmed quote and the
 * settlement evidence captured at finality. Re-validates the result against the
 * strict schema so a malformed input never produces an invalid document.
 */
export interface BuildRemittanceReceiptInput {
  quote: QuoteEnvelope;
  settlement: {
    digest: string;
    explorerUrl: string;
    recipientAddress: string;
    usdcMicro: string;
    beneficiaryRef: string;
    quoteExpiresAt: number;
    payoutStatus: "Awaiting payout partner";
    purpose: string | null;
    maximumFamilyLimitMinor: string | null;
    confirmedAt: number;
  };
  exportedAt?: string;
  network?: "testnet";
}

export function buildRemittanceReceipt(
  input: BuildRemittanceReceiptInput,
): RemittanceReceiptDocument {
  const doc: RemittanceReceiptDocument = {
    kind: REMITTANCE_RECEIPT_KIND,
    version: REMITTANCE_RECEIPT_VERSION,
    network: input.network ?? "testnet",
    quote: input.quote,
    settlement: input.settlement,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
  };
  return RemittanceReceiptSchema.parse(doc);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(payload: string): Uint8Array {
  if (
    typeof payload !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    payload.length > REMITTANCE_RECEIPT_MAX_PAYLOAD_LENGTH
  ) {
    throw new Error("Remittance receipt payload is malformed or too large.");
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Remittance receipt payload could not be decoded.");
  }
}

/** Encode a verified receipt document as a URL-safe base64 payload. */
export function encodeRemittanceReceiptPayload(
  doc: RemittanceReceiptDocument,
): string {
  const parsed = RemittanceReceiptSchema.parse(doc);
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

/** Decode and strictly validate a URL-safe base64 receipt payload. */
export function decodeRemittanceReceiptPayload(
  payload: string,
): RemittanceReceiptDocument {
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload));
  } catch (error) {
    if (error instanceof Error && /payload/i.test(error.message)) throw error;
    throw new Error("Remittance receipt payload is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Remittance receipt payload is invalid.");
  }
  const result = RemittanceReceiptSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Remittance receipt payload is invalid.");
  }
  return result.data;
}

/**
 * Sniff the kind of a raw proof payload without full validation. Used by the
 * verifier UI to route legacy commerce proof vs remittance receipt vs an
 * unconfirmed remittance quote handoff. Never turns an unknown into a success.
 */
export type ProofKind = "remittance-receipt" | "remittance-quote" | "commerce" | "unknown";

export function sniffProofKind(raw: unknown): ProofKind {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > REMITTANCE_RECEIPT_MAX_BYTES) {
    return "unknown";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unknown";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "unknown";
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind === REMITTANCE_RECEIPT_KIND) return "remittance-receipt";
  if (o.kind === "convey.remittance-quote") return "remittance-quote";
  // Legacy commerce proof has no `kind` field; it carries `mode` + `digest`.
  if (o.kind === undefined && typeof o.mode === "string" && typeof o.digest === "string") {
    return "commerce";
  }
  return "unknown";
}
