import { z } from "zod";
import { blake2b256, toHex } from "../protocol/hash";
import { assertProtectedTransferRolesDistinct } from "./protected-transfer";
import { ProtectedTransferTerminalSourceSchema } from "./protected-transfer-terminal";

export const PROTECTED_TRANSFER_DEMO_TRUTH_NOTICE =
  "Simulation only. No Sui transaction was signed, submitted, or settled." as const;

const RequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const DemoTermsSchema = ProtectedTransferTerminalSourceSchema.pick({
  payerAddress: true,
  beneficiaryAddress: true,
  reviewerAddress: true,
  coinType: true,
  amountMicro: true,
  deadlineMs: true,
  evidenceCommitmentHex: true,
});

export const CreateProtectedTransferDemoInputSchema = DemoTermsSchema.extend({
  mode: z.literal("demo"),
  createdAtMs: z.number().int().safe().nonnegative(),
  requestId: RequestIdSchema,
}).refine((input) => input.deadlineMs > input.createdAtMs, {
  message: "Demo deadline must be after creation.",
  path: ["deadlineMs"],
});

const DemoActorCommandSchema = z.strictObject({
  mode: z.literal("demo"),
  actorAddress: DemoTermsSchema.shape.payerAddress,
  nowMs: z.number().int().safe().nonnegative(),
  requestId: RequestIdSchema,
});

export const ReviewProtectedTransferDemoEvidenceInputSchema =
  DemoActorCommandSchema.extend({
    decision: z.enum(["approve", "reject"]),
    evidenceCommitmentHex: DemoTermsSchema.shape.evidenceCommitmentHex,
  });

export const ReleaseProtectedTransferDemoInputSchema = DemoActorCommandSchema;
export const RefundProtectedTransferDemoInputSchema = DemoActorCommandSchema;

export const ExpireProtectedTransferDemoInputSchema = z.strictObject({
  mode: z.literal("demo"),
  nowMs: z.number().int().safe().nonnegative(),
  requestId: RequestIdSchema,
});

export type ProtectedTransferDemoStatus =
  | "created"
  | "evidence_approved"
  | "evidence_rejected"
  | "expired"
  | "released"
  | "refunded";

export type ProtectedTransferDemoEventKind =
  | "demo_transfer_created"
  | "demo_evidence_approved"
  | "demo_evidence_rejected"
  | "demo_transfer_expired"
  | "demo_transfer_released"
  | "demo_transfer_refunded";

export interface ProtectedTransferDemoEvent {
  readonly eventId: string;
  readonly requestId: string;
  readonly kind: ProtectedTransferDemoEventKind;
  readonly occurredAtMs: number;
  readonly actorAddress?: string;
  readonly destinationAddress?: string;
  readonly amountMicro?: string;
  readonly evidenceCommitmentHex?: string;
}

export interface ProtectedTransferDemoState {
  readonly mode: "demo";
  readonly settlement: "not_submitted";
  readonly truthNotice: typeof PROTECTED_TRANSFER_DEMO_TRUTH_NOTICE;
  readonly demoId: string;
  readonly status: ProtectedTransferDemoStatus;
  readonly payerAddress: string;
  readonly beneficiaryAddress: string;
  readonly reviewerAddress: string;
  readonly coinType: string;
  readonly amountMicro: string;
  readonly deadlineMs: number;
  readonly evidenceCommitmentHex: string;
  readonly createdAtMs: number;
  readonly events: readonly ProtectedTransferDemoEvent[];
}

export type ProtectedTransferDemoErrorCode =
  | "demo_replay"
  | "demo_terminal_state"
  | "demo_invalid_transition"
  | "demo_unauthorized_review"
  | "demo_evidence_mismatch"
  | "demo_unauthorized_release"
  | "demo_release_expired"
  | "demo_expiry_too_early"
  | "demo_unauthorized_refund"
  | "demo_refund_too_early";

export class ProtectedTransferDemoError extends Error {
  readonly code: ProtectedTransferDemoErrorCode;

  constructor(code: ProtectedTransferDemoErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ProtectedTransferDemoError";
    this.code = code;
  }
}

function deterministicSuffix(value: unknown): string {
  return toHex(
    blake2b256(new TextEncoder().encode(JSON.stringify(value))),
  ).slice(2, 26);
}

function eventFor(
  stateOrDemoId: ProtectedTransferDemoState | string,
  input: Omit<ProtectedTransferDemoEvent, "eventId">,
): ProtectedTransferDemoEvent {
  const demoId = typeof stateOrDemoId === "string" ? stateOrDemoId : stateOrDemoId.demoId;
  const eventIndex = typeof stateOrDemoId === "string" ? 0 : stateOrDemoId.events.length;
  return Object.freeze({
    ...input,
    eventId: `demo_evt_${deterministicSuffix({ demoId, eventIndex, ...input })}`,
  });
}

function nextState(
  state: ProtectedTransferDemoState,
  status: ProtectedTransferDemoStatus,
  event: ProtectedTransferDemoEvent,
): ProtectedTransferDemoState {
  return Object.freeze({
    ...state,
    status,
    events: Object.freeze([...state.events, event]),
  });
}

function assertNotReplay(state: ProtectedTransferDemoState, requestId: string): void {
  if (state.events.some((event) => event.requestId === requestId)) {
    throw new ProtectedTransferDemoError(
      "demo_replay",
      "Request ID has already changed this demo lifecycle.",
    );
  }
}

function assertNotClosed(state: ProtectedTransferDemoState): void {
  if (["expired", "released", "refunded"].includes(state.status)) {
    throw new ProtectedTransferDemoError(
      "demo_terminal_state",
      `Action is unavailable after ${state.status}.`,
    );
  }
}

export function createProtectedTransferDemo(
  input: z.input<typeof CreateProtectedTransferDemoInputSchema>,
): ProtectedTransferDemoState {
  const parsed = CreateProtectedTransferDemoInputSchema.parse(input);
  assertProtectedTransferRolesDistinct({
    payer: parsed.payerAddress,
    beneficiary: parsed.beneficiaryAddress,
    reviewer: parsed.reviewerAddress,
  });

  const canonicalIdentity = {
    mode: parsed.mode,
    payerAddress: parsed.payerAddress,
    beneficiaryAddress: parsed.beneficiaryAddress,
    reviewerAddress: parsed.reviewerAddress,
    coinType: parsed.coinType,
    amountMicro: parsed.amountMicro,
    deadlineMs: parsed.deadlineMs,
    evidenceCommitmentHex: parsed.evidenceCommitmentHex,
    createdAtMs: parsed.createdAtMs,
    requestId: parsed.requestId,
  };
  const demoId = `demo_pt_${deterministicSuffix(canonicalIdentity)}`;
  const created = eventFor(demoId, {
    requestId: parsed.requestId,
    kind: "demo_transfer_created",
    occurredAtMs: parsed.createdAtMs,
    actorAddress: parsed.payerAddress,
    amountMicro: parsed.amountMicro,
    evidenceCommitmentHex: parsed.evidenceCommitmentHex,
  });

  return Object.freeze({
    mode: "demo",
    settlement: "not_submitted",
    truthNotice: PROTECTED_TRANSFER_DEMO_TRUTH_NOTICE,
    demoId,
    status: "created",
    payerAddress: parsed.payerAddress,
    beneficiaryAddress: parsed.beneficiaryAddress,
    reviewerAddress: parsed.reviewerAddress,
    coinType: parsed.coinType,
    amountMicro: parsed.amountMicro,
    deadlineMs: parsed.deadlineMs,
    evidenceCommitmentHex: parsed.evidenceCommitmentHex,
    createdAtMs: parsed.createdAtMs,
    events: Object.freeze([created]),
  });
}

export function reviewProtectedTransferDemoEvidence(
  state: ProtectedTransferDemoState,
  input: z.input<typeof ReviewProtectedTransferDemoEvidenceInputSchema>,
): ProtectedTransferDemoState {
  const parsed = ReviewProtectedTransferDemoEvidenceInputSchema.parse(input);
  assertNotClosed(state);
  assertNotReplay(state, parsed.requestId);
  if (state.status !== "created") {
    throw new ProtectedTransferDemoError(
      "demo_invalid_transition",
      "Evidence has already been reviewed.",
    );
  }
  if (parsed.actorAddress !== state.reviewerAddress) {
    throw new ProtectedTransferDemoError(
      "demo_unauthorized_review",
      "Only the configured reviewer may review evidence.",
    );
  }
  if (parsed.evidenceCommitmentHex !== state.evidenceCommitmentHex) {
    throw new ProtectedTransferDemoError(
      "demo_evidence_mismatch",
      "Evidence commitment does not match the created transfer.",
    );
  }
  if (parsed.nowMs > state.deadlineMs) {
    throw new ProtectedTransferDemoError(
      "demo_release_expired",
      "Evidence review cannot authorize release after the deadline.",
    );
  }

  const approved = parsed.decision === "approve";
  return nextState(
    state,
    approved ? "evidence_approved" : "evidence_rejected",
    eventFor(state, {
      requestId: parsed.requestId,
      kind: approved ? "demo_evidence_approved" : "demo_evidence_rejected",
      occurredAtMs: parsed.nowMs,
      actorAddress: parsed.actorAddress,
      evidenceCommitmentHex: parsed.evidenceCommitmentHex,
    }),
  );
}

export function releaseProtectedTransferDemo(
  state: ProtectedTransferDemoState,
  input: z.input<typeof ReleaseProtectedTransferDemoInputSchema>,
): ProtectedTransferDemoState {
  const parsed = ReleaseProtectedTransferDemoInputSchema.parse(input);
  assertNotClosed(state);
  assertNotReplay(state, parsed.requestId);
  if (state.status !== "evidence_approved") {
    throw new ProtectedTransferDemoError(
      "demo_invalid_transition",
      "Release requires approved evidence.",
    );
  }
  if (parsed.actorAddress !== state.reviewerAddress) {
    throw new ProtectedTransferDemoError(
      "demo_unauthorized_release",
      "Only the configured reviewer may release.",
    );
  }
  if (parsed.nowMs > state.deadlineMs) {
    throw new ProtectedTransferDemoError(
      "demo_release_expired",
      "Release must occur at or before the deadline.",
    );
  }

  return nextState(
    state,
    "released",
    eventFor(state, {
      requestId: parsed.requestId,
      kind: "demo_transfer_released",
      occurredAtMs: parsed.nowMs,
      actorAddress: parsed.actorAddress,
      destinationAddress: state.beneficiaryAddress,
      amountMicro: state.amountMicro,
    }),
  );
}

export function expireProtectedTransferDemo(
  state: ProtectedTransferDemoState,
  input: z.input<typeof ExpireProtectedTransferDemoInputSchema>,
): ProtectedTransferDemoState {
  const parsed = ExpireProtectedTransferDemoInputSchema.parse(input);
  assertNotClosed(state);
  assertNotReplay(state, parsed.requestId);
  if (parsed.nowMs <= state.deadlineMs) {
    throw new ProtectedTransferDemoError(
      "demo_expiry_too_early",
      "Expiry requires time strictly after the deadline.",
    );
  }

  return nextState(
    state,
    "expired",
    eventFor(state, {
      requestId: parsed.requestId,
      kind: "demo_transfer_expired",
      occurredAtMs: parsed.nowMs,
    }),
  );
}

export function refundProtectedTransferDemo(
  state: ProtectedTransferDemoState,
  input: z.input<typeof RefundProtectedTransferDemoInputSchema>,
): ProtectedTransferDemoState {
  const parsed = RefundProtectedTransferDemoInputSchema.parse(input);
  if (["released", "refunded"].includes(state.status)) {
    throw new ProtectedTransferDemoError(
      "demo_terminal_state",
      `Action is unavailable after ${state.status}.`,
    );
  }
  assertNotReplay(state, parsed.requestId);
  if (parsed.nowMs <= state.deadlineMs) {
    throw new ProtectedTransferDemoError(
      "demo_refund_too_early",
      "Refund requires time strictly after the deadline.",
    );
  }
  if (parsed.actorAddress !== state.payerAddress) {
    throw new ProtectedTransferDemoError(
      "demo_unauthorized_refund",
      "Only the configured payer may refund.",
    );
  }
  if (state.status !== "expired") {
    throw new ProtectedTransferDemoError(
      "demo_invalid_transition",
      "Transfer must enter expired state before refund.",
    );
  }

  return nextState(
    state,
    "refunded",
    eventFor(state, {
      requestId: parsed.requestId,
      kind: "demo_transfer_refunded",
      occurredAtMs: parsed.nowMs,
      actorAddress: parsed.actorAddress,
      destinationAddress: state.payerAddress,
      amountMicro: state.amountMicro,
    }),
  );
}
