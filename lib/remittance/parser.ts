/**
 * Deterministic, offline remittance-intent interpreter.
 *
 * A pure function that turns free text (typed or spoken) into a strict typed
 * remittance intent or a specific clarification. It never produces
 * transaction bytes, signatures, or any executable payload. It supports
 * English ("Send RM500 to Ana in Manila") and mixed Malay/English ("Hantar
 * RM500 kepada Ana di Manila").
 *
 * The parser only extracts structured fields; the quote builder performs all
 * monetary math. Inputs are bounded and injection-guarded exactly like the
 * commerce intent parser.
 */

import {
  MYR_CURRENCY_ALIASES,
  MYR_PHP_CORRIDOR,
  SUPPORTED_SOURCE_CURRENCIES,
} from "./constants";

export const MAX_REMITTANCE_INPUT_LENGTH = 500;

export type RemittanceAction = "send";

export type RemittanceClarificationCode =
  | "empty"
  | "oversized"
  | "injection"
  | "missing_action"
  | "missing_amount"
  | "unsupported_currency"
  | "ambiguous_currency"
  | "missing_recipient"
  | "missing_destination"
  | "unsupported_corridor"
  | "amount_too_small"
  | "amount_exceeds_max"
  | "invalid_recipient";

export interface RemittanceIntentInput {
  kind: "intent";
  action: RemittanceAction;
  /** Send amount in source-currency minor units (sen), as an integer string. */
  amountMinor: string;
  /** Resolved source currency (only MYR in round 1). */
  currency: "MYR";
  /** Recipient alias (validated). */
  recipient: string;
  /** Destination city/country alias as typed, lowercased. */
  destinationCity: string;
}

export interface RemittanceClarification {
  kind: "clarification";
  clarification: { code: RemittanceClarificationCode; reason: string };
  action: RemittanceAction | null;
  amountMinor: string | null;
  currency: "MYR" | null;
  recipient: string | null;
  destinationCity: string | null;
}

export type RemittanceParseResult = RemittanceIntentInput | RemittanceClarification;

export type RemittanceFieldErrorCode =
  | "empty"
  | "oversized"
  | "injection"
  | "missing_action"
  | "unsupported_currency"
  | "ambiguous_currency"
  | "missing_amount"
  | "invalid_amount"
  | "ambiguous_amount"
  | "missing_recipient"
  | "invalid_recipient"
  | "invalid_cap"
  | "ambiguous_cap"
  | "invalid_purpose"
  | "ambiguous_purpose";

export interface RemittanceFieldExtraction {
  amountMinor: string;
  currency: "MYR";
  recipient: string;
  purpose: string | null;
  maxAmountMinor: string | null;
  /** Lowercased destination alias from the original text, "__unknown__" for an
   * unrecognized destination word, or null when no destination preposition is
   * present. */
  destinationCity: string | null;
  /** Canonical country extracted from an explicit country token in the
   * destination clause (e.g. "Manila, Japan" -> "Japan", "in Philippines" ->
   * "Philippines"), or null when no explicit country signal is present. */
  destinationCountry: string | null;
}

export type RemittanceFieldExtractionResult =
  | { ok: true; fields: RemittanceFieldExtraction }
  | { ok: false; code: RemittanceFieldErrorCode };

const ACTION_WORDS = ["send", "hantar", "kirim", "transfer", "remit", "hantarkan"] as const;

// "to" / "kepada" / "ke" separators that introduce the recipient.
const TO_WORDS = ["to", "kepada", "ke", "untuk"] as const;

// "in" / "di" / "at" separators that introduce the destination. "dari" is
// excluded — it is a source/from preposition in Malay, not a destination
// preposition, and greedily absorbing prose after it produced false matches.
const IN_WORDS = ["in", "di", "at", "dekat"] as const;

// Bounded, exact-match country recognizer. A token in a destination clause is
// only treated as a country signal when it appears in this map; unrecognized
// tokens are never guessed. The supported corridor country is "Philippines";
// any other recognized country token fails closed.
const COUNTRY_TOKENS: ReadonlyMap<string, string> = new Map([
  ["philippines", "Philippines"],
  ["philippine", "Philippines"],
  ["pilipinas", "Philippines"],
  ["pinas", "Philippines"],
  ["japan", "Japan"],
  ["china", "China"],
  ["indonesia", "Indonesia"],
  ["singapore", "Singapore"],
  ["india", "India"],
  ["thailand", "Thailand"],
  ["vietnam", "Vietnam"],
  ["korea", "Korea"],
  ["south korea", "Korea"],
  ["malaysia", "Malaysia"],
  ["bangladesh", "Bangladesh"],
  ["pakistan", "Pakistan"],
  ["nepal", "Nepal"],
  ["united states", "United States"],
  ["usa", "United States"],
  ["us", "United States"],
  ["america", "United States"],
  ["united kingdom", "United Kingdom"],
  ["uk", "United Kingdom"],
  ["england", "United Kingdom"],
  ["australia", "Australia"],
  ["canada", "Canada"],
  ["germany", "Germany"],
  ["france", "France"],
  ["saudi arabia", "Saudi Arabia"],
  ["united arab emirates", "United Arab Emirates"],
  ["uae", "United Arab Emirates"],
]);

// Control characters excluding \n (10), \r (13), \t (9).
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const INJECTION_RE =
  /ignore\s+(?:previous|prior|all|above)\s+(?:instruction|prompt|rule|direction)|(?:^|\s)(?:system|assistant|user)\s*:|<\s*(?:script|img|iframe|svg)|javascript:|\b(?:act\s+as|pretend\s+to\s+be|new\s+instructions?\s*:)\b/i;

// Amount: digits with optional thousands separators and an optional decimal
// part. Strict grouping: ungrouped digits OR groups matching \d{1,3}(,\d{3})+,
// with optional <=2 decimal digits. "RM5,00" is rejected, never treated as
// RM500. The terminal boundary blocks word characters and commas so a partial
// match like "500abc" or "1,00" can never become a policy value; a trailing
// sentence period is allowed. Currency token is matched separately so "RM500"
// and "500 RM" both work.
const AMOUNT_RE = /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\w,])/;

// Purpose separators ("for" / "untuk") that introduce a free-text purpose
// clause. The clause runs until a max-cap prefix, sentence punctuation, or end.
const PURPOSE_WORDS = ["for", "untuk"] as const;

// Max-cap prefixes (Malay "jangan lebih" = "do not exceed", plus English
// equivalents). Pre-escaped regex fragments so they can be embedded directly.
const CAP_PREFIX_PATTERNS = [
  "jangan\\s+lebih",
  "not\\s+more\\s+than",
  "no\\s+more\\s+than",
  "at\\s+most",
  "maximum\\s+of",
  "max(?:imum)?(?:\\s+of)?",
  "under",
  "below",
];

const CAP_AMOUNT_FRAGMENT =
  "(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)(?![\\w,])";

const CAP_GLOBAL_RE = new RegExp(
  `\\b(?:${CAP_PREFIX_PATTERNS.join("|")})\\s+(?:rm\\s*)?${CAP_AMOUNT_FRAGMENT}`,
  "gi",
);

const CAP_PREFIX_RE = new RegExp(`\\b(?:${CAP_PREFIX_PATTERNS.join("|")})\\b`, "i");

const AMOUNT_GLOBAL_RE =
  /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\w,])/g;

const PURPOSE_GLOBAL_RE = new RegExp(
  `\\b(?:${PURPOSE_WORDS.map(escapeRe).join("|")})\\s+([A-Za-z][A-Za-z\\s-]*?)(?=\\s*(?:${CAP_PREFIX_PATTERNS.join("|")})\\b|\\s*[;,.]|$)`,
  "gi",
);

const PURPOSE_BARE_RE = new RegExp(
  `\\b(?:${PURPOSE_WORDS.map(escapeRe).join("|")})\\b(?!\\s+[A-Za-z])`,
  "i",
);

// Recipient name stops at a destination preposition, a purpose separator, a
// max-cap prefix, sentence punctuation, or end of string.
const RECIPIENT_STOP_PATTERNS = [
  ...IN_WORDS.map(escapeRe),
  ...PURPOSE_WORDS.map(escapeRe),
  ...CAP_PREFIX_PATTERNS,
];
const RECIPIENT_FIELDS_RE = new RegExp(
  `\\b(?:${TO_WORDS.map(escapeRe).join("|")})\\s+([A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*)?)(?=\\s*(?:${RECIPIENT_STOP_PATTERNS.join("|")})\\b|\\s*[;,.]|$)`,
  "i",
);

function clarify(
  code: RemittanceClarificationCode,
  reason: string,
  partial: {
    action?: RemittanceAction | null;
    amountMinor?: string | null;
    currency?: "MYR" | null;
    recipient?: string | null;
    destinationCity?: string | null;
  } = {},
): RemittanceClarification {
  return {
    kind: "clarification",
    clarification: { code, reason },
    action: partial.action ?? null,
    amountMinor: partial.amountMinor ?? null,
    currency: partial.currency ?? null,
    recipient: partial.recipient ?? null,
    destinationCity: partial.destinationCity ?? null,
  };
}

/**
 * Convert a decimal currency string to minor units. Strict grouping: ungrouped
 * digits or groups matching \d{1,3}(,\d{3})+, with optional <=2 decimal digits.
 * "5,00" is rejected (not treated as 500); "1,500.50" is accepted.
 */
export function toMinorUnits(raw: string): string | null {
  const trimmed = raw.trim();
  // Strict: either ungrouped digits, or properly grouped with commas.
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/,/g, "");
  const [intPart, fracPart = ""] = cleaned.split(".");
  if (fracPart.length > 2) return null;
  const fracPadded = (fracPart + "00").slice(0, 2);
  return BigInt(intPart + fracPadded).toString();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAction(text: string): boolean {
  return ACTION_WORDS.some((w) => new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(text));
}

/**
 * Detect currency tokens and return which source currency is implied. When
 * multiple currency families are present (e.g. "RM500 and $100"), the result
 * is "ambiguous" so the caller can clarify rather than silently preferring MYR.
 */
function detectCurrency(text: string): "MYR" | "other" | "ambiguous" | null {
  let foundMyr = false;
  let foundOther = false;
  for (const alias of MYR_CURRENCY_ALIASES) {
    // Match "RM" both as a standalone word and glued to digits ("RM500").
    if (new RegExp(`\\b${escapeRe(alias)}(?=\\b|\\d)`, "i").test(text)) foundMyr = true;
  }
  // Common other-currency tokens that would imply an unsupported corridor.
  // Letter tokens are matched as a word boundary before the token, allowing
  // the token to be immediately followed by digits (e.g. "PHP500") so a
  // currency glued to an amount is still detected.
  const otherLetterTokens = ["usd", "php", "sgd", "eur", "gbp", "inr"];
  for (const tok of otherLetterTokens) {
    if (new RegExp(`\\b${escapeRe(tok)}(?=\\b|\\d)`, "i").test(text)) {
      foundOther = true;
    }
  }
  if (/\$\s?\d/.test(text) || /\d\s?\$/.test(text)) foundOther = true;
  if (/[₱€£₹]\s?\d/.test(text) || /\d\s?[₱€£₹]/.test(text)) foundOther = true;
  if (foundMyr && foundOther) return "ambiguous";
  if (foundMyr) return "MYR";
  if (foundOther) return "other";
  return null;
}

/** Extract the numeric amount string (with possible decimals) from text. */
function extractAmount(text: string): string | null {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  return m[1] ?? null;
}

/**
 * Extract the recipient alias: the token group between a "to/kepada" word and
 * the next "in/di" word (or end of string). Falls back to the first
 * name-like token after the amount if no "to" word is present.
 */
function extractRecipient(text: string): string | null {
  const toAlt = TO_WORDS.map(escapeRe).join("|");
  const inAlt = IN_WORDS.map(escapeRe).join("|");
  // "to <name> in <city>" — capture generously then validate the length, so
  // an over-long name is captured and rejected as invalid_recipient rather
  // than silently truncated.
  const reToIn = new RegExp(`\\b(?:${toAlt})\\s+([A-Za-z][A-Za-z' -]{0,80})(?:\\s+(?:${inAlt})\\b)`, "i");
  const m1 = text.match(reToIn);
  if (m1) return (m1[1] ?? "").trim();
  // "to <name>" with no destination
  const reTo = new RegExp(`\\b(?:${toAlt})\\s+([A-Za-z][A-Za-z' -]{0,80})\\b`, "i");
  const m2 = text.match(reTo);
  if (m2) return (m2[1] ?? "").trim();
  return null;
}

/**
 * Extract the destination alias: match a known destination at word boundaries
 * after an "in/di/at/dekat" preposition. This avoids greedily absorbing prose
 * ("in Manila tomorrow" resolves "Manila", not "Manila tomorrow"). Multi-word
 * aliases (e.g. "Quezon City") are matched before single-word aliases.
 *
 * Returns:
 *  - the matched alias when a known destination is found
 *  - "__unknown__" when a preposition is present but the word after it is not
 *    a known destination (so the caller can return unsupported_corridor, not
 *    missing_destination)
 *  - null when no destination preposition is present at all
 */
function extractDestination(text: string): string | null {
  const inAlt = IN_WORDS.map(escapeRe).join("|");
  // Sort aliases by word count descending so "quezon city" matches before "quezon".
  const aliases = [...MYR_PHP_CORRIDOR.destinationAliases].sort(
    (a, b) => b.split(" ").length - a.split(" ").length,
  );
  for (const alias of aliases) {
    const escaped = escapeRe(alias);
    const re = new RegExp(`\\b(?:${inAlt})\\s+(${escaped})\\b`, "i");
    const m = text.match(re);
    if (m) return (m[1] ?? "").trim().toLowerCase();
  }
  // Check if there's any destination preposition at all. If so, the word after
  // it is an unsupported destination (not a missing one).
  const prepositionRe = new RegExp(`\\b(?:${inAlt})\\s+([A-Za-z][A-Za-z' -]{0,39})`, "i");
  const m = text.match(prepositionRe);
  if (m) return "__unknown__";
  return null;
}

function isSupportedDestination(city: string): boolean {
  return MYR_PHP_CORRIDOR.destinationAliases.includes(city.toLowerCase());
}

/**
 * Deterministically extract an optional explicit country signal from the
 * destination clause, separate from the city. Bounded, exact-match syntax:
 * a country token from COUNTRY_TOKENS appearing either after a comma following
 * a destination preposition ("in Manila, Japan") or as the sole destination
 * token ("in Philippines"). Unrecognized tokens are never guessed. Returns the
 * canonical country name or null when no explicit country signal is present.
 */
function extractExplicitCountry(text: string): string | null {
  const inAlt = IN_WORDS.map(escapeRe).join("|");
  const keys = [...COUNTRY_TOKENS.keys()].sort(
    (a, b) => b.split(" ").length - a.split(" ").length,
  );
  for (const key of keys) {
    const escaped = escapeRe(key);
    const commaRe = new RegExp(`\\b(?:${inAlt})\\s+[^,;]+,\\s*${escaped}\\b`, "i");
    if (commaRe.test(text)) return COUNTRY_TOKENS.get(key) ?? null;
  }
  for (const key of keys) {
    const escaped = escapeRe(key);
    const soleRe = new RegExp(`\\b(?:${inAlt})\\s+${escaped}\\b(?!\\s*,)`, "i");
    if (soleRe.test(text)) return COUNTRY_TOKENS.get(key) ?? null;
  }
  return null;
}

function isValidRecipient(name: string): boolean {
  if (name.length < 1 || name.length > 40) return false;
  return /^[A-Za-z][A-Za-z' -]{0,39}$/.test(name);
}

function isValidPurpose(purpose: string): boolean {
  const trimmed = purpose.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return false;
  return /^[A-Za-z][A-Za-z\s-]{0,79}$/.test(trimmed);
}

function normReason(code: "empty" | "oversized" | "injection"): string {
  if (code === "empty") return "Input is empty.";
  if (code === "oversized") return `Input exceeds ${MAX_REMITTANCE_INPUT_LENGTH} characters.`;
  return "Input contains disallowed content.";
}

/**
 * Shared input normalization + injection guard. Returns the NFKC-normalized,
 * whitespace-collapsed text or a safe error code. Pure and offline.
 */
function normalizeRemittanceInput(
  raw: string,
): { ok: true; normalized: string } | { ok: false; code: "empty" | "oversized" | "injection" } {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, code: "empty" };
  if (raw.length > MAX_REMITTANCE_INPUT_LENGTH) return { ok: false, code: "oversized" };
  const nfkc = raw.normalize("NFKC");
  if (CONTROL_CHAR_RE.test(nfkc) || INJECTION_RE.test(nfkc)) {
    return { ok: false, code: "injection" };
  }
  return { ok: true, normalized: nfkc.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() };
}

/**
 * Independently extract the deterministic remittance fields (amount, recipient,
 * currency, optional purpose, optional max cap) from free text WITHOUT requiring
 * a destination. The Gonka remittance resolver uses this as ground truth to
 * rebind an untrusted model candidate. Pure, offline, fail-closed.
 */
export function extractRemittanceFields(
  raw: string,
): RemittanceFieldExtractionResult {
  const norm = normalizeRemittanceInput(raw);
  if (!norm.ok) return { ok: false, code: norm.code };
  const text = norm.normalized;

  if (!hasAction(text)) return { ok: false, code: "missing_action" };

  const currency = detectCurrency(text);
  if (currency === "other") return { ok: false, code: "unsupported_currency" };
  if (currency === "ambiguous") return { ok: false, code: "ambiguous_currency" };

  // Strip the max-cap clause first so its amount is never read as the send
  // amount. A cap prefix with no parseable amount fails closed; multiple cap
  // clauses are ambiguous.
  let working = text;
  let maxAmountMinor: string | null = null;
  const capPrefixPresent = CAP_PREFIX_RE.test(working);
  const capMatches = [...working.matchAll(CAP_GLOBAL_RE)];
  if (capMatches.length > 1) return { ok: false, code: "ambiguous_cap" };
  if (capPrefixPresent && capMatches.length === 0) {
    return { ok: false, code: "invalid_cap" };
  }
  if (capMatches.length === 1) {
    const capMatch = capMatches[0];
    const capMinor = toMinorUnits(capMatch?.[1] ?? "");
    if (capMinor === null) return { ok: false, code: "invalid_cap" };
    maxAmountMinor = capMinor;
    working = working.replace(capMatch?.[0] ?? "", " ").replace(/\s+/g, " ").trim();
  }

  // Strip the optional purpose clause before amount extraction so numbers inside
  // a purpose clause are never read as a send amount. Multiple purpose clauses
  // are ambiguous; a bare/trailing purpose marker with no clause is invalid.
  const purposeMatches = [...working.matchAll(PURPOSE_GLOBAL_RE)];
  if (purposeMatches.length > 1) return { ok: false, code: "ambiguous_purpose" };
  let purpose: string | null = null;
  if (purposeMatches.length === 1) {
    const purposeMatch = purposeMatches[0];
    if (!purposeMatch) return { ok: false, code: "invalid_purpose" };
    const candidate = (purposeMatch[1] ?? "").trim();
    if (!isValidPurpose(candidate)) return { ok: false, code: "invalid_purpose" };
    purpose = candidate;
    working = working.replace(purposeMatch[0] ?? "", " ").replace(/\s+/g, " ").trim();
  } else if (PURPOSE_BARE_RE.test(working)) {
    return { ok: false, code: "invalid_purpose" };
  }

  const amountMatches = [...working.matchAll(AMOUNT_GLOBAL_RE)].map((m) => m[1] ?? "");
  if (amountMatches.length === 0) return { ok: false, code: "missing_amount" };
  if (amountMatches.length > 1) return { ok: false, code: "ambiguous_amount" };
  const amountMinor = toMinorUnits(amountMatches[0] ?? "");
  if (amountMinor === null) return { ok: false, code: "invalid_amount" };

  const recipientMatch = working.match(RECIPIENT_FIELDS_RE);
  const recipientRaw = recipientMatch ? (recipientMatch[1] ?? "").trim() : null;
  if (!recipientRaw) return { ok: false, code: "missing_recipient" };
  if (!isValidRecipient(recipientRaw)) return { ok: false, code: "invalid_recipient" };

  return {
    ok: true,
    fields: {
      amountMinor,
      currency: "MYR",
      recipient: recipientRaw,
      purpose,
      maxAmountMinor,
      destinationCity: extractDestination(text),
      destinationCountry: extractExplicitCountry(text),
    },
  };
}

/**
 * Parse a free-text remittance command into a strict typed intent or a
 * specific clarification. Deterministic and offline — no network, no model.
 */
export function parseRemittance(raw: string): RemittanceParseResult {
  const norm = normalizeRemittanceInput(raw);
  if (!norm.ok) return clarify(norm.code, normReason(norm.code));
  const normalized = norm.normalized;

  if (!hasAction(normalized)) {
    return clarify("missing_action", "No send action (send/hantar) detected.");
  }

  const currency = detectCurrency(normalized);
  if (currency === "other") {
    return clarify(
      "unsupported_currency",
      "Only MYR send amounts are supported in this corridor.",
      { action: "send" },
    );
  }
  if (currency === "ambiguous") {
    return clarify(
      "ambiguous_currency",
      "Multiple currencies were mentioned. Please specify a single MYR send amount.",
      { action: "send" },
    );
  }

  const amountRaw = extractAmount(normalized);
  if (!amountRaw) {
    return clarify("missing_amount", "Send amount is required (e.g. 'RM500').", {
      action: "send",
      currency: currency ?? null,
    });
  }
  const amountMinor = toMinorUnits(amountRaw);
  if (!amountMinor) {
    return clarify("missing_amount", "Send amount must be a valid MYR value.", {
      action: "send",
      currency: "MYR",
    });
  }

  const recipient = extractRecipient(normalized);
  if (!recipient) {
    return clarify("missing_recipient", "Recipient is required (e.g. 'to Ana').", {
      action: "send",
      amountMinor,
      currency: "MYR",
    });
  }
  if (!isValidRecipient(recipient)) {
    return clarify("invalid_recipient", "Recipient must be a 1-40 character name.", {
      action: "send",
      amountMinor,
      currency: "MYR",
    });
  }

  const destinationCity = extractDestination(normalized);
  if (destinationCity === "__unknown__") {
    return clarify(
      "unsupported_corridor",
      "That destination is not supported. Try Manila, Cebu, or Quezon City.",
      {
        action: "send",
        amountMinor,
        currency: "MYR",
        recipient,
      },
    );
  }
  if (!destinationCity) {
    return clarify("missing_destination", "Destination is required (e.g. 'in Manila').", {
      action: "send",
      amountMinor,
      currency: "MYR",
      recipient,
    });
  }
  if (!isSupportedDestination(destinationCity)) {
    return clarify(
      "unsupported_corridor",
      "Destination is outside the supported MYR -> PHP corridor.",
      { action: "send", amountMinor, currency: "MYR", recipient },
    );
  }

  const explicitCountry = extractExplicitCountry(normalized);
  if (
    explicitCountry !== null &&
    explicitCountry.toLowerCase() !== MYR_PHP_CORRIDOR.destinationCountry.toLowerCase()
  ) {
    return clarify(
      "unsupported_corridor",
      "Original text states an unsupported destination country.",
      { action: "send", amountMinor, currency: "MYR", recipient },
    );
  }

  return {
    kind: "intent",
    action: "send",
    amountMinor,
    currency: "MYR",
    recipient: recipient.trim(),
    destinationCity,
  };
}

export { SUPPORTED_SOURCE_CURRENCIES };
