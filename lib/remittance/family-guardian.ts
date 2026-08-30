/**
 * Family Guardian — deterministic pre-verification review of a remittance quote.
 *
 * Pure, client-safe, no secrets, no model authority. Given a validated
 * `QuoteEnvelope`, the resolved quote blocker (the exact missing prerequisite
 * that gates a real testnet transfer), and the current time, produce a typed
 * report with one concise overall state and a list of truthful evidence checks.
 *
 * Truth boundaries (enforced here, not in the UI):
 *  - The canonical recipient is "pinned" only when a wallet address is present.
 *    A null address is a hard fail — never imply a transfer can settle.
 *  - The asset and network are the schema-pinned testnet USDC corridor. This is
 *    an invariant of a valid envelope, surfaced as an honest check, not a claim
 *    of live verification.
 *  - Quote freshness uses the existing `isExpired` helper. An expired or
 *    non-safe-integer clock fails closed.
 *  - Family-rule compliance is computed deterministically from the send amount
 *    versus the stated per-transfer maximum. The `intentReview` rule fields are
 *    bound into the attestation by `bindAuthorizationToQuote`; this module
 *    never grants model-only authority — it only reads what the quote carries.
 *  - Wallet approval is ALWAYS required before settlement. When every other
 *    check passes and the blocker is `none`, approval is the remaining step
 *    (status `required`), not a pass. This module never claims on-chain
 *    verification or settlement before the customer approves in their wallet.
 *
 * No invented scam/fraud score is produced. No check asserts settlement.
 */

import { isExpired, type QuoteEnvelope } from "./quote-schema";
import type { QuoteBlocker } from "./transfer";

export type { QuoteBlocker as FamilyGuardianBlocker } from "./transfer";

export type GuardianCheckStatus = "pass" | "fail" | "required" | "not-stated";

export type GuardianCheckId =
  | "recipient"
  | "asset-network"
  | "freshness"
  | "family-rule"
  | "purpose"
  | "approval";

/**
 * The one canonical settlement rail this corridor settles on. The quote schema
 * allows any 1..60 character string for `settlementRail`, so the guardian pins
 * the exact canonical value rather than accepting a loose regex match — a
 * tampered or alternate rail (e.g. "Sui testnet USDC (preview)" or a mainnet
 * label) fails closed here.
 */
const CANONICAL_SETTLEMENT_RAIL = "Sui testnet USDC";

export interface GuardianCheck {
  id: GuardianCheckId;
  /** Short product-language label shown in the evidence list. */
  label: string;
  status: GuardianCheckStatus;
  /** One-line product-language detail. Never SDK/debug/demo jargon. */
  detail: string;
}

export type GuardianOverall = "blocked" | "ready";

export interface FamilyGuardianReport {
  overall: GuardianOverall;
  /** One concise overall-state line in product language. */
  headline: string;
  checks: GuardianCheck[];
}

export interface FamilyGuardianInput {
  quote: QuoteEnvelope;
  blocker: QuoteBlocker;
  now: number;
}

/** A safe clock is a finite safe integer; anything else fails closed. */
function isSafeClock(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Deterministic over-cap test mirroring `bindAuthorizationToQuote`'s
 * `over_cap` boundary: a stated maximum below the send amount is a failure.
 * Caller guarantees `cap` is non-null (a null cap is surfaced as `not-stated`
 * by `familyRuleCheck` before this is reached).
 */
function isWithinFamilyLimit(quote: QuoteEnvelope): boolean {
  const cap = quote.intentReview.maximumFamilyLimitMinor;
  try {
    return BigInt(quote.youPayMinor) <= BigInt(cap as string);
  } catch {
    return false;
  }
}

function recipientCheck(quote: QuoteEnvelope, blocker: QuoteBlocker): GuardianCheck {
  if (blocker !== "unmapped" && quote.recipientAddress) {
    return {
      id: "recipient",
      label: "Recipient pinned",
      status: "pass",
      detail: "Pinned to a wallet address for this transfer.",
    };
  }
  return {
    id: "recipient",
    label: "Recipient pinned",
    status: "fail",
    detail: "No wallet address is set for this recipient yet.",
  };
}

function assetNetworkCheck(quote: QuoteEnvelope): GuardianCheck {
  // The schema pins the corridor to MYR→PHP but leaves `settlementRail` as a
  // free string, so the guardian requires the exact canonical rail — not a
  // regex match. This is an invariant surfaced honestly, not a live network
  // probe; a tampered envelope fails schema validation upstream.
  const isCanonicalRail = quote.settlementRail === CANONICAL_SETTLEMENT_RAIL;
  if (
    quote.corridor.source === "MYR" &&
    quote.corridor.destination === "PHP" &&
    isCanonicalRail
  ) {
    return {
      id: "asset-network",
      label: "Asset and network",
      status: "pass",
      detail: "Sui testnet USDC, MYR to PHP corridor.",
    };
  }
  return {
    id: "asset-network",
    label: "Asset and network",
    status: "fail",
    detail: "The asset or corridor does not match the expected transfer.",
  };
}

function freshnessCheck(quote: QuoteEnvelope, now: number): GuardianCheck {
  if (!isSafeClock(now) || isExpired(quote.expiresAt, now)) {
    return {
      id: "freshness",
      label: "Quote is fresh",
      status: "fail",
      detail: "This quote has expired. Refresh for a fresh rate.",
    };
  }
  return {
    id: "freshness",
    label: "Quote is fresh",
    status: "pass",
    detail: "The rate is locked and the quote is still valid.",
  };
}

function familyRuleCheck(quote: QuoteEnvelope): GuardianCheck {
  const cap = quote.intentReview.maximumFamilyLimitMinor;
  if (cap === null) {
    // A null cap means no per-transfer rule was stated on this request. This is
    // honest non-information, not a cleared prerequisite: showing "pass" would
    // falsely imply the limit was reviewed and met. The truthful status is
    // not-stated — non-blocking evidence that neither gates nor authorizes
    // settlement, mirroring the purpose check's truth boundary.
    return {
      id: "family-rule",
      label: "Within family limit",
      status: "not-stated",
      detail: "No per-transfer limit was stated for this request.",
    };
  }
  if (isWithinFamilyLimit(quote)) {
    return {
      id: "family-rule",
      label: "Within family limit",
      status: "pass",
      detail: "The send amount is within the stated family limit.",
    };
  }
  return {
    id: "family-rule",
    label: "Within family limit",
    status: "fail",
    detail: "The send amount exceeds the stated family limit.",
  };
}

/**
 * Family purpose evidence — truthful presence/value, never a pass/fail authority.
 *
 * The purpose is bound into the intent review (and into the attestation's
 * canonical message by `bindAuthorizationToQuote`), so this check surfaces what
 * the request actually carries. It is evidence, not a gate: a present or absent
 * purpose never blocks or authorizes settlement. A stated purpose is `pass`
 * (checked evidence); an absent optional purpose is `not-stated` — honest
 * non-information that neither blocks nor authorizes. The detail states the
 * value when present and honestly says none was stated when absent; it never
 * claims the purpose itself approves payment.
 */
function purposeCheck(quote: QuoteEnvelope): GuardianCheck {
  const purpose = quote.intentReview.purpose;
  if (purpose) {
    return {
      id: "purpose",
      label: "Family purpose",
      status: "pass",
      detail: `Purpose stated: ${purpose}.`,
    };
  }
  return {
    id: "purpose",
    label: "Family purpose",
    status: "not-stated",
    detail: "No purpose was stated for this transfer.",
  };
}

function approvalCheck(blocker: QuoteBlocker): GuardianCheck {
  switch (blocker) {
    case "none":
      return {
        id: "approval",
        label: "Wallet approval",
        status: "required",
        detail: "Approve in your wallet to complete this transfer.",
      };
    case "wallet":
      return {
        id: "approval",
        label: "Wallet approval",
        status: "fail",
        detail: "Connect your wallet to continue.",
      };
    case "wrong-network":
      return {
        id: "approval",
        label: "Wallet approval",
        status: "fail",
        detail: "Switch your wallet to Sui testnet to continue.",
      };
    case "unmapped":
      return {
        id: "approval",
        label: "Wallet approval",
        status: "fail",
        detail: "This recipient needs a wallet address before approval.",
      };
    case "unapproved":
      return {
        id: "approval",
        label: "Wallet approval",
        status: "fail",
        detail: "This quote is not yet approved for wallet settlement.",
      };
  }
}

/**
 * Evaluate the pre-verification review state of a quote. Pure and deterministic:
 * the same inputs always produce the same report. The overall state is `blocked`
 * if any check fails, otherwise `ready` (wallet approval is the remaining step).
 *
 * This module performs NO server verification, so labels use strictly
 * pre-verification product language and never claim safe-to-sign, verified,
 * authorized, or ready-for-approval. Wallet approval is always required and is
 * the only authority that can move funds.
 */
export function evaluateFamilyGuardian(input: FamilyGuardianInput): FamilyGuardianReport {
  const { quote, blocker, now } = input;
  const checks: GuardianCheck[] = [
    recipientCheck(quote, blocker),
    assetNetworkCheck(quote),
    freshnessCheck(quote, now),
    familyRuleCheck(quote),
    purposeCheck(quote),
    approvalCheck(blocker),
  ];

  const anyFail = checks.some((c) => c.status === "fail");
  const overall: GuardianOverall = anyFail ? "blocked" : "ready";
  const headline =
    overall === "ready"
      ? "Ready to review."
      : "Review before continuing.";

  return { overall, headline, checks };
}
