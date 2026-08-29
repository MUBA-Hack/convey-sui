import { z } from "zod";
import {
  buildExplorerUrl,
  type PaymentReceipt,
  validateAmountMist,
  validateMerchantAddress,
} from "@/lib/commerce/payment";

const DEMO_LABEL = "DEMO simulation — no on-chain settlement";
const REAL_LABEL = "Real testnet transfer";
const BASE58_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{40,64}$/;
const DEMO_DIGEST = /^DEMO-[0-9a-f]{16}$/;
const MAX_PAYLOAD_LENGTH = 16_384;

const receiptProofSchema = z
  .object({
    mode: z.enum(["demo", "real"]),
    demo: z.boolean(),
    digest: z.string().min(1),
    amountMist: z.string().regex(/^[1-9]\d*$/, "Amount must be a canonical positive integer in MIST."),
    merchantAddress: z.string().min(1),
    explorerUrl: z.string().url().nullable(),
    label: z.string().min(1),
    exportedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((proof, context) => {
    const amountError = validateAmountMist(proof.amountMist);
    if (amountError) {
      context.addIssue({ code: "custom", path: ["amountMist"], message: amountError });
    }

    const canonicalMerchant = validateMerchantAddress(proof.merchantAddress);
    if (!canonicalMerchant) {
      context.addIssue({ code: "custom", path: ["merchantAddress"], message: "Merchant address is not a valid Sui address." });
    } else if (canonicalMerchant !== proof.merchantAddress) {
      context.addIssue({ code: "custom", path: ["merchantAddress"], message: "Merchant address must use canonical lowercase 0x form." });
    }

    if (proof.mode === "demo") {
      if (!proof.demo) {
        context.addIssue({ code: "custom", path: ["demo"], message: "Demo mode must set demo to true." });
      }
      if (!DEMO_DIGEST.test(proof.digest)) {
        context.addIssue({ code: "custom", path: ["digest"], message: "Demo digest must use the DEMO- prefix and canonical fingerprint." });
      }
      if (proof.explorerUrl !== null) {
        context.addIssue({ code: "custom", path: ["explorerUrl"], message: "Demo receipts cannot carry an explorer URL." });
      }
      if (proof.label !== DEMO_LABEL) {
        context.addIssue({ code: "custom", path: ["label"], message: "Demo label is inconsistent with its mode." });
      }
      return;
    }

    if (proof.demo) {
      context.addIssue({ code: "custom", path: ["demo"], message: "Real mode must set demo to false." });
    }
    if (!BASE58_DIGEST.test(proof.digest)) {
      context.addIssue({ code: "custom", path: ["digest"], message: "Real receipt digest must be a base58 transaction digest." });
    }
    const expectedExplorerUrl = buildExplorerUrl("real", proof.digest);
    if (proof.explorerUrl !== expectedExplorerUrl) {
      context.addIssue({ code: "custom", path: ["explorerUrl"], message: "Explorer URL must match the receipt digest on Sui testnet." });
    }
    if (proof.label !== REAL_LABEL) {
      context.addIssue({ code: "custom", path: ["label"], message: "Real receipt label is inconsistent with its mode." });
    }
  });

export type ReceiptProofDocument = z.infer<typeof receiptProofSchema>;

export interface ProofEvidence {
  label: string;
  value: string;
}

export interface VerifiedReceiptProof {
  ok: true;
  kind: "demo_structure" | "real_testnet_structure";
  claim: string;
  document: ReceiptProofDocument;
  receipt: PaymentReceipt;
  evidence: ProofEvidence[];
}

export interface InvalidReceiptProof {
  ok: false;
  errors: string[];
}

export type ReceiptProofResult = VerifiedReceiptProof | InvalidReceiptProof;

function parseInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return Symbol.for("invalid-receipt-json");
  }
}

export function verifyReceiptProof(input: unknown): ReceiptProofResult {
  const parsedInput = parseInput(input);
  if (parsedInput === Symbol.for("invalid-receipt-json")) {
    return { ok: false, errors: ["Receipt JSON could not be parsed."] };
  }

  const parsed = receiptProofSchema.safeParse(parsedInput);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const field = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${field}${issue.message}`;
      }),
    };
  }

  const document = parsed.data;
  const receipt: PaymentReceipt = {
    mode: document.mode,
    demo: document.demo,
    digest: document.digest,
    amountMist: document.amountMist,
    merchantAddress: document.merchantAddress,
    explorerUrl: document.explorerUrl,
    label: document.label,
  };
  const isDemo = document.mode === "demo";

  return {
    ok: true,
    kind: isDemo ? "demo_structure" : "real_testnet_structure",
    claim: isDemo
      ? "DEMO structure verified locally. No chain query was made and no settlement is claimed."
      : "Real testnet receipt structure is internally consistent. The transaction was not queried from this page.",
    document,
    receipt,
    evidence: [
      { label: "Schema", value: "Strict fields" },
      { label: "Amount", value: "Canonical MIST" },
      { label: "Merchant", value: "Canonical Sui address" },
      { label: "Mode", value: isDemo ? "DEMO / off-chain" : "Real / testnet-formatted" },
      { label: "Explorer", value: isDemo ? "Correctly absent" : "Matches digest" },
    ],
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(payload: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error("Proof payload is malformed or too large.");
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Proof payload could not be decoded.");
  }
}

export function encodeReceiptProofPayload(proof: ReceiptProofDocument): string {
  const parsed = receiptProofSchema.parse(proof);
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

export function decodeReceiptProofPayload(payload: string): ReceiptProofDocument {
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload));
    return receiptProofSchema.parse(JSON.parse(json));
  } catch (error) {
    if (error instanceof Error && /payload/i.test(error.message)) throw error;
    throw new Error("Proof payload is invalid.");
  }
}
