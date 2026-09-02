"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown2, InfoCircle, ShieldSearch, TickCircle, Warning2 } from "@/components/icons";
import {
  AiDecisionReceiptVerificationSchema,
  type AiDecisionReceiptRecord,
  type AiDecisionReceiptVerification,
} from "@/lib/activity/ai-decision-receipt";

type ViewState = AiDecisionReceiptVerification | { kind: "checking" };

function stateLabel(state: ViewState): string {
  if (state.kind === "verified") return "AI route verified";
  if (state.kind === "mismatch" || state.kind === "not_found") {
    return "Needs another check";
  }
  if (state.kind === "unavailable") return "Verification unavailable";
  return "Needs another check";
}

function stateClass(state: ViewState): string {
  if (state.kind === "verified") return "border-black bg-black text-white";
  if (state.kind === "mismatch" || state.kind === "not_found") {
    return "border-black bg-white text-black";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-600";
}

function StateIcon({ state }: { state: ViewState }) {
  if (state.kind === "verified") {
    return <TickCircle size="17" variant="Linear" aria-hidden="true" />;
  }
  if (state.kind === "mismatch" || state.kind === "not_found") {
    return <Warning2 size="17" variant="Linear" aria-hidden="true" />;
  }
  if (state.kind === "checking") {
    return <ShieldSearch size="17" variant="Linear" aria-hidden="true" />;
  }
  return <InfoCircle size="17" variant="Linear" aria-hidden="true" />;
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} s`;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-t border-black/10 py-3 first:border-t-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 break-words text-[13px] leading-5 text-black">
        {children}
      </dd>
    </div>
  );
}

export function AiDecisionReceiptRow({
  record,
}: {
  record: AiDecisionReceiptRecord;
}) {
  const [state, setState] = useState<ViewState>({ kind: "checking" });
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch("/api/companion/receipt/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: record.requestId, expectedModel: record.model }),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const parsed = AiDecisionReceiptVerificationSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : { kind: "unavailable" as const };
      })
      .catch(() => ({ kind: "unavailable" as const }))
      .then((result) => {
        if (active) setState(result);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [record.model, record.requestId]);

  const label = stateLabel(state);
  const stateName = state.kind === "checking" ? "unavailable" : state.kind;

  return (
    <article
      data-testid="ai-decision-receipt"
      data-state={stateName}
      className="w-full min-w-0 overflow-hidden border border-black/15 bg-white"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
        className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 px-4 py-4 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-inset motion-reduce:transition-none sm:px-5 ${stateClass(state)}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0" aria-hidden="true">
            <StateIcon state={state} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium tracking-[-0.015em]">
              {label}
            </span>
            <span className="mt-0.5 block truncate text-[11px] opacity-65">
              Independent routing record
            </span>
          </span>
        </span>
        <ArrowDown2
          size="15"
          variant="Linear"
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={detailsId}
            data-testid="ai-decision-receipt-details"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <dl className="grid min-w-0 grid-cols-1 px-4 pb-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5 sm:pb-5">
              {state.kind === "verified" ? (
                <>
                  <Detail label="Model">{state.receipt.model}</Detail>
                  <Detail label="Node">{state.receipt.nodeId}</Detail>
                  <Detail label="Timestamp">{state.receipt.timestamp}</Detail>
                  <Detail label="Outcome">{state.receipt.outcome}</Detail>
                  <Detail label="Status">{state.receipt.statusCode}</Detail>
                  <Detail label="Tokens">
                    {state.receipt.totalTokens.toLocaleString("en-US")}
                  </Detail>
                  <Detail label="First response">{formatDuration(state.receipt.ttftMs)}</Detail>
                  <Detail label="Total time">{formatDuration(state.receipt.durationMs)}</Detail>
                </>
              ) : (
                <>
                  <Detail label="Model">{record.model}</Detail>
                  <Detail label="Requested at">{record.timestamp}</Detail>
                  <Detail label="Status">{label}</Detail>
                </>
              )}
            </dl>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}
