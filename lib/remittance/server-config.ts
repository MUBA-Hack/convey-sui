/**
 * Server-only remittance configuration: env parsing, the 256-bit quote signing
 * key, the unique per-beneficiary recipient mapping, and the non-PII
 * beneficiary reference derivation.
 *
 * This module imports `server-only` so any accidental client import fails the
 * build. No client component may import this module. The signing key and
 * recipient mapping never leave the server.
 *
 * The signing key is `REMITTANCE_QUOTE_SIGNING_KEY_HEX`: exactly 64 lowercase
 * hex characters (256 bits). A missing or malformed key fails closed — quotes
 * are viewable but never executable (the attestation is null and the verify
 * seam refuses to authorize).
 *
 * The recipient mapping enforces unique beneficiary deposit addresses after
 * canonical Sui address normalization: two aliases that resolve to the same
 * canonical address make the configuration non-executable (the mapping is
 * dropped, so no recipient resolves). This exact unique destination address is
 * the phase-one on-chain beneficiary binding; the non-PII beneficiary reference
 * in the receipt is off-chain metadata only.
 */

import "server-only";

import {
  DEFAULT_CONFIG,
  FEE_BPS_MAX,
  FEE_BPS_MIN,
  QUOTE_TTL_MAX_MS,
  QUOTE_TTL_MIN_MS,
  USDC_COIN_TYPE_TESTNET,
  USDC_DECIMALS,
} from "./constants";
import { validateRecipientAddress } from "./transfer";

export interface RemittanceConfig {
  sourceCurrency: "MYR";
  destinationCurrency: "PHP";
  /** MYR sen per 1 whole USDC (reference rate). */
  myrPerUsdc: bigint;
  /** PHP centavos per 1 whole USDC (reference rate). */
  phpPerUsdc: bigint;
  /** Fixed fee in MYR sen. */
  fixedFeeMyr: bigint;
  /** Fee basis points on the send amount (e.g. 150 = 1.5%). */
  feeBps: number;
  /** Maximum send amount in MYR sen (cap). */
  maxSendMyr: bigint;
  /** Minimum send amount in MYR sen. */
  minSendMyr: bigint;
  /** Quote time-to-live in milliseconds. */
  quoteTtlMs: number;
  /** Pinned USDC coin type for execution (testnet). */
  usdcCoinType: string;
  usdcDecimals: number;
  estimatedArrival: string;
  payoutMethod: string;
  /** Server-only 256-bit (64 hex char) quote signing key, or null when unset/invalid. */
  quoteSigningKeyHex: string | null;
  /** Server-only per-beneficiary recipient address mapping (normalized alias -> canonical Sui address). */
  recipients: ReadonlyMap<string, string>;
}

/**
 * Validate a resolved config's monetary bounds. Returns null when valid, or a
 * human reason when invalid. A config with non-positive rates, a fee bps
 * outside [0, 10000], or an unsafe TTL is rejected so a quote can never be
 * built on broken pricing.
 */
export function validateConfig(config: RemittanceConfig): string | null {
  if (config.myrPerUsdc <= 0n) return "MYR per USDC rate must be positive.";
  if (config.phpPerUsdc <= 0n) return "PHP per USDC rate must be positive.";
  if (config.fixedFeeMyr < 0n) return "Fixed fee must not be negative.";
  if (
    !Number.isSafeInteger(config.feeBps) ||
    config.feeBps < FEE_BPS_MIN ||
    config.feeBps > FEE_BPS_MAX
  ) {
    return "Fee basis points must be a safe integer between 0 and 10000.";
  }
  if (config.maxSendMyr <= 0n) return "Maximum send amount must be positive.";
  if (config.minSendMyr <= 0n) return "Minimum send amount must be positive.";
  if (config.minSendMyr > config.maxSendMyr) {
    return "Minimum send amount exceeds the maximum.";
  }
  if (
    !Number.isSafeInteger(config.quoteTtlMs) ||
    config.quoteTtlMs < QUOTE_TTL_MIN_MS ||
    config.quoteTtlMs > QUOTE_TTL_MAX_MS
  ) {
    return `Quote TTL must be a safe integer between ${QUOTE_TTL_MIN_MS} and ${QUOTE_TTL_MAX_MS} ms.`;
  }
  if (config.usdcDecimals !== USDC_DECIMALS) return "USDC decimals must be 6.";
  if (config.usdcCoinType !== USDC_COIN_TYPE_TESTNET) {
    return "Execution is pinned to the Sui testnet USDC coin type.";
  }
  return null;
}

/**
 * Parse a non-negative integer env string into a bigint, returning null when
 * invalid. Accepts only digits (no sign, no decimals, no grouping).
 */
function parseEnvInt(raw: string | undefined): bigint | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/**
 * Parse a non-negative integer env string into a safe finite number, returning
 * null when invalid or outside [min, max].
 */
function parseEnvBoundedInt(
  raw: string | undefined,
  min: number,
  max: number,
): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Parse the 256-bit quote signing key. Accepts exactly 64 lowercase hex
 * characters (256 bits). Returns null when unset or malformed — fail closed.
 */
function parseSigningKeyHex(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parse the server-only `REMITTANCE_RECIPIENTS_JSON` mapping of normalized
 * beneficiary aliases to Sui addresses. Each value is canonicalized with
 * `validateRecipientAddress`; aliases are lowercased and trimmed. Returns an
 * empty map (fail closed — no recipient resolves) when unset, malformed, OR
 * when two aliases resolve to the same canonical deposit address (duplicate
 * destination addresses make the configuration non-executable).
 */
function parseRecipientsJson(raw: string | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (typeof raw !== "string" || raw.trim().length === 0) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return out;
  }
  const seenAddresses = new Set<string>();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    const alias = k.trim().toLowerCase();
    if (alias.length === 0 || alias.length > 40) continue;
    const canonical = validateRecipientAddress(v);
    if (!canonical) continue;
    // Enforce unique beneficiary deposit addresses: two aliases pointing to the
    // same canonical address make the configuration non-executable.
    if (seenAddresses.has(canonical)) {
      return new Map();
    }
    seenAddresses.add(canonical);
    out.set(alias, canonical);
  }
  return out;
}

/**
 * Resolve remittance configuration from environment. Pricing integers use safe
 * defaults when unset; the signing key and recipient mapping fail closed when
 * unset or malformed. Duplicate deposit addresses in the recipient mapping drop
 * the entire mapping (fail closed).
 */
export function resolveRemittanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): RemittanceConfig {
  const myrPerUsdc = parseEnvInt(env.REMITTANCE_MYR_PER_USDC) ?? DEFAULT_CONFIG.myrPerUsdc;
  const phpPerUsdc = parseEnvInt(env.REMITTANCE_PHP_PER_USDC) ?? DEFAULT_CONFIG.phpPerUsdc;
  const fixedFeeMyr =
    parseEnvInt(env.REMITTANCE_FIXED_FEE_MYR) ?? DEFAULT_CONFIG.fixedFeeMyr;
  const feeBps =
    parseEnvBoundedInt(env.REMITTANCE_FEE_BPS, FEE_BPS_MIN, FEE_BPS_MAX) ??
    DEFAULT_CONFIG.feeBps;
  const maxSendMyr = parseEnvInt(env.REMITTANCE_MAX_MYR) ?? DEFAULT_CONFIG.maxSendMyr;
  const minSendMyr = parseEnvInt(env.REMITTANCE_MIN_MYR) ?? DEFAULT_CONFIG.minSendMyr;
  const quoteTtlMs =
    parseEnvBoundedInt(env.REMITTANCE_QUOTE_TTL_MS, QUOTE_TTL_MIN_MS, QUOTE_TTL_MAX_MS) ??
    DEFAULT_CONFIG.quoteTtlMs;

  const quoteSigningKeyHex = parseSigningKeyHex(env.REMITTANCE_QUOTE_SIGNING_KEY_HEX);
  const recipients = parseRecipientsJson(env.REMITTANCE_RECIPIENTS_JSON);

  return {
    ...DEFAULT_CONFIG,
    myrPerUsdc,
    phpPerUsdc,
    fixedFeeMyr,
    feeBps,
    maxSendMyr,
    minSendMyr,
    quoteTtlMs,
    quoteSigningKeyHex,
    recipients,
  };
}

/**
 * Resolve a canonical recipient Sui address for a beneficiary alias from the
 * server-only per-beneficiary mapping. Returns null when the alias is not
 * mapped. The alias is normalized (lowercased, trimmed) before lookup. The
 * mapping already holds canonical addresses (normalized at parse time).
 */
export function resolveRecipientForAlias(
  recipients: ReadonlyMap<string, string>,
  alias: string,
): string | null {
  const key = alias.trim().toLowerCase();
  if (key.length === 0) return null;
  return recipients.get(key) ?? null;
}
