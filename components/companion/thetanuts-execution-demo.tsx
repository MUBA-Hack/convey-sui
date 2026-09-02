"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clock, Lock, ShieldTick, TickCircle } from "@/components/icons";
import {
  advanceDemoExecutionJournal,
  createDemoExecutionJournal,
  DEMO_THETANUTS_EXECUTION_FIXTURE,
  type DemoExecutionJournal,
} from "@/lib/strategy/thetanuts-demo-execution-journal";

function binding() {
  return {
    account: DEMO_THETANUTS_EXECUTION_FIXTURE.account,
    chainId: DEMO_THETANUTS_EXECUTION_FIXTURE.chainId,
    orderFingerprint: DEMO_THETANUTS_EXECUTION_FIXTURE.orderFingerprint,
  };
}

export function buildThetanutsDemoTrace(): readonly DemoExecutionJournal[] {
  const states: DemoExecutionJournal[] = [];
  let state = createDemoExecutionJournal(DEMO_THETANUTS_EXECUTION_FIXTURE);
  states.push(state);
  state = advanceDemoExecutionJournal(state, { type: "submit_approval", at: "2026-09-02T12:00:30.000Z", ...binding(), amountMicro: "3000000" });
  state = advanceDemoExecutionJournal(state, { type: "confirm_approval", at: "2026-09-02T12:01:00.000Z", ...binding(), amountMicro: "3000000" });
  states.push(state);
  state = advanceDemoExecutionJournal(state, { type: "submit_fill", at: "2026-09-02T12:01:30.000Z", ...binding(), caps: DEMO_THETANUTS_EXECUTION_FIXTURE.caps });
  state = advanceDemoExecutionJournal(state, { type: "mark_pending_verification", at: "2026-09-02T12:02:00.000Z", ...binding(), receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId });
  states.push(state);
  state = advanceDemoExecutionJournal(state, {
    type: "resolve_verification",
    outcome: "verified",
    at: "2026-09-02T12:02:30.000Z",
    ...binding(),
    receiptId: DEMO_THETANUTS_EXECUTION_FIXTURE.receiptId,
    observedPremiumMicro: "2800000",
    observedMaximumLossMicro: "2800000",
    observedSpendMicro: "2800000",
  });
  states.push(state);
  return Object.freeze(states);
}

const STEPS = [
  { label: "Policy reviewed", detail: "3 USDC maximum spend", icon: ShieldTick },
  { label: "Exact approval", detail: "No unlimited allowance", icon: Lock },
  { label: "Order checked", detail: "Account, chain, price and caps rebound", icon: Clock },
  { label: "Policy replay complete", detail: "Simulated cost: 2.80 USDC", icon: TickCircle },
] as const;

export function ThetanutsExecutionDemo() {
  const [trace] = useState(() => buildThetanutsDemoTrace());
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const reduceMotion = useReducedMotion();
  const state = trace[frame] ?? trace[0]!;

  useEffect(() => {
    if (!running || frame >= trace.length - 1) return;
    const timer = window.setTimeout(() => {
      setFrame((value) => {
        const next = value + 1;
        if (next >= trace.length - 1) setRunning(false);
        return next;
      });
    }, reduceMotion ? 0 : 620);
    return () => window.clearTimeout(timer);
  }, [frame, reduceMotion, running, trace.length]);

  return (
    <div className="thetanuts-demo">
      <div className="thetanuts-demo-rail" aria-live="polite">
        {STEPS.map(({ label, detail, icon: Icon }, index) => {
          const reached = index <= frame;
          return (
            <motion.div key={label} initial={false} animate={{ opacity: reached ? 1 : 0.3 }} data-reached={reached}>
              <span><Icon size={15} /></span>
              <p><b>{label}</b><small>{detail}</small></p>
            </motion.div>
          );
        })}
      </div>
      <button
        type="button"
        className="thetanuts-demo-play"
        disabled={running}
        onClick={() => {
          setFrame(0);
          setRunning(true);
        }}
      >
        {running ? "Checking each boundary…" : frame === trace.length - 1 ? "Replay overnight policy" : "Run overnight policy"}
      </button>
      <details className="companion-demo-disclosure companion-demo-disclosure--dark">
        <summary>Replay evidence</summary>
        <p>Deterministic simulation only. No wallet request, order broadcast, or live fill occurred.</p>
        <code>{state.receipt?.receiptId ?? state.status}</code>
      </details>
    </div>
  );
}
