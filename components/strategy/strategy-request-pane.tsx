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

interface StrategyRequestPaneProps {
  goal: string;
  inRemittanceContext: boolean;
  notional: number;
  payoffIntent: StrategyResult | null;
  pending: boolean;
  remittanceContext: RemittanceContext | null;
  onGoalChange: (goal: string) => void;
  onNotionalChange: (notional: number) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

function strategyHeroLabel(intent: StrategyResult | null): string {
  if (!intent) return "Protected notional";
  if (intent.objective === "earn_premium") return `${intent.asset} income`;
  if (intent.objective === "balanced_collar") return `${intent.asset} collar`;
  return `${intent.asset} downside`;
}

function horizonSublabel(intent: StrategyResult | null): string {
  if (intent?.horizonDays) return `${intent.horizonDays}-day horizon · planning context`;
  return "planning context";
}

export function StrategyRequestPane({
  goal,
  inRemittanceContext,
  notional,
  payoffIntent,
  pending,
  remittanceContext,
  onGoalChange,
  onNotionalChange,
  onSubmit,
}: StrategyRequestPaneProps) {
  return (
    <div className="cv-money-sheet cv-preview-in flex min-w-0 flex-col overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-3">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Strategy request
        </p>
        <p className="mt-1 text-sm leading-6 text-neutral-600">
          Describe the outcome you want
        </p>
      </div>

      <div className="cv-money-tile mx-5 rounded-[18px] bg-black p-4 text-white">
        <label
          htmlFor="strategy-notional"
          className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55"
        >
          {strategyHeroLabel(payoffIntent)}
        </label>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white">
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
            className="w-full min-w-0 bg-transparent font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white outline-none"
          />
        </div>
        <p className="mt-2 text-[12px] text-white/55">
          {horizonSublabel(payoffIntent)}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-1 flex-col px-5 pt-4 pb-5">
        <label htmlFor="strategy-goal" className="sr-only">
          Strategy goal
        </label>
        <textarea
          id="strategy-goal"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Protect my ETH downside for 30 days"
          className="w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm font-medium outline-none placeholder:text-black/35"
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {STRATEGY_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onGoalChange(preset)}
              className="min-h-11 rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-left text-[11px] font-medium leading-tight text-neutral-700 transition-colors hover:border-black/14 hover:bg-neutral-50 lg:min-h-9"
            >
              {preset}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={pending || goal.trim().length === 0}
          className="cv-btn-solid mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending
            ? "Mapping…"
            : inRemittanceContext
              ? "Map protection"
              : "Map strategy"}
        </button>

        {remittanceContext && (
          <div
            data-testid="remittance-context-row"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-black/8 bg-white px-3 py-2"
          >
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              Related transfer
            </span>
            <span className="text-right text-xs text-neutral-700">
              {remittanceContext.recipient}, {remittanceContext.city} · RM
              {remittanceContext.amountMyr.toLocaleString()}.00
            </span>
          </div>
        )}

        {remittanceContext && (
          <p
            data-testid="remittance-context-disclosure"
            className="mt-3 text-[11px] leading-5 text-neutral-500"
          >
            Review the terms before you act. This preview does not protect the
            MYR→PHP rate or guarantee {remittanceContext.recipient}&rsquo;s payout.
          </p>
        )}
      </form>
    </div>
  );
}
