/**
 * Treasury Shield — server-only Thetanuts adapter.
 *
 * Reduces provider `OrderWithSignature` entries to the strict `ProviderOrder`
 * shape, runs the pure selection policy, and (only on a selected order) calls
 * `previewFillOrder` with the user's exact USDC budget. Full provider identity
 * (signatures, raw API blobs, implementation addresses) stays inside this
 * server boundary.
 *
 * Hard boundaries:
 * - No signer, no fillOrder, no ensureAllowance, no approve, no RFQ, no
 *   transaction construction. Only `fetchOrders` (read) and `previewFillOrder`
 *   (read-only simulation) are ever called.
 * - One bounded `fetchOrders` call with a single timeout; no retry storm. The
 *   Promise timeout cannot abort the underlying SDK network call; a late
 *   resolved result is ignored and the call reports `unavailable`.
 * - SDK/TLS/timeout/preview errors fail closed to `unavailable`. Malformed,
 *   stale, wrong-side/type/asset/collateral, or too-short-expiry orders fail
 *   closed to `no_match` before any preview.
 * - Contract count is never derived from `availableAmount`; exact preview
 *   economics come from `previewFillOrder` invoked with the exact budget.
 * - The selected raw `OrderWithSignature` is carried directly alongside its
 *   reduced `ProviderOrder` so a duplicate nonce across makers can never bind
 *   the wrong raw order to the preview call.
 */
import "server-only";

import {
  buildPriceFeedSymbolMap,
  type OrderWithSignature,
} from "@thetanuts-finance/thetanuts-client";
import { buildProtectionOrderFingerprint } from "@/lib/strategy/protection-purchase";
import {
  createBaseThetanutsClient,
  requireBaseOptionBook,
} from "@/lib/strategy/thetanuts-base.server";
import {
  BASE_CHAIN_ID,
  buildRecommendation,
  parsePreviewEconomics,
  parseProviderOrder,
  parseShieldConstraints,
  parseShieldRecommendation,
  premiumBudgetUsdToMicro,
  selectShieldOrder,
  type PreviewEconomics,
  type ProviderOrder,
  type ShieldAsset,
  type ShieldConstraints,
  type ShieldRecommendation,
} from "@/lib/strategy/shield-recommendation";

const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_ORDERS_INSPECTED = 200;

/** Read-only SDK surface the adapter may touch. Write methods are intentionally absent. */
export interface ShieldReader {
  optionBook: string;
  fetchOrders(): Promise<OrderWithSignature[]>;
  previewFillOrder(
    orderWithSig: OrderWithSignature,
    usdcAmount: bigint,
    referrer?: string,
  ): {
    numContracts: bigint;
    maxContracts: bigint;
    collateralToken: string;
    pricePerContract: bigint;
    totalCollateral: bigint;
    referrer: string;
    maker: string;
    expiry: bigint;
    isCall: boolean;
    strikes: bigint[];
  };
}

/** Resolve a provider order to ETH/BTC, or null when it cannot be truthfully bound. */
export type UnderlyingResolver = (order: OrderWithSignature) => ShieldAsset | null;

export interface FetchShieldOptions {
  now: number;
  timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SDK_TIMEOUT")), timeoutMs);
    // The SDK network call is not aborted here; a late resolved result is
    // ignored once the timeout has fired. This is an honest bounded wait.
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function optionTypeFrom(entry: OrderWithSignature): 0 | 1 {
  // Prefer rawApiData.isCall (authoritative); fall back to order.optionType.
  // Unknown defaults to call (0) so it fails closed rather than becoming a live put.
  const isCall = entry.rawApiData?.isCall;
  if (typeof isCall === "boolean") {
    return isCall ? 0 : 1;
  }
  return entry.order.optionType === 1 ? 1 : 0;
}

function strikesFrom(entry: OrderWithSignature): bigint[] {
  if (Array.isArray(entry.order.strikes) && entry.order.strikes.length > 0) {
    return entry.order.strikes;
  }
  if (entry.order.strikePrice !== undefined) {
    return [entry.order.strikePrice];
  }
  return [];
}

/** Reduce a provider order to the strict `ProviderOrder` shape and validate it. Returns null on any malformed field. */
function toProviderOrder(
  entry: OrderWithSignature,
  optionBook: string,
  resolveUnderlying: UnderlyingResolver,
): ProviderOrder | null {
  const underlying = resolveUnderlying(entry);
  if (underlying === null) {
    return null;
  }
  return parseProviderOrder({
    offerFingerprint: buildProtectionOrderFingerprint(entry, optionBook),
    makerAddress: entry.makerAddress,
    isBuyer: entry.order.isBuyer,
    optionType: optionTypeFrom(entry),
    underlying,
    strikes: strikesFrom(entry),
    expiry: entry.order.expiry,
    pricePerContract8d: entry.order.price,
    collateralToken: entry.order.collateralToken ?? entry.rawApiData?.collateral ?? "",
  });
}

/**
 * Fetch orders, select a qualifying maker-sell put, and preview its exact
 * economics with the user's exact USDC budget. Injected `reader` and
 * `resolveUnderlying` keep the SDK out of the pure policy path.
 *
 * Accepts `unknown` constraints and strict-parses them through the single
 * `parseShieldConstraints` owner BEFORE any dereference or provider/network
 * call. Invalid input fails closed to `unavailable` with zero provider calls.
 */
export async function fetchShieldRecommendationWith(
  reader: ShieldReader,
  resolveUnderlying: UnderlyingResolver,
  constraints: unknown,
  options: FetchShieldOptions,
): Promise<ShieldRecommendation> {
  const fetchedAt = new Date(options.now * 1_000).toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Strict-parse at the seam before ANY dereference. Invalid runtime constraints
  // never reach premiumBudgetUsdToMicro, fetchOrders, or previewFillOrder.
  const safe = parseShieldConstraints(constraints);
  if (safe === null) {
    return { kind: "unavailable", fetchedAt, reason: "Invalid constraints." };
  }

  const budgetMicro = premiumBudgetUsdToMicro(safe.premiumBudgetUsd);

  let rawOrders: OrderWithSignature[];
  try {
    rawOrders = await withTimeout(reader.fetchOrders(), timeoutMs);
  } catch (error) {
    const reason =
      error instanceof Error && error.message === "SDK_TIMEOUT"
        ? "Market data timed out."
        : "Live market data is currently unavailable.";
    return { kind: "unavailable", fetchedAt, reason };
  }

  if (!Array.isArray(rawOrders)) {
    return { kind: "unavailable", fetchedAt, reason: "Live market data is currently unavailable." };
  }

  // Bound the collection; carry the raw entry alongside its reduced form so a
  // duplicate nonce across makers can never bind the wrong raw order to preview.
  const paired: { raw: OrderWithSignature; provider: ProviderOrder }[] = [];
  for (const entry of rawOrders.slice(0, MAX_ORDERS_INSPECTED)) {
    try {
      const provider = toProviderOrder(entry, reader.optionBook, resolveUnderlying);
      if (provider) {
        paired.push({ raw: entry, provider });
      }
    } catch {
      // Skip a single malformed order rather than poisoning the whole result.
    }
  }

  const selection = selectShieldOrder(paired.map((p) => p.provider), safe, options.now);
  if (selection.kind === "no_match") {
    return { kind: "no_match", fetchedAt, asset: safe.asset };
  }

  const selected = paired.find((p) => p.provider.offerFingerprint === selection.order.offerFingerprint);
  if (!selected) {
    return { kind: "unavailable", fetchedAt, reason: "Live market data is currently unavailable." };
  }

  let rawPreview: ReturnType<ShieldReader["previewFillOrder"]>;
  try {
    // Pass the exact USDC budget; never undefined. No referrer (no signer).
    rawPreview = reader.previewFillOrder(selected.raw, budgetMicro, undefined);
  } catch {
    return { kind: "unavailable", fetchedAt, reason: "Live market data is currently unavailable." };
  }

  const preview: PreviewEconomics | null = parsePreviewEconomics(rawPreview, {
    makerAddress: selected.provider.makerAddress,
    expiry: selected.provider.expiry,
    isCall: false,
    strikes: selected.provider.strikes,
    pricePerContract8d: selected.provider.pricePerContract8d,
  });
  if (preview === null) {
    return { kind: "unavailable", fetchedAt, reason: "Live market data is currently unavailable." };
  }

  // Defense in depth: total premium must be positive and within budget. Zero
  // contracts is a legitimate no-fill → no_match. Count must not exceed maxContracts.
  if (preview.totalCollateral <= 0n || preview.totalCollateral > budgetMicro) {
    return { kind: "no_match", fetchedAt, asset: safe.asset };
  }
  const requestedContracts = budgetMicro * 100_000_000n / selected.provider.pricePerContract8d;
  if (
    requestedContracts <= 0n ||
    requestedContracts > rawPreview.maxContracts ||
    preview.numContracts !== requestedContracts
  ) {
    return { kind: "no_match", fetchedAt, asset: safe.asset };
  }

  const recommendation = buildRecommendation({
    constraints: safe,
    order: selected.provider,
    preview,
    fetchedAt,
  });

  // Final fail-closed parse through the strict public union before returning.
  const verified = parseShieldRecommendation(recommendation);
  if (!verified) {
    return { kind: "unavailable", fetchedAt, reason: "Live market data is currently unavailable." };
  }
  return verified;
}

/** Build an `UnderlyingResolver` from the SDK's price-feed symbol map. Unknown feeds → null (fail closed). */
export function createPriceFeedResolver(): UnderlyingResolver {
  const map = buildPriceFeedSymbolMap(BASE_CHAIN_ID);
  return (order: OrderWithSignature) => {
    const feed = order.rawApiData?.priceFeed;
    if (typeof feed !== "string" || feed.length === 0) {
      return null;
    }
    const symbol = map[feed.toLowerCase()];
    if (symbol === "ETH") return "ETH";
    if (symbol === "BTC") return "BTC";
    return null;
  };
}

/** Production reader backed by the installed Thetanuts SDK on Base mainnet. */
export function createShieldReader(): ShieldReader {
  const client = createBaseThetanutsClient();
  return {
    optionBook: requireBaseOptionBook(client),
    fetchOrders: () => client.api.fetchOrders(),
    previewFillOrder: (order, usdcAmount, referrer) =>
      client.optionBook.previewFillOrder(order, usdcAmount, referrer),
  };
}

export function fetchShieldRecommendation(
  constraints: ShieldConstraints,
  options: FetchShieldOptions,
): Promise<ShieldRecommendation> {
  return fetchShieldRecommendationWith(
    createShieldReader(),
    createPriceFeedResolver(),
    constraints,
    options,
  );
}
