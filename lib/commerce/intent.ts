/**
 * Deterministic, offline purchase-intent interpreter (Wave 2, Task 2.1).
 *
 * No model receives raw text here. The parser is a pure function that matches
 * a strict typed schema against a static catalog and returns either a validated
 * preview or a specific clarification. It never produces transaction bytes,
 * signatures, or any executable payload from unvalidated text.
 */

import { getCatalog, type CatalogItem, type CatalogMerchant } from "./catalog";

export const MAX_INPUT_LENGTH = 500;

export type PurchaseAction = "buy";

export type ClarificationCode =
  | "empty"
  | "oversized"
  | "injection"
  | "missing_action"
  | "missing_quantity"
  | "unknown_item"
  | "unknown_merchant"
  | "item_merchant_mismatch"
  | "price_ceiling_exceeded";

export interface PurchaseItemRef {
  id: string;
  name: string;
}

export interface PurchaseMerchantRef {
  id: string;
  name: string;
  address: string | null;
}

export interface PurchaseIntentPreview {
  kind: "preview";
  action: PurchaseAction;
  item: PurchaseItemRef;
  quantity: number;
  unitPriceMist: string;
  totalMist: string;
  priceCeilingMist: string | null;
  merchant: PurchaseMerchantRef;
  confidence: number;
  clarification: null;
}

export interface PurchaseIntentClarification {
  kind: "clarification";
  action: PurchaseAction | null;
  clarification: { code: ClarificationCode; reason: string };
  item: PurchaseItemRef | null;
  quantity: number | null;
  merchant: PurchaseMerchantRef | null;
}

export type PurchaseIntentResult = PurchaseIntentPreview | PurchaseIntentClarification;

// ---------------------------------------------------------------------------
// Routing provenance metadata (Gonka phase 2).
//
// The intent route may resolve a prompt through GonkaRouter (a model-backed
// router) OR through the deterministic offline parser. The route attaches a
// `routing` object to every response so the UI can surface honest provenance:
// a successful Gonka route is labelled "GONKA ROUTED" with the model and
// request id; any fallback is labelled "LOCAL SAFE ROUTE" with a safe reason
// enum — never a raw provider error, never an API key. Routing metadata never
// carries transaction bytes, recipients, digests, signatures, or any
// settlement/confirmation authority; it is descriptive provenance only.
// ---------------------------------------------------------------------------

export type RoutingProvider = "gonkarouter" | "deterministic";
export type RoutingMode = "live" | "fallback";

/** Safe fallback reason enum. Never echoes raw provider error text. */
export type FallbackReason =
  | "not_configured"
  | "provider_error"
  | "timeout"
  | "model_mismatch"
  | "missing_request_id"
  | "invalid_schema"
  | "repair_failed"
  | "candidate_rejected";

export interface RoutingUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface RoutingMetadata {
  provider: RoutingProvider;
  mode: RoutingMode;
  /** Gonka request id (live routes only). */
  requestId?: string;
  /** Model the route requested (live routes only). */
  requestedModel?: string;
  /** Model the provider reported (live routes only). */
  responseModel?: string;
  /** End-to-end provider latency in ms (live routes only). */
  latencyMs?: number;
  /** Token usage captured from a valid provider response (live routes only). */
  usage?: RoutingUsage;
  /** Compact model signals, surfaced only when the candidate schema validated. */
  detectedLanguage?: string;
  confidence?: number;
  explanation?: string;
  /** Safe reason enum for fallback routes only. */
  fallbackReason?: FallbackReason;
}

const ACTION_WORDS = ["buy", "purchase", "order", "get"] as const;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

// Control characters excluding \n (10), \r (13), \t (9).
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const INJECTION_RE =
  /ignore\s+(?:previous|prior|all|above)\s+(?:instruction|prompt|rule|direction)|(?:^|\s)(?:system|assistant|user)\s*:|<\s*(?:script|img|iframe|svg)|javascript:|\b(?:act\s+as|pretend\s+to\s+be|new\s+instructions?\s*:)\b/i;

const CEILING_RE =
  /(?:under|below|up\s+to|less\s+than|no\s+more\s+than|max(?:imum)?(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*sui\b/i;

const QUANTITY_RE = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

function clarify(
  code: ClarificationCode,
  reason: string,
  partial: {
    action?: PurchaseAction | null;
    item?: PurchaseItemRef | null;
    quantity?: number | null;
    merchant?: PurchaseMerchantRef | null;
  } = {},
): PurchaseIntentClarification {
  return {
    kind: "clarification",
    action: partial.action ?? null,
    clarification: { code, reason },
    item: partial.item ?? null,
    quantity: partial.quantity ?? null,
    merchant: partial.merchant ?? null,
  };
}

/** Convert a decimal SUI string (e.g. "8.5") to an exact MIST string. */
function suiToMist(suiStr: string): string {
  const [intPart, fracPart = ""] = suiStr.split(".");
  const fracPadded = (fracPart + "000000000").slice(0, 9);
  return BigInt(intPart + fracPadded).toString();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchItem(text: string): { merchant: CatalogMerchant; item: CatalogItem } | null {
  const catalog = getCatalog();
  let best: { merchant: CatalogMerchant; item: CatalogItem } | null = null;
  let bestLen = -1;
  for (const merchant of catalog.merchants) {
    for (const item of merchant.items) {
      for (const alias of item.aliases) {
        const re = new RegExp(`\\b${escapeRe(alias)}\\b`, "i");
        if (re.test(text) && alias.length > bestLen) {
          best = { merchant, item };
          bestLen = alias.length;
        }
      }
    }
  }
  return best;
}

function matchMerchant(text: string): CatalogMerchant | null {
  const catalog = getCatalog();
  let best: CatalogMerchant | null = null;
  let bestLen = -1;
  for (const merchant of catalog.merchants) {
    for (const alias of merchant.aliases) {
      const re = new RegExp(`\\b${escapeRe(alias)}\\b`, "i");
      if (re.test(text) && alias.length > bestLen) {
        best = merchant;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

/**
 * Parse a free-text purchase command into a strict typed preview or a
 * specific clarification. Deterministic and offline — no network, no model.
 */
export function parseIntent(raw: string): PurchaseIntentResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return clarify("empty", "Input is empty.");
  }
  if (raw.length > MAX_INPUT_LENGTH) {
    return clarify("oversized", `Input exceeds ${MAX_INPUT_LENGTH} characters.`);
  }

  // Unicode NFKC normalization collapses compatibility characters (e.g. fullwidth
  // Latin letters Ｓ→S and fullwidth colon ：→:) to their canonical forms BEFORE
  // the injection guard runs, so role-marker spoofing like "Ｓystem:" cannot slip
  // past the check. It also keeps matching consistent with the ASCII catalog.
  // NFKC intentionally leaves normal Unicode punctuation (curly quotes, em-dash)
  // intact, so legitimate prompts are unaffected.
  const nfkc = raw.normalize("NFKC");

  if (CONTROL_CHAR_RE.test(nfkc) || INJECTION_RE.test(nfkc)) {
    return clarify("injection", "Input contains disallowed content.");
  }

  // Normalize: lowercase, collapse whitespace (keep alphanumerics, spaces, basic punctuation).
  const normalized = nfkc
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Extract and remove the price ceiling so its number is not read as quantity.
  const ceilingMatch = normalized.match(CEILING_RE);
  let priceCeilingMist: string | null = null;
  let working = normalized;
  if (ceilingMatch) {
    priceCeilingMist = suiToMist(ceilingMatch[1]!);
    working = normalized.replace(ceilingMatch[0]!, "").replace(/\s+/g, " ").trim();
  }

  // Action verb.
  const hasAction = ACTION_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(working));
  if (!hasAction) {
    return clarify("missing_action", "No purchase action (buy/order/get) detected.");
  }

  // Quantity.
  const qtyMatch = working.match(QUANTITY_RE);
  if (!qtyMatch) {
    return clarify("missing_quantity", "Quantity is required (e.g. 'two', '3').", {
      action: "buy",
    });
  }
  const token = qtyMatch[1]!;
  const quantity = /^\d+$/.test(token) ? parseInt(token, 10) : NUMBER_WORDS[token]!;
  if (quantity < 1) {
    return clarify("missing_quantity", "Quantity must be at least one.", { action: "buy" });
  }

  // Item.
  const itemMatch = matchItem(working);
  if (!itemMatch) {
    return clarify("unknown_item", "Item not found in catalog.", {
      action: "buy",
      quantity,
    });
  }

  // Merchant.
  const merchantMatch = matchMerchant(working);
  if (!merchantMatch) {
    return clarify("unknown_merchant", "Merchant not found in catalog.", {
      action: "buy",
      item: { id: itemMatch.item.id, name: itemMatch.item.name },
      quantity,
    });
  }

  // Item/merchant coherence: the matched item must be sold by the matched
  // merchant. Independent matching can otherwise pair an item with a merchant
  // that does not carry it (e.g. "croissants from River Cafe"), producing an
  // impossible preview. Do not produce a preview; ask for clarification.
  if (merchantMatch.id !== itemMatch.merchant.id) {
    return clarify(
      "item_merchant_mismatch",
      "The matched item is not sold by the matched merchant.",
      {
        action: "buy",
        item: { id: itemMatch.item.id, name: itemMatch.item.name },
        quantity,
        merchant: {
          id: merchantMatch.id,
          name: merchantMatch.name,
          address: merchantMatch.address,
        },
      },
    );
  }

  // Total in MIST.
  const unitPriceMist = itemMatch.item.priceMist;
  const totalMist = (BigInt(quantity) * BigInt(unitPriceMist)).toString();

  // Price ceiling check.
  if (priceCeilingMist !== null && BigInt(totalMist) > BigInt(priceCeilingMist)) {
    return clarify("price_ceiling_exceeded", "Total exceeds the stated price ceiling.", {
      action: "buy",
      item: { id: itemMatch.item.id, name: itemMatch.item.name },
      quantity,
      merchant: {
        id: merchantMatch.id,
        name: merchantMatch.name,
        address: merchantMatch.address,
      },
    });
  }

  return {
    kind: "preview",
    action: "buy",
    item: { id: itemMatch.item.id, name: itemMatch.item.name },
    quantity,
    unitPriceMist,
    totalMist,
    priceCeilingMist,
    merchant: {
      id: merchantMatch.id,
      name: merchantMatch.name,
      address: merchantMatch.address,
    },
    confidence: 1.0,
    clarification: null,
  };
}
