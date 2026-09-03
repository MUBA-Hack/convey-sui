"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Add,
  ArrowRight,
  DocumentText,
  Flash,
  MoneyRecive,
  Send2,
  ShieldTick,
  Wallet,
  Code1,
} from "@/components/icons";
import { useVoiceInput } from "@/components/commerce/use-voice-input";
import { CompanionResolutionSchema, type CompanionResolution } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";
import { EMPTY_COMPANION_MEMORY } from "@/lib/companion/memory";
import {
  createCompanionMemoryStore,
  type CompanionMemoryStore,
} from "@/lib/companion/memory-store";
import { CompanionOutcomeCard } from "@/components/companion/companion-outcome-card";
import { ProtectedSupportDemoCard } from "@/components/companion/protected-support-demo-card";
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
  { label: "Pay Dave 12 USDC", prompt: "Pay Dave 12 USDC for dinner", detail: "For dinner", icon: MoneyRecive },
  { label: "Support Ana safely", prompt: "Send Ana 25 USDC for medicine, release after pickup evidence", detail: "Release after pickup", icon: ShieldTick },
  { label: "Split this receipt", prompt: "Split this receipt", detail: "Add a photo next", icon: DocumentText },
  { label: "Protect 500 USDC", prompt: "Protect 500 USDC overnight", detail: "Bound an overnight strategy", icon: ShieldTick },
] as const;

const DESTINATIONS = [
  { href: "/pay", label: "Send money", detail: "Local or abroad", icon: Wallet },
  { href: "/qr-ferry", label: "Scan and pay", detail: "Pay, collect, or split by QR", icon: Code1 },
  { href: "/proof", label: "Recent activity", detail: "Receipts and status", icon: Activity },
  { href: "/settings", label: "Settings", detail: "Preferences and privacy", icon: ShieldTick },
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
  if (result.toolId === "missions.propose") {
    return "I mapped a protected medicine payment that releases after pickup evidence is approved.";
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
  const [memory, setMemory] = useState(initialMemory);
  const [activeMemoryMode, setActiveMemoryMode] = useState(memoryMode);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [personName, setPersonName] = useState("");
  const [personRelationship, setPersonRelationship] = useState("");
  const [personAddress, setPersonAddress] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [contractDemoOpen, setContractDemoOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", text: "I’m ready. Tell me what should happen with your money." },
  ]);
  const nextId = useRef(2);
  const reduceMotion = useReducedMotion();
  const voice = useVoiceInput({ onFinal: setInput });
  const memoryStoreRef = useRef<CompanionMemoryStore | null>(null);
  const rememberedPeople = useMemo(() => memory.contacts.slice(0, 4), [memory.contacts]);

  useEffect(() => {
    const store = createCompanionMemoryStore(window.localStorage);
    memoryStoreRef.current = store;
    const persisted = store.read();
    const sharedRequest = new URLSearchParams(window.location.search).get("request");
    const hydrationTimer = window.setTimeout(() => {
      if (persisted.contacts.length > 0 || persisted.interactions.length > 0) {
        setMemory(persisted);
        setActiveMemoryMode("live");
      }
      if (sharedRequest) setInput(sharedRequest.slice(0, 500));
    }, 0);
    return () => {
      window.clearTimeout(hydrationTimer);
      memoryStoreRef.current = null;
    };
  }, []);

  function rememberSamplePeople() {
    const store = memoryStoreRef.current;
    if (!store) return;
    let latest = store.read();
    for (const contact of initialMemory.contacts) {
      const result = store.rememberContact(contact);
      if (result.ok) latest = result.memory;
    }
    setMemory(latest);
    setActiveMemoryMode("live");
  }

  function addPerson() {
    const displayName = personName.trim();
    const address = personAddress.trim().toLowerCase();
    if (!displayName) {
      setPersonError("Enter the person's name.");
      return;
    }
    if (!/^0x[0-9a-f]{64}$/.test(address)) {
      setPersonError("Enter a complete Sui address starting with 0x.");
      return;
    }
    const id = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 42)}-${Date.now().toString(36)}`;
    const result = memoryStoreRef.current?.rememberContact({
      id,
      displayName,
      aliases: [],
      relationshipLabel: personRelationship.trim() || null,
      address,
      previousAddress: null,
      confirmation: "confirmed",
      confirmedAt: Date.now(),
    });
    if (!result?.ok) {
      setPersonError("That person could not be saved. Check the details and try again.");
      return;
    }
    setMemory(result.memory);
    setActiveMemoryMode("live");
    setAddingPerson(false);
    setPersonName("");
    setPersonRelationship("");
    setPersonAddress("");
    setPersonError(null);
    setInput(`Pay ${displayName} 12 USDC`);
  }

  function forgetPerson(contactId: string) {
    const result = memoryStoreRef.current?.forgetContact(contactId);
    if (result?.ok) {
      setMemory(result.memory);
      setActiveMemoryMode("live");
    }
  }

  function clearMemory() {
    const result = memoryStoreRef.current?.clearAll();
    if (result?.ok) {
      setMemory(result.memory);
      setActiveMemoryMode("live");
      setMemoryOpen(false);
    }
  }

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
                  ? activeMemoryMode === "sample"
                    ? rememberedPeople.length === 1
                      ? `Sample person · ${rememberedPeople[0]?.displayName}`
                      : `Sample people · ${rememberedPeople.map((person) => person.displayName).join(", ")}`
                    : `${rememberedPeople.length} remembered ${rememberedPeople.length === 1 ? "person" : "people"}`
                  : "Ready for your first request"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setMemoryOpen(true); setAddingPerson(true); }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-black/10 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
                aria-label="Add a person"
              >
                <Add size={18} />
              </button>
            {rememberedPeople.length > 0 && (
              <button
                type="button"
                aria-expanded={memoryOpen}
                aria-controls="companion-memory-panel"
                onClick={() => setMemoryOpen((current) => !current)}
                className="flex min-h-11 items-center -space-x-1.5 rounded-full px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
              >
                {rememberedPeople.map((person) => (
                  <span key={person.id} title={person.displayName} className="companion-avatar">
                    {person.displayName.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                <span className="sr-only">Manage remembered people</span>
              </button>
            )}
            </div>
          </div>

          {memoryOpen && (
            <section id="companion-memory-panel" className="companion-memory-panel" aria-label="Remembered people">
              <div>
                <p className="companion-eyebrow text-black/45">
                  {activeMemoryMode === "sample" ? "Sample context" : "Remembered on this device"}
                </p>
                <p className="mt-1 text-xs leading-5 text-black/58">
                  Names help prepare a request. Your wallet still approves every payment.
                </p>
              </div>
              {rememberedPeople.length > 0 && <div className="companion-memory-list">
                {rememberedPeople.map((person) => (
                  <div key={person.id} className="companion-memory-person">
                    <span className="companion-avatar">{person.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm font-medium text-black">{person.displayName}</strong>
                      <small className="block truncate text-[11px] text-black/45">
                        {person.relationshipLabel ?? "Contact"} · {person.confirmation === "confirmed" ? "address confirmed" : "address not confirmed"}
                      </small>
                    </span>
                    {activeMemoryMode === "live" && (
                      <button type="button" onClick={() => forgetPerson(person.id)} className="min-h-11 px-2 text-[11px] font-semibold text-black/55 hover:text-black">
                        Forget
                      </button>
                    )}
                  </div>
                ))}
              </div>}
              {addingPerson && (
                <div className="grid gap-3 border-t border-black/8 pt-4 sm:grid-cols-2">
                  <label className="text-xs font-medium">Name<input value={personName} onChange={(event) => setPersonName(event.target.value)} className="mt-1.5 min-h-11 w-full border border-black/12 bg-white px-3 outline-none focus:border-black" /></label>
                  <label className="text-xs font-medium">Relationship (optional)<input value={personRelationship} onChange={(event) => setPersonRelationship(event.target.value)} className="mt-1.5 min-h-11 w-full border border-black/12 bg-white px-3 outline-none focus:border-black" /></label>
                  <label className="text-xs font-medium sm:col-span-2">Sui address<input value={personAddress} onChange={(event) => setPersonAddress(event.target.value)} placeholder="0x..." className="mt-1.5 min-h-11 w-full border border-black/12 bg-white px-3 font-mono text-xs outline-none focus:border-black" /></label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <button type="button" onClick={() => { setPersonName("Maya"); setPersonRelationship("Teammate"); setPersonAddress(`0x${"3".repeat(64)}`); setPersonError(null); }} className="cv-btn-ghost min-h-11 px-4 text-xs font-semibold">Use Maya example</button>
                    <button type="button" onClick={addPerson} className="cv-btn-solid min-h-11 px-4 text-xs font-semibold">Save person</button>
                  </div>
                  {personError && <p role="alert" className="text-xs font-medium text-red-700 sm:col-span-2">{personError}</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {activeMemoryMode === "sample" ? (
                  <button type="button" onClick={rememberSamplePeople} className="cv-btn-solid min-h-11 rounded-full px-4 text-xs font-semibold">
                    Remember on this device
                  </button>
                ) : (
                  <button type="button" onClick={clearMemory} className="cv-btn-ghost min-h-11 rounded-full px-4 text-xs font-semibold">
                    Clear memory
                  </button>
                )}
                {!addingPerson && <button type="button" onClick={() => setAddingPerson(true)} className="cv-btn-ghost min-h-11 rounded-full px-4 text-xs font-semibold">Add person</button>}
                <button type="button" onClick={() => setMemoryOpen(false)} className="cv-btn-ghost min-h-11 rounded-full px-4 text-xs font-semibold">
                  Done
                </button>
              </div>
            </section>
          )}

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
              {contractDemoOpen && (
                <motion.div
                  key="smart-contract-demo"
                  initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="companion-message companion-message--contract-demo"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Smart contract demo"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setContractDemoOpen(false);
                  }}
                >
                  <ProtectedSupportDemoCard amountMajor="1" referenceMode onClose={() => setContractDemoOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>
            {messages.length === 1 && !loading && !contractDemoOpen && (
              <div className="companion-empty-actions">
                <Link href="/qr-ferry" className="companion-empty-action companion-empty-action--primary">
                  <Code1 size={22} />
                  <span><strong>Scan or show QR</strong><small>Pay, collect, split, or issue a pass</small></span>
                  <ArrowRight size={17} />
                </Link>
                <button type="button" onClick={() => { setMemoryOpen(true); setAddingPerson(true); }} className="companion-empty-action">
                  <Add size={20} />
                  <span><strong>Pay someone new</strong><small>Save their Sui address once</small></span>
                  <ArrowRight size={17} />
                </button>
                <button type="button" onClick={() => setInput("Split dinner with Maya, Idris, and Sam")} className="companion-empty-action">
                  <DocumentText size={20} />
                  <span><strong>Split by WhatsApp</strong><small>Create one request per person</small></span>
                  <ArrowRight size={17} />
                </button>
                <button type="button" onClick={() => setContractDemoOpen(true)} className="companion-empty-action companion-empty-action--contract">
                  <ShieldTick size={20} />
                  <span><strong>Demo smart contract</strong><small>Replay a real 1 USDC testnet payment</small></span>
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="companion-thinking" role="status">
                <span /><span /><span /><span className="sr-only">Companion is thinking</span>
              </motion.div>
            )}
          </div>

          <div className="companion-quick-row" aria-label="Suggested requests">
            {STARTER_PROMPTS.map(({ label, prompt }) => (
              <button key={label} type="button" onClick={() => setInput(prompt)} className="companion-quick-chip">
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
                disabled={!voice.supported || loading}
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
            <div className="min-h-5 px-2 pt-1 text-center text-[10px] text-black/48" aria-live="polite">
              {voice.listening
                ? voice.interimTranscript
                  ? `Listening · ${voice.interimTranscript}`
                  : "Listening…"
                : voice.error
                  ? voice.error === "not-allowed"
                    ? "Microphone permission was denied. Type your request instead."
                    : "Voice input stopped. Type your request or try again."
                  : !voice.supported
                    ? "Voice input is unavailable in this browser."
                    : ""}
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
              {STARTER_PROMPTS.map(({ label, prompt, detail, icon: Icon }) => (
                <button key={label} type="button" onClick={() => setInput(prompt)} className="companion-action-row">
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
          <Link href="/qr-ferry"><Code1 size={19} /><span>Scan</span></Link>
          <Link href="/proof"><Activity size={19} /><span>Activity</span></Link>
          <Link href="/settings"><ShieldTick size={19} /><span>Settings</span></Link>
        </nav>
      )}
    </section>
  );
}
