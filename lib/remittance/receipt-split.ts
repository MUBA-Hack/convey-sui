/**
 * Pure domain helpers for splitting a confirmed remittance settlement into
 * per-friend request amounts.
 *
 * Single authority: the source settlement `usdcMicro` integer minor units.
 * No floats, no network, no wallet, no signature. Allocation arithmetic uses
 * BigInt so the parts always sum exactly to the source. Generated output is
 * shareable text that says "request", never "paid", and carries no payment
 * authority.
 */

import { formatUsdc } from "./money";

export const SPLIT_MIN_PARTICIPANTS = 2;
export const SPLIT_MAX_PARTICIPANTS = 8;
export const SPLIT_NAME_MAX = 40;
export const USDC_DECIMALS = 6;

export type SplitNameError = "blank" | "too_long" | "duplicate";
export type UsdcParseError = "malformed" | "too_many_decimals";
export type AllocationError = "not_positive" | "overflow" | "malformed";

const MICRO_UNIT = 10n ** BigInt(USDC_DECIMALS);
const NON_NEGATIVE_INT = /^\d+$/;

/** Trim and collapse internal whitespace runs to single spaces. */
export function normalizeSplitName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Validate a participant name against blank, length, and duplicate rules.
 * Duplicate comparison is case-insensitive on the normalized form so "Ana"
 * and "ana" collide. `others` must already be normalized.
 */
export function validateSplitName(
  name: string,
  others: ReadonlyArray<string>,
): SplitNameError | null {
  const normalized = normalizeSplitName(name);
  if (normalized === "") return "blank";
  if (normalized.length > SPLIT_NAME_MAX) return "too_long";
  const lower = normalized.toLowerCase();
  for (const other of others) {
    if (normalizeSplitName(other).toLowerCase() === lower) return "duplicate";
  }
  return null;
}

/**
 * Deterministic equal split of `totalMicro` into `count` integer minor-unit
 * strings. Remainder is distributed one unit at a time to the earliest
 * participants in input order, so output is stable for the same inputs and
 * always sums exactly to the source. Throws RangeError for out-of-range
 * counts or a non-positive / malformed total.
 */
export function equalSplit(totalMicro: string, count: number): string[] {
  if (count < SPLIT_MIN_PARTICIPANTS || count > SPLIT_MAX_PARTICIPANTS) {
    throw new RangeError(`Split count must be between ${SPLIT_MIN_PARTICIPANTS} and ${SPLIT_MAX_PARTICIPANTS}.`);
  }
  if (!NON_NEGATIVE_INT.test(totalMicro)) {
    throw new RangeError("Split total must be a non-negative integer string.");
  }
  const total = BigInt(totalMicro);
  if (total <= 0n) {
    throw new RangeError("Split total must be greater than zero.");
  }
  const base = total / BigInt(count);
  const remainder = total % BigInt(count);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    parts.push((base + (BigInt(i) < remainder ? 1n : 0n)).toString());
  }
  return parts;
}

/**
 * Parse a customer-entered USDC decimal string into integer micro units.
 * Accepts at most `USDC_DECIMALS` fractional digits. Strict: a trailing dot
 * with no fractional digits, a leading sign, or non-numeric input is
 * malformed. Returns a discriminated result; never throws.
 */
export function parseUsdcDecimalToMicro(
  input: string,
): { ok: true; micro: string } | { ok: false; error: UsdcParseError } {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    // A bare leading-dot fraction like ".5" is accepted; everything else
    // (signs, trailing dot, letters, empty) is malformed.
    const dotMatch = trimmed.match(/^\.(\d+)$/);
    if (!dotMatch) return { ok: false, error: "malformed" };
    const frac = dotMatch[1]!;
    if (frac.length > USDC_DECIMALS) return { ok: false, error: "too_many_decimals" };
    return { ok: true, micro: frac.padEnd(USDC_DECIMALS, "0") };
  }
  const intPart = match[1]!;
  const frac = match[2] ?? "";
  if (frac.length > USDC_DECIMALS) return { ok: false, error: "too_many_decimals" };
  const micro = BigInt(intPart) * MICRO_UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
  return { ok: true, micro: micro.toString() };
}

/** Validate a single integer micro allocation against positivity and overflow. */
export function validateAllocationMicro(
  micro: string,
  totalMicro: string,
): AllocationError | null {
  if (!NON_NEGATIVE_INT.test(micro)) return "malformed";
  const value = BigInt(micro);
  if (value <= 0n) return "not_positive";
  if (!NON_NEGATIVE_INT.test(totalMicro)) return "malformed";
  if (value > BigInt(totalMicro)) return "overflow";
  return null;
}

/** Sum a list of integer micro allocation strings. Malformed entries are ignored. */
export function sumAllocationsMicro(allocations: ReadonlyArray<string>): string {
  let sum = 0n;
  for (const a of allocations) {
    if (NON_NEGATIVE_INT.test(a)) sum += BigInt(a);
  }
  return sum.toString();
}

/** True only when every allocation is well-formed and the sum equals the source exactly. */
export function validateSplitTotal(
  allocations: ReadonlyArray<string>,
  totalMicro: string,
): boolean {
  for (const a of allocations) {
    if (!NON_NEGATIVE_INT.test(a)) return false;
  }
  return sumAllocationsMicro(allocations) === totalMicro;
}

export interface SplitRequestInput {
  participantName: string;
  usdcMicro: string;
  /** Receipt link or reference carried from the confirmed settlement receipt. */
  receiptRef: string;
}

/**
 * Format a single copyable friend request message. Contains the participant
 * name, the exact USDC amount (formatted from micro, never parsed from a
 * displayed string), the receipt reference, and explicit request language.
 * Never claims payment, acceptance, or wallet authority.
 */
export function formatSplitRequest(input: SplitRequestInput): string {
  const name = normalizeSplitName(input.participantName);
  const usdc = formatUsdc(input.usdcMicro);
  return (
    `Split request for ${name}: ${usdc} USDC\n` +
    `Receipt: ${input.receiptRef}\n` +
    `This is a request, not a payment.`
  );
}
