import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  ProtectedTransferExecutionPlanSchema,
  buildProtectedTransfer,
  parseProtectedTransferExecutionPlan,
  type ProtectedTransferExecutionPlan,
  type ProtectedTransferMetadata,
} from "./protected-transfer";
import { ProtectedTransferCreatedVerifyResponseSchema } from "./protected-transfer-created";
import { buildExplorerUrl } from "./transfer";

export const PROTECTED_TRANSFER_CREATED_RECEIPT_KIND =
  "convey.protected-transfer-created-receipt" as const;
export const PROTECTED_TRANSFER_CREATED_RECEIPT_VERSION = 1 as const;
export const PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM = "c" as const;
export const PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES = 16 * 1024;
export const PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_PAYLOAD_LENGTH = 24_576;

const VerifiedCreatedResponseSchema =
  ProtectedTransferCreatedVerifyResponseSchema.options[0];
export type VerifiedProtectedTransferCreatedResponse = z.infer<
  typeof VerifiedCreatedResponseSchema
>;

const CanonicalSuiAddressSchema = z.string().refine(
  (value) => isValidSuiAddress(value) && normalizeSuiAddress(value) === value,
  "Expected a canonical Sui address.",
);
const ReviewerNameSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 80)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const RecipientNameSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 120)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const ReviewNoteSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 120)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));

export const ProtectedTransferCreatedReceiptTermsSchema = z.strictObject({
  digest: z.string().refine(isValidTransactionDigest),
  explorerUrl: z.url().max(200),
  escrowObjectId: CanonicalSuiAddressSchema,
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  recipient: RecipientNameSchema,
  reviewerName: ReviewerNameSchema,
  reviewerAddress: CanonicalSuiAddressSchema,
  packageId: CanonicalSuiAddressSchema,
  coinType: z.literal(USDC_COIN_TYPE_TESTNET),
  amountMicro: z.string().regex(/^[1-9]\d*$/),
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: z.string().regex(/^0x[0-9a-f]{64}$/),
  reviewNote: ReviewNoteSchema,
  createdCheckedAt: z.iso.datetime(),
});
export type ProtectedTransferCreatedReceiptTerms = z.infer<
  typeof ProtectedTransferCreatedReceiptTermsSchema
>;

export const ProtectedTransferCreatedReceiptSchema = z
  .strictObject({
    kind: z.literal(PROTECTED_TRANSFER_CREATED_RECEIPT_KIND),
    version: z.literal(PROTECTED_TRANSFER_CREATED_RECEIPT_VERSION),
    created: VerifiedCreatedResponseSchema,
    plan: ProtectedTransferExecutionPlanSchema,
    transfer: ProtectedTransferCreatedReceiptTermsSchema,
    exportedAt: z.iso.datetime(),
  })
  .superRefine((document, context) => {
    const created = document.created;
    const transfer = document.transfer;
    const bindings: ReadonlyArray<{
      field: keyof ProtectedTransferCreatedReceiptTerms;
      actual: unknown;
      expected: unknown;
    }> = [
      { field: "digest", actual: transfer.digest, expected: created.digest },
      { field: "escrowObjectId", actual: transfer.escrowObjectId, expected: created.escrowObjectId },
      { field: "payerAddress", actual: transfer.payerAddress, expected: created.payerAddress },
      { field: "beneficiaryAddress", actual: transfer.beneficiaryAddress, expected: created.beneficiaryAddress },
      { field: "reviewerName", actual: transfer.reviewerName, expected: created.reviewer.name },
      { field: "reviewerAddress", actual: transfer.reviewerAddress, expected: created.reviewer.address },
      { field: "coinType", actual: transfer.coinType, expected: created.coinType },
      { field: "amountMicro", actual: transfer.amountMicro, expected: created.amountMicro },
      { field: "deadlineMs", actual: transfer.deadlineMs, expected: created.deadlineMs },
      {
        field: "evidenceCommitmentHex",
        actual: transfer.evidenceCommitmentHex,
        expected: created.evidenceCommitmentHex,
      },
      { field: "createdCheckedAt", actual: transfer.createdCheckedAt, expected: created.checkedAt },
    ];
    for (const binding of bindings) {
      if (binding.actual !== binding.expected) {
        context.addIssue({
          code: "custom",
          path: ["transfer", binding.field],
          message: `${String(binding.field)} must match the independently checked Created response.`,
        });
      }
    }

    if (transfer.explorerUrl !== buildExplorerUrl(created.digest)) {
      context.addIssue({
        code: "custom",
        path: ["transfer", "explorerUrl"],
        message: "Explorer URL must match the Created transaction digest on Sui testnet.",
      });
    }
    if (Date.parse(document.exportedAt) < Date.parse(created.checkedAt)) {
      context.addIssue({
        code: "custom",
        path: ["exportedAt"],
        message: "exportedAt cannot precede the Created-event check.",
      });
    }

    try {
      const rebuilt = buildProtectedTransfer({
        plan: document.plan,
        sender: created.payerAddress,
        nowMs: document.plan.authorization.issuedAt,
      }).metadata;
      const planBindings: ReadonlyArray<{
        field: keyof ProtectedTransferCreatedReceiptTerms;
        actual: unknown;
        expected: unknown;
      }> = [
        { field: "payerAddress", actual: transfer.payerAddress, expected: rebuilt.sender },
        { field: "beneficiaryAddress", actual: transfer.beneficiaryAddress, expected: rebuilt.beneficiary },
        { field: "recipient", actual: transfer.recipient, expected: document.plan.authorization.recipient },
        { field: "reviewerName", actual: transfer.reviewerName, expected: document.plan.reviewerName },
        { field: "reviewerAddress", actual: transfer.reviewerAddress, expected: rebuilt.reviewer },
        { field: "packageId", actual: transfer.packageId, expected: rebuilt.packageId },
        { field: "coinType", actual: transfer.coinType, expected: rebuilt.coinType },
        { field: "amountMicro", actual: transfer.amountMicro, expected: rebuilt.amountMicro },
        { field: "deadlineMs", actual: transfer.deadlineMs, expected: rebuilt.deadlineMs },
        { field: "reviewNote", actual: transfer.reviewNote, expected: rebuilt.reviewNote },
        {
          field: "evidenceCommitmentHex",
          actual: created.evidenceCommitmentHex,
          expected: rebuilt.commitmentHex,
        },
      ];
      for (const binding of planBindings) {
        if (binding.actual !== binding.expected) {
          context.addIssue({
            code: "custom",
            path: ["transfer", binding.field],
            message: `${String(binding.field)} must match the strict execution plan commitment.`,
          });
        }
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["plan"],
        message: "Execution plan cannot reproduce the checked Created commitment.",
      });
    }
  });

export type ProtectedTransferCreatedReceiptDocument = z.infer<
  typeof ProtectedTransferCreatedReceiptSchema
>;

export interface BuildProtectedTransferCreatedReceiptInput {
  verification: VerifiedProtectedTransferCreatedResponse;
  plan: ProtectedTransferExecutionPlan;
  metadata: ProtectedTransferMetadata;
  exportedAt?: string;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Protected Transfer Created receipt ${label} does not match.`);
  }
}

export function buildProtectedTransferCreatedReceipt(
  input: BuildProtectedTransferCreatedReceiptInput,
): ProtectedTransferCreatedReceiptDocument {
  const verification = VerifiedCreatedResponseSchema.parse(input.verification);
  const parsedPlan = ProtectedTransferExecutionPlanSchema.parse(input.plan);
  const plan = parseProtectedTransferExecutionPlan(
    parsedPlan,
    parsedPlan.authorization.issuedAt,
  );
  if (!plan.reviewerName) {
    throw new Error("Protected Transfer Created receipt reviewer name is required.");
  }

  const rebuilt = buildProtectedTransfer({
    plan,
    sender: verification.payerAddress,
    nowMs: plan.authorization.issuedAt,
  }).metadata;

  assertEqual("sender", input.metadata.sender, rebuilt.sender);
  assertEqual("beneficiary", input.metadata.beneficiary, rebuilt.beneficiary);
  assertEqual("reviewer", input.metadata.reviewer, rebuilt.reviewer);
  assertEqual("package", input.metadata.packageId, rebuilt.packageId);
  assertEqual("coin type", input.metadata.coinType, rebuilt.coinType);
  assertEqual("amount", input.metadata.amountMicro, rebuilt.amountMicro);
  assertEqual("deadline", input.metadata.deadlineMs, rebuilt.deadlineMs);
  assertEqual("review note", input.metadata.reviewNote, rebuilt.reviewNote);
  assertEqual("commitment", input.metadata.commitmentHex, rebuilt.commitmentHex);

  assertEqual("payer", verification.payerAddress, rebuilt.sender);
  assertEqual("beneficiary", verification.beneficiaryAddress, rebuilt.beneficiary);
  assertEqual("reviewer address", verification.reviewer.address, rebuilt.reviewer);
  assertEqual("reviewer name", verification.reviewer.name, plan.reviewerName);
  assertEqual("coin type", verification.coinType, rebuilt.coinType);
  assertEqual("amount", verification.amountMicro, rebuilt.amountMicro);
  assertEqual("deadline", verification.deadlineMs, rebuilt.deadlineMs);
  assertEqual("commitment", verification.evidenceCommitmentHex, rebuilt.commitmentHex);

  return ProtectedTransferCreatedReceiptSchema.parse({
    kind: PROTECTED_TRANSFER_CREATED_RECEIPT_KIND,
    version: PROTECTED_TRANSFER_CREATED_RECEIPT_VERSION,
    created: verification,
    plan,
    transfer: {
      digest: verification.digest,
      explorerUrl: buildExplorerUrl(verification.digest),
      escrowObjectId: verification.escrowObjectId,
      payerAddress: verification.payerAddress,
      beneficiaryAddress: verification.beneficiaryAddress,
      recipient: plan.authorization.recipient,
      reviewerName: verification.reviewer.name,
      reviewerAddress: verification.reviewer.address,
      packageId: rebuilt.packageId,
      coinType: verification.coinType,
      amountMicro: verification.amountMicro,
      deadlineMs: verification.deadlineMs,
      evidenceCommitmentHex: verification.evidenceCommitmentHex,
      reviewNote: rebuilt.reviewNote,
      createdCheckedAt: verification.checkedAt,
    },
    exportedAt: input.exportedAt ?? new Date().toISOString(),
  });
}

export interface VerifiedProtectedTransferCreatedReceipt {
  ok: true;
  kind: "protected_transfer_created";
  claim: string;
  document: ProtectedTransferCreatedReceiptDocument;
}

export interface InvalidProtectedTransferCreatedReceipt {
  ok: false;
  errors: string[];
}

export type ProtectedTransferCreatedReceiptResult =
  | VerifiedProtectedTransferCreatedReceipt
  | InvalidProtectedTransferCreatedReceipt;

function formatIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string[] {
  return issues.map((issue) => {
    const field = issue.path.length ? `${issue.path.map(String).join(".")}: ` : "";
    return `${field}${issue.message}`;
  });
}

export function verifyProtectedTransferCreatedReceipt(
  input: unknown,
): ProtectedTransferCreatedReceiptResult {
  let candidate = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES) {
      return { ok: false, errors: ["Protected Transfer Created receipt is too large."] };
    }
    try {
      candidate = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["Protected Transfer Created receipt JSON could not be parsed."] };
    }
  }
  const parsed = ProtectedTransferCreatedReceiptSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues) };
  return {
    ok: true,
    kind: "protected_transfer_created",
    claim:
      "Created event fields are bound to the carried verification response. " +
      "This page has not repeated that independent Sui check; later escrow lifecycle is outside this receipt.",
    document: parsed.data,
  };
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
    payload.length % 4 === 1 ||
    payload.length > PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_PAYLOAD_LENGTH
  ) {
    throw new Error("Protected Transfer Created receipt payload is malformed or too large.");
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bytes = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (character) => character.charCodeAt(0),
    );
    if (bytes.byteLength > PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES) {
      throw new Error("Protected Transfer Created receipt payload is too large.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && /too large/i.test(error.message)) throw error;
    throw new Error("Protected Transfer Created receipt payload could not be decoded.");
  }
}

export function encodeProtectedTransferCreatedReceiptPayload(
  document: ProtectedTransferCreatedReceiptDocument,
): string {
  const parsed = ProtectedTransferCreatedReceiptSchema.parse(document);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed));
  if (bytes.byteLength > PROTECTED_TRANSFER_CREATED_RECEIPT_MAX_BYTES) {
    throw new Error("Protected Transfer Created receipt payload is too large.");
  }
  return bytesToBase64Url(bytes);
}

export function decodeProtectedTransferCreatedReceiptPayload(
  payload: string,
): ProtectedTransferCreatedReceiptDocument {
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload));
  } catch (error) {
    if (error instanceof Error && /payload/i.test(error.message)) throw error;
    throw new Error("Protected Transfer Created receipt payload is invalid.");
  }
  try {
    return ProtectedTransferCreatedReceiptSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("Protected Transfer Created receipt payload is invalid.");
  }
}
