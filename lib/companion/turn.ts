import { CompanionMemorySchema, normalizeContactKey } from "./memory";
import type {
  CompanionClarification,
  CompanionCandidate,
  CompanionInput,
  CompanionResolution,
  CompanionProposal,
} from "./contracts";
import { CompanionCandidateSchema, CompanionResolutionSchema } from "./contracts";
import { resolveContact } from "./contact-resolution";
import type { CompanionAsset } from "./memory";

const MONEY_RE = /(?:\b(?:send|pay|give)\b|\bsplit\b|\bcollect\b)/i;
const AMOUNT_RE = /\b(\d{1,9}(?:\.\d{1,6})?)\b/;
const ASSET_RE = /\b(USDC|SUI)\b/i;

function cleanTitle(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function findContactId(memory: CompanionInput["memory"], raw: string): string | null {
  const key = normalizeContactKey(raw);
  const exact = memory.contacts.find((contact) => normalizeContactKey(contact.displayName) === key);
  if (exact) return exact.id;
  const alias = memory.contacts.find((contact) =>
    contact.aliases.some((name) => normalizeContactKey(name) === key),
  );
  return alias?.id ?? null;
}

function deriveClarification(reason: string, question: string, missingFields: CompanionClarification["missingFields"]): CompanionClarification {
  return {
    toolId: "clarify",
    reason,
    question,
    missingFields,
  };
}

function buildProposal(candidate: CompanionCandidate, contactLabel: string): CompanionProposal {
  return {
    toolId: "payments.propose",
    contactId: candidate.contactId ?? "",
    contactLabel,
    amountMajor: candidate.amountMajor ?? "",
    asset: candidate.asset ?? "SUI",
    purpose: candidate.purpose,
    requiresUserApproval: true,
  };
}

function protectedMissionPurpose(message: string): string | null {
  const hasCondition = /\b(?:after|until|when|evidence|accepted|approved|pickup|checkout|refund|milestone|deliver(?:y|ed))\b/i.test(message);
  if (!hasCondition) return null;
  if (/\b(?:relief|flood|disaster|emergency aid)\b/i.test(message)) return "relief support";
  if (/\b(?:medicine|pharmacy|prescription|pickup)\b/i.test(message)) return "medicine pickup";
  if (/\b(?:rent|rental|deposit|checkout|landlord|damage)\b/i.test(message)) return "rental deposit";
  if (/\b(?:grant|grantee|funding tranche)\b/i.test(message)) return "grant milestone";
  if (/\b(?:freelance|freelancer|client|employer|deliverable|design|work order)\b/i.test(message)) return "freelance delivery";
  return null;
}

export function parseCompanionTurn(input: CompanionInput): CompanionResolution {
  const message = input.message.trim();
  const missionPurpose = protectedMissionPurpose(message);
  const deterministicRouting = {
    provider: "deterministic" as const,
    mode: "fallback" as const,
    requestId: null,
    responseModel: null,
    fallbackReason: "deterministic_only" as const,
  };
  if (/receipt|split (?:this|the) (?:bill|receipt)|who owes/i.test(message)) {
    return {
      toolId: "splits.propose",
      outcome: "unavailable",
      routing: deterministicRouting,
      candidate: {
        toolId: "splits.propose",
        contactId: null,
        contactRef: null,
        amountMajor: null,
        asset: null,
        purpose: "receipt split",
        missingFields: [],
        confidence: 0.96,
        explanation: "A receipt is needed before the split can be prepared.",
      },
      proposal: null,
      clarification: null,
    };
  }
  if (
    missionPurpose !== null ||
    /(?:release|unlock|hold).*(?:evidence|pickup|delivery|approval|refund)/i.test(message)
  ) {
    return {
      toolId: "missions.propose",
      outcome: "unavailable",
      routing: deterministicRouting,
      candidate: {
        toolId: "missions.propose",
        contactId: null,
        contactRef: null,
        amountMajor: message.match(AMOUNT_RE)?.[1] ?? null,
        asset: (message.match(ASSET_RE)?.[1]?.toUpperCase() as CompanionAsset | undefined) ?? null,
        purpose: missionPurpose ?? "evidence-protected support",
        missingFields: [],
        confidence: 0.93,
        explanation: "A protected support transfer can be prepared with an evidence condition and refund deadline.",
      },
      proposal: null,
      clarification: null,
    };
  }
  if (/protect|hedge|downside|overnight strategy/i.test(message)) {
    return {
      toolId: "strategies.propose",
      outcome: "unavailable",
      routing: deterministicRouting,
      candidate: {
        toolId: "strategies.propose",
        contactId: null,
        contactRef: null,
        amountMajor: message.match(AMOUNT_RE)?.[1] ?? null,
        asset: (message.match(ASSET_RE)?.[1]?.toUpperCase() as CompanionAsset | undefined) ?? null,
        purpose: "downside protection",
        missingFields: [],
        confidence: 0.91,
        explanation: "A bounded protection plan can be prepared for review.",
      },
      proposal: null,
      clarification: null,
    };
  }
  const contactMention = input.memory.contacts.length
    ? input.memory.contacts.find((contact) => {
        const key = normalizeContactKey(contact.displayName);
        return key.length > 0 && normalizeContactKey(message).includes(key);
      })
    : null;
  const amountMatch = message.match(AMOUNT_RE);
  const assetMatch = message.match(ASSET_RE);
  const purpose =
    cleanTitle(message.replace(MONEY_RE, "").replace(AMOUNT_RE, "").replace(ASSET_RE, "")) ??
    null;

  if (!MONEY_RE.test(message) && !/receipt|owe|who owes|remind/i.test(message)) {
    return {
      toolId: "clarify",
      outcome: "clarification",
      routing: {
        provider: "deterministic",
        mode: "fallback",
        requestId: null,
        responseModel: null,
        fallbackReason: "deterministic_only",
      },
      candidate: null,
      proposal: null,
      clarification: deriveClarification(
        "Need a payment, split, or strategy request before I can route it.",
        "Who should I pay, how much, and in which asset?",
        ["contact", "amount", "asset"],
      ),
    };
  }

  const contactName = contactMention?.displayName ?? null;
  const contactId = contactMention?.id ?? null;
  const amountMajor = amountMatch?.[1] ?? null;
  const asset = (assetMatch?.[1]?.toUpperCase() as CompanionAsset | undefined) ?? null;
  const missingFields: CompanionCandidate["missingFields"] = [];
  if (!contactId) missingFields.push("contact");
  if (!amountMajor) missingFields.push("amount");
  if (!asset) missingFields.push("asset");
  if (!purpose) missingFields.push("purpose");

  const candidate: CompanionCandidate = {
    toolId: contactId ? "payments.propose" : "contacts.resolve",
    contactId,
    contactRef: contactName,
    amountMajor,
    asset,
    purpose,
    missingFields,
    confidence: contactId && amountMajor && asset ? 0.94 : 0.42,
    explanation: contactId
      ? "Resolved a likely payment proposal from the chat message."
      : "Need contact memory before I can safely propose a transfer.",
  };

  if (!contactId || !amountMajor || !asset) {
    return {
      toolId: candidate.toolId,
      outcome: "clarification",
      routing: {
        provider: "deterministic",
        mode: "fallback",
        requestId: null,
        responseModel: null,
        fallbackReason: "deterministic_only",
      },
      candidate,
      proposal: null,
      clarification: deriveClarification(
        "I need a remembered contact plus amount and asset before proposing a payment.",
        "Say it like: send Dave 25 USDC for dinner.",
        missingFields,
      ),
    };
  }

  const normalized = CompanionMemorySchema.parse(input.memory);
  const matchedContactId = findContactId(normalized, contactName ?? "");
  const selectedContact = normalized.contacts.find((contact) => contact.id === matchedContactId);
  if (!selectedContact || selectedContact.confirmation !== "confirmed") {
    return {
      toolId: "contacts.resolve",
      outcome: "clarification",
      routing: {
        provider: "deterministic",
        mode: "fallback",
        requestId: null,
        responseModel: null,
        fallbackReason: "deterministic_only",
      },
      candidate: {
        ...candidate,
        contactId: matchedContactId,
        contactRef: selectedContact?.displayName ?? contactName,
      },
      proposal: null,
      clarification: deriveClarification(
        "I found a contact match, but I still need a confirmed recipient before proposing the transfer.",
        "Confirm Dave once in memory, then ask me again.",
        ["approval"],
      ),
    };
  }

  return {
    toolId: "payments.propose",
    outcome: "proposal",
    routing: {
      provider: "deterministic",
      mode: "fallback",
      requestId: null,
      responseModel: null,
      fallbackReason: "deterministic_only",
    },
    candidate: {
      ...candidate,
      contactId: selectedContact.id,
      contactRef: selectedContact.displayName,
      explanation: "Ready to propose a user-approved payment.",
    },
    proposal: buildProposal(candidate, selectedContact.displayName),
    clarification: null,
  };
}

export interface CompanionLiveRouting {
  requestId: string;
  responseModel: string;
}

export function resolveCompanionCandidate(
  input: CompanionInput,
  rawCandidate: CompanionCandidate,
  routing: CompanionLiveRouting,
): CompanionResolution {
  const memory = CompanionMemorySchema.parse(input.memory);
  const candidate = CompanionCandidateSchema.parse(rawCandidate);
  const liveRouting = {
    provider: "gonkarouter" as const,
    mode: "live" as const,
    requestId: routing.requestId,
    responseModel: routing.responseModel,
    fallbackReason: null,
  };

  if (candidate.toolId !== "payments.propose") {
    return CompanionResolutionSchema.parse({
      toolId: candidate.toolId,
      outcome: candidate.toolId === "clarify" || candidate.toolId === "contacts.resolve"
        ? "clarification"
        : "unavailable",
      routing: liveRouting,
      candidate,
      proposal: null,
      clarification: deriveClarification(
        candidate.explanation,
        candidate.toolId === "strategies.propose"
          ? "I can map the strategy, but scheduled execution is not available yet."
          : "What should I prepare next?",
        candidate.missingFields,
      ),
    });
  }

  if (
    candidate.contactId === null ||
    candidate.contactRef === null ||
    candidate.amountMajor === null ||
    candidate.asset === null
  ) {
    return CompanionResolutionSchema.parse({
      toolId: "clarify",
      outcome: "clarification",
      routing: liveRouting,
      candidate,
      proposal: null,
      clarification: deriveClarification(
        "I need a confirmed person, amount, and asset before preparing a payment.",
        "Who should I pay, how much, and in SUI or USDC?",
        candidate.missingFields,
      ),
    });
  }

  const resolved = resolveContact(candidate.contactRef, memory);
  if (resolved.kind !== "confirmed" || resolved.contact.id !== candidate.contactId) {
    const ambiguous = resolved.kind === "ambiguous";
    return CompanionResolutionSchema.parse({
      toolId: "contacts.resolve",
      outcome: "clarification",
      routing: liveRouting,
      candidate,
      proposal: null,
      clarification: deriveClarification(
        ambiguous
          ? `I found ${resolved.contacts.length} matching contacts and will not guess.`
          : "The selected person does not match a currently confirmed contact.",
        ambiguous ? "Which person do you mean?" : "Confirm the recipient before I prepare this.",
        ["contact", "approval"],
      ),
    });
  }

  return CompanionResolutionSchema.parse({
    toolId: "payments.propose",
    outcome: "proposal",
    routing: liveRouting,
    candidate,
    proposal: {
      toolId: "payments.propose",
      contactId: resolved.contact.id,
      contactLabel: resolved.contact.displayName,
      amountMajor: candidate.amountMajor,
      asset: candidate.asset,
      purpose: candidate.purpose,
      requiresUserApproval: true,
    },
    clarification: null,
  });
}
