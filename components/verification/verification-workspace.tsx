"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  DocumentText,
  Global,
  SearchNormal1,
  ShieldSearch,
  TickCircle,
  Warning2,
} from "@/components/icons";
import {
  requestClaimVerification,
  type ClaimVerificationReport,
  type ClaimVerificationResponse,
} from "@/lib/verification/claim-report";
import {
  requestWebVerification,
  type WebVerificationResponse,
} from "@/lib/verification/web-evidence";

type InputMode = "text" | "web" | "url";

const RELIEF_EXAMPLE =
  "Independent auditors confirmed the flood relief fund paid for 42 water filters delivered to three evacuation centres.";
const CURRENT_EVENT_EXAMPLE = "What is known about the recent Nepal earthquake?";

const FAILURE_COPY: Record<
  Exclude<ClaimVerificationResponse, ClaimVerificationReport>["reason"],
  string
> = {
  invalid_input: "Add a complete claim or public link.",
  unsafe_url: "That address is private, local, or otherwise unsafe to read.",
  source_unavailable: "The public source could not be read. Paste the relevant text instead.",
  source_too_large: "That page is too large to inspect safely. Paste the relevant passage instead.",
  not_configured: "Live verification is not configured on this deployment.",
  provider_error: "The Gonka reviewers did not return a complete report. Try again.",
  insufficient_consensus: "The reviewers could not produce an independent consensus.",
};

const WEB_FAILURE_COPY: Record<
  Extract<WebVerificationResponse, { kind: "web_verification_unavailable" }>["reason"],
  string
> = {
  invalid_input: "Ask a complete question about a current claim or event.",
  search_unavailable: "Current web search is unavailable. Try again in a moment or paste a public link.",
  insufficient_sources: "Convey could not open enough independent public sources. Try a more specific question.",
  verification_unavailable: "Sources were found, but the Gonka council could not complete its review. Try again.",
};

type WebContext = Extract<WebVerificationResponse, { kind: "web_verified_report" }>;

function verdictCopy(report: ClaimVerificationReport): string {
  if (report.verdict === "supported") return "Supported";
  if (report.verdict === "mixed") return "Mixed evidence";
  if (report.verdict === "unsupported") return "Unsupported";
  return "Not enough evidence";
}

function stepCopy(step: ClaimVerificationReport["steps"][number]["step"]): string {
  if (step === "claim_extraction") return "Claim extracted";
  if (step === "review_a") return "Independent review A";
  return "Independent review B";
}

export function VerificationWorkspace() {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<InputMode>("text");
  const [input, setInput] = useState(RELIEF_EXAMPLE);
  const [report, setReport] = useState<ClaimVerificationReport | null>(null);
  const [webContext, setWebContext] = useState<WebContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const changeMode = (next: InputMode) => {
    requestRef.current?.abort();
    setMode(next);
    setInput(next === "text" ? RELIEF_EXAMPLE : next === "web" ? CURRENT_EVENT_EXAMPLE : "");
    setReport(null);
    setWebContext(null);
    setError(null);
    setRunning(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (value.length < 8) {
      setError(mode === "url" ? "Add a complete public link." : "Add a complete claim.");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRunning(true);
    setError(null);
    setReport(null);
    setWebContext(null);
    try {
      const fetchWithSignal: typeof fetch = (url, init) =>
        fetch(url, { ...init, signal: controller.signal });
      if (mode === "web") {
        const result = await requestWebVerification({ query: value }, fetchWithSignal);
        if (controller.signal.aborted) return;
        if (result.kind === "web_verified_report") {
          setWebContext(result);
          setReport(result.report);
        } else {
          setError(WEB_FAILURE_COPY[result.reason]);
        }
        return;
      }
      const result = await requestClaimVerification(
        { inputType: mode, input: value },
        fetchWithSignal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === "verified_report") setReport(result);
      else setError(FAILURE_COPY[result.reason]);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Verification could not finish.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setRunning(false);
      }
    }
  };

  return (
    <section className="verify-shell" aria-labelledby="verify-title">
      <header className="verify-intro">
        <p className="companion-eyebrow text-black/45">Gonka verification council</p>
        <h1 id="verify-title">Check a claim. See every decision.</h1>
        <p>
          Convey freezes one checkable claim, sends it to two independent Gonka models,
          and shows the score, evidence, disagreement, and request trail.
        </p>
      </header>

      <div className="verify-workspace">
        <form className="verify-input-panel" onSubmit={submit}>
          <div
            className="verify-mode"
            role="group"
            aria-label="Verification input type"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
            <button type="button" aria-pressed={mode === "text"} onClick={() => changeMode("text")}>
              <DocumentText size={17} /> Text
            </button>
            <button type="button" aria-label="Search web" aria-pressed={mode === "web"} onClick={() => changeMode("web")}>
              <SearchNormal1 size={17} /> Web
            </button>
            <button type="button" aria-pressed={mode === "url"} onClick={() => changeMode("url")}>
              <Global size={17} /> Public link
            </button>
          </div>

          <label htmlFor="verification-input">
            {mode === "text" ? "Claim or passage" : mode === "web" ? "Current question" : "Public page URL"}
          </label>
          {mode !== "url" ? (
            <textarea
              id="verification-input"
              value={input}
              maxLength={12_000}
              rows={9}
              onChange={(event) => setInput(event.target.value)}
              placeholder={mode === "web" ? "Ask about a recent event or changing claim" : "Paste a claim, message, or article passage"}
              disabled={running}
            />
          ) : (
            <input
              id="verification-input"
              value={input}
              maxLength={2_048}
              type="url"
              inputMode="url"
              onChange={(event) => setInput(event.target.value)}
              placeholder="https://example.com/report"
              disabled={running}
            />
          )}

          <p className="verify-input-note">
            {mode === "url"
              ? "Convey reads the public page now, then sends only bounded source text to Gonka."
              : mode === "web"
                ? "Convey searches current public reporting first, opens independent sources, then gives grounded excerpts to the Gonka council."
                : "Convey checks the supplied text against the source itself and model knowledge."}
          </p>

          <button className="verify-submit" type="submit" disabled={running || input.trim().length < 8}>
            {running ? <span className="verify-spinner" aria-hidden /> : <ShieldSearch size={19} />}
            {running ? "Council reviewing" : "Run independent checks"}
            {!running && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="verify-result" aria-live="polite" aria-busy={running}>
          <AnimatePresence mode="wait" initial={false}>
            {running ? (
              <motion.div
                key="running"
                className="verify-running"
                initial={reduceMotion ? false : { opacity: 0, transform: "translateY(8px)" }}
                animate={{ opacity: 1, transform: "translateY(0)" }}
                exit={reduceMotion ? undefined : { opacity: 0, transform: "translateY(-4px)" }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                <span className="verify-orbit"><ShieldSearch size={26} /></span>
                <h2>{mode === "web" ? "Current evidence is being gathered." : "Three traceable steps are running."}</h2>
                <p>{mode === "web" ? "Search and safe source reads first. Three Gonka decisions next." : "Claim extraction first. Two distinct model reviews next."}</p>
                <ol>
                  {mode === "web" && <li data-active="true">Search current public reporting</li>}
                  <li data-active={mode === "web" ? undefined : "true"}>Freeze the exact claim</li>
                  <li>Review with model A</li>
                  <li>Cross-check with model B</li>
                </ol>
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                className="verify-empty verify-empty--error"
                initial={reduceMotion ? false : { opacity: 0, transform: "translateY(8px)" }}
                animate={{ opacity: 1, transform: "translateY(0)" }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                <Warning2 size={24} />
                <h2>Report not completed.</h2>
                <p>{error}</p>
              </motion.div>
            ) : report ? (
              <motion.article
                key={report.assessedAt}
                className="verify-report"
                initial={reduceMotion ? false : { opacity: 0, transform: "translateY(12px)" }}
                animate={{ opacity: 1, transform: "translateY(0)" }}
                transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="verify-report-head">
                  <div>
                    <span>{report.truthScore}</span>
                    <small>Truth score</small>
                  </div>
                  <div>
                    <p>{verdictCopy(report)}</p>
                    <strong>{report.consensus.status === "aligned" ? "Models align" : "Models disagree"}</strong>
                    <small>{report.consensus.scoreSpread} point spread</small>
                  </div>
                </div>

                <div className="verify-claim">
                  <span>Claim checked</span>
                  <blockquote>{report.primaryClaim}</blockquote>
                  <small>{report.claimType}</small>
                </div>

                <section className="verify-reasons" aria-labelledby="reasoning-title">
                  <h2 id="reasoning-title">Reasoning trace</h2>
                  <div>
                    {(["review_a", "review_b"] as const).map((reviewer) => (
                      <article key={reviewer}>
                        <h3>{reviewer === "review_a" ? "Review A" : "Review B"}</h3>
                        {report.reasoningTrace
                          .filter((reason) => reason.reviewer === reviewer)
                          .map((reason, index) => <p key={`${reviewer}-${index}`}>{reason.text}</p>)}
                      </article>
                    ))}
                  </div>
                </section>

                {report.evidence.length > 0 && (
                  <section className="verify-evidence" aria-labelledby="evidence-title">
                    <h2 id="evidence-title">Source evidence</h2>
                    {report.evidence.map((evidence, index) => (
                      <q key={`${evidence.reviewer}-${index}`}>{evidence.text}</q>
                    ))}
                  </section>
                )}

                {webContext && (
                  <section className="verify-evidence" aria-labelledby="current-sources-title">
                    <h2 id="current-sources-title">Current sources</h2>
                    <p className="mt-3 text-xs leading-5 text-white/55">
                      URLs come from server-run search and safe page reads. Quotes must exist in an opened source; models cannot add links.
                    </p>
                    <div className="mt-4 grid gap-3">
                      {webContext.sources.map((source) => {
                        const grounded = webContext.citations.filter((citation) => citation.sourceId === source.id);
                        return (
                          <a
                            key={source.id}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-2xl border border-white/15 p-4 transition-colors hover:border-white/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          >
                            <span className="flex items-start justify-between gap-4 text-sm font-medium text-white/90">
                              {source.title}<ArrowRight size={15} className="mt-0.5 shrink-0" />
                            </span>
                            <small className="mt-2 block text-[10px] uppercase tracking-[0.12em] text-white/40">
                              {source.host}{source.publishedAt ? ` · ${new Date(source.publishedAt).toLocaleDateString()}` : ""}
                            </small>
                            <q className="mt-3 block text-xs leading-5 text-white/65">
                              {grounded[0]?.quote ?? source.snippet}
                            </q>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="verify-trace" aria-labelledby="trace-title">
                  <h2 id="trace-title">Gonka request trail</h2>
                  {report.steps.map((step) => (
                    <div key={step.requestId}>
                      <TickCircle size={16} />
                      <span><strong>{stepCopy(step.step)}</strong><small>{step.modelId}</small></span>
                      <code>{step.requestId}</code>
                    </div>
                  ))}
                </section>

                {report.source.kind === "url" && (
                  <a className="verify-source-link" href={report.source.url} target="_blank" rel="noreferrer">
                    <Global size={16} /> {report.source.title ?? report.source.host}
                    <ArrowRight size={15} />
                  </a>
                )}
              </motion.article>
            ) : (
              <motion.div key="empty" className="verify-empty" initial={false} animate={{ opacity: 1 }}>
                <SearchNormal1 size={26} />
                <h2>One claim becomes a public audit trail.</h2>
                <p>
                  The report separates extraction, independent review, consensus, and provenance.
                  No model can move money or approve an agreement.
                </p>
                <div className="verify-empty-route" aria-hidden>
                  <span>Claim</span><i /><span>2 models</span><i /><span>Report</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
