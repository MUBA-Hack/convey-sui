/**
 * Protected Transfer — pure, client-safe, deterministic transaction core.
 *
 * Builds exactly one `protected_transfer::create_escrow<T>` Move call that locks
 * pinned testnet USDC into an escrow controlled by a reviewer and released to a
 * beneficiary. The escrow is bound to a 32-byte blake2b256 commitment over a
 * canonical fixed-order JSON encoding of every bound term.
 *
 * This module contains no React, fetch, environment access, secrets, HMAC,
 * storage, signing, submission, RPC, or fake lifecycle state. It validates every
 * input and fails closed before constructing the transaction. Callers cannot
 * override the module, function, Clock, coin type, product cap, commitment
 * algorithm, or commitment schema version — those are pinned here.
 *
 * PROVENANCE BOUNDARY (read before integrating):
 * This pure builder validates the STRUCTURE of a Protected Transfer execution
 * plan and the PINNED client constants (module/function/Clock/coin/cap/hash/
 * version). It CANNOT prove the plan's PROVENANCE. The plan is the future
 * server-verified unit: product code must only call `buildProtectedTransfer`
 * with a plan returned by the protected authorization API, never with a plan
 * assembled from loose caller inputs. This builder must never be exposed as a
 * loose local feature toggle, and the plan must never be described as signed,
 * attested, verified, safe, deployed, or immutable on the strength of this
 * module alone — those are evidence claims owned by later layers.
 */

import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { z } from "zod";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET, U64_MAX } from "./constants";
import {
  CanonicalAuthorizationSchema,
  type CanonicalAuthorization,
} from "./quote-schema";
import { blake2b256, toHex } from "../protocol/hash";

/** Schema/domain version bound into every commitment. */
export const PROTECTED_TRANSFER_SCHEMA_VERSION = "convey.protected-transfer.v1";
/** Fixed Move module name. Callers cannot override this. */
export const PROTECTED_TRANSFER_MODULE = "protected_transfer";
/** Fixed Move function name. Callers cannot override this. */
export const PROTECTED_TRANSFER_FUNCTION = "create_escrow";
/**
 * Standard Sui Clock object ID, sourced from the installed SDK constant.
 * Callers cannot override the Clock reference used by the transaction.
 */
export const PROTECTED_TRANSFER_CLOCK_ID = SUI_CLOCK_OBJECT_ID;
/** Maximum review-note length in Unicode code points. */
export const PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS = 120;
/** Minimum escrow lifetime: 1 hour after `nowMs`. Exact boundary is valid. */
export const PROTECTED_TRANSFER_DEADLINE_MIN_MS = 60 * 60 * 1000;
/** Maximum escrow lifetime: 30 days after `nowMs`. Exact boundary is valid. */
export const PROTECTED_TRANSFER_DEADLINE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** Sui address/object ID: 0x + up to 64 hex, used for plan address fields. */
const PlanSuiAddressString = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/)
  .max(66);

/**
 * Atomic Protected Transfer execution plan — the single strict unit that binds a
 * verified direct authorization together with the protection terms (package,
 * reviewer, deadline, review note) it is executed against. The plan is the
 * future server-verified unit; this builder validates its structure and pinned
 * client constants only — see the PROVENANCE BOUNDARY at the top of this file.
 */
export interface ProtectedTransferExecutionPlan {
  kind: "protected_transfer_execution_plan";
  authorization: CanonicalAuthorization;
  /** Object ID of the published package exposing `protected_transfer`. */
  packageId: string;
  /** Canonical reviewer/arbiter address for the escrow. */
  reviewerAddress: string;
  /** Escrow deadline in milliseconds since the Unix epoch. */
  deadlineMs: number;
  /** Free-form review note. Trimmed; control characters rejected. */
  reviewNote: string;
}

/**
 * Strict runtime schema for the execution plan. Rejects missing and extra fields
 * recursively and reuses `CanonicalAuthorizationSchema` for the authorization
 * sub-object. This is the fail-closed structural boundary; semantic validation
 * (address canonicalization, deadline window, review-note characters) runs
 * afterwards against the parsed plan.
 */
export const ProtectedTransferExecutionPlanSchema = z.strictObject({
  kind: z.literal("protected_transfer_execution_plan"),
  authorization: CanonicalAuthorizationSchema,
  packageId: PlanSuiAddressString,
  reviewerAddress: PlanSuiAddressString,
  deadlineMs: z.number().int().finite().safe(),
  // Structural bound only; semantic trim/empty/control-char validation stays
  // in `validateReviewNote` so the fail-closed empty boundary is preserved.
  // A missing property is still rejected by `strictObject`.
  reviewNote: z.string().max(500),
});

/** Public input. The surface is intentionally narrow: the caller supplies one
 * atomic plan, the sender, and the current time. No module/function/clock/
 * coin-type/cap/algorithm/version overrides are possible, and package/reviewer/
 * deadline/note may appear only inside the parsed plan. */
export interface BuildProtectedTransferInput {
  /** Strict atomic execution plan (the future server-verified unit). */
  plan: ProtectedTransferExecutionPlan;
  /** Sender (escrow funder) address. Canonicalized before use. */
  sender: string;
  /** Caller-supplied current time in milliseconds since the Unix epoch. */
  nowMs: number;
}

/** Immutable metadata bound to the built transaction for later UI/receipt use.
 *
 * The object itself is frozen with `Object.freeze` before return, and
 * `commitmentBytes` is a frozen `readonly number[]` snapshot of the digest —
 * receipt-facing code never receives a live mutable `Uint8Array`. The
 * `Transaction` receives its own separate `Uint8Array` copy and is not frozen. */
export interface ProtectedTransferMetadata {
  readonly schemaVersion: string;
  /** Canonical package object ID used as the Move call target. */
  readonly packageId: string;
  readonly module: string;
  readonly function: string;
  readonly clockId: string;
  readonly coinType: string;
  readonly sender: string;
  readonly beneficiary: string;
  readonly reviewer: string;
  /** Authorized USDC micro amount, as a decimal string. */
  readonly amountMicro: string;
  readonly deadlineMs: number;
  /** Normalized (trimmed) review note. */
  readonly reviewNote: string;
  /** Lowercase 0x-prefixed 32-byte commitment. */
  readonly commitmentHex: string;
  /** Frozen 32-byte commitment as a readonly number list. */
  readonly commitmentBytes: readonly number[];
  /** Canonical JSON encoding that was hashed. */
  readonly canonicalEncoding: string;
  /** Full Move target string: `${packageId}::${module}::${function}`. */
  readonly target: string;
}

export interface BuildProtectedTransferResult {
  transaction: Transaction;
  metadata: ProtectedTransferMetadata;
}

/** Canonicalize and validate a Sui address/object ID. Throws on invalid input. */
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

/** Validate the USDC micro amount and return it as a bounded bigint.
 * The `UsdcMicroString` schema already guarantees a non-empty decimal digit
 * string, so a direct `BigInt` parse is sufficient. The positive, u64, and
 * product-cap bounds remain enforced here. */
function validateAmountMicro(usdcMicro: string): bigint {
  const micro = BigInt(usdcMicro);
  if (micro <= 0n) {
    throw new Error("USDC micro amount must be greater than zero.");
  }
  if (micro > U64_MAX) {
    throw new Error("USDC micro amount exceeds u64.");
  }
  if (micro > MAX_USDC_MICRO) {
    throw new Error("USDC micro amount exceeds the product cap.");
  }
  return micro;
}

/** Validate `nowMs`/`deadlineMs` and the deadline window. Exact bounds are valid. */
function validateDeadline(nowMs: number, deadlineMs: number): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("nowMs must be a finite safe integer.");
  }
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new Error("deadlineMs must be a finite safe integer.");
  }
  const delta = deadlineMs - nowMs;
  if (delta < PROTECTED_TRANSFER_DEADLINE_MIN_MS) {
    throw new Error("Deadline is below the 1-hour minimum.");
  }
  if (delta > PROTECTED_TRANSFER_DEADLINE_MAX_MS) {
    throw new Error("Deadline exceeds the 30-day maximum.");
  }
}

/**
 * Enforce authorization freshness against the caller-supplied current time.
 * Rejects a future-issued authorization (`issuedAt > nowMs`) and an expired
 * authorization (`expiresAt <= nowMs`). The exact `issuedAt === nowMs`
 * boundary is accepted; the exact `expiresAt === nowMs` boundary is expired
 * and rejected. `issuedAt`/`expiresAt` are safe integers by the strict
 * authorization schema; `nowMs` is checked by `validateDeadline`.
 *
 * This is a structural freshness check only. The caller's `nowMs` does not
 * prove server provenance; the PROVENANCE BOUNDARY at the top of this file
 * remains authoritative.
 */
function validateAuthorizationFreshness(
  issuedAt: number,
  expiresAt: number,
  nowMs: number,
): void {
  if (issuedAt > nowMs) {
    throw new Error("Authorization issuedAt is in the future.");
  }
  if (expiresAt <= nowMs) {
    throw new Error("Authorization has expired.");
  }
}

/**
 * Validate and normalize the review note. Trims leading/trailing whitespace,
 * rejects empty input, rejects notes over 120 Unicode code points, and rejects
 * C0/C1 control characters (newlines and tabs included). Internal whitespace is
 * preserved — no truncation or collapsing is performed.
 */
function validateReviewNote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Review note must not be empty.");
  }
  const codePoints = Array.from(trimmed).length;
  if (codePoints > PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS) {
    throw new Error("Review note exceeds 120 Unicode code points.");
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      throw new Error("Review note contains an invalid character.");
    }
    // C0 (0x00-0x1F), DEL (0x7F), and C1 (0x80-0x9F) control characters.
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
      throw new Error("Review note must not contain control characters.");
    }
  }
  return trimmed;
}

/**
 * Canonical fixed-order encoding of the strict authorization. Every field is
 * listed explicitly with a stable property order; nullable fields use JSON
 * `null` unambiguously. The beneficiary (canonicalized recipient) is bound here
 * so equivalent textual address forms produce an identical commitment.
 */
function canonicalAuthorizationEncoding(
  auth: CanonicalAuthorization,
  canonicalBeneficiary: string,
) {
  return {
    kind: auth.kind,
    recipientAddress: canonicalBeneficiary,
    usdcMicro: auth.usdcMicro,
    coinType: auth.coinType,
    beneficiaryRef: auth.beneficiaryRef,
    issuedAt: auth.issuedAt,
    expiresAt: auth.expiresAt,
    corridor: {
      source: auth.corridor.source,
      destination: auth.corridor.destination,
    },
    youPayMinor: auth.youPayMinor,
    familyReceivesMinor: auth.familyReceivesMinor,
    totalFeeMinor: auth.totalFeeMinor,
    myrPerUsdc: auth.myrPerUsdc,
    phpPerUsdc: auth.phpPerUsdc,
    fixedFeeMyr: auth.fixedFeeMyr,
    feeBps: auth.feeBps,
    recipient: auth.recipient,
    destinationCity: auth.destinationCity,
    purpose: auth.purpose,
    maximumFamilyLimitMinor: auth.maximumFamilyLimitMinor,
  };
}

/**
 * Build one Protected Transfer transaction and its immutable commitment metadata.
 *
 * Parses the complete execution plan through the strict schema FIRST, then
 * canonicalizes and validates every bound term. Package, reviewer, deadline, and
 * review note may appear only inside that parsed plan. The commitment is a
 * 32-byte blake2b256 digest over the UTF-8 bytes of a canonical fixed-order JSON
 * encoding that binds the schema version, fixed module/function/Clock, pinned
 * coin type, canonical addresses, deadline, normalized review note, and every
 * strict authorization field.
 *
 * This does not deploy, settle, release, or pay out anything. A built
 * transaction is not settlement, and the plan is not signed, attested, verified,
 * safe, deployed, or immutable on the strength of this builder alone.
 */
export function buildProtectedTransfer(
  input: BuildProtectedTransferInput,
): BuildProtectedTransferResult {
  if (!input || typeof input !== "object") {
    throw new Error("Protected Transfer input is required.");
  }

  // Strict runtime schema: parse the complete plan first. Rejects malformed
  // input, missing fields, extra fields, and a wrong kind through the schema
  // rather than leaking a TypeError deeper in the builder. The nested
  // `z.literal` schemas fix `plan.kind` and `auth.kind`, so no redundant kind
  // re-check is needed here.
  let plan: ProtectedTransferExecutionPlan;
  try {
    plan = ProtectedTransferExecutionPlanSchema.parse(input.plan);
  } catch {
    throw new Error("Protected Transfer plan failed the strict execution-plan schema.");
  }

  const auth = plan.authorization;
  if (auth.coinType !== USDC_COIN_TYPE_TESTNET) {
    throw new Error("Authorization coin type must be pinned testnet USDC.");
  }

  const canonicalSender = canonicalizeAddress(input.sender, "sender");
  const canonicalBeneficiary = canonicalizeAddress(
    auth.recipientAddress,
    "beneficiary",
  );
  const canonicalPackage = canonicalizeAddress(plan.packageId, "packageId");
  const canonicalReviewer = canonicalizeAddress(plan.reviewerAddress, "reviewerAddress");

  const micro = validateAmountMicro(auth.usdcMicro);
  validateDeadline(input.nowMs, plan.deadlineMs);
  validateAuthorizationFreshness(auth.issuedAt, auth.expiresAt, input.nowMs);
  const normalizedNote = validateReviewNote(plan.reviewNote);

  // Canonical fixed-order JSON encoding. No object spread; every key explicit.
  const encoding = {
    schemaVersion: PROTECTED_TRANSFER_SCHEMA_VERSION,
    package: canonicalPackage,
    module: PROTECTED_TRANSFER_MODULE,
    function: PROTECTED_TRANSFER_FUNCTION,
    clockId: PROTECTED_TRANSFER_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: canonicalBeneficiary,
    reviewer: canonicalReviewer,
    deadlineMs: plan.deadlineMs,
    reviewNote: normalizedNote,
    authorization: canonicalAuthorizationEncoding(auth, canonicalBeneficiary),
  };
  const canonicalJson = JSON.stringify(encoding);
  const digest = blake2b256(new TextEncoder().encode(canonicalJson));
  const commitmentHex = toHex(digest);
  // Receipt-facing frozen readonly list — no live mutable Uint8Array escapes.
  const commitmentBytes: readonly number[] = Object.freeze(Array.from(digest));
  // The Transaction receives its own independent Uint8Array copy.
  const txCommitmentBytes = new Uint8Array(digest);

  const target = `${canonicalPackage}::${PROTECTED_TRANSFER_MODULE}::${PROTECTED_TRANSFER_FUNCTION}`;

  const transaction = new Transaction();
  transaction.setSender(canonicalSender);
  // Pinned testnet USDC coin with the exact authorized balance.
  const coin = transaction.coin({
    type: USDC_COIN_TYPE_TESTNET,
    balance: micro,
  });
  // Single Move call. Arguments follow the Move signature order exactly:
  //   create_escrow<T>(Coin<T>, beneficiary, reviewer, vector<u8>, deadlineMs, &Clock)
  transaction.moveCall({
    target,
    typeArguments: [USDC_COIN_TYPE_TESTNET],
    arguments: [
      coin,
      transaction.pure.address(canonicalBeneficiary),
      transaction.pure.address(canonicalReviewer),
      transaction.pure.vector("u8", txCommitmentBytes),
      transaction.pure.u64(plan.deadlineMs),
      transaction.object.clock(),
    ],
  });

  const metadata: ProtectedTransferMetadata = {
    schemaVersion: PROTECTED_TRANSFER_SCHEMA_VERSION,
    packageId: canonicalPackage,
    module: PROTECTED_TRANSFER_MODULE,
    function: PROTECTED_TRANSFER_FUNCTION,
    clockId: PROTECTED_TRANSFER_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: canonicalBeneficiary,
    reviewer: canonicalReviewer,
    amountMicro: auth.usdcMicro,
    deadlineMs: plan.deadlineMs,
    reviewNote: normalizedNote,
    commitmentHex,
    commitmentBytes,
    canonicalEncoding: canonicalJson,
    target,
  };
  Object.freeze(metadata);

  return { transaction, metadata };
}
