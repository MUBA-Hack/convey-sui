import { describe, expect, it } from "vitest";
import {
  buildGonkaCatalogManifest,
  resolveGonkaCandidate,
  type GonkaResolveRejectionReason,
} from "@/lib/commerce/gonka-resolver";
import { getCatalog } from "@/lib/commerce/catalog";
import type { GonkaIntentCandidate } from "@/lib/gonka/types";

const GOLDEN = "Buy two iced coffees under 8 SUI from River Cafe";

/** A candidate that matches the golden prompt against catalog truth. */
function goldenCandidate(overrides: Partial<GonkaIntentCandidate> = {}): GonkaIntentCandidate {
  return {
    itemId: "iced-coffee",
    itemName: "Iced Coffee",
    merchantId: "river-cafe",
    merchantName: "River Cafe",
    quantity: 2,
    maxSpendSui: "8",
    detectedLanguage: "en",
    explanation: "User asked for two iced coffees from River Cafe.",
    confidence: 0.95,
    ...overrides,
  };
}

describe("buildGonkaCatalogManifest", () => {
  it("builds a bounded manifest with only public item/merchant names and prices", () => {
    const manifest = buildGonkaCatalogManifest(getCatalog());
    const serialized = JSON.stringify(manifest);
    // No addresses, no keys, no transaction authority.
    expect(serialized).not.toContain("address");
    expect(serialized).not.toContain("priceMist");
    expect(serialized.toLowerCase()).not.toContain("transactionbytes");
    expect(serialized.toLowerCase()).not.toContain("signature");
    // Every merchant carries its item ids; every item carries a priceSui.
    for (const merchant of manifest.merchants) {
      expect(merchant.itemIds.length).toBeGreaterThan(0);
    }
    for (const item of manifest.items) {
      expect(typeof item.priceSui).toBe("string");
      expect(item.priceSui.length).toBeGreaterThan(0);
    }
  });

  it("the manifest priceSui for iced-coffee is 3 (3 SUI = 3_000_000_000 MIST)", () => {
    const manifest = buildGonkaCatalogManifest(getCatalog());
    const iced = manifest.items.find((i) => i.id === "iced-coffee");
    expect(iced).toBeDefined();
    expect(iced!.priceSui).toBe("3");
  });

  it("the manifest priceSui for cold-brew is 1.5 (exact, no float drift)", () => {
    const manifest = buildGonkaCatalogManifest(getCatalog());
    const cold = manifest.items.find((i) => i.id === "cold-brew");
    expect(cold).toBeDefined();
    expect(cold!.priceSui).toBe("1.5");
  });
});

describe("resolveGonkaCandidate — golden candidate", () => {
  it("resolves a matching candidate to the same preview shape parseIntent emits", () => {
    const resolved = resolveGonkaCandidate(goldenCandidate(), getCatalog());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const preview = resolved.preview;
    expect(preview.kind).toBe("preview");
    expect(preview.action).toBe("buy");
    expect(preview.item.id).toBe("iced-coffee");
    expect(preview.item.name).toBe("Iced Coffee");
    expect(preview.quantity).toBe(2);
    expect(preview.merchant.id).toBe("river-cafe");
    expect(preview.merchant.name).toBe("River Cafe");
    // total = quantity * catalog unit price (catalog truth, not model truth)
    expect(BigInt(preview.totalMist)).toBe(
      BigInt(preview.quantity) * BigInt(preview.unitPriceMist),
    );
    expect(BigInt(preview.totalMist)).toBe(6_000_000_000n);
    // maxSpendSui becomes the price ceiling
    expect(preview.priceCeilingMist).toBe("8000000000");
    expect(BigInt(preview.totalMist) <= BigInt(preview.priceCeilingMist!)).toBe(true);
    // candidate confidence is preserved
    expect(preview.confidence).toBe(0.95);
    expect(preview.clarification).toBeNull();
  });

  it("never produces transaction bytes, recipients, digests, or signatures", () => {
    const resolved = resolveGonkaCandidate(goldenCandidate(), getCatalog());
    const json = JSON.stringify(resolved);
    expect(json).not.toContain("txBytes");
    expect(json).not.toContain("signature");
    expect(json).not.toContain("digest");
    expect(json).not.toContain("recipient");
    expect(json).not.toContain("transactionBytes");
  });
});

describe("resolveGonkaCandidate — rejections (fail closed)", () => {
  it("rejects an unknown itemId", () => {
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ itemId: "ghost-item", itemName: "Ghost" }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("unknown_item");
  });

  it("rejects an unknown merchantId", () => {
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ merchantId: "ghost-merchant", merchantName: "Ghost" }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("unknown_merchant");
  });

  it("rejects an item not sold by the matched merchant (item_merchant_mismatch)", () => {
    // croissant is sold by harbor-bakery, not river-cafe
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ itemId: "croissant", itemName: "Croissant" }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("item_merchant_mismatch");
  });

  it("rejects when the total exceeds the candidate maxSpendSui cap", () => {
    // 2 iced coffees = 6 SUI; cap of 5 SUI must reject
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ maxSpendSui: "5" }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("price_ceiling_exceeded");
  });

  it("rejects an invalid (non-decimal) maxSpendSui", () => {
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ maxSpendSui: "not-a-number" }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("invalid_max_spend");
  });

  it("rejects a non-positive quantity (defend in depth)", () => {
    const resolved = resolveGonkaCandidate(
      goldenCandidate({ quantity: 0 as unknown as number }),
      getCatalog(),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("invalid_quantity");
  });

  it("rejection messages never leak raw provider error text or secrets", () => {
    const reasons: GonkaResolveRejectionReason[] = [
      "unknown_item",
      "unknown_merchant",
      "item_merchant_mismatch",
      "invalid_quantity",
      "invalid_max_spend",
      "price_ceiling_exceeded",
    ];
    const cases: GonkaIntentCandidate[] = [
      goldenCandidate({ itemId: "ghost", itemName: "Ghost" }),
      goldenCandidate({ merchantId: "ghost", merchantName: "Ghost" }),
      goldenCandidate({ itemId: "croissant", itemName: "Croissant" }),
      goldenCandidate({ quantity: 0 as unknown as number }),
      goldenCandidate({ maxSpendSui: "bad" }),
      goldenCandidate({ maxSpendSui: "1" }),
    ];
    cases.forEach((c, i) => {
      const resolved = resolveGonkaCandidate(c, getCatalog());
      if (resolved.ok) throw new Error(`expected rejection for ${reasons[i]}`);
      const json = JSON.stringify(resolved);
      expect(json).not.toContain("api");
      expect(json).not.toContain("key");
      expect(json.toLowerCase()).not.toContain("secret");
    });
  });
});

describe("resolveGonkaCandidate — all three canned examples resolve", () => {
  it.each([
    {
      label: "Two iced coffees",
      candidate: goldenCandidate(),
      expectItem: "Iced Coffee",
      expectMerchant: "River Cafe",
      expectQuantity: 2,
      expectTotalMist: "6000000000",
    },
    {
      label: "Lunch bowl",
      candidate: goldenCandidate({
        itemId: "lunch-bowl",
        itemName: "Lunch Bowl",
        merchantId: "green-kitchen",
        merchantName: "Green Kitchen",
        quantity: 1,
        maxSpendSui: "12",
      }),
      expectItem: "Lunch Bowl",
      expectMerchant: "Green Kitchen",
      expectQuantity: 1,
      expectTotalMist: "9000000000",
    },
    {
      label: "Three cold brews",
      candidate: goldenCandidate({
        itemId: "cold-brew",
        itemName: "Cold Brew",
        merchantId: "daybreak-coffee",
        merchantName: "Daybreak Coffee",
        quantity: 3,
        maxSpendSui: "6",
      }),
      expectItem: "Cold Brew",
      expectMerchant: "Daybreak Coffee",
      expectQuantity: 3,
      expectTotalMist: "4500000000",
    },
  ])(
    "$label: candidate resolves to a preview matching the catalog truth",
    ({ candidate, expectItem, expectMerchant, expectQuantity, expectTotalMist }) => {
      const resolved = resolveGonkaCandidate(candidate, getCatalog());
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.preview.item.name).toBe(expectItem);
      expect(resolved.preview.merchant.name).toBe(expectMerchant);
      expect(resolved.preview.quantity).toBe(expectQuantity);
      expect(resolved.preview.totalMist).toBe(expectTotalMist);
    },
  );
});

// Guard: the golden prompt itself still resolves through the deterministic
// parser (no Gonka), proving the fallback path is intact and unchanged.
describe("deterministic fallback still resolves the golden prompt", () => {
  it("parseIntent(GOLDEN) is a preview (fallback path intact)", async () => {
    const { parseIntent } = await import("@/lib/commerce/intent");
    const result = parseIntent(GOLDEN);
    expect(result.kind).toBe("preview");
  });
});
