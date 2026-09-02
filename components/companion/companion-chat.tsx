"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowRight,
  DocumentText,
  Flash,
  MoneyRecive,
  Send2,
  ShieldTick,
  Wallet,
} from "@/components/icons";
import { useVoiceInput } from "@/components/commerce/use-voice-input";
import { CompanionResolutionSchema, type CompanionResolution } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";
import { EMPTY_COMPANION_MEMORY } from "@/lib/companion/memory";
import { CompanionOutcomeCard } from "@/components/companion/companion-outcome-card";
import { recordAiDecisionReceipt } from "@/lib/activity/ai-decision-receipt";
import { BrandMark } from "@/components/site-header";
import { WalletConnectButton } from "@/components/wallet/connect-button";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  sourceMessage?: string;
  resolution?: CompanionResolution;
};

const STARTER_PROMPTS = [
  { label: "Pay Dave 12 USDC", detail: "For dinner", icon: MoneyRecive },
  { label: "Split this receipt", detail: "Add a photo next", icon: DocumentText },
  { label: "Protect 500 USDC", detail: "Map a downside strategy", icon: ShieldTick },
] as const;

const DESTINATIONS = [
  { href: "/pay", label: "Send money", detail: "Local or abroad", icon: Wallet },
  { href: "/qr-ferry", label: "Scan to continue", detail: "Move between devices", icon: Flash },
  { href: "/proof", label: "Recent activity", detail: "Receipts and status", icon: Activity },
] as const;

function MicGlyph({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      {active && <span className="absolute inset-0 animate-ping rounded-full bg-black/12" />}
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    </span>
  );
}

function responseText(result: CompanionResolution): string {
  if (result.toolId === "splits.propose") {
    return "Add the receipt, check each line, and I’ll prepare the requests.";
  }
  if (result.toolId === "strategies.propose") {
    return "I prepared a limited overnight protection policy for you to shape.";
  }
  if (result.outcome === "proposal" && result.proposal) {
    return `I prepared ${result.proposal.amountMajor} ${result.proposal.asset} for ${result.proposal.contactLabel}.`;
  }
  if (result.clarification) return result.clarification.question;
  if (result.outcome === "unavailable") {
    return "I can map that request, but I cannot carry it out yet.";
  }
  return "I could not prepare that safely. Try a clearer request.";
}

export function CompanionChat({
  initialMemory = EMPTY_COMPANION_MEMORY,
  memoryMode = "live",
  variant = "showcase",
}: {
  initialMemory?: CompanionMemory;
  memoryMode?: "live" | "sample";
  variant?: "showcase" | "app";
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", text: "I’m ready. Tell me what should happen with your money." },
  ]);
  const nextId = useRef(2);
  const reduceMotion = useReducedMotion();
  const memory = initialMemory;
  const voice = useVoiceInput({ onFinal: setInput });
  const rememberedPeople = useMemo(() => memory.contacts.slice(0, 4), [memory.contacts]);

  const addMessage = (message: Omit<Message, "id">) => {
    const id = nextId.current;
    nextId.current += 1;
    setMessages((current) => [...current, { ...message, id }]);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;
    addMessage({ role: "user", text: message });
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/companion/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          localeHint: typeof navigator === "undefined" ? "en" : navigator.language,
          memory,
        }),
      });
      if (!response.ok) throw new Error("request_failed");
      const parsed = CompanionResolutionSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid_response");
      if (parsed.data.routing.mode === "live" && parsed.data.routing.requestId && parsed.data.routing.responseModel) {
        recordAiDecisionReceipt({
          requestId: parsed.data.routing.requestId,
          model: parsed.data.routing.responseModel,
          timestamp: new Date().toISOString(),
          status: "unverified",
        });
      }
      addMessage({ role: "assistant", text: responseText(parsed.data), sourceMessage: message, resolution: parsed.data });
    } catch {
      addMessage({
        role: "assistant",
        text: "I couldn’t reach the companion just now. Your request was not carried out.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section data-testid="companion-chat" data-variant={variant} className={variant === "app" ? "companion-shell companion-shell--app" : "companion-shell mx-auto w-full max-w-[1380px] px-4 py-4 md:px-6 md:py-6"}>
      <div className="companion-layout">
        <div className="companion-window">
          {variant === "app" ? (
            <header className="companion-app-header">
              <Link href="/" aria-label="Convey website" className="flex items-center gap-2.5">
                <BrandMark size={31} />
                <span><b>Convey</b><small>Good evening</small></span>
              </Link>
              <WalletConnectButton />
            </header>
          ) : <header className="companion-hero">
            <div className="companion-hero-media" aria-hidden>
              {reduceMotion ? (
                <Image src="/media/convey-intent-poster.webp" alt="" fill sizes="(max-width: 640px) 74vw, 62vw" priority />
              ) : (
                <video autoPlay muted loop playsInline poster="/media/convey-intent-poster.webp">
                  <source src="/media/convey-intent-route.webm" type="video/webm" />
                  <source src="/media/convey-intent-route.mp4" type="video/mp4" />
                </video>
              )}
            </div>
            <div className="relative z-10 max-w-[680px]">
              <p className="companion-eyebrow text-white/52">Your money, in plain language</p>
              <h1 className="mt-3 text-[38px] font-medium leading-[0.98] tracking-[-0.055em] text-white sm:text-[54px]">
                What should happen?
              </h1>
              <p className="mt-4 max-w-[570px] text-sm leading-6 text-white/68 sm:text-[15px]">
                Speak, type, or scan. Convey turns your request into a clear next move, ready for your approval.
              </p>
            </div>
          </header>}

          <div className="companion-people">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="companion-live-dot" aria-hidden />
              <p className="truncate text-xs font-medium text-black">
                {rememberedPeople.length > 0
                  ? memoryMode === "sample"
                    ? `Sample person · ${rememberedPeople[0]?.displayName}`
                    : `${rememberedPeople.length} remembered ${rememberedPeople.length === 1 ? "person" : "people"}`
                  : "Ready for your first request"}
              </p>
            </div>
            {rememberedPeople.length > 0 && (
              <div className="flex -space-x-1.5">
                {rememberedPeople.map((person) => (
                  <span key={person.id} title={person.displayName} className="companion-avatar">
                    {person.displayName.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="companion-thread" aria-live="polite">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.article
                  key={message.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className={message.role === "user" ? "companion-message companion-message--user" : "companion-message"}
                >
                  <div className={message.role === "user" ? "companion-bubble companion-bubble--user" : "companion-bubble"}>
                    {message.text}
                  </div>
                  {message.resolution && <CompanionOutcomeCard result={message.resolution} message={message.sourceMessage ?? message.text} memory={memory} />}
                </motion.article>
              ))}
            </AnimatePresence>
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="companion-thinking" role="status">
                <span /><span /><span /><span className="sr-only">Companion is thinking</span>
              </motion.div>
            )}
          </div>

          <div className="companion-quick-row" aria-label="Suggested requests">
            {STARTER_PROMPTS.map(({ label }) => (
              <button key={label} type="button" onClick={() => setInput(label)} className="companion-quick-chip">
                {label}
              </button>
            ))}
          </div>

          <form
            className="companion-composer-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <div className="companion-composer">
              <button
                type="button"
                aria-label={voice.listening ? "Stop listening" : "Start voice input"}
                aria-pressed={voice.listening}
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
                className="companion-icon-button"
              >
                <MicGlyph active={voice.listening} />
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Ask Convey anything…"
                rows={1}
                aria-label="Companion message"
                className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-3.5 text-sm leading-5 text-black outline-none placeholder:text-black/35"
              />
              <button type="submit" aria-label="Send" disabled={!input.trim() || loading} className="companion-send-button">
                <Send2 size={18} />
              </button>
            </div>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[10px] text-black/42 sm:text-[11px]">
              <ShieldTick size={12} />
              Nothing moves without your approval.
            </p>
          </form>
        </div>

        <aside className="companion-sidebar">
          <div className="companion-side-card companion-side-card--actions">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="companion-eyebrow text-black/42">Try asking</p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-black">Start with one move.</h2>
              </div>
              <span className="companion-spark"><Flash size={18} /></span>
            </div>
            <div className="mt-5 grid gap-2.5">
              {STARTER_PROMPTS.map(({ label, detail, icon: Icon }) => (
                <button key={label} type="button" onClick={() => setInput(label)} className="companion-action-row">
                  <span className="companion-action-icon"><Icon size={17} /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-black">{label}</span>
                    <span className="mt-0.5 block text-[11px] text-black/45">{detail}</span>
                  </span>
                  <ArrowRight size={15} className="text-black/35" />
                </button>
              ))}
            </div>
          </div>

          <div className="companion-side-card companion-side-card--continue">
            <p className="companion-eyebrow text-black/42">Continue</p>
            <div className="mt-3 divide-y divide-black/8">
              {DESTINATIONS.map(({ href, label, detail, icon: Icon }) => (
                <Link key={href} href={href} className="companion-destination">
                  <span className="companion-destination-icon"><Icon size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-black">{label}</span>
                    <span className="mt-0.5 block text-[11px] text-black/45">{detail}</span>
                  </span>
                  <ArrowRight size={15} className="text-black/30" />
                </Link>
              ))}
            </div>
          </div>

          <div className="companion-trust-card">
            <div className="companion-trust-mark"><ShieldTick size={18} /></div>
            <div>
              <p className="text-sm font-medium text-white">You stay in control.</p>
              <p className="mt-1 text-[11px] leading-5 text-white/52">Convey prepares. You review and approve.</p>
            </div>
          </div>
        </aside>
      </div>

      {variant === "app" && (
        <nav className="companion-mobile-nav" aria-label="Primary app navigation">
          <Link href="/app" aria-current="page"><Flash size={19} /><span>Talk</span></Link>
          <Link href="/pay"><Wallet size={19} /><span>Pay</span></Link>
          <Link href="/proof"><Activity size={19} /><span>Activity</span></Link>
          <Link href="/strategy"><ShieldTick size={19} /><span>Treasury</span></Link>
        </nav>
      )}
    </section>
  );
}
