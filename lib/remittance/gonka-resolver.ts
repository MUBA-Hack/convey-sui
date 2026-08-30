/**
 * Gonka remittance candidate resolver — the remittance-domain trust boundary.
 *
 * A GonkaRouter remittance candidate is UNTRUSTED. The resolver receives the
 * ORIGINAL user text, the model candidate, and the current public recipient
 * manifest. It independently re-parses amount, recipient, currency, optional
 * purpose, and optional max cap from the original text (deterministic ground
 * truth) and rebinds the candidate's destination city/country against the
 * manifest and the supported MYR -> PHP corridor.
 *
 * It rejects (fail closed) on any mismatch, unsupported field, ambiguity, cap
 * below amount, model uncertainty, or confidence below the named threshold. The
 * candidate never supplies a wallet address or execution authority; the rebound
 * intent carries only public, deterministic fields. No transaction bytes,
 * signatures, digests, or settlement state are ever produced here.
 */

import {
  extractRemittanceFields,
  toMinorUnits,
  type RemittanceFieldErrorCode,
} from "./parser";
import type {
  GonkaRemittanceCandidate,
  GonkaRemittanceManifest,
} from "@/lib/gonka/remittance";

export const MIN_REMITTANCE_CONFIDENCE = 0.7;

export type GonkaRemittanceResolveRejectionReason =
  | "amount_mismatch"
  | "recipient_mismatch"
  | "city_mismatch"
  | "country_mismatch"
  | "currency_mismatch"
  | "purpose_mismatch"
  | "cap_mismatch"
  | "unsupported_corridor"
  | "unknown_recipient"
  | "cap_below_amount"
  | "model_uncertain"
  | "needs_review"
  | "low_confidence"
  | "invalid_amount"
  | "invalid_cap"
  | "missing_amount"
  | "missing_recipient"
  | "ambiguous_destination"
  | "ambiguous_amount"
  | "ambiguous_cap"
  | "invalid_purpose"
  | "ambiguous_purpose";

export interface RemittanceReboundIntent {
  action: "send";
  amountMinor: string;
  currency: "MYR";
  recipient: string;
  destinationCity: string;
  destinationCountry: "Philippines";
  purpose: string | null;
  maxAmountMinor: string | null;
  confidence: number;
}

export interface GonkaRemittanceResolveOk {
  ok: true;
  intent: RemittanceReboundIntent;
}

export interface GonkaRemittanceResolveErr {
  ok: false;
  reason: GonkaRemittanceResolveRejectionReason;
  message: string;
}

export type GonkaRemittanceResolveResult =
  | GonkaRemittanceResolveOk
  | GonkaRemittanceResolveErr;

function fail(
  reason: GonkaRemittanceResolveRejectionReason,
  message: string,
): GonkaRemittanceResolveErr {
  return { ok: false, reason, message };
}

function mapFieldError(code: RemittanceFieldErrorCode): GonkaRemittanceResolveErr {
  switch (code) {
    case "empty":
    case "oversized":
    case "injection":
    case "missing_action":
      return fail("missing_amount", "Original text does not state a valid remittance request.");
    case "unsupported_currency":
    case "ambiguous_currency":
      return fail("currency_mismatch", "Only MYR send amounts are supported in this corridor.");
    case "missing_amount":
    case "invalid_amount":
      return fail("missing_amount", "Send amount could not be deterministically parsed.");
    case "ambiguous_amount":
      return fail("ambiguous_amount", "Original text states multiple send amounts.");
    case "missing_recipient":
      return fail("missing_recipient", "Recipient could not be deterministically parsed.");
    case "invalid_recipient":
      return fail("recipient_mismatch", "Recipient is not a valid recipient alias.");
    case "invalid_cap":
      return fail("invalid_cap", "Max cap could not be deterministically parsed.");
    case "ambiguous_cap":
      return fail("ambiguous_cap", "Original text states multiple max caps.");
    case "invalid_purpose":
      return fail("invalid_purpose", "Purpose clause is malformed.");
    case "ambiguous_purpose":
      return fail("ambiguous_purpose", "Original text states multiple purpose clauses.");
  }
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Deterministically resolve an untrusted Gonka remittance candidate against the
 * original text and the canonical recipient manifest. Pure, offline, fail-closed.
 */
export function resolveGonkaRemittanceCandidate(
  originalText: string,
  candidate: GonkaRemittanceCandidate,
  manifest: GonkaRemittanceManifest,
): GonkaRemittanceResolveResult {
  const ground = extractRemittanceFields(originalText);
  if (!ground.ok) return mapFieldError(ground.code);
  const fields = ground.fields;

  // Explicit original-text country: an explicit country signal that does not
  // match the supported corridor country fails closed, even when the candidate
  // and manifest both state the corridor country. An omitted country falls
  // through to the manifest/corridor country below.
  const corridorCountry = manifest.corridor.destinationCountry.toLowerCase();
  if (
    fields.destinationCountry !== null &&
    fields.destinationCountry.toLowerCase() !== corridorCountry
  ) {
    return fail("unsupported_corridor", "Original text states an unsupported destination country.");
  }

  // Amount: candidate must parse to the same minor units as the ground truth.
  const candidateAmountMinor = toMinorUnits(candidate.sendAmountMyr);
  if (candidateAmountMinor === null) {
    return fail("invalid_amount", "Candidate sendAmountMyr is not a valid decimal MYR string.");
  }
  if (candidateAmountMinor !== fields.amountMinor) {
    return fail("amount_mismatch", "Candidate send amount does not match the parsed amount.");
  }

  // Recipient: candidate alias must match the parsed recipient.
  if (!sameText(candidate.recipientAlias, fields.recipient)) {
    return fail("recipient_mismatch", "Candidate recipient does not match the parsed recipient.");
  }

  // Recipient must exist in the manifest.
  const recipient = manifest.recipients.find(
    (r) => r.alias.toLowerCase() === candidate.recipientAlias.toLowerCase(),
  );
  if (!recipient) {
    return fail("unknown_recipient", "Candidate recipient is not present in the manifest.");
  }

  // Destination city is rebound against the original text and the manifest —
  // the model never chooses the city. If the original states a supported city,
  // the candidate must match it exactly. If the original omits a city and the
  // recipient has exactly one allowed city, that city is used; otherwise
  // clarification is required.
  const groundCity = fields.destinationCity;
  if (groundCity === "__unknown__") {
    return fail("unsupported_corridor", "Original text states an unsupported destination.");
  }

  let resolvedCity: string | null = null;
  if (groundCity !== null) {
    const recipientMatch = recipient.destinationCities.find(
      (c) => c.toLowerCase() === groundCity,
    );
    if (recipientMatch) {
      resolvedCity = recipientMatch.toLowerCase();
    } else {
      const corridorHasCity = manifest.corridor.destinationCities.some(
        (c) => c.toLowerCase() === groundCity,
      );
      if (corridorHasCity) {
        return fail("city_mismatch", "Original destination city is not listed for the recipient.");
      }
      if (groundCity === manifest.corridor.destinationCountry.toLowerCase()) {
        // A country signal alone does not pin a city; fall through to the
        // recipient city-count check below.
      } else {
        return fail("unsupported_corridor", "Original destination is outside the supported corridor.");
      }
    }
  }

  if (resolvedCity === null) {
    const allowed = recipient.destinationCities;
    if (allowed.length === 1) {
      resolvedCity = (allowed[0] ?? "").toLowerCase();
    } else {
      return fail(
        "ambiguous_destination",
        "Original text does not state a city and the recipient has multiple allowed cities; clarification required.",
      );
    }
  }

  const candidateCityLower = candidate.destinationCity.toLowerCase();
  if (candidateCityLower !== resolvedCity) {
    return fail("city_mismatch", "Candidate destination city does not match the original text.");
  }

  // Destination country must match both the recipient's manifest country and the corridor.
  if (
    candidate.destinationCountry.toLowerCase() !== recipient.destinationCountry.toLowerCase()
  ) {
    return fail("country_mismatch", "Candidate destination country does not match the recipient's manifest country.");
  }
  if (
    candidate.destinationCountry.toLowerCase() !==
    manifest.corridor.destinationCountry.toLowerCase()
  ) {
    return fail("country_mismatch", "Candidate destination country does not match the corridor.");
  }

  // Purpose: candidate must agree with the parsed purpose (presence and text).
  if (!sameText(candidate.purpose ?? null, fields.purpose)) {
    return fail("purpose_mismatch", "Candidate purpose does not match the parsed purpose.");
  }

  // Max cap: candidate must agree with the parsed cap (presence and value).
  const candidateCapMinor =
    candidate.maxAmountMyr === undefined ? null : toMinorUnits(candidate.maxAmountMyr);
  if (candidate.maxAmountMyr !== undefined && candidateCapMinor === null) {
    return fail("invalid_cap", "Candidate maxAmountMyr is not a valid decimal MYR string.");
  }
  if (candidateCapMinor !== fields.maxAmountMinor) {
    return fail("cap_mismatch", "Candidate max cap does not match the parsed max cap.");
  }

  // Cap must not be below the send amount.
  if (fields.maxAmountMinor !== null && BigInt(fields.maxAmountMinor) < BigInt(fields.amountMinor)) {
    return fail("cap_below_amount", "Max cap is below the send amount.");
  }

  // Confidence threshold.
  if (candidate.confidence < MIN_REMITTANCE_CONFIDENCE) {
    return fail("low_confidence", "Candidate confidence is below the required threshold.");
  }

  // Explicit model uncertainty / review flags require clarification.
  if (candidate.uncertain) {
    return fail("model_uncertain", "Candidate reports uncertainty; clarification required.");
  }
  if (candidate.needsReview) {
    return fail("needs_review", "Candidate flags review; clarification required.");
  }

  return {
    ok: true,
    intent: {
      action: "send",
      amountMinor: fields.amountMinor,
      currency: "MYR",
      recipient: fields.recipient,
      destinationCity: resolvedCity,
      destinationCountry: "Philippines",
      purpose: fields.purpose,
      maxAmountMinor: fields.maxAmountMinor,
      confidence: candidate.confidence,
    },
  };
}
