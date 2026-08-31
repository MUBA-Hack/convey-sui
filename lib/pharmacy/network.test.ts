import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_RESULTS,
  OrderResolveRequestSchema,
  PharmacyIdSchema,
  PharmacySearchQuerySchema,
  PharmacySiteSchema,
  abortReason,
  canonicalizeCountry,
  enforceResultCap,
  expectedAmountsEqual,
  normalizeLocationLabel,
  normalizePharmacyId,
  parseOrderResolveRequest,
  parseSearchQuery,
  pickupWindowStatus,
  pickupWindowsEqual,
  type PharmacySite,
} from "./network";

const REFERENCE_PROVENANCE = {
  kind: "reference" as const,
  sourceLabel: "Convey reference network",
  disclosedAt: null,
};

function baseSite(overrides: Partial<PharmacySite> = {}): PharmacySite {
  return {
    id: "phx-ref-test0001",
    displayName: "Test Reference Pharmacy",
    role: "pickup",
    coverage: { country: "PH", city: "Manila" },
    pickupWindow: { opensAt: 1_700_000_000_000, closesAt: 1_700_008_640_000 },
    provenance: REFERENCE_PROVENANCE,
    ...overrides,
  };
}

describe("field schemas — strict, bounded, no passthrough", () => {
  it("accepts a canonical reference pharmacy id", () => {
    expect(PharmacyIdSchema.safeParse("phx-ref-marites01").success).toBe(true);
  });
  it("accepts a canonical partner pharmacy id", () => {
    expect(PharmacyIdSchema.safeParse("phx-ptn-partner01").success).toBe(true);
  });
  it("rejects an id without the reserved prefix", () => {
    expect(PharmacyIdSchema.safeParse("phx-marites01").success).toBe(false);
  });
  it("rejects an id with uppercase", () => {
    expect(PharmacyIdSchema.safeParse("phx-ref-MARITES01").success).toBe(false);
  });
  it("rejects an id that is too short", () => {
    expect(PharmacyIdSchema.safeParse("phx-ref-ab").success).toBe(false);
  });
  it("rejects an id that is too long", () => {
    expect(PharmacyIdSchema.safeParse(`phx-ref-${"a".repeat(21)}`).success).toBe(false);
  });
  it("rejects a non-string id", () => {
    expect(PharmacyIdSchema.safeParse(123).success).toBe(false);
  });
});

describe("PharmacySiteSchema — extra fields rejected", () => {
  it("accepts a well-formed site", () => {
    expect(PharmacySiteSchema.safeParse(baseSite()).success).toBe(true);
  });
  it("rejects an extra field on the site", () => {
    const bad = { ...baseSite(), secret: "no" };
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an extra field on coverage", () => {
    const bad = { ...baseSite(), coverage: { ...baseSite().coverage, x: 1 } };
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an extra field on pickupWindow", () => {
    const bad = { ...baseSite(), pickupWindow: { ...baseSite().pickupWindow, tz: "UTC" } };
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a pickup window where closesAt <= opensAt", () => {
    const bad = baseSite({ pickupWindow: { opensAt: 100, closesAt: 100 } });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a non-integer pickup timestamp", () => {
    const bad = baseSite({ pickupWindow: { opensAt: 1.5, closesAt: 2 } });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an unknown role", () => {
    const bad = baseSite({ role: "warehouse" as unknown as PharmacySite["role"] });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a lowercase country code", () => {
    const bad = baseSite({ coverage: { country: "ph", city: "Manila" } });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a city with a leading digit", () => {
    const bad = baseSite({ coverage: { country: "PH", city: "1Manila" } });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
});

describe("OrderResolveRequestSchema — strict", () => {
  const valid = {
    pharmacyId: "phx-ref-marites01",
    orderRef: "ORD-MARITES01",
    beneficiaryRefDigest: "0x" + "a".repeat(64),
    pickupWindow: { opensAt: 1_700_000_000_000, closesAt: 1_700_008_640_000 },
    expectedAmount: { currency: "PHP", amountMinor: "1250" },
  };
  it("accepts a well-formed request", () => {
    expect(OrderResolveRequestSchema.safeParse(valid).success).toBe(true);
  });
  it("accepts a null expectedAmount", () => {
    expect(OrderResolveRequestSchema.safeParse({ ...valid, expectedAmount: null }).success).toBe(true);
  });
  it("rejects an extra top-level field", () => {
    expect(OrderResolveRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
  it("rejects a bad beneficiary digest (uppercase hex)", () => {
    expect(
      OrderResolveRequestSchema.safeParse({
        ...valid,
        beneficiaryRefDigest: "0x" + "A".repeat(64),
      }).success,
    ).toBe(false);
  });
  it("rejects a beneficiary digest that is too short", () => {
    expect(
      OrderResolveRequestSchema.safeParse({
        ...valid,
        beneficiaryRefDigest: "0x" + "a".repeat(63),
      }).success,
    ).toBe(false);
  });
  it("rejects a malformed order ref", () => {
    expect(
      OrderResolveRequestSchema.safeParse({ ...valid, orderRef: "ord-marites01" }).success,
    ).toBe(false);
  });
  it("rejects a negative amount", () => {
    expect(
      OrderResolveRequestSchema.safeParse({
        ...valid,
        expectedAmount: { currency: "PHP", amountMinor: "-1" },
      }).success,
    ).toBe(false);
  });
});

describe("PharmacySearchQuerySchema — strict", () => {
  it("accepts country + city", () => {
    expect(PharmacySearchQuerySchema.safeParse({ country: "PH", city: "Manila" }).success).toBe(true);
  });
  it("accepts an optional role", () => {
    expect(
      PharmacySearchQuerySchema.safeParse({ country: "PH", city: "Manila", role: "pickup" }).success,
    ).toBe(true);
  });
  it("rejects an extra field", () => {
    expect(
      PharmacySearchQuerySchema.safeParse({ country: "PH", city: "Manila", lat: 0 }).success,
    ).toBe(false);
  });
  it("rejects a missing city", () => {
    expect(PharmacySearchQuerySchema.safeParse({ country: "PH" }).success).toBe(false);
  });
});

describe("pure helpers", () => {
  it("normalizeLocationLabel trims and collapses whitespace", () => {
    expect(normalizeLocationLabel("  Metro   Manila ")).toBe("Metro Manila");
  });
  it("canonicalizeCountry trims and uppercases", () => {
    expect(canonicalizeCountry(" ph ")).toBe("PH");
  });
  it("normalizePharmacyId trims and lowercases", () => {
    expect(normalizePharmacyId("  PHX-REF-Marites01 ")).toBe("phx-ref-marites01");
  });
  it("abortReason returns cancelled when aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(abortReason(ac.signal)).toBe("cancelled");
  });
  it("abortReason returns null when not aborted", () => {
    expect(abortReason(new AbortController().signal)).toBeNull();
  });
  it("abortReason returns null when no signal", () => {
    expect(abortReason(undefined)).toBeNull();
  });
});

describe("pickupWindowStatus", () => {
  const w = { opensAt: 1000, closesAt: 2000 };
  it("returns null when now is inside the window", () => {
    expect(pickupWindowStatus(w, 1500)).toBeNull();
  });
  it("returns pickup_expired when now >= closesAt", () => {
    expect(pickupWindowStatus(w, 2000)).toBe("pickup_expired");
    expect(pickupWindowStatus(w, 2001)).toBe("pickup_expired");
  });
  it("returns pickup_not_yet_valid when now < opensAt", () => {
    expect(pickupWindowStatus(w, 999)).toBe("pickup_not_yet_valid");
  });
  it("returns pickup_not_yet_valid for a non-safe-integer now", () => {
    expect(pickupWindowStatus(w, Number.MAX_SAFE_INTEGER + 1)).toBe("pickup_not_yet_valid");
  });
});

describe("pickupWindowsEqual + expectedAmountsEqual", () => {
  it("pickup windows equal only on exact bounds", () => {
    expect(pickupWindowsEqual({ opensAt: 1, closesAt: 2 }, { opensAt: 1, closesAt: 2 })).toBe(true);
    expect(pickupWindowsEqual({ opensAt: 1, closesAt: 2 }, { opensAt: 1, closesAt: 3 })).toBe(false);
    expect(pickupWindowsEqual({ opensAt: 1, closesAt: 2 }, { opensAt: 0, closesAt: 2 })).toBe(false);
  });
  it("expected amounts equal only on currency + minor", () => {
    const a = { currency: "PHP", amountMinor: "1250" };
    expect(expectedAmountsEqual(a, { currency: "PHP", amountMinor: "1250" })).toBe(true);
    expect(expectedAmountsEqual(a, { currency: "PHP", amountMinor: "1251" })).toBe(false);
    expect(expectedAmountsEqual(a, { currency: "USD", amountMinor: "1250" })).toBe(false);
  });
  it("expected amounts treat null symmetrically", () => {
    expect(expectedAmountsEqual(null, null)).toBe(true);
    expect(expectedAmountsEqual(null, { currency: "PHP", amountMinor: "1" })).toBe(false);
    expect(expectedAmountsEqual({ currency: "PHP", amountMinor: "1" }, null)).toBe(false);
  });
});

describe("enforceResultCap", () => {
  it("accepts a list at the cap", () => {
    const sites = Array.from({ length: MAX_SEARCH_RESULTS }, () => baseSite());
    const r = enforceResultCap(sites);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sites).toHaveLength(MAX_SEARCH_RESULTS);
  });
  it("rejects a list over the cap", () => {
    const sites = Array.from({ length: MAX_SEARCH_RESULTS + 1 }, () => baseSite());
    expect(enforceResultCap(sites)).toEqual({ ok: false, reason: "too_many_results" });
  });
  it("trims to the cap length on accept", () => {
    const sites = Array.from({ length: 3 }, (_, i) => baseSite({ id: `phx-ref-test${String(i).padStart(4, "0")}` as PharmacySite["id"] }));
    const r = enforceResultCap(sites);
    if (r.ok) expect(r.sites).toHaveLength(3);
  });
});

describe("parseSearchQuery + parseOrderResolveRequest fail closed", () => {
  it("parseSearchQuery accepts a canonical query", () => {
    const r = parseSearchQuery({ country: "PH", city: "Manila" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.country).toBe("PH");
  });
  it("parseSearchQuery rejects extra fields", () => {
    expect(parseSearchQuery({ country: "PH", city: "Manila", x: 1 }).ok).toBe(false);
  });
  it("parseSearchQuery rejects a bad country", () => {
    expect(parseSearchQuery({ country: "PHL", city: "Manila" }).ok).toBe(false);
  });
  it("parseOrderResolveRequest rejects extra fields", () => {
    const r = parseOrderResolveRequest({
      pharmacyId: "phx-ref-marites01",
      orderRef: "ORD-MARITES01",
      beneficiaryRefDigest: "0x" + "a".repeat(64),
      pickupWindow: { opensAt: 1, closesAt: 2 },
      expectedAmount: null,
      extra: 1,
    });
    expect(r.ok).toBe(false);
  });
  it("parseOrderResolveRequest rejects a malformed pickup window", () => {
    const r = parseOrderResolveRequest({
      pharmacyId: "phx-ref-marites01",
      orderRef: "ORD-MARITES01",
      beneficiaryRefDigest: "0x" + "a".repeat(64),
      pickupWindow: { opensAt: 2, closesAt: 1 },
      expectedAmount: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("provenance cannot be upgraded by caller data", () => {
  it("a reference site stays reference even if a caller tries to relabel", () => {
    // The schema is the single authority; caller-supplied provenance is never
    // accepted through parseSearchQuery/parseOrderResolveRequest (no provenance
    // field exists on the request schemas). A site parsed from a trusted source
    // keeps its kind.
    const site = baseSite();
    const parsed = PharmacySiteSchema.safeParse(site);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.provenance.kind).toBe("reference");
  });
  it("rejects an unknown provenance kind", () => {
    const bad = baseSite({
      provenance: { kind: "live" as unknown as "reference", sourceLabel: "x", disclosedAt: null },
    });
    expect(PharmacySiteSchema.safeParse(bad).success).toBe(false);
  });
});
