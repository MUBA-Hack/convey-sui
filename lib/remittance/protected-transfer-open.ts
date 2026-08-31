/**
 * Protected Transfer open-state seam — pure, client-safe evaluator.
 *
 * Evaluates one bounded shared-object lookup against the Created anchor.
 * Closed union: `open | terminal_unknown | rejected | unavailable`. Object
 * absent/deleted is NEVER `open`; without a known verified terminal digest it
 * is `terminal_unknown`. If the provider shape cannot prove fields safely,
 * the server returns `unavailable`/`terminal_unknown`, never optimistic open.
 *
 * TRUTH BOUNDARY: An `open` result proves only that the exact shared object
 * exists at the configured package with the exact type and exact immutable
 * fields/balance matching the Created anchor, at the moment of one read-only
 * lookup. It does not prove the escrow will remain open, does not prove a
 * terminal action has not been submitted in a pending tx, and is not a
 * terminal receipt. A carried `open` response is not durable chain evidence.
 */
import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import {
  isValidSuiAddress,
  normalizeStructTag,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { z } from "zod";
import { toHex } from "../protocol/hash";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET } from "./constants";

export const PROTECTED_TRANSFER_OPEN_MAX_BYTES = 4 * 1024;

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

export const ProtectedTransferOpenRequestSchema = z.strictObject({
  escrowObjectId: CanonicalSuiAddressSchema,
  packageId: CanonicalSuiAddressSchema,
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  reviewerAddress: CanonicalSuiAddressSchema,
  amountMicro: UsdcMicroSchema,
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: CommitmentSchema,
});
export type ProtectedTransferOpenRequest = z.infer<
  typeof ProtectedTransferOpenRequestSchema
>;

export const PROTECTED_TRANSFER_OPEN_REJECTED_REASONS = [
  "invalid_request",
  "not_configured",
  "type",
  "package",
  "payer",
  "beneficiary",
  "reviewer",
  "amount",
  "deadline",
  "commitment",
  "balance",
] as const;
export type ProtectedTransferOpenRejectedReason =
  (typeof PROTECTED_TRANSFER_OPEN_REJECTED_REASONS)[number];
export const ProtectedTransferOpenRejectedReasonSchema = z.enum(
  PROTECTED_TRANSFER_OPEN_REJECTED_REASONS,
);

export const ProtectedTransferOpenResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("open"),
    network: z.literal("testnet"),
    escrowObjectId: CanonicalSuiAddressSchema,
    packageId: CanonicalSuiAddressSchema,
    payerAddress: CanonicalSuiAddressSchema,
    beneficiaryAddress: CanonicalSuiAddressSchema,
    reviewerAddress: CanonicalSuiAddressSchema,
    coinType: z.literal(USDC_COIN_TYPE_TESTNET),
    amountMicro: UsdcMicroSchema,
    deadlineMs: z.number().int().safe().positive(),
    evidenceCommitmentHex: CommitmentSchema,
    heldBalanceMicro: UsdcMicroSchema,
    checkedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("terminal_unknown"),
    reason: z.literal("object_absent"),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    reason: ProtectedTransferOpenRejectedReasonSchema,
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.literal("rpc_unavailable"),
  }),
]);
export type ProtectedTransferOpenResponse = z.infer<
  typeof ProtectedTransferOpenResponseSchema
>;

// ProtectedTransfer<T> BCS: id: UID, payer, beneficiary, reviewer, amount: u64,
// evidence_commitment: vector<u8>, deadline: u64, balance: Balance<T>.
// UID = { id: ID }, Balance<T> = { value: u64 }. ID is an address.
const UidBcs = suiBcs.struct("UID", { id: suiBcs.Address });
const BalanceBcs = suiBcs.struct("Balance", { value: suiBcs.u64() });
const ProtectedTransferBcs = suiBcs.struct("ProtectedTransfer", {
  id: UidBcs,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
  deadline: suiBcs.u64(),
  balance: BalanceBcs,
});

export interface EvaluateProtectedTransferOpenInput {
  expectation: ProtectedTransferOpenRequest;
  packageId: string;
  object: SuiClientTypes.Object<{ content: true }>;
}

export type ProtectedTransferOpenEvidence =
  | {
      kind: "open";
      escrowObjectId: string;
      payerAddress: string;
      beneficiaryAddress: string;
      reviewerAddress: string;
      amountMicro: string;
      deadlineMs: number;
      evidenceCommitmentHex: string;
      heldBalanceMicro: string;
    }
  | { kind: "terminal_unknown"; reason: "object_absent" }
  | {
      kind: "rejected";
      reason: Exclude<
        ProtectedTransferOpenRejectedReason,
        "invalid_request" | "not_configured"
      >;
    };

/**
 * Pure evaluator for one bounded shared-object lookup.
 *
 * Requires the exact expected type `${packageId}::protected_transfer::ProtectedTransfer<${USDC}>`
 * BEFORE parsing content. Parses BCS content exactly once and checks every
 * immutable field plus the held balance against the Created anchor. Any
 * mismatch, malformed BCS, or wrong type fails closed. Object absent/deleted
 * is `terminal_unknown`, never optimistic `open`.
 */
export function evaluateProtectedTransferOpen(
  input: EvaluateProtectedTransferOpenInput,
): ProtectedTransferOpenEvidence {
  // The trusted packageId (server config) must match the expectation's
  // packageId. A mismatch fails closed before any object inspection.
  if (input.expectation.packageId !== input.packageId) {
    return { kind: "rejected", reason: "package" };
  }
  const obj = input.object;
  // Object must be shared (shared escrow) and carry content BCS.
  if (obj.owner?.$kind !== "Shared") {
    return { kind: "rejected", reason: "type" };
  }
  if (!obj.content || obj.content.byteLength === 0) {
    return { kind: "rejected", reason: "type" };
  }

  const expectedType = `${input.packageId}::protected_transfer::ProtectedTransfer<${USDC_COIN_TYPE_TESTNET}>`;
  let expectedNormalized = "";
  try {
    expectedNormalized = normalizeStructTag(expectedType);
  } catch {
    return { kind: "rejected", reason: "type" };
  }
  if (typeof obj.type !== "string") {
    return { kind: "rejected", reason: "type" };
  }
  try {
    if (normalizeStructTag(obj.type) !== expectedNormalized) {
      return { kind: "rejected", reason: "type" };
    }
  } catch {
    return { kind: "rejected", reason: "type" };
  }

  let fields: ReturnType<typeof ProtectedTransferBcs.parse>;
  try {
    fields = ProtectedTransferBcs.parse(obj.content);
  } catch {
    return { kind: "rejected", reason: "type" };
  }

  const escrowObjectId = normalizeSuiAddress(fields.id.id);
  const payerAddress = normalizeSuiAddress(fields.payer);
  const beneficiaryAddress = normalizeSuiAddress(fields.beneficiary);
  const reviewerAddress = normalizeSuiAddress(fields.reviewer);
  const amountMicro = fields.amount.toString();
  const deadline = BigInt(fields.deadline.toString());
  const heldBalanceMicro = fields.balance.value.toString();
  const evidenceCommitmentHex = toHex(new Uint8Array(fields.evidence_commitment));

  if (escrowObjectId !== input.expectation.escrowObjectId) {
    return { kind: "rejected", reason: "type" };
  }
  if (payerAddress !== input.expectation.payerAddress) {
    return { kind: "rejected", reason: "payer" };
  }
  if (beneficiaryAddress !== input.expectation.beneficiaryAddress) {
    return { kind: "rejected", reason: "beneficiary" };
  }
  if (reviewerAddress !== input.expectation.reviewerAddress) {
    return { kind: "rejected", reason: "reviewer" };
  }
  if (amountMicro !== input.expectation.amountMicro) {
    return { kind: "rejected", reason: "amount" };
  }
  if (deadline !== BigInt(input.expectation.deadlineMs)) {
    return { kind: "rejected", reason: "deadline" };
  }
  if (evidenceCommitmentHex !== input.expectation.evidenceCommitmentHex) {
    return { kind: "rejected", reason: "commitment" };
  }
  // Held balance must equal the pinned amount exactly — no partial drain.
  if (heldBalanceMicro !== input.expectation.amountMicro) {
    return { kind: "rejected", reason: "balance" };
  }

  return {
    kind: "open",
    escrowObjectId,
    payerAddress,
    beneficiaryAddress,
    reviewerAddress,
    amountMicro,
    deadlineMs: Number(deadline),
    evidenceCommitmentHex,
    heldBalanceMicro,
  };
}
