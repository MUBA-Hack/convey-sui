"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clock, CloseCircle, ExportSquare, Lock, ShieldTick, TickCircle } from "@/components/icons";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import { PROTECTED_TRANSFER_REFERENCE } from "@/lib/remittance/protected-transfer-reference";
import { parseUsdcDecimalToMicro } from "@/lib/remittance/receipt-split";
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

export type ProtectedAgreementScenario = "medicine" | "relief" | "freelance" | "rental" | "grant";

const SCENARIOS: Record<ProtectedAgreementScenario, {
  eyebrow: string;
  title: string;
  body: string;
  held: string;
  reviewed: string;
  released: string;
}> = {
  medicine: {
    eyebrow: "Medicine support",
    title: "Protected until pickup.",
    body: "Ana receives the money after the agreed evidence is checked. If time runs out, you can reclaim it.",
    held: "Support protected",
    reviewed: "Pickup checked",
    released: "Ready for Ana",
  },
  relief: {
    eyebrow: "Emergency support",
    title: "Release follows evidence.",
    body: "The recipient receives the funds after delivery evidence is reviewed. Expiry returns control to the sender.",
    held: "Aid protected",
    reviewed: "Delivery checked",
    released: "Aid released",
  },
  freelance: {
    eyebrow: "Independent work",
    title: "Delivery unlocks payment.",
    body: "The client funds the agreement first. A reviewer checks the agreed milestone before payment can be released.",
    held: "Payment protected",
    reviewed: "Delivery checked",
    released: "Freelancer paid",
  },
  rental: {
    eyebrow: "Rental agreement",
    title: "Deposit held fairly.",
    body: "Check-in and checkout evidence determine whether the deposit returns or an approved damage amount is released.",
    held: "Deposit protected",
    reviewed: "Condition checked",
    released: "Outcome settled",
  },
  grant: {
    eyebrow: "Grant funding",
    title: "Milestones unlock tranches.",
    body: "Funds stay protected until the agreed deliverable and budget evidence are reviewed, then release leaves a public receipt.",
    held: "Grant protected",
    reviewed: "Milestone checked",
    released: "Tranche released",
  },
};

export function buildProtectedSupportDemoTrace(amountMajor = "25"): readonly ProtectedTransferDemoState[] {
  const parsedAmount = parseUsdcDecimalToMicro(amountMajor);
  const amountMicro = parsedAmount.ok ? parsedAmount.micro : "25000000";
  const createdAtMs = Date.parse("2026-09-02T12:00:00.000Z");
  const created = createProtectedTransferDemo({
    mode: "demo",
    requestId: "support-create",
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro,
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

export function ProtectedSupportDemoCard({
  amountMajor = "25",
  scenario = "medicine",
  referenceMode = false,
  onClose,
}: {
  amountMajor?: string;
  scenario?: ProtectedAgreementScenario;
  referenceMode?: boolean;
  onClose?: () => void;
}) {
  const [trace] = useState(() => buildProtectedSupportDemoTrace(amountMajor));
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const reduceMotion = useReducedMotion();
  const state = trace[frame] ?? trace[0]!;
  const copy = SCENARIOS[scenario];
  const steps = [
    { status: "created", label: referenceMode ? "Locked by contract" : copy.held, detail: referenceMode ? "1 USDC entered protected custody" : `${amountMajor} USDC held by the agreement`, icon: Lock },
    { status: "evidence_approved", label: referenceMode ? "Reviewed independently" : copy.reviewed, detail: referenceMode ? "Reviewer approved the agreed evidence" : "Evidence matches the commitment", icon: ShieldTick },
    { status: "released", label: referenceMode ? "Released to Ana" : copy.released, detail: referenceMode ? "Contract paid the fixed beneficiary" : "Replay reached the approved outcome", icon: TickCircle },
  ] as const;

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
    <div className={`companion-result protected-support-card${referenceMode ? " protected-support-card--reference" : ""}`}>
      {onClose && (
        <button type="button" className="protected-support-close" aria-label="Close smart contract demo" onClick={onClose} autoFocus>
          <CloseCircle size={20} />
        </button>
      )}
      <div className="protected-support-head">
        <div>
          <p className="companion-eyebrow text-black/45">{referenceMode ? "Completed on Sui testnet" : copy.eyebrow}</p>
          <h3>{referenceMode ? "1 USDC moved by contract." : copy.title}</h3>
          <p>{referenceMode ? "Watch a real protected payment move from lock to independent review to Ana, then inspect the public transactions." : copy.body}</p>
        </div>
        {!referenceMode && <span className="protected-support-amount">{amountMajor} <small>USDC</small></span>}
      </div>

      <div className="protected-support-rail" aria-live="polite">
        {steps.map(({ status, label, detail, icon: Icon }, index) => {
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
        {running ? <><Clock size={16} /> {referenceMode ? "Following transactions…" : "Checking evidence…"}</> : frame === trace.length - 1 ? (referenceMode ? "Replay contract lifecycle" : "Replay protected journey") : (referenceMode ? "Play contract lifecycle" : "Play protected journey")}
      </button>

      <div className="protected-support-reference">
        <div>
          <span><TickCircle size={15} variant="Bold" aria-hidden="true" /> {referenceMode ? "Public testnet receipt" : "Public reference"}</span>
          <p>{referenceMode ? "Both transaction digests and the published package are independently inspectable." : "The same release and refund rules have completed on Sui."}</p>
        </div>
        <div className="protected-support-reference-links">
          {referenceMode && (
            <a href={PROTECTED_TRANSFER_REFERENCE.createdExplorerUrl} target="_blank" rel="noreferrer">
              Lock transaction <ExportSquare size={14} variant="Linear" aria-hidden="true" />
            </a>
          )}
          <a href={PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl} target="_blank" rel="noreferrer">
            {referenceMode ? "Release transaction" : "Release"} <ExportSquare size={14} variant="Linear" aria-hidden="true" />
          </a>
          {referenceMode ? (
            <a href={PROTECTED_TRANSFER_REFERENCE.packageExplorerUrl} target="_blank" rel="noreferrer">
              View contract <ExportSquare size={14} variant="Linear" aria-hidden="true" />
            </a>
          ) : (
            <a href={PROTECTED_TRANSFER_REFERENCE.refundedExplorerUrl} target="_blank" rel="noreferrer">
              Refund <ExportSquare size={14} variant="Linear" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      <details className="companion-demo-disclosure">
        <summary>{referenceMode ? "Contract details" : "About this replay"}</summary>
        {referenceMode ? (
          <>
            <p>This animation replays an already completed public {PROTECTED_TRANSFER_REFERENCE.amountDisplay} payment. It does not request a new wallet signature.</p>
            <p>Beneficiary {PROTECTED_TRANSFER_REFERENCE.beneficiaryAddress.slice(0, 10)}… · reviewer {PROTECTED_TRANSFER_REFERENCE.reviewerAddress.slice(0, 10)}…</p>
            <code>{PROTECTED_TRANSFER_REFERENCE.escrowObjectId}</code>
          </>
        ) : (
          <>
            <p>{state.truthNotice} It executes the same role, evidence, deadline, replay, and terminal-state rules locally.</p>
            <p>The public reference proves a separate {PROTECTED_TRANSFER_REFERENCE.amountDisplay} on-chain lifecycle. This card remains a local replay, not a fiat payout.</p>
            <code>{state.demoId}</code>
          </>
        )}
      </details>
    </div>
  );
}
