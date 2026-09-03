/**
 * Treasury Shield recommendation — pure policy owner.
 *
 * Slice A: actionable protective-put recommendation/preflight only. Never
 * execution. Owns the strict public response shape, bounded user constraints,
 * maker-sell PUT selection, and runtime strict schemas for provider orders,
 * preview economics, and the final public union. Never imports the SDK and
 * never sees signatures, calldata, or raw provider blobs; the server-only
 * adapter reduces provider orders to the strict `ProviderOrder` shape before
 * any selection runs.
 *
 * Trust boundaries:
 * - `premiumBudgetUsd` is the user's TOTAL premium budget (USD), converted to
 *   an exact 6-decimal USDC micro integer. It is never a per-contract cap. The
 *   adapter passes that exact bigint to `previewFillOrder`; contract count is
 *   derived by the SDK from the budget and per-contract price, never from
 *   `availableAmount`.
 * - Horizon is binding: a live recommendation requires a positive horizon and
 *   order expiry at/after `now + horizonDays*86400`.
 * - `premiumAmountUsdc` and `maximumLossUsdc` are conservative customer caps.
 *   Actual premium remains unknown until a fill is verified on Base.
 * - Public `live` binds exact signed-order content via a one-way fingerprint;
 *   no signature or raw blob is ever exposed.
 */
import { z } from "zod";

export type ShieldAsset = "ETH" | "BTC";

const SHIELD_MAX_PREMIUM_USD = 1_000_000;
const SHIELD_MAX_HORIZON_DAYS = 365;
const SECONDS_PER_DAY = 86_400;
const EIGHT_DECIMALS = 1e8;

export const BASE_CHAIN_ID = 8453;
/** Base mainnet USDC (6 decimals) — collateral must equal this address. */
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const AssetSchema = z.enum(["ETH", "BTC"]);

const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid EVM address");

const BaseUsdcAddressSchema = EvmAddressSchema.refine(
  (v) => v.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase(),
  { message: "collateral token is not Base USDC" },
);

function isValidPremiumBudgetUsd(value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return false;
  }
  if (value > SHIELD_MAX_PREMIUM_USD) {
    return false;
  }
  const micro = value * 1_000_000;
  return Number.isSafeInteger(micro) && micro > 0;
}

/** Zod schema for the HTTP boundary and the runtime constraints seam. */
export const PremiumBudgetUsdSchema = z
  .number()
  .refine(isValidPremiumBudgetUsd, "Premium budget must be a positive USD value with at most 6 fractional decimals, up to 1,000,000.");

/** Convert a validated USD budget to exact 6-decimal USDC micro. Throws defensively. */
export function premiumBudgetUsdToMicro(premiumBudgetUsd: number): bigint {
  if (!isValidPremiumBudgetUsd(premiumBudgetUsd)) {
    throw new Error("Invalid premium budget.");
  }
  return BigInt(premiumBudgetUsd * 1_000_000);
}

export interface ShieldConstraints {
  asset: ShieldAsset;
  /** Positive integer horizon in days, 1..365. Required for a live recommendation. */
  horizonDays: number;
  /** Total premium budget in USD (user-supplied). */
  premiumBudgetUsd: number;
}

const ShieldConstraintsSchema = z
  .object({
    asset: AssetSchema,
    horizonDays: z.number().int().min(1).max(SHIELD_MAX_HORIZON_DAYS),
    premiumBudgetUsd: PremiumBudgetUsdSchema,
  })
  .strict();

/** Strict-normalize unknown constraints at the adapter seam. Returns null on any malformed input. */
export function parseShieldConstraints(input: unknown): ShieldConstraints | null {
  const parsed = ShieldConstraintsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * Strict internal provider order — the only order shape the policy accepts.
 * Full provider identity is reduced to these decision-relevant fields by the
 * server-only adapter.
 */
export interface ProviderOrder {
  offerFingerprint: string;
  makerAddress: string;
  /** Maker side: true = maker buys (taker sells), false = maker sells (taker buys). */
  isBuyer: boolean;
  /** 0 = call, 1 = put. */
  optionType: 0 | 1;
  underlying: ShieldAsset;
  /** Strike prices in 8 decimals. Non-empty for a valid put. */
  strikes: bigint[];
  /** Expiry in seconds since epoch. */
  expiry: bigint;
  /** Price per contract in 8 decimals (USD). */
  pricePerContract8d: bigint;
  /** Collateral token address; must equal BASE_USDC_ADDRESS for this workflow. */
  collateralToken: string;
}

export interface PreviewEconomics {
  /** Exact contract count from previewFillOrder. */
  numContracts: bigint;
  collateralToken: string;
  /** Price per contract in 8 decimals (USD). */
  pricePerContract: bigint;
  /** SDK-reported budget cap in collateral-token smallest units. */
  totalCollateral: bigint;
}

const ProviderOrderSchema = z
  .object({
    offerFingerprint: z.string().regex(/^0x[0-9a-f]{64}$/),
    makerAddress: EvmAddressSchema,
    isBuyer: z.boolean(),
    optionType: z.union([z.literal(0), z.literal(1)]),
    underlying: AssetSchema,
    strikes: z.array(z.bigint().positive()).min(1),
    expiry: z.bigint().positive(),
    pricePerContract8d: z.bigint().positive(),
    collateralToken: BaseUsdcAddressSchema,
  })
  .strict();

/** Strict-normalize an unknown provider order. Returns null on any malformed/extra field. */
export function parseProviderOrder(input: unknown): ProviderOrder | null {
  const parsed = ProviderOrderSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

const PreviewEconomicsSchema = z
  .object({
    numContracts: z.bigint().nonnegative(),
    maxContracts: z.bigint().nonnegative(),
    collateralToken: BaseUsdcAddressSchema,
    pricePerContract: z.bigint().positive(),
    totalCollateral: z.bigint().positive(),
    referrer: EvmAddressSchema,
    maker: EvmAddressSchema,
    expiry: z.bigint().positive(),
    isCall: z.boolean(),
    strikes: z.array(z.bigint().positive()).min(1),
  })
  .strict();

export interface PreviewExpectation {
  makerAddress: string;
  expiry: bigint;
  isCall: boolean;
  strikes: bigint[];
  /** Price per contract in 8 decimals, copied from the selected order. */
  pricePerContract8d: bigint;
}

/**
 * Strict-normalize the full SDK preview shape and cross-check that it binds to
 * the selected order (maker, expiry, call/put, strikes, AND per-contract price).
 * The price equality prevents a stale/mismatched preview from silently producing
 * a live recommendation at a different price. Returns null on any mismatch.
 */
export function parsePreviewEconomics(
  input: unknown,
  expected: PreviewExpectation,
): PreviewEconomics | null {
  const parsed = PreviewEconomicsSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const p = parsed.data;
  if (p.maker.toLowerCase() !== expected.makerAddress.toLowerCase()) return null;
  if (p.expiry !== expected.expiry) return null;
  if (p.isCall !== expected.isCall) return null;
  if (p.strikes.length !== expected.strikes.length || !p.strikes.every((s, i) => s === expected.strikes[i])) {
    return null;
  }
  if (p.pricePerContract !== expected.pricePerContract8d) return null;
  return {
    numContracts: p.numContracts,
    collateralToken: p.collateralToken,
    pricePerContract: p.pricePerContract,
    totalCollateral: p.totalCollateral,
  };
}

export type ShieldSelection =
  | { kind: "selected"; order: ProviderOrder }
  | { kind: "no_match" };

/**
 * Select the lowest-price unexpired maker-sell PUT matching the asset and
 * binding horizon. Wrong-side/type/asset/collateral, empty-strike, or
 * too-short-expiry orders fail closed to `no_match`. Defense-in-depth: constraints
 * are re-parsed through `ShieldConstraintsSchema` so invalid runtime input fails
 * closed rather than throwing or hitting `BigInt` on a lossy float.
 */
export function selectShieldOrder(
  orders: ProviderOrder[],
  constraints: ShieldConstraints,
  nowSeconds: number,
): ShieldSelection {
  const safe = parseShieldConstraints(constraints);
  if (safe === null || orders.length === 0) {
    return { kind: "no_match" };
  }
  const minExpiry = BigInt(nowSeconds) + BigInt(safe.horizonDays) * BigInt(SECONDS_PER_DAY);

  let best: ProviderOrder | null = null;
  for (const order of orders) {
    if (order.isBuyer || order.optionType !== 1 || order.underlying !== safe.asset || order.expiry < minExpiry) {
      continue;
    }
    if (best === null || order.pricePerContract8d < best.pricePerContract8d) {
      best = order;
    }
  }
  return best ? { kind: "selected", order: best } : { kind: "no_match" };
}

export interface LiveRecommendation {
  kind: "live";
  fetchedAt: string;
  expiresAt: string;
  asset: ShieldAsset;
  optionType: "put";
  strikeUsd: number;
  pricePerContractUsd: number;
  premiumBudgetUsd: number;
  premiumAmountUsdc: string;
  maximumLossUsdc: string;
  numContracts: string;
  collateralToken: string;
  chainId: 8453;
  execution: "none";
  approvalRequired: true;
  disclosure: string;
  offerFingerprint: string;
}

export type ShieldRecommendation =
  | LiveRecommendation
  | { kind: "no_match"; fetchedAt: string; asset: ShieldAsset }
  | { kind: "unavailable"; fetchedAt: string; reason: string };

const LIVE_DISCLOSURE =
  "Read-only protective-put preflight. Not financial advice and not a guaranteed floor. Approval in a connected wallet is required before any fill; no transaction is submitted here.";

export interface BuildRecommendationInput {
  constraints: ShieldConstraints;
  order: ProviderOrder;
  preview: PreviewEconomics;
  fetchedAt: string;
}

function toUsd8dec(value8d: bigint): number {
  return Number(value8d) / EIGHT_DECIMALS;
}

/**
 * Build the strict public `live` recommendation. Cost fields remain conservative
 * caps until a transaction receipt proves actual premium. Never emits signatures,
 * calldata, or raw blobs.
 */
export function buildRecommendation(input: BuildRecommendationInput): LiveRecommendation {
  const { constraints, order, preview, fetchedAt } = input;
  return {
    kind: "live",
    fetchedAt,
    expiresAt: new Date(Number(order.expiry) * 1_000).toISOString(),
    asset: constraints.asset,
    optionType: "put",
    strikeUsd: toUsd8dec(order.strikes[0] ?? 0n),
    pricePerContractUsd: toUsd8dec(preview.pricePerContract),
    premiumBudgetUsd: constraints.premiumBudgetUsd,
    premiumAmountUsdc: preview.totalCollateral.toString(),
    maximumLossUsdc: preview.totalCollateral.toString(),
    numContracts: preview.numContracts.toString(),
    collateralToken: preview.collateralToken,
    chainId: BASE_CHAIN_ID,
    execution: "none",
    approvalRequired: true,
    disclosure: LIVE_DISCLOSURE,
    offerFingerprint: order.offerFingerprint,
  };
}

const LiveRecommendationSchema = z
  .object({
    kind: z.literal("live"),
    fetchedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    asset: AssetSchema,
    optionType: z.literal("put"),
    strikeUsd: z.number().finite().nonnegative(),
    pricePerContractUsd: z.number().finite().positive(),
    premiumBudgetUsd: PremiumBudgetUsdSchema,
    premiumAmountUsdc: z.string().min(1),
    maximumLossUsdc: z.string().min(1),
    numContracts: z.string().min(1),
    collateralToken: BaseUsdcAddressSchema,
    chainId: z.literal(BASE_CHAIN_ID),
    execution: z.literal("none"),
    approvalRequired: z.literal(true),
    disclosure: z.string().min(1),
    offerFingerprint: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();

const NoMatchSchema = z
  .object({
    kind: z.literal("no_match"),
    fetchedAt: z.string().min(1),
    asset: AssetSchema,
  })
  .strict();

const UnavailableSchema = z
  .object({
    kind: z.literal("unavailable"),
    fetchedAt: z.string().min(1),
    reason: z.string().min(1).max(200),
  })
  .strict();

const ShieldRecommendationSchema = z.union([
  LiveRecommendationSchema,
  NoMatchSchema,
  UnavailableSchema,
]);

/** Final fail-closed parse before the route boundary. Malformed state can never become a live claim. */
export function parseShieldRecommendation(input: unknown): ShieldRecommendation | null {
  const parsed = ShieldRecommendationSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
