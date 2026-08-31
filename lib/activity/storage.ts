/**
 * Browser-safe Activity storage wrapper. Device-local convenience only — not
 * server sync, chain evidence, or authorization. A local record never proves
 * payment or chain state.
 */

import {
  ACTIVITY_STORE_KEY,
  ACTIVITY_STORE_VERSION,
  type ActivityItem,
  type ActivityStoreEnvelope,
} from "./types";
import { parseActivityStore, sortActivityItems, upsertActivityItem } from "./activity";

/** Sort parsed items newest-first; schema already caps count at 20. */
function sortedItems(envelope: ActivityStoreEnvelope): ActivityItem[] {
  return sortActivityItems(envelope.items);
}

/** localStorage accessor indirection so tests can inject a fake. */
export interface ActivityStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readBackend(): ActivityStorageBackend | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = (window as { localStorage?: Storage }).localStorage;
    if (!storage) return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    };
  } catch {
    return null;
  }
}

/**
 * Load persisted Activity items, newest-first. Fails safe to [] on
 * missing/malformed/version-mismatched storage or any thrown access error.
 * Never mutates storage while rendering.
 */
export function loadActivity(
  backend: ActivityStorageBackend | null = readBackend(),
): ActivityItem[] {
  if (!backend) return [];
  let raw: string | null;
  try {
    raw = backend.getItem(ACTIVITY_STORE_KEY);
  } catch {
    return [];
  }
  return sortedItems(parseActivityStore(raw));
}

function saveActivity(items: readonly ActivityItem[], backend: ActivityStorageBackend): boolean {
  const envelope: ActivityStoreEnvelope = {
    version: ACTIVITY_STORE_VERSION,
    items: sortActivityItems(items),
  };
  try {
    backend.setItem(ACTIVITY_STORE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Upsert a candidate into persisted list and save. Returns item or null. Never throws. */
export function recordActivity(
  candidate: unknown,
  backend: ActivityStorageBackend | null = readBackend(),
): ActivityItem | null {
  if (!backend) return null;
  const current = loadActivity(backend);
  const { items, item } = upsertActivityItem(current, candidate);
  if (!item) return null;
  if (!saveActivity(items, backend)) return null;
  return item;
}
