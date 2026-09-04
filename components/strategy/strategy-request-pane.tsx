"use client";

import type { FormEventHandler } from "react";
import type { StrategyResult } from "@/lib/strategy/intent";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";

export const STRATEGY_PRESETS = [
  "Protect ETH downside for 30 days",
  "Earn premium on BTC",
  "Protect ETH and offset cost with premium",
] as const;

export const STRATEGY_NOTIONAL_LIMITS = {
  defaultValue: 500,
  min: 1,
  max: 1_000_000,
  step: 50,
} as const;

const STRATEGY_ROUTE_COPY: Record<(typeof STRATEGY_PRESETS)[number], { label: string; detail: string }> = {
  "Protect ETH downside for 30 days": { label: "Protect", detail: "Buy a bounded floor" },
  "Earn premium on BTC": { label: "Earn", detail: "Scan income orders" },
  "Protect ETH and offset cost with premium": { label: "Balance", detail: "Map a two-sided goal" },
};

export const STRATEGY_PREMIUM_LIMITS = {
  defaultValue: 3,
  min: 0.000001,
  max: 3,
  step: 0.000001,
} as const;

interface StrategyRequestPaneProps {
  goal: string;
  inRemittanceContext: boolean;
  notional: number;
  premiumBudgetUsd: number;
  payoffIntent: StrategyResult | null;
  pending: boolean;
  remittanceContext: RemittanceContext | null;
  onGoalChange: (goal: string) => void;
  onNotionalChange: (notional: number) => void;
  onPremiumBudgetChange: (budget: number) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

function strategyHeroLabel(intent: StrategyResult | null): string {
  if (!intent) return "Protection budget";
  if (intent.objective === "earn_premium") return `${intent.asset} income`;
  if (intent.objective === "balanced_collar") return `${intent.asset} collar`;
  return `${intent.asset} protection budget`;
}

function horizonSublabel(intent: StrategyResult | null): string {
  if (intent?.horizonDays) return `${intent.horizonDays}-day goal · nothing purchased yet`;
  return "Nothing purchased until you review and approve";
}

export function StrategyRequestPane({
  goal,
  inRemittanceContext,
  notional,
  premiumBudgetUsd,
  payoffIntent,
  pending,
  remittanceContext,
  onGoalChange,
  onNotionalChange,
  onPremiumBudgetChange,
  onSubmit,
}: StrategyRequestPaneProps) {
  const protectDownside = payoffIntent?.objective === "protect_downside";

  return (
    <div className="cv-money-sheet flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl lg:min-h-[36rem]">
      <div className="px-6 pt-6 pb-3 md:px-8 md:pt-8">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
          Your goal
        </p>
        <p className="mt-2 max-w-[34ch] text-[16px] leading-6 text-neutral-600">
          Describe the outcome you want for ETH or BTC you hold. Family
          transfers stay separate.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1.5 px-6 pb-4 md:px-8" aria-label="Treasury strategy routes">
        {STRATEGY_PRESETS.map((preset) => {
          const copy = STRATEGY_ROUTE_COPY[preset];
          const selected = preset === goal;
          return (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              aria-pressed={selected}
              onClick={() => onGoalChange(preset)}
              className={`min-h-16 rounded-xl border px-3 py-2.5 text-left transition-colors ${selected ? "border-black bg-black text-white" : "border-black/10 bg-white text-black hover:border-black/25"}`}
            >
              <strong className="block text-[13px] font-semibold">{copy.label}</strong>
              <small className={`mt-1 block text-[10px] leading-4 ${selected ? "text-white/52" : "text-black/45"}`}>{copy.detail}</small>
            </button>
          );
        })}
      </div>

      <div className="cv-money-tile mx-6 rounded-[22px] bg-black p-5 text-white md:mx-8 md:p-6">
        {protectDownside ? (
          <>
            <label
              htmlFor="strategy-premium-budget"
              className="text-[13px] font-medium text-white/55"
            >
              {strategyHeroLabel(payoffIntent)}
            </label>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-sans text-[44px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-white">
                $
              </span>
              <input
                id="strategy-premium-budget"
                type="number"
                inputMode="decimal"
                aria-label="Premium budget in USD"
                min={STRATEGY_PREMIUM_LIMITS.min}
                max={STRATEGY_PREMIUM_LIMITS.max}
                step={STRATEGY_PREMIUM_LIMITS.step}
                value={premiumBudgetUsd}
                onChange={(event) =>
                  onPremiumBudgetChange(Number(event.target.value))
                }
                className="w-full min-w-0 bg-transparent font-sans text-[44px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-white outline-none"
              />
            </div>
            <p className="mt-3 text-[13px] text-white/55">
              {horizonSublabel(payoffIntent)}
            </p>
          </>
        ) : (
          <>
            <label
              htmlFor="strategy-notional"
              className="text-[13px] font-medium text-white/55"
            >
              USDC reserve scenario
            </label>
            <div className="mt-2 flex items-baseline gap-2">
              <input
                id="strategy-notional"
                type="number"
                inputMode="decimal"
                aria-label="Reserve scenario in USDC"
                min={STRATEGY_NOTIONAL_LIMITS.min}
                max={STRATEGY_NOTIONAL_LIMITS.max}
                step={STRATEGY_NOTIONAL_LIMITS.step}
                value={notional}
                onChange={(event) => onNotionalChange(Number(event.target.value))}
                className="w-full min-w-0 bg-transparent font-sans text-[44px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-white outline-none"
              />
              <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/45">USDC</span>
            </div>
            <p className="mt-3 text-[13px] text-white/55">
              {horizonSublabel(payoffIntent)}
            </p>
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-1 flex-col px-6 pt-4 pb-6 md:px-8 md:pb-8">
        <label htmlFor="strategy-goal" className="sr-only">
          Strategy goal
        </label>
        <textarea
          id="strategy-goal"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Protect ETH downside for 30 days with a $3 budget"
          className="min-h-[6.5rem] w-full resize-none rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 text-[17px] font-medium leading-7 outline-none transition-[border-color,background-color] motion-reduce:transition-none placeholder:text-black/35 focus:border-black/30 focus:bg-white"
        />

        <button
          type="submit"
          disabled={pending || goal.trim().length === 0}
          aria-busy={pending}
          className="cv-btn-solid mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold tracking-[-0.01em] disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending
            ? "Finding protection…"
            : inRemittanceContext
              ? "Find treasury protection"
              : protectDownside
                ? "Find protection"
                : payoffIntent?.objective === "earn_premium"
                  ? "Scan live income"
                  : "Explore balanced goal"}
        </button>

        {remittanceContext && (
          <div
            data-testid="remittance-context-row"
            className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-black/8 bg-white px-4 py-3"
          >
            <span className="text-[13px] font-medium text-neutral-500">
              Related transfer
            </span>
            <span className="text-right text-sm text-neutral-700">
              {remittanceContext.recipient}, {remittanceContext.city} · RM
              {remittanceContext.amountMyr.toLocaleString()}.00
            </span>
          </div>
        )}

        {remittanceContext && (
          <p
            data-testid="remittance-context-disclosure"
            className="mt-3 text-[13px] leading-6 text-neutral-500"
          >
            Review the terms before you act. This preview does not protect the
            MYR→PHP rate or guarantee {remittanceContext.recipient}&rsquo;s payout.
          </p>
        )}
      </form>
    </div>
  );
}
