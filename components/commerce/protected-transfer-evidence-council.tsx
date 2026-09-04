"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown2,
  Copy,
  CopySuccess,
  DocumentDownload,
  DocumentText,
  Refresh,
  Send2,
  TickCircle,
  Warning2,
} from "@/components/icons";
import { formatPhpFixedGrouped } from "@/lib/remittance/money";
import {
  EVIDENCE_COUNCIL_MAX_CODE_POINTS,
  buildEvidenceCouncilArtifactExport,
  requestEvidenceCouncilReview,
  type EvidenceCouncilArtifact,
  type EvidenceCouncilArtifactExport,
  type EvidenceCouncilQuestionId,
  type EvidenceCouncilResponse,
  type EvidenceCouncilSpan,
} from "@/lib/remittance/evidence-council-client";
import type { ProtectedTransferCreatedReceiptDocument } from "@/lib/remittance/protected-transfer-created-receipt";

export interface ProtectedTransferEvidenceCouncilProps {
  receipt: ProtectedTransferCreatedReceiptDocument;
}

const QUESTION_COPY: Record<EvidenceCouncilQuestionId, string> = {
  confirm_recipient: "Confirm the recipient",
  confirm_amount: "Confirm the amount",
  confirm_purpose: "Confirm the purpose",
  provide_clearer_evidence: "Provide clearer evidence",
};

const CHECKING_STEPS = [
  "Re-checking the Created receipt on Sui",
  "Reading the evidence with two independent reviews",
  "Comparing exact terms with the agreement",
] as const;

const DECISION_COPY: Record<
  EvidenceCouncilResponse["kind"],
  { state: string; title: string; detail: string }
> = {
  ready_for_human_review: {
    state: "Ready for your decision",
    title: "Details line up",
    detail:
      "Both reviews found the same recipient, amount, and purpose. You still decide whether to release.",
  },
  questions_needed: {
    state: "Needs clarification",
    title: "Check these details",
    detail:
      "Some details are missing or need confirmation before you decide.",
  },
  disputed: {
    state: "Needs clarification",
    title: "Reviews disagree",
    detail:
      "The independent reviews found different evidence. Confirm the details yourself.",
  },
  unavailable: {
    state: "Could not verify",
    title: "Couldn’t check right now",
    detail: "Your funds remain held. Try the evidence check again later.",
  },
  rejected: {
    state: "Could not verify",
    title: "This hold can’t be checked",
    detail:
      "The receipt, deadline, or held transaction no longer matches this review.",
  },
};

const CHECK_STATUS_COPY = {
  matched: "Exact match found",
  missing: "Not found in evidence",
  not_required: "Not required",
} as const;

const TERM_IDS = ["recipient", "amount", "purpose"] as const;
type TermId = (typeof TERM_IDS)[number];
const CORE_TERM_IDS: ReadonlySet<string> = new Set<string>(TERM_IDS);

interface TermOutcome {
  status: keyof typeof CHECK_STATUS_COPY | "pending";
  corroborated: EvidenceCouncilSpan | null;
  disputed: EvidenceCouncilSpan[];
}

function artifactFrom(
  response: EvidenceCouncilResponse | null,
): EvidenceCouncilArtifact | null {
  if (
    response?.kind === "ready_for_human_review" ||
    response?.kind === "disputed" ||
    response?.kind === "questions_needed"
  ) {
    return response.artifact;
  }
  return null;
}

function questionsFrom(
  response: EvidenceCouncilResponse | null,
): EvidenceCouncilQuestionId[] {
  if (response?.kind === "questions_needed" || response?.kind === "disputed") {
    return response.questionIds;
  }
  return response?.kind === "ready_for_human_review"
    ? response.artifact.questionIds
    : [];
}

function termOutcome(
  id: TermId,
  artifact: EvidenceCouncilArtifact | null,
): TermOutcome {
  if (artifact === null) {
    return { status: "pending", corroborated: null, disputed: [] };
  }
  const check = artifact.checks.find((entry) => entry.id === id);
  const corroborated =
    artifact.corroboratedFacts.find((fact) => fact.id === id)?.evidence[0] ??
    null;
  const disputed =
    artifact.disputedFacts.find((fact) => fact.id === id)?.evidence ?? [];
  return { status: check?.status ?? "pending", corroborated, disputed };
}

function expectedEvidenceExample(
  receipt: ProtectedTransferCreatedReceiptDocument,
): string {
  const amount = `PHP ${formatPhpFixedGrouped(
    receipt.plan.authorization.familyReceivesMinor,
  )}`;
  const purpose = receipt.plan.authorization.purpose;
  const recipient = receipt.transfer.recipient;
  return purpose === null
    ? `Received ${amount} for ${recipient}.`
    : `Received ${amount} for ${recipient} for ${purpose}.`;
}

const SPAN_CHIP_CLASS =
  "inline-block max-w-full break-all rounded-lg border border-black/12 bg-neutral-50 px-2 py-1 font-mono text-[11px] leading-5 text-black";

function DecisionCard({ response }: { response: EvidenceCouncilResponse }) {
  const decision = DECISION_COPY[response.kind];
  const positive = response.kind === "ready_for_human_review";
  return (
    <div
      data-testid="protected-transfer-evidence-decision"
      className="rounded-2xl border border-black/12 bg-white p-4"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {positive ? (
          <TickCircle size="15" variant="Linear" aria-hidden="true" />
        ) : (
          <Warning2 size="15" variant="Linear" aria-hidden="true" />
        )}
        {decision.state}
      </div>
      <h4 className="mt-2 text-base font-medium tracking-[-0.02em] text-black">
        {decision.title}
      </h4>
      <p className="mt-1 text-sm leading-6 text-neutral-600">{decision.detail}</p>
    </div>
  );
}

function TermRow({
  id,
  label,
  value,
  outcome,
}: {
  id: TermId;
  label: string;
  value: string;
  outcome: TermOutcome;
}) {
  return (
    <div className="py-3 first:pt-2 last:pb-2">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-sm text-neutral-500">{label}</dt>
        <dd className="text-right text-sm font-medium text-black">{value}</dd>
      </div>
      {outcome.status === "pending" ? (
        <p className="mt-1.5 text-xs text-neutral-400">Waiting for evidence</p>
      ) : (
        <div
          data-testid={`protected-transfer-evidence-term-${id}`}
          className="mt-2 space-y-1.5"
        >
          <p className="text-xs font-medium text-neutral-600">
            {CHECK_STATUS_COPY[outcome.status]}
          </p>
          {outcome.corroborated !== null ? (
            <p className="flex">
              <span
                data-testid={`protected-transfer-evidence-corroborated-${id}`}
                className={SPAN_CHIP_CLASS}
              >
                {outcome.corroborated.text}
              </span>
            </p>
          ) : null}
          {outcome.disputed.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-neutral-600">
                The two reviews returned different text:
              </p>
              {outcome.disputed.map((span, index) => (
                <p key={index} className="flex">
                  <span
                    data-testid={`protected-transfer-evidence-disputed-${id}-${index}`}
                    className={SPAN_CHIP_CLASS}
                  >
                    {span.text}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ProvenanceDisclosure({
  artifact,
  reviewerName,
}: {
  artifact: EvidenceCouncilArtifact;
  reviewerName: string;
}) {
  const additionalCorroborated = artifact.corroboratedFacts.filter(
    (fact) => !CORE_TERM_IDS.has(fact.id),
  );
  const additionalDisputed = artifact.disputedFacts.filter(
    (fact) => !CORE_TERM_IDS.has(fact.id),
  );
  return (
    <details
      data-testid="protected-transfer-evidence-provenance"
      className="group rounded-2xl border border-black/10 bg-white px-4 py-3"
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500 [&::-webkit-details-marker]:hidden">
        Technical provenance
        <ArrowDown2
          size="14"
          variant="Linear"
          aria-hidden="true"
          className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="mt-3 space-y-2 border-t border-black/8 pt-3">
        {artifact.reviews.map((review, index) => (
          <div
            key={review.requestId}
            data-testid={`protected-transfer-evidence-provenance-${index}`}
            className="space-y-0.5"
          >
            <p className="break-all text-xs font-medium text-black">
              {review.responseModel}
            </p>
            <p className="break-all font-mono text-[10px] leading-4 text-neutral-500">
              {review.requestId}
            </p>
          </div>
        ))}
        <div className="space-y-0.5 border-t border-black/8 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Artifact digest
          </p>
          <p className="break-all font-mono text-[10px] leading-4 text-neutral-500">
            {artifact.artifactDigest}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Receipt digest
          </p>
          <p className="break-all font-mono text-[10px] leading-4 text-neutral-500">
            {artifact.createdDigest}
          </p>
        </div>
        {additionalCorroborated.length > 0 || additionalDisputed.length > 0 ? (
          <div className="space-y-1.5 border-t border-black/8 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              Additional exact evidence
            </p>
            {additionalCorroborated.map((fact) => (
              <p key={fact.id} className="flex">
                <span
                  data-testid={`protected-transfer-evidence-corroborated-${fact.id}`}
                  className={SPAN_CHIP_CLASS}
                >
                  {fact.evidence[0].text}
                </span>
              </p>
            ))}
            {additionalDisputed.map((fact) =>
              fact.evidence.map((span, index) => (
                <p key={`${fact.id}-${index}`} className="flex">
                  <span
                    data-testid={`protected-transfer-evidence-disputed-${fact.id}-${index}`}
                    className={SPAN_CHIP_CLASS}
                  >
                    {span.text}
                  </span>
                </p>
              )),
            )}
          </div>
        ) : null}
        <p
          data-testid="protected-transfer-evidence-advisory-boundary"
          className="border-t border-black/8 pt-2 text-xs leading-5 text-neutral-600"
        >
          Advisory only. This record never proves the evidence is true and
          cannot release funds. Only {reviewerName} can release.
        </p>
      </div>
    </details>
  );
}

function ArtifactActions({
  exported,
}: {
  exported: EvidenceCouncilArtifactExport;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copyArtifact() {
    try {
      await navigator.clipboard.writeText(exported.json);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function downloadArtifact() {
    const blob = new Blob([exported.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const actionClassName =
    "inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/15 bg-white px-4 text-xs font-semibold uppercase tracking-[0.1em] text-black transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none";

  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copyArtifact} className={actionClassName}>
        {copyState === "copied" ? (
          <CopySuccess size="15" variant="Linear" aria-hidden="true" />
        ) : (
          <Copy size="15" variant="Linear" aria-hidden="true" />
        )}
        {copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Copy unavailable"
            : "Copy record"}
      </button>
      <button
        type="button"
        onClick={downloadArtifact}
        className={actionClassName}
      >
        <DocumentDownload size="15" variant="Linear" aria-hidden="true" />
        Download record
      </button>
    </div>
  );
}

export function ProtectedTransferEvidenceCouncil({
  receipt,
}: ProtectedTransferEvidenceCouncilProps) {
  const fieldId = useId();
  const reduceMotion = useReducedMotion();
  const [evidenceText, setEvidenceText] = useState("");
  const [usingExample, setUsingExample] = useState(false);
  const [response, setResponse] = useState<EvidenceCouncilResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const transfer = receipt.transfer;
  const authorization = receipt.plan.authorization;
  const artifact = artifactFrom(response);
  const questions = questionsFrom(response);
  const exported = artifact === null ? null : buildEvidenceCouncilArtifactExport(artifact);

  async function checkEvidence() {
    if (checking || evidenceText.trim().length === 0) return;
    setChecking(true);
    setResponse(null);
    try {
      setResponse(
        await requestEvidenceCouncilReview({
          request: { createdReceipt: receipt, evidenceText },
        }),
      );
    } catch {
      setResponse({
        kind: "unavailable",
        advisoryOnly: true,
        reason: "provider_error",
      });
    } finally {
      setChecking(false);
    }
  }

  function useExpectedExample() {
    setEvidenceText(expectedEvidenceExample(receipt));
    setUsingExample(true);
    setResponse(null);
  }

  return (
    <section
      data-testid="protected-transfer-evidence-council"
      className="mt-5 overflow-hidden rounded-3xl border border-black/12 bg-neutral-50"
    >
      <div className="border-b border-black/10 bg-black px-5 py-5 text-white sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
          Before release
        </p>
        <h3 className="mt-2 text-xl tracking-[-0.035em] sm:text-2xl">
          Check the evidence. Keep the decision human.
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
          Decide whether the pasted evidence matches this verified agreement;
          only {transfer.reviewerName} can release funds.
        </p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-white/60">
          Paste the beneficiary’s message, invoice text, or delivery note for
          two independent reviews to read.
        </p>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={fieldId}
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500"
            >
              Evidence text
            </label>
            {usingExample ? (
              <span
                data-testid="protected-transfer-evidence-example-tag"
                className="rounded-full border border-black/12 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500"
              >
                Example
              </span>
            ) : null}
          </div>
          <textarea
            id={fieldId}
            maxLength={EVIDENCE_COUNCIL_MAX_CODE_POINTS}
            value={evidenceText}
            onChange={(event) => {
              setEvidenceText(event.target.value);
              setUsingExample(false);
              setResponse(null);
            }}
            disabled={checking}
            placeholder="Paste the original evidence here"
            className="mt-2 min-h-36 w-full rounded-2xl border border-black/15 bg-white p-4 text-sm leading-6 text-black outline-none transition-colors placeholder:text-neutral-400 focus:border-black motion-reduce:transition-none"
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={useExpectedExample}
              disabled={checking}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/15 bg-white px-4 text-xs font-semibold uppercase tracking-[0.1em] text-black transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none"
            >
              <DocumentText size="15" variant="Linear" aria-hidden="true" />
              Use expected evidence example
            </button>
            <button
              type="button"
              onClick={checkEvidence}
              disabled={checking || evidenceText.trim().length === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-black px-4 text-xs font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none"
            >
              {checking ? (
                <Refresh
                  size="15"
                  variant="Linear"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Send2 size="15" variant="Linear" aria-hidden="true" />
              )}
              {checking ? "Checking" : "Check evidence"}
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {usingExample ? (
              <p
                data-testid="protected-transfer-evidence-example-note"
                className="text-xs text-neutral-500"
              >
                Example text filled from this receipt’s own terms. Replace it
                with the real message before checking.
              </p>
            ) : null}
            <p className="text-xs text-neutral-500">
              Nothing here can move funds.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
            Terms to verify
          </p>
          <dl className="mt-1 divide-y divide-black/8">
            <TermRow
              id="recipient"
              label="Recipient"
              value={transfer.recipient}
              outcome={termOutcome("recipient", artifact)}
            />
            <TermRow
              id="amount"
              label="Amount"
              value={`PHP ${formatPhpFixedGrouped(authorization.familyReceivesMinor)}`}
              outcome={termOutcome("amount", artifact)}
            />
            <TermRow
              id="purpose"
              label="Purpose"
              value={authorization.purpose ?? "Not specified"}
              outcome={termOutcome("purpose", artifact)}
            />
          </dl>
        </div>
      </div>

      {checking || response ? (
        <div
          aria-live="polite"
          className="border-t border-black/10 px-5 py-5 sm:px-6"
        >
          <AnimatePresence mode="wait" initial={false}>
            {checking ? (
              <motion.div
                key="checking"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-sm font-medium text-black">
                  Checking the evidence
                </p>
                <ol className="mt-3 space-y-2">
                  {CHECKING_STEPS.map((step, index) => (
                    <li
                      key={step}
                      className="flex items-start gap-3 text-sm leading-6 text-neutral-600"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-black/15 font-mono text-[10px] text-neutral-500"
                      >
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </motion.div>
            ) : response ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-3"
              >
                <DecisionCard response={response} />
                {questions.length > 0 ? (
                  <div
                    data-testid="protected-transfer-evidence-questions"
                    className="flex flex-wrap gap-2"
                  >
                    {questions.map((question) => (
                      <span
                        key={question}
                        className="rounded-full border border-black/12 bg-white px-3 py-1.5 text-xs text-black"
                      >
                        {QUESTION_COPY[question]}
                      </span>
                    ))}
                  </div>
                ) : null}
                {artifact ? (
                  <ProvenanceDisclosure
                    artifact={artifact}
                    reviewerName={transfer.reviewerName}
                  />
                ) : null}
                {exported ? <ArtifactActions exported={exported} /> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </section>
  );
}
