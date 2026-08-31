"use client";

import { useState } from "react";
import { ArrowRight2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  evaluateFamilyGuardian,
  type FamilyGuardianBlocker,
  type GuardianCheck,
  type GuardianCheckStatus,
} from "@/lib/remittance/family-guardian";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { FamilyStewardCard } from "./family-steward-card";

/**
 * Product-language display labels for each check status. The raw enum values
 * are an implementation detail of the guardian model and must never reach the
 * customer; this map is the single place that translates them to copy.
 */
const STATUS_LABEL: Record<GuardianCheckStatus, string> = {
  pass: "Checked",
  fail: "Needs attention",
  required: "Action needed",
  "not-stated": "Not stated",
};

export interface FamilyGuardianCardProps {
  quote: QuoteEnvelope;
  blocker: FamilyGuardianBlocker;
  now: number;
}

/**
 * Presentational pre-verification review card for the quote review surface. All
 * decision logic lives in `evaluateFamilyGuardian`; this component only renders
 * the report: one concise overall state line, plus a collapsible evidence list.
 *
 * Product language only — no SDK versions, debug labels, or demo badges. The
 * card never claims on-chain verification, settlement, safe-to-sign status, or
 * wallet authorization before wallet approval. The evidence list is local
 * preflight, not a server-verified result.
 */
export function FamilyGuardianCard({ quote, blocker, now }: FamilyGuardianCardProps) {
  const report = evaluateFamilyGuardian({ quote, blocker, now });
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="family-guardian-card"
      className="mx-4 mb-3 overflow-hidden rounded-xl border border-black/10"
    >
      <div className="flex items-center gap-2.5 bg-white px-4 py-3">
        <GuardianMark status={report.overall === "ready" ? "ready" : "blocked"} />
        <p
          data-testid="family-guardian-headline"
          className="text-sm font-semibold leading-tight tracking-[-0.01em] text-black"
        >
          {report.headline}
        </p>
      </div>

      {/* Optional in-flow warning-sign check. Advisory only — never modifies the
          quote, blocker, path, wallet, or receipt. Sits above the deterministic
          Transfer checks so a curious customer can paste the requesting message
          without disturbing the pre-verification evidence below. */}
      <FamilyStewardCard quote={quote} />

      <button
        type="button"
        data-hit-target="true"
        data-testid="family-guardian-evidence-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[40px] items-center justify-between gap-3 border-t border-black/8 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50"
      >
        <span>Transfer checks</span>
        <ArrowRight2
          size={14}
          variant="Linear"
          className={cn(
            "shrink-0 text-neutral-400 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <ul className="cv-disclosure-panel divide-y divide-black/6 px-4">
          {report.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: GuardianCheck }) {
  return (
    <li
      data-testid={`family-guardian-check-${check.id}`}
      className="flex items-start gap-2.5 py-2.5"
    >
      <CheckMark status={check.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-neutral-800">{check.label}</p>
          <span
            data-testid={`family-guardian-check-${check.id}-status`}
            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400"
          >
            {STATUS_LABEL[check.status]}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{check.detail}</p>
      </div>
    </li>
  );
}

function GuardianMark({ status }: { status: "ready" | "blocked" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        status === "ready"
          ? "bg-black text-white"
          : "border border-black/20 bg-white text-black",
      )}
    >
      {status === "ready" ? "✓" : "!"}
    </span>
  );
}

function CheckMark({ status }: { status: GuardianCheckStatus }) {
  const glyph =
    status === "pass"
      ? "✓"
      : status === "fail"
        ? "—"
        : status === "required"
          ? "•"
          : "·";
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[11px] font-bold",
        status === "pass" && "text-black",
        status === "fail" && "text-neutral-400",
        status === "required" && "text-neutral-500",
        status === "not-stated" && "text-neutral-300",
      )}
    >
      {glyph}
    </span>
  );
}
