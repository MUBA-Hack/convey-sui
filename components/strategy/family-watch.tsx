"use client";

import {
  formatEvidenceTime,
  type FamilyWatchBrief,
  type FamilyWatchFinding,
  type FamilyWatchSuggestedIntent,
} from "@/lib/strategy/family-watch";

export interface FamilyWatchProps {
  brief: FamilyWatchBrief;
}

const CONFIDENCE_LABEL: Record<FamilyWatchFinding["confidence"], string> = {
  observed: "Observed",
  limited: "Limited",
  absent: "No evidence",
};

function SuggestedIntent({ intent }: { intent: FamilyWatchSuggestedIntent }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
        Suggested protection
      </p>
      <p className="mt-2 text-base font-semibold tracking-[-0.01em] text-black">
        Protective put
      </p>
      <p className="mt-2 text-sm leading-6 text-neutral-700">{intent.rationale}</p>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-black">
        Review required
      </p>
    </div>
  );
}

function FindingRow({ finding }: { finding: FamilyWatchFinding }) {
  return (
    <li className="border-t border-black/8 px-5 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-[-0.01em] text-black">
          {finding.headline}
        </p>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          {CONFIDENCE_LABEL[finding.confidence]}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-neutral-600">
        {finding.relevance}
      </p>
    </li>
  );
}

/**
 * Family Watch — a judge-visible brief that unifies the declared family
 * obligation with a read-only market snapshot. Presentation only; the brief
 * never executes, signs, or submits. Rendered inside Protect.
 */
export function FamilyWatch({ brief }: FamilyWatchProps) {
  if (brief.status === "unavailable") {
    return (
      <section
        data-testid="family-watch"
        className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl"
      >
        <header className="px-5 pt-5 pb-3">
          <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Family Watch
          </p>
          <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.02em] text-black">
            No family obligation is declared
          </h2>
        </header>
        <p className="px-5 pb-5 text-sm leading-6 text-neutral-600">
          Start a remittance to see how current market context relates to the
          obligation you declare.
        </p>
      </section>
    );
  }

  const { obligation, evidence, findings, suggestedIntent } = brief;

  return (
    <section
      data-testid="family-watch"
      className="cv-money-sheet cv-preview-in overflow-hidden rounded-2xl"
    >
      <header className="px-5 pt-5 pb-3">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Family Watch
        </p>
        <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.02em] text-black">
          {obligation.recipient}, {obligation.city}
        </h2>
      </header>

      <div className="cv-money-tile mx-5 rounded-[18px] bg-black p-4 text-white">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
          Declared obligation
        </p>
        <div className="mt-1 font-sans text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white">
          RM{obligation.amountMyr.toLocaleString()}
        </div>
        <p className="mt-2 text-[12px] text-white/55">
          To {obligation.recipient}, {obligation.city}
        </p>
      </div>

      {findings.length > 0 && (
        <ul className="px-5 pt-3 pb-2">
          {findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </ul>
      )}

      {suggestedIntent && (
        <div className="px-5 pt-2 pb-3">
          <SuggestedIntent intent={suggestedIntent} />
        </div>
      )}

      {evidence && (
        <details className="border-t border-black/8 px-5 py-3">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
            Evidence &amp; provenance
          </summary>
          <div className="mt-2 space-y-1 text-[11px] leading-5 text-neutral-500">
            <p>
              <span className="text-neutral-600">Source: </span>
              {evidence.sourceLabel}
            </p>
            <p>
              <span className="text-neutral-600">Fetched: </span>
              {formatEvidenceTime(evidence.fetchedAt)}
            </p>
            <p>
              <span className="text-neutral-600">Market updated: </span>
              {formatEvidenceTime(evidence.marketUpdatedAt)}
            </p>
            <p>{evidence.provenance}</p>
          </div>
        </details>
      )}

      <p className="border-t border-black/8 px-5 py-3 text-[11px] leading-5 text-neutral-500">
        {brief.note}
      </p>
    </section>
  );
}
