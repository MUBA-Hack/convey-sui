/**
 * Gonka candidate resolver — the commerce-domain trust boundary.
 *
 * A GonkaRouter candidate is UNTRUSTED. The route layer must re-resolve every
 * candidate itemId/merchantId/quantity/maxSpendSui against the canonical
 * catalog truth before any preview is shown: ids must exist, the merchant must
 * actually sell the item, quantity must be a positive integer, and the
 * quantity * unit price must not exceed the candidate's own maxSpendSui cap.
 *
 * This module never produces transaction bytes, recipients, digests,
 * signatures, or any settlement/confirmation authority. On any policy
 * rejection it returns a structured rejection with a safe reason enum — the
 * caller falls back to the deterministic offline parser. No raw provider
 * error or catalog secret ever leaves this module.
 */

import { getCatalog, type Catalog, type CatalogItem, type CatalogMerchant } from "./catalog";
import type { PurchaseIntentPreview } from "./intent";
import type { GonkaCatalogManifest, GonkaIntentCandidate } from "@/lib/gonka/types";

const MIST_PER_SUI = 1_000_000_000n;

/** Safe rejection reason enum. Never echoes raw provider error text. */
export type GonkaResolveRejectionReason =
  | "unknown_item"
  | "unknown_merchant"
  | "item_merchant_mismatch"
  | "invalid_quantity"
  | "invalid_max_spend"
  | "price_ceiling_exceeded";

export interface GonkaResolveOk {
  ok: true;
  preview: PurchaseIntentPreview;
}

export interface GonkaResolveErr {
  ok: false;
  reason: GonkaResolveRejectionReason;
  message: string;
}

export type GonkaResolveResult = GonkaResolveOk | GonkaResolveErr;

/** Format a MIST string as a human-readable SUI amount (trailing zeros trimmed). */
function mistToSui(mist: string): string {
  const n = BigInt(mist);
  const sui = n / MIST_PER_SUI;
  const frac = n % MIST_PER_SUI;
  if (frac === 0n) return sui.toString();
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${sui.toString()}.${fracStr}`;
}

/** Parse a decimal SUI string into an exact MIST string, or null if malformed. */
function suiToMist(suiStr: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(suiStr)) return null;
  const [intPart, fracPart = ""] = suiStr.split(".");
  const fracPadded = (fracPart + "000000000").slice(0, 9);
  return BigInt(intPart + fracPadded).toString();
}

/**
 * Build a bounded public catalog manifest from the current catalog.
 *
 * Carries ONLY public item/merchant names and prices — no wallet addresses,
 * no keys, no transaction authority. This is the only catalog shape the model
 * is allowed to see.
 */
export function buildGonkaCatalogManifest(catalog: Catalog = getCatalog()): GonkaCatalogManifest {
  const items: GonkaCatalogManifest["items"] = [];
  const merchants: GonkaCatalogManifest["merchants"] = [];
  for (const merchant of catalog.merchants) {
    const itemIds: string[] = [];
    for (const item of merchant.items) {
      itemIds.push(item.id);
      items.push({ id: item.id, name: item.name, priceSui: mistToSui(item.priceMist) });
    }
    merchants.push({ id: merchant.id, name: merchant.name, itemIds });
  }
  return { merchants, items };
}

/**
 * Deterministically resolve an untrusted Gonka candidate against catalog truth.
 *
 * Returns a `PurchaseIntentPreview` (the same shape the deterministic parser
 * emits) on success, or a structured rejection with a safe reason enum on any
 * policy violation. Never produces transaction bytes, recipients, digests, or
 * signatures. The candidate's `confidence` is preserved on the preview; the
 * candidate's `maxSpendSui` becomes the preview's `priceCeilingMist`.
 */
export function resolveGonkaCandidate(
  candidate: GonkaIntentCandidate,
  catalog: Catalog = getCatalog(),
): GonkaResolveResult {
  // Quantity: schema already enforces 1..MAX_QUANTITY, but defend in depth.
  if (!Number.isInteger(candidate.quantity) || candidate.quantity < 1) {
    return {
      ok: false,
      reason: "invalid_quantity",
      message: "Candidate quantity must be a positive integer.",
    };
  }

  // Find the item across all merchants (an item id is unique within the catalog).
  let item: CatalogItem | null = null;
  let itemMerchant: CatalogMerchant | null = null;
  for (const merchant of catalog.merchants) {
    const found = merchant.items.find((it) => it.id === candidate.itemId);
    if (found) {
      item = found;
      itemMerchant = merchant;
      break;
    }
  }
  if (!item || !itemMerchant) {
    return {
      ok: false,
      reason: "unknown_item",
      message: "Candidate itemId is not present in the catalog.",
    };
  }

  // Find the merchant.
  const merchant = catalog.merchants.find((m) => m.id === candidate.merchantId) ?? null;
  if (!merchant) {
    return {
      ok: false,
      reason: "unknown_merchant",
      message: "Candidate merchantId is not present in the catalog.",
    };
  }

  // Merchant-item relation: the matched item must be sold by the matched merchant.
  if (merchant.id !== itemMerchant.id) {
    return {
      ok: false,
      reason: "item_merchant_mismatch",
      message: "The candidate item is not sold by the candidate merchant.",
    };
  }

  // maxSpendSui cap: must be a valid decimal SUI string.
  const maxSpendMist = suiToMist(candidate.maxSpendSui);
  if (maxSpendMist === null) {
    return {
      ok: false,
      reason: "invalid_max_spend",
      message: "Candidate maxSpendSui is not a valid decimal SUI string.",
    };
  }

  // Total = quantity * catalog unit price (catalog truth, not model truth).
  const unitPriceMist = item.priceMist;
  const totalMist = (BigInt(candidate.quantity) * BigInt(unitPriceMist)).toString();
  if (BigInt(totalMist) > BigInt(maxSpendMist)) {
    return {
      ok: false,
      reason: "price_ceiling_exceeded",
      message: "Candidate total exceeds the candidate maxSpendSui cap.",
    };
  }

  const preview: PurchaseIntentPreview = {
    kind: "preview",
    action: "buy",
    item: { id: item.id, name: item.name },
    quantity: candidate.quantity,
    unitPriceMist,
    totalMist,
    priceCeilingMist: maxSpendMist,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      address: merchant.address,
    },
    confidence: candidate.confidence,
    clarification: null,
  };
  return { ok: true, preview };
}
