import type { StrategyResult } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";

interface StrategyMarketContextProps {
  market: ThetanutsSnapshot | null;
  strategy: StrategyResult;
  reserveScenarioUsdc: number;
}

function shortExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Expiry unavailable"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function StrategyMarketContext({
  market,
  strategy,
  reserveScenarioUsdc,
}: StrategyMarketContextProps) {
  const relevantOrders = market?.status === "live"
    ? market.samples.filter((order) => {
        if (order.asset !== strategy.asset) return false;
        if (strategy.objective === "protect_downside") {
          return order.optionType === "put" && order.side === "maker_sells";
        }
        if (strategy.objective === "earn_premium") {
          return order.side === "maker_buys" && order.optionType === "call";
        }
        return true;
      }).slice(0, 3)
    : [];
  return (
    <div className="cv-money-sheet cv-preview-in mt-5 overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-3">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Market context
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          <span>{strategy.asset}</span>
          <span>·</span>
          <span>
            {strategy.horizonDays ? `${strategy.horizonDays} days` : "Horizon open"}
          </span>
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-black">
          {strategy.strategy.name}
        </h2>
      </div>
      <div className="px-5 pb-5">
        <p className="text-sm leading-6 text-neutral-700">
          {strategy.strategy.thesis}
        </p>
        <p className="mt-3 border-l-2 border-black pl-4 text-sm leading-6 text-neutral-600">
          {strategy.strategy.tradeoff}
        </p>

        {market?.status === "live" ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-black p-4 text-white">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                {strategy.asset} spot
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                ${market.prices[strategy.asset]?.toLocaleString() ?? "Unavailable"}
              </p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                OptionBook
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {market.orderCount} across ETH and BTC
              </p>
            </div>
            <p className="col-span-2 text-[11px] leading-5 text-neutral-500">
              Live · Base mainnet
            </p>
          </div>
        ) : market ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              Market unavailable
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {market.reason}
            </p>
          </div>
        ) : null}

        {market?.status === "live" && relevantOrders.length > 0 && (
          <div className="mt-5 border-t border-black/8 pt-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/40">Orders in this scan</p>
                <p className="mt-1 text-sm text-neutral-600">Fresh terms are checked again before any wallet request.</p>
              </div>
              {strategy.objective !== "protect_downside" && (
                <span className="shrink-0 text-[11px] font-medium text-black/45">{reserveScenarioUsdc.toLocaleString()} USDC scenario</span>
              )}
            </div>
            <div className="mt-3 divide-y divide-black/8 rounded-xl border border-black/10 bg-white">
              {relevantOrders.map((order, index) => (
                <div key={`${order.expiry}-${order.strikeUsd}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-black">{order.side === "maker_sells" ? "Available to buy" : "Buyer waiting"}</p>
                    <p className="mt-1 text-[11px] text-black/45">{order.optionType.toUpperCase()} · {shortExpiry(order.expiry)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-black">{order.strikeUsd == null ? "Strike unavailable" : `$${order.strikeUsd.toLocaleString()} strike`}</p>
                    <p className="mt-1 text-[11px] tabular-nums text-black/45">${order.premium.toLocaleString()} / contract</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {market?.status === "live" && relevantOrders.length === 0 && (
          <div className="mt-5 border-t border-black/8 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/40">
              No matching order in this scan
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              The market is live, but this snapshot has no {strategy.asset} order
              matching the selected route. Nothing was prepared for approval.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
