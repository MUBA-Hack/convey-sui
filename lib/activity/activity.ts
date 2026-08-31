/**
 * Pure Activity parse/serialize/upsert helpers. Single policy owner for the
 * Activity shape, bounds, ordering, and storage envelope.
 *
 * Truth boundary: a local Activity record is NOT payment, settlement, chain
 * evidence, or authorization. Malformed storage, version mismatch, unsafe
 * href, or any validation failure returns a safe empty result (parse) or is
 * rejected before persistence (upsert). These helpers never throw on bad
 * input; they fail closed.
 */

import { z } from "zod";
import {
  ACTIVITY_AMOUNT_LABEL_MAX_CODE_POINTS,
  ACTIVITY_DETAIL_LABEL_MAX_CODE_POINTS,
  ACTIVITY_HREF_MAX_LENGTH,
  ACTIVITY_ID_MAX_CODE_POINTS,
  ACTIVITY_MAX_ITEMS,
  ACTIVITY_NEXT_OWNER_MAX_CODE_POINTS,
  ACTIVITY_STORE_VERSION,
  ACTIVITY_TITLE_MAX_CODE_POINTS,
  type ActivityItem,
  type ActivityStoreEnvelope,
} from "./types";
import { isProofReceiptQueryParam } from "@/lib/commerce/proof-query";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/u;

/** Bounded, control-char-free string measured in code points. */
function boundedCodePointString(max: number) {
  return z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= max)
    .refine((value) => !CONTROL_CHARS.test(value));
}

/**
 * Strict href: `/proof?<key>=<payload>` only. Key must be one of the allowed
 * receipt query params; payload is URL-safe base64. No origin, fragment,
 * credentials, or protocol-relative form can satisfy this.
 */
const ActivityHrefSchema = z.string().min(1).max(ACTIVITY_HREF_MAX_LENGTH).refine((value) => {
  const match = /^\/proof\?([^=&]+)=([A-Za-z0-9_-]+)$/.exec(value);
  return Boolean(match && isProofReceiptQueryParam(match[1]!));
});

export const ActivityItemSchema = z.strictObject({
  id: boundedCodePointString(ACTIVITY_ID_MAX_CODE_POINTS),
  href: ActivityHrefSchema,
  title: boundedCodePointString(ACTIVITY_TITLE_MAX_CODE_POINTS),
  amountLabel: boundedCodePointString(ACTIVITY_AMOUNT_LABEL_MAX_CODE_POINTS),
  detailLabel: boundedCodePointString(ACTIVITY_DETAIL_LABEL_MAX_CODE_POINTS),
  nextOwner: boundedCodePointString(ACTIVITY_NEXT_OWNER_MAX_CODE_POINTS),
  updatedAt: z.iso.datetime(),
});

export const ActivityStoreEnvelopeSchema = z.strictObject({
  version: z.literal(ACTIVITY_STORE_VERSION),
  items: z.array(ActivityItemSchema).max(ACTIVITY_MAX_ITEMS),
});

/**
 * Parse a persisted JSON string into a strict envelope. Any malformed JSON,
 * schema violation, version mismatch, unsafe href, or extra field fails
 * closed to an empty result. Never throws.
 */
export function parseActivityStore(raw: unknown): ActivityStoreEnvelope {
  if (typeof raw !== "string" || raw.length === 0) return emptyActivityStore();
  try {
    const result = ActivityStoreEnvelopeSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : emptyActivityStore();
  } catch {
    return emptyActivityStore();
  }
}

function emptyActivityStore(): ActivityStoreEnvelope {
  return { version: ACTIVITY_STORE_VERSION, items: [] };
}

/**
 * Validate a single candidate item against the strict schema. Returns the
 * normalized item or null if rejected. Never throws.
 */
export function validateActivityItem(input: unknown): ActivityItem | null {
  const result = ActivityItemSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Deterministic ordering: newest `updatedAt` first, then `id` ascending as a
 * stable tie-break. Returns a new array; does not mutate input.
 */
export function sortActivityItems(items: readonly ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    const timeDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (timeDelta !== 0) return timeDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Upsert a candidate item into an existing item list. Replaces any item with
 * the same `id` (not a second record), re-sorts deterministically, and caps
 * at ACTIVITY_MAX_ITEMS by dropping the oldest. Returns the new list and the
 * upserted record on success, or the unchanged list and null on rejection.
 *
 * Never throws. The candidate is validated before mutation; invalid input
 * leaves the existing list untouched.
 */
export function upsertActivityItem(
  current: readonly ActivityItem[],
  candidate: unknown,
): { items: ActivityItem[]; item: ActivityItem | null } {
  const item = validateActivityItem(candidate);
  if (!item) return { items: [...current], item: null };
  const without = current.filter((existing) => existing.id !== item.id);
  const next = sortActivityItems([...without, item]).slice(0, ACTIVITY_MAX_ITEMS);
  return { items: next, item };
}
