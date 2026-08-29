"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PurchaseIntentPreview,
  PurchaseIntentResult,
} from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import { ArrowRight, Radar, Send2 } from "@/components/icons";
import { useVoiceInput } from "./use-voice-input";
import { PurchasePreview, type PreviewStatus } from "./purchase-preview";
import { CheckoutDialog } from "./checkout-dialog";

/**
 * Inline microphone glyph. `icons.tsx` does not export a microphone and is
 * outside this task's ownership, so a small inline SVG keeps the icon-library
 * rules intact (no lucide, no direct iconsax-react import) without editing a
 * shared file.
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

/**
 * Wave 2 Task 2.2 — chat-first purchase surface.
 *
 * The home route's primary experience. A visitor types (or speaks) a purchase
 * command; the chat posts it to the typed `/api/commerce/intent` endpoint and
 * renders the typed response in a thread:
 *
 *  - `preview`     → an inline PurchasePreview card with a cancel/reopen
 *                    confirm gate. Confirm opens the CheckoutDialog, which
 *                    hosts the `PaymentAction` settlement step. The inline
 *                    preview transitions to `confirmed` — and its
 *                    Confirm/Cancel controls disappear — only after the
 *                    dialog reports a terminal successful settlement (real
 *                    testnet or explicit DEMO). Cancellation or payment
 *                    failure never marks confirmed, so a preview can never
 *                    double-fire a settlement.
 *  - `clarification` → a clarification message; the composer stays usable.
 *  - fetch error    → an error banner with a retry that re-posts the last text.
 *
 * Voice is wired through `useVoiceInput`: a mic toggle, a visible listening
 * state, a live interim transcript, and a complete text fallback when the
 * browser has no SpeechRecognition. The hook stops recognition on unmount.
 *
 * Layout: mobile-first. At 375px the composer stays in thumb reach with no
 * horizontal overflow; at desktop a polished centered 2-column composition
 * pairs the primary chat panel with a compact how-it-works rail. The empty
 * state is useful: three clickable example prompts that populate the composer
 * ONLY (never submit/confirm automatically) and an honest mode/status card
 * that never fakes a balance or settlement. All primary hit targets are 44px.
 */

const GOLDEN_PROMPT = "Buy two iced coffees under 8 SUI from River Cafe";

/** Clickable example prompts. Clicking populates the composer ONLY — it never
 *  submits, confirms, or opens checkout. The short label is shown on the card;
 *  the full command is what gets placed in the composer. */
const EXAMPLE_PROMPTS: { label: string; sub: string; command: string }[] = [
  {
    label: "Two iced coffees",
    sub: "River Cafe · under 8 SUI",
    command: GOLDEN_PROMPT,
  },
  {
    label: "Lunch bowl",
    sub: "Green Kitchen · under 12 SUI",
    command: "Order one lunch bowl under 12 SUI from Green Kitchen",
  },
  {
    label: "Three cold brews",
    sub: "Daybreak Coffee · under 6 SUI",
    command: "Get three cold brews under 6 SUI from Daybreak Coffee",
  },
];

export type NetworkMode = "demo" | "live";

/** Resolve the default network mode from public env (no secrets). */
function defaultNetworkMode(): NetworkMode {
  const merchant = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS;
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK;
  // A Sui address is 0x + 64 hex chars. Real payment is enabled only when the
  // wallet network is testnet AND this is a valid address; Wave 3 tightens this
  // with the live wallet network. Until then, simulation is visibly labelled.
  const isSuiAddress =
    typeof merchant === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(merchant);
  return network === "testnet" && isSuiAddress ? "live" : "demo";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  preview?: PurchaseIntentPreview;
  previewStatus?: PreviewStatus;
  receipt?: PaymentReceipt | null;
  clarification?: string;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m${idCounter}`;
}

export interface CommerceChatProps {
  networkMode?: NetworkMode;
}

export function CommerceChat({
  networkMode = defaultNetworkMode(),
}: CommerceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentText, setLastSentText] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPreview, setDialogPreview] = useState<PurchaseIntentPreview | null>(null);
  // The id of the thread message whose preview opened the dialog, so a
  // terminal settlement can flip exactly that preview to `confirmed`.
  const [dialogMessageId, setDialogMessageId] = useState<string | null>(null);

  const voice = useVoiceInput({ onFinal: (text) => setInput(text) });

  const threadRef = useRef<HTMLDivElement>(null);
  // Auto-scroll the thread to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // Stop any active recognition when the chat unmounts so a leaked session
  // never outlives the surface. The hook also cleans up internally; this makes
  // the chat's ownership of the voice lifecycle explicit. Depends on the stable
  // `stop` callback, not the whole `voice` object (a new ref each render).
  useEffect(() => {
    return () => voice.stop();
  }, [voice.stop]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    setError(null);
    setLastSentText(trimmed);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text: trimmed },
    ]);
    setLoading(true);
    try {
      const res = await fetch("/api/commerce/intent", {
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
          // keep HTTP status as the detail
        }
        throw new Error(detail);
      }
      const body = (await res.json()) as PurchaseIntentResult;
      if (body.kind === "preview") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: "Here is the validated preview. Confirm to continue.",
            preview: body,
            previewStatus: "pending",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: body.clarification.reason,
            clarification: body.clarification.code,
          },
        ]);
      }
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

  const setPreviewStatus = (id: string, status: PreviewStatus) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, previewStatus: status } : m)),
    );
  };

  const openCheckout = (preview: PurchaseIntentPreview, messageId: string) => {
    setDialogPreview(preview);
    setDialogMessageId(messageId);
    setDialogOpen(true);
  };

  // Terminal successful settlement (real testnet digest or explicit DEMO
  // receipt) is the ONLY path that flips the originating preview to
  // `confirmed`. Once confirmed, PurchasePreview renders neither Confirm nor
  // Cancel, so the same preview can never open a second checkout.
  const handleSettled = (receipt: PaymentReceipt) => {
    if (dialogMessageId) setPreviewStatus(dialogMessageId, "confirmed");
    if (dialogMessageId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === dialogMessageId ? { ...m, receipt } : m)),
      );
    }
    setDialogMessageId(null);
    // The dialog's PaymentAction already rendered the receipt; the chat only
    // needs the terminal signal to lock the preview.
    void receipt;
  };

  // Cancellation from the payment step closes the dialog WITHOUT confirming.
  // The originating preview stays `pending` so the user may retry, but no
  // settlement is recorded.
  const handlePaymentCancel = () => {
    setDialogMessageId(null);
  };

  const canSend = input.trim().length > 0 && !loading;
  const isEmpty = messages.length === 0 && !loading;

  return (
    <section
      data-palette="monochrome"
      aria-label="Convey chat"
      className="cv-shell mx-auto w-full max-w-[1120px] px-4 py-6 md:py-10"
    >
      <div className="mb-5 flex flex-col gap-4 border-b border-black/10 pb-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-neutral-500">
            Convey
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] md:text-5xl">
            Say it. Carry it across. Settle on Sui.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-600 md:text-base">
            Voice-first purchases, a QR Ferry for offline handoff, and a
            clipped black-and-white checkout flow built for demos that need to
            look finished.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 md:w-[350px]">
          {["Voice", "PWA", "Offline QR Ferry"].map((chip) => (
            <div
              key={chip}
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-600"
            >
              {chip}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Primary chat panel */}
        <div className="cv-panel cv-enter flex flex-col p-4 md:p-5">
          <header className="mb-4 flex items-end justify-between gap-4 border-b border-black/10 pb-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
                Live purchase thread
              </p>
              <h2 className="mt-2 text-2xl font-medium tracking-[-0.03em] md:text-[2rem]">
                What would you like to buy?
              </h2>
            </div>
            <p className="hidden max-w-[16rem] text-right text-xs leading-relaxed text-neutral-500 md:block">
              Try: <span className="font-medium text-neutral-700">{GOLDEN_PROMPT}</span>
            </p>
          </header>

          {/* Dominant black settlement status card — the premium payment
             surface that anchors the shell's hierarchy. White type on solid
             black, an abstract CSS concentric radar motif, and one crisp
             settlement figure (0 SUI on-chain until confirm). Strict
             grayscale, no hue. Never fakes a balance or settlement; the only
             motion is the 220ms cv-enter rise (zeroed for reduced-motion). */}
          <div
            data-testid="mode-status"
            data-status-mode={networkMode}
            className="cv-status cv-status--surface cv-enter mb-4 p-4 md:p-5"
          >
            <span aria-hidden className="cv-status__motif" />
            <span
              aria-hidden
              className="cv-status__motif cv-status__motif--echo"
            />
            <div className="relative flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Radar size={16} className="text-white/75" />
                <span className="cv-status__figure-label text-[11px] text-white/65">
                  {networkMode === "live" ? "Live testnet" : "Demo mode"}
                </span>
                <span
                  aria-hidden
                  className="cv-status__dot ml-auto inline-block h-1.5 w-1.5 rounded-full"
                />
              </div>

              <div className="flex flex-col gap-1.5 md:flex-row md:items-end md:justify-between md:gap-4">
                <div className="flex flex-col">
                  <span className="cv-status__figure-label text-[10px] text-white/55">
                    On-chain settlement
                  </span>
                  <span className="cv-status__figure mt-1 font-mono text-[2.75rem] font-semibold leading-none text-white md:text-[3.5rem]">
                    0
                    <span className="ml-1.5 text-sm font-medium text-white/55 md:text-base">
                      SUI
                    </span>
                  </span>
                  <span className="mt-1 text-[11px] text-white/55">
                    until you confirm
                  </span>
                </div>
                <div className="max-w-[18rem] text-xs leading-relaxed text-white/70">
                  {networkMode === "live"
                    ? "Live testnet — real signing happens only when you confirm in checkout."
                    : "Explicit demo simulation — no on-chain settlement occurs."}
                </div>
              </div>
            </div>
          </div>

          {/* Thread — desktop collapses to content when empty (no giant pale
              void below the prompt cards); grows to fill once messages exist.
              Mobile keeps a small min-height for thumb-reach breathing room.
              The composer stays pinned just below via the panel's flex-col. */}
          <div
            ref={threadRef}
            className={`cv-panel--inset cv-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3 md:max-h-[58vh]${
              isEmpty ? " min-h-[180px]" : " min-h-[300px] md:min-h-[340px]"
            }`}
            aria-live="polite"
          >
            {isEmpty && (
              <div className="cv-enter my-auto flex flex-col gap-3">
                <p className="text-sm text-neutral-500">
                  Send a purchase command to begin, or pick an example:
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
                        <span className="text-sm font-medium text-black">
                          {p.label}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-neutral-500">
                          {p.sub}
                        </span>
                      </span>
                      <ArrowRight
                        size={16}
                        aria-hidden
                        className="cv-prompt__chevron"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "cv-bubble-user cv-enter self-end max-w-[85%] px-3.5 py-2.5 text-sm"
                    : "cv-bubble-bot cv-enter self-start max-w-[90%] px-3.5 py-2.5 text-sm"
                }
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.preview && (
                  <PurchasePreview
                    preview={m.preview}
                    networkMode={networkMode}
                    status={m.previewStatus ?? "pending"}
                    receipt={m.receipt ?? null}
                    onConfirm={() => openCheckout(m.preview!, m.id)}
                    onCancel={() => setPreviewStatus(m.id, "cancelled")}
                    onReopen={() => setPreviewStatus(m.id, "pending")}
                  />
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
                  Interpreting…
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

          {/* Voice state */}
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

          {/* Composer */}
          <form
            onSubmit={handleSubmit}
            className="cv-composer mt-3 flex items-end gap-2 p-2"
            aria-label="Purchase composer"
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
              placeholder="Type or speak a purchase command"
              rows={1}
              className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-neutral-400"
              aria-label="Purchase command"
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

        {/* Desktop context rail */}
        <aside
          aria-label="How it works"
          className="cv-panel cv-enter cv-enter-step-1 hidden flex-col gap-4 p-5 lg:flex"
        >
          <h2 className="text-sm font-semibold tracking-tight">How it works</h2>
          <ol className="flex flex-col gap-3.5">
            {[
              "Say or type a purchase command.",
              "Review the validated preview.",
              "Confirm to open checkout.",
              "Settle on Sui — or a labelled DEMO.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
                  {i + 1}
                </span>
                <span className="text-sm leading-snug text-neutral-700">
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <div className="cv-panel--inset mt-1 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-neutral-500">
              No transaction is built until you confirm in checkout. The client
              signs; the model never receives keys or transaction authority.
            </p>
          </div>
        </aside>
      </div>

      {/* Mobile context (below the chat, compact) */}
      <aside
        aria-label="How it works"
        className="cv-panel cv-enter mt-5 flex flex-col gap-3 p-4 lg:hidden"
      >
        <h2 className="text-sm font-semibold tracking-tight">How it works</h2>
        <ol className="flex flex-wrap gap-x-4 gap-y-2">
          {[
            "Say or type",
            "Review preview",
            "Confirm checkout",
            "Settle on Sui",
          ].map((step, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[10px] font-medium text-white">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </aside>

      <CheckoutDialog
        open={dialogOpen}
        preview={dialogPreview}
        networkMode={networkMode}
        onOpenChange={setDialogOpen}
        onSettled={handleSettled}
        onPaymentCancel={handlePaymentCancel}
      />
    </section>
  );
}
