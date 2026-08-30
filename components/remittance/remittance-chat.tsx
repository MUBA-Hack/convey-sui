"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsdc } from "@/lib/remittance/quote";
import {
  QuoteEnvelopeSchema,
  RemittanceClarificationSchema,
  type QuoteEnvelope,
} from "@/lib/remittance/quote-schema";
import { ArrowRight, Send2 } from "@/components/icons";
import { useVoiceInput } from "@/components/commerce/use-voice-input";
import {
  RemittanceQuotePreview,
  type QuotePreviewStatus,
} from "./remittance-quote-preview";
import { RemittanceCheckoutDialog } from "./remittance-checkout-dialog";
import type { RemittanceSettlement, RemittanceTerminalState } from "./remittance-payment-action";

/**
 * Send-abroad remittance surface.
 *
 * A visitor types (or speaks) a remittance command; the chat posts it to the
 * typed `/api/remittance/quote` endpoint and renders the typed response in a
 * thread: an inline quote preview for a `quote` result, a clarification
 * message for a `clarification` result, and an error banner with retry on a
 * fetch failure. A quote preview carries a cancel/reopen gate; "Review
 * details" opens a two-step checkout dialog that hosts the USDC payment
 * action. Voice populates the composer ONLY — it never submits.
 *
 * The surface never claims fiat payout completed. On a real testnet
 * settlement it shows the digest, SuiScan link, exact USDC amount, recipient,
 * quote expiry, and an explicit "Awaiting payout partner" payout status.
 */

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

const GOLDEN_PROMPT = "Send RM500 to Ana in Manila";

const EXAMPLE_PROMPTS: { label: string; sub: string; command: string }[] = [
  {
    label: "Send RM500 to Manila",
    sub: "Ana · MYR → PHP",
    command: GOLDEN_PROMPT,
  },
  {
    label: "Hantar RM750 ke Cebu",
    sub: "Maria · Malay/English",
    command: "Hantar RM750 kepada Maria di Cebu",
  },
  {
    label: "Send RM1000 to Davao",
    sub: "Juan · MYR → PHP",
    command: "Send RM1000 to Juan in Davao",
  },
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  quote?: QuoteEnvelope;
  quoteStatus?: QuotePreviewStatus;
  settlement?: RemittanceSettlement | null;
  clarification?: string;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `r${idCounter}`;
}

export function RemittanceChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentText, setLastSentText] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuote, setDialogQuote] = useState<QuoteEnvelope | null>(null);
  const [dialogMessageId, setDialogMessageId] = useState<string | null>(null);

  const voice = useVoiceInput({ onFinal: (text) => setInput(text) });
  const stopVoice = voice.stop;

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    return () => stopVoice();
  }, [stopVoice]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    setError(null);
    setLastSentText(trimmed);
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/remittance/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
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
      // Strict parse the response: a valid quote or a valid clarification.
      // Unknown/malformed JSON becomes the existing safe request error, not a
      // crash and never a partial quote.
      const quoteResult = QuoteEnvelopeSchema.safeParse(body);
      if (quoteResult.success) {
        const quote = quoteResult.data;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: "Here is your reference quote. Review the details to continue.",
            quote,
            quoteStatus: "pending",
          },
        ]);
        return;
      }
      const clarificationResult = RemittanceClarificationSchema.safeParse(body);
      if (clarificationResult.success) {
        const clarification = clarificationResult.data;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: clarification.clarification.reason,
            clarification: clarification.clarification.code,
          },
        ]);
        return;
      }
      // Unknown/malformed JSON: safe request error.
      throw new Error("Received an invalid response from the quote service.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !input.trim()) return;
    void send(input);
  };

  const handleRetry = () => {
    if (lastSentText) void send(lastSentText);
  };

  const setQuoteStatus = (id: string, status: QuotePreviewStatus) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, quoteStatus: status } : m)),
    );
  };

  const openCheckout = (quote: QuoteEnvelope, messageId: string) => {
    // Block a second confirmation once the quote is terminal-for-retry.
    const existing = messages.find((m) => m.id === messageId);
    if (
      existing?.quoteStatus === "submitted" ||
      existing?.quoteStatus === "unknown" ||
      existing?.quoteStatus === "confirmed"
    ) {
      return;
    }
    setDialogQuote(quote);
    setDialogMessageId(messageId);
    setDialogOpen(true);
  };

  const handleSettled = (result: RemittanceSettlement) => {
    if (!dialogMessageId) return;
    setQuoteStatus(dialogMessageId, "confirmed");
    setMessages((prev) =>
      prev.map((m) => (m.id === dialogMessageId ? { ...m, settlement: result } : m)),
    );
    // Do not clear dialogMessageId: keep evidence mounted and block reopen.
  };

  const handleTerminal = (state: RemittanceTerminalState) => {
    if (!dialogMessageId) return;
    if (state.kind === "submitted") {
      setQuoteStatus(dialogMessageId, "submitted");
      return;
    }
    if (state.kind === "unknown") {
      setQuoteStatus(dialogMessageId, "unknown");
      return;
    }
    if (state.kind === "confirmed") {
      setQuoteStatus(dialogMessageId, "confirmed");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === dialogMessageId ? { ...m, settlement: state.settlement } : m,
        ),
      );
      return;
    }
    // failed: keep preview pending/cancelled only if not already locked;
    // do not force reopen for the same quote after a known failure either —
    // cancel unlocks the dialog, so a fresh Review is allowed.
  };

  const handlePaymentCancel = () => {
    // Only unlock the originating quote when the customer still can cancel
    // (pre-terminal). Terminal states keep dialogMessageId so reopen is blocked.
    if (!dialogMessageId) {
      setDialogOpen(false);
      return;
    }
    const msg = messages.find((m) => m.id === dialogMessageId);
    if (
      msg?.quoteStatus === "submitted" ||
      msg?.quoteStatus === "unknown" ||
      msg?.quoteStatus === "confirmed"
    ) {
      return;
    }
    setDialogMessageId(null);
  };

  const canSend = input.trim().length > 0 && !loading;
  const isEmpty = messages.length === 0 && !loading;

  return (
    <section
      data-testid="remittance-chat"
      data-palette="monochrome"
      aria-label="Send abroad"
      className="cv-shell mx-auto w-full max-w-[1120px] px-4 py-3 md:py-8"
    >
      <div className="cv-panel cv-enter flex flex-col p-3 md:p-4">
        <header className="mb-3 flex items-center justify-between gap-3 border-b border-black/10 pb-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Send abroad
            </p>
            <h2 className="text-base font-medium tracking-[-0.02em] text-black md:text-lg">
              Send money home by voice.
            </h2>
          </div>
          <p className="hidden max-w-[16rem] text-right text-[11px] leading-relaxed text-neutral-500 md:block">
            Try: <span className="font-medium text-neutral-700">{GOLDEN_PROMPT}</span>
          </p>
        </header>

        <div
          ref={threadRef}
          className={`cv-panel--inset cv-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3 md:max-h-[52vh]${
            isEmpty ? " min-h-[140px] lg:min-h-[190px]" : " min-h-[260px] md:min-h-[340px]"
          }`}
          aria-live="polite"
        >
          {isEmpty && (
            <div className="cv-enter my-auto flex flex-col gap-3">
              <p className="text-sm text-neutral-500">
                Say or type a send command to get a quote, or pick an example:
              </p>
              <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={p.command}
                    type="button"
                    data-testid="example-prompt"
                    data-example-prompt="true"
                    aria-label={`Try: ${p.command}`}
                    onClick={() => setInput(p.command)}
                    className={`cv-prompt cv-enter cv-enter-step-${
                      i + 1
                    } min-h-[52px] px-3.5 py-3`}
                  >
                    <span aria-hidden className="cv-prompt__accent" />
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium text-black">{p.label}</span>
                      <span className="font-mono text-xs tabular-nums text-neutral-500">
                        {p.sub}
                      </span>
                    </span>
                    <ArrowRight size={16} aria-hidden className="cv-prompt__chevron" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              data-message-quote={m.quote ? "true" : "false"}
              className={
                m.role === "user"
                  ? "cv-bubble-user cv-enter self-end max-w-[85%] px-3.5 py-2.5 text-sm"
                  : m.quote
                    ? "cv-enter w-full self-start py-2.5 text-sm"
                    : "cv-bubble-bot cv-enter self-start max-w-[90%] px-3.5 py-2.5 text-sm"
              }
            >
              <p className={`whitespace-pre-wrap${m.quote ? " px-3.5" : ""}`}>{m.text}</p>
              {m.quote && (
                <RemittanceQuotePreview
                  quote={m.quote}
                  status={m.quoteStatus ?? "pending"}
                  onConfirm={() => openCheckout(m.quote!, m.id)}
                  onCancel={() => setQuoteStatus(m.id, "cancelled")}
                  onReopen={() => setQuoteStatus(m.id, "pending")}
                />
              )}
              {m.settlement && (
                <div data-testid="remittance-settlement" className="mt-3 rounded-xl border border-black/12 bg-white p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Transaction digest
                  </p>
                  <p
                    data-testid="remittance-digest"
                    className="mt-1 truncate font-mono text-xs text-black"
                    title={m.settlement.digest}
                    data-full={m.settlement.digest}
                  >
                    {m.settlement.digest}
                  </p>
                  <a
                    href={m.settlement.explorerUrl}
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
                        {formatUsdc(m.settlement.usdcMicro)} USDC
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-neutral-500">Recipient</dt>
                      <dd className="font-mono text-xs" title={m.settlement.recipientAddress}>
                        {`${m.settlement.recipientAddress.slice(0, 6)}…${m.settlement.recipientAddress.slice(-4)}`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-neutral-500">Quote expiry</dt>
                      <dd className="font-mono tabular-nums text-xs">
                        {new Date(m.settlement.quoteExpiresAt).toISOString()}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-neutral-500">Payout status</dt>
                      <dd className="font-semibold">Awaiting payout partner</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div
              role="status"
              aria-label="Loading"
              className="cv-bubble-bot cv-enter self-start px-3.5 py-2.5 text-sm"
            >
              <span className="inline-flex items-center gap-2">
                <span className="cv-tick inline-block h-2 w-2 rounded-full bg-black" />
                Preparing quote…
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="cv-enter self-start rounded-xl border border-black bg-white px-3.5 py-2.5 text-sm"
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
        </div>

        {voice.listening && (
          <p className="mt-2 text-sm text-neutral-600" aria-live="polite">
            Listening…{" "}
            {voice.interimTranscript && (
              <span className="font-mono">{voice.interimTranscript}</span>
            )}
          </p>
        )}
        {!voice.supported && (
          <p className="mt-2 text-xs text-neutral-500">
            Voice unavailable — text fallback is fully usable.
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="cv-composer mt-3 flex items-end gap-2 p-2"
          aria-label="Remittance composer"
        >
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

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send money home… e.g. Send RM500 to Ana in Manila"
            rows={1}
            className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-neutral-400"
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
            className="cv-btn-solid inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          >
            <Send2 size={18} />
          </button>
        </form>
      </div>

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
