"use client";

import { useEffect, useRef, useState } from "react";

import type { StrategyIntent } from "@/lib/strategy/intent";
import { parseStrategyGoal } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";
import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";
import { deriveFamilyWatchBrief } from "@/lib/strategy/family-watch";
import { FamilyWatch } from "@/components/strategy/family-watch";
import {
  STRATEGY_NOTIONAL_LIMITS,
  STRATEGY_PREMIUM_LIMITS,
  STRATEGY_PRESETS,
  StrategyRequestPane,
} from "@/components/strategy/strategy-request-pane";
import { StrategyPayoffWorkspace } from "@/components/strategy/strategy-payoff-workspace";
import { StrategyMarketContext } from "@/components/strategy/strategy-market-context";
import { StrategyShieldCard } from "@/components/strategy/strategy-shield-card";

interface StrategyResponse {
  intent: StrategyIntent;
  market?: ThetanutsSnapshot | null;
  recommendation?: ShieldRecommendation;
  execution: "none";
  disclosure: string;
}

function clampNotional(value: number): number {
  if (!Number.isFinite(value) || value < STRATEGY_NOTIONAL_LIMITS.min) {
    return STRATEGY_NOTIONAL_LIMITS.min;
  }
  return Math.min(Math.floor(value), STRATEGY_NOTIONAL_LIMITS.max);
}

function clampPremiumBudget(value: number): number {
  if (!Number.isFinite(value) || value < STRATEGY_PREMIUM_LIMITS.min) {
    return STRATEGY_PREMIUM_LIMITS.min;
  }
  const cents = Math.round(value * 100);
  const clamped = Math.min(cents / 100, STRATEGY_PREMIUM_LIMITS.max);
  return clamped;
}

export interface StrategyDeskProps {
  remittanceContext?: RemittanceContext | null;
}

export function StrategyDesk({ remittanceContext }: StrategyDeskProps = {}) {
  const [goal, setGoal] = useState<string>(STRATEGY_PRESETS[0]);
  const [notional, setNotional] = useState<number>(
    remittanceContext?.amountMyr ?? STRATEGY_NOTIONAL_LIMITS.defaultValue,
  );
  const [premiumBudgetUsd, setPremiumBudgetUsd] = useState<number>(
    STRATEGY_PREMIUM_LIMITS.defaultValue,
  );
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);

  const requestGeneration = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const inRemittanceContext = remittanceContext != null;

  function updateGoal(next: string) {
    setGoal(next);
    setResult(null);
    setError(null);
    setReviewed(false);
    abortControllerRef.current?.abort();
    requestGeneration.current += 1;
    setPending(false);
  }

  const draftIntent = parseStrategyGoal(goal);
  const draftStrategy = draftIntent.kind === "strategy" ? draftIntent : null;
  const shieldEligible =
    draftStrategy?.objective === "protect_downside" &&
    draftStrategy.horizonDays != null;

  async function runRequest() {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = (requestGeneration.current += 1);
    setResult(null);
    setReviewed(false);
    setPending(true);
    setError(null);
    try {
      const body: { goal: string; premiumBudgetUsd?: number } = { goal };
      if (shieldEligible) {
        body.premiumBudgetUsd = premiumBudgetUsd;
      }
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (requestGeneration.current !== generation) return;
      if (!response.ok) throw new Error("Request failed");
      const data = (await response.json()) as StrategyResponse;
      if (requestGeneration.current !== generation) return;
      setResult(data);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      if (controller.signal.aborted || (error as { name?: string } | null)?.name === "AbortError") return;
      setError(
        "Live market context is unavailable. Your goal remains a conceptual shape and has not been priced.",
      );
    } finally {
      if (requestGeneration.current === generation) setPending(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await runRequest();
  }

  const resolvedStrategy = result?.intent.kind === "strategy" ? result.intent : null;
  const resolvedClarification =
    result?.intent.kind === "clarification" ? result.intent : null;
  const payoffIntent = resolvedStrategy ?? (resolvedClarification ? null : draftStrategy);
  const recommendation = result?.recommendation ?? null;

  const familyWatchBrief = deriveFamilyWatchBrief({
    remittance: remittanceContext ?? null,
    market: result?.market ?? null,
    strategy: result?.intent ?? null,
  });

  const refinementMessage = payoffIntent || pending
    ? null
    : resolvedClarification?.message ??
      (draftIntent.kind === "clarification"
        ? draftIntent.message
        : "Describe a plain-language ETH or BTC risk goal to see a payoff shape.");

  function focusGoal() {
    const el = document.getElementById("strategy-goal") as HTMLTextAreaElement | null;
    el?.focus();
  }

  function retryOrAdjust() {
    if (recommendation?.kind === "unavailable") {
      void runRequest();
      return;
    }
    focusGoal();
  }

  return (
    <section className="cv-shell mx-auto w-full max-w-[1320px] px-5 pb-16 pt-8 md:px-8 md:pt-12">
      <header className="mb-8 max-w-[40rem] md:mb-10">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
          {inRemittanceContext ? "Separate treasury planning" : "Treasury protection"}
        </p>
        <h1 className="mt-3 text-[48px] font-semibold leading-[0.92] tracking-[-0.05em] text-black md:text-[64px]">
          {inRemittanceContext ? "Explore ETH treasury protection" : "Treasury"}
        </h1>
        <p className="mt-4 max-w-[36ch] text-[18px] leading-7 text-neutral-600">
          Map an ETH or BTC goal. Protection here never covers a family transfer
          rate or payout.
        </p>
      </header>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.18fr)] lg:gap-8">
        <StrategyRequestPane
          goal={goal}
          inRemittanceContext={inRemittanceContext}
          notional={notional}
          premiumBudgetUsd={premiumBudgetUsd}
          payoffIntent={payoffIntent}
          pending={pending}
          remittanceContext={remittanceContext ?? null}
          onGoalChange={updateGoal}
          onNotionalChange={(next) => setNotional(clampNotional(next))}
          onPremiumBudgetChange={(next) => setPremiumBudgetUsd(clampPremiumBudget(next))}
          onSubmit={submit}
        />
        <div className="min-w-0">
          {recommendation ? (
            <StrategyShieldCard
              recommendation={recommendation}
              horizonDays={resolvedStrategy?.horizonDays ?? draftStrategy?.horizonDays ?? null}
              reviewed={reviewed}
              onReview={() => setReviewed(true)}
              onAdjust={retryOrAdjust}
            />
          ) : (
            <StrategyPayoffWorkspace
              error={error}
              intent={payoffIntent}
              pending={pending}
              refinementMessage={refinementMessage}
            />
          )}
        </div>
      </div>

      {resolvedStrategy && !recommendation && (
        <div className="mt-8">
          <StrategyMarketContext
            market={result?.market ?? null}
            strategy={resolvedStrategy}
          />
        </div>
      )}

      {inRemittanceContext && (
        <div className="mt-8">
          <FamilyWatch brief={familyWatchBrief} />
        </div>
      )}
    </section>
  );
}
