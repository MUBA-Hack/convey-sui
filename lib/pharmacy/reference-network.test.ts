import { describe, expect, it } from "vitest";
import {
  REFERENCE_DEFAULT_NOW,
  REFERENCE_ORDER_REFS,
  REFERENCE_PROVENANCE,
  REFERENCE_SITE_IDS,
  createReferencePharmacyProvider,
} from "./reference-network";
import type {
  OrderResolveRequest,
  PharmacySearchQuery,
} from "./network";

const provider = createReferencePharmacyProvider();

const MARITES_ID = "phx-ref-marites01";
const MARITES_ORDER = "ORD-MARITES01";
const MARITES_BENEFICIARY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MARITES_WINDOW = { opensAt: 1_700_000_000_000, closesAt: 1_700_008_640_000 };
const MARITES_AMOUNT = { currency: "PHP", amountMinor: "1250" };

const BAYANI_ID = "phx-ref-bayani04";
const BAYANI_ORDER = "ORD-BAYANI0004";

const LAKAMBINI_ID = "phx-ref-lakambini07";
const LAKAMBINI_ORDER = "ORD-LAKAMBINI7";
const LAKAMBINI_BENEFICIARY =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const LAKAMBINI_WINDOW = { opensAt: 1_700_000_000_000, closesAt: 1_700_025_920_000 };

function orderReq(overrides: Partial<OrderResolveRequest> = {}): OrderResolveRequest {
  return {
    pharmacyId: MARITES_ID,
    orderRef: MARITES_ORDER,
    beneficiaryRefDigest: MARITES_BENEFICIARY,
    pickupWindow: MARITES_WINDOW,
    expectedAmount: MARITES_AMOUNT,
    ...overrides,
  };
}

describe("reference provenance — fixed and non-upgradable", () => {
  it("provider provenance is reference", () => {
    expect(provider.provenance.kind).toBe("reference");
    expect(REFERENCE_PROVENANCE.kind).toBe("reference");
  });
  it("every returned site carries reference provenance", async () => {
    const r = await provider.searchSites({ country: "PH", city: "Manila" });
    expect(r.ok).toBe(true);
    if (r.ok) for (const s of r.sites) expect(s.provenance.kind).toBe("reference");
  });
  it("reference site ids all use the phx-ref- prefix", () => {
    for (const id of REFERENCE_SITE_IDS) expect(id.startsWith("phx-ref-")).toBe(true);
  });
  it("reference order refs all use the ORD- prefix", () => {
    for (const ref of REFERENCE_ORDER_REFS) expect(ref.startsWith("ORD-")).toBe(true);
  });
  it("reference display names are normal customer names without the word Reference", async () => {
    const expected: Record<string, string> = {
      "phx-ref-marites01": "Marites Pharmacy",
      "phx-ref-bayani04": "Bayani Drugstore",
      "phx-ref-lakambini07": "Lakambini Apothecary",
    };
    for (const id of REFERENCE_SITE_IDS) {
      const r = await provider.resolvePharmacy(id);
      if (r.ok) {
        expect(r.site.displayName).toBe(expected[id]);
        expect(r.site.displayName).not.toMatch(/Reference/);
      }
    }
  });
});

describe("searchSites — exact match, cap, cancellation", () => {
  it("returns the Manila pickup site for PH/Manila", async () => {
    const r = await provider.searchSites({ country: "PH", city: "Manila" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sites).toHaveLength(1);
      expect(r.sites[0]!.id).toBe(MARITES_ID);
    }
  });
  it("matches case-insensitively on city after normalization is not applied (caller must canonicalize)", async () => {
    // The adapter normalizes city labels by trimming + collapsing whitespace,
    // but does NOT lowercase. "manila" != "Manila" -> no_match. This keeps the
    // boundary strict: callers canonicalize, the adapter does not guess.
    const r = await provider.searchSites({ country: "PH", city: "manila" } as PharmacySearchQuery);
    expect(r).toEqual({ ok: false, reason: "no_match" });
  });
  it("matches with a role filter", async () => {
    const r = await provider.searchSites({ country: "PH", city: "Cebu", role: "fulfillment" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sites).toHaveLength(1);
      expect(r.sites[0]!.role).toBe("fulfillment");
    }
  });
  it("returns no_match for an unknown city", async () => {
    const r = await provider.searchSites({ country: "PH", city: "Quezon" });
    expect(r).toEqual({ ok: false, reason: "no_match" });
  });
  it("returns no_match for an unknown country", async () => {
    const r = await provider.searchSites({ country: "US", city: "Manila" });
    expect(r).toEqual({ ok: false, reason: "no_match" });
  });
  it("returns malformed_query for a bad country", async () => {
    const r = await provider.searchSites({ country: "PHL", city: "Manila" } as unknown as PharmacySearchQuery);
    expect(r).toEqual({ ok: false, reason: "malformed_query" });
  });
  it("returns cancelled when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await provider.searchSites({ country: "PH", city: "Manila" }, ac.signal);
    expect(r).toEqual({ ok: false, reason: "cancelled" });
  });
  it("never returns more than MAX_SEARCH_RESULTS", async () => {
    const r = await provider.searchSites({ country: "PH", city: "Manila" });
    if (r.ok) expect(r.sites.length).toBeLessThanOrEqual(20);
  });
});

describe("resolvePharmacy — exact id, cancellation, unknown, malformed", () => {
  it("resolves an exact reference id", async () => {
    const r = await provider.resolvePharmacy(MARITES_ID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.site.id).toBe(MARITES_ID);
  });
  it("resolves after trimming + lowercasing a caller id", async () => {
    const r = await provider.resolvePharmacy("  PHX-REF-Marites01 ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.site.id).toBe(MARITES_ID);
  });
  it("returns unknown_pharmacy for a well-formed but absent id", async () => {
    const r = await provider.resolvePharmacy("phx-ref-absent0001");
    expect(r).toEqual({ ok: false, reason: "unknown_pharmacy" });
  });
  it("returns malformed_id for a non-canonical id", async () => {
    const r = await provider.resolvePharmacy("marites01");
    expect(r).toEqual({ ok: false, reason: "malformed_id" });
  });
  it("returns malformed_id for a partner-prefixed id (no partner data here)", async () => {
    const r = await provider.resolvePharmacy("phx-ptn-partner01");
    expect(r).toEqual({ ok: false, reason: "unknown_pharmacy" });
  });
  it("returns cancelled when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await provider.resolvePharmacy(MARITES_ID, ac.signal);
    expect(r).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("resolveOrder — exact success", () => {
  it("resolves a fully-matching Marites order", async () => {
    const r = await provider.resolveOrder(orderReq());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.pharmacyId).toBe(MARITES_ID);
      expect(r.order.orderRef).toBe(MARITES_ORDER);
      expect(r.order.beneficiaryRefDigest).toBe(MARITES_BENEFICIARY);
      expect(r.order.pickupWindow).toEqual(MARITES_WINDOW);
      expect(r.order.expectedAmount).toEqual(MARITES_AMOUNT);
      expect(r.order.provenance.kind).toBe("reference");
    }
  });
  it("resolves a Lakambini order with no expected amount", async () => {
    const r = await provider.resolveOrder(
      orderReq({
        pharmacyId: LAKAMBINI_ID,
        orderRef: LAKAMBINI_ORDER,
        beneficiaryRefDigest: LAKAMBINI_BENEFICIARY,
        pickupWindow: LAKAMBINI_WINDOW,
        expectedAmount: null,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.expectedAmount).toBeNull();
  });
  it("returns cancelled when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await provider.resolveOrder(orderReq(), ac.signal);
    expect(r).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("resolveOrder — unknown pharmacy / order", () => {
  it("returns unknown_pharmacy when the pharmacy id is absent", async () => {
    const r = await provider.resolveOrder(orderReq({ pharmacyId: "phx-ref-absent0001" }));
    expect(r).toEqual({ ok: false, reason: "unknown_pharmacy" });
  });
  it("returns unknown_order when the order ref is absent", async () => {
    const r = await provider.resolveOrder(orderReq({ orderRef: "ORD-NOPE00001" }));
    expect(r).toEqual({ ok: false, reason: "unknown_order" });
  });
});

describe("resolveOrder — pharmacy mismatch", () => {
  it("returns pharmacy_mismatch when the order belongs to another pharmacy", async () => {
    // Bayani's order requested against Marites's pharmacy id.
    const r = await provider.resolveOrder(
      orderReq({ pharmacyId: MARITES_ID, orderRef: BAYANI_ORDER }),
    );
    expect(r).toEqual({ ok: false, reason: "pharmacy_mismatch" });
  });
});

describe("resolveOrder — beneficiary mismatch", () => {
  it("returns beneficiary_mismatch for a wrong digest", async () => {
    const r = await provider.resolveOrder(
      orderReq({ beneficiaryRefDigest: "0x" + "0".repeat(64) }),
    );
    expect(r).toEqual({ ok: false, reason: "beneficiary_mismatch" });
  });
});

describe("resolveOrder — pickup window binding + validity", () => {
  it("returns pickup_mismatch when the window bounds differ", async () => {
    const r = await provider.resolveOrder(
      orderReq({ pickupWindow: { opensAt: MARITES_WINDOW.opensAt, closesAt: MARITES_WINDOW.closesAt + 1 } }),
    );
    expect(r).toEqual({ ok: false, reason: "pickup_mismatch" });
  });
  it("returns pickup_expired for a stored order whose window is already closed", async () => {
    const expiredWindow = { opensAt: 1_699_000_000_000, closesAt: 1_699_500_000_000 };
    expect(REFERENCE_DEFAULT_NOW).toBeGreaterThan(expiredWindow.closesAt);
    const r = await provider.resolveOrder(
      orderReq({
        orderRef: "ORD-EXPIRED0001",
        beneficiaryRefDigest: "0x" + "d".repeat(64),
        pickupWindow: expiredWindow,
        expectedAmount: null,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "pickup_expired" });
  });
  it("returns pickup_not_yet_valid for a stored order whose window is not yet open", async () => {
    const futureWindow = { opensAt: 1_701_000_000_000, closesAt: 1_701_500_000_000 };
    expect(REFERENCE_DEFAULT_NOW).toBeLessThan(futureWindow.opensAt);
    const r = await provider.resolveOrder(
      orderReq({
        pharmacyId: BAYANI_ID,
        orderRef: "ORD-FUTURE0001",
        beneficiaryRefDigest: "0x" + "e".repeat(64),
        pickupWindow: futureWindow,
        expectedAmount: null,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "pickup_not_yet_valid" });
  });
});

describe("resolveOrder — amount / currency binding", () => {
  it("returns amount_mismatch when the minor amount differs", async () => {
    const r = await provider.resolveOrder(
      orderReq({ expectedAmount: { currency: "PHP", amountMinor: "1251" } }),
    );
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });
  it("returns currency_mismatch when the currency differs", async () => {
    const r = await provider.resolveOrder(
      orderReq({ expectedAmount: { currency: "USD", amountMinor: "1250" } }),
    );
    expect(r).toEqual({ ok: false, reason: "currency_mismatch" });
  });
  it("returns amount_mismatch when the order expects an amount but the request omits it", async () => {
    const r = await provider.resolveOrder(orderReq({ expectedAmount: null }));
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });
  it("returns unexpected_amount when the order expects no amount but the request carries one", async () => {
    const r = await provider.resolveOrder(
      orderReq({
        pharmacyId: LAKAMBINI_ID,
        orderRef: LAKAMBINI_ORDER,
        beneficiaryRefDigest: LAKAMBINI_BENEFICIARY,
        pickupWindow: LAKAMBINI_WINDOW,
        expectedAmount: { currency: "PHP", amountMinor: "1" },
      }),
    );
    expect(r).toEqual({ ok: false, reason: "unexpected_amount" });
  });
});

describe("resolveOrder — malformed / extra fields", () => {
  it("returns malformed_request for a non-string pharmacy id", async () => {
    const r = await provider.resolveOrder(orderReq({ pharmacyId: 123 as unknown as string }));
    expect(r).toEqual({ ok: false, reason: "malformed_request" });
  });
  it("returns malformed_request for an extra top-level field", async () => {
    const r = await provider.resolveOrder({ ...orderReq(), extra: 1 } as unknown as OrderResolveRequest);
    expect(r).toEqual({ ok: false, reason: "malformed_request" });
  });
  it("returns malformed_request for a bad beneficiary digest", async () => {
    const r = await provider.resolveOrder(
      orderReq({ beneficiaryRefDigest: "0x" + "a".repeat(63) }),
    );
    expect(r).toEqual({ ok: false, reason: "malformed_request" });
  });
});

describe("resolveOrder — no auth effects", () => {
  it("a resolved order carries no prescription, medicine, or release fields", async () => {
    const r = await provider.resolveOrder(orderReq());
    if (r.ok) {
      const keys = Object.keys(r.order).sort();
      expect(keys).toEqual(
        [
          "beneficiaryRefDigest",
          "expectedAmount",
          "orderRef",
          "pharmacyId",
          "pickupWindow",
          "provenance",
        ].sort(),
      );
    }
  });
});

describe("reference results — mutation isolation", () => {
  it("resolvePharmacy cannot mutate nested site fixtures", async () => {
    const first = await provider.resolvePharmacy(MARITES_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(Object.isFrozen(first.site.coverage)).toBe(true);
    expect(Object.isFrozen(first.site.pickupWindow)).toBe(true);
    expect(() => {
      (first.site.coverage as { city: string }).city = "Changed";
    }).toThrow(TypeError);
    expect(() => {
      (first.site.pickupWindow as { closesAt: number }).closesAt = 0;
    }).toThrow(TypeError);

    const again = await provider.resolvePharmacy(MARITES_ID);
    expect(again).toEqual(first);
  });

  it("searchSites cannot mutate site fixtures used by later searches", async () => {
    const first = await provider.searchSites({ country: "PH", city: "Manila" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(Object.isFrozen(first.sites[0]!.coverage)).toBe(true);
    expect(() => {
      (first.sites[0]!.coverage as { city: string }).city = "Changed";
    }).toThrow(TypeError);

    const again = await provider.searchSites({ country: "PH", city: "Manila" });
    expect(again).toEqual(first);
  });

  it("resolveOrder cannot mutate nested order fixtures", async () => {
    const first = await provider.resolveOrder(orderReq());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(Object.isFrozen(first.order.pickupWindow)).toBe(true);
    expect(Object.isFrozen(first.order.expectedAmount)).toBe(true);
    expect(() => {
      (first.order.pickupWindow as { closesAt: number }).closesAt = 0;
    }).toThrow(TypeError);
    expect(() => {
      (first.order.expectedAmount as { amountMinor: string }).amountMinor = "0";
    }).toThrow(TypeError);

    const again = await provider.resolveOrder(orderReq());
    expect(again).toEqual(first);
  });
});
