/**
 * Pure Sui settlement-evidence evaluator.
 *
 * Given a `waitForTransaction` result (with `balanceChanges` included), the
 * expected digest, the canonical recipient, and the expected pinned USDC micro
 * amount, this pure function decides whether on-chain settlement is verified,
 * explicitly failed, or unverified.
 *
 * Truth boundary: only `verified` is settlement. `failed` is an explicit chain
 * failure that may unlock retry. `unverified` after a digest exists stays
 * submitted-pending/locked — never onSettled, never retryable.
 *
 * The caller may NOT provide coin type, network, or RPC URL. The pinned
 * `USDC_COIN_TYPE_TESTNET` is the only accepted coin type.
 */

import type { SuiClientTypes } from "@mysten/sui/client";
import {
  isValidSuiAddress,
  isValidTransactionDigest,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { USDC_COIN_TYPE_TESTNET } from "./constants";

export type SettlementUnverifiedReason =
  | "digest"
  | "balance_changes"
  | "coin_type"
  | "recipient"
  | "amount"
  | "malformed";

export type SettlementEvidence =
  | { kind: "verified"; digest: string; usdcMicro: bigint; recipientAddress: string }
  | { kind: "failed"; digest: string; error: string | null }
  | { kind: "unverified"; digest: string | null; reason: SettlementUnverifiedReason };

export interface VerifySettlementInput {
  expectedDigest: string;
  expectedRecipientAddress: string;
  /** Pinned USDC micro amount as an integer string (from the verified authorization). */
  expectedUsdcMicro: string;
  result: SuiClientTypes.TransactionResult<{ balanceChanges: true }>;
}

type TxArm = SuiClientTypes.Transaction<{ balanceChanges: true }>;

/**
 * Evaluate a `waitForTransaction` result against the expected settlement.
 *
 * Verified only if:
 * 1. the returned digest matches the expected digest,
 * 2. the arm is a successful Transaction (not FailedTransaction, status.success === true),
 * 3. the canonical expected recipient's aggregated pinned USDC balance change
 *    exactly equals the expected positive/bounded usdcMicro.
 *
 * Signed amounts are parsed with BigInt. Unrelated entries (other coins, other
 * addresses) are ignored. Missing/wrong coin/wrong recipient/off-by-one/
 * net-negative/malformed are rejected as `unverified`.
 */
export function verifySettlement(input: VerifySettlementInput): SettlementEvidence {
  const { expectedDigest, expectedRecipientAddress, expectedUsdcMicro, result } = input;

  // The expected amount is caller-provided but must be a valid positive integer.
  let expectedMicro: bigint;
  try {
    expectedMicro = BigInt(expectedUsdcMicro);
  } catch {
    return { kind: "unverified", digest: null, reason: "malformed" };
  }
  if (expectedMicro <= 0n) {
    return { kind: "unverified", digest: null, reason: "malformed" };
  }

  // Extract the transaction arm and digest from the discriminated union.
  const arm = extractArm(result);
  if (!arm || typeof arm.digest !== "string") {
    return { kind: "unverified", digest: null, reason: "malformed" };
  }

  const returnedDigest = arm.digest;
  if (!isValidTransactionDigest(returnedDigest)) {
    return { kind: "unverified", digest: returnedDigest, reason: "malformed" };
  }

  if (returnedDigest !== expectedDigest) {
    return { kind: "unverified", digest: returnedDigest, reason: "digest" };
  }

  // Explicit chain failure: FailedTransaction arm, or Transaction arm with
  // status.success === false. Both are retryable by the caller.
  if (result.$kind === "FailedTransaction") {
    return { kind: "failed", digest: returnedDigest, error: extractErrorMessage(arm.status) };
  }
  // result.$kind === "Transaction"
  if (!arm.status || arm.status.success !== true) {
    return { kind: "failed", digest: returnedDigest, error: extractErrorMessage(arm.status) };
  }

  // Balance changes must be present and non-empty.
  const balanceChanges = arm.balanceChanges;
  if (!Array.isArray(balanceChanges) || balanceChanges.length === 0) {
    return { kind: "unverified", digest: returnedDigest, reason: "balance_changes" };
  }

  // Filter to the pinned USDC coin type. No caller-supplied coin type accepted.
  const usdcChanges = balanceChanges.filter(
    (c) => typeof c?.coinType === "string" && c.coinType === USDC_COIN_TYPE_TESTNET,
  );
  if (usdcChanges.length === 0) {
    return { kind: "unverified", digest: returnedDigest, reason: "coin_type" };
  }

  // Canonicalize the expected recipient once.
  const canonicalRecipient = normalizeSuiAddress(expectedRecipientAddress);

  // Aggregate the recipient's signed USDC balance changes.
  let recipientFound = false;
  let recipientNet = 0n;
  for (const change of usdcChanges) {
    if (typeof change?.address !== "string") {
      return { kind: "unverified", digest: returnedDigest, reason: "malformed" };
    }
    const normalizedAddress = normalizeSuiAddress(change.address);
    if (!isValidSuiAddress(normalizedAddress)) {
      return { kind: "unverified", digest: returnedDigest, reason: "malformed" };
    }
    if (typeof change.amount !== "string") {
      return { kind: "unverified", digest: returnedDigest, reason: "malformed" };
    }
    let amount: bigint;
    try {
      amount = BigInt(change.amount);
    } catch {
      return { kind: "unverified", digest: returnedDigest, reason: "malformed" };
    }
    if (normalizedAddress === canonicalRecipient) {
      recipientFound = true;
      recipientNet += amount;
    }
  }

  if (!recipientFound) {
    return { kind: "unverified", digest: returnedDigest, reason: "recipient" };
  }

  if (recipientNet !== expectedMicro) {
    return { kind: "unverified", digest: returnedDigest, reason: "amount" };
  }

  return {
    kind: "verified",
    digest: returnedDigest,
    usdcMicro: recipientNet,
    recipientAddress: canonicalRecipient,
  };
}

function extractArm(
  result: SuiClientTypes.TransactionResult<{ balanceChanges: true }>,
): TxArm | null {
  if (typeof result !== "object" || result === null) return null;
  if (result.$kind === "Transaction" && result.Transaction) {
    return result.Transaction;
  }
  if (result.$kind === "FailedTransaction" && result.FailedTransaction) {
    return result.FailedTransaction;
  }
  return null;
}

function extractErrorMessage(
  status: SuiClientTypes.ExecutionStatus | undefined,
): string | null {
  if (!status || status.success) return null;
  const error = status.error;
  if (error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return null;
}
