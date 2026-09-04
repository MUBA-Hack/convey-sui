/**
 * Recurring spending cap — strict draft validation and creation builder for the
 * published `protected_transfer::recurring_cap` module.
 *
 * Pure, client-safe, deterministic. No secrets, no env access, no React, no
 * fetch, no RPC, no signing, no submission, no lifecycle claims. Two
 * responsibilities:
 *
 *  1. `validateRecurringCapDraft` — mirror the Move `create` invariants on a
 *     raw form draft and return per-field errors. Any error blocks preparation.
 *  2. `buildRecurringCapCreation` — fail-closed construction of the exact
 *     `recurring_cap::create` transaction plus a 32-byte blake2b256 intent
 *     commitment over a canonical fixed-order encoding of every bound term.
 *
 * Trust boundary: a validated draft is NOT a mandate. Nothing is active,
 * funded, or on chain until the connected wallet signs and submits the exact
 * transaction, and this module never observes that result. The Move call order
 * mirrors `create<T>(coin, beneficiary, per_payment_cap, total_cap,
 * interval_ms, expiry, intent_commitment, &Clock)` exactly.
 *
 * The funded coin is pinned testnet USDC sourced from the payer's existing
 * coins via the SDK coin intent, never the native-SUI gas coin, matching the
 * product's other agreement surfaces. The package object ID is a configured
 * candidate coordinate supplied by the caller (an operator-controlled public
 * value); this module never invents one and cannot prove deployment, package
 * immutability, or later on-chain state.
 *
 * Local validation mirrors the contract but is not the contract: the shared
 * Sui object enforces the same caps on chain. The two stay distinct by design.
 */

import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { MAX_USDC_MICRO, U64_MAX, USDC_COIN_TYPE_TESTNET } from "./constants";
import { blake2b256, toHex } from "../protocol/hash";

/** Schema/domain version bound into every intent commitment. */
export const RECURRING_CAP_SCHEMA_VERSION = "convey.recurring-cap.v1";
/** Fixed Move module name. Callers cannot override this. */
export const RECURRING_CAP_MODULE = "recurring_cap";
/** Fixed Move function name. Callers cannot override this. */
export const RECURRING_CAP_FUNCTION = "create";
/**
 * Standard Sui Clock object ID from the installed SDK constant. The Move call
 * reads `clock.timestamp_ms()`; callers cannot override the Clock reference.
 */
export const RECURRING_CAP_CLOCK_ID = SUI_CLOCK_OBJECT_ID;
/** The Move contract requires a 32-byte intent commitment. */
export const RECURRING_CAP_COMMITMENT_BYTES = 32;
/** Maximum purpose text in Unicode code points. */
export const RECURRING_CAP_PURPOSE_MAX_CODE_POINTS = 120;
/** Minimum interval in whole days. The Move contract requires interval > 0. */
export const RECURRING_CAP_MIN_INTERVAL_DAYS = 1;
/** Product bound on the interval in whole days. */
export const RECURRING_CAP_MAX_INTERVAL_DAYS = 365;
/** Product bound on the mandate lifetime. The Move contract only requires a future expiry. */
export const RECURRING_CAP_MAX_LIFETIME_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/** Canonical Sui zero address (64 zero hex digits). */
const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);

/**
 * Parse a decimal USDC amount into an exact micro-unit integer string using
 * BigInt math only. Accepts at most 6 fractional digits; rejects zero,
 * negatives, exponent forms, separators, and oversize values. Returns `null`
 * instead of throwing on any malformed input.
 */
export function parseUsdcDecimalToMicro(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,13}(\.\d{1,6})?$/.test(trimmed)) return null;
  const dot = trimmed.indexOf(".");
  const whole = dot === -1 ? trimmed : trimmed.slice(0, dot);
  const frac = dot === -1 ? "" : trimmed.slice(dot + 1);
  const micro = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  if (micro <= 0n) return null;
  if (micro > U64_MAX) return null;
  return micro.toString();
}

/**
 * Parse a `YYYY-MM-DD` date into the end of that day in UTC milliseconds, so
 * an expiry chosen "for the 30th" stays collectable through the whole chosen
 * day. Returns `null` for any malformed or impossible calendar date.
 */
export function parseExpiryDateToMs(value: string): number | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const trimmed = value.trim();
  const ms = Date.parse(`${trimmed}T23:59:59.999Z`);
  if (Number.isNaN(ms) || !Number.isSafeInteger(ms)) return null;
  // Date.parse silently rolls impossible calendar dates forward (2026-02-30
  // becomes March 2); the round-trip rejects them so an expiry never lands on
  // a day the customer did not choose.
  if (new Date(ms).toISOString().slice(0, 10) !== trimmed) return null;
  return ms;
}

/** Raw recurring-cap draft exactly as the form holds it. All fields are strings. */
export interface RecurringCapDraftInput {
  beneficiaryAddress: string;
  purpose: string;
  fundedUsdc: string;
  perPaymentUsdc: string;
  totalCapUsdc: string;
  intervalDays: string;
  expiryDate: string;
}

/** Normalized draft after strict validation. Money is canonical micro strings. */
export interface RecurringCapDraft {
  beneficiaryAddress: string;
  purpose: string;
  fundedMicro: string;
  perPaymentCapMicro: string;
  totalCapMicro: string;
  intervalDays: number;
  intervalMs: number;
  expiryDate: string;
  expiryMs: number;
}

export type RecurringCapDraftField =
  | "beneficiaryAddress"
  | "purpose"
  | "funded"
  | "perPayment"
  | "totalCap"
  | "interval"
  | "expiry";

export type RecurringCapDraftValidation =
  | { ok: true; draft: RecurringCapDraft }
  | { ok: false; fieldErrors: Partial<Record<RecurringCapDraftField, string>> };

function beneficiaryError(
  value: string,
  ownerAddress: string | null | undefined,
): string | null {
  if (value.trim().length === 0) return "Enter the beneficiary Sui address.";
  let canonical: string;
  try {
    canonical = normalizeSuiAddress(value.trim());
  } catch {
    return "Enter a valid Sui address.";
  }
  if (!isValidSuiAddress(canonical) || canonical !== value.trim()) {
    return "Enter a valid Sui address.";
  }
  if (canonical === SUI_ZERO_ADDRESS) {
    return "The beneficiary cannot be the zero address.";
  }
  // Mirrors the Move EInvalidBeneficiary guard: beneficiary != owner. The
  // owner is only known once a wallet is connected, so the check is skipped
  // (never loosened) while drafting without a wallet.
  if (ownerAddress && canonical === ownerAddress) {
    return "The beneficiary must be different from you.";
  }
  return null;
}

function purposeError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Describe what this mandate pays for.";
  if (Array.from(trimmed).length > RECURRING_CAP_PURPOSE_MAX_CODE_POINTS) {
    return "Keep the purpose to 120 characters or fewer.";
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f))) {
      return "Remove control characters from the purpose.";
    }
  }
  return null;
}

/**
 * Validate a raw draft against the Move `create` invariants. Pure, bounded,
 * never throws, and collects one error per field so the form can show every
 * problem at once. `ownerAddress` enables the beneficiary != owner guard when
 * the wallet is connected; it is optional so drafting works without a wallet.
 */
export function validateRecurringCapDraft(
  input: unknown,
  context: { nowMs: number; ownerAddress?: string | null },
): RecurringCapDraftValidation {
  const fieldErrors: Partial<Record<RecurringCapDraftField, string>> = {};
  const isShape =
    typeof input === "object" &&
    input !== null &&
    [
      "beneficiaryAddress",
      "purpose",
      "fundedUsdc",
      "perPaymentUsdc",
      "totalCapUsdc",
      "intervalDays",
      "expiryDate",
    ].every((key) => typeof (input as Record<string, unknown>)[key] === "string");
  if (!isShape || !Number.isSafeInteger(context?.nowMs) || context.nowMs < 0) {
    // Fail closed: a malformed draft can never validate.
    return {
      ok: false,
      fieldErrors: {
        beneficiaryAddress: "Enter a valid Sui address.",
        purpose: "Describe what this mandate pays for.",
        funded: "Enter a funded amount above zero.",
        perPayment: "Enter a per-collection maximum above zero.",
        totalCap: "Enter a lifetime cap at or above the per-collection maximum.",
        interval: "Set a minimum interval between 1 and 365 days.",
        expiry: "Choose an expiry date in the future.",
      },
    };
  }
  const raw = input as RecurringCapDraftInput;

  // Move: funded_amount > 0 (EZeroFunding), pinned to the client product cap.
  const fundedMicro = parseUsdcDecimalToMicro(raw.fundedUsdc);
  if (fundedMicro === null) {
    fieldErrors.funded = "Enter a funded amount above zero.";
  } else if (BigInt(fundedMicro) > MAX_USDC_MICRO) {
    fieldErrors.funded = "Funded amount exceeds the 2,000 USDC product limit.";
  }

  // Move: beneficiary != @0x0 && beneficiary != owner (EInvalidBeneficiary).
  const beneficiaryProblem = beneficiaryError(raw.beneficiaryAddress, context.ownerAddress);
  if (beneficiaryProblem) fieldErrors.beneficiaryAddress = beneficiaryProblem;

  // Move: per_payment_cap > 0 (EInvalidPerPaymentCap).
  const perPaymentMicro = parseUsdcDecimalToMicro(raw.perPaymentUsdc);
  if (perPaymentMicro === null) {
    fieldErrors.perPayment = "Enter a per-collection maximum above zero.";
  }

  // Move: total_cap >= per_payment_cap && total_cap <= funded_amount
  // (EInvalidTotalCap). Cross-field checks run only when both sides parsed.
  const totalCapMicro = parseUsdcDecimalToMicro(raw.totalCapUsdc);
  if (totalCapMicro === null) {
    fieldErrors.totalCap = "Enter a lifetime cap at or above the per-collection maximum.";
  } else if (perPaymentMicro !== null && BigInt(totalCapMicro) < BigInt(perPaymentMicro)) {
    fieldErrors.totalCap = "The lifetime cap cannot be below the per-collection maximum.";
  } else if (fundedMicro !== null && BigInt(totalCapMicro) > BigInt(fundedMicro)) {
    fieldErrors.totalCap = "The lifetime cap cannot exceed the funded amount.";
  }

  // Move: interval_ms > 0 (EInvalidInterval), bounded to whole days 1..365.
  const intervalDays = /^\d{1,3}$/.test(raw.intervalDays.trim())
    ? Number.parseInt(raw.intervalDays.trim(), 10)
    : Number.NaN;
  if (
    !Number.isSafeInteger(intervalDays) ||
    intervalDays < RECURRING_CAP_MIN_INTERVAL_DAYS ||
    intervalDays > RECURRING_CAP_MAX_INTERVAL_DAYS
  ) {
    fieldErrors.interval = "Set a minimum interval between 1 and 365 days.";
  }

  // Move: expiry > now (EInvalidExpiry), bounded to a 365-day lifetime.
  const expiryMs = parseExpiryDateToMs(raw.expiryDate);
  if (expiryMs === null) {
    fieldErrors.expiry = "Choose an expiry date in the future.";
  } else if (expiryMs <= context.nowMs) {
    fieldErrors.expiry = "Choose an expiry date in the future.";
  } else if (expiryMs - context.nowMs > RECURRING_CAP_MAX_LIFETIME_DAYS * MS_PER_DAY) {
    fieldErrors.expiry = "Expiry cannot be more than 365 days out.";
  }

  const purposeProblem = purposeError(raw.purpose);
  if (purposeProblem) fieldErrors.purpose = purposeProblem;

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  // Type narrowing only: the checks above already rejected every null case.
  if (
    fundedMicro === null ||
    perPaymentMicro === null ||
    totalCapMicro === null ||
    expiryMs === null ||
    !Number.isSafeInteger(intervalDays)
  ) {
    return { ok: false, fieldErrors: { funded: "Enter a funded amount above zero." } };
  }

  return {
    ok: true,
    draft: {
      beneficiaryAddress: normalizeSuiAddress(raw.beneficiaryAddress.trim()),
      purpose: raw.purpose.trim(),
      fundedMicro,
      perPaymentCapMicro: perPaymentMicro,
      totalCapMicro: totalCapMicro,
      intervalDays: intervalDays,
      intervalMs: intervalDays * MS_PER_DAY,
      expiryDate: raw.expiryDate.trim(),
      expiryMs,
    },
  };
}

export interface BuildRecurringCapInput {
  /**
   * Configured candidate package object ID that would expose
   * `recurring_cap`. Deployment is never proven here; the caller resolves it
   * from operator configuration and must fail closed when absent.
   */
  packageId: string;
  /** Wallet sender (mandate owner and funder). Canonicalized before use. */
  sender: string;
  /** Raw draft exactly as the form holds it. */
  draft: RecurringCapDraftInput;
  /** Caller-supplied current time in milliseconds since the Unix epoch. */
  nowMs: number;
}

/** Immutable metadata bound to the built transaction for review and UI use. */
export interface RecurringCapMetadata {
  readonly schemaVersion: string;
  readonly packageId: string;
  readonly module: string;
  readonly function: string;
  readonly clockId: string;
  readonly coinType: string;
  readonly owner: string;
  readonly beneficiary: string;
  readonly fundedMicro: string;
  readonly perPaymentCapMicro: string;
  readonly totalCapMicro: string;
  readonly intervalDays: number;
  readonly intervalMs: number;
  readonly expiryMs: number;
  readonly purpose: string;
  /** Lowercase 0x-prefixed 32-byte intent commitment. */
  readonly commitmentHex: string;
  /** Frozen 32-byte commitment as a readonly number list. */
  readonly commitmentBytes: readonly number[];
  /** Full Move target string: `${packageId}::recurring_cap::create`. */
  readonly target: string;
}

export interface BuildRecurringCapResult {
  transaction: Transaction;
  metadata: RecurringCapMetadata;
}

/**
 * Validate a configured package coordinate. Returns the canonical address or
 * `null` when the value is missing, malformed, or the zero address. Never
 * invents a coordinate and never proves deployment.
 */
export function parseConfiguredPackageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let canonical: string;
  try {
    canonical = normalizeSuiAddress(trimmed);
  } catch {
    return null;
  }
  if (!isValidSuiAddress(canonical) || canonical !== trimmed || canonical === SUI_ZERO_ADDRESS) {
    return null;
  }
  return canonical;
}

function canonicalizeAddress(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: missing or empty.`);
  }
  const normalized = normalizeSuiAddress(value.trim());
  if (!isValidSuiAddress(normalized) || normalized === SUI_ZERO_ADDRESS) {
    throw new Error(`Invalid ${label}: not a usable Sui address.`);
  }
  return normalized;
}

/**
 * Build the exact `recurring_cap::create` transaction and its intent
 * commitment. Throws on any invalid input; callers at the approval boundary
 * treat a throw as "do not open the wallet".
 *
 * Argument order mirrors the Move signature exactly:
 *   create<T>(Coin<T>, beneficiary, per_payment_cap, total_cap, interval_ms,
 *             expiry, intent_commitment, &Clock)
 * The commitment is a 32-byte blake2b256 digest over the UTF-8 bytes of a
 * canonical fixed-order JSON encoding that binds the schema version, fixed
 * module/function/Clock, pinned coin type, canonical addresses, purpose, all
 * three money bounds, the interval, and the expiry.
 *
 * A built transaction is not a mandate: nothing is funded, active, or on chain
 * until the connected wallet signs and submits it.
 */
export function buildRecurringCapCreation(
  input: BuildRecurringCapInput,
): BuildRecurringCapResult {
  if (!input || typeof input !== "object") {
    throw new Error("Recurring-cap build input is required.");
  }
  const packageId = parseConfiguredPackageId(input.packageId);
  if (packageId === null) {
    throw new Error("Recurring-cap package is not configured.");
  }
  const sender = canonicalizeAddress(input.sender, "sender");

  // Shared strict validator is the single policy owner; the builder fails
  // closed on the first field error in fixed field order. The owner is known
  // here, so the beneficiary != owner guard is always enforced.
  const validation = validateRecurringCapDraft(input.draft, {
    nowMs: input.nowMs,
    ownerAddress: sender,
  });
  if (!validation.ok) {
    const first = (
      [
        "funded",
        "beneficiaryAddress",
        "perPayment",
        "totalCap",
        "interval",
        "expiry",
        "purpose",
      ] as const
    ).map((field) => validation.fieldErrors[field]).find((message) => message !== undefined);
    throw new Error(`Invalid mandate: ${first ?? "validation failed."}`);
  }
  const draft = validation.draft;

  const encoding = {
    schemaVersion: RECURRING_CAP_SCHEMA_VERSION,
    package: packageId,
    module: RECURRING_CAP_MODULE,
    function: RECURRING_CAP_FUNCTION,
    clockId: RECURRING_CAP_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    owner: sender,
    beneficiary: draft.beneficiaryAddress,
    purpose: draft.purpose,
    fundedMicro: draft.fundedMicro,
    perPaymentCapMicro: draft.perPaymentCapMicro,
    totalCapMicro: draft.totalCapMicro,
    intervalMs: draft.intervalMs,
    expiryMs: draft.expiryMs,
  };
  const canonicalJson = JSON.stringify(encoding);
  const digest = blake2b256(new TextEncoder().encode(canonicalJson));
  if (digest.length !== RECURRING_CAP_COMMITMENT_BYTES) {
    throw new Error("Intent commitment must be exactly 32 bytes.");
  }
  const commitmentHex = toHex(digest);
  // Receipt-facing frozen readonly list; the transaction gets its own copy.
  const commitmentBytes: readonly number[] = Object.freeze(Array.from(digest));
  const txCommitmentBytes = new Uint8Array(digest);

  const target = `${packageId}::${RECURRING_CAP_MODULE}::${RECURRING_CAP_FUNCTION}`;

  const transaction = new Transaction();
  transaction.setSender(sender);
  const coin = transaction.coin({
    type: USDC_COIN_TYPE_TESTNET,
    balance: BigInt(draft.fundedMicro),
  });
  // Single Move call. Arguments follow the Move signature order exactly.
  transaction.moveCall({
    target,
    typeArguments: [USDC_COIN_TYPE_TESTNET],
    arguments: [
      coin,
      transaction.pure.address(draft.beneficiaryAddress),
      transaction.pure.u64(BigInt(draft.perPaymentCapMicro)),
      transaction.pure.u64(BigInt(draft.totalCapMicro)),
      transaction.pure.u64(BigInt(draft.intervalMs)),
      transaction.pure.u64(BigInt(draft.expiryMs)),
      transaction.pure.vector("u8", txCommitmentBytes),
      transaction.object.clock(),
    ],
  });

  const metadata: RecurringCapMetadata = {
    schemaVersion: RECURRING_CAP_SCHEMA_VERSION,
    packageId,
    module: RECURRING_CAP_MODULE,
    function: RECURRING_CAP_FUNCTION,
    clockId: RECURRING_CAP_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    owner: sender,
    beneficiary: draft.beneficiaryAddress,
    fundedMicro: draft.fundedMicro,
    perPaymentCapMicro: draft.perPaymentCapMicro,
    totalCapMicro: draft.totalCapMicro,
    intervalDays: draft.intervalDays,
    intervalMs: draft.intervalMs,
    expiryMs: draft.expiryMs,
    purpose: draft.purpose,
    commitmentHex,
    commitmentBytes,
    target,
  };
  Object.freeze(metadata);

  return { transaction, metadata };
}
