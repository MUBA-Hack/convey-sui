"use client";

import { useEffect, useRef, useState } from "react";
import type { StrategyIntent } from "@/lib/strategy/intent";
import { parseStrategyGoal } from "@/lib/strategy/intent";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";
import { deriveFamilyWatchBrief } from "@/lib/strategy/family-watch";
import { FamilyWatch } from "@/components/strategy/family-watch";
import {
  STRATEGY_NOTIONAL_LIMITS,
  STRATEGY_PRESETS,
  StrategyRequestPane,
} from "@/components/strategy/strategy-request-pane";
import { StrategyPayoffWorkspace } from "@/components/strategy/strategy-payoff-workspace";
import { StrategyMarketContext } from "@/components/strategy/strategy-market-context";

interface StrategyResponse {
  intent: StrategyIntent;
  market: ThetanutsSnapshot | null;
  execution: "none";
  disclosure: string;
}

/** Clamp a user-entered protected notional to a sensible positive display value. */
function clampNotional(value: number): number {
  if (!Number.isFinite(value) || value < STRATEGY_NOTIONAL_LIMITS.min) {
    return STRATEGY_NOTIONAL_LIMITS.min;
  }
  return Math.min(Math.floor(value), STRATEGY_NOTIONAL_LIMITS.max);
}

export interface StrategyDeskProps {
  remittanceContext?: RemittanceContext | null;
}

export function StrategyDesk({ remittanceContext }: StrategyDeskProps = {}) {
  const [goal, setGoal] = useState<string>(STRATEGY_PRESETS[0]);
  const [notional, setNotional] = useState<number>(
    remittanceContext?.amountMyr ?? STRATEGY_NOTIONAL_LIMITS.defaultValue,
  );
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Request-generation guard: every draft/preset change and every new submit
  // bumps this counter. A pending fetch captures its generation and must not
  // write result/error/pending once the generation has moved on, so a late
  // response for an abandoned draft can never overwrite the current draft state.
  const requestGeneration = useRef(0);

  // The single AbortController for any in-flight strategy fetch. Aborted on
  // draft/preset edit, new submit, and unmount so an abandoned request can
  // neither resolve onto stale state nor surface an unhandled rejection.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const inRemittanceContext = remittanceContext != null;

  /**
   * The single goal-update path. Any change to the draft (typing or choosing a
   * preset) invalidates the submitted result and any prior error, so a stale
   * ETH preview can never sit beside a new BTC draft. It also invalidates any
   * in-flight request: the AbortController cancels the network call, the
   * generation bump makes the pending fetch's result/error/finally no-ops, and
   * loading ends because the pending request no longer represents this draft.
   */
  function updateGoal(next: string) {
    setGoal(next);
    setResult(null);
    setError(null);
    abortControllerRef.current?.abort();
    requestGeneration.current += 1;
    setPending(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = (requestGeneration.current += 1);
    setResult(null);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
        signal: controller.signal,
      });
      if (requestGeneration.current !== generation) return;
      if (!response.ok) throw new Error("Request failed");
      const data = (await response.json()) as StrategyResponse;
      if (requestGeneration.current !== generation) return;
      setResult(data);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      // An abort is expected when the draft changes or a new submit supersedes
      // this one; it must never become a user-facing error.
      if (controller.signal.aborted || (error as { name?: string } | null)?.name === "AbortError") return;
      setError(
        "Live market context is unavailable. Your goal remains a conceptual shape and has not been priced.",
      );
    } finally {
      if (requestGeneration.current === generation) setPending(false);
    }
  }

  // Draft intent is derived immediately from the current goal via the existing
  // parser — no extra state. A resolved preview wins over the draft; a resolved
  // clarification suppresses the draft shape so the user is asked to refine.
  const draftIntent = parseStrategyGoal(goal);
  const draftStrategy = draftIntent.kind === "strategy" ? draftIntent : null;
  const resolvedStrategy = result?.intent.kind === "strategy" ? result.intent : null;
  const resolvedClarification =
    result?.intent.kind === "clarification" ? result.intent : null;
  const payoffIntent = resolvedStrategy ?? (resolvedClarification ? null : draftStrategy);

  // Family Watch unifies the declared family obligation with the latest
  // read-only market read already held by this desk. The resolved strategy
  // intent is carried in so Family Watch never implies an ETH-backed obligation
  // from remittance context alone.
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

  return (
    <section className="cv-shell mx-auto w-full max-w-[1180px] px-4 pt-5 md:pt-8">
      {/* Compact eyebrow/title */}
      <header className="mb-5 flex flex-col gap-1 px-1">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          {inRemittanceContext ? "Separate treasury planning" : "Treasury protection"}
        </p>
        <h1 className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] text-black sm:text-[40px]">
          {inRemittanceContext ? "Explore ETH treasury protection" : "Treasury"}
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[0.86fr_1.14fr]">
        <StrategyRequestPane
          goal={goal}
          inRemittanceContext={inRemittanceContext}
          notional={notional}
          payoffIntent={payoffIntent}
          pending={pending}
          remittanceContext={remittanceContext ?? null}
          onGoalChange={updateGoal}
          onNotionalChange={(next) => setNotional(clampNotional(next))}
          onSubmit={submit}
        />
        <StrategyPayoffWorkspace
          error={error}
          intent={payoffIntent}
          pending={pending}
          refinementMessage={refinementMessage}
        />
      </div>

      {resolvedStrategy && (
        <StrategyMarketContext
          market={result?.market ?? null}
          strategy={resolvedStrategy}
        />
      )}

      {/* Family Watch — full-width below, only when this desk was opened from a
          remittance deep-link. Standalone Protect has no declared family
          obligation, so it never shows an empty dead-end Family Watch card. */}
      {inRemittanceContext && (
        <div className="mt-5">
          <FamilyWatch brief={familyWatchBrief} />
        </div>
      )}
    </section>
  );
}
