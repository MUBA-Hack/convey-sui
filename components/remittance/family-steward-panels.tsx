"use client";

import type { RefObject } from "react";
import { Refresh, Warning2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { SheetDisclosure } from "./sheet-disclosure";
import type {
  FamilyStewardLiveCouncil,
  FamilyStewardPartialReview,
  FamilyStewardRejected,
  FamilyStewardResponse,
  FamilyStewardSignal,
  FamilyStewardSignalId,
  FamilyStewardQuestionId,
} from "@/lib/remittance/family-steward";

const ASSESSMENT_HEADLINE: Record<
  FamilyStewardLiveCouncil["assessment"],
  string
> = {
  no_added_signal: "No added warning signal",
  review_recommended: "Review recommended",
  pause_and_verify: "Pause and verify",
};

const SIGNAL_LABEL: Record<FamilyStewardSignalId, string> = {
  urgency: "Urgency",
  secrecy: "Secrecy",
  authority_pressure: "Authority pressure",
  payment_change: "Payment change",
  identity_uncertainty: "Identity uncertainty",
  unusual_method: "Unusual method",
};

const QUESTION_TEXT: Record<FamilyStewardQuestionId, string> = {
  verify_sender_in_known_channel: "Is this sender asking you through a channel you already know?",
  confirm_payment_details: "Do the payment details match what your family agreed?",
  pause_and_ask_trusted_person: "Pause and check with someone you trust before paying.",
};

export function StewardInput({
  textareaRef,
  text,
  codePoints,
  tooLong,
  tooManyBytes,
  canSubmit,
  onChange,
  onSubmit,
  onCancel,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  codePoints: number;
  tooLong: boolean;
  tooManyBytes: boolean;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pt-1">
      <label
        htmlFor="family-steward-message"
        className="block text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-500"
      >
        Payment message
      </label>
      <textarea
        ref={textareaRef}
        id="family-steward-message"
        data-testid="family-steward-message"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        aria-describedby="family-steward-privacy family-steward-count"
        aria-invalid={tooLong || tooManyBytes}
        className="mt-1.5 min-h-[88px] w-full resize-y rounded-lg border border-black/12 bg-white px-3 py-2 text-sm leading-relaxed text-black placeholder:text-neutral-300 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
        placeholder="Paste only the message that asked you to pay."
      />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p
          id="family-steward-privacy"
          className="text-[11px] leading-snug text-neutral-500"
        >
          Only this message reaches the AI reviewers — no contact, wallet, or payment details.
        </p>
        <p
          id="family-steward-count"
          data-testid="family-steward-count"
          className={cn(
            "shrink-0 font-sans text-[11px] tabular-nums",
            tooLong ? "text-black" : "text-neutral-400",
          )}
        >
          {codePoints}/500
        </p>
      </div>
      {tooManyBytes && (
        <p className="mt-1 text-[11px] text-black">Message is too long to check.</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          data-testid="family-steward-submit"
          data-hit-target="true"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="cv-btn-solid inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
        >
          Review warning signs
        </button>
        <button
          type="button"
          data-testid="family-steward-cancel"
          data-hit-target="true"
          onClick={onCancel}
          className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function StewardChecking({
  message,
  onCancel,
}: {
  message: string;
  onCancel: () => void;
}) {
  return (
    <div className="pt-1" aria-live="polite">
      <p className="text-[11px] leading-snug text-neutral-500">
        Comparing two independent reviews of your message.
      </p>
      <ul className="mt-2 space-y-1.5">
        {[0, 1].map((i) => (
          <li
            key={i}
            data-testid={`family-steward-reviewer-${i}`}
            className="flex items-center gap-2.5 rounded-lg border border-black/8 bg-neutral-50/60 px-3 py-2"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-black/40"
            />
            <span className="text-xs text-neutral-600">Reviewer {i + 1} reviewing…</span>
          </li>
        ))}
      </ul>
      <p className="sr-only" data-testid="family-steward-checking-message">
        {message}
      </p>
      <button
        type="button"
        data-testid="family-steward-cancel-check"
        data-hit-target="true"
        onClick={onCancel}
        className="cv-btn-ghost mt-2.5 inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
      >
        Cancel
      </button>
    </div>
  );
}

export function StewardResult({
  headlineRef,
  message,
  response,
  onReset,
  onCollapse,
}: {
  headlineRef: RefObject<HTMLParagraphElement | null>;
  message: string;
  response: FamilyStewardResponse;
  onReset: () => void;
  onCollapse: () => void;
}) {
  if (response.kind === "rejected") {
    const rejection = REJECTION_COPY[response.reason];
    return (
      <StewardNotice
        headlineRef={headlineRef}
        testId="family-steward-rejected"
        title="Quote not eligible for message check"
        body={rejection}
        onReset={onReset}
        onCollapse={onCollapse}
      />
    );
  }

  if (response.kind === "local_fallback") {
    return (
      <div className="pt-1" aria-live="polite">
        <p
          ref={headlineRef}
          data-testid="family-steward-headline"
          tabIndex={-1}
          className="text-sm font-semibold leading-tight tracking-[-0.01em] text-black"
        >
          Live review unavailable
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
          A live two-model check could not run. No consensus is claimed. Use the
          questions below with your family reviewer.
        </p>
        <QuestionList questionIds={response.questionIds} />
        <StewardActions onReset={onReset} onCollapse={onCollapse} />
      </div>
    );
  }

  const assessment = response.assessment;
  const headline = ASSESSMENT_HEADLINE[assessment];
  const highConcern = assessment === "pause_and_verify";
  const partial = response.kind === "partial_review";
  const evidence = collectEvidence(response);

  return (
    <div className="pt-1" aria-live="polite">
      <p
        ref={headlineRef}
        data-testid="family-steward-headline"
        tabIndex={-1}
        className={cn(
          "text-sm font-semibold leading-tight tracking-[-0.01em] text-black",
          highConcern && "flex items-center gap-1.5",
        )}
      >
        {highConcern && <Warning2 size={15} variant="Linear" className="shrink-0" />}
        {headline}
      </p>

      {partial && (
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
          One review completed. No consensus.
        </p>
      )}

      <div className="mt-1.5 rounded-lg border border-black/8 bg-neutral-50/60 px-3 py-2">
        {evidence.length > 0 ? (
          <EvidenceBlock message={message} evidence={evidence} />
        ) : (
          <p className="text-[11px] leading-relaxed text-neutral-600">
            No warning span was corroborated with valid evidence.
          </p>
        )}

        <QuestionList questionIds={response.questionIds} />

        {highConcern && (
          <p
            data-testid="family-steward-hold-hint"
            className="mt-2 text-[11px] leading-relaxed text-neutral-700"
          >
            Hold for family review is available below.
          </p>
        )}
      </div>

      <ProvenanceDisclosure response={response} />
      <StewardActions onReset={onReset} onCollapse={onCollapse} />
    </div>
  );
}

const REJECTION_COPY: Record<FamilyStewardRejected["reason"], string> = {
  invalid_request: "This message could not be checked. Send only the payment text and try again.",
  expired: "This quote has expired. Refresh the quote, then check the message again.",
  unverified: "This quote is not verified for message review. Continue with your normal review.",
  unmapped_recipient: "This recipient is not mapped for family message review.",
  invalid_envelope: "This quote format could not be checked. Refresh and try again.",
  not_configured: "Live message review is not configured yet. Continue with your normal review.",
};

function collectEvidence(
  response: FamilyStewardLiveCouncil | FamilyStewardPartialReview,
): EvidenceItem[] {
  if (response.kind === "partial_review") {
    return response.signals.map((signal) => ({
      signalId: signal.id,
      kind: "disputed",
      signal,
    }));
  }
  const items: EvidenceItem[] = [];
  for (const c of response.corroboratedSignals) {
    items.push({ signalId: c.id, kind: "corroborated", signal: c.evidence[0] });
  }
  for (const d of response.disputedSignals) {
    items.push({ signalId: d.id, kind: "disputed", signal: d.evidence });
  }
  return items;
}

interface EvidenceItem {
  signalId: FamilyStewardSignalId;
  kind: "corroborated" | "disputed";
  signal: FamilyStewardSignal;
}

function QuestionList({ questionIds }: { questionIds: FamilyStewardQuestionId[] }) {
  if (questionIds.length === 0) return null;
  return (
    <ul data-testid="family-steward-questions" className="mt-2 space-y-1.5">
      {questionIds.map((id) => (
        <li
          key={id}
          data-testid={`family-steward-question-${id}`}
          className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-700"
        >
          <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-black/40" />
          <span>{QUESTION_TEXT[id]}</span>
        </li>
      ))}
    </ul>
  );
}

function StewardNotice({
  headlineRef,
  testId,
  title,
  body,
  onReset,
  onCollapse,
  retryLabel = "Check another message",
}: {
  headlineRef: RefObject<HTMLParagraphElement | null>;
  testId: string;
  title: string;
  body: string;
  onReset: () => void;
  onCollapse: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="pt-1" aria-live="polite">
      <p
        ref={headlineRef}
        data-testid={testId}
        tabIndex={-1}
        className="text-sm font-semibold leading-tight tracking-[-0.01em] text-black"
      >
        {title}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">{body}</p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          data-testid="family-steward-reset"
          data-hit-target="true"
          onClick={onReset}
          className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        >
          <Refresh size={15} variant="Linear" />
          {retryLabel}
        </button>
        <button
          type="button"
          data-testid="family-steward-close"
          data-hit-target="true"
          onClick={onCollapse}
          className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EvidenceBlock({
  message,
  evidence,
}: {
  message: string;
  evidence: EvidenceItem[];
}) {
  const segments = buildSegments(message, evidence);
  return (
    <div>
      <p
        data-testid="family-steward-evidence-message"
        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] leading-relaxed text-black"
      >
        {segments.map((seg, i) =>
          seg.evidence ? (
            <mark
              key={i}
              data-testid={`family-steward-span-${seg.evidence.signalId}`}
              className="rounded-[3px] bg-black/8 font-semibold text-black underline decoration-black/50 decoration-1 underline-offset-2"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
      <ul className="mt-1.5 space-y-1">
        {evidence.map((item) => (
          <li
            key={`${item.kind}-${item.signalId}`}
            data-testid={`family-steward-evidence-${item.kind}-${item.signalId}`}
            className="flex items-start gap-2 text-[11px] leading-relaxed text-neutral-600"
          >
            <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-black/40" />
            <span>
              <span className="font-medium text-black">
                {SIGNAL_LABEL[item.signalId]}
              </span>
              {" — "}
              {item.kind === "corroborated" ? "both reviews" : "one review"}
              {": "}
              <span className="font-medium text-neutral-800">
                &ldquo;{item.signal.text}&rdquo;
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProvenanceDisclosure({
  response,
}: {
  response: FamilyStewardResponse;
}) {
  if (response.kind === "rejected" || response.kind === "local_fallback") {
    return null;
  }
  const reviews =
    response.kind === "live_council"
      ? [response.reviews[0], response.reviews[1]]
      : response.kind === "partial_review"
        ? [response.review]
        : [];

  if (reviews.length === 0) return null;

  return (
    <SheetDisclosure
      label="Review provenance"
      triggerTestId="family-steward-provenance-trigger"
      className="mt-2 rounded-lg border border-black/8"
    >
      <dl className="space-y-2 text-[11px] leading-relaxed text-neutral-600">
        {reviews.map((r, i) => (
          <div
            key={i}
            data-testid={`family-steward-provenance-${i}`}
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5"
          >
            <dt className="text-neutral-400">Model</dt>
            <dd className="font-mono text-neutral-700">{r.responseModel}</dd>
            <dt className="text-neutral-400">Request</dt>
            <dd className="font-mono text-neutral-700">{r.requestId}</dd>
          </div>
        ))}
      </dl>
    </SheetDisclosure>
  );
}

function StewardActions({
  onReset,
  onCollapse,
}: {
  onReset: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="mt-2.5 flex gap-2">
      <button
        type="button"
        data-testid="family-steward-reset"
        data-hit-target="true"
        onClick={onReset}
        className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
      >
        <Refresh size={15} variant="Linear" />
        Check another message
      </button>
      <button
        type="button"
        data-testid="family-steward-close"
        data-hit-target="true"
        onClick={onCollapse}
        className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
      >
        Close
      </button>
    </div>
  );
}

function buildSegments(message: string, evidence: EvidenceItem[]) {
  const sorted = [...evidence].sort((a, b) => a.signal.start - b.signal.start);
  const chars = Array.from(message);
  const segments: { text: string; evidence?: EvidenceItem }[] = [];
  let cursor = 0;
  for (const item of sorted) {
    const { start, end } = item.signal;
    if (start < cursor) continue;
    if (start > cursor) segments.push({ text: chars.slice(cursor, start).join("") });
    segments.push({ text: chars.slice(start, end).join(""), evidence: item });
    cursor = end;
  }
  if (cursor < chars.length) segments.push({ text: chars.slice(cursor).join("") });
  return segments;
}
