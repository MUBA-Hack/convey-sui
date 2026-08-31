/**
 * Pharmacy-network domain boundary — provider-replaceable lookup contract.
 *
 * Truth boundary (enforced here, never weakened by an adapter):
 *  - A provider response NEVER authenticates a medicine, validates a
 *    prescription, provides medical advice, or authorizes release/payment.
 *  - `reference` provenance can demonstrate software behavior only. It cannot
 *    be described as licensed, live, verified, integrated, or participating.
 *    Provenance is owned by the provider instance; caller data cannot upgrade
 *    `reference` to `partner`.
 *  - No URLs, keys, secrets, or patient health data cross this boundary.
 *  - Money is integer minor-unit strings; no floats. Strings/collections are
 *    bounded. All provider ops are async, AbortSignal-aware, capped at
 *    MAX_SEARCH_RESULTS, and perform no hidden retries.
 *
 * This module defines the contract and pure helpers only. A concrete adapter
 * lives in `reference-network.ts`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Hard cap on search result size. Adapters must not return more than this. */
export const MAX_SEARCH_RESULTS = 20;

/** Maximum supported display-name length. */
export const PHARMACY_DISPLAY_NAME_MAX = 80;

/** Maximum source-label length for provenance. */
export const PROVENANCE_SOURCE_LABEL_MAX = 80;

// ---------------------------------------------------------------------------
// Canonical field schemas (strict, bounded, no passthrough)
// ---------------------------------------------------------------------------

/**
 * Pharmacy id. Canonical form is lowercase `phx-<slug>` where slug is 6..20
 * lowercase alphanumerics. Reference adapters use the reserved `phx-ref-`
 * prefix so ids are unmistakably non-real in code; partner ids use `phx-ptn-`.
 * The prefix is structural and validated, so a caller cannot mint a partner id.
 */
export const PharmacyIdSchema = z
  .string()
  .regex(/^phx-(ref|ptn)-[a-z0-9]{6,20}$/);

/** ISO-3166 alpha-2 country code, uppercased. */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** Bounded city label: letter-led, limited punctuation, max 40 chars. */
export const CityLabelSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z .'\-]{0,39}$/);

/** Bounded pharmacy role enum. */
export const PharmacyRoleSchema = z.enum(["fulfillment", "pickup", "delivery"]);

/** ISO-4217 currency code, uppercased. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** Non-negative integer minor-unit amount string, bounded length. */
export const MinorAmountStringSchema = z.string().regex(/^\d{1,18}$/);

/**
 * Beneficiary reference digest/token. A blake2b256 hex digest (0x + 64 hex)
 * binding the order to a beneficiary reference. Never the raw beneficiary
 * reference, never patient health data.
 */
export const BeneficiaryRefDigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

/** Order reference. Canonical `ORD-<8..16 upper alnum>`. */
export const OrderRefSchema = z.string().regex(/^ORD-[A-Z0-9]{8,16}$/);

/** Pickup window: integer epoch-ms, closes strictly after opens. */
export const PickupWindowSchema = z
  .strictObject({
    opensAt: z.number().int().finite().safe(),
    closesAt: z.number().int().finite().safe(),
  })
  .refine((w) => w.closesAt > w.opensAt, {
    message: "closesAt must be strictly after opensAt",
  });

/** Provider provenance. `kind` is the trust boundary; callers cannot set it. */
export const PharmacyProvenanceSchema = z.strictObject({
  kind: z.enum(["reference", "partner"]),
  sourceLabel: z.string().min(1).max(PROVENANCE_SOURCE_LABEL_MAX),
  /** Epoch-ms when the provider data was disclosed, if known. */
  disclosedAt: z.number().int().finite().safe().nullable(),
});

/** Coverage region: exact country + city. */
export const CoverageRegionSchema = z.strictObject({
  country: CountryCodeSchema,
  city: CityLabelSchema,
});

/** A single pharmacy site. */
export const PharmacySiteSchema = z.strictObject({
  id: PharmacyIdSchema,
  displayName: z.string().min(1).max(PHARMACY_DISPLAY_NAME_MAX),
  role: PharmacyRoleSchema,
  coverage: CoverageRegionSchema,
  pickupWindow: PickupWindowSchema,
  provenance: PharmacyProvenanceSchema,
});

/** Expected amount binding on an order, when present. */
export const ExpectedAmountSchema = z.strictObject({
  currency: CurrencyCodeSchema,
  amountMinor: MinorAmountStringSchema,
});

/** A resolved order reference. */
export const OrderReferenceSchema = z.strictObject({
  pharmacyId: PharmacyIdSchema,
  orderRef: OrderRefSchema,
  beneficiaryRefDigest: BeneficiaryRefDigestSchema,
  pickupWindow: PickupWindowSchema,
  expectedAmount: ExpectedAmountSchema.nullable(),
  provenance: PharmacyProvenanceSchema,
});

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export type PharmacyId = z.infer<typeof PharmacyIdSchema>;
export type CountryCode = z.infer<typeof CountryCodeSchema>;
export type CityLabel = z.infer<typeof CityLabelSchema>;
export type PharmacyRole = z.infer<typeof PharmacyRoleSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type MinorAmountString = z.infer<typeof MinorAmountStringSchema>;
export type BeneficiaryRefDigest = z.infer<typeof BeneficiaryRefDigestSchema>;
export type OrderRef = z.infer<typeof OrderRefSchema>;
export type PickupWindow = z.infer<typeof PickupWindowSchema>;
export type PharmacyProvenance = z.infer<typeof PharmacyProvenanceSchema>;
export type CoverageRegion = z.infer<typeof CoverageRegionSchema>;
export type PharmacySite = z.infer<typeof PharmacySiteSchema>;
export type ExpectedAmount = z.infer<typeof ExpectedAmountSchema>;
export type OrderReference = z.infer<typeof OrderReferenceSchema>;

export type PharmacyProvenanceKind = PharmacyProvenance["kind"];

// ---------------------------------------------------------------------------
// Search / resolve request schemas
// ---------------------------------------------------------------------------

export const PharmacySearchQuerySchema = z.strictObject({
  country: CountryCodeSchema,
  city: CityLabelSchema,
  role: PharmacyRoleSchema.optional(),
});

export type PharmacySearchQuery = z.infer<typeof PharmacySearchQuerySchema>;

export const OrderResolveRequestSchema = z.strictObject({
  pharmacyId: PharmacyIdSchema,
  orderRef: OrderRefSchema,
  beneficiaryRefDigest: BeneficiaryRefDigestSchema,
  pickupWindow: PickupWindowSchema,
  expectedAmount: ExpectedAmountSchema.nullable(),
});

export type OrderResolveRequest = z.infer<typeof OrderResolveRequestSchema>;

// ---------------------------------------------------------------------------
// Result unions (fail-closed; one reason per branch)
// ---------------------------------------------------------------------------

export type PharmacySearchReason =
  | "cancelled"
  | "malformed_query"
  | "no_match"
  | "too_many_results";

export type PharmacySearchResult =
  | { ok: true; sites: PharmacySite[] }
  | { ok: false; reason: PharmacySearchReason };

export type PharmacyResolveReason =
  | "cancelled"
  | "malformed_id"
  | "unknown_pharmacy";

export type PharmacyResolveResult =
  | { ok: true; site: PharmacySite }
  | { ok: false; reason: PharmacyResolveReason };

export type OrderResolveReason =
  | "cancelled"
  | "malformed_request"
  | "unknown_pharmacy"
  | "unknown_order"
  | "pharmacy_mismatch"
  | "beneficiary_mismatch"
  | "pickup_mismatch"
  | "pickup_expired"
  | "pickup_not_yet_valid"
  | "amount_mismatch"
  | "currency_mismatch"
  | "unexpected_amount";

export type OrderResolveResult =
  | { ok: true; order: OrderReference }
  | { ok: false; reason: OrderResolveReason };

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Replaceable pharmacy-network provider. Implementations MUST:
 *  - honor `signal?.aborted` and return `{ ok: false, reason: "cancelled" }`;
 *  - never perform hidden retries;
 *  - never return more than `MAX_SEARCH_RESULTS` sites;
 *  - never authenticate a medicine, validate a prescription, give medical
 *    advice, or authorize release/payment;
 *  - bind their own `provenance` into every returned site/order so caller data
 *    cannot upgrade `reference` to `partner`.
 */
export interface PharmacyNetworkProvider {
  readonly provenance: PharmacyProvenance;
  searchSites(
    query: PharmacySearchQuery,
    signal?: AbortSignal,
  ): Promise<PharmacySearchResult>;
  resolvePharmacy(
    id: string,
    signal?: AbortSignal,
  ): Promise<PharmacyResolveResult>;
  resolveOrder(
    request: OrderResolveRequest,
    signal?: AbortSignal,
  ): Promise<OrderResolveResult>;
}

// ---------------------------------------------------------------------------
// Pure helpers (no network, no side effects)
// ---------------------------------------------------------------------------

const WHITESPACE_RUN = /\s+/g;

/** Trim + collapse internal whitespace. Pure, locale-independent. */
export function normalizeLocationLabel(raw: string): string {
  return raw.trim().replace(WHITESPACE_RUN, " ");
}

/** Trim + uppercase a country code. */
export function canonicalizeCountry(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Trim + lowercase a pharmacy id. */
export function normalizePharmacyId(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Strict pickup-window validity against `now`. Returns null when valid,
 * otherwise the exact terminal reason. `now` must be a safe integer.
 */
export function pickupWindowStatus(
  window: PickupWindow,
  now: number,
): "pickup_expired" | "pickup_not_yet_valid" | null {
  if (!Number.isSafeInteger(now)) return "pickup_not_yet_valid";
  if (now >= window.closesAt) return "pickup_expired";
  if (now < window.opensAt) return "pickup_not_yet_valid";
  return null;
}

/** True only when two pickup windows are exactly equal on both bounds. */
export function pickupWindowsEqual(
  a: PickupWindow,
  b: PickupWindow,
): boolean {
  return a.opensAt === b.opensAt && a.closesAt === b.closesAt;
}

/** True only when two expected amounts are exactly equal (currency + minor). */
export function expectedAmountsEqual(
  a: ExpectedAmount | null,
  b: ExpectedAmount | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/** AbortSignal helper — returns the cancelled reason when aborted, else null. */
export function abortReason(signal?: AbortSignal): "cancelled" | null {
  return signal?.aborted ? "cancelled" : null;
}

/**
 * Enforce the search result cap. Returns the trimmed list (<= cap) or a
 * `too_many_results` failure when an adapter violates the bound. Adapters
 * should trim before returning; this is the boundary's defensive check.
 */
export function enforceResultCap(
  sites: ReadonlyArray<PharmacySite>,
): { ok: true; sites: PharmacySite[] } | { ok: false; reason: "too_many_results" } {
  if (sites.length > MAX_SEARCH_RESULTS) {
    return { ok: false, reason: "too_many_results" };
  }
  return { ok: true, sites: sites.slice(0, MAX_SEARCH_RESULTS) };
}

/**
 * Parse a raw search query (e.g. from caller-provided plain values) into the
 * canonical strict shape. Returns the parsed query or a malformed failure.
 * Extra keys, bad country/city, or bad role fail closed.
 */
export function parseSearchQuery(
  raw: unknown,
): { ok: true; query: PharmacySearchQuery } | { ok: false; reason: "malformed_query" } {
  const parsed = PharmacySearchQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed_query" };
  return { ok: true, query: parsed.data };
}

/**
 * Parse a raw order-resolve request into the canonical strict shape. Returns
 * the parsed request or a malformed failure. Extra keys fail closed.
 */
export function parseOrderResolveRequest(
  raw: unknown,
): { ok: true; request: OrderResolveRequest } | { ok: false; reason: "malformed_request" } {
  const parsed = OrderResolveRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed_request" };
  return { ok: true, request: parsed.data };
}
