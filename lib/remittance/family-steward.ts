import { z } from "zod";
import {
  FAMILY_STEWARD_MIN_CONFIDENCE,
  FAMILY_STEWARD_QUESTION_IDS,
  FAMILY_STEWARD_SIGNAL_IDS,
  FamilyStewardQuestionIdSchema,
  FamilyStewardSignalSchema,
  familyStewardCandidateSchema,
  familyStewardSolicitationTextSchema,
  resolveFamilyStewardCandidate,
  type FamilyStewardCandidate,
  type FamilyStewardQuestionId,
  type FamilyStewardSignal,
  type FamilyStewardSignalId,
  type FamilyStewardResolvedCandidate,
} from "../gonka/family-steward";
import type { GonkaResponseMetadata } from "../gonka/types";
import { QuoteEnvelopeSchema } from "./quote-schema";

export type {
  FamilyStewardQuestionId,
  FamilyStewardSignal,
  FamilyStewardSignalId,
} from "../gonka/family-steward";

export const FAMILY_STEWARD_REQUEST_MAX_BYTES = 16_384;

export const FamilyStewardRequestSchema = z.strictObject({
  quote: QuoteEnvelopeSchema,
  solicitationText: familyStewardSolicitationTextSchema,
});

export type FamilyStewardRequest = z.infer<typeof FamilyStewardRequestSchema>;

const FamilyStewardAssessmentSchema = z.enum([
  "no_added_signal",
  "review_recommended",
  "pause_and_verify",
]);

const FamilyStewardReviewProvenanceSchema = z.strictObject({
  reviewer: z.enum(["review_a", "review_b"]),
  requestId: z.string().min(1).max(120),
  responseModel: z.string().min(1).max(120),
});

const FamilyStewardCorroboratedSignalSchema = z.strictObject({
  id: FamilyStewardSignalSchema.shape.id,
  evidence: z.tuple([FamilyStewardSignalSchema, FamilyStewardSignalSchema]),
});

const FamilyStewardDisputedSignalSchema = z.strictObject({
  id: FamilyStewardSignalSchema.shape.id,
  reportedBy: z.enum(["review_a", "review_b"]),
  evidence: FamilyStewardSignalSchema,
});

export const FamilyStewardLiveCouncilSchema = z
  .strictObject({
    kind: z.literal("live_council"),
    assessment: FamilyStewardAssessmentSchema,
    corroboratedSignals: z.array(FamilyStewardCorroboratedSignalSchema).max(6),
    disputedSignals: z.array(FamilyStewardDisputedSignalSchema).max(12),
    questionIds: z.array(FamilyStewardQuestionIdSchema).max(3),
    reviews: z.tuple([
      FamilyStewardReviewProvenanceSchema,
      FamilyStewardReviewProvenanceSchema,
    ]),
  })
  .superRefine((result, context) => {
    const [first, second] = result.reviews;
    if (
      first.reviewer !== "review_a" ||
      second.reviewer !== "review_b" ||
      first.requestId === second.requestId ||
      first.responseModel === second.responseModel
    ) {
      context.addIssue({ code: "custom", message: "live review provenance must be distinct" });
    }
    if (new Set(result.questionIds).size !== result.questionIds.length) {
      context.addIssue({ code: "custom", message: "question ids must be unique" });
    }
    for (const signal of result.corroboratedSignals) {
      if (signal.evidence.some((evidence) => evidence.id !== signal.id)) {
        context.addIssue({ code: "custom", message: "corroborated evidence id mismatch" });
      }
    }
    for (const signal of result.disputedSignals) {
      if (signal.evidence.id !== signal.id) {
        context.addIssue({ code: "custom", message: "disputed evidence id mismatch" });
      }
    }
  });

export const FamilyStewardPartialReviewSchema = z
  .strictObject({
    kind: z.literal("partial_review"),
    assessment: z.literal("review_recommended"),
    noConsensus: z.literal(true),
    signals: z.array(FamilyStewardSignalSchema).max(6),
    questionIds: z.array(FamilyStewardQuestionIdSchema).max(3),
    review: FamilyStewardReviewProvenanceSchema,
    unavailableReviewer: z.enum(["review_a", "review_b"]),
  })
  .refine((result) => result.review.reviewer !== result.unavailableReviewer, {
    message: "available and unavailable reviewers must differ",
  });

export const FamilyStewardLocalFallbackSchema = z.strictObject({
  kind: z.literal("local_fallback"),
  assessment: z.literal("review_recommended"),
  fallbackReason: z.enum([
    "not_configured",
    "provider_error",
    "candidate_rejected",
  ]),
  questionIds: z.array(FamilyStewardQuestionIdSchema).min(1).max(3),
});

export const FamilyStewardRejectedSchema = z.strictObject({
  kind: z.literal("rejected"),
  reason: z.enum([
    "invalid_request",
    "expired",
    "unverified",
    "unmapped_recipient",
    "invalid_envelope",
    "not_configured",
  ]),
});

export const FamilyStewardResponseSchema = z.discriminatedUnion("kind", [
  FamilyStewardLiveCouncilSchema,
  FamilyStewardPartialReviewSchema,
  FamilyStewardLocalFallbackSchema,
  FamilyStewardRejectedSchema,
]);

export type FamilyStewardResponse = z.infer<typeof FamilyStewardResponseSchema>;
export type FamilyStewardLiveCouncil = z.infer<typeof FamilyStewardLiveCouncilSchema>;
export type FamilyStewardPartialReview = z.infer<typeof FamilyStewardPartialReviewSchema>;
export type FamilyStewardLocalFallback = z.infer<typeof FamilyStewardLocalFallbackSchema>;
export type FamilyStewardRejected = z.infer<typeof FamilyStewardRejectedSchema>;

export interface FamilyStewardModelReview {
  candidate: FamilyStewardCandidate;
  metadata: GonkaResponseMetadata;
}

export interface FamilyStewardCouncilInput {
  solicitationText: string;
  first: FamilyStewardModelReview | null;
  second: FamilyStewardModelReview | null;
}

type ReviewSlot = "review_a" | "review_b";

interface ValidReview {
  slot: ReviewSlot;
  candidate: FamilyStewardResolvedCandidate;
  provenance: z.infer<typeof FamilyStewardReviewProvenanceSchema>;
}

const HIGH_CONCERN_SIGNALS = new Set<FamilyStewardSignalId>([
  "secrecy",
  "authority_pressure",
  "payment_change",
  "identity_uncertainty",
  "unusual_method",
]);

function asValidReview(
  review: FamilyStewardModelReview | null,
  slot: ReviewSlot,
  solicitationText: string,
): ValidReview | null {
  if (review === null) return null;
  if (!familyStewardCandidateSchema.safeParse(review.candidate).success) return null;
  if (review.candidate.confidence < FAMILY_STEWARD_MIN_CONFIDENCE) return null;
  if (review.candidate.uncertain) return null;
  const provenance = FamilyStewardReviewProvenanceSchema.safeParse({
    reviewer: slot,
    requestId: review.metadata.gonkaRequestId,
    responseModel: review.metadata.responseModel,
  });
  if (!provenance.success) return null;
  let candidate: FamilyStewardResolvedCandidate;
  try {
    candidate = resolveFamilyStewardCandidate(review.candidate, solicitationText);
  } catch {
    return null;
  }
  return { slot, candidate, provenance: provenance.data };
}

function orderedQuestions(reviews: ValidReview[]): FamilyStewardQuestionId[] {
  const requested = new Set(reviews.flatMap((review) => review.candidate.questionIds));
  const ordered = FAMILY_STEWARD_QUESTION_IDS.filter((id) => requested.has(id));
  if (ordered.length > 0) return ordered.slice(0, 3);
  return ["verify_sender_in_known_channel", "pause_and_ask_trusted_person"];
}

function signalMap(review: ValidReview): Map<FamilyStewardSignalId, FamilyStewardSignal> {
  return new Map(review.candidate.signals.map((signal) => [signal.id, signal]));
}

function buildLiveCouncil(
  first: ValidReview,
  second: ValidReview,
): FamilyStewardLiveCouncil {
  const firstSignals = signalMap(first);
  const secondSignals = signalMap(second);
  const corroboratedSignals: FamilyStewardLiveCouncil["corroboratedSignals"] = [];
  const disputedSignals: FamilyStewardLiveCouncil["disputedSignals"] = [];

  for (const id of FAMILY_STEWARD_SIGNAL_IDS) {
    const firstEvidence = firstSignals.get(id);
    const secondEvidence = secondSignals.get(id);
    if (firstEvidence && secondEvidence) {
      corroboratedSignals.push({ id, evidence: [firstEvidence, secondEvidence] });
      continue;
    }
    if (firstEvidence) {
      disputedSignals.push({ id, reportedBy: first.slot, evidence: firstEvidence });
    }
    if (secondEvidence) {
      disputedSignals.push({ id, reportedBy: second.slot, evidence: secondEvidence });
    }
  }

  const hasHighConcern = corroboratedSignals.some((signal) =>
    HIGH_CONCERN_SIGNALS.has(signal.id),
  );
  const hasAnyEvidence = corroboratedSignals.length + disputedSignals.length > 0;
  const assessment = hasHighConcern
    ? "pause_and_verify"
    : hasAnyEvidence
      ? "review_recommended"
      : "no_added_signal";

  return FamilyStewardLiveCouncilSchema.parse({
    kind: "live_council",
    assessment,
    corroboratedSignals,
    disputedSignals,
    questionIds: orderedQuestions([first, second]),
    reviews: [first.provenance, second.provenance],
  });
}

function buildPartialReview(
  review: ValidReview,
  unavailableReviewer: ReviewSlot,
): FamilyStewardPartialReview {
  return FamilyStewardPartialReviewSchema.parse({
    kind: "partial_review",
    assessment: "review_recommended",
    noConsensus: true,
    signals: review.candidate.signals,
    questionIds: orderedQuestions([review]),
    review: review.provenance,
    unavailableReviewer,
  });
}

export function buildFamilyStewardLocalFallback(
  fallbackReason: FamilyStewardLocalFallback["fallbackReason"],
): FamilyStewardLocalFallback {
  return {
    kind: "local_fallback",
    assessment: "review_recommended",
    fallbackReason,
    questionIds: [
      "verify_sender_in_known_channel",
      "confirm_payment_details",
      "pause_and_ask_trusted_person",
    ],
  };
}

export function buildFamilyStewardRejected(
  reason: FamilyStewardRejected["reason"],
): FamilyStewardRejected {
  return { kind: "rejected", reason };
}

export function aggregateFamilyStewardCouncil(
  input: FamilyStewardCouncilInput,
): FamilyStewardResponse {
  const first = asValidReview(input.first, "review_a", input.solicitationText);
  const second = asValidReview(input.second, "review_b", input.solicitationText);

  if (
    first &&
    second &&
    first.provenance.responseModel !== second.provenance.responseModel &&
    first.provenance.requestId !== second.provenance.requestId
  ) {
    return buildLiveCouncil(first, second);
  }
  if (first) return buildPartialReview(first, "review_b");
  if (second) return buildPartialReview(second, "review_a");
  return buildFamilyStewardLocalFallback("candidate_rejected");
}
