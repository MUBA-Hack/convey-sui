import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadActivity,
  recordActivity,
  type ActivityStorageBackend,
} from "@/lib/activity/storage";
import { ACTIVITY_STORE_KEY, ACTIVITY_STORE_VERSION } from "@/lib/activity/types";
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

function makeBackend(initial: string | null = null): ActivityStorageBackend & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  if (initial !== null) store.set(ACTIVITY_STORE_KEY, initial);
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("loadActivity", () => {
  it("returns [] when backend is null", () => {
    expect(loadActivity(null)).toEqual([]);
  });

  it("returns [] when key is missing", () => {
    expect(loadActivity(makeBackend())).toEqual([]);
  });

  it("returns [] on malformed stored JSON", () => {
    const backend = makeBackend("{not json");
    expect(loadActivity(backend)).toEqual([]);
  });

  it("returns [] on version mismatch", () => {
    const backend = makeBackend(JSON.stringify({ version: 99, items: [baseItem] }));
    expect(loadActivity(backend)).toEqual([]);
  });

  it("returns [] on unsafe href in stored item", () => {
    const backend = makeBackend(
      JSON.stringify({
        version: ACTIVITY_STORE_VERSION,
        items: [{ ...baseItem, href: "https://evil.example/proof?r=AA" }],
      }),
    );
    expect(loadActivity(backend)).toEqual([]);
  });

  it("returns items on valid storage", () => {
    const backend = makeBackend(
      JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [baseItem] }),
    );
    expect(loadActivity(backend)).toEqual([baseItem]);
  });

  it("sorts valid but out-of-order stored items newest-first", () => {
    const older = { ...baseItem, id: "old", updatedAt: "2026-08-31T10:00:00.000Z" };
    const newer = { ...baseItem, id: "new", updatedAt: "2026-08-31T12:00:00.000Z" };
    // Stored reversed (older first); load must return newest-first.
    const backend = makeBackend(
      JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [older, newer] }),
    );
    expect(loadActivity(backend).map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("breaks equal-timestamp ties by ascending id on load", () => {
    const at = "2026-08-31T12:00:00.000Z";
    const c = { ...baseItem, id: "c", updatedAt: at };
    const a = { ...baseItem, id: "a", updatedAt: at };
    const b = { ...baseItem, id: "b", updatedAt: at };
    // Stored in non-tie-break order; load must return a, b, c.
    const backend = makeBackend(
      JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [c, a, b] }),
    );
    expect(loadActivity(backend).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns [] when getItem throws", () => {
    const backend: ActivityStorageBackend = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(loadActivity(backend)).toEqual([]);
  });
});

describe("recordActivity", () => {
  it("returns null when backend is null", () => {
    expect(recordActivity(baseItem, null)).toBeNull();
  });

  it("returns null on invalid candidate and does not persist", () => {
    const backend = makeBackend();
    expect(recordActivity({ bad: 1 }, backend)).toBeNull();
    expect(backend.store.has(ACTIVITY_STORE_KEY)).toBe(false);
  });

  it("upserts and persists a valid item", () => {
    const backend = makeBackend();
    const out = recordActivity(baseItem, backend);
    expect(out).toEqual(baseItem);
    expect(loadActivity(backend)).toEqual([baseItem]);
  });

  it("replaces an existing id", () => {
    const backend = makeBackend();
    recordActivity(baseItem, backend);
    const replacement = { ...baseItem, title: "Updated" };
    recordActivity(replacement, backend);
    const loaded = loadActivity(backend);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe("Updated");
  });

  it("returns null when storage is unavailable mid-write", () => {
    const backend: ActivityStorageBackend = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(recordActivity(baseItem, backend)).toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
