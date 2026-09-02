"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clock, ExportSquare, Lock, ShieldTick, TickCircle } from "@/components/icons";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import { PROTECTED_TRANSFER_REFERENCE } from "@/lib/remittance/protected-transfer-reference";
import {
  createProtectedTransferDemo,
  releaseProtectedTransferDemo,
  reviewProtectedTransferDemoEvidence,
  type ProtectedTransferDemoState,
} from "@/lib/remittance/protected-transfer-demo-lifecycle";

const PAYER = `0x${"1".repeat(64)}`;
const BENEFICIARY = `0x${"2".repeat(64)}`;
const REVIEWER = `0x${"3".repeat(64)}`;
const COMMITMENT = `0x${"ab".repeat(32)}`;

export function buildProtectedSupportDemoTrace(): readonly ProtectedTransferDemoState[] {
  const createdAtMs = Date.parse("2026-09-02T12:00:00.000Z");
  const created = createProtectedTransferDemo({
    mode: "demo",
    requestId: "support-create",
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "25000000",
    deadlineMs: createdAtMs + 3 * 86_400_000,
    evidenceCommitmentHex: COMMITMENT,
    createdAtMs,
  });
  const approved = reviewProtectedTransferDemoEvidence(created, {
    mode: "demo",
    requestId: "support-review",
    actorAddress: REVIEWER,
    nowMs: createdAtMs + 1_000,
    decision: "approve",
    evidenceCommitmentHex: COMMITMENT,
  });
  const released = releaseProtectedTransferDemo(approved, {
    mode: "demo",
    requestId: "support-release",
    actorAddress: REVIEWER,
    nowMs: createdAtMs + 2_000,
  });
  return Object.freeze([created, approved, released]);
}

const STEPS = [
  { status: "created", label: "Support protected", detail: "25 USDC held for Ana", icon: Lock },
  { status: "evidence_approved", label: "Pickup checked", detail: "Evidence matches the commitment", icon: ShieldTick },
  { status: "released", label: "Ready for Ana", detail: "Replay reached approved release", icon: TickCircle },
] as const;

export function ProtectedSupportDemoCard() {
  const [trace] = useState(() => buildProtectedSupportDemoTrace());
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
    <div className="companion-result protected-support-card">
      <div className="protected-support-head">
        <div>
          <p className="companion-eyebrow text-black/45">Medicine support</p>
          <h3>Protected until pickup.</h3>
          <p>Ana receives the money after the agreed evidence is checked. If time runs out, you can reclaim it.</p>
        </div>
        <span className="protected-support-amount">25 <small>USDC</small></span>
      </div>

      <div className="protected-support-rail" aria-live="polite">
        {STEPS.map(({ status, label, detail, icon: Icon }, index) => {
          const reached = index <= frame;
          return (
            <motion.div
              key={status}
              initial={false}
              animate={{ opacity: reached ? 1 : 0.36 }}
              className="protected-support-step"
              data-reached={reached}
            >
              <span><Icon size={16} /></span>
              <div><b>{label}</b><small>{detail}</small></div>
            </motion.div>
          );
        })}
      </div>

      <button
        type="button"
        className="protected-support-play"
        disabled={running}
        onClick={() => {
          setFrame(0);
          setRunning(true);
        }}
      >
        {running ? <><Clock size={16} /> Checking pickup…</> : frame === trace.length - 1 ? "Replay protected journey" : "Play protected journey"}
      </button>

      <div className="protected-support-reference">
        <div>
          <span><TickCircle size={15} variant="Bold" aria-hidden="true" /> Public reference</span>
          <p>The same release rule has completed on Sui.</p>
        </div>
        <a href={PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl} target="_blank" rel="noreferrer">
          View receipt <ExportSquare size={14} variant="Linear" aria-hidden="true" />
        </a>
      </div>

      <details className="companion-demo-disclosure">
        <summary>About this replay</summary>
        <p>{state.truthNotice} It executes the same role, evidence, deadline, replay, and terminal-state rules locally.</p>
        <p>The linked public reference is a separate {PROTECTED_TRANSFER_REFERENCE.amountDisplay} testnet lifecycle, not Ana&apos;s 25 USDC scenario or a fiat payout.</p>
        <code>{state.demoId}</code>
      </details>
    </div>
  );
}
