/**
 * Reference pharmacy-network adapter — fictional, deterministic, no network.
 *
 * Truth boundary (same as the contract in `network.ts`):
 *  - The three sites below are FICTIONAL. Ids use the reserved `phx-ref-`
 *    prefix so they are unmistakably non-real in code. Display names use
 *    normal customer language; this adapter and the README disclose reference
 *    status. Provenance `kind: reference` is the binding trust signal, not the
 *    display name.
 *  - `provenance.kind` is `reference`. It can demonstrate software behavior
 *    only and is never licensed, live, verified, integrated, or participating.
 *  - No network calls, no retries, no floats, no URLs/keys/secrets, no patient
 *    health data. The order resolver is a pure deterministic map lookup.
 *  - Resolving an order NEVER authenticates a medicine, validates a
 *    prescription, provides medical advice, or authorizes release/payment.
 */

import {
  type OrderReference,
  type OrderResolveRequest,
  type OrderResolveResult,
  type PharmacyProvenance,
  type PharmacyResolveResult,
  type PharmacySearchQuery,
  type PharmacySearchResult,
  type PharmacySite,
  type PickupWindow,
  type PharmacyNetworkProvider,
  abortReason,
  enforceResultCap,
  expectedAmountsEqual,
  normalizeLocationLabel,
  normalizePharmacyId,
  parseOrderResolveRequest,
  parseSearchQuery,
  PharmacyIdSchema,
  pickupWindowStatus,
  pickupWindowsEqual,
} from "./network";

/** Shared provenance for every site/order returned by this adapter. */
export const REFERENCE_PROVENANCE: PharmacyProvenance = Object.freeze({
  kind: "reference",
  sourceLabel: "Convey reference network",
  disclosedAt: null,
});

/** Fixed "now" used by the deterministic resolver. */
export const REFERENCE_DEFAULT_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z

// ---------------------------------------------------------------------------
// Fictional sites (deterministic, in-memory)
// ---------------------------------------------------------------------------

function freezeSite(site: PharmacySite): PharmacySite {
  Object.freeze(site.coverage);
  Object.freeze(site.pickupWindow);
  return Object.freeze(site);
}

const SITE_MARITES: PharmacySite = freezeSite({
  id: "phx-ref-marites01",
  displayName: "Marites Pharmacy",
  role: "pickup",
  coverage: { country: "PH", city: "Manila" },
  pickupWindow: { opensAt: 1_700_000_000_000, closesAt: 1_700_008_640_000 },
  provenance: REFERENCE_PROVENANCE,
});

const SITE_BAYANI: PharmacySite = freezeSite({
  id: "phx-ref-bayani04",
  displayName: "Bayani Drugstore",
  role: "fulfillment",
  coverage: { country: "PH", city: "Cebu" },
  pickupWindow: { opensAt: 1_700_000_000_000, closesAt: 1_700_017_280_000 },
  provenance: REFERENCE_PROVENANCE,
});

const SITE_LAKAMBINI: PharmacySite = freezeSite({
  id: "phx-ref-lakambini07",
  displayName: "Lakambini Apothecary",
  role: "delivery",
  coverage: { country: "PH", city: "Davao" },
  pickupWindow: { opensAt: 1_700_000_000_000, closesAt: 1_700_025_920_000 },
  provenance: REFERENCE_PROVENANCE,
});

const SITES: readonly PharmacySite[] = Object.freeze([
  SITE_MARITES,
  SITE_BAYANI,
  SITE_LAKAMBINI,
]);

// ---------------------------------------------------------------------------
// Deterministic order map
// ---------------------------------------------------------------------------

interface StoredOrder {
  readonly pharmacyId: string;
  readonly orderRef: string;
  readonly beneficiaryRefDigest: string;
  readonly pickupWindow: PickupWindow;
  readonly expectedAmount: { currency: string; amountMinor: string } | null;
}

function freezeStoredOrder(order: StoredOrder): StoredOrder {
  Object.freeze(order.pickupWindow);
  if (order.expectedAmount !== null) Object.freeze(order.expectedAmount);
  return Object.freeze(order);
}

/**
 * Three deterministic orders, one per site. Beneficiary digests are fictional
 * blake2b256-shaped tokens (0x + 64 hex) — not real beneficiary references and
 * not patient health data.
 */
const ORDERS: readonly StoredOrder[] = Object.freeze([
  freezeStoredOrder({
    pharmacyId: "phx-ref-marites01",
    orderRef: "ORD-MARITES01",
    beneficiaryRefDigest:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pickupWindow: SITE_MARITES.pickupWindow,
    expectedAmount: { currency: "PHP", amountMinor: "1250" },
  }),
  freezeStoredOrder({
    pharmacyId: "phx-ref-bayani04",
    orderRef: "ORD-BAYANI0004",
    beneficiaryRefDigest:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    pickupWindow: SITE_BAYANI.pickupWindow,
    expectedAmount: { currency: "PHP", amountMinor: "8400" },
  }),
  freezeStoredOrder({
    pharmacyId: "phx-ref-lakambini07",
    orderRef: "ORD-LAKAMBINI7",
    beneficiaryRefDigest:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    pickupWindow: SITE_LAKAMBINI.pickupWindow,
    expectedAmount: null,
  }),
  // Two boundary orders under existing sites: one already closed, one not yet
  // open, relative to REFERENCE_DEFAULT_NOW. Used to exercise the
  // pickup_expired / pickup_not_yet_valid terminal branches through the
  // adapter. Still fictional, still reference provenance.
  freezeStoredOrder({
    pharmacyId: "phx-ref-marites01",
    orderRef: "ORD-EXPIRED0001",
    beneficiaryRefDigest:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    pickupWindow: { opensAt: 1_699_000_000_000, closesAt: 1_699_500_000_000 },
    expectedAmount: null,
  }),
  freezeStoredOrder({
    pharmacyId: "phx-ref-bayani04",
    orderRef: "ORD-FUTURE0001",
    beneficiaryRefDigest:
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    pickupWindow: { opensAt: 1_701_000_000_000, closesAt: 1_701_500_000_000 },
    expectedAmount: null,
  }),
]);

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Reference pharmacy-network provider. Pure, deterministic, no network.
 * Construct via `createReferencePharmacyProvider()`; the class form keeps the
 * `provenance` field readonly and prevents callers from passing their own.
 */
export class ReferencePharmacyProvider implements PharmacyNetworkProvider {
  readonly provenance: PharmacyProvenance = REFERENCE_PROVENANCE;

  async searchSites(
    query: PharmacySearchQuery,
    signal?: AbortSignal,
  ): Promise<PharmacySearchResult> {
    const cancelled = abortReason(signal);
    if (cancelled) return { ok: false, reason: cancelled };

    const parsed = parseSearchQuery(query);
    if (!parsed.ok) return { ok: false, reason: "malformed_query" };
    const q = parsed.query;

    const city = normalizeLocationLabel(q.city);
    const matched: PharmacySite[] = [];
    for (const site of SITES) {
      if (
        site.coverage.country === q.country &&
        normalizeLocationLabel(site.coverage.city) === city &&
        (q.role === undefined || site.role === q.role)
      ) {
        matched.push(site);
      }
    }
    if (matched.length === 0) return { ok: false, reason: "no_match" };
    const capped = enforceResultCap(matched);
    if (!capped.ok) return { ok: false, reason: capped.reason };
    return { ok: true, sites: capped.sites };
  }

  async resolvePharmacy(
    id: string,
    signal?: AbortSignal,
  ): Promise<PharmacyResolveResult> {
    const cancelled = abortReason(signal);
    if (cancelled) return { ok: false, reason: cancelled };

    const normalized = normalizePharmacyId(id);
    // Re-validate the canonical shape so a malformed id fails closed even
    // though normalization trimmed it. PharmacyIdSchema is the single
    // validation authority.
    if (!PharmacyIdSchema.safeParse(normalized).success) {
      return { ok: false, reason: "malformed_id" };
    }

    for (const site of SITES) {
      if (site.id === normalized) return { ok: true, site };
    }
    return { ok: false, reason: "unknown_pharmacy" };
  }

  async resolveOrder(
    request: OrderResolveRequest,
    signal?: AbortSignal,
  ): Promise<OrderResolveResult> {
    const cancelled = abortReason(signal);
    if (cancelled) return { ok: false, reason: cancelled };

    const parsed = parseOrderResolveRequest(request);
    if (!parsed.ok) return { ok: false, reason: "malformed_request" };
    const req = parsed.request;

    // 1. Pharmacy must exist.
    const site = SITES.find((s) => s.id === req.pharmacyId);
    if (!site) return { ok: false, reason: "unknown_pharmacy" };

    // 2. Order reference must exist.
    const stored = ORDERS.find((o) => o.orderRef === req.orderRef);
    if (!stored) return { ok: false, reason: "unknown_order" };

    // 3. Order must belong to the requested pharmacy.
    if (stored.pharmacyId !== req.pharmacyId) {
      return { ok: false, reason: "pharmacy_mismatch" };
    }

    // 4. Beneficiary digest must match exactly.
    if (stored.beneficiaryRefDigest !== req.beneficiaryRefDigest) {
      return { ok: false, reason: "beneficiary_mismatch" };
    }

    // 5. Pickup window must bind exactly.
    if (!pickupWindowsEqual(stored.pickupWindow, req.pickupWindow)) {
      return { ok: false, reason: "pickup_mismatch" };
    }

    // 6. Pickup window must be valid against now.
    const now = REFERENCE_DEFAULT_NOW;
    const status = pickupWindowStatus(req.pickupWindow, now);
    if (status === "pickup_expired") return { ok: false, reason: "pickup_expired" };
    if (status === "pickup_not_yet_valid") {
      return { ok: false, reason: "pickup_not_yet_valid" };
    }

    // 7. Expected amount binding: present-present exact match, or both absent.
    if (stored.expectedAmount === null && req.expectedAmount !== null) {
      return { ok: false, reason: "unexpected_amount" };
    }
    if (stored.expectedAmount !== null && req.expectedAmount === null) {
      return { ok: false, reason: "amount_mismatch" };
    }
    if (
      stored.expectedAmount !== null &&
      req.expectedAmount !== null &&
      !expectedAmountsEqual(stored.expectedAmount, req.expectedAmount)
    ) {
      // Distinguish currency vs amount for clear terminal behavior.
      if (stored.expectedAmount.currency !== req.expectedAmount.currency) {
        return { ok: false, reason: "currency_mismatch" };
      }
      return { ok: false, reason: "amount_mismatch" };
    }

    const order: OrderReference = {
      pharmacyId: stored.pharmacyId,
      orderRef: stored.orderRef,
      beneficiaryRefDigest: stored.beneficiaryRefDigest,
      pickupWindow: stored.pickupWindow,
      expectedAmount: stored.expectedAmount,
      provenance: REFERENCE_PROVENANCE,
    };
    return { ok: true, order };
  }
}

/** Construct the reference provider. Provenance is fixed; callers pass nothing. */
export function createReferencePharmacyProvider(): ReferencePharmacyProvider {
  return new ReferencePharmacyProvider();
}

/** All fictional site ids, for tests and disclosure. Not for product UI. */
export const REFERENCE_SITE_IDS: readonly string[] = SITES.map((s) => s.id);

/** All fictional order refs, for tests and disclosure. Not for product UI. */
export const REFERENCE_ORDER_REFS: readonly string[] = ORDERS.map((o) => o.orderRef);
