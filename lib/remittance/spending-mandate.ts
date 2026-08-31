/**
 * Spending mandate — strict bounded scoped-payment policy evaluator.
 *
 * Pure, client-safe, deterministic, no secrets, no on-chain enforcement. This
 * module owns exactly two responsibilities:
 *
 *  1. `parseSpendingMandate` — strict-shape a saved mandate. Malformed, extra-
 *     key, non-canonical-address, or out-of-bound input fails closed (returns
 *     `null`).
 *  2. `evaluateMandate` — compare a request against a saved mandate and return
 *     `allowed`, `needs_review`, or `stopped` with deterministic, ordered
 *     reason codes. Stops always fire before any wallet invocation.
 *
 * Trust boundary: there is NO activate/revoke/enforce/sign/submit surface here.
 * AI may PROPOSE mandate fields but cannot activate, change, or enforce one.
 * Enforcement is the wallet seam's job; this module only decides whether a
 * request is within a saved mandate's scope. No claim of on-chain enforcement
 * is made or implied — a `stopped` result is a client-side gate, not a chain
 * rejection, and an `allowed` result is a client-side policy pass, not a
 * settlement authorization.
 *
 * Address canonicalization reuses the existing `@mysten/sui/utils` helpers
 * (`normalizeSuiAddress`, `isValidSuiAddress`) so this module does not redefine
 * Sui address policy. Amount comparison uses BigInt so values above
 * `Number.MAX_SAFE_INTEGER` are compared exactly.
 *
 * Both the request and the policy are strict-parsed at runtime, and any
 * non-null mandate is revalidated before use. Extra keys, wrong types, or
 * malformed BigInt input short-circuit to `stopped` with `malformed`; the
 * evaluator never throws or ignores a corrupt input.
 *
 * Stop precedence (highest first): revoked > expired > not_yet_valid >
 * recipient_mismatch > country_mismatch > category_mismatch > amount_exceeds >
 * purpose_mismatch. A malformed request, policy, or mandate short-circuits to
 * `stopped` with `malformed` before any other check, so a corrupt input never
 * becomes an `allowed` or `needs_review` outcome.
 *
 * `needs_review` is returned ONLY when the caller explicitly opts in via the
 * bounded `allowReviewOnPurposeMismatch` policy flag AND the request's purpose
 * text differs from the mandate's. Default (no flag or flag false) fails closed
 * to `stopped` with `purpose_mismatch` — a purpose mismatch is never an
 * `allowed` outcome, and never a review trigger unless the caller explicitly
 * says so. A missing, non-string, empty, or oversized purpose is a malformed
 * request, not a purpose mismatch.
 */

import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
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

/** Positive integer micro-amount string with an explicit upper bound. */
const PositiveMicroString = z.string().regex(/^[1-9]\d{0,19}$/);

const SafeTimestamp = z.number().int().finite().safe().min(0);

// Scope dimensions (purpose/category/destinationCountry) are trimmed before the
// min/max bound so a whitespace-only value collapses to empty and fails closed
// at the schema, and surrounding whitespace is normalized away in z.output. A
// whitespace-only scope dimension can never reach the evaluator or a saved
// mandate, so it can never match a legitimate mandate scope and yield `allowed`.
const ScopeText = (max: number) => z.string().trim().min(1).max(max);

// The schema encodes the canonical address, valid window (endAt >= startAt),
// and enabled/revoked consistency invariants directly so z.output is trusted
// without a second validation pass in parseSpendingMandate.
export const SpendingMandateSchema = z
  .strictObject({
    recipientAddress: CanonicalSuiAddress,
    purpose: ScopeText(120),
    category: ScopeText(40),
    perPaymentMicroMax: PositiveMicroString,
    destinationCountry: ScopeText(80),
    startAt: SafeTimestamp,
    endAt: SafeTimestamp,
    enabled: z.boolean(),
    revokedAt: SafeTimestamp.nullable(),
  })
  .superRefine((m, ctx) => {
    if (m.endAt < m.startAt) {
      ctx.addIssue({ code: "custom", message: "endAt before startAt", path: ["endAt"] });
    }
    // A revoked mandate must carry a timestamp; an enabled mandate must not.
    if (m.revokedAt !== null && m.enabled) {
      ctx.addIssue({ code: "custom", message: "enabled mandate must not carry revokedAt", path: ["revokedAt"] });
    }
    if (m.revokedAt === null && !m.enabled) {
      ctx.addIssue({ code: "custom", message: "disabled mandate must carry revokedAt", path: ["revokedAt"] });
    }
  });

export type SpendingMandateInput = z.input<typeof SpendingMandateSchema>;
export type SpendingMandate = z.output<typeof SpendingMandateSchema>;

/**
 * Strict runtime request shape. `purpose`, `category`, and
 * `destinationCountry` are trimmed before the min/max bound, so a
 * whitespace-only value is malformed (not a mismatch) and surrounding
 * whitespace is normalized before comparison. `purpose` is required: a
 * missing, non-string, empty, or oversized purpose is a malformed request,
 * not a mismatch. The recipient address is bounded to the canonical Sui
 * address shape (max 66 hex) before any normalization so an oversized
 * hostile string fails cheaply at the schema bound. Mixed-case hex is
 * accepted here; canonicalization happens in the evaluator so a mixed-case
 * spelling can still match a canonical mandate.
 */
const RequestSchema = z.strictObject({
  recipientAddress: z.string().min(1).max(66).regex(/^0x[0-9a-fA-F]{1,64}$/),
  amountMicro: z.string().min(1),
  destinationCountry: ScopeText(80),
  category: ScopeText(40),
  purpose: ScopeText(120),
  now: SafeTimestamp,
});

export interface MandateEvaluationRequest {
  recipientAddress: string;
  amountMicro: string;
  destinationCountry: string;
  category: string;
  purpose: string;
  now: number;
}

/** Strict bounded policy shape: only the review opt-in flag is accepted. */
const PolicySchema = z.strictObject({
  allowReviewOnPurposeMismatch: z.boolean().optional(),
});

export interface MandateEvaluationPolicy {
  /**
   * When true, a request whose core fields match but whose `purpose` text
   * differs from the mandate's returns `needs_review` with `purpose_mismatch`.
   * Default false: a purpose mismatch is a stop, never a review trigger.
   */
  allowReviewOnPurposeMismatch?: boolean;
}

export type MandateStopReason =
  | "revoked"
  | "expired"
  | "not_yet_valid"
  | "recipient_mismatch"
  | "country_mismatch"
  | "category_mismatch"
  | "amount_exceeds"
  | "purpose_mismatch"
  | "malformed";

export type MandateEvaluationResult =
  | { kind: "allowed"; reasons: [] }
  | { kind: "needs_review"; reasons: ["purpose_mismatch"] }
  | { kind: "stopped"; reasons: [MandateStopReason] };

// Fail-closed results are constructed fresh on every return so a hostile
// caller mutating a returned `reasons` array can never poison a later call.
// A shared mutable constant would let one mutation leak across all calls.
function stoppedMalformed(): MandateEvaluationResult {
  return { kind: "stopped", reasons: ["malformed"] };
}

/**
 * Strict-parse a saved spending mandate. Returns the canonicalized mandate or
 * `null` when the input is malformed, has extra keys, carries a non-canonical
 * Sui address spelling, has an invalid window, or breaks the enabled/revoked
 * consistency invariant. All invariants live in `SpendingMandateSchema` so this
 * is a thin safeParse adapter and there is no second validation pass. Never
 * throws.
 */
export function parseSpendingMandate(input: unknown): SpendingMandate | null {
  let parsed: ReturnType<typeof SpendingMandateSchema.safeParse>;
  try {
    parsed = SpendingMandateSchema.safeParse(input);
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  return parsed.data;
}

function parsePositiveMicro(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Evaluate a request against a saved mandate. Pure and deterministic: identical
 * inputs always produce identical output. Neither input is mutated. Never
 * throws — any corrupt mandate, request, or policy fails closed to
 * `stopped`/`malformed`.
 *
 * The non-null mandate is revalidated before use. The request and policy are
 * strict-parsed at runtime; extra keys or wrong types short-circuit to
 * `stopped`/`malformed`. Stops always fire before any wallet invocation, in
 * the fixed precedence order. A purpose mismatch is a stop by default and a
 * `needs_review` only when the caller explicitly opts in via the bounded
 * policy flag.
 */
export function evaluateMandate(
  mandate: SpendingMandate | null,
  request: MandateEvaluationRequest | null,
  policy: MandateEvaluationPolicy = {},
): MandateEvaluationResult {
  if (mandate === null) return stoppedMalformed();

  // Revalidate any non-null mandate so a tampered or drift-affected object can
  // never reach the policy checks.
  const validMandate = parseSpendingMandate(mandate);
  if (!validMandate) return stoppedMalformed();

  if (request === null) return stoppedMalformed();

  let reqParsed: ReturnType<typeof RequestSchema.safeParse>;
  try {
    reqParsed = RequestSchema.safeParse(request);
  } catch {
    return stoppedMalformed();
  }
  if (!reqParsed.success) return stoppedMalformed();
  const req = reqParsed.data;

  let polParsed: ReturnType<typeof PolicySchema.safeParse>;
  try {
    polParsed = PolicySchema.safeParse(policy);
  } catch {
    return stoppedMalformed();
  }
  if (!polParsed.success) return stoppedMalformed();
  const pol = polParsed.data;

  // Malformed BigInt or out-of-bound amount short-circuits before any policy
  // check. parsePositiveMicro never throws.
  const amount = parsePositiveMicro(req.amountMicro);
  if (amount === null) return stoppedMalformed();

  const requestCanonical = normalizeSuiAddress(req.recipientAddress);
  if (!isValidSuiAddress(requestCanonical)) return stoppedMalformed();

  // Stop precedence: revoked > expired > not_yet_valid > recipient > country >
  // category > amount > purpose. Each stop returns a single deterministic
  // reason.
  if (!validMandate.enabled || validMandate.revokedAt !== null) {
    return { kind: "stopped", reasons: ["revoked"] };
  }
  if (req.now > validMandate.endAt) {
    return { kind: "stopped", reasons: ["expired"] };
  }
  if (req.now < validMandate.startAt) {
    return { kind: "stopped", reasons: ["not_yet_valid"] };
  }
  if (requestCanonical !== validMandate.recipientAddress) {
    return { kind: "stopped", reasons: ["recipient_mismatch"] };
  }
  if (req.destinationCountry !== validMandate.destinationCountry) {
    return { kind: "stopped", reasons: ["country_mismatch"] };
  }
  if (req.category !== validMandate.category) {
    return { kind: "stopped", reasons: ["category_mismatch"] };
  }
  if (amount > BigInt(validMandate.perPaymentMicroMax)) {
    return { kind: "stopped", reasons: ["amount_exceeds"] };
  }

  // Core fields match. A purpose mismatch is a stop by default and a review
  // trigger ONLY when the caller explicitly opts in via the bounded flag.
  if (req.purpose !== validMandate.purpose) {
    if (pol.allowReviewOnPurposeMismatch === true) {
      return { kind: "needs_review", reasons: ["purpose_mismatch"] };
    }
    return { kind: "stopped", reasons: ["purpose_mismatch"] };
  }

  return { kind: "allowed", reasons: [] };
}
