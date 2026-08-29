"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PurchaseIntentPreview,
  PurchaseIntentResult,
  RoutingMetadata,
} from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import { ArrowRight, Send2, ShieldTick } from "@/components/icons";
import { useVoiceInput } from "./use-voice-input";
import { PurchasePreview, type PreviewStatus, mistToSui } from "./purchase-preview";
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
 * Compact digest mark for the outcome slab. Mirrors the receipt card's
 * `shortId` truncation so a real testnet digest and a DEMO digest both render
 * as a single truncated monospace line; the full value is preserved in
 * `title`/`data-full` for assistive tech. Strings of 16 chars or fewer
 * (e.g. the dormant dash) pass through unchanged.
 */
function shortDigest(value: string, head = 7, tail = 6): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Compact, monochrome routing-provenance line (Gonka phase 2).
 *
 * Surfaces honest routing provenance for every assistant turn WITHOUT upsetting
 * the black-and-white layout and WITHOUT competing with the preview card or the
 * outcome slab:
 *  - A successful Gonka route shows a polished visible "GONKA ROUTED" pill + a
 *    short model id + a truncated request id. The full model/request id are
 *    kept in the accessible label and data attributes for assistive tech and
 *    judges.
 *  - Any fallback shows ONLY a small, muted, human label "Local safety route"
 *    — no pill, no raw snake_case enum in the receipt body. The raw reason
 *    enum stays in `data-routing-reason` (structured metadata for judges) and
 *    is humanized ("not_configured" → "not configured") in the accessible
 *    label / sr-only text so assistive tech still exposes the safe reason in
 *    human language. It never implies Gonka ran.
 *
 * Never shows the API key, base URL, or raw provider error text. Stays compact
 * so it never competes with the preview card, the amount, or the confirm
 * control.
 */
function RoutingProvenance({ routing }: { routing: RoutingMetadata }) {
  if (routing.provider === "gonkarouter" && routing.mode === "live") {
    const fullModel = routing.responseModel ?? routing.requestedModel ?? "";
    const shortModel = fullModel ? fullModel.split("/").pop() ?? fullModel : "";
    const fullReq = routing.requestId ?? "";
    const shortReq = fullReq
      ? fullReq.length <= 12
        ? fullReq
        : `${fullReq.slice(0, 8)}…`
      : "";
    const a11y = `Routed by GonkaRouter${
      fullModel ? `, model ${fullModel}` : ""
    }${fullReq ? `, request id ${fullReq}` : ""}`;
    return (
      <div
        data-testid="routing-provenance"
        data-routing-provider="gonkarouter"
        data-routing-mode="live"
        data-routing-model={fullModel || undefined}
        data-routing-request-id={fullReq || undefined}
        className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600"
        aria-label={a11y}
      >
        <span className="inline-flex items-center rounded-full border border-black px-2 py-0.5 text-black">
          Gonka routed
        </span>
        {shortModel && (
          <span className="font-mono normal-case tracking-normal text-neutral-500">
            {shortModel}
          </span>
        )}
        {shortReq && (
          <span className="font-mono normal-case tracking-normal text-neutral-400">
            {shortReq}
          </span>
        )}
        <span className="sr-only">{a11y}</span>
      </div>
    );
  }

  // Fallback — never imply Gonka ran. Only a small, muted, human label is
  // shown; the raw snake_case reason enum never appears in the visible receipt
  // body. It is preserved verbatim in `data-routing-reason` for structured
  // metadata/judges and humanized in the accessible label + sr-only text so
  // assistive tech still exposes the safe reason in human language.
  const reason = routing.fallbackReason ?? "provider_error";
  const humanReason = reason.replace(/_/g, " ");
  const a11y = `Local safety route, fallback reason ${humanReason}`;
  return (
    <div
      data-testid="routing-provenance"
      data-routing-provider="deterministic"
      data-routing-mode="fallback"
      data-routing-reason={reason}
      className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400"
      aria-label={a11y}
    >
      <span aria-hidden>Local safety route</span>
      <span className="sr-only">{a11y}</span>
    </div>
  );
}

/**
 * Outcome stage status — the single honest label for the slab's state.
 * `AWAITING` before any validated intent, `VALIDATED` once a typed preview
 * lands (still not a settlement), `PROOF` after a terminal receipt.
 */
type OutcomeStatus = "AWAITING" | "VALIDATED" | "PROOF";

/**
 * Contactless-scanning-inspired readiness motif — the CENTRAL target of the
 * payment instrument card. Three high-contrast concentric monochrome rings
 * around a mic marker, sized to occupy a meaningful share of the card area
 * (not a faint corner glyph). The rings are STATIC — no infinite animation —
 * so reduced-motion users see the same composition without movement, and the
 * motif never implies a recording session, transaction, funds, settlement, or
 * device NFC. The only state change is honest: when `listening` is true the
 * inner disc fills and the mic fills to mirror an active SpeechRecognition
 * session; when idle the rings stay open and the mic stays outlined (no false
 * recording implication).
 */
function ReadinessRings({ listening }: { listening: boolean }) {
  return (
    <svg
      aria-hidden
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      className="shrink-0 text-white"
    >
      <circle cx="90" cy="90" r="86" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <circle cx="90" cy="90" r="66" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1.5" />
      <circle cx="90" cy="90" r="46" stroke="currentColor" strokeOpacity="0.72" strokeWidth="1.5" />
      {listening && (
        <circle
          cx="90"
          cy="90"
          r="30"
          fill="currentColor"
          fillOpacity="0.92"
          data-readiness-pulse="true"
        />
      )}
      <g
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={listening ? "currentColor" : "none"}
        fillOpacity={listening ? 0.92 : undefined}
      >
        <rect x="82" y="70" width="16" height="30" rx="8" />
        <path d="M70 96a20 20 0 0 0 40 0" />
        <path d="M90 116v6" />
      </g>
    </svg>
  );
}

/**
 * Coherent transform of the readiness rings for the VALIDATED / PROOF states.
 * The concentric rings collapse to a solid white disc with a black checkmark —
 * the instrument shifts from "ready to receive" to "carrying a value/proof".
 * Static, no animation. The disc stays the same size as the readiness target so
 * the card's central area never collapses into an empty void when the rings
 * disappear; the instrument remains a bounded, coherent object.
 */
function StageMark({ status }: { status: "VALIDATED" | "PROOF" }) {
  const isProof = status === "PROOF";
  return (
    <svg
      aria-hidden
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      className="shrink-0 text-white"
    >
      <circle cx="90" cy="90" r="86" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
      <circle cx="90" cy="90" r="66" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <circle cx="90" cy="90" r="46" fill="currentColor" fillOpacity={isProof ? 0.95 : 0.82} />
      <path
        d="M73 90l12 13 22-25"
        stroke="#000"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Tactile black payment instrument card — the desktop outcome stage's single
 * bounded object. A centered, portrait/square-ish black card with rounded
 * corners and a soft shadow, visibly separate from the off-white page (not a
 * full-width band). The same card renders all three states (dormant /
 * validated / proof) so the home never falls back to a white explanatory hole:
 *
 *  - header: status pill (AWAITING / VALIDATED / PROOF) + a subordinate
 *    `Settlement` overline
 *  - center: a LARGE readiness target (high-contrast concentric rings + mic)
 *    while AWAITING; a coherent StageMark (solid disc + check) once a value or
 *    proof is carried — the central area is never a vacant void
 *  - bottom: a WHITE INSET amount/action tray fusing the amount and the
 *    interaction cue on one surface — a dominant tabular `0.00 SUI` tightly
 *    coupled with a mic/arrow cue, the digest subordinate below, and an honest
 *    state caption
 *
 * Claims stay honest: a validated card shows an explicit "not a settlement"
 * qualifier and a dash digest; a dormant card shows a 0.00 amount, an AWAITING
 * pill, and a dash digest — never a fake balance or settlement. The readiness
 * label never implies recording when idle, and never mentions transaction,
 * funds, settlement, or NFC. A visually-hidden `aria-live` region exposes the
 * listening-off / no-transaction state to assistive tech so "listening off" is
 * never merely implied. The card is desktop-only; the mobile receipt/proof
 * components are untouched.
 */
function PaymentInstrument({
  status,
  amount,
  digest,
  digestFull,
  listening,
  voiceSupported,
}: {
  status: OutcomeStatus;
  amount: string;
  digest: string;
  digestFull?: string;
  listening: boolean;
  voiceSupported: boolean;
}) {
  // The readiness target is the AWAITING affordance only. It transforms
  // deliberately into a StageMark once the instrument carries a validated
  // value or a proof, so the central area stays occupied and coherent.
  const showReadiness = status === "AWAITING";
  const readinessLabel = listening
    ? "Listening"
    : voiceSupported
      ? "Say or type to begin"
      : "Type to begin";
  const centerLabel = showReadiness
    ? readinessLabel
    : status === "PROOF"
      ? "Proof recorded"
      : "Validated — ready to confirm";
  return (
    <div
      data-testid="outcome-card"
      className="cv-payment-card mx-auto flex w-full max-w-[420px] flex-col gap-5 rounded-[28px] bg-black p-6 text-white shadow-[0_24px_60px_rgba(0,0,0,0.28)] ring-1 ring-black/10"
    >
      {/* Header — status pill (the honest state) + a subordinate overline. */}
      <div className="flex items-center justify-between gap-3">
        <span
          data-testid="outcome-status-pill"
          data-outcome-status={status.toLowerCase()}
          className="inline-flex items-center rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85"
        >
          {status}
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
          Settlement
        </p>
      </div>

      {/* Center — the large readiness target (AWAITING) or its coherent
          transform (VALIDATED / PROOF). Occupies the meaningful card area. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-1">
        {showReadiness ? (
          <div
            data-testid="outcome-readiness"
            data-readiness={listening ? "listening" : "idle"}
            className="flex flex-col items-center gap-4"
          >
            <ReadinessRings listening={listening} />
            <p
              data-testid="outcome-readiness-label"
              data-readiness-listening={listening ? "true" : undefined}
              className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75"
            >
              {readinessLabel}
            </p>
          </div>
        ) : (
          <div
            data-testid="outcome-stage-mark"
            data-stage-mark={status.toLowerCase()}
            className="flex flex-col items-center gap-4"
          >
            <StageMark status={status} />
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
              {centerLabel}
            </p>
          </div>
        )}
      </div>

      {/* Bottom — white inset amount/action tray. Fuses the dominant tabular
          amount and the mic/arrow interaction cue on ONE surface so amount and
          action are never separated by a void. Digest + honest caption sit
          subordinate below the amount. */}
      <div className="rounded-2xl bg-white p-4 text-black">
        <div className="flex items-center justify-between gap-3">
          <p
            data-testid="outcome-amount"
            className="font-mono text-[44px] font-medium leading-[0.9] tracking-[-0.04em] tabular-nums text-black md:text-[48px]"
          >
            {amount}
            <span className="ml-1.5 align-baseline text-[14px] font-semibold uppercase tracking-[0.16em] text-black/55 md:text-[16px]">
              SUI
            </span>
          </p>
          {/* Mic + arrow cue tightly coupled to the amount on the same tray. */}
          <div
            data-testid="outcome-action-cue"
            aria-hidden
            className="flex items-center gap-1.5 text-black/70"
          >
            <MicGlyph size={20} />
            <ArrowRight size={20} />
          </div>
        </div>
        <dl className="mt-3 min-w-0 space-y-1.5 border-t border-black/10 pt-3">
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/45">
              Digest
            </dt>
            <dd
              data-testid="outcome-digest"
              className="mt-0.5 truncate font-mono text-xs text-black/85"
              title={digestFull}
              data-full={digestFull}
            >
              {digest}
            </dd>
          </div>
        </dl>
        {status === "AWAITING" && (
          <p
            data-testid="outcome-awaiting-caption"
            className="mt-3 text-[11px] leading-relaxed text-black/55"
          >
            Awaiting your first command — no transaction yet.
          </p>
        )}
        {status === "VALIDATED" && (
          <p className="mt-3 text-[11px] leading-relaxed text-black/55">
            Validated intent — not a settlement. No transaction until you confirm.
          </p>
        )}
        {status === "PROOF" && (
          <p className="mt-3 text-[11px] leading-relaxed text-black/55">
            Settlement proof recorded.
          </p>
        )}
      </div>

      {/* Assistive-tech honest listening state. The visible readiness label
          already states idle/listening; this region exposes the same fact to
          screen readers so "listening off" is never merely implied, and never
          claims a transaction, funds, or settlement when none exists. */}
      <p aria-live="polite" className="sr-only">
        {listening
          ? "Microphone on, listening for a command."
          : "Microphone off. No transaction in progress."}
      </p>
    </div>
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
  routing?: RoutingMetadata;
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
  const stopVoice = voice.stop;

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
    return () => stopVoice();
  }, [stopVoice]);

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
      const body = (await res.json()) as PurchaseIntentResult & {
        routing?: RoutingMetadata;
      };
      if (body.kind === "preview") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: "Here is the validated preview. Confirm to continue.",
            preview: body,
            previewStatus: "pending",
            routing: body.routing,
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
            routing: body.routing,
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

  // Reactive safety lifecycle phase, derived from the live thread state so the
  // rail is always honest: language -> deterministic validation -> human
  // confirmation -> settlement proof. Compact and monochrome.
  const safetyPhase: "language" | "validation" | "confirmation" | "proof" =
    (() => {
      if (messages.length === 0) return "language";
      const last = messages[messages.length - 1]!;
      if (last.receipt) return "proof";
      if (last.preview) return last.previewStatus === "confirmed" ? "proof" : "confirmation";
      return "validation";
    })();

  // Outcome stage derivation — the desktop canvas-filling object that mirrors
  // the live thread state through a single black amount-slab grammar. The slab
  // is dormant (0.00 SUI, AWAITING, dash digest) before any validated intent —
  // a dominant zero, not a ghosted dash, so money is the visual apex even at
  // rest — switches to the validated preview amount (VALIDATED, dash digest,
  // explicit not-a-settlement qualifier) once a typed preview lands, and to the
  // receipt amount + compact digest (PROOF) after a terminal settlement. It
  // never fakes a balance or settlement.
  const lastWithPreview = [...messages].reverse().find((m) => m.preview);
  const stageReceipt = lastWithPreview?.receipt ?? null;
  const stagePreview = lastWithPreview?.preview ?? null;

  const slabStatus: OutcomeStatus = stageReceipt
    ? "PROOF"
    : stagePreview
      ? "VALIDATED"
      : "AWAITING";
  const slabAmount = stageReceipt
    ? mistToSui(stageReceipt.amountMist)
    : stagePreview
      ? mistToSui(stagePreview.totalMist)
      : "0.00";
  const slabDigest = stageReceipt ? shortDigest(stageReceipt.digest) : "—";
  const slabDigestFull = stageReceipt ? stageReceipt.digest : undefined;

  const canSend = input.trim().length > 0 && !loading;
  const isEmpty = messages.length === 0 && !loading;

  return (
    <section
      data-palette="monochrome"
      aria-label="Convey chat"
      className="cv-shell mx-auto w-full max-w-[1120px] px-4 py-3 md:py-8"
    >
      <div
        data-testid="desktop-payment-workspace"
        className="grid items-start gap-4 lg:grid-cols-[minmax(340px,0.82fr)_minmax(0,1.18fr)] lg:gap-5"
      >
        <section
        data-testid="outcome-stage"
        data-outcome-phase={safetyPhase}
        aria-label="Outcome stage"
        className="cv-enter cv-enter-step-1 hidden min-w-0 flex-col gap-3 lg:flex"
      >
        <PaymentInstrument
          status={slabStatus}
          amount={slabAmount}
          digest={slabDigest}
          digestFull={slabDigestFull}
          listening={voice.listening}
          voiceSupported={voice.supported}
        />
        </section>

        <div data-testid="command-workspace" className="min-w-0">

      <div
        data-testid="commerce-hero"
        className={`cv-enter cv-enter-step-1 mb-3 overflow-hidden text-black md:mb-4 md:border md:border-black md:bg-black md:text-white md:shadow-[0_18px_40px_rgba(0,0,0,0.12)] lg:hidden${
          safetyPhase === "proof" ? " hidden" : ""
        }`}
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-4 md:p-5">
          <div className="max-w-2xl md:space-y-2">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55 md:block">
              Voice commerce for Sui
            </p>
            <h1 className="text-xl font-medium tracking-[-0.03em] md:text-4xl md:leading-[0.95] md:tracking-[-0.05em]">
              Say it. Approve it. Settle on Sui.
            </h1>
            <p
              data-testid="hero-description"
              className="hidden max-w-xl text-[15px] leading-relaxed text-white/72 md:block"
            >
              Minimal black-and-white purchase flow with voice, chat, client-signed checkout,
              and Offline QR Ferry.
            </p>
          </div>
        </div>

        <div
          data-testid="hero-proof-rail"
          className="hidden border-t border-white/10 md:grid md:grid-cols-3"
        >
          {[
            { label: "Voice", value: "Speech → typed intent" },
            { label: "Checkout", value: "Human confirm only" },
            { label: "Offline", value: "QR Ferry handoff" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0 md:px-5"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                {item.label}
              </span>
              <span className="text-right text-xs text-white/85">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

        <div className="cv-panel cv-enter flex flex-col p-3 md:p-4">
          <header className="mb-3 flex items-center justify-between gap-3 border-b border-black/10 pb-3">
            <h2 className="text-base font-medium tracking-[-0.02em] text-black md:text-lg">
              What would you like to buy?
            </h2>
            <p className="hidden max-w-[14rem] text-right text-[11px] leading-relaxed text-neutral-500 md:block">
              Try: <span className="font-medium text-neutral-700">{GOLDEN_PROMPT}</span>
            </p>
          </header>

          <div className="mb-3 hidden items-center gap-3 border-b border-black/10 pb-3 lg:flex">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              <ShieldTick size={13} />
              Lifecycle
            </span>
            <ol
              className="grid min-w-0 flex-1 grid-cols-4 gap-1"
              data-testid="safety-lifecycle"
            >
              {([
                { key: "language", label: "Language" },
                { key: "validation", label: "Validation" },
                { key: "confirmation", label: "Confirmation" },
                { key: "proof", label: "Settlement proof" },
              ] as const).map((step, i) => {
                const active = safetyPhase === step.key;
                return (
                  <li
                    key={step.key}
                    data-safety-phase={step.key}
                    data-safety-active={active ? "true" : undefined}
                    className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 ${
                      active ? "bg-black text-white" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium ${
                        active ? "bg-white text-black" : "bg-white text-neutral-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="truncate text-[10px] font-medium">{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Thread — desktop collapses to content when empty (no giant pale
              void below the prompt cards); grows to fill once messages exist.
              Mobile keeps a small min-height for thumb-reach breathing room.
              The composer stays pinned just below via the panel's flex-col. */}
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
                data-message-preview={m.preview ? "true" : "false"}
                className={
                  m.role === "user"
                    ? "cv-bubble-user cv-enter self-end max-w-[85%] px-3.5 py-2.5 text-sm"
                    : m.preview
                      // A preview/result message is a full-width result block,
                      // not an ordinary chat bubble: it drops the bubble chrome
                      // and horizontal inset so the receipt card and its
                      // identifiers/actions get the full thread width on mobile
                      // instead of wrapping awkwardly. The label text is padded
                      // inline so it never sits flush to the edge.
                      ? "cv-enter w-full self-start py-2.5 text-sm"
                      : "cv-bubble-bot cv-enter self-start max-w-[90%] px-3.5 py-2.5 text-sm"
                }
              >
                <p className={`whitespace-pre-wrap${m.preview ? " px-3.5" : ""}`}>{m.text}</p>
                {m.routing && (
                  <div className={m.preview ? "px-3.5" : ""}>
                    <RoutingProvenance routing={m.routing} />
                  </div>
                )}
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
              placeholder="Buy something…"
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

        </div>
      </div>

      {/* Mobile context (below the chat, compact reactive lifecycle) */}
      <aside
        aria-label="Safety lifecycle"
        className="cv-panel cv-enter mt-4 flex flex-col gap-2 p-3 lg:hidden"
      >
        <div className="flex items-center gap-2">
          <ShieldTick size={14} className="text-black" />
          <h2 className="text-xs font-semibold tracking-tight text-black">
            Safety lifecycle
          </h2>
        </div>
        <ol className="flex flex-wrap gap-x-3 gap-y-1.5" data-testid="safety-lifecycle-mobile">
          {([
            { key: "language", label: "Language" },
            { key: "validation", label: "Validation" },
            { key: "confirmation", label: "Confirm" },
            { key: "proof", label: "Proof" },
          ] as const).map((step, i) => {
            const active = safetyPhase === step.key;
            return (
              <li
                key={step.key}
                data-safety-phase={step.key}
                data-safety-active={active ? "true" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium ${
                  active ? "bg-black text-white" : "bg-white text-neutral-600 border border-black/10"
                }`}
              >
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px]">
                  {i + 1}
                </span>
                {step.label}
              </li>
            );
          })}
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
