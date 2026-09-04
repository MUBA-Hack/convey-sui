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
import { ProtectionReviewDialog } from "@/components/strategy/protection-review-dialog";
import {
  ProtectionWalletAction,
  readProtectionPurchaseRecovery,
  type ProtectionPurchaseRecovery,
} from "@/components/strategy/protection-wallet-action";

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
  const micro = Math.round(value * 1_000_000);
  const clamped = Math.min(micro / 1_000_000, STRATEGY_PREMIUM_LIMITS.max);
  return clamped;
}

export interface StrategyDeskProps {
  remittanceContext?: RemittanceContext | null;
}

export function StrategyDesk({ remittanceContext }: StrategyDeskProps = {}) {
  const [goal, setGoal] = useState<string>(STRATEGY_PRESETS[0]);
  const [notional, setNotional] = useState<number>(
    STRATEGY_NOTIONAL_LIMITS.defaultValue,
  );
  const [premiumBudgetUsd, setPremiumBudgetUsd] = useState<number>(
    STRATEGY_PREMIUM_LIMITS.defaultValue,
  );
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [purchaseStarted, setPurchaseStarted] = useState(false);
  const [purchaseRecovery, setPurchaseRecovery] = useState<ProtectionPurchaseRecovery | null>(null);

  const requestGeneration = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const recoveryTimer = window.setTimeout(() => {
      setPurchaseRecovery(readProtectionPurchaseRecovery());
    }, 0);
    return () => {
      window.clearTimeout(recoveryTimer);
      abortControllerRef.current?.abort();
    };
  }, []);

  const inRemittanceContext = remittanceContext != null;

  function updateGoal(next: string) {
    setGoal(next);
    setResult(null);
    setError(null);
    setReviewOpen(false);
    setPurchaseStarted(false);
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
    setReviewOpen(false);
    setPurchaseStarted(false);
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
  const journeyStep = purchaseRecovery?.kind === "verified"
    ? 3
    : purchaseStarted || recommendation?.kind === "live"
      ? 2
      : pending || result
        ? 1
        : 0;

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

  function adjustPurchase() {
    setReviewOpen(false);
    setPurchaseStarted(false);
    focusGoal();
  }

  return (
    <section className="cv-shell mx-auto w-full max-w-[1320px] px-5 pb-16 pt-8 md:px-8 md:pt-12">
      <header className="mb-6 grid gap-6 md:mb-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
        <div>
          <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
            {inRemittanceContext ? "Separate treasury goal" : "Treasury protection"}
          </p>
          <h1 className="mt-3 text-[48px] font-semibold leading-[0.92] tracking-[-0.05em] text-black md:text-[64px]">
            {inRemittanceContext ? "Explore ETH treasury protection" : "Treasury, with hard limits."}
          </h1>
          <p className="mt-4 max-w-[42ch] text-[18px] leading-7 text-neutral-600">
            Describe the outcome, match live Base orders, approve the exact move
            in your wallet, then keep an independently checked position receipt.
          </p>
        </div>

        <ol aria-label="Treasury journey" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-black/10 bg-white sm:grid-cols-4">
          {["Set limits", "Match live order", "Approve in wallet", "Verify position"].map((label, index) => (
            <li
              key={label}
              aria-current={journeyStep === index ? "step" : undefined}
              className={`min-h-20 border-b border-r border-black/8 px-4 py-4 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0 sm:min-h-24 sm:border-b-0 sm:border-r sm:last:border-r-0 ${journeyStep === index ? "bg-black text-white" : "text-black"}`}
            >
              <span className={`text-[10px] font-semibold tabular-nums ${journeyStep === index ? "text-white/45" : "text-black/35"}`}>0{index + 1}</span>
              <strong className="mt-5 block text-[13px] font-semibold leading-4">{label}</strong>
            </li>
          ))}
        </ol>
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
          {purchaseRecovery ? (
            <ProtectionWalletAction
              goal={purchaseRecovery.goal}
              premiumBudgetUsd={purchaseRecovery.premiumBudgetUsd}
              offerFingerprint={purchaseRecovery.offerFingerprint}
              recovery={purchaseRecovery}
              onAdjust={adjustPurchase}
            />
          ) : recommendation?.kind === "live" && purchaseStarted ? (
            <ProtectionWalletAction
              goal={goal}
              premiumBudgetUsd={premiumBudgetUsd}
              offerFingerprint={recommendation.offerFingerprint}
              onAdjust={adjustPurchase}
            />
          ) : recommendation ? (
            <StrategyShieldCard
              recommendation={recommendation}
              horizonDays={resolvedStrategy?.horizonDays ?? draftStrategy?.horizonDays ?? null}
              reviewed={false}
              onReview={() => recommendation.kind === "live" && setReviewOpen(true)}
              onAdjust={retryOrAdjust}
            />
          ) : (
            <StrategyPayoffWorkspace
              error={error}
              intent={payoffIntent}
              reserveScenarioUsdc={notional}
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
            reserveScenarioUsdc={notional}
          />
        </div>
      )}

      {inRemittanceContext && (
        <div className="mt-8">
          <FamilyWatch brief={familyWatchBrief} />
        </div>
      )}

      {recommendation?.kind === "live" ? (
        <ProtectionReviewDialog
          recommendation={recommendation}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          onContinue={() => {
            setReviewOpen(false);
            setPurchaseStarted(true);
          }}
        />
      ) : null}
    </section>
  );
}
