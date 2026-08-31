/**
 * Activity data contract — device-local convenience history for the /proof
 * route. Single policy owner for the Activity shape, bounds, and ordering.
 *
 * Truth boundary: a local Activity record is NOT payment, settlement, chain
 * evidence, or authorization. It is a user-created summary that links back to
 * a portable receipt URL. Malformed, sample, or shared imports never become
 * user history. Local storage never upgrades proof state.
 */

export interface ActivityItem {
  id: string;
  href: string;
  title: string;
  amountLabel: string;
  detailLabel: string;
  nextOwner: string;
  updatedAt: string;
}

/** Versioned persisted envelope. Bumping the version invalidates older storage. */
export interface ActivityStoreEnvelope {
  version: typeof ACTIVITY_STORE_VERSION;
  items: ActivityItem[];
}

/** Current and only supported persisted envelope version. */
export const ACTIVITY_STORE_VERSION = 1 as const;

/** localStorage key is versioned so a bump does not collide with old data. */
export const ACTIVITY_STORE_KEY = "convey.activity.v1" as const;

/** Hard cap on retained items; newest 20 win, oldest dropped. */
export const ACTIVITY_MAX_ITEMS = 20 as const;

/** Field bounds measured in Unicode code points, not UTF-16 units. */
export const ACTIVITY_ID_MAX_CODE_POINTS = 128;
export const ACTIVITY_TITLE_MAX_CODE_POINTS = 120;
export const ACTIVITY_AMOUNT_LABEL_MAX_CODE_POINTS = 64;
export const ACTIVITY_DETAIL_LABEL_MAX_CODE_POINTS = 160;
export const ACTIVITY_NEXT_OWNER_MAX_CODE_POINTS = 80;

/** Upper bound on a single href. Receipt payloads max ~28 KiB; allow headroom. */
export const ACTIVITY_HREF_MAX_LENGTH = 32_000;
