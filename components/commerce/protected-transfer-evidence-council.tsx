"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Refresh, Send2, TickCircle, Warning2 } from "@/components/icons";
import { formatPhpFixedGrouped } from "@/lib/remittance/money";
import {
  EVIDENCE_COUNCIL_MAX_CODE_POINTS,
  requestEvidenceCouncilReview,
  type EvidenceCouncilArtifact,
  type EvidenceCouncilQuestionId,
  type EvidenceCouncilResponse,
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

function short(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 11)}…${value.slice(-6)}`;
}

function artifactFrom(response: EvidenceCouncilResponse | null): EvidenceCouncilArtifact | null {
  if (
    response?.kind === "ready_for_human_review" ||
    response?.kind === "disputed" ||
    response?.kind === "questions_needed"
  ) {
    return response.artifact;
  }
  return null;
}

function questionsFrom(response: EvidenceCouncilResponse | null): EvidenceCouncilQuestionId[] {
  if (response?.kind === "questions_needed" || response?.kind === "disputed") {
    return response.questionIds;
  }
  return response?.kind === "ready_for_human_review"
    ? response.artifact.questionIds
    : [];
}

function ResultCard({ response }: { response: EvidenceCouncilResponse }) {
  const copy = {
    ready_for_human_review: [
      "Details line up",
      "Both reviews found the same recipient, amount, and purpose. You still decide whether to release.",
    ],
    questions_needed: [
      "Check these details",
      "Some details are missing or need confirmation before you decide.",
    ],
    disputed: [
      "Reviews disagree",
      "The independent reviews found different evidence. Confirm the details yourself.",
    ],
    unavailable: [
      "Couldn’t check right now",
      "Your funds remain held. Try the evidence check again later.",
    ],
    rejected: [
      "This hold can’t be checked",
      "The receipt, deadline, or held transaction no longer matches this review.",
    ],
  }[response.kind];
  const positive = response.kind === "ready_for_human_review";

  return (
    <div className="rounded-2xl border border-black/12 bg-white p-4" aria-live="polite">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {positive ? (
          <TickCircle size="15" variant="Linear" aria-hidden="true" />
        ) : (
          <Warning2 size="15" variant="Linear" aria-hidden="true" />
        )}
        Evidence check
      </div>
      <h4 className="mt-2 text-base font-medium tracking-[-0.02em] text-black">{copy[0]}</h4>
      <p className="mt-1 text-sm leading-6 text-neutral-600">{copy[1]}</p>
    </div>
  );
}

function ReviewRecord({ artifact }: { artifact: EvidenceCouncilArtifact }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Independent reviews
        </p>
        <p className="font-mono text-[10px] text-neutral-500">
          Record {short(artifact.artifactDigest)}
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {artifact.reviews.map((review) => (
          <div
            key={review.requestId}
            data-testid={`protected-transfer-evidence-provenance-${review.reviewer === "review_a" ? 0 : 1}`}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          >
            <p className="text-xs font-medium text-black">{review.responseModel}</p>
            <p className="mt-1 font-mono text-[10px] text-neutral-500">{short(review.requestId)}</p>
          </div>
        ))}
      </div>
      {artifact.corroboratedFacts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {artifact.corroboratedFacts.map((fact) => (
            <span
              key={fact.id}
              data-testid={`protected-transfer-evidence-corroborated-${fact.id}`}
              className="rounded-full border border-black/12 bg-white px-3 py-1 text-[11px] text-black"
            >
              {fact.evidence[0].text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProtectedTransferEvidenceCouncil({
  receipt,
}: ProtectedTransferEvidenceCouncilProps) {
  const fieldId = useId();
  const reduceMotion = useReducedMotion();
  const [evidenceText, setEvidenceText] = useState("");
  const [response, setResponse] = useState<EvidenceCouncilResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const transfer = receipt.transfer;
  const authorization = receipt.plan.authorization;
  const artifact = artifactFrom(response);
  const questions = questionsFrom(response);

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
          Paste the beneficiary’s message, invoice text, or delivery note. Convey checks exact details; only the reviewer can release funds.
        </p>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <label htmlFor={fieldId} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
            Evidence text
          </label>
          <textarea
            id={fieldId}
            maxLength={EVIDENCE_COUNCIL_MAX_CODE_POINTS}
            value={evidenceText}
            onChange={(event) => setEvidenceText(event.target.value)}
            placeholder="Paste the original evidence here"
            className="mt-2 min-h-36 w-full rounded-2xl border border-black/15 bg-white p-4 text-sm leading-6 text-black outline-none transition-colors placeholder:text-neutral-400 focus:border-black motion-reduce:transition-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">Nothing here can move funds.</p>
            <button
              type="button"
              onClick={checkEvidence}
              disabled={checking || evidenceText.trim().length === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-black px-4 text-xs font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none"
            >
              {checking ? (
                <Refresh size="15" variant="Linear" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Send2 size="15" variant="Linear" />
              )}
              {checking ? "Checking" : "Check evidence"}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Must match
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-neutral-500">Recipient</dt><dd className="text-right text-black">{transfer.recipient}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-500">Amount</dt><dd className="text-right text-black">PHP {formatPhpFixedGrouped(authorization.familyReceivesMinor)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-500">Purpose</dt><dd className="text-right text-black">{authorization.purpose ?? "Not specified"}</dd></div>
            </dl>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {checking ? (
              <motion.div
                key="checking"
                aria-live="polite"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-black/10 bg-white p-4"
              >
                <p className="text-sm text-black">Checking two independent reviews…</p>
              </motion.div>
            ) : response ? (
              <motion.div
                key={response.kind}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <ResultCard response={response} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {response && (artifact || questions.length > 0) ? (
          <motion.div
            key="footer"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-3 border-t border-black/10 px-5 py-5 sm:px-6"
          >
            {questions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {questions.map((question) => (
                  <span key={question} className="rounded-full border border-black/12 bg-white px-3 py-1.5 text-xs text-black">
                    {QUESTION_COPY[question]}
                  </span>
                ))}
              </div>
            ) : null}
            {artifact ? <ReviewRecord artifact={artifact} /> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
