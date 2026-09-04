/**
 * Approval collection — pure, client-safe, deterministic validation core and
 * pinned `approval_collection::create<T>` transaction builder.
 *
 * Turns an organization's configured terms (purpose, beneficiary, amount,
 * approvers, threshold, expiry) into one strict draft, a 32-byte blake2b256
 * commitment over a canonical fixed-order encoding of those terms, and the
 * exact client-side Move call for the published four-module package.
 *
 * This module contains no React, fetch, environment access, secrets, storage,
 * signing, submission, RPC, or lifecycle state. It validates every input and
 * fails closed before constructing the transaction. Callers cannot override
 * the module, function, Clock, coin type, product cap, commitment algorithm,
 * package, or commitment schema version — those are pinned here.
 *
 * TRUTH BOUNDARY (read before integrating):
 * The built transaction is a funding request only. Submitting it does not
 * prove creation, and this module never claims created, active, released, or
 * refunded state. The Move guards (`EZeroFunding`, `EInvalidBeneficiary`,
 * `EInvalidDeadline`, `EInvalidCommitment`, `EInvalidApprovers`,
 * `EDuplicateApprover`, `EInvalidThreshold`) are mirrored here so a rejected
 * wallet request is the expected worst case, not a silent surprise. The
 * Move `create` also permits the creator to be one of the approvers and
 * requires the beneficiary to differ from the creator; both rules are
 * enforced by this builder.
 */

import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { z } from "zod";
import { MAX_USDC_MICRO, U64_MAX, USDC_COIN_TYPE_TESTNET } from "./constants";
import { PROTECTED_TRANSFER_REFERENCE } from "./protected-transfer-reference";
import { parseUsdcDecimalToMicro } from "./receipt-split";
import { blake2b256, toHex } from "../protocol/hash";

/** Schema/domain version bound into every commitment. */
export const APPROVAL_COLLECTION_SCHEMA_VERSION = "convey.approval-collection.v1";
/** Fixed Move module name. Callers cannot override this. */
export const APPROVAL_COLLECTION_MODULE = "approval_collection";
/** Fixed Move function name. Callers cannot override this. */
export const APPROVAL_COLLECTION_FUNCTION = "create";
/**
 * Standard Sui Clock object ID, sourced from the installed SDK constant.
 * Callers cannot override the Clock reference used by the transaction.
 */
export const APPROVAL_COLLECTION_CLOCK_ID = SUI_CLOCK_OBJECT_ID;
/**
 * Canonical published four-module package. Single source of truth is the
 * reference constant; this package carries the live M-of-N collection
 * evidence, so its `approval_collection` module is the only call target.
 */
export const APPROVAL_COLLECTION_PACKAGE_ID = PROTECTED_TRANSFER_REFERENCE.packageId;
/** Mirrors the Move `MAX_APPROVERS` constant. */
export const APPROVAL_COLLECTION_MAX_APPROVERS = 10;
/** Minimum collection lifetime: 1 hour after `nowMs`. Exact boundary is valid. */
export const APPROVAL_COLLECTION_MIN_MS = 60 * 60 * 1000;
/** Maximum collection lifetime: 30 days after `nowMs`. Exact boundary is valid. */
export const APPROVAL_COLLECTION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** Maximum purpose text length in Unicode code points. */
export const APPROVAL_COLLECTION_TITLE_MAX_CODE_POINTS = 120;

/**
 * Bounded expiry presets. The UI may only name a preset; the exact duration
 * is pinned here. Values mirror the protected-transfer presets so an operator
 * sees consistent hold and collection windows across the product.
 */
export const APPROVAL_COLLECTION_DEADLINE_PRESETS = [
  "tomorrow",
  "three_days",
  "seven_days",
] as const;
export type ApprovalCollectionDeadlinePreset =
  (typeof APPROVAL_COLLECTION_DEADLINE_PRESETS)[number];
export const ApprovalCollectionDeadlinePresetSchema = z.enum(
  APPROVAL_COLLECTION_DEADLINE_PRESETS,
);
/** Frozen preset → duration map. Readonly and runtime-frozen. */
export const APPROVAL_COLLECTION_DEADLINE_DURATIONS_MS: Readonly<
  Record<ApprovalCollectionDeadlinePreset, number>
> = Object.freeze({
  tomorrow: 24 * 60 * 60 * 1000,
  three_days: 72 * 60 * 60 * 1000,
  seven_days: 168 * 60 * 60 * 1000,
});

/** Raw form input. Structural bounds only; semantics live in the validator. */
export const ApprovalCollectionDraftInputSchema = z.strictObject({
  title: z.string().max(300),
  beneficiary: z.string().max(66),
  amountMajor: z.string().max(32),
  approvers: z.array(z.string().max(66)).max(24),
  threshold: z.number().int().finite().max(1000),
  deadlinePreset: ApprovalCollectionDeadlinePresetSchema,
  nowMs: z.number().int().finite(),
});
export type ApprovalCollectionDraftInput = z.infer<
  typeof ApprovalCollectionDraftInputSchema
>;

/** Normalized, validated draft. Amounts are exact integer micro strings. */
export interface ApprovalCollectionDraft {
  kind: "approval_collection_draft";
  /** Trimmed purpose text bound into the commitment. */
  title: string;
  /** Canonical beneficiary address. */
  beneficiary: string;
  /** Positive USDC micro amount as a decimal string. */
  amountMicro: string;
  /** Canonical approver addresses, input order preserved, unique. */
  approvers: string[];
  /** Required approvals, 1..approvers.length. */
  threshold: number;
  /** Expiry in milliseconds since the Unix epoch. */
  deadlineMs: number;
  deadlinePreset: ApprovalCollectionDeadlinePreset;
  /** Pinned asset; no other coin type is accepted. */
  coinType: typeof USDC_COIN_TYPE_TESTNET;
}

export type ApprovalCollectionField =
  | "title"
  | "beneficiary"
  | "amount"
  | "approvers"
  | "threshold"
  | "expiry";

export interface ApprovalCollectionFieldError {
  field: ApprovalCollectionField;
  message: string;
}

export type ApprovalCollectionValidation =
  | { ok: true; draft: ApprovalCollectionDraft }
  | { ok: false; errors: ApprovalCollectionFieldError[] };

/** Immutable metadata bound to the built transaction for later UI use. */
export interface ApprovalCollectionMetadata {
  readonly schemaVersion: string;
  /** Canonical package object ID used as the Move call target. */
  readonly packageId: string;
  readonly module: string;
  readonly function: string;
  readonly clockId: string;
  readonly coinType: string;
  readonly sender: string;
  readonly beneficiary: string;
  /** Frozen canonical approver address list. */
  readonly approvers: readonly string[];
  readonly threshold: number;
  /** Exact USDC micro amount as a decimal string. */
  readonly amountMicro: string;
  readonly deadlineMs: number;
  /** Normalized (trimmed) purpose text. */
  readonly title: string;
  /** Lowercase 0x-prefixed 32-byte commitment. */
  readonly commitmentHex: string;
  /** Frozen 32-byte commitment as a readonly number list. */
  readonly commitmentBytes: readonly number[];
  /** Canonical JSON encoding that was hashed. */
  readonly canonicalEncoding: string;
  /** Full Move target string: `${packageId}::${module}::${function}`. */
  readonly target: string;
}

export interface BuildApprovalCollectionInput {
  /** Strict validated draft produced by `validateApprovalCollectionDraft`. */
  draft: ApprovalCollectionDraft;
  /** Sender (collection funder) address. Canonicalized before use. */
  sender: string;
  /** Caller-supplied current time in milliseconds since the Unix epoch. */
  nowMs: number;
}

export interface BuildApprovalCollectionResult {
  transaction: Transaction;
  metadata: ApprovalCollectionMetadata;
}

/** Canonical Sui zero address (64 zero hex digits). */
const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);

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

/**
 * Enforce the Move `create` guards against the wallet sender: the sender
 * (creator) must be a real address and cannot be the beneficiary. The creator
 * MAY appear in the approver list; that two-person pattern is intentionally
 * allowed and is not rejected here.
 */
function assertSenderCanFundCollection(input: {
  sender: string;
  beneficiary: string;
}): void {
  if (input.sender === SUI_ZERO_ADDRESS) {
    throw new Error("Sender must not be the zero address.");
  }
  if (input.sender === input.beneficiary) {
    throw new Error(
      "Beneficiary and the funding wallet must be different addresses.",
    );
  }
}

/** Structural re-checks of an allegedly validated draft. Throws on violation. */
function assertDraftBounds(draft: ApprovalCollectionDraft): void {
  if (draft.beneficiary === SUI_ZERO_ADDRESS) {
    throw new Error("Beneficiary must not be the zero address.");
  }
  if (draft.approvers.length < 1 || draft.approvers.length > APPROVAL_COLLECTION_MAX_APPROVERS) {
    throw new Error(
      `Approvers must number between 1 and ${APPROVAL_COLLECTION_MAX_APPROVERS}.`,
    );
  }
  if (draft.threshold < 1 || draft.threshold > draft.approvers.length) {
    throw new Error("Threshold must be between 1 and the approver count.");
  }
  const micro = BigInt(draft.amountMicro);
  if (micro <= 0n) {
    throw new Error("USDC micro amount must be greater than zero.");
  }
  if (micro > U64_MAX || micro > MAX_USDC_MICRO) {
    throw new Error("USDC micro amount exceeds the product cap.");
  }
  if (draft.coinType !== USDC_COIN_TYPE_TESTNET) {
    throw new Error("Asset must be pinned testnet USDC.");
  }
  const seen = new Set<string>();
  for (const approver of draft.approvers) {
    if (approver === SUI_ZERO_ADDRESS) {
      throw new Error("Approvers must not include the zero address.");
    }
    if (approver === draft.beneficiary) {
      throw new Error("The beneficiary cannot also be an approver.");
    }
    if (seen.has(approver)) {
      throw new Error("Approver addresses must be unique.");
    }
    seen.add(approver);
  }
}

/** Validate the expiry window against the caller-supplied current time. */
function assertDeadlineWindow(nowMs: number, deadlineMs: number): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("nowMs must be a finite safe integer.");
  }
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new Error("deadlineMs must be a finite safe integer.");
  }
  const delta = deadlineMs - nowMs;
  if (delta < APPROVAL_COLLECTION_MIN_MS) {
    throw new Error("Expiry is below the 1-hour minimum.");
  }
  if (delta > APPROVAL_COLLECTION_MAX_MS) {
    throw new Error("Expiry exceeds the 30-day maximum.");
  }
}

/**
 * Validate and normalize the purpose text. Trims leading/trailing whitespace,
 * rejects empty input, rejects text over 120 Unicode code points, and rejects
 * C0/C1 control characters (newlines and tabs included). Internal whitespace
 * is preserved; no truncation or collapsing is performed.
 */
function validateTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Add a short purpose for this collection.");
  }
  const codePoints = Array.from(trimmed).length;
  if (codePoints > APPROVAL_COLLECTION_TITLE_MAX_CODE_POINTS) {
    throw new Error("Keep the purpose to 120 characters.");
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f))) {
      throw new Error("Purpose must not contain control characters.");
    }
  }
  return trimmed;
}

/**
 * Validate one approver address. Returns the canonical address or a
 * field-specific message the form can show next to the offending row.
 */
function validateApprover(raw: string, row: number): { canonical: string } | { message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { message: `Enter a complete Sui address for approver ${row}.` };
  }
  if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return { message: `Approver ${row} must be a Sui address starting with 0x.` };
  }
  try {
    const canonical = normalizeSuiAddress(trimmed);
    if (!isValidSuiAddress(canonical)) {
      return { message: `Enter a complete Sui address for approver ${row}.` };
    }
    if (canonical === SUI_ZERO_ADDRESS) {
      return { message: `Approver ${row} cannot be the zero address.` };
    }
    return { canonical };
  } catch {
    return { message: `Enter a complete Sui address for approver ${row}.` };
  }
}

/**
 * Single authoritative validator for the approval-collection creation form.
 * Runs every rule the Move `create` guard set enforces (plus the bounded
 * product window) and returns either a normalized draft or field-level
 * errors. Pure: no React, fetch, env, secret, RPC, signing, or submission.
 */
export function validateApprovalCollectionDraft(
  input: ApprovalCollectionDraftInput,
): ApprovalCollectionValidation {
  const parsed = ApprovalCollectionDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [{ field: "title", message: "Check the collection details and try again." }],
    };
  }
  const raw = parsed.data;
  const errors: ApprovalCollectionFieldError[] = [];
  const push = (field: ApprovalCollectionField, message: string) =>
    errors.push({ field, message });

  let title: string | null = null;
  try {
    title = validateTitle(raw.title);
  } catch (error) {
    push("title", error instanceof Error ? error.message : "Check the purpose.");
  }

  let beneficiary: string | null = null;
  const rawBeneficiary = raw.beneficiary.trim();
  if (rawBeneficiary.length === 0) {
    push("beneficiary", "Enter the beneficiary's Sui address.");
  } else if (!/^0x[0-9a-fA-F]+$/.test(rawBeneficiary)) {
    push("beneficiary", "The beneficiary address must start with 0x.");
  } else {
    try {
      const canonical = normalizeSuiAddress(rawBeneficiary);
      if (!isValidSuiAddress(canonical)) {
        push("beneficiary", "Enter a complete Sui address starting with 0x.");
      } else if (canonical === SUI_ZERO_ADDRESS) {
        push("beneficiary", "The beneficiary cannot be the zero address.");
      } else {
        beneficiary = canonical;
      }
    } catch {
      push("beneficiary", "Enter a complete Sui address starting with 0x.");
    }
  }

  let amountMicro: string | null = null;
  const parsedAmount = parseUsdcDecimalToMicro(raw.amountMajor);
  if (!parsedAmount.ok) {
    push(
      "amount",
      parsedAmount.error === "too_many_decimals"
        ? "USDC supports up to 6 decimal places."
        : "Enter a USDC amount like 12 or 12.50.",
    );
  } else {
    const micro = BigInt(parsedAmount.micro);
    if (micro <= 0n) {
      push("amount", "Enter an amount above zero.");
    } else if (micro > U64_MAX || micro > MAX_USDC_MICRO) {
      push("amount", "Amount exceeds the USDC limit for a collection.");
    } else {
      amountMicro = parsedAmount.micro;
    }
  }

  let approvers: string[] | null = null;
  const trimmedApprovers = raw.approvers.map((value) => value.trim());
  if (trimmedApprovers.length < 1) {
    push("approvers", "Add at least one approver.");
  } else if (trimmedApprovers.length > APPROVAL_COLLECTION_MAX_APPROVERS) {
    push("approvers", `Collect at most ${APPROVAL_COLLECTION_MAX_APPROVERS} approvers.`);
  } else {
    const canonicalApprovers: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < trimmedApprovers.length; index += 1) {
      const result = validateApprover(trimmedApprovers[index]!, index + 1);
      if ("message" in result) {
        push("approvers", result.message);
        break;
      }
      if (seen.has(result.canonical)) {
        push("approvers", "Each approver address must be unique.");
        break;
      }
      if (beneficiary !== null && result.canonical === beneficiary) {
        push("approvers", "The beneficiary cannot also be an approver.");
        break;
      }
      seen.add(result.canonical);
      canonicalApprovers.push(result.canonical);
    }
    if (canonicalApprovers.length === trimmedApprovers.length) {
      approvers = canonicalApprovers;
    }
  }

  let thresholdOk = true;
  if (!Number.isSafeInteger(raw.threshold) || raw.threshold < 1) {
    push("threshold", "Approvals required must be at least 1.");
    thresholdOk = false;
  }

  if (thresholdOk && approvers !== null && raw.threshold > approvers.length) {
    push(
      "threshold",
      `Approvals required cannot exceed the ${approvers.length} approver${approvers.length === 1 ? "" : "s"}.`,
    );
  }

  const durationMs = APPROVAL_COLLECTION_DEADLINE_DURATIONS_MS[raw.deadlinePreset];
  const deadlineMs = raw.nowMs + durationMs;
  try {
    assertDeadlineWindow(raw.nowMs, deadlineMs);
  } catch (error) {
    push("expiry", error instanceof Error ? error.message : "Choose a valid expiry.");
  }

  if (
    errors.length > 0 ||
    title === null ||
    beneficiary === null ||
    amountMicro === null ||
    approvers === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    draft: {
      kind: "approval_collection_draft",
      title,
      beneficiary,
      amountMicro,
      approvers,
      threshold: raw.threshold,
      deadlineMs,
      deadlinePreset: raw.deadlinePreset,
      coinType: USDC_COIN_TYPE_TESTNET,
    },
  };
}

/**
 * Canonical fixed-order encoding of every bound term. The optional-free key
 * order is stable; equivalent textual address forms produce an identical
 * encoding because addresses are canonicalized before hashing.
 */
function canonicalDraftEncoding(
  draft: ApprovalCollectionDraft,
  canonicalSender: string,
  canonicalPackage: string,
) {
  return {
    schemaVersion: APPROVAL_COLLECTION_SCHEMA_VERSION,
    package: canonicalPackage,
    module: APPROVAL_COLLECTION_MODULE,
    function: APPROVAL_COLLECTION_FUNCTION,
    clockId: APPROVAL_COLLECTION_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: draft.beneficiary,
    approvers: [...draft.approvers],
    threshold: draft.threshold,
    amountMicro: draft.amountMicro,
    deadlineMs: draft.deadlineMs,
    title: draft.title,
  };
}

/**
 * Build one approval-collection funding transaction and its immutable
 * commitment metadata.
 *
 * Re-validates the draft's structural bounds and the sender's role rules
 * before any bytes exist, derives the 32-byte blake2b256 commitment, and
 * constructs the pinned single Move call. The PTB sources the exact USDC
 * micro amount with the shared `Transaction.coin` intent, so the payer's
 * existing USDC coins fund the collection and the native-SUI gas coin is
 * never touched.
 *
 * This does not submit, settle, release, or refund anything. A built
 * transaction is a wallet funding request, not a created collection.
 */
export function buildApprovalCollection(
  input: BuildApprovalCollectionInput,
): BuildApprovalCollectionResult {
  if (!input || typeof input !== "object" || !input.draft || input.draft.kind !== "approval_collection_draft") {
    throw new Error("Approval collection draft is required.");
  }

  const draft = input.draft;
  assertDraftBounds(draft);
  assertDeadlineWindow(input.nowMs, draft.deadlineMs);

  const canonicalSender = canonicalizeAddress(input.sender, "sender");
  assertSenderCanFundCollection({
    sender: canonicalSender,
    beneficiary: draft.beneficiary,
  });
  const canonicalPackage = canonicalizeAddress(
    APPROVAL_COLLECTION_PACKAGE_ID,
    "packageId",
  );

  const encoding = canonicalDraftEncoding(draft, canonicalSender, canonicalPackage);
  const canonicalJson = JSON.stringify(encoding);
  const digest = blake2b256(new TextEncoder().encode(canonicalJson));
  const commitmentHex = toHex(digest);
  // Receipt-facing frozen readonly list — no live mutable Uint8Array escapes.
  const commitmentBytes: readonly number[] = Object.freeze(Array.from(digest));
  // The Transaction receives its own independent Uint8Array copy.
  const txCommitmentBytes = new Uint8Array(digest);

  const target = `${canonicalPackage}::${APPROVAL_COLLECTION_MODULE}::${APPROVAL_COLLECTION_FUNCTION}`;

  const transaction = new Transaction();
  transaction.setSender(canonicalSender);
  const coin = transaction.coin({
    type: USDC_COIN_TYPE_TESTNET,
    balance: BigInt(draft.amountMicro),
  });
  // Single Move call. Arguments follow the Move signature order exactly:
  //   create<T>(Coin<T>, beneficiary, vector<address>, u64, vector<u8>, u64, &Clock)
  // The &mut TxContext argument is appended by the SDK automatically.
  transaction.moveCall({
    target,
    typeArguments: [USDC_COIN_TYPE_TESTNET],
    arguments: [
      coin,
      transaction.pure.address(draft.beneficiary),
      transaction.pure.vector("address", [...draft.approvers]),
      transaction.pure.u64(draft.threshold),
      transaction.pure.vector("u8", txCommitmentBytes),
      transaction.pure.u64(draft.deadlineMs),
      transaction.object.clock(),
    ],
  });

  const metadata: ApprovalCollectionMetadata = {
    schemaVersion: APPROVAL_COLLECTION_SCHEMA_VERSION,
    packageId: canonicalPackage,
    module: APPROVAL_COLLECTION_MODULE,
    function: APPROVAL_COLLECTION_FUNCTION,
    clockId: APPROVAL_COLLECTION_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: draft.beneficiary,
    approvers: Object.freeze([...draft.approvers]),
    threshold: draft.threshold,
    amountMicro: draft.amountMicro,
    deadlineMs: draft.deadlineMs,
    title: draft.title,
    commitmentHex,
    commitmentBytes,
    canonicalEncoding: canonicalJson,
    target,
  };
  Object.freeze(metadata);

  return { transaction, metadata };
}
