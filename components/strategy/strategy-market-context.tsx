import type { StrategyResult } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";

interface StrategyMarketContextProps {
  market: ThetanutsSnapshot | null;
  strategy: StrategyResult;
}

export function StrategyMarketContext({
  market,
  strategy,
}: StrategyMarketContextProps) {
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
                ${market.prices[strategy.asset]?.toLocaleString() ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                OptionBook
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {market.orderCount} live orders
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
      </div>
    </div>
  );
}
