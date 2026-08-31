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
  defaultValue: 2400,
  min: 1,
  max: 1_000_000,
  step: 100,
} as const;

export const STRATEGY_PREMIUM_LIMITS = {
  defaultValue: 50,
  min: 1,
  max: 1_000_000,
  step: 1,
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
  if (!intent) return "Premium budget";
  if (intent.objective === "earn_premium") return `${intent.asset} income`;
  if (intent.objective === "balanced_collar") return `${intent.asset} collar`;
  return `${intent.asset} premium budget`;
}

function horizonSublabel(intent: StrategyResult | null): string {
  if (intent?.horizonDays) return `${intent.horizonDays}-day horizon · planning only`;
  return "planning only · no purchase from this screen";
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
      <div className="px-6 pt-6 pb-4 md:px-8 md:pt-8">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
          Your goal
        </p>
        <p className="mt-2 max-w-[34ch] text-[17px] leading-7 text-neutral-600">
          Describe the treasury outcome you want. ETH and BTC protection stays
          separate from family transfers.
        </p>
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
              {strategyHeroLabel(payoffIntent)}
            </label>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-sans text-[44px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-white">
                RM
              </span>
              <input
                id="strategy-notional"
                type="number"
                inputMode="numeric"
                aria-label="Protected notional in MYR"
                min={STRATEGY_NOTIONAL_LIMITS.min}
                max={STRATEGY_NOTIONAL_LIMITS.max}
                step={STRATEGY_NOTIONAL_LIMITS.step}
                value={notional}
                onChange={(event) => onNotionalChange(Number(event.target.value))}
                className="w-full min-w-0 bg-transparent font-sans text-[44px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-white outline-none"
              />
            </div>
            <p className="mt-3 text-[13px] text-white/55">
              {horizonSublabel(payoffIntent)}
            </p>
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-1 flex-col px-6 pt-5 pb-6 md:px-8 md:pb-8">
        <label htmlFor="strategy-goal" className="sr-only">
          Strategy goal
        </label>
        <textarea
          id="strategy-goal"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Protect ETH downside for 30 days with a $50 premium budget"
          className="min-h-[7.5rem] w-full resize-none rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 text-[17px] font-medium leading-7 outline-none transition-[border-color,background-color] placeholder:text-black/35 focus:border-black/30 focus:bg-white"
        />

        <div className="mt-4 flex flex-col gap-2">
          <p className="text-[13px] font-medium text-neutral-500">Other ideas</p>
          {STRATEGY_PRESETS.filter((preset) => preset !== goal).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onGoalChange(preset)}
              className="min-h-12 rounded-xl border border-black/10 bg-white px-4 py-3 text-left text-[15px] font-medium leading-snug text-neutral-800 transition-colors hover:border-black/20 hover:bg-neutral-50"
            >
              {preset}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={pending || goal.trim().length === 0}
          aria-busy={pending}
          className="cv-btn-solid mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold tracking-[-0.01em] disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending
            ? "Looking…"
            : inRemittanceContext
              ? "Map protection"
              : protectDownside
                ? "Find protection"
                : "Map strategy"}
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
