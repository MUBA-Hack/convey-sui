"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PurchaseIntentPreview,
  PurchaseIntentResult,
} from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import { Send2 } from "@/components/icons";
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
 * Layout: at 375px the composer stays in thumb reach with no horizontal
 * overflow; at 1440px the chat column is capped under 720px with a compact
 * context rail. All primary hit targets are 44px (h-11).
 */

const GOLDEN_PROMPT = "Buy two iced coffees under 8 SUI from River Cafe";

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

  return (
    <section
      className="mx-auto flex w-full max-w-[680px] flex-col px-4 py-6 md:py-10"
      aria-label="Convey chat"
    >
      <header className="mb-4 flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
          Say it. Carry it across. Settle on Sui.
        </p>
        <p className="cv-micro cv-micro-sm text-neutral-500">
          Shop by chat or voice
        </p>
        <h1 className="text-2xl font-medium tracking-tight">
          What would you like to buy?
        </h1>
        <p className="text-sm text-neutral-600">
          Try: <span className="font-medium">{GOLDEN_PROMPT}</span>
        </p>
      </header>

      {/* Thread */}
      <div
        ref={threadRef}
        className="flex min-h-[40vh] flex-1 flex-col gap-3 overflow-y-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] p-3 md:min-h-[50vh]"
        aria-live="polite"
      >
        {messages.length === 0 && !loading && (
          <p className="self-center my-auto text-sm text-neutral-500">
            Send a purchase command to begin.
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "self-end max-w-[85%] bg-black px-3 py-2 text-sm text-white"
                : "self-start max-w-[90%] bg-white px-3 py-2 text-sm border border-[var(--cv-line)]"
            }
          >
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.preview && (
              <PurchasePreview
                preview={m.preview}
                networkMode={networkMode}
                status={m.previewStatus ?? "pending"}
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
            className="self-start bg-white px-3 py-2 text-sm border border-[var(--cv-line)]"
          >
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-2 w-2 animate-pulse bg-black" />
              Interpreting…
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="self-start border border-black bg-white px-3 py-2 text-sm"
          >
            <p className="font-medium">Something went wrong: {error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="cv-micro mt-2 inline-flex h-9 items-center justify-center bg-black px-3 text-white"
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
        className="mt-3 flex items-end gap-2"
        aria-label="Purchase composer"
      >
        <button
          type="button"
          aria-label="Microphone"
          data-hit-target="true"
          disabled={!voice.supported || loading}
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          className="cv-micro inline-flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--cv-line)] bg-white text-black transition-colors hover:bg-neutral-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          aria-pressed={voice.listening}
        >
          <MicGlyph size={18} />
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type or speak a purchase command"
          rows={1}
          className="min-h-[44px] flex-1 resize-none border border-[var(--cv-line)] bg-white px-3 py-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
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
          className="cv-micro inline-flex h-11 w-11 shrink-0 items-center justify-center bg-black text-white transition-colors hover:bg-neutral-800 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <Send2 size={18} />
        </button>
      </form>

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
