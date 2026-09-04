import { describe, expect, it } from "vitest";
import {
  COMPANION_ORGANIZATIONS_STORAGE_KEY,
  createCompanionOrganizationStore,
  type CompanionOrganizationStorage,
} from "@/lib/companion/organizations";

function createFakeStorage(): CompanionOrganizationStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("CompanionOrganizationStore", () => {
  it("creates, selects, and restores a bounded organization profile", () => {
    const storage = createFakeStorage();
    const store = createCompanionOrganizationStore(storage, () => 1_725_000_000_000);

    const created = store.create({ name: "  River Aid  ", kind: "ngo" });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.organization).toMatchObject({
      id: "river-aid-m0gcgmio",
      name: "River Aid",
      kind: "ngo",
      memberRole: "owner",
    });
    expect(store.read().activeOrganizationId).toBe(created.organization.id);
    expect(storage.getItem(COMPANION_ORGANIZATIONS_STORAGE_KEY)).toContain('"name":"River Aid"');
  });

  it("rejects blank, oversized, duplicate, and excess organizations", () => {
    const storage = createFakeStorage();
    const store = createCompanionOrganizationStore(storage, () => 1_725_000_000_000);

    expect(store.create({ name: " ", kind: "club" }).ok).toBe(false);
    expect(store.create({ name: "x".repeat(49), kind: "club" }).ok).toBe(false);
    expect(store.create({ name: "Robotics Club", kind: "club" }).ok).toBe(true);
    expect(store.create({ name: "robotics club", kind: "club" }).ok).toBe(false);

    for (let index = 0; index < 7; index += 1) {
      expect(store.create({ name: `Group ${index}`, kind: "community" }).ok).toBe(true);
    }
    expect(store.create({ name: "Ninth group", kind: "community" }).ok).toBe(false);
  });

  it("fails closed when storage is malformed or unavailable", () => {
    const storage = createFakeStorage();
    storage.setItem(COMPANION_ORGANIZATIONS_STORAGE_KEY, "{bad-json");
    expect(createCompanionOrganizationStore(storage).read()).toEqual({
      organizations: [],
      activeOrganizationId: null,
    });

    const unavailable = createCompanionOrganizationStore({
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    expect(unavailable.read()).toEqual({ organizations: [], activeOrganizationId: null });
    expect(unavailable.create({ name: "River Aid", kind: "ngo" }).ok).toBe(false);
  });
});
