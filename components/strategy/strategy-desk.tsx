"use client";

import { useState } from "react";
import type { StrategyIntent } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";

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

function EvidenceBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{children}</span>;
}

export function StrategyDesk() {
  const [goal, setGoal] = useState<string>(PRESETS[0]);
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-[calc(100vh-60px)] bg-[#050505] text-white">
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)] lg:px-12 lg:py-16">
        <div className="flex min-h-[560px] flex-col justify-between rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_80%_10%,rgba(255,255,255,.12),transparent_32%),linear-gradient(145deg,#111,#030303_62%)] p-6 shadow-2xl shadow-black sm:p-10">
          <div>
            <div className="mb-8 flex flex-wrap gap-2">
              <EvidenceBadge>Official SDK 0.3.0</EvidenceBadge>
              <EvidenceBadge>Server-only SDK</EvidenceBadge>
              <EvidenceBadge>No signer</EvidenceBadge>
              <EvidenceBadge>No trade submitted</EvidenceBadge>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Convey Protect</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">Turn a risk goal into a strategy map.</h1>
            <p className="mt-6 max-w-xl text-sm leading-6 text-white/55 sm:text-base">Deterministic education, placed beside live Base orderbook context read through the Thetanuts SDK. No wallet, approval, signature, or execution path exists here.</p>
          </div>

          <form onSubmit={submit} className="mt-12 rounded-[1.5rem] border border-white/15 bg-white p-2 text-black shadow-[0_24px_80px_rgba(0,0,0,.45)]">
            <label htmlFor="strategy-goal" className="sr-only">Strategy goal</label>
            <textarea id="strategy-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} rows={3} className="w-full resize-none rounded-2xl px-4 py-3 text-base font-medium outline-none placeholder:text-black/35" placeholder="Protect my ETH downside for 30 days" />
            <div className="flex items-center justify-between gap-3 border-t border-black/10 px-2 pt-2">
              <span className="hidden text-xs text-black/45 sm:block">Schema-bound · education only</span>
              <button disabled={pending || goal.trim().length === 0} className="ml-auto rounded-full bg-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:scale-[1.02] disabled:opacity-45">{pending ? "Reading market…" : "Map strategy"}</button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => setGoal(preset)} className="rounded-full border border-white/15 px-3 py-2 text-left text-xs text-white/55 transition hover:border-white/40 hover:text-white">{preset.replace(/ for 30 days/, "")}</button>
            ))}
          </div>
        </div>

        <aside className="flex min-h-[560px] flex-col rounded-[2rem] border border-black/10 bg-[#f3f3f1] p-6 text-black sm:p-8">
          <div className="flex items-start justify-between gap-4 border-b border-black/10 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/40">Read-only result</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Strategy evidence</h2>
            </div>
            <span className="h-3 w-3 rounded-full bg-black shadow-[0_0_0_6px_rgba(0,0,0,.08)]" />
          </div>

          <div className="flex flex-1 flex-col justify-center py-8">
            {!result && !error && (
              <div className="space-y-5 text-black/45">
                <p className="text-5xl font-semibold tracking-[-0.06em] text-black/15">01 → 03</p>
                <p className="max-w-sm text-sm leading-6">State a goal. Convey maps it deterministically. The server then attempts a bounded, public market read.</p>
              </div>
            )}
            {error && <p role="alert" className="rounded-2xl border border-black/10 bg-white p-5 text-sm leading-6">{error}</p>}
            {result?.intent.kind === "clarification" && (
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/40">Clarification required</p><p className="mt-3 text-2xl font-semibold tracking-[-0.035em]">{result.intent.message}</p></div>
            )}
            {result?.intent.kind === "strategy" && (
              <div className="space-y-7">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/40"><span>{result.intent.asset}</span><span>·</span><span>{result.intent.horizonDays ? `${result.intent.horizonDays} days` : "Horizon open"}</span></div>
                  <h3 className="mt-3 text-4xl font-semibold tracking-[-0.055em]">{result.intent.strategy.name}</h3>
                  <p className="mt-4 text-sm leading-6 text-black/65">{result.intent.strategy.thesis}</p>
                  <p className="mt-3 border-l-2 border-black pl-4 text-sm leading-6 text-black/55">{result.intent.strategy.tradeoff}</p>
                </div>

                {result.market?.status === "live" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-black p-4 text-white"><p className="text-[10px] uppercase tracking-[0.16em] text-white/45">{result.intent.asset} spot</p><p className="mt-2 text-2xl font-semibold">${result.market.prices[result.intent.asset]?.toLocaleString() ?? "—"}</p></div>
                    <div className="rounded-2xl border border-black/10 bg-white p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-black/40">OptionBook</p><p className="mt-2 text-2xl font-semibold">{result.market.orderCount} live orders</p></div>
                    <p className="col-span-2 text-[11px] leading-5 text-black/45">Live read · Base mainnet · Thetanuts Finance SDK {result.market.sdkVersion}</p>
                  </div>
                ) : result.market ? (
                  <div className="rounded-2xl border border-black/10 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em]">Market unavailable</p><p className="mt-2 text-sm leading-6 text-black/55">{result.market.reason}</p></div>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-black/10 pt-5 text-xs leading-5 text-black/50">
            <p className="font-semibold text-black">No execution occurred</p>
            <p>Read-only preview, not financial advice, and not bounty-complete. A qualifying submission still requires a real Base mainnet OptionBook or Factory trade.</p>
          </div>
        </aside>
      </section>
    </div>
  );
}
