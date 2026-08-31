"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentAccount, useCurrentNetwork } from "@mysten/dapp-kit-react";
import { formatMyrFixedGrouped, formatUsdcGrouped } from "@/lib/remittance/quote";
import {
  QuoteEnvelopeSchema,
  RemittanceClarificationSchema,
  type QuoteEnvelope,
} from "@/lib/remittance/quote-schema";
import { resolveQuoteBlocker } from "@/lib/remittance/transfer";
import { Send2 } from "@/components/icons";
import { useVoiceInput } from "@/components/commerce/use-voice-input";
import {
  parseAmountToMinor,
  buildCommand,
  buildQuoteViewModel,
  estimatePhpPayout,
  estimateMyrFee,
} from "@/lib/remittance/quote-form";
import {
  RemittanceQuotePreview,
  type QuoteBlocker,
  type QuotePreviewStatus,
} from "./remittance-quote-preview";
import { RemittanceMoneySlab } from "./remittance-money-slab";
import { RemittanceQuoteLoading } from "./remittance-quote-loading";
import { RemittanceCheckoutDialog } from "./remittance-checkout-dialog";
import { SheetDisclosure } from "./sheet-disclosure";
import type { RemittanceSettlement, RemittanceTerminalState } from "./remittance-payment-action";

/**
 * A quote carries a real family rule when the intent review states either a
 * purpose or a per-transfer maximum cap. A no-rule transfer (both null) keeps
 * its existing behavior and never gets the Family-rule page identity.
 */
function hasFamilyRule(
  review: QuoteEnvelope["intentReview"],
): boolean {
  return review.maximumFamilyLimitMinor !== null || review.purpose !== null;
}

function MicGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

const MALAY_PROMPT = "Hantar RM750 kepada Maria di Cebu";
const GOLDEN_REMITTANCE_PROMPT =
  "Hantar RM500 to Ana in Manila for school supplies; jangan lebih RM520.";

const HERO_RECIPIENT = "Ana";
const HERO_CITY = "Manila";
const HERO_COUNTRY = "Philippines";
const DEFAULT_AMOUNT = "500";

/**
 * One mutable quote session — never a transcript. A successful quote
 * supersedes any prior session so exactly one quote card can hold active
 * Edit/Refresh/Review actions. A clarification supersedes a prior quote too,
 * so a retry that yields a clarification never resurrects stale quote actions.
 *
 * A terminal quote (`submitted` / `unknown` / `confirmed`) is locked: a new
 * request is fail-closed (ignored) and the settlement evidence stays visible.
 */
type QuoteSession =
  | { kind: "none" }
  | {
      kind: "quote";
      id: string;
      quote: QuoteEnvelope;
      status: QuotePreviewStatus;
      settlement: RemittanceSettlement | null;
    }
  | { kind: "clarification"; id: string; text: string; code: string };

/** The quote statuses that lock a session against supersession/reopen. */
const TERMINAL_STATUSES: ReadonlySet<QuotePreviewStatus> = new Set([
  "submitted",
  "unknown",
  "confirmed",
]);

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `r${idCounter}`;
}

export interface RemittanceChatProps {
  /** Quiet "Buy nearby" secondary link target. When omitted the link is hidden. */
  onSwitchToBuy?: () => void;
}

export function RemittanceChat({ onSwitchToBuy }: RemittanceChatProps = {}) {
  const [session, setSession] = useState<QuoteSession>({ kind: "none" });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the last sent request (text + interpretation mode) so Retry can
  // re-send with the ORIGINAL mode: a freeform/voice/example retry stays gonka,
  // a structured hero retry stays deterministic. Mode is never inferred from
  // omission on retry.
  const [lastSent, setLastSent] = useState<{
    text: string;
    mode: "gonka" | "deterministic";
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuote, setDialogQuote] = useState<QuoteEnvelope | null>(null);
  const [dialogSessionId, setDialogSessionId] = useState<string | null>(null);

  // Money sheet state — the editable RM amount and the type-request
  // disclosure. Voice populates the disclosure's composer and opens it so the
  // transcribed text is visible, but never submits.
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [amountFocused, setAmountFocused] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const parsedHeroAmount = parseAmountToMinor(amount);
  const heroPayout = parsedHeroAmount.ok
    ? estimatePhpPayout(parsedHeroAmount.minor)
    : null;
  const heroFee = parsedHeroAmount.ok ? estimateMyrFee(parsedHeroAmount.minor) : null;
  const heroSendAmount = parsedHeroAmount.ok
    ? formatMyrFixedGrouped(parsedHeroAmount.minor)
    : amount;

  const account = useCurrentAccount();
  const network = useCurrentNetwork();

  const voice = useVoiceInput({
    onFinal: (text) => {
      setInput(text);
      setTypeOpen(true);
    },
  });
  const stopVoice = voice.stop;

  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => stopVoice();
  }, [stopVoice]);

  // Interpretation mode routing: the structured hero CTA sends
  // `deterministic` (the user supplied structured controls, so the
  // deterministic parse is the intended path, not a Gonka failure). Every
  // freeform path — typed composer, voice final, and example prompts — sends
  // `gonka` explicitly so the request never depends on omission-dependent
  // defaulting. Retry re-sends the captured original mode.
  const send = useCallback(
    async (text: string, mode: "gonka" | "deterministic" = "gonka") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Fail closed: a terminal quote session is locked. Keep its settlement
      // evidence visible; never supersede with a new request.
      if (session.kind === "quote" && TERMINAL_STATUSES.has(session.status)) {
        return;
      }
      setInput("");
      setError(null);
      setLastSent({ text: trimmed, mode });
      // Supersede any prior non-terminal session so exactly one quote card
      // can hold active actions. A clarification or retry that follows never
      // resurrects stale quote actions.
      setSession({ kind: "none" });
      setLoading(true);
      try {
        const res = await fetch("/api/remittance/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, interpretationMode: mode }),
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const errBody = (await res.json()) as { message?: string; error?: string };
            if (errBody?.message) detail = errBody.message;
            else if (errBody?.error) detail = errBody.error;
          } catch {
            // keep HTTP status
          }
          throw new Error(detail);
        }
        const body = (await res.json()) as unknown;
        // Strict parse: a valid quote or a valid clarification. Malformed JSON
        // becomes a safe request error, never a partial quote.
        const quoteResult = QuoteEnvelopeSchema.safeParse(body);
        if (quoteResult.success) {
          setSession({
            kind: "quote",
            id: nextId(),
            quote: quoteResult.data,
            status: "pending",
            settlement: null,
          });
          return;
        }
        const clarificationResult = RemittanceClarificationSchema.safeParse(body);
        if (clarificationResult.success) {
          const clarification = clarificationResult.data;
          setSession({
            kind: "clarification",
            id: nextId(),
            text: clarification.clarification.reason,
            code: clarification.clarification.code,
          });
          return;
        }
        throw new Error("Received an invalid response from the quote service.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  /** Submit the money sheet's editable amount as a built send command. */
  const handleSeeQuote = () => {
    const result = parseAmountToMinor(amount);
    if (!result.ok) {
      setAmountError(result.reason);
      return;
    }
    setAmountError(null);
    void send(buildCommand(amount, HERO_RECIPIENT, HERO_CITY.toLowerCase()), "deterministic");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !input.trim()) return;
    void send(input);
  };

  const handleRetry = () => {
    if (lastSent) void send(lastSent.text, lastSent.mode);
  };

  const setQuoteStatus = (status: QuotePreviewStatus) => {
    setSession((s) => (s.kind === "quote" ? { ...s, status } : s));
  };

  const openCheckout = (quote: QuoteEnvelope, sessionId: string) => {
    // Never open the modal for a non-executable quote — no dead-end payment
    // modal. The settlement sheet renders an inline state instead.
    if (
      resolveQuoteBlocker({
        account: account?.address ?? null,
        network,
        recipientAddress: quote.recipientAddress,
        attestation: quote.attestation,
      }) !== "none"
    ) {
      return;
    }
    // Block a second confirmation once the session is terminal-for-retry.
    if (
      session.kind === "quote" &&
      session.id === sessionId &&
      TERMINAL_STATUSES.has(session.status)
    ) {
      return;
    }
    setDialogQuote(quote);
    setDialogSessionId(sessionId);
    setDialogOpen(true);
  };

  const handleSettled = (result: RemittanceSettlement) => {
    // Only mutate the session the dialog was opened for; a superseding
    // session must not inherit another quote's settlement evidence.
    setSession((s) =>
      s.kind === "quote" && s.id === dialogSessionId
        ? { ...s, status: "confirmed", settlement: result }
        : s,
    );
    // Do not clear dialogSessionId: keep evidence mounted and block reopen.
  };

  const handleTerminal = (state: RemittanceTerminalState) => {
    setSession((s) => {
      if (s.kind !== "quote" || s.id !== dialogSessionId) return s;
      if (state.kind === "submitted") return { ...s, status: "submitted" };
      if (state.kind === "unknown") return { ...s, status: "unknown" };
      if (state.kind === "confirmed") {
        return { ...s, status: "confirmed", settlement: state.settlement };
      }
      // failed: keep the session pending so a fresh Review is allowed.
      return s;
    });
  };

  const handlePaymentCancel = () => {
    // Terminal states keep evidence mounted; the dialog chrome already blocks
    // close. For a non-terminal cancel, allow the close to proceed and leave
    // the session pending so it can be reopened or edited.
    if (!dialogSessionId) {
      setDialogOpen(false);
      return;
    }
    if (session.kind === "quote" && TERMINAL_STATUSES.has(session.status)) {
      return;
    }
  };

  const canSend = input.trim().length > 0 && !loading;

  // One settlement sheet (never a transcript). A quote session drives it; a
  // clarification is a transient status line under the money sheet.
  const sessionQuote = session.kind === "quote" ? session : null;
  const sessionClarification = session.kind === "clarification" ? session : null;
  const showMoneySheet = session.kind !== "quote" && !loading;
  const blocker: QuoteBlocker = sessionQuote
    ? resolveQuoteBlocker({
        account: account?.address ?? null,
        network,
        recipientAddress: sessionQuote.quote.recipientAddress,
        attestation: sessionQuote.quote.attestation,
      })
    : "none";

  return (
    <section
      data-testid="remittance-chat"
      data-palette="monochrome"
      aria-label="Send abroad"
      className="cv-shell mx-auto flex w-full max-w-[1320px] flex-col px-4 pt-4 md:px-6 md:pt-6"
      style={{ minHeight: "calc(100svh - 96px)" }}
    >
      {showMoneySheet && (
        <div className="mx-auto flex w-full max-w-[1290px] flex-1 flex-col items-start lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:grid-rows-1 lg:items-start lg:gap-8">
            <header
              data-testid="remittance-entry-heading"
              className="mb-4 flex flex-col gap-2 px-1 lg:mb-0 lg:pt-2"
            >
              <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                International transfer
              </p>
              <h1 className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-black sm:text-[34px] lg:text-[40px]">
                Send money home.
              </h1>
            </header>
          {/* Centered ~1290px composition: a ~180px heading column + a content
              column (transfer instrument + corridor) up to ~1080px. Mobile
              stays flex-column so the heading stacks above the instrument with
              no horizontal overflow. The stage starts near the top (never
              vertically centered) and carries no documentation side panel —
              the 3-part story (headline / transfer instrument / corridor) lives
              inside the grid. */}
          <div className="w-full lg:flex lg:flex-col lg:self-stretch">
          <div
            data-testid="remittance-hero"
            className="cv-money-sheet cv-enter overflow-hidden rounded-2xl lg:flex lg:flex-col"
          >
            <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:flex-row sm:items-center sm:gap-3 lg:px-7 lg:pt-7 lg:pb-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span aria-hidden className="cv-contact-portrait shrink-0">
                  <span className="cv-contact-portrait__head" />
                  <span className="cv-contact-portrait__body" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    data-testid="hero-recipient"
                    className="text-base font-semibold tracking-[-0.01em] text-black"
                  >
                    {HERO_RECIPIENT} · {HERO_CITY}
                  </p>
                  <p className="mt-0.5 text-[12px] text-neutral-500">
                    Sister · {HERO_CITY}, {HERO_COUNTRY}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5 sm:ml-auto" aria-label="Quick amounts">
                {["250", "500", "750"].map((quickAmount) => (
                  <button
                    key={quickAmount}
                    type="button"
                    onClick={() => {
                      setAmount(quickAmount);
                      setAmountFocused(false);
                      setAmountError(null);
                    }}
                    className={`min-h-11 rounded-full border px-3 text-[11px] font-semibold transition ${amount === quickAmount ? "border-black bg-black text-white" : "border-black/15 text-neutral-600 hover:border-black/40 hover:text-black"}`}
                  >
                    {quickAmount}
                  </button>
                ))}
              </div>
            </div>

            <RemittanceMoneySlab
              receiveLabel={`${HERO_RECIPIENT} · estimated receive`}
              sendAmount={
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span>RM</span>
                <input
                  data-testid="hero-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountFocused ? amount : heroSendAmount}
                  aria-label="Send amount in MYR"
                  onFocus={() => setAmountFocused(true)}
                  onBlur={() => setAmountFocused(false)}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (amountError) setAmountError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSeeQuote();
                    }
                  }}
                  className="w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-white outline-none placeholder:text-white/30 sm:text-[30px]"
                />
                </span>
              }
              receiveAmount={heroPayout ? `PHP ${heroPayout}` : "—"}
              testId="hero-money-slab"
              receiveTestId="hero-payout"
              className="mx-5 lg:mx-7"
            />
            <div className="mx-5 mt-3 flex items-center justify-between text-[11px] text-neutral-500 lg:mx-7">
              <span>Fee</span>
              <span className="font-medium tabular-nums text-black">{heroFee ? `RM${heroFee}` : "—"}</span>
            </div>
            {amountError && (
              <p role="alert" className="mx-5 mt-1.5 text-[11px] text-red-700 lg:mx-7">
                {amountError}
              </p>
            )}

            <p
              data-testid="hero-truth"
              className="px-5 pt-3 pb-1 text-[11px] leading-relaxed text-neutral-500 lg:px-7 lg:pt-4"
            >
              Live rate estimate
            </p>

            <div className="px-5 pb-3 lg:px-7 lg:pt-2">
              <button
                type="button"
                data-testid="see-quote"
                data-example-prompt="true"
                onClick={handleSeeQuote}
                disabled={loading}
                aria-busy={loading}
                className="cv-btn-solid inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.14em] disabled:opacity-60"
              >
                {loading && (
                  <span aria-hidden className="cv-tick inline-block h-2 w-2 rounded-full bg-white" />
                )}
                {loading ? "Preparing quote…" : `Get quote · ${amount.trim() ? `RM${amount.trim()} ` : ""}to Ana`}
              </button>
              <button
                type="button"
                data-testid="use-golden-remittance"
                data-example-prompt="true"
                onClick={() => void send(GOLDEN_REMITTANCE_PROMPT)}
                disabled={loading}
                className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:text-black disabled:pointer-events-none disabled:opacity-40"
              >
                <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-black/30" />
                Try a family limit request
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-black/8 px-5 py-1.5 lg:px-7 lg:py-3">
              <button
                type="button"
                data-testid="type-request-toggle"
                aria-expanded={typeOpen}
                onClick={() => setTypeOpen((v) => !v)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-between gap-2 rounded-lg px-1 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>Speak or type a transfer</span>
                  {!typeOpen && (
                    <span className="truncate text-[10px] font-normal normal-case tracking-normal text-neutral-400">
                      e.g. “Send RM500 to Ana in Manila”
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-neutral-400" aria-hidden>{typeOpen ? "−" : "+"}</span>
              </button>
              <button
                type="button"
                aria-label="Microphone"
                data-hit-target="true"
                disabled={!voice.supported || loading}
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
                className="cv-btn-ghost inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-black disabled:opacity-40"
                aria-pressed={voice.listening}
              >
                <MicGlyph size={18} />
              </button>
            </div>

            {typeOpen && (
              <>
              <form
                onSubmit={handleSubmit}
                data-testid="type-request-form"
                className="cv-composer cv-disclosure-panel mx-5 mb-4 flex items-end gap-2 p-2"
                aria-label="Remittance composer"
              >
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Send RM500 to Ana in Manila"
                  rows={1}
                  className="h-[44px] min-h-[44px] flex-1 resize-none overflow-hidden bg-transparent px-2 py-3 text-sm outline-none placeholder:text-neutral-400"
                  aria-label="Remittance command"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (canSend) void send(input);
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="Send"
                  data-hit-target="true"
                  disabled={!canSend}
                  aria-busy={loading}
                  className="cv-btn-solid inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                >
                  <Send2 size={18} />
                </button>
              </form>
              <div className="mx-5 mb-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-neutral-500">
                <button
                  type="button"
                  data-testid="use-example-malay"
                  data-example-prompt="true"
                  onClick={() => {
                    setInput(MALAY_PROMPT);
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  className="min-h-8 font-medium hover:text-black"
                >
                  Try a Malay request
                </button>
                {onSwitchToBuy && (
                  <button type="button" data-testid="switch-to-buy" onClick={onSwitchToBuy} className="min-h-8 font-medium hover:text-black">
                    Pay a nearby shop
                  </button>
                )}
              </div>
              </>
            )}

            {voice.listening && (
              <p className="px-5 pb-3 text-[11px] text-neutral-600" aria-live="polite">
                Listening…{" "}
                {voice.interimTranscript && (
                  <span className="font-mono">{voice.interimTranscript}</span>
                )}
              </p>
            )}
            {!voice.supported && (
              <p className="px-5 pb-3 text-[11px] text-neutral-500">
                Voice unavailable — text fallback is fully usable.
              </p>
            )}
          </div>
          {/* Corridor — the third part of the 3-part story, as a compact line
              in the content column. Not a bordered documentation panel: no
              card, no aside, no dl. Honest, monochrome, no fake claims or
              implementation language. */}
          <p
            data-testid="remittance-corridor"
            className="mt-3 px-1 text-[12px] leading-relaxed text-neutral-600 lg:mt-auto"
          >
            Malaysia → Philippines · Settle in USDC on Sui. One wallet approval, a portable receipt when Sui confirms — bank payout is separate, not yet available.
          </p>
          </div>
        </div>
      )}

      {/* In-place quote-loading state — occupies the same destination slot
          as the resolved settlement sheet so the handoff from "Locking your
          rate…" to the populated ticket is a content swap, not a layout jump.
          The entry money sheet is hidden while loading so only one stage is
          visible at a time. Populated amounts, fee, rate, and the countdown
          are suppressed by construction; the skeleton holds neutral bars and
          one live status line. */}
      {loading && !sessionQuote && (
        <div className="cv-enter flex w-full flex-1 items-start lg:items-center">
          <div className="mx-auto w-full max-w-[760px] lg:max-w-[1040px]">
            <RemittanceQuoteLoading />
          </div>
        </div>
      )}

      {/* Settlement sheet — replaces the money sheet once a quote arrives.
          One review surface, never a transcript. */}
      {sessionQuote && sessionQuote.quote && (
        <div className="cv-enter flex w-full flex-1 items-start lg:items-center">
          <div className="mx-auto w-full max-w-[760px] lg:max-w-[1040px]">
          {/* Page identity — rendered ONLY for a quote that carries a real
              family rule (a purpose or a per-transfer cap). A no-rule
              transfer keeps its existing behavior: no Family-rule eyebrow,
              no "Send to {recipient}" H1. Mirrors the compact eyebrow + H1
              identity used by Continue elsewhere and Treasury. */}
          {hasFamilyRule(sessionQuote.quote.intentReview) && (
            <header
              data-testid="family-rule-identity"
              className="mb-1 flex flex-col gap-1 px-1"
            >
              <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Family rule
              </p>
              <h1 className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] text-black sm:text-[40px]">
                Send to {sessionQuote.quote.recipient}
              </h1>
            </header>
          )}
          <RemittanceQuotePreview
            quote={sessionQuote.quote}
            status={sessionQuote.status}
            blocker={blocker}
            onConfirm={() => openCheckout(sessionQuote.quote!, sessionQuote.id)}
            onCancel={() => setQuoteStatus("cancelled")}
            onReopen={() => setQuoteStatus("pending")}
            onSubmitQuote={(command) => void send(command)}
            settled={Boolean(sessionQuote.settlement)}
          />
          {sessionQuote.settlement && (
            <div
              data-testid="remittance-settlement"
              className="cv-money-sheet mt-3 rounded-2xl p-4"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Transaction digest
              </p>
              <p
                data-testid="remittance-digest"
                className="mt-1 truncate font-mono text-xs text-black"
                title={sessionQuote.settlement.digest}
                data-full={sessionQuote.settlement.digest}
              >
                {sessionQuote.settlement.digest}
              </p>
              <a
                href={sessionQuote.settlement.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline"
              >
                View on SuiScan
              </a>
              <dl className="mt-3 space-y-1.5 border-t border-black/10 pt-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">Amount</dt>
                  <dd className="font-mono tabular-nums">
                    {formatUsdcGrouped(sessionQuote.settlement.usdcMicro)} USDC
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">Recipient</dt>
                  <dd
                    className="font-mono text-xs"
                    title={sessionQuote.settlement.recipientAddress}
                  >
                    {`${sessionQuote.settlement.recipientAddress.slice(0, 6)}…${sessionQuote.settlement.recipientAddress.slice(-4)}`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">Quote expiry</dt>
                  <dd className="font-mono tabular-nums text-xs">
                    {new Date(sessionQuote.settlement.quoteExpiresAt).toISOString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-neutral-500">Payout status</dt>
                  <dd className="font-semibold">Awaiting payout partner</dd>
                </div>
              </dl>
              {/* Consolidated Transfer details — the single technical detail
                  surface for a resolved transfer. The preview's own
                  "Transfer details" disclosure is suppressed once this
                  settlement card mounts, so mobile never shows a duplicate /
                  orphan strip at the page bottom. Same honest fields: rail,
                  USDC, converted amount, payout method, recipient address,
                  reference. */}
              <SheetDisclosure
                label="Transfer details"
                triggerTestId="settlement-transfer-details"
                className="mt-3 rounded-lg border border-black/10"
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <dt className="text-neutral-500">Amount converted</dt>
                  <dd
                    data-testid="quote-converted"
                    className="font-sans tabular-nums text-neutral-700"
                  >
                    RM{buildQuoteViewModel(sessionQuote.quote).converted}
                  </dd>
                  <dt className="text-neutral-500">Payout method</dt>
                  <dd
                    data-testid="quote-payout-method"
                    className="text-neutral-700"
                  >
                    {sessionQuote.quote.payoutMethod}
                  </dd>
                  <dt className="text-neutral-500">Settlement rail</dt>
                  <dd data-testid="quote-rail" className="text-neutral-700">
                    {sessionQuote.quote.settlementRail}
                  </dd>
                  <dt className="text-neutral-500">Wallet transfer</dt>
                  <dd
                    data-testid="quote-usdc"
                    className="font-mono tabular-nums text-neutral-700"
                  >
                    {buildQuoteViewModel(sessionQuote.quote).usdcAmount} testnet USDC
                  </dd>
                  <dt className="text-neutral-500">Recipient address</dt>
                  <dd
                    className="font-mono text-neutral-700"
                    title={sessionQuote.quote.recipientAddress ?? ""}
                  >
                    {sessionQuote.quote.recipientAddress
                      ? `${sessionQuote.quote.recipientAddress.slice(0, 6)}…${sessionQuote.quote.recipientAddress.slice(-4)}`
                      : "—"}
                  </dd>
                  <dt className="text-neutral-500">Reference</dt>
                  <dd data-testid="quote-reference" className="font-mono">
                    {sessionQuote.quote.beneficiaryRef}
                  </dd>
                </dl>
              </SheetDisclosure>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Quiet clarification status line — only while no quote supersedes it. */}
      {sessionClarification && (
        <p
          className="cv-enter mt-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm text-neutral-700"
          aria-live="polite"
        >
          {sessionClarification.text}
        </p>
      )}

      {/* Screen-reader progress now lives on the in-place quote-loading
          skeleton (role=status, "Locking your rate…"), which is the single
          sighted + AT status during a fresh load. The composer/See-quote
          buttons keep their own aria-busy. No detached sr-only strip is
          needed alongside the visible skeleton — one status, one region. */}

      {error && (
        <div
          role="alert"
          className="cv-enter mt-3 rounded-xl border border-black bg-white px-4 py-3 text-sm"
        >
          <p className="font-medium">Something went wrong: {error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="cv-btn-solid mt-2 inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium uppercase tracking-wide"
          >
            Retry
          </button>
        </div>
      )}

      <RemittanceCheckoutDialog
        open={dialogOpen}
        quote={dialogQuote}
        onOpenChange={setDialogOpen}
        onSettled={handleSettled}
        onPaymentCancel={handlePaymentCancel}
        onTerminal={handleTerminal}
      />
    </section>
  );
}
