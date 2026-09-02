import { z } from "zod";
import {
  equalSplit,
  normalizeSplitName,
  sumAllocationsMicro,
} from "@/lib/remittance/receipt-split";

const MINOR_UNITS = /^(?:0|[1-9]\d*)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/;
const COMPONENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const MinorUnitSchema = z.string().regex(MINOR_UNITS).max(30);
const ReceiptParticipantSchema = z.strictObject({
  id: z.string().regex(COMPONENT_ID),
  displayName: z.string().trim().min(1).max(40),
});
const ReceiptItemAssignmentSchema = z.strictObject({
  itemId: z.string().regex(COMPONENT_ID),
  participantIds: z.array(z.string().regex(COMPONENT_ID)).min(1).max(8),
});

export const ReceiptExtractionCandidateSchema = z.strictObject({
  version: z.literal("convey.receipt-candidate.v1"),
  sourceId: z.string().regex(COMPONENT_ID),
  merchantLabel: z.string().trim().min(1).max(96),
  currency: z.enum(["SUI", "USDC"]),
  items: z.array(z.strictObject({
    id: z.string().regex(COMPONENT_ID),
    label: z.string().trim().min(1).max(96),
    amountMicro: MinorUnitSchema,
  })).min(1).max(32),
  subtotalMicro: MinorUnitSchema,
  taxMicro: MinorUnitSchema,
  serviceMicro: MinorUnitSchema,
  totalMicro: MinorUnitSchema,
  confidence: z.number().min(0).max(1),
  requiresUserConfirmation: z.literal(true),
});

export const ReceiptObligationStateSchema = z.enum([
  "draft",
  "confirmed",
  "requested",
  "submitted",
  "settled",
  "disputed",
  "cancelled",
  "expired",
]);

export const ReceiptObligationSchema = z.strictObject({
  id: z.string().regex(ID),
  participantId: z.string().regex(ID),
  participantLabel: z.string().trim().min(1).max(40),
  currency: z.enum(["SUI", "USDC"]),
  itemSubtotalMicro: MinorUnitSchema,
  taxMicro: MinorUnitSchema,
  serviceMicro: MinorUnitSchema,
  amountMicro: MinorUnitSchema,
  state: ReceiptObligationStateSchema,
  transactionDigest: z.string().trim().min(1).max(128).nullable(),
}).superRefine((obligation, context) => {
  if (
    (obligation.state === "submitted" || obligation.state === "settled")
    && obligation.transactionDigest === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["transactionDigest"],
      message: "Submitted and settled obligations require transaction evidence.",
    });
  }
});

export const ReceiptObligationEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("confirm") }),
  z.strictObject({ type: z.literal("request") }),
  z.strictObject({
    type: z.literal("submit"),
    transactionDigest: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    type: z.literal("verify_settlement"),
    independentlyVerified: z.boolean(),
  }),
  z.strictObject({ type: z.literal("chat_acknowledged") }),
  z.strictObject({ type: z.literal("dispute") }),
  z.strictObject({ type: z.literal("cancel") }),
  z.strictObject({ type: z.literal("expire") }),
]);

export type ReceiptExtractionCandidate = z.infer<typeof ReceiptExtractionCandidateSchema>;
export type ReceiptParticipant = z.infer<typeof ReceiptParticipantSchema>;
export type ReceiptObligation = z.infer<typeof ReceiptObligationSchema>;
export type ReceiptObligationState = z.infer<typeof ReceiptObligationStateSchema>;

export type ReceiptParticipantResolution =
  | { outcome: "resolved"; participantId: string }
  | { outcome: "ambiguous"; participantIds: string[] }
  | { outcome: "missing" };

export interface ReceiptItemAssignment {
  itemId: string;
  participantIds: string[];
}

export interface CreateReceiptObligationDraftInput {
  candidate: unknown;
  participants: ReceiptParticipant[];
  assignments: ReceiptItemAssignment[];
  userConfirmedCandidate: boolean;
}

export interface ReceiptObligationDraft {
  sourceId: string;
  merchantLabel: string;
  totalMicro: string;
  totalAllocatedMicro: string;
  obligations: ReceiptObligation[];
}

export type ReceiptObligationEvent = z.infer<typeof ReceiptObligationEventSchema>;

export function resolveReceiptParticipant(
  reference: string,
  participants: ReadonlyArray<ReceiptParticipant>,
): ReceiptParticipantResolution {
  const normalized = normalizeSplitName(reference).toLocaleLowerCase("en-US");
  const matches = participants.filter(
    (participant) => normalizeSplitName(participant.displayName).toLocaleLowerCase("en-US") === normalized,
  );
  if (matches.length === 0) return { outcome: "missing" };
  if (matches.length > 1) {
    return { outcome: "ambiguous", participantIds: matches.map((participant) => participant.id) };
  }
  return { outcome: "resolved", participantId: matches[0]!.id };
}

function allocateExactly(totalMicro: string, count: number): string[] {
  if (totalMicro === "0") return Array.from({ length: count }, () => "0");
  if (count === 1) return [totalMicro];
  return equalSplit(totalMicro, count);
}

function assertReceiptArithmetic(candidate: ReceiptExtractionCandidate): void {
  const itemTotal = sumAllocationsMicro(candidate.items.map((item) => item.amountMicro));
  const calculatedTotal = (
    BigInt(candidate.subtotalMicro) + BigInt(candidate.taxMicro) + BigInt(candidate.serviceMicro)
  ).toString();
  if (itemTotal !== candidate.subtotalMicro || calculatedTotal !== candidate.totalMicro) {
    throw new RangeError("Receipt totals do not reconcile.");
  }
  if (BigInt(candidate.subtotalMicro) <= 0n || BigInt(candidate.totalMicro) <= 0n) {
    throw new RangeError("Receipt total must be greater than zero.");
  }
}

export function createReceiptObligationDraft(
  input: CreateReceiptObligationDraftInput,
): ReceiptObligationDraft {
  const candidate = ReceiptExtractionCandidateSchema.parse(input.candidate);
  const participants = z.array(ReceiptParticipantSchema).min(1).max(8).parse(input.participants);
  const assignments = z.array(ReceiptItemAssignmentSchema).min(1).max(32).parse(input.assignments);
  if (!input.userConfirmedCandidate) {
    throw new Error("Receipt candidate must be confirmed by the user.");
  }
  assertReceiptArithmetic(candidate);

  const participantsById = new Map<string, ReceiptParticipant>();
  for (const participant of participants) {
    if (participantsById.has(participant.id)) throw new Error("Participant ids must be unique.");
    participantsById.set(participant.id, participant);
  }

  const assignmentsByItem = new Map<string, ReceiptItemAssignment>();
  for (const assignment of assignments) {
    if (assignmentsByItem.has(assignment.itemId)) throw new Error("Each receipt item needs one assignment.");
    const uniqueIds = new Set(assignment.participantIds);
    if (uniqueIds.size !== assignment.participantIds.length) throw new Error("Item participant ids must be unique.");
    for (const participantId of assignment.participantIds) {
      if (!participantsById.has(participantId)) throw new Error("Receipt assignment references an unknown participant.");
    }
    assignmentsByItem.set(assignment.itemId, assignment);
  }

  const itemTotals = new Map(participants.map((participant) => [participant.id, 0n]));
  for (const item of candidate.items) {
    if (BigInt(item.amountMicro) <= 0n) throw new RangeError("Receipt item amount must be greater than zero.");
    const assignment = assignmentsByItem.get(item.id);
    if (!assignment) throw new Error("Every receipt item must be assigned.");
    const parts = allocateExactly(item.amountMicro, assignment.participantIds.length);
    assignment.participantIds.forEach((participantId, index) => {
      itemTotals.set(participantId, itemTotals.get(participantId)! + BigInt(parts[index]!));
    });
  }
  if (assignmentsByItem.size !== candidate.items.length) {
    throw new Error("Receipt assignment references an unknown item.");
  }

  const taxParts = allocateExactly(candidate.taxMicro, participants.length);
  const serviceParts = allocateExactly(candidate.serviceMicro, participants.length);
  const obligations = participants.map((participant, index): ReceiptObligation => {
    const itemSubtotalMicro = itemTotals.get(participant.id)!.toString();
    const amountMicro = (
      BigInt(itemSubtotalMicro) + BigInt(taxParts[index]!) + BigInt(serviceParts[index]!)
    ).toString();
    return {
      id: `${candidate.sourceId}:${participant.id}`,
      participantId: participant.id,
      participantLabel: normalizeSplitName(participant.displayName),
      currency: candidate.currency,
      itemSubtotalMicro,
      taxMicro: taxParts[index]!,
      serviceMicro: serviceParts[index]!,
      amountMicro,
      state: "draft",
      transactionDigest: null,
    };
  });
  const totalAllocatedMicro = sumAllocationsMicro(obligations.map((entry) => entry.amountMicro));
  if (totalAllocatedMicro !== candidate.totalMicro) throw new Error("Receipt allocation does not reconcile.");

  return {
    sourceId: candidate.sourceId,
    merchantLabel: candidate.merchantLabel,
    totalMicro: candidate.totalMicro,
    totalAllocatedMicro,
    obligations,
  };
}

function invalidTransition(state: ReceiptObligationState, event: ReceiptObligationEvent["type"]): never {
  throw new Error(`Invalid obligation transition: ${state} -> ${event}.`);
}

export function applyObligationEvent(
  obligationInput: ReceiptObligation,
  eventInput: ReceiptObligationEvent,
): ReceiptObligation {
  const obligation = ReceiptObligationSchema.parse(obligationInput);
  const event = ReceiptObligationEventSchema.parse(eventInput);
  if (event.type === "chat_acknowledged") return obligation;
  if (event.type === "confirm") {
    if (obligation.state !== "draft") return invalidTransition(obligation.state, event.type);
    return { ...obligation, state: "confirmed" };
  }
  if (event.type === "request") {
    if (obligation.state !== "confirmed") return invalidTransition(obligation.state, event.type);
    return { ...obligation, state: "requested" };
  }
  if (event.type === "submit") {
    if (obligation.state !== "requested") return invalidTransition(obligation.state, event.type);
    return { ...obligation, state: "submitted", transactionDigest: event.transactionDigest };
  }
  if (event.type === "verify_settlement") {
    if (obligation.state !== "submitted") return invalidTransition(obligation.state, event.type);
    if (!event.independentlyVerified) throw new Error("Settlement must be independently verified.");
    return { ...obligation, state: "settled" };
  }
  if (event.type === "dispute") {
    if (["cancelled", "expired"].includes(obligation.state)) return invalidTransition(obligation.state, event.type);
    return { ...obligation, state: "disputed" };
  }
  if (event.type === "cancel") {
    if (!["draft", "confirmed", "requested"].includes(obligation.state)) {
      return invalidTransition(obligation.state, event.type);
    }
    return { ...obligation, state: "cancelled" };
  }
  if (event.type === "expire") {
    if (!["draft", "confirmed", "requested"].includes(obligation.state)) {
      return invalidTransition(obligation.state, event.type);
    }
    return { ...obligation, state: "expired" };
  }
  throw new Error("Unsupported obligation event.");
}
