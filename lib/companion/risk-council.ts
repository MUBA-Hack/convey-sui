import { z } from "zod";
import {
  compareDecisionProofs,
  resolveDecisionProofEvidence,
  type DecisionProofResult,
  type LiveDecisionProofResult,
} from "../gonka/decision-proof";

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const AmountMajorSchema = z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/);
const BoundedTokenSchema = z.string().min(1).max(96);

export const RiskSignalIdSchema = z.enum([
  "new_recipient",
  "changed_address",
  "abnormal_amount",
  "duplicate_invoice",
  "qr_mismatch",
  "expired_or_replayed",
  "urgency_or_pressure",
  "prompt_injection",
]);

export const RiskCouncilContextSchema = z.strictObject({
  message: z.string().min(1).max(1_280),
  recipient: z
    .strictObject({
      isKnown: z.boolean(),
      proposedAddress: AddressSchema,
      storedAddress: AddressSchema.nullable(),
    })
    .superRefine((recipient, context) => {
      if (recipient.isKnown && recipient.storedAddress === null) {
        context.addIssue({
          code: "custom",
          message: "known recipient requires a saved address",
        });
      }
    }),
  amount: z.strictObject({
    amountMajor: AmountMajorSchema,
    usualMaximumMajor: AmountMajorSchema.nullable(),
  }),
  invoice: z
    .strictObject({
      invoiceId: BoundedTokenSchema,
      recentInvoiceIds: z.array(BoundedTokenSchema).max(20),
    })
    .nullable(),
  qr: z
    .strictObject({
      expectedRecipientAddress: AddressSchema,
      scannedRecipientAddress: AddressSchema,
      expiresAtEpochMs: z.number().int().nonnegative(),
      nonce: BoundedTokenSchema,
      consumedNonces: z.array(BoundedTokenSchema).max(50),
    })
    .nullable(),
  nowEpochMs: z.number().int().nonnegative(),
});

const RiskSignalSchema = z.strictObject({
  id: RiskSignalIdSchema,
  severity: z.enum(["review", "block"]),
  message: z.string().min(1).max(160),
});

const EvidenceSpanSchema = z
  .strictObject({
    id: z.string().min(1).max(64),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(512),
  })
  .superRefine((span, context) => {
    if (span.end <= span.start || span.end - span.start !== span.text.length) {
      context.addIssue({
        code: "custom",
        message: "evidence span bounds must exactly fit evidence text",
      });
    }
  });

const LiveReviewSchema = z.strictObject({
  modelId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  decision: z.enum(["confirm", "deny", "uncertain"]),
  observedAt: z.string().min(1).max(64),
  origin: z.string().min(1).max(256),
  evidenceSpans: z.array(EvidenceSpanSchema).min(1).max(8),
});

const AiCouncilSchema = z.strictObject({
  status: z.enum([
    "not_requested",
    "live_agreement",
    "live_disagreement",
    "partial",
    "local",
    "unavailable",
  ]),
  reviews: z.array(LiveReviewSchema).max(2),
});

const QuestionIdSchema = z.enum([
  "confirm_recipient",
  "confirm_recipient_address",
  "confirm_amount",
  "confirm_invoice",
  "rescan_qr",
  "request_fresh_qr",
  "pause_and_verify_request",
  "review_request_details",
  "confirm_request_before_payment",
]);

export const RiskCouncilAssessmentSchema = z
  .strictObject({
    sourceMessage: z.string().min(1).max(1_280),
    outcome: z.enum(["unusual_request", "needs_confirmation"]),
    action: z.enum(["continue", "hold", "reject"]),
    advisoryOnly: z.literal(true),
    signals: z.array(RiskSignalSchema).max(8),
    questionIds: z.array(QuestionIdSchema).min(1).max(8),
    aiCouncil: AiCouncilSchema,
  })
  .superRefine((result, context) => {
    for (const review of result.aiCouncil.reviews) {
      for (const span of review.evidenceSpans) {
        if (result.sourceMessage.slice(span.start, span.end) !== span.text) {
          context.addIssue({ code: "custom", message: "evidence span must match the source message" });
        }
      }
    }
    const blocking = result.signals.some((signal) => signal.severity === "block");
    if ((result.action === "reject") !== blocking) {
      context.addIssue({ code: "custom", message: "reject requires a blocking fact" });
    }
    if (new Set(result.signals.map((signal) => signal.id)).size !== result.signals.length) {
      context.addIssue({ code: "custom", message: "risk signal ids must be unique" });
    }
    if (new Set(result.questionIds).size !== result.questionIds.length) {
      context.addIssue({ code: "custom", message: "question ids must be unique" });
    }

    const { status, reviews } = result.aiCouncil;
    if (status === "live_agreement" || status === "live_disagreement") {
      if (
        reviews.length !== 2 ||
        reviews[0]?.modelId === reviews[1]?.modelId ||
        reviews[0]?.requestId === reviews[1]?.requestId
      ) {
        context.addIssue({ code: "custom", message: "live council provenance must be distinct" });
      }
    } else if (status === "partial") {
      if (reviews.length < 1) {
        context.addIssue({ code: "custom", message: "partial review requires live provenance" });
      }
    } else if (reviews.length !== 0) {
      context.addIssue({ code: "custom", message: "non-live council cannot carry live reviews" });
    }

    if (
      status === "live_agreement" &&
      reviews.length === 2 &&
      reviews[0]?.decision !== reviews[1]?.decision
    ) {
      context.addIssue({ code: "custom", message: "agreement decisions must match" });
    }
    if (
      status === "live_disagreement" &&
      reviews.length === 2 &&
      reviews[0]?.decision === reviews[1]?.decision
    ) {
      context.addIssue({ code: "custom", message: "disagreement decisions must differ" });
    }
  });

export type RiskCouncilContext = z.infer<typeof RiskCouncilContextSchema>;
export type RiskCouncilAssessment = z.infer<typeof RiskCouncilAssessmentSchema>;

export interface RiskCouncilInput {
  context: RiskCouncilContext;
  firstReview?: DecisionProofResult | null;
  secondReview?: DecisionProofResult | null;
}

type RiskSignal = z.infer<typeof RiskSignalSchema>;
type QuestionId = z.infer<typeof QuestionIdSchema>;

const URGENCY_PATTERN = /\b(urgent|immediately|right now|pay now|act now|today)\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(ignore (?:all |any )?(?:previous|prior|system) instructions?|reveal (?:the )?system prompt|developer message|bypass (?:the )?(?:rules|safeguards|checks))\b/i;

function toAtomic(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(6, "0")}`);
}

function sameAddress(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function deterministicSignals(context: RiskCouncilContext): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const add = (signal: RiskSignal): void => {
    if (!signals.some((existing) => existing.id === signal.id)) signals.push(signal);
  };

  if (!context.recipient.isKnown) {
    add({
      id: "new_recipient",
      severity: "review",
      message: "You have not paid this recipient before.",
    });
  }
  if (
    context.recipient.storedAddress !== null &&
    !sameAddress(context.recipient.proposedAddress, context.recipient.storedAddress)
  ) {
    add({
      id: "changed_address",
      severity: "review",
      message: "This recipient address differs from the saved address.",
    });
  }
  if (
    context.amount.usualMaximumMajor !== null &&
    toAtomic(context.amount.amountMajor) > toAtomic(context.amount.usualMaximumMajor)
  ) {
    add({
      id: "abnormal_amount",
      severity: "review",
      message: "This amount is above the usual maximum for this payment context.",
    });
  }
  if (
    context.invoice !== null &&
    context.invoice.recentInvoiceIds.includes(context.invoice.invoiceId)
  ) {
    add({
      id: "duplicate_invoice",
      severity: "review",
      message: "This invoice identifier appeared in a recent request.",
    });
  }
  if (context.qr !== null) {
    if (
      !sameAddress(
        context.qr.expectedRecipientAddress,
        context.qr.scannedRecipientAddress,
      ) ||
      !sameAddress(context.qr.scannedRecipientAddress, context.recipient.proposedAddress)
    ) {
      add({
        id: "qr_mismatch",
        severity: "block",
        message: "The scanned recipient does not match the expected recipient.",
      });
    }
    if (
      context.qr.expiresAtEpochMs <= context.nowEpochMs ||
      context.qr.consumedNonces.includes(context.qr.nonce)
    ) {
      add({
        id: "expired_or_replayed",
        severity: "block",
        message: "This QR request is expired or has already been consumed.",
      });
    }
  }
  if (URGENCY_PATTERN.test(context.message)) {
    add({
      id: "urgency_or_pressure",
      severity: "review",
      message: "The request uses urgent or pressuring language.",
    });
  }
  if (PROMPT_INJECTION_PATTERN.test(context.message)) {
    add({
      id: "prompt_injection",
      severity: "review",
      message: "The request contains instructions that try to override safety checks.",
    });
  }
  return signals;
}

function liveReview(
  review: LiveDecisionProofResult,
  message: string,
): z.infer<typeof LiveReviewSchema> {
  return {
    modelId: review.modelId,
    requestId: review.requestId,
    decision: review.decision,
    observedAt: review.observedAt,
    origin: review.origin,
    evidenceSpans: [...resolveDecisionProofEvidence(review, message)],
  };
}

function tryLiveReview(
  review: LiveDecisionProofResult,
  message: string,
): z.infer<typeof LiveReviewSchema> | null {
  try {
    return liveReview(review, message);
  } catch {
    return null;
  }
}

function councilResult(
  first: DecisionProofResult | null | undefined,
  second: DecisionProofResult | null | undefined,
  message: string,
): {
  aiCouncil: z.infer<typeof AiCouncilSchema>;
  shouldHold: boolean;
} {
  const supplied = [first, second].filter(
    (review): review is DecisionProofResult => review !== null && review !== undefined,
  );
  if (supplied.length === 0) {
    return { aiCouncil: { status: "not_requested", reviews: [] }, shouldHold: false };
  }

  const live = supplied.filter(
    (review): review is LiveDecisionProofResult => review.status === "live",
  );
  const reviews = live
    .map((review) => tryLiveReview(review, message))
    .filter(
      (review): review is z.infer<typeof LiveReviewSchema> => review !== null,
    );
  if (first?.status === "live" && second?.status === "live") {
    if (reviews.length < 2) {
      return reviews.length === 1
        ? { aiCouncil: { status: "partial", reviews }, shouldHold: true }
        : { aiCouncil: { status: "unavailable", reviews: [] }, shouldHold: false };
    }
    const comparison = compareDecisionProofs(first, second);
    if (comparison === "agreement") {
      return {
        aiCouncil: { status: "live_agreement", reviews },
        shouldHold: first.decision !== "confirm",
      };
    }
    if (comparison === "disagreement") {
      return {
        aiCouncil: { status: "live_disagreement", reviews },
        shouldHold: true,
      };
    }
    return { aiCouncil: { status: "partial", reviews }, shouldHold: true };
  }
  if (reviews.length > 0) {
    return { aiCouncil: { status: "partial", reviews }, shouldHold: true };
  }
  if (live.length > 0) {
    return { aiCouncil: { status: "unavailable", reviews: [] }, shouldHold: false };
  }
  if (supplied.some((review) => review.status === "local_fallback")) {
    return { aiCouncil: { status: "local", reviews: [] }, shouldHold: false };
  }
  return { aiCouncil: { status: "unavailable", reviews: [] }, shouldHold: false };
}

function questionsFor(
  signals: readonly RiskSignal[],
  aiShouldHold: boolean,
): QuestionId[] {
  const requested = new Set<QuestionId>();
  const add = (id: QuestionId): void => {
    requested.add(id);
  };
  for (const signal of signals) {
    if (signal.id === "new_recipient") add("confirm_recipient");
    if (signal.id === "changed_address") add("confirm_recipient_address");
    if (signal.id === "abnormal_amount") add("confirm_amount");
    if (signal.id === "duplicate_invoice") add("confirm_invoice");
    if (signal.id === "qr_mismatch") add("rescan_qr");
    if (signal.id === "expired_or_replayed") add("request_fresh_qr");
    if (signal.id === "urgency_or_pressure" || signal.id === "prompt_injection") {
      add("pause_and_verify_request");
    }
  }
  if (aiShouldHold) add("review_request_details");
  if (requested.size === 0) add("confirm_request_before_payment");
  return [...requested];
}

export function assessCompanionRisk(input: RiskCouncilInput): RiskCouncilAssessment {
  const context = RiskCouncilContextSchema.parse(input.context);
  const signals = deterministicSignals(context);
  const { aiCouncil, shouldHold } = councilResult(
    input.firstReview,
    input.secondReview,
    context.message,
  );
  const hasBlockingMismatch = signals.some((signal) => signal.severity === "block");
  const hasIdentityChange = signals.some(
    (signal) => signal.id === "new_recipient" || signal.id === "changed_address",
  );
  const action = hasBlockingMismatch
    ? "reject"
    : signals.length > 0 || shouldHold
      ? "hold"
      : "continue";
  const outcome = hasBlockingMismatch || hasIdentityChange || shouldHold
    ? "needs_confirmation"
    : signals.length > 0
      ? "unusual_request"
      : "needs_confirmation";

  return RiskCouncilAssessmentSchema.parse({
    sourceMessage: context.message,
    outcome,
    action,
    advisoryOnly: true,
    signals,
    questionIds: questionsFor(signals, shouldHold),
    aiCouncil,
  });
}
