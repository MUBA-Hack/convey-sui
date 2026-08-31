import { z } from "zod";
import { buildBaseScanTransactionUrl } from "./protection-purchase-receipt";

// Re-exported so downstream modules (e.g. the brief builder) cross-check the
// canonical explorer link without depending on the receipt module directly.
export { buildBaseScanTransactionUrl };

// Expiring window: a position is "expiring" once it is within this many
// seconds of its option expiry, and until expiry itself (exclusive).
export const POSITION_EXPIRING_WINDOW_SECONDS = 7n * 24n * 60n * 60n;
export const POSITION_EXPIRING_WINDOW_MS = POSITION_EXPIRING_WINDOW_SECONDS * 1000n;

// Deterministic freshness bounds for the verifier checkedAt timestamp. The
// verify response is obtained fresh from the server-only verify route; these
// bounds reject a stale or too-future checkedAt so a carried old response
// cannot be replayed as a position. Defaults are safe and overridable per call;
// malformed overrides fall back to these constants.
export const PORTFOLIO_VERIFY_MAX_AGE_MS_DEFAULT = 5 * 60 * 1000;
export const PORTFOLIO_VERIFY_FUTURE_SKEW_MS_DEFAULT = 30 * 1000;

// NASA bounds: preflight caps reject huge inputs before Zod/BigInt traversal
// or allocation. A 10MB decimal/hash/url string or oversized array is rejected
// in O(1) by length checks, so the builder fails closed without proportional
// cost or RangeError. The string cap accommodates the longest legitimate
// composite field (id = planId:txHash = 133 chars) while still rejecting
// multi-megabyte DoS strings; decimal shape is enforced separately by schema
// regexes. These are the single owner of position-input size policy.
export const PORTFOLIO_POSITION_MAX_RECEIPTS = 32;
export const PORTFOLIO_POSITION_MAX_DECIMAL_LENGTH = 256;
export const PORTFOLIO_POSITION_MAX_ARRAY_FIELDS = 16;

// JS Date max is 8.64e15 ms, strictly below Number.MAX_SAFE_INTEGER. Expiry ms
// must be representable as a Date and round-trip through toISOString.
export const PORTFOLIO_MAX_DATE_MS = 8_640_000_000_000_000n;

export type PositionStatus = "active" | "expiring" | "expired";

export const PositionStatusSchema = z.enum(["active", "expiring", "expired"]);

export interface ProtectionPosition {
  readonly id: string;
  readonly asset: "ETH" | "BTC";
  readonly strikeFloor8d: string;
  readonly expirySeconds: string;
  readonly expiryIso: string;
  readonly premiumMicro: string;
  readonly quantityMicro: string;
  readonly status: PositionStatus;
  readonly receiptRef: string;
  readonly chainDigest: string;
  readonly chainLink: string;
  readonly optionAddress: string;
  readonly planId: string;
}

export interface ProtectionPositionBook {
  readonly positions: readonly ProtectionPosition[];
}

// Strict output schema for a built position. The builder parses every emitted
// position through this schema before freezing, so a malformed internal state
// can never leak a structurally invalid position. This is the single owner of
// the position shape, status enum, integer/hash/address policy: the brief
// builder imports it instead of redefining those constraints.
const AssetSchema = z.enum(["ETH", "BTC"]);
const PositiveIntegerStringSchema = z.string().regex(/^[1-9]\d*$/u);
const TxHashSchema = z.string().regex(/^0x[a-f0-9]{64}$/iu);
const EvmAddressSchema = z.string().regex(/^0x[a-f0-9]{40}$/u);

export const ProtectionPositionSchema = z.strictObject({
  id: z.string().min(1),
  asset: AssetSchema,
  strikeFloor8d: PositiveIntegerStringSchema,
  expirySeconds: PositiveIntegerStringSchema,
  expiryIso: z.iso.datetime(),
  premiumMicro: PositiveIntegerStringSchema,
  quantityMicro: PositiveIntegerStringSchema,
  status: PositionStatusSchema,
  receiptRef: z.string().min(1),
  chainDigest: TxHashSchema,
  chainLink: z.string().url(),
  optionAddress: EvmAddressSchema,
  planId: TxHashSchema,
});

// Pure status classifier shared by the position builder and the brief builder
// so both compute active/expiring/expired from the same exact boundaries.
export function classifyPositionStatus(expiryMs: bigint, nowMs: bigint): PositionStatus {
  if (nowMs >= expiryMs) return "expired";
  if (nowMs >= expiryMs - POSITION_EXPIRING_WINDOW_MS) return "expiring";
  return "active";
}
