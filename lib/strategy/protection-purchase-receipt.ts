import { z } from "zod";
import {
  PROTECTION_PURCHASE_CHAIN_ID,
  ProtectionPurchasePlanSummarySchema,
  type ProtectionPurchasePlanSummary,
} from "./protection-purchase";

export const PROTECTION_PURCHASE_RECEIPT_KIND =
  "convey.protection-purchase-receipt" as const;
export const PROTECTION_PURCHASE_RECEIPT_VERSION = 1 as const;
export const PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM = "o" as const;
export const PROTECTION_PURCHASE_VERIFY_MAX_BYTES = 4 * 1024;
export const PROTECTION_PURCHASE_RECEIPT_MAX_BYTES = 16 * 1024;
export const PROTECTION_PURCHASE_RECEIPT_MAX_PAYLOAD_LENGTH = 24_576;

const EvmAddressSchema = z
  .string()
  .regex(/^0x[a-f0-9]{40}$/u, "Expected a lowercase EVM address.");
export const TransactionHashSchema = z
  .string()
  .regex(/^0x[a-f0-9]{64}$/iu, "Expected a transaction hash.")
  .transform((value) => value.toLowerCase());

export function parseTransactionHash(value: unknown): `0x${string}` | null {
  const parsed = TransactionHashSchema.safeParse(value);
  return parsed.success ? parsed.data as `0x${string}` : null;
}
const UnsignedIntegerStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);
const PositiveIntegerStringSchema = z.string().regex(/^[1-9]\d*$/u);

export const ProtectionPurchaseVerifyRequestSchema = z.strictObject({
  txHash: TransactionHashSchema,
  plan: ProtectionPurchasePlanSummarySchema,
});
export type ProtectionPurchaseVerifyRequest = z.infer<
  typeof ProtectionPurchaseVerifyRequestSchema
>;

export const VerifiedProtectionPurchaseSchema = z.strictObject({
  kind: z.literal("verified"),
  network: z.literal("base-mainnet"),
  chainId: z.literal(PROTECTION_PURCHASE_CHAIN_ID),
  txHash: TransactionHashSchema,
  blockNumber: z.number().int().safe().nonnegative(),
  buyerAddress: EvmAddressSchema,
  makerAddress: EvmAddressSchema,
  optionAddress: EvmAddressSchema.refine(
    (value) => value !== "0x0000000000000000000000000000000000000000",
    "Option address cannot be zero.",
  ),
  nonce: UnsignedIntegerStringSchema,
  premiumAmountMicro: PositiveIntegerStringSchema,
  feeCollectedMicro: UnsignedIntegerStringSchema,
  referralFeePaidMicro: UnsignedIntegerStringSchema,
  referrerAddress: EvmAddressSchema,
  sellerWasMaker: z.literal(true),
  checkedAt: z.iso.datetime(),
});
export type VerifiedProtectionPurchase = z.infer<
  typeof VerifiedProtectionPurchaseSchema
>;

export const ProtectionPurchaseVerifyResponseSchema = z.discriminatedUnion(
  "kind",
  [
    VerifiedProtectionPurchaseSchema,
    z.strictObject({
      kind: z.literal("pending"),
      reason: z.literal("transaction_not_found"),
    }),
    z.strictObject({
      kind: z.literal("rejected"),
      reason: z.enum([
        "invalid_request",
        "failed_transaction",
        "transaction_mismatch",
        "event_mismatch",
        "ambiguous_event",
      ]),
    }),
    z.strictObject({
      kind: z.literal("unavailable"),
      reason: z.literal("rpc_unavailable"),
    }),
  ],
);
export type ProtectionPurchaseVerifyResponse = z.infer<
  typeof ProtectionPurchaseVerifyResponseSchema
>;

export const ProtectionPurchaseReceiptSchema = z
  .strictObject({
    kind: z.literal(PROTECTION_PURCHASE_RECEIPT_KIND),
    version: z.literal(PROTECTION_PURCHASE_RECEIPT_VERSION),
    plan: ProtectionPurchasePlanSummarySchema,
    purchase: VerifiedProtectionPurchaseSchema,
    approvalTxHash: TransactionHashSchema.nullable(),
    exportedAt: z.iso.datetime(),
  })
  .superRefine((document, context) => {
    const bindings: ReadonlyArray<{
      path: keyof VerifiedProtectionPurchase;
      actual: unknown;
      expected: unknown;
    }> = [
      { path: "chainId", actual: document.purchase.chainId, expected: document.plan.chainId },
      { path: "buyerAddress", actual: document.purchase.buyerAddress, expected: document.plan.account },
      { path: "makerAddress", actual: document.purchase.makerAddress, expected: document.plan.maker },
      { path: "nonce", actual: document.purchase.nonce, expected: document.plan.nonce },
      {
        path: "premiumAmountMicro",
        actual: document.purchase.premiumAmountMicro,
        expected: document.plan.estimatedPremiumMicro,
      },
      {
        path: "referrerAddress",
        actual: document.purchase.referrerAddress,
        expected: document.plan.referrer,
      },
    ];
    for (const binding of bindings) {
      if (binding.actual !== binding.expected) {
        context.addIssue({
          code: "custom",
          path: ["purchase", binding.path],
          message: `${binding.path} must match the verified purchase plan.`,
        });
      }
    }
    if (Date.parse(document.exportedAt) < Date.parse(document.purchase.checkedAt)) {
      context.addIssue({
        code: "custom",
        path: ["exportedAt"],
        message: "exportedAt cannot precede the purchase check.",
      });
    }
  });

export type ProtectionPurchaseReceiptDocument = z.infer<
  typeof ProtectionPurchaseReceiptSchema
>;

export interface BuildProtectionPurchaseReceiptInput {
  plan: ProtectionPurchasePlanSummary;
  purchase: VerifiedProtectionPurchase;
  approvalTxHash?: string | null;
  exportedAt?: string;
}

export function buildProtectionPurchaseReceipt(
  input: BuildProtectionPurchaseReceiptInput,
): ProtectionPurchaseReceiptDocument {
  return ProtectionPurchaseReceiptSchema.parse({
    kind: PROTECTION_PURCHASE_RECEIPT_KIND,
    version: PROTECTION_PURCHASE_RECEIPT_VERSION,
    plan: input.plan,
    purchase: input.purchase,
    approvalTxHash: input.approvalTxHash ?? null,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(payload: string): Uint8Array {
  if (
    typeof payload !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    payload.length % 4 === 1 ||
    payload.length > PROTECTION_PURCHASE_RECEIPT_MAX_PAYLOAD_LENGTH
  ) {
    throw new Error("Protection purchase receipt payload is malformed or too large.");
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new Error("Protection purchase receipt payload could not be decoded.");
  }
  if (bytes.byteLength > PROTECTION_PURCHASE_RECEIPT_MAX_BYTES) {
    throw new Error("Protection purchase receipt payload is too large.");
  }
  return bytes;
}

export function encodeProtectionPurchaseReceiptPayload(
  document: ProtectionPurchaseReceiptDocument,
): string {
  const parsed = ProtectionPurchaseReceiptSchema.parse(document);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed));
  if (bytes.byteLength > PROTECTION_PURCHASE_RECEIPT_MAX_BYTES) {
    throw new Error("Protection purchase receipt payload is too large.");
  }
  return bytesToBase64Url(bytes);
}

export function decodeProtectionPurchaseReceiptPayload(
  payload: string,
): ProtectionPurchaseReceiptDocument {
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload));
  } catch {
    throw new Error("Protection purchase receipt payload is invalid.");
  }
  try {
    return ProtectionPurchaseReceiptSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("Protection purchase receipt payload is invalid.");
  }
}

export function buildBaseScanTransactionUrl(txHash: string): string {
  return `https://basescan.org/tx/${TransactionHashSchema.parse(txHash)}`;
}
