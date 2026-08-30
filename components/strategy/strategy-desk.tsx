"use client";

import { useState } from "react";
import type { StrategyIntent } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";

interface StrategyResponse {
  intent: StrategyIntent;
  market: ThetanutsSnapshot | null;
  execution: "none";
  disclosure: string;
}

const PRESETS = [
  "Protect ETH downside for 30 days",
  "Earn premium on BTC",
  "Protect ETH and offset cost with premium",
] as const;

const DEFAULT_NOTIONAL = 2400;
const MIN_NOTIONAL = 1;
const MAX_NOTIONAL = 1_000_000;

/** Clamp a user-entered protected notional to a sensible positive display value. */
function clampNotional(value: number): number {
  if (!Number.isFinite(value) || value < MIN_NOTIONAL) return MIN_NOTIONAL;
  return Math.min(Math.floor(value), MAX_NOTIONAL);
}

/** Lightweight display parse for the identity/context row. Presentation only. */
function deriveContext(goal: string): { asset: string; horizon: string } {
  const lower = goal.toLowerCase();
  const asset = /\beth\b|ethereum/.test(lower)
    ? "ETH"
    : /\bbtc\b|bitcoin/.test(lower)
      ? "BTC"
      : "—";
  const horizonMatch = lower.match(/\b(\d{1,3})\s*(?:day|days|d)\b/);
  const horizon = horizonMatch ? `${horizonMatch[1]}-day horizon` : "Open horizon";
  return { asset, horizon };
}

export interface StrategyDeskProps {
  remittanceContext?: RemittanceContext | null;
}

export function StrategyDesk({ remittanceContext }: StrategyDeskProps = {}) {
  const [goal, setGoal] = useState<string>(PRESETS[0]);
  const [notional, setNotional] = useState<number>(
    remittanceContext?.amountMyr ?? DEFAULT_NOTIONAL,
  );
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inRemittanceContext = remittanceContext != null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      if (!response.ok) throw new Error("Request failed");
      setResult(await response.json() as StrategyResponse);
    } catch {
      setError("The strategy mapper is unavailable. No market data or strategy was invented.");
    } finally {
      setPending(false);
    }
  }

  const ctx = deriveContext(goal);
  const horizonValue =
    result?.intent.kind === "strategy" && result.intent.horizonDays
      ? `${result.intent.horizonDays} days`
      : ctx.horizon.replace(/ horizon/, "");

  return (
    <section className="cv-shell mx-auto w-full max-w-[760px] px-4 pt-5 md:pt-8">
      {/* Compact eyebrow/title */}
      <header className="mb-5 flex flex-col gap-1 px-1">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          {inRemittanceContext ? "Optional treasury preview" : "Downside protection"}
        </p>
        <h1 className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] text-black sm:text-[40px]">
          {inRemittanceContext ? "If these funds are held in ETH" : "Protect"}
        </h1>
      </header>

      <div className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl">
        {/* Identity/context row — ETH / 30-day horizon */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white"
          >
            {ctx.asset === "—" ? "?" : ctx.asset.slice(0, 3)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-[-0.01em] text-black">
              {ctx.asset}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">
              {ctx.horizon}
            </p>
          </div>
        </div>

        {/* Black figure block — protected notional leads, ETH downside companion, horizon secondary */}
        <div className="cv-money-tile mx-5 rounded-[18px] bg-black p-4 text-white">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
            ETH downside
          </p>
          <div className="mt-1 font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white">
            RM{notional.toLocaleString()}
          </div>
          <p className="mt-2 text-[12px] text-white/55">
            {horizonValue} · planning context
          </p>
        </div>

        {/* Labeled rows — risk goal, strategy status, review-before-trade */}
        <dl className="space-y-1.5 px-5 pt-3 pb-3 text-sm">
          {inRemittanceContext && remittanceContext && (
            <div
              data-testid="remittance-context-row"
              className="flex items-center justify-between gap-3"
            >
              <dt className="text-neutral-500">Related transfer</dt>
              <dd className="text-right text-neutral-700">
                {remittanceContext.recipient}, {remittanceContext.city} · RM
                {remittanceContext.amountMyr.toLocaleString()}.00
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Risk goal</dt>
            <dd className="text-right text-neutral-700">
              {result?.intent.kind === "strategy"
                ? result.intent.strategy.name
                : "Downside protection"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Strategy status</dt>
            <dd className="text-right text-neutral-700">
              {result ? "Preview ready" : "Awaiting preview"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Before trade</dt>
            <dd className="text-right text-neutral-700">User review required</dd>
          </div>
        </dl>

        {/* Goal input + primary action */}
        <form onSubmit={submit} className="border-t border-black/8 px-5 pt-4 pb-4">
          {/* Protected notional — client-side planning context, not a custody/execution claim */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <label
              htmlFor="strategy-notional"
              className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600"
            >
              Protected notional
            </label>
            <div className="flex items-center rounded-lg border border-black/10 bg-white px-2">
              <span className="text-sm font-semibold text-neutral-500">RM</span>
              <input
                id="strategy-notional"
                type="number"
                inputMode="numeric"
                min={MIN_NOTIONAL}
                max={MAX_NOTIONAL}
                step={100}
                value={notional}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setNotional(next > 0 ? clampNotional(next) : MIN_NOTIONAL);
                }}
                className="w-28 bg-transparent px-1 py-1.5 text-sm font-semibold tabular-nums text-black outline-none"
              />
            </div>
          </div>
          <label htmlFor="strategy-goal" className="sr-only">
            Strategy goal
          </label>
          <textarea
            id="strategy-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Protect my ETH downside for 30 days"
            className="w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm font-medium outline-none placeholder:text-black/35"
          />
          <button
            type="submit"
            disabled={pending || goal.trim().length === 0}
            className="cv-btn-solid mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {pending
              ? "Reading market…"
              : inRemittanceContext
                ? "Preview ETH hedge"
                : "Preview strategy"}
          </button>

          {/* Presets — compact edit disclosure, not a marketing chip cloud */}
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
              Edit goal presets
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setGoal(preset)}
                  className="min-h-11 w-full rounded-lg border border-black/8 bg-white px-3 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:border-black/14 hover:bg-neutral-50"
                >
                  {preset}
                </button>
              ))}
            </div>
          </details>
        </form>

        {inRemittanceContext && (
          <p
            data-testid="remittance-context-disclosure"
            className="border-t border-black/8 px-5 py-3 text-[11px] leading-5 text-neutral-500"
          >
            This educational preview is for an ETH position on Base. It does
            not protect the MYR→PHP rate, guarantee Ana&rsquo;s payout, or
            execute a trade.
          </p>
        )}

        {/* Result — connected second state within the same card */}
        {error && (
          <div
            role="alert"
            className="border-t border-black/8 px-5 py-4 text-sm leading-6 text-neutral-700"
          >
            {error}
          </div>
        )}

        {result?.intent.kind === "clarification" && (
          <div className="border-t border-black/8 px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              Clarification required
            </p>
            <p className="mt-2 text-base font-semibold tracking-[-0.01em] text-black">
              {result.intent.message}
            </p>
          </div>
        )}

        {result?.intent.kind === "strategy" && (
          <div className="border-t border-black/8 px-5 py-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              <span>{result.intent.asset}</span>
              <span>·</span>
              <span>
                {result.intent.horizonDays
                  ? `${result.intent.horizonDays} days`
                  : "Horizon open"}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-black">
              {result.intent.strategy.name}
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-700">
              {result.intent.strategy.thesis}
            </p>
            <p className="mt-3 border-l-2 border-black pl-4 text-sm leading-6 text-neutral-600">
              {result.intent.strategy.tradeoff}
            </p>

            {result.market?.status === "live" ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-black p-4 text-white">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                    {result.intent.asset} spot
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    ${result.market.prices[result.intent.asset]?.toLocaleString() ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-black/10 bg-white p-4">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-black/40">
                    OptionBook
                  </p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">
                    {result.market.orderCount} live orders
                  </p>
                </div>
                <p className="col-span-2 text-[11px] leading-5 text-neutral-500">
                  Live · Base mainnet
                </p>
              </div>
            ) : result.market ? (
              <div className="mt-4 rounded-xl border border-black/10 bg-white p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
                  Market unavailable
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  {result.market.reason}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {/* Educational preview footer + data source disclosure */}
        <div className="border-t border-black/8 px-5 py-3">
          <p className="text-[11px] font-semibold text-black">Educational preview</p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            Educational preview; you review before any trade. Not financial
            advice.
          </p>
          {result?.market?.status === "live" && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
                Data source
              </summary>
              <p className="mt-2 text-[11px] leading-5 text-neutral-500">
                Live read via the Thetanuts Finance SDK{" "}
                {result.market.sdkVersion} on Base mainnet.
              </p>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
