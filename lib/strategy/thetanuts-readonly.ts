import "server-only";

import { ThetanutsClient, type MarketDataResponse, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { ethers } from "ethers";

const SDK_VERSION = "0.3.0";
const BASE_CHAIN_ID = 8453;
const DEFAULT_TIMEOUT_MS = 6_000;

export interface ThetanutsReader {
  getMarketData(): Promise<MarketDataResponse>;
  fetchOrders(): Promise<OrderWithSignature[]>;
}

export interface MarketOrderSample {
  side: "maker_buys" | "maker_sells";
  optionType: "call" | "put" | "unknown";
  strikeUsd: number | null;
  premium: number;
  expiry: string;
  availableAmount: string;
}

export type ThetanutsSnapshot =
  | {
      status: "live";
      source: "Thetanuts Finance SDK";
      sdkVersion: string;
      chain: "Base mainnet";
      fetchedAt: string;
      marketUpdatedAt: string;
      prices: { ETH: number | null; BTC: number | null };
      orderCount: number;
      samples: MarketOrderSample[];
    }
  | {
      status: "unavailable";
      source: "Thetanuts Finance SDK";
      sdkVersion: string;
      chain: "Base mainnet";
      fetchedAt: string;
      reason: string;
    };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SDK_TIMEOUT")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function sampleOrder(entry: OrderWithSignature): MarketOrderSample {
  const strike = entry.order.strikes?.[0] ?? entry.order.strikePrice;
  return {
    side: entry.order.isBuyer ? "maker_buys" : "maker_sells",
    optionType: entry.order.optionType === 0 ? "call" : entry.order.optionType === 1 ? "put" : "unknown",
    strikeUsd: strike === undefined ? null : Number(strike) / 1e8,
    premium: Number(entry.order.price) / 1e8,
    expiry: new Date(Number(entry.order.expiry) * 1_000).toISOString(),
    availableAmount: entry.availableAmount.toString(),
  };
}

export async function fetchThetanutsSnapshotWith(
  reader: ThetanutsReader,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ThetanutsSnapshot> {
  const fetchedAt = new Date().toISOString();
  try {
    const [market, orders] = await withTimeout(
      Promise.all([reader.getMarketData(), reader.fetchOrders()]),
      timeoutMs,
    );
    return {
      status: "live",
      source: "Thetanuts Finance SDK",
      sdkVersion: SDK_VERSION,
      chain: "Base mainnet",
      fetchedAt,
      marketUpdatedAt: new Date(market.metadata.lastUpdated).toISOString(),
      prices: {
        ETH: Number.isFinite(market.prices.ETH) ? market.prices.ETH : null,
        BTC: Number.isFinite(market.prices.BTC) ? market.prices.BTC : null,
      },
      orderCount: orders.length,
      samples: orders.slice(0, 3).map(sampleOrder),
    };
  } catch (error) {
    return {
      status: "unavailable",
      source: "Thetanuts Finance SDK",
      sdkVersion: SDK_VERSION,
      chain: "Base mainnet",
      fetchedAt,
      reason: error instanceof Error && error.message === "SDK_TIMEOUT"
        ? "Market data timed out."
        : "Live market data is currently unavailable.",
    };
  }
}

export function createThetanutsReader(): ThetanutsReader {
  const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
  const client = new ThetanutsClient({ chainId: BASE_CHAIN_ID, provider });
  return {
    getMarketData: () => client.api.getMarketData(),
    fetchOrders: () => client.api.fetchOrders(),
  };
}

export function fetchThetanutsSnapshot(): Promise<ThetanutsSnapshot> {
  return fetchThetanutsSnapshotWith(createThetanutsReader());
}
