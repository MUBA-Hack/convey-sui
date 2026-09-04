"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Add,
  ArrowDown2,
  ArrowRight,
  DocumentText,
  Flash,
  MoneyRecive,
  People,
  Judge,
  SearchNormal1,
  Send2,
  ShieldTick,
  TickCircle,
  Wallet,
  Code1,
} from "@/components/icons";
import type { IconComponent } from "@/components/icons";
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
import {
  COMPANION_WORKSPACES,
  DEFAULT_COMPANION_WORKSPACE_ID,
  createCompanionWorkspaceStore,
  getCompanionWorkspace,
  type CompanionWorkspaceId,
  type CompanionWorkspaceStore,
} from "@/lib/companion/workspaces";
import {
  createCompanionOrganizationStore,
  organizationKindLabel,
  workspaceIdForOrganization,
  type CompanionOrganization,
  type CompanionOrganizationKind,
  type CompanionOrganizationStore,
} from "@/lib/companion/organizations";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  sourceMessage?: string;
  resolution?: CompanionResolution;
};

type StarterPrompt = {
  label: string;
  prompt: string;
  detail: string;
  icon: IconComponent;
};

type Destination = {
  href: string;
  label: string;
  detail: string;
  icon: IconComponent;
};

type EmptyAction = {
  kind: "link" | "prompt" | "memory" | "contract";
  label: string;
  detail: string;
  icon: IconComponent;
  href?: string;
  prompt?: string;
};

type WorkspaceBrief = {
  eyebrow: string;
  title: string;
  body: string;
  steps: readonly string[];
  sideEyebrow: string;
  sideTitle: string;
  trustTitle: string;
  trustBody: string;
};

const STARTER_PROMPTS_BY_WORKSPACE: Record<CompanionWorkspaceId, readonly StarterPrompt[]> = {
  personal: [
    { label: "Pay Dave 12 USDC", prompt: "Pay Dave 12 USDC for dinner", detail: "For dinner", icon: MoneyRecive },
    { label: "Help after a flood", prompt: "Send Ana 25 USDC for flood supplies, release after delivery evidence", detail: "Release after evidence", icon: ShieldTick },
    { label: "Split this receipt", prompt: "Split this receipt", detail: "Add a photo next", icon: DocumentText },
    { label: "Protect 500 USDC", prompt: "Protect 500 USDC overnight", detail: "Bound an overnight strategy", icon: ShieldTick },
  ],
  ngo: [
    { label: "Review field evidence", prompt: "Review this field report before releasing the aid payment", detail: "Compare evidence first", icon: SearchNormal1 },
    { label: "Release emergency aid", prompt: "Send Ana 25 USDC for flood supplies, release after delivery evidence", detail: "Evidence-gated support", icon: ShieldTick },
    { label: "Reconcile receipts", prompt: "Check these relief receipts against our funded items", detail: "Prepare an audit trail", icon: DocumentText },
    { label: "Protect aid reserve", prompt: "Protect 500 USDC of our aid reserve overnight", detail: "Bound the risk", icon: ShieldTick },
  ],
  treasury: [
    { label: "Reimburse Dave", prompt: "Pay Dave 12 USDC for club supplies", detail: "Club supplies", icon: MoneyRecive },
    { label: "Split club receipt", prompt: "Split this club receipt", detail: "Prepare reimbursements", icon: DocumentText },
    { label: "Pay Ana after pickup", prompt: "Send Ana 25 USDC for medicine, release after pickup evidence", detail: "Require evidence", icon: ShieldTick },
    { label: "Protect club reserve", prompt: "Protect 500 USDC of our club reserve overnight", detail: "Bound the risk", icon: ShieldTick },
  ],
};

const DESTINATIONS_BY_WORKSPACE: Record<CompanionWorkspaceId, readonly Destination[]> = {
  personal: [
    { href: "/pay", label: "Send money", detail: "Local or abroad", icon: Wallet },
    { href: "/verify", label: "Verify a claim", detail: "Two independent Gonka reviews", icon: SearchNormal1 },
    { href: "/qr-ferry", label: "Scan and pay", detail: "Pay, collect, or split by QR", icon: Code1 },
    { href: "/proof", label: "Recent activity", detail: "Receipts and status", icon: Activity },
    { href: "/settings", label: "Settings", detail: "Preferences and privacy", icon: ShieldTick },
  ],
  ngo: [
    { href: "/verify", label: "Verify evidence", detail: "Compare independent reviews", icon: SearchNormal1 },
    { href: "/pay", label: "Release aid", detail: "Add evidence and expiry", icon: ShieldTick },
    { href: "/qr-ferry", label: "Collect donations", detail: "QR for field or campaign", icon: Code1 },
    { href: "/proof", label: "Donor outcomes", detail: "Trace every released payment", icon: Activity },
    { href: "/settings", label: "Organization settings", detail: "Members and controls", icon: ShieldTick },
  ],
  treasury: [
    { href: "/pay", label: "Send or reimburse", detail: "Prepare an exact payment", icon: Wallet },
    { href: "/verify", label: "Review a claim", detail: "Compare independent reviews", icon: SearchNormal1 },
    { href: "/qr-ferry", label: "Collect by QR", detail: "Dues, events, or sales", icon: Code1 },
    { href: "/strategy", label: "Protect reserves", detail: "Bound a treasury strategy", icon: Judge },
    { href: "/settings", label: "Treasury settings", detail: "Preferences and privacy", icon: ShieldTick },
  ],
};

const WORKSPACE_ICONS: Record<CompanionWorkspaceId, IconComponent> = {
  personal: People,
  ngo: ShieldTick,
  treasury: Judge,
};

const EMPTY_ACTIONS_BY_WORKSPACE: Record<CompanionWorkspaceId, readonly EmptyAction[]> = {
  personal: [
    { kind: "link", href: "/verify", label: "Verify a claim", detail: "Compare two independent Gonka reviews", icon: SearchNormal1 },
    { kind: "link", href: "/qr-ferry", label: "Scan or show QR", detail: "Pay, collect, split, or issue a pass", icon: Code1 },
    { kind: "memory", label: "Pay someone new", detail: "Save their Sui address once", icon: Add },
    { kind: "prompt", prompt: "Split dinner with Maya, Idris, and Sam", label: "Split by WhatsApp", detail: "Create one request per person", icon: DocumentText },
    { kind: "contract", label: "View Sui lifecycle", detail: "Replay a real 1 USDC testnet payment", icon: ShieldTick },
  ],
  ngo: [
    { kind: "link", href: "/verify", label: "Review field evidence", detail: "Compare two independent Gonka reviews", icon: SearchNormal1 },
    { kind: "prompt", prompt: "Send Ana 25 USDC for flood supplies, release after delivery evidence", label: "Create aid release", detail: "Set evidence, expiry, and refund", icon: ShieldTick },
    { kind: "link", href: "/qr-ferry", label: "Collect donations", detail: "Show or share one QR request", icon: Code1 },
    { kind: "link", href: "/proof", label: "Show donor outcomes", detail: "Trace receipts and releases", icon: Activity },
    { kind: "contract", label: "View Sui lifecycle", detail: "Inspect a real protected release", icon: ShieldTick },
  ],
  treasury: [
    { kind: "link", href: "/qr-ferry", label: "Collect dues by QR", detail: "Create a request members can scan", icon: Code1 },
    { kind: "prompt", prompt: "Pay Dave 12 USDC for club supplies", label: "Reimburse a member", detail: "Prepare an exact payment", icon: MoneyRecive },
    { kind: "link", href: "/verify", label: "Review a claim", detail: "Compare two independent reviews", icon: SearchNormal1 },
    { kind: "link", href: "/strategy", label: "Protect reserves", detail: "Set hard limits before approval", icon: Judge },
    { kind: "contract", label: "View Sui lifecycle", detail: "Inspect a real protected release", icon: ShieldTick },
  ],
};

const WORKSPACE_BRIEFS: Record<CompanionWorkspaceId, WorkspaceBrief> = {
  personal: {
    eyebrow: "Personal companion",
    title: "Say what should happen.",
    body: "Pay, split, help during an emergency, or set a protected outcome in one conversation.",
    steps: ["Ask or speak", "Review exact terms", "Approve once"],
    sideEyebrow: "Try asking",
    sideTitle: "Start with one move.",
    trustTitle: "You stay in control.",
    trustBody: "Convey prepares. You review and approve.",
  },
  ngo: {
    eyebrow: "Aid operations",
    title: "From field evidence to donor proof.",
    body: "Review reports, gate releases, collect donations, and trace each outcome without losing the human context.",
    steps: ["Review evidence", "Approve release", "Share outcome"],
    sideEyebrow: "Aid desk",
    sideTitle: "Fund, verify, release.",
    trustTitle: "Every release stays reviewable.",
    trustBody: "Team context helps routing. Wallet authority stays explicit.",
  },
  treasury: {
    eyebrow: "Shared treasury",
    title: "Collect together. Approve together.",
    body: "Route dues, reimbursements, claims, and reserve policies through one accountable workspace.",
    steps: ["Collect funds", "Review request", "Record approval"],
    sideEyebrow: "Treasury desk",
    sideTitle: "Collect, review, approve.",
    trustTitle: "Shared money needs clear authority.",
    trustBody: "Workspace context never replaces required wallet approvals.",
  },
};

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
    return "I mapped a protected payment that releases after the agreed evidence is approved.";
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
  const [workspaceId, setWorkspaceId] = useState<CompanionWorkspaceId>(
    DEFAULT_COMPANION_WORKSPACE_ID,
  );
  const [organizations, setOrganizations] = useState<CompanionOrganization[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationKind, setOrganizationKind] = useState<CompanionOrganizationKind>("ngo");
  const [organizationError, setOrganizationError] = useState<string | null>(null);
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
  const workspaceStoreRef = useRef<CompanionWorkspaceStore | null>(null);
  const organizationStoreRef = useRef<CompanionOrganizationStore | null>(null);
  const rememberedPeople = useMemo(() => memory.contacts.slice(0, 4), [memory.contacts]);
  const activeOrganization = organizations.find((organization) => organization.id === activeOrganizationId) ?? null;
  const baseWorkspace = getCompanionWorkspace(workspaceId);
  const workspaceLabel = activeOrganization?.name ?? baseWorkspace.label;
  const workspaceRole = activeOrganization
    ? `Owner, ${organizationKindLabel(activeOrganization.kind)}`
    : baseWorkspace.role;
  const starterPrompts = STARTER_PROMPTS_BY_WORKSPACE[workspaceId];
  const destinations = DESTINATIONS_BY_WORKSPACE[workspaceId];
  const emptyActions = EMPTY_ACTIONS_BY_WORKSPACE[workspaceId];
  const workspaceBrief = WORKSPACE_BRIEFS[workspaceId];
  const WorkspaceIcon = WORKSPACE_ICONS[workspaceId];
  const memorySummary = rememberedPeople.length > 0
    ? activeMemoryMode === "sample"
      ? rememberedPeople.length === 1
        ? `Sample person: ${rememberedPeople[0]?.displayName}`
        : `Sample people: ${rememberedPeople.map((person) => person.displayName).join(", ")}`
      : `${rememberedPeople.length} remembered ${rememberedPeople.length === 1 ? "person" : "people"}`
    : "No people saved yet";

  useEffect(() => {
    const store = createCompanionMemoryStore(window.localStorage);
    const workspaceStore = createCompanionWorkspaceStore(window.localStorage);
    const organizationStore = createCompanionOrganizationStore(window.localStorage);
    memoryStoreRef.current = store;
    workspaceStoreRef.current = workspaceStore;
    organizationStoreRef.current = organizationStore;
    const persisted = store.read();
    const persistedWorkspaceId = workspaceStore.read();
    const persistedOrganizations = organizationStore.read();
    const persistedOrganization = persistedOrganizations.organizations.find(
      (organization) => organization.id === persistedOrganizations.activeOrganizationId,
    ) ?? null;
    const sharedRequest = new URLSearchParams(window.location.search).get("request");
    const hydrationTimer = window.setTimeout(() => {
      if (persisted.contacts.length > 0 || persisted.interactions.length > 0) {
        setMemory(persisted);
        setActiveMemoryMode("live");
      }
      setOrganizations(persistedOrganizations.organizations);
      setActiveOrganizationId(persistedOrganization?.id ?? null);
      const nextWorkspaceId = persistedOrganization
        ? workspaceIdForOrganization(persistedOrganization.kind)
        : persistedWorkspaceId;
      setWorkspaceId(nextWorkspaceId);
      setMessages([{ id: 1, role: "assistant", text: persistedOrganization
        ? `I’m ready. Describe what ${persistedOrganization.name} should collect, verify, protect, or release.`
        : getCompanionWorkspace(nextWorkspaceId).welcome }]);
      if (sharedRequest) setInput(sharedRequest.slice(0, 500));
    }, 0);
    return () => {
      window.clearTimeout(hydrationTimer);
      memoryStoreRef.current = null;
      workspaceStoreRef.current = null;
      organizationStoreRef.current = null;
    };
  }, []);

  function switchWorkspace(nextWorkspaceId: CompanionWorkspaceId) {
    if (nextWorkspaceId === workspaceId && activeOrganizationId === null) {
      setWorkspaceOpen(false);
      return;
    }

    workspaceStoreRef.current?.write(nextWorkspaceId);
    organizationStoreRef.current?.select(null);
    setActiveOrganizationId(null);
    setWorkspaceId(nextWorkspaceId);
    setWorkspaceOpen(false);
    setMemoryOpen(false);
    setAddingPerson(false);
    setContractDemoOpen(false);
    setInput("");
    const id = nextId.current;
    nextId.current += 1;
    setMessages([{ id, role: "assistant", text: getCompanionWorkspace(nextWorkspaceId).welcome }]);
  }

  function selectOrganization(organizationId: string) {
    const organization = organizations.find((item) => item.id === organizationId);
    if (!organization || !organizationStoreRef.current?.select(organizationId)) return;
    const nextWorkspaceId = workspaceIdForOrganization(organization.kind);
    workspaceStoreRef.current?.write(nextWorkspaceId);
    setActiveOrganizationId(organization.id);
    setWorkspaceId(nextWorkspaceId);
    setWorkspaceOpen(false);
    setCreatingOrganization(false);
    setMemoryOpen(false);
    setInput("");
    const id = nextId.current;
    nextId.current += 1;
    setMessages([{ id, role: "assistant", text: `I’m ready. Describe what ${organization.name} should collect, verify, protect, or release.` }]);
  }

  function createOrganization() {
    const result = organizationStoreRef.current?.create({
      name: organizationName,
      kind: organizationKind,
    });
    if (!result?.ok) {
      setOrganizationError(
        result?.reason === "duplicate"
          ? "An organization with that name already exists."
          : result?.reason === "limit"
            ? "This device already has eight organizations."
            : "Enter an organization name between 2 and 48 characters.",
      );
      return;
    }
    setOrganizations(result.state.organizations);
    setOrganizationName("");
    setOrganizationError(null);
    const organization = result.organization;
    const nextWorkspaceId = workspaceIdForOrganization(organization.kind);
    workspaceStoreRef.current?.write(nextWorkspaceId);
    setActiveOrganizationId(organization.id);
    setWorkspaceId(nextWorkspaceId);
    setWorkspaceOpen(false);
    setCreatingOrganization(false);
    setInput("");
    const id = nextId.current;
    nextId.current += 1;
    setMessages([{ id, role: "assistant", text: `I’m ready. Describe what ${organization.name} should collect, verify, protect, or release.` }]);
  }

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
          workspaceId,
          organization: activeOrganization
            ? {
                id: activeOrganization.id,
                name: activeOrganization.name,
                kind: activeOrganization.kind,
                memberRole: activeOrganization.memberRole,
              }
            : undefined,
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
                <span><b>Convey</b><small>{workspaceLabel}</small></span>
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
            <button
              type="button"
              aria-expanded={workspaceOpen}
              aria-controls="companion-workspace-panel"
              aria-label={`Switch workspace. Current: ${workspaceLabel}`}
              onClick={() => {
                setWorkspaceOpen((current) => !current);
                setMemoryOpen(false);
              }}
              className="companion-workspace-trigger"
            >
              <span className="companion-workspace-icon"><WorkspaceIcon size={17} /></span>
              <span className="min-w-0 text-left">
                <strong>{workspaceLabel}</strong>
                <small>{workspaceRole}. {memorySummary}</small>
              </span>
              <ArrowDown2 size={15} />
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setWorkspaceOpen(false); setMemoryOpen(true); setAddingPerson(true); }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-black/10 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
                aria-label={workspaceId === "personal" ? "Add a person" : "Add a member or payee"}
              >
                <Add size={18} />
              </button>
            {rememberedPeople.length > 0 && (
              <button
                type="button"
                aria-expanded={memoryOpen}
                aria-controls="companion-memory-panel"
                onClick={() => { setWorkspaceOpen(false); setMemoryOpen((current) => !current); }}
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

          {workspaceOpen && (
              <section
                id="companion-workspace-panel"
                aria-label="Choose workspace"
                className="companion-workspace-panel"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setWorkspaceOpen(false);
                }}
              >
                <div className="companion-workspace-panel-head">
                  <strong>Choose where you are working</strong>
                  <span>Personal requests stay personal. Organizations keep their own context.</span>
                </div>
                <div className="companion-workspace-options">
                  {COMPANION_WORKSPACES.map((option) => {
                    const OptionIcon = WORKSPACE_ICONS[option.id];
                    const selected = option.id === workspaceId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => switchWorkspace(option.id)}
                        className="companion-workspace-option"
                      >
                        <span className="companion-workspace-option-icon"><OptionIcon size={17} /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        {selected && <TickCircle size={17} />}
                      </button>
                    );
                  })}
                </div>
                {organizations.length > 0 && (
                  <div className="companion-organization-list" aria-label="Your organizations">
                    <p>Your organizations</p>
                    <div>
                      {organizations.map((organization) => (
                        <button
                          key={organization.id}
                          type="button"
                          aria-pressed={organization.id === activeOrganizationId}
                          onClick={() => selectOrganization(organization.id)}
                          className="companion-organization-option"
                        >
                          <span className="companion-workspace-option-icon"><People size={17} /></span>
                          <span className="min-w-0 flex-1 text-left">
                            <strong>{organization.name}</strong>
                            <small>Owner, {organizationKindLabel(organization.kind)}</small>
                          </span>
                          {organization.id === activeOrganizationId && <TickCircle size={17} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {creatingOrganization ? (
                  <div className="companion-organization-form">
                    <label>
                      Organization name
                      <input
                        value={organizationName}
                        onChange={(event) => {
                          setOrganizationName(event.target.value);
                          setOrganizationError(null);
                        }}
                        maxLength={48}
                        autoFocus
                      />
                    </label>
                    <label>
                      Organization type
                      <select
                        value={organizationKind}
                        onChange={(event) => setOrganizationKind(event.target.value as CompanionOrganizationKind)}
                      >
                        <option value="ngo">NGO</option>
                        <option value="club">Student club</option>
                        <option value="business">Business</option>
                        <option value="community">Community group</option>
                      </select>
                    </label>
                    <div className="companion-organization-form-actions">
                      <button type="button" className="cv-btn-ghost" onClick={() => { setCreatingOrganization(false); setOrganizationError(null); }}>
                        Cancel
                      </button>
                      <button type="button" className="cv-btn-solid" onClick={createOrganization}>
                        Create workspace
                      </button>
                    </div>
                    {organizationError && <p role="alert">{organizationError}</p>}
                    <small>Saved on this device. Team membership and wallet approvals remain separate.</small>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="companion-create-organization"
                    onClick={() => setCreatingOrganization(true)}
                  >
                    <Add size={17} />
                    <span><strong>Create organization</strong><small>Set up an NGO, club, business, or community workspace</small></span>
                    <ArrowRight size={16} />
                  </button>
                )}
              </section>
          )}

          {memoryOpen && (
            <section id="companion-memory-panel" className="companion-memory-panel" aria-label={workspaceId === "personal" ? "Remembered people" : `People in ${workspaceLabel}`}>
              <div>
                <p className="companion-eyebrow text-black/45">
                  {workspaceId === "personal"
                    ? activeMemoryMode === "sample" ? "Sample context" : "Remembered on this device"
                    : `People for ${workspaceLabel}`}
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
                        {person.relationshipLabel ?? "Contact"}: {person.confirmation === "confirmed" ? "address confirmed" : "address not confirmed"}
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
              <div className="companion-empty-state">
                {workspaceId !== "personal" && (
                  <section className="companion-workspace-brief" aria-label={`${workspaceLabel} workspace overview`}>
                    <div>
                      <p className="companion-eyebrow">{workspaceBrief.eyebrow}</p>
                      <h2>{workspaceBrief.title}</h2>
                      <p>{workspaceBrief.body}</p>
                    </div>
                    <ol>
                      {workspaceBrief.steps.map((step, index) => (
                        <li key={step}><span>0{index + 1}</span>{step}</li>
                      ))}
                    </ol>
                  </section>
                )}
                <div className="companion-empty-actions">
                  {emptyActions.map((action, index) => {
                  const Icon = action.icon;
                  const className = [
                    "companion-empty-action",
                    index === 0 ? "companion-empty-action--primary" : "",
                    action.kind === "contract" ? "companion-empty-action--contract" : "",
                  ].filter(Boolean).join(" ");
                  const content = (
                    <>
                      <Icon size={index === 0 ? 22 : 20} />
                      <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                      <ArrowRight size={17} />
                    </>
                  );

                  if (action.kind === "link" && action.href) {
                    return <Link key={action.label} href={action.href} className={className}>{content}</Link>;
                  }

                  return (
                    <button
                      key={action.label}
                      type="button"
                      className={className}
                      onClick={() => {
                        if (action.kind === "prompt" && action.prompt) setInput(action.prompt);
                        if (action.kind === "memory") {
                          setWorkspaceOpen(false);
                          setMemoryOpen(true);
                          setAddingPerson(true);
                        }
                        if (action.kind === "contract") setContractDemoOpen(true);
                      }}
                    >
                      {content}
                    </button>
                  );
                  })}
                </div>
              </div>
            )}
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="companion-thinking" role="status">
                <span /><span /><span /><span className="sr-only">Companion is thinking</span>
              </motion.div>
            )}
          </div>

          <div className="companion-quick-row" aria-label="Suggested requests">
            {starterPrompts.map(({ label, prompt }) => (
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
                  ? `Listening: ${voice.interimTranscript}`
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
                <p className="companion-eyebrow text-black/42">{workspaceBrief.sideEyebrow}</p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-black">{workspaceBrief.sideTitle}</h2>
              </div>
              <span className="companion-spark"><Flash size={18} /></span>
            </div>
            <div className="mt-5 grid gap-2.5">
              {starterPrompts.map(({ label, prompt, detail, icon: Icon }) => (
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
            <p className="companion-eyebrow text-black/42">{workspaceId === "personal" ? "Continue" : `${workspaceLabel} tools`}</p>
            <div className="mt-3 divide-y divide-black/8">
              {destinations.map(({ href, label, detail, icon: Icon }) => (
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
              <p className="text-sm font-medium text-white">{workspaceBrief.trustTitle}</p>
              <p className="mt-1 text-[11px] leading-5 text-white/52">{workspaceBrief.trustBody}</p>
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
