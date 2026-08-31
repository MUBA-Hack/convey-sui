import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import {
  isValidSuiAddress,
  isValidTransactionDigest,
  normalizeStructTag,
  normalizeSuiAddress,
  parseStructTag,
} from "@mysten/sui/utils";
import { z } from "zod";
import { toHex } from "../protocol/hash";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET } from "./constants";

export const PROTECTED_TRANSFER_CREATED_VERIFY_MAX_BYTES = 4 * 1024;

const CanonicalSuiAddressSchema = z.string().refine(
  (value) =>
    isValidSuiAddress(value) && normalizeSuiAddress(value) === value,
  "Expected a canonical Sui address.",
);
const UsdcMicroSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => BigInt(value) <= MAX_USDC_MICRO, "Amount exceeds product cap.");
const CommitmentSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const ReviewerNameSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 80)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));

export const ProtectedTransferCreatedExpectationSchema = z.strictObject({
  digest: z.string().refine(isValidTransactionDigest),
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  amountMicro: UsdcMicroSchema,
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: CommitmentSchema,
});
export type ProtectedTransferCreatedExpectation = z.infer<
  typeof ProtectedTransferCreatedExpectationSchema
>;

export const ProtectedTransferCreatedVerifyRequestSchema =
  ProtectedTransferCreatedExpectationSchema;
export type ProtectedTransferCreatedVerifyRequest = z.infer<
  typeof ProtectedTransferCreatedVerifyRequestSchema
>;

export const ProtectedTransferCreatedRejectedReasonSchema = z.enum([
  "invalid_request",
  "not_configured",
  "failed",
  "digest",
  "event_missing",
  "event_ambiguous",
  "event_type",
  "event_fields",
  "payer",
  "beneficiary",
  "reviewer",
  "amount",
  "deadline",
  "commitment",
]);
export type ProtectedTransferCreatedRejectedReason = z.infer<
  typeof ProtectedTransferCreatedRejectedReasonSchema
>;

export const ProtectedTransferCreatedVerifyResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("verified"),
    network: z.literal("testnet"),
    digest: z.string().refine(isValidTransactionDigest),
    escrowObjectId: CanonicalSuiAddressSchema,
    payerAddress: CanonicalSuiAddressSchema,
    beneficiaryAddress: CanonicalSuiAddressSchema,
    reviewer: z.strictObject({
      name: ReviewerNameSchema,
      address: CanonicalSuiAddressSchema,
    }),
    coinType: z.literal(USDC_COIN_TYPE_TESTNET),
    amountMicro: UsdcMicroSchema,
    deadlineMs: z.number().int().safe().positive(),
    evidenceCommitmentHex: CommitmentSchema,
    checkedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    reason: ProtectedTransferCreatedRejectedReasonSchema,
  }),
  z.strictObject({
    kind: z.literal("not_found"),
    reason: z.literal("transaction_not_found"),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.literal("rpc_unavailable"),
  }),
]);
export type ProtectedTransferCreatedVerifyResponse = z.infer<
  typeof ProtectedTransferCreatedVerifyResponseSchema
>;

const CreatedEventBcs = suiBcs.struct("Created", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

export type ProtectedTransferCreatedEvidence =
  | {
      kind: "verified";
      digest: string;
      escrowObjectId: string;
      payerAddress: string;
      beneficiaryAddress: string;
      reviewerAddress: string;
      amountMicro: string;
      deadlineMs: number;
      evidenceCommitmentHex: string;
    }
  | { kind: "rejected"; reason: Exclude<ProtectedTransferCreatedRejectedReason, "invalid_request" | "not_configured"> };

export interface EvaluateProtectedTransferCreatedInput {
  expectation: ProtectedTransferCreatedExpectation;
  packageId: string;
  reviewerAddress: string;
  result: SuiClientTypes.TransactionResult<{ events: true }>;
}

function eventTag(eventType: string) {
  try {
    return parseStructTag(eventType);
  } catch {
    return null;
  }
}

export function evaluateProtectedTransferCreated(
  input: EvaluateProtectedTransferCreatedInput,
): ProtectedTransferCreatedEvidence {
  const arm =
    input.result.$kind === "Transaction"
      ? input.result.Transaction
      : input.result.FailedTransaction;
  if (arm.digest !== input.expectation.digest) {
    return { kind: "rejected", reason: "digest" };
  }
  if (input.result.$kind === "FailedTransaction" || arm.status.success !== true) {
    return { kind: "rejected", reason: "failed" };
  }
  if (!Array.isArray(arm.events)) {
    return { kind: "rejected", reason: "event_missing" };
  }

  const candidates = arm.events.filter((event) => eventTag(event.eventType)?.name === "Created");
  if (candidates.length === 0) {
    return { kind: "rejected", reason: "event_missing" };
  }
  if (candidates.length !== 1) {
    return { kind: "rejected", reason: "event_ambiguous" };
  }
  const event = candidates[0]!;
  const expectedType = `${input.packageId}::protected_transfer::Created<${USDC_COIN_TYPE_TESTNET}>`;
  let typeMatches = false;
  try {
    typeMatches = normalizeStructTag(event.eventType) === normalizeStructTag(expectedType);
  } catch {
    typeMatches = false;
  }
  if (
    !typeMatches ||
    normalizeSuiAddress(event.packageId) !== input.packageId ||
    event.module !== "protected_transfer"
  ) {
    return { kind: "rejected", reason: "event_type" };
  }

  let fields: ReturnType<typeof CreatedEventBcs.parse>;
  try {
    fields = CreatedEventBcs.parse(event.bcs);
  } catch {
    return { kind: "rejected", reason: "event_fields" };
  }
  const escrowObjectId = normalizeSuiAddress(fields.id);
  const payerAddress = normalizeSuiAddress(fields.payer);
  const beneficiaryAddress = normalizeSuiAddress(fields.beneficiary);
  const reviewerAddress = normalizeSuiAddress(fields.reviewer);
  if (payerAddress !== input.expectation.payerAddress || normalizeSuiAddress(event.sender) !== payerAddress) {
    return { kind: "rejected", reason: "payer" };
  }
  if (beneficiaryAddress !== input.expectation.beneficiaryAddress) {
    return { kind: "rejected", reason: "beneficiary" };
  }
  if (reviewerAddress !== input.reviewerAddress) {
    return { kind: "rejected", reason: "reviewer" };
  }
  const amountMicro = fields.amount.toString();
  if (amountMicro !== input.expectation.amountMicro) {
    return { kind: "rejected", reason: "amount" };
  }
  const deadline = BigInt(fields.deadline.toString());
  if (deadline !== BigInt(input.expectation.deadlineMs)) {
    return { kind: "rejected", reason: "deadline" };
  }
  const evidenceCommitmentHex = toHex(new Uint8Array(fields.evidence_commitment));
  if (evidenceCommitmentHex !== input.expectation.evidenceCommitmentHex) {
    return { kind: "rejected", reason: "commitment" };
  }
  return {
    kind: "verified",
    digest: arm.digest,
    escrowObjectId,
    payerAddress,
    beneficiaryAddress,
    reviewerAddress,
    amountMicro,
    deadlineMs: Number(deadline),
    evidenceCommitmentHex,
  };
}
