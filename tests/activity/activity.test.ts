import { describe, expect, it } from "vitest";
import {
  ActivityItemSchema,
  parseActivityStore,
  sortActivityItems,
  upsertActivityItem,
  validateActivityItem,
} from "@/lib/activity/activity";
import { ACTIVITY_STORE_VERSION } from "@/lib/activity/types";
import type { ActivityItem } from "@/lib/activity/types";

const baseItem: ActivityItem = {
  id: "abc",
  href: "/proof?r=AA",
  title: "Send to Ana",
  amountLabel: "100 USDC",
  detailLabel: "MYR to PHP",
  nextOwner: "Ana",
  updatedAt: "2026-08-31T12:00:00.000Z",
};

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return { ...baseItem, ...overrides };
}

describe("ActivityItemSchema", () => {
  it("accepts a valid item", () => {
    expect(ActivityItemSchema.safeParse(baseItem).success).toBe(true);
  });

  it("rejects extra fields", () => {
    const result = ActivityItemSchema.safeParse({ ...baseItem, extra: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO updatedAt", () => {
    expect(validateActivityItem(item({ updatedAt: "31 Aug 2026" }))).toBeNull();
  });

  it("rejects control characters in covered fields", () => {
    expect(validateActivityItem(item({ title: "bad\u0007char" }))).toBeNull();
    expect(validateActivityItem(item({ title: "bad\u007fchar" }))).toBeNull();
  });

  it("measures bounds in code points, not UTF-16 units", () => {
    // 1 code point outside BMP = 2 UTF-16 units. A 64-cp string of surrogates
    // must pass the 120-cp title bound but is 128 UTF-16 units.
    const cp = "𝟙".repeat(64);
    expect(Array.from(cp).length).toBe(64);
    expect(validateActivityItem(item({ title: cp }))).not.toBeNull();
    // 121 code points exceeds the 120-cp bound even though it is 242 UTF-16 units.
    const over = "𝟙".repeat(121);
    expect(validateActivityItem(item({ title: over }))).toBeNull();
  });
});

describe("Activity href boundary", () => {
  it("accepts each allowed query key", () => {
    for (const key of ["r", "c", "t", "o", "p"] as const) {
      expect(validateActivityItem(item({ href: `/proof?${key}=AA` }))).not.toBeNull();
    }
  });

  it("rejects unknown query key", () => {
    expect(validateActivityItem(item({ href: "/proof?x=AA" }))).toBeNull();
  });

  it("rejects origin/absolute URL", () => {
    expect(validateActivityItem(item({ href: "https://evil.example/proof?r=AA" }))).toBeNull();
  });

  it("rejects protocol-relative URL", () => {
    expect(validateActivityItem(item({ href: "//evil.example/proof?r=AA" }))).toBeNull();
  });

  it("rejects fragment", () => {
    expect(validateActivityItem(item({ href: "/proof?r=AA#x" }))).toBeNull();
  });

  it("rejects credentials", () => {
    expect(validateActivityItem(item({ href: "/proof?r=user:pass@AA" }))).toBeNull();
  });

  it("rejects non-base64url payload characters", () => {
    expect(validateActivityItem(item({ href: "/proof?r=A+B" }))).toBeNull();
    expect(validateActivityItem(item({ href: "/proof?r=A/B" }))).toBeNull();
  });

  it("rejects empty payload", () => {
    expect(validateActivityItem(item({ href: "/proof?r=" }))).toBeNull();
  });

  it("rejects other paths", () => {
    expect(validateActivityItem(item({ href: "/strategy?r=AA" }))).toBeNull();
  });
});

describe("parseActivityStore", () => {
  it("returns empty on non-string", () => {
    expect(parseActivityStore(null).items).toEqual([]);
    expect(parseActivityStore(undefined).items).toEqual([]);
    expect(parseActivityStore(123).items).toEqual([]);
  });

  it("returns empty on empty string", () => {
    expect(parseActivityStore("").items).toEqual([]);
  });

  it("returns empty on malformed JSON", () => {
    expect(parseActivityStore("{not json").items).toEqual([]);
  });

  it("returns empty on wrong version", () => {
    const raw = JSON.stringify({ version: 99, items: [baseItem] });
    expect(parseActivityStore(raw).items).toEqual([]);
  });

  it("returns empty on schema violation", () => {
    const raw = JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [{ bad: 1 }] });
    expect(parseActivityStore(raw).items).toEqual([]);
  });

  it("returns empty on unsafe href in stored item", () => {
    const raw = JSON.stringify({
      version: ACTIVITY_STORE_VERSION,
      items: [{ ...baseItem, href: "https://evil.example/proof?r=AA" }],
    });
    expect(parseActivityStore(raw).items).toEqual([]);
  });

  it("returns empty on extra envelope field", () => {
    const raw = JSON.stringify({
      version: ACTIVITY_STORE_VERSION,
      items: [],
      extra: 1,
    });
    expect(parseActivityStore(raw).items).toEqual([]);
  });

  it("returns items on valid envelope", () => {
    const raw = JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [baseItem] });
    const parsed = parseActivityStore(raw);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toEqual(baseItem);
  });

});

describe("upsertActivityItem", () => {
  it("inserts a valid item and returns it", () => {
    const { items, item: out } = upsertActivityItem([], baseItem);
    expect(out).toEqual(baseItem);
    expect(items).toEqual([baseItem]);
  });

  it("rejects an invalid candidate and leaves the list unchanged", () => {
    const { items, item: out } = upsertActivityItem([baseItem], { bad: 1 });
    expect(out).toBeNull();
    expect(items).toEqual([baseItem]);
  });

  it("replaces an existing id, not a second record", () => {
    const replacement = item({ id: "abc", title: "Updated" });
    const { items, item: out } = upsertActivityItem([baseItem], replacement);
    expect(out).toEqual(replacement);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(replacement);
  });

  it("keeps newest 20 after 21 inserts", () => {
    let items: ActivityItem[] = [];
    for (let i = 0; i < 21; i++) {
      const result = upsertActivityItem(items, item({
        id: `id-${i}`,
        updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      }));
      items = result.items;
    }
    expect(items).toHaveLength(20);
    // Newest (i=20) first; oldest (i=0) dropped.
    expect(items[0]!.id).toBe("id-20");
    expect(items.find((x) => x.id === "id-0")).toBeUndefined();
  });

  it("sorts newest updatedAt first", () => {
    const older = item({ id: "old", updatedAt: "2026-08-31T10:00:00.000Z" });
    const newer = item({ id: "new", updatedAt: "2026-08-31T12:00:00.000Z" });
    const { items } = upsertActivityItem([older], newer);
    expect(items[0]!.id).toBe("new");
    expect(items[1]!.id).toBe("old");
  });

  it("breaks equal-updatedAt ties by ascending id deterministically", () => {
    const at = "2026-08-31T12:00:00.000Z";
    const b = item({ id: "b", updatedAt: at });
    const a = item({ id: "a", updatedAt: at });
    const c = item({ id: "c", updatedAt: at });
    let items: ActivityItem[] = [];
    for (const it of [c, a, b]) items = upsertActivityItem(items, it).items;
    expect(items.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("orders mixed timestamp precision by actual time", () => {
    const older = item({ id: "older", updatedAt: "2026-08-31T12:00:00Z" });
    const newer = item({ id: "newer", updatedAt: "2026-08-31T12:00:00.100Z" });
    expect(sortActivityItems([older, newer]).map((entry) => entry.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("does not mutate the input array", () => {
    const input: ActivityItem[] = [baseItem];
    upsertActivityItem(input, item({ id: "zzz", updatedAt: "2026-08-31T13:00:00.000Z" }));
    expect(input).toEqual([baseItem]);
  });
});

describe("sortActivityItems", () => {
  it("is a pure function and returns a new array", () => {
    const input: ActivityItem[] = [baseItem];
    const sorted = sortActivityItems(input);
    expect(sorted).not.toBe(input);
    expect(sorted).toEqual(input);
  });
});
