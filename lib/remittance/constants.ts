/**
 * Client-safe immutable remittance corridor, USDC, and product-cap constants.
 *
 * No secrets, no env parsing, no HMAC, no server-only imports. Every value here
 * is pinned and may be imported by client components. The absolute USDC product
 * cap is derived from pinned corridor constants (max send + conservative rate
 * floor) so a transfer amount is never bounded by an authorization response
 * field — only by client-pinned constants.
 */

/** Official Circle Sui USDC coin types. Pinned to testnet for execution. */
export const USDC_COIN_TYPE_TESTNET =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
export const USDC_COIN_TYPE_MAINNET =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;
/** 1 USDC in micro-units. */
export const USDC_MICRO_PER_WHOLE = 1_000_000n;

/** Maximum safe u64 value (2^64 - 1). */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** Minor units per whole fiat unit (2 decimals for MYR and PHP). */
export const MYR_MINOR_PER_WHOLE = 100n;
export const PHP_MINOR_PER_WHOLE = 100n;

/** Quote TTL bounds in milliseconds. Min 10s, max 10min. */
export const QUOTE_TTL_MIN_MS = 10_000;
export const QUOTE_TTL_MAX_MS = 600_000;

/** Fee basis points bounds (0 = free, 10000 = 100%). */
export const FEE_BPS_MIN = 0;
export const FEE_BPS_MAX = 10_000;

/**
 * Pinned absolute corridor maximums used to derive the client-side USDC product
 * cap. These are NOT read from any authorization response — they are immutable
 * client-pinned safety bounds. A tampered authorization that claims a larger
 * amount is rejected before the transaction is built.
 */
/** Absolute maximum send amount in MYR sen for the round-1 corridor. */
export const MAX_SEND_MYR_SEN = 100_000n; // 1 000 MYR
/**
 * Conservative rate floor: 1 USDC is worth at least 1.00 MYR (100 sen). The
 * real reference rate is ~4.50 MYR/USDC; this floor is a safety margin so the
 * derived USDC cap is generous but bounded.
 */
export const RATE_FLOOR_MYR_PER_USDC = 100n; // 1.00 MYR per USDC
/**
 * Absolute maximum USDC micro-units the transfer seam will ever accept, derived
 * from the pinned max send and the conservative rate floor with a 2x safety
 * factor. A legitimate round-1 quote never approaches this; a tampered amount
 * is caught here, independent of any authorization response field.
 */
export const MAX_USDC_MICRO: bigint =
  (MAX_SEND_MYR_SEN * USDC_MICRO_PER_WHOLE * 2n) / RATE_FLOOR_MYR_PER_USDC;

/**
 * The single supported corridor. Destinations are Philippine cities (and a
 * few country aliases) that map to the PHP side of the MYR -> PHP corridor.
 */
export interface CorridorSpec {
  source: "MYR";
  destination: "PHP";
  destinationCountry: "Philippines";
  /** Lowercase city / country aliases that resolve to this corridor. */
  destinationAliases: readonly string[];
  settlementRail: "Sui testnet USDC";
}

export const MYR_PHP_CORRIDOR: CorridorSpec = {
  source: "MYR",
  destination: "PHP",
  destinationCountry: "Philippines",
  destinationAliases: [
    "manila",
    "cebu",
    "quezon",
    "quezon city",
    "davao",
    "makati",
    "pasig",
    "taguig",
    "philippines",
    "philippine",
    "pilipinas",
    "pinas",
  ],
  settlementRail: "Sui testnet USDC",
};

/** Source-currency aliases that resolve to MYR. */
export const MYR_CURRENCY_ALIASES = ["rm", "myr", "ringgit", "ringgit malaysia"] as const;

/** All supported source currencies (only MYR in round 1). */
export const SUPPORTED_SOURCE_CURRENCIES = ["MYR"] as const;

/** Safe, explicit reference-pricing defaults used when env ints are absent. */
export const DEFAULT_CONFIG = {
  sourceCurrency: "MYR" as const,
  destinationCurrency: "PHP" as const,
  myrPerUsdc: 450n, // 4.50 MYR per USDC
  phpPerUsdc: 5600n, // 56.00 PHP per USDC
  fixedFeeMyr: 200n, // 2.00 MYR
  feeBps: 150, // 1.5%
  maxSendMyr: 100_000n, // 1 000 MYR
  minSendMyr: 100n, // 1 MYR
  quoteTtlMs: 120_000, // 2 minutes
  usdcCoinType: USDC_COIN_TYPE_TESTNET,
  usdcDecimals: USDC_DECIMALS,
  estimatedArrival: "Within minutes after on-chain confirmation",
  payoutMethod: "Bank payout · Not available yet",
} as const;
