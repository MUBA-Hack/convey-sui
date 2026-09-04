import { describe, expect, it } from "vitest";
import {
  COMPANION_WORKSPACE_STORAGE_KEY,
  DEFAULT_COMPANION_WORKSPACE_ID,
  createCompanionWorkspaceStore,
  type CompanionWorkspaceStorage,
} from "@/lib/companion/workspaces";

function createFakeStorage(): CompanionWorkspaceStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("CompanionWorkspaceStore", () => {
  it("defaults to personal when storage is empty or malformed", () => {
    const storage = createFakeStorage();
    const store = createCompanionWorkspaceStore(storage);

    expect(store.read()).toBe(DEFAULT_COMPANION_WORKSPACE_ID);

    storage.setItem(COMPANION_WORKSPACE_STORAGE_KEY, "{not-json");
    expect(store.read()).toBe(DEFAULT_COMPANION_WORKSPACE_ID);

    storage.setItem(
      COMPANION_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: "convey.companion-workspace.v1", workspaceId: "admin" }),
    );
    expect(store.read()).toBe(DEFAULT_COMPANION_WORKSPACE_ID);
  });

  it("persists only a known bounded workspace id", () => {
    const storage = createFakeStorage();
    const store = createCompanionWorkspaceStore(storage);

    expect(store.write("ngo")).toBe(true);
    expect(store.read()).toBe("ngo");
    expect(storage.getItem(COMPANION_WORKSPACE_STORAGE_KEY)).toBe(
      '{"version":"convey.companion-workspace.v1","workspaceId":"ngo"}',
    );
  });

  it("fails closed when storage throws", () => {
    const store = createCompanionWorkspaceStore({
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });

    expect(store.read()).toBe(DEFAULT_COMPANION_WORKSPACE_ID);
    expect(store.write("treasury")).toBe(false);
  });
});
