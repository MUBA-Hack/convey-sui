/**
 * Protected Transfer terminal action — pure, client-safe, deterministic.
 *
 * Builds exactly one `protected_transfer::release_funds<T>` or
 * `protected_transfer::refund_payer<T>` Move call against a strict canonical
 * source bound to the Created escrow. The terminal action consumes the shared
 * escrow object and the Sui Clock; it never splits or transfers the coin
 * directly. Local time/role is a UX preflight only — the Move Clock and the
 * on-chain sender check remain authoritative.
 *
 * This module contains no React, fetch, environment access, secrets, HMAC,
 * storage, signing, submission, RPC, or fake lifecycle state. It validates
 * every input and fails closed before constructing the transaction. Callers
 * cannot override the module, function, Clock, coin type, or commitment.
 *
 * TRUTH BOUNDARY: A built transaction is not settlement. A verified terminal
 * response proves only an exact matching `Released`/`Refunded` event from the
 * configured package on Sui testnet — never payout, balance, deployment
 * identity, or production readiness.
 */

import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  isValidTransactionDigest,
  normalizeStructTag,
  normalizeSuiAddress,
  parseStructTag,
} from "@mysten/sui/utils";
import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import { z } from "zod";
import { toHex } from "../protocol/hash";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET } from "./constants";
import { assertProtectedTransferRolesDistinct } from "./protected-transfer";

/** Fixed Move module name for terminal actions. */
export const PROTECTED_TRANSFER_TERMINAL_MODULE = "protected_transfer";
/** Release function name. */
export const PROTECTED_TRANSFER_RELEASE_FUNCTION = "release_funds";
/** Refund function name. */
export const PROTECTED_TRANSFER_REFUND_FUNCTION = "refund_payer";
/** Standard Sui Clock object ID. */
export const PROTECTED_TRANSFER_TERMINAL_CLOCK_ID = SUI_CLOCK_OBJECT_ID;
/** Maximum request body size for terminal verify routes. */
export const PROTECTED_TRANSFER_TERMINAL_VERIFY_MAX_BYTES = 4 * 1024;

export const PROTECTED_TRANSFER_TERMINAL_ACTIONS = ["release", "refund"] as const;
export type ProtectedTransferTerminalAction =
  (typeof PROTECTED_TRANSFER_TERMINAL_ACTIONS)[number];
export const ProtectedTransferTerminalActionSchema = z.enum(
  PROTECTED_TRANSFER_TERMINAL_ACTIONS,
);

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

/**
 * Strict canonical source for a terminal action. Every field is bound to the
 * Created escrow anchor and the plan that produced it. This is the single
 * strict unit the builder and the evaluator share.
 */
export const ProtectedTransferTerminalSourceSchema = z.strictObject({
  action: ProtectedTransferTerminalActionSchema,
  packageId: CanonicalSuiAddressSchema,
  escrowObjectId: CanonicalSuiAddressSchema,
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  reviewerAddress: CanonicalSuiAddressSchema,
  coinType: z.literal(USDC_COIN_TYPE_TESTNET),
  amountMicro: UsdcMicroSchema,
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: CommitmentSchema,
});
export type ProtectedTransferTerminalSource = z.infer<
  typeof ProtectedTransferTerminalSourceSchema
>;

/** Public builder input. Sender + current time are caller-supplied. */
export interface BuildProtectedTransferTerminalInput {
  source: ProtectedTransferTerminalSource;
  /** Actor address: reviewer for release, payer for refund. Canonicalized. */
  sender: string;
  /** Caller-supplied current time in ms. UX preflight only. */
  nowMs: number;
}

/** Immutable metadata bound to the built terminal transaction. */
export interface ProtectedTransferTerminalMetadata {
  readonly action: ProtectedTransferTerminalAction;
  readonly packageId: string;
  readonly module: string;
  readonly function: string;
  readonly clockId: string;
  readonly coinType: string;
  readonly sender: string;
  readonly escrowObjectId: string;
  readonly payerAddress: string;
  readonly beneficiaryAddress: string;
  readonly reviewerAddress: string;
  readonly amountMicro: string;
  readonly deadlineMs: number;
  readonly evidenceCommitmentHex: string;
  readonly target: string;
}

export interface BuildProtectedTransferTerminalResult {
  transaction: Transaction;
  metadata: ProtectedTransferTerminalMetadata;
}

function canonicalizeAddress(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: missing or empty.`);
  }
  const normalized = normalizeSuiAddress(value.trim());
  if (!isValidSuiAddress(normalized)) {
    throw new Error(`Invalid ${label}: not a valid Sui address.`);
  }
  return normalized;
}

/**
 * Local time/role UX preflight. Exact boundaries mirror Move:
 *   release -> reviewer sender and nowMs <= deadlineMs
 *   refund  -> payer sender and nowMs > deadlineMs
 * The Move Clock and on-chain sender check remain authoritative; this only
 * prevents building an obviously-unexecutable transaction client-side.
 */
function preflightAction(
  action: ProtectedTransferTerminalAction,
  canonicalSender: string,
  source: ProtectedTransferTerminalSource,
  nowMs: number,
): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("nowMs must be a finite safe integer.");
  }
  if (action === "release") {
    if (canonicalSender !== source.reviewerAddress) {
      throw new Error("Release sender must be the reviewer.");
    }
    if (nowMs > source.deadlineMs) {
      throw new Error("Release must occur at or before the deadline.");
    }
  } else {
    if (canonicalSender !== source.payerAddress) {
      throw new Error("Refund sender must be the payer.");
    }
    if (nowMs <= source.deadlineMs) {
      throw new Error("Refund must occur after the deadline.");
    }
  }
}

/**
 * Build one terminal transaction. Validates the strict source, canonicalizes
 * the sender, runs the local time/role preflight, and constructs exactly one
 * Move call with the shared escrow object and the Sui Clock as the only two
 * object arguments. No coin split/transfer is performed.
 */
export function buildProtectedTransferTerminal(
  input: BuildProtectedTransferTerminalInput,
): BuildProtectedTransferTerminalResult {
  if (!input || typeof input !== "object") {
    throw new Error("Protected Transfer terminal input is required.");
  }
  const parsed = ProtectedTransferTerminalSourceSchema.safeParse(input.source);
  if (!parsed.success) {
    throw new Error("Protected Transfer terminal source failed the strict schema.");
  }
  const source = parsed.data;
  const canonicalSender = canonicalizeAddress(input.sender, "sender");
  // Zero/distinct role invariants mirror the Move `create_escrow` guards and
  // the create builder. Defense in depth even though the source is bound to a
  // Created escrow that already enforced these.
  assertProtectedTransferRolesDistinct({
    payer: source.payerAddress,
    beneficiary: source.beneficiaryAddress,
    reviewer: source.reviewerAddress,
  });
  preflightAction(source.action, canonicalSender, source, input.nowMs);

  const fn =
    source.action === "release"
      ? PROTECTED_TRANSFER_RELEASE_FUNCTION
      : PROTECTED_TRANSFER_REFUND_FUNCTION;
  const target = `${source.packageId}::${PROTECTED_TRANSFER_TERMINAL_MODULE}::${fn}`;

  const transaction = new Transaction();
  transaction.setSender(canonicalSender);
  // Single Move call. Signature: release_funds<T>(ProtectedTransfer<T>, &Clock)
  // and refund_payer<T>(ProtectedTransfer<T>, &Clock). Two object args only.
  transaction.moveCall({
    target,
    typeArguments: [USDC_COIN_TYPE_TESTNET],
    arguments: [
      transaction.object(source.escrowObjectId),
      transaction.object.clock(),
    ],
  });

  const metadata: ProtectedTransferTerminalMetadata = {
    action: source.action,
    packageId: source.packageId,
    module: PROTECTED_TRANSFER_TERMINAL_MODULE,
    function: fn,
    clockId: PROTECTED_TRANSFER_TERMINAL_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    escrowObjectId: source.escrowObjectId,
    payerAddress: source.payerAddress,
    beneficiaryAddress: source.beneficiaryAddress,
    reviewerAddress: source.reviewerAddress,
    amountMicro: source.amountMicro,
    deadlineMs: source.deadlineMs,
    evidenceCommitmentHex: source.evidenceCommitmentHex,
    target,
  };
  Object.freeze(metadata);
  return { transaction, metadata };
}

// === Strict terminal verification ===

export const PROTECTED_TRANSFER_TERMINAL_REJECTED_REASONS = [
  "invalid_request",
  "not_configured",
  "failed",
  "digest",
  "event_missing",
  "event_ambiguous",
  "event_type",
  "event_fields",
  "action",
  "package",
  "sender",
  "escrow",
  "payer",
  "beneficiary",
  "reviewer",
  "amount",
  "deadline",
  "commitment",
] as const;
export type ProtectedTransferTerminalRejectedReason =
  (typeof PROTECTED_TRANSFER_TERMINAL_REJECTED_REASONS)[number];
export const ProtectedTransferTerminalRejectedReasonSchema = z.enum(
  PROTECTED_TRANSFER_TERMINAL_REJECTED_REASONS,
);

export const ProtectedTransferTerminalVerifyRequestSchema = z.strictObject({
  action: ProtectedTransferTerminalActionSchema,
  digest: z.string().refine(isValidTransactionDigest),
  packageId: CanonicalSuiAddressSchema,
  escrowObjectId: CanonicalSuiAddressSchema,
  payerAddress: CanonicalSuiAddressSchema,
  beneficiaryAddress: CanonicalSuiAddressSchema,
  reviewerAddress: CanonicalSuiAddressSchema,
  amountMicro: UsdcMicroSchema,
  deadlineMs: z.number().int().safe().positive(),
  evidenceCommitmentHex: CommitmentSchema,
});
export type ProtectedTransferTerminalVerifyRequest = z.infer<
  typeof ProtectedTransferTerminalVerifyRequestSchema
>;

export const ProtectedTransferTerminalVerifyResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("verified"),
    network: z.literal("testnet"),
    action: ProtectedTransferTerminalActionSchema,
    digest: z.string().refine(isValidTransactionDigest),
    escrowObjectId: CanonicalSuiAddressSchema,
    actorAddress: CanonicalSuiAddressSchema,
    payerAddress: CanonicalSuiAddressSchema,
    beneficiaryAddress: CanonicalSuiAddressSchema,
    reviewerAddress: CanonicalSuiAddressSchema,
    coinType: z.literal(USDC_COIN_TYPE_TESTNET),
    amountMicro: UsdcMicroSchema,
    deadlineMs: z.number().int().safe().positive(),
    evidenceCommitmentHex: CommitmentSchema,
    checkedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    reason: ProtectedTransferTerminalRejectedReasonSchema,
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
export type ProtectedTransferTerminalVerifyResponse = z.infer<
  typeof ProtectedTransferTerminalVerifyResponseSchema
>;

// BCS event shapes — Released and Refunded share the same field set as Created.
const TerminalEventBcs = suiBcs.struct("TerminalEvent", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

export type ProtectedTransferTerminalEvidence =
  | {
      kind: "verified";
      action: ProtectedTransferTerminalAction;
      digest: string;
      escrowObjectId: string;
      actorAddress: string;
      payerAddress: string;
      beneficiaryAddress: string;
      reviewerAddress: string;
      amountMicro: string;
      deadlineMs: number;
      evidenceCommitmentHex: string;
    }
  | {
      kind: "rejected";
      reason: Exclude<
        ProtectedTransferTerminalRejectedReason,
        "invalid_request" | "not_configured"
      >;
    };

export interface EvaluateProtectedTransferTerminalInput {
  expectation: ProtectedTransferTerminalVerifyRequest;
  packageId: string;
  result: SuiClientTypes.TransactionResult<{ events: true }>;
}

function eventTagName(eventType: string): string | null {
  try {
    return parseStructTag(eventType).name;
  } catch {
    return null;
  }
}

/**
 * Pure strict evaluator for a terminal `Released`/`Refunded` event.
 *
 * Filters the exact expected package/module/normalized event type BEFORE
 * cardinality, then requires exactly one event. The actor is `event.sender`
 * (reviewer for release, payer for refund). Every escrow/parties/amount/
 * deadline/commitment field must match the expectation exactly. Malformed BCS
 * or any field mismatch fails closed.
 */
export function evaluateProtectedTransferTerminal(
  input: EvaluateProtectedTransferTerminalInput,
): ProtectedTransferTerminalEvidence {
  // The trusted packageId (server config) must match the expectation's
  // packageId. A mismatch fails closed before any event inspection.
  if (input.expectation.packageId !== input.packageId) {
    return { kind: "rejected", reason: "package" };
  }
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

  const expectedName = input.expectation.action === "release" ? "Released" : "Refunded";
  const expectedType = `${input.packageId}::protected_transfer::${expectedName}<${USDC_COIN_TYPE_TESTNET}>`;
  let expectedNormalized = "";
  try {
    expectedNormalized = normalizeStructTag(expectedType);
  } catch {
    return { kind: "rejected", reason: "event_type" };
  }

  const candidates = arm.events.filter((event) => {
    if (eventTagName(event.eventType) !== expectedName) return false;
    if (normalizeSuiAddress(event.packageId) !== input.packageId) return false;
    if (event.module !== "protected_transfer") return false;
    try {
      return normalizeStructTag(event.eventType) === expectedNormalized;
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) {
    return { kind: "rejected", reason: "event_missing" };
  }
  if (candidates.length !== 1) {
    return { kind: "rejected", reason: "event_ambiguous" };
  }
  const event = candidates[0]!;

  let fields: ReturnType<typeof TerminalEventBcs.parse>;
  try {
    fields = TerminalEventBcs.parse(event.bcs);
  } catch {
    return { kind: "rejected", reason: "event_fields" };
  }

  const escrowObjectId = normalizeSuiAddress(fields.id);
  const payerAddress = normalizeSuiAddress(fields.payer);
  const beneficiaryAddress = normalizeSuiAddress(fields.beneficiary);
  const reviewerAddress = normalizeSuiAddress(fields.reviewer);
  const senderAddress = normalizeSuiAddress(event.sender);

  // Actor is event.sender: reviewer for release, payer for refund.
  const expectedActor =
    input.expectation.action === "release"
      ? input.expectation.reviewerAddress
      : input.expectation.payerAddress;
  if (senderAddress !== expectedActor) {
    return { kind: "rejected", reason: "sender" };
  }

  if (escrowObjectId !== input.expectation.escrowObjectId) {
    return { kind: "rejected", reason: "escrow" };
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
    action: input.expectation.action,
    digest: arm.digest,
    escrowObjectId,
    actorAddress: senderAddress,
    payerAddress,
    beneficiaryAddress,
    reviewerAddress,
    amountMicro,
    deadlineMs: Number(deadline),
    evidenceCommitmentHex,
  };
}
