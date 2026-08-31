/**
 * Recipient book — strict bounded device-local recipient safety classifier.
 *
 * Pure, client-safe, deterministic, no secrets, no model authority. This module
 * owns exactly two responsibilities:
 *
 *  1. `parseRecipientRecord` — strict-shape a saved recipient record. Malformed,
 *     extra-key, non-canonical-address, invalid digest, or broken receipt-pair
 *     input fails closed (returns `null`). It never calls legal identity
 *     verified.
 *  2. `classifyCandidate` — compare a saved record against a candidate
 *     destination and return one of `first_time`, `known_destination`,
 *     `step_up_required`, or `malformed_candidate` with deterministic, ordered
 *     reason codes. A malformed candidate is never conflated with `first_time`.
 *
 * Trust boundary: there is NO add/update/verify surface here. AI may propose
 * intent but cannot create, mutate, or mark a recipient as identity-verified.
 * Storage is out of scope — a future storage module owns persistence; this
 * module only shapes and classifies in-memory records.
 *
 * Address canonicalization reuses the existing `@mysten/sui/utils` helpers
 * (`normalizeSuiAddress`, `isValidSuiAddress`) so this module does not redefine
 * Sui address policy. Transaction digest validation reuses the official Sui
 * `isValidTransactionDigest` helper (base58 of exactly 32 bytes) rather than a
 * coarse local regex. A saved record must already hold the canonical spelling;
 * a mixed-case spelling is rejected at parse time rather than silently
 * rewritten. `lastReceiptDigest` and `lastReceiptAt` form an atomic pair: both
 * present or both null.
 */

import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";

// Canonical Sui address: bounded hex shape (max 66 = "0x" + 64 hex), then a
// refine that pins the canonical spelling so the schema's z.output is trusted
// downstream. The refine runs only after the cheap shape check, so an oversized
// or non-hex hostile string fails at the regex/max bound before any
// normalization work.
const CanonicalSuiAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/)
  .max(66)
  .refine((v) => {
    const canonical = normalizeSuiAddress(v);
    return canonical === v && isValidSuiAddress(canonical);
  }, "non-canonical Sui address");

// Alias is trimmed and lowercased inside the schema so two records with the
// same alias in different casing cannot drift apart. The non-empty check runs
// after the transform so a whitespace-only alias is rejected.
const AliasField = z
  .string()
  .max(80)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => s.length >= 1, "empty alias");

// Corridor country/city is the single schema-owned policy for both saved
// records and candidates: bounded, trimmed, and nonblank after trim. Sharing
// one field here removes the previous asymmetry where the saved schema accepted
// whitespace-only corridors while the candidate parser trimmed them, which let
// trusted saved output drift from equivalent candidates.
const CorridorField = z
  .string()
  .max(80)
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, "empty corridor");

/**
 * Saved recipient record input. `lastReceiptDigest`/`lastReceiptAt` are an
 * atomic nullable pair: a brand-new recipient has both null; a recipient with a
 * captured prior receipt has both present. Their presence is honest evidence of
 * a prior successful transfer, never identity verification. The digest is
 * validated with the official Sui `isValidTransactionDigest` (base58 of 32
 * bytes), not a permissive local regex. The schema encodes the canonical
 * address, alias normalization, digest validity, and receipt-pair atomicity
 * invariants directly so z.output is trusted without a second validation pass.
 */
export const RecipientRecordSchema = z
  .strictObject({
    alias: AliasField,
    canonicalAddress: CanonicalSuiAddress,
    corridorCountry: CorridorField,
    corridorCity: CorridorField,
    lastReceiptDigest: z
      .string()
      .nullable()
      .refine((v) => v === null || isValidTransactionDigest(v), "invalid digest"),
    lastReceiptAt: z.number().int().finite().safe().min(0).nullable(),
  })
  .refine(
    (r) => (r.lastReceiptDigest === null) === (r.lastReceiptAt === null),
    "receipt pair must be both present or both null",
  );

export type RecipientRecordInput = z.input<typeof RecipientRecordSchema>;
export type RecipientRecord = z.output<typeof RecipientRecordSchema>;

// Candidate address is bounded to the canonical Sui address shape (max 66 hex)
// before any normalization so an oversized hostile string fails cheaply at the
// schema bound. Mixed-case hex is accepted here; canonicalization happens in
// the classifier so a mixed-case spelling can still match a canonical record.
const CandidateSchema = z.strictObject({
  address: z.string().min(1).max(66).regex(/^0x[0-9a-fA-F]{1,64}$/),
  corridorCountry: CorridorField,
  corridorCity: CorridorField,
});

/** A candidate destination to classify against a saved record. */
export interface CandidateDestination {
  address: string;
  corridorCountry: string;
  corridorCity: string;
}

export type StepUpReason =
  | "address_change"
  | "corridor_country_change"
  | "corridor_city_change";

export type CandidateClassification =
  | { kind: "first_time"; reasons: [] }
  | { kind: "known_destination"; reasons: [] }
  | { kind: "step_up_required"; reasons: StepUpReason[] }
  | { kind: "malformed_candidate"; reasons: ["malformed_candidate"] };

/**
 * Strict-parse a saved recipient record. Returns the canonicalized record or
 * `null` when the input is malformed, has extra keys, carries a non-canonical
 * Sui address spelling, has an invalid digest, or breaks the receipt-pair
 * atomicity invariant. All invariants live in `RecipientRecordSchema` so this
 * is a thin safeParse adapter and there is no second validation pass. Never
 * throws.
 */
export function parseRecipientRecord(input: unknown): RecipientRecord | null {
  let parsed: ReturnType<typeof RecipientRecordSchema.safeParse>;
  try {
    parsed = RecipientRecordSchema.safeParse(input);
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Strict-parse a candidate destination. Returns the trimmed candidate or
 * `null` when the input has extra keys, wrong types, oversized/empty corridor
 * fields, or an empty address. Address canonical/valid checks happen in the
 * classifier so a mixed-case spelling can still match a canonical record.
 * Module-local: not exported, to keep the public API small.
 */
function parseCandidate(input: unknown): CandidateDestination | null {
  let parsed: ReturnType<typeof CandidateSchema.safeParse>;
  try {
    parsed = CandidateSchema.safeParse(input);
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  // Corridor fields are already trimmed+nonblank via the shared CorridorField
  // schema, so no second trim/nonblank pass is needed here.
  return parsed.data;
}

// Fail-closed results are constructed fresh on every return so a hostile
// caller mutating a returned `reasons` array can never poison a later call.
// A shared mutable constant would let one mutation leak across all calls.
function malformedCandidate(): CandidateClassification {
  return { kind: "malformed_candidate", reasons: ["malformed_candidate"] };
}

/**
 * Classify a candidate destination against a saved recipient record.
 *
 *  - `first_time` — no saved record and a valid (or absent) candidate. Never
 *    implies a known destination was matched.
 *  - `known_destination` — canonical address and corridor country/city match.
 *  - `step_up_required` — a saved record exists and the candidate differs in
 *    address, country, or city. Reasons are returned in a fixed order.
 *  - `malformed_candidate` — the candidate is corrupt (extra keys, wrong types,
 *    invalid address, empty/oversized corridors) or null against an existing
 *    record, OR the saved record itself is corrupt/forged. This is fail-closed
 *    and is never conflated with `first_time`.
 *
 * The saved record is accepted as `unknown` and revalidated via
 * `parseRecipientRecord` before any comparison. A non-null record that fails
 * parsing (extra key, invalid digest, broken receipt pair, non-canonical
 * address, wrong-typed field) fails closed to `malformed_candidate` and is
 * never trusted as a `known_destination`.
 *
 * Pure and deterministic: identical inputs always produce identical output.
 * Neither input is mutated. Never throws.
 */
export function classifyCandidate(
  record: unknown,
  candidate: CandidateDestination | null,
): CandidateClassification {
  // Revalidate the saved record through the strict parser. A null record is
  // honest absence; a non-null record that fails parsing is corrupt/forged and
  // fails closed regardless of the candidate.
  const validRecord = record === null ? null : parseRecipientRecord(record);
  if (record !== null && validRecord === null) return malformedCandidate();

  if (candidate === null) {
    // Absence of a candidate is honest non-information only when there is no
    // record to compare against; against an existing record it cannot be
    // honestly classified, so fail closed.
    if (validRecord === null) return { kind: "first_time", reasons: [] };
    return malformedCandidate();
  }

  const c = parseCandidate(candidate);
  if (!c) return malformedCandidate();

  const candidateCanonical = normalizeSuiAddress(c.address);
  if (!isValidSuiAddress(candidateCanonical)) return malformedCandidate();

  if (validRecord === null) return { kind: "first_time", reasons: [] };

  const reasons: StepUpReason[] = [];
  if (candidateCanonical !== validRecord.canonicalAddress) {
    reasons.push("address_change");
  }
  if (c.corridorCountry !== validRecord.corridorCountry) {
    reasons.push("corridor_country_change");
  }
  if (c.corridorCity !== validRecord.corridorCity) {
    reasons.push("corridor_city_change");
  }

  if (reasons.length === 0) return { kind: "known_destination", reasons: [] };
  return { kind: "step_up_required", reasons };
}

// MicroAmountString is kept module-local; the spending-mandate module defines
// its own integer-amount policy owner to avoid a shared-policy cycle between
// two independent domain modules.
