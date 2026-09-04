import { z } from "zod";
import { blake2b256, toHex } from "../protocol/hash";
import { ProtectedTransferCreatedReceiptSchema } from "./protected-transfer-created-receipt";

export const EVIDENCE_COUNCIL_REQUEST_MAX_BYTES = 24 * 1024;
export const EVIDENCE_COUNCIL_MAX_CODE_POINTS = 1_000;
export const EVIDENCE_COUNCIL_MAX_TEXT_BYTES = 4_000;
export const EVIDENCE_COUNCIL_MIN_CONFIDENCE = 0.7;
export const EVIDENCE_COUNCIL_ARTIFACT_VERSION =
  "convey.evidence-council.v1" as const;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const EvidenceCouncilTextSchema = z
  .string()
  .refine((value) => Array.from(value).length > 0, "Evidence is empty.")
  .refine(
    (value) => Array.from(value).length <= EVIDENCE_COUNCIL_MAX_CODE_POINTS,
    "Evidence has too many Unicode code points.",
  )
  .refine(
    (value) => utf8Length(value) <= EVIDENCE_COUNCIL_MAX_TEXT_BYTES,
    "Evidence is too large.",
  );

export const EvidenceCouncilFactIdSchema = z.enum([
  "recipient",
  "amount",
  "purpose",
  "fulfillment",
  "reference",
]);
export type EvidenceCouncilFactId = z.infer<typeof EvidenceCouncilFactIdSchema>;

export const EvidenceCouncilQuestionIdSchema = z.enum([
  "confirm_recipient",
  "confirm_amount",
  "confirm_purpose",
  "provide_clearer_evidence",
]);
export type EvidenceCouncilQuestionId = z.infer<
  typeof EvidenceCouncilQuestionIdSchema
>;

export const EvidenceCouncilRequestSchema = z.strictObject({
  createdReceipt: ProtectedTransferCreatedReceiptSchema,
  evidenceText: EvidenceCouncilTextSchema,
});
export type EvidenceCouncilRequest = z.infer<typeof EvidenceCouncilRequestSchema>;

const EvidenceSpanSchema = z.strictObject({
  id: EvidenceCouncilFactIdSchema,
  start: z.number().int().safe().min(0).max(EVIDENCE_COUNCIL_MAX_CODE_POINTS),
  end: z.number().int().safe().min(1).max(EVIDENCE_COUNCIL_MAX_CODE_POINTS),
  text: EvidenceCouncilTextSchema,
});
export type EvidenceCouncilSpan = z.infer<typeof EvidenceSpanSchema>;

const ProvenanceSchema = z.strictObject({
  reviewer: z.enum(["review_a", "review_b"]),
  requestId: z.string().min(1).max(120),
  responseModel: z.string().min(1).max(120),
});
export type EvidenceCouncilProvenance = z.infer<typeof ProvenanceSchema>;

const CheckStatusSchema = z.enum(["matched", "missing", "not_required"]);
const CheckSchema = <TId extends "recipient" | "amount" | "purpose">(
  id: TId,
) =>
  z.strictObject({
    id: z.literal(id),
    status: CheckStatusSchema,
  });

export const EvidenceCouncilChecksSchema = z.tuple([
  CheckSchema("recipient"),
  CheckSchema("amount"),
  CheckSchema("purpose"),
]);
export type EvidenceCouncilChecks = z.infer<typeof EvidenceCouncilChecksSchema>;

const CorroboratedFactSchema = z.strictObject({
  id: EvidenceCouncilFactIdSchema,
  evidence: z.tuple([EvidenceSpanSchema, EvidenceSpanSchema]),
});

const DisputedFactSchema = z.strictObject({
  id: EvidenceCouncilFactIdSchema,
  evidence: z.array(EvidenceSpanSchema).min(1).max(2),
});

export const EvidenceCouncilArtifactSchema = z
  .strictObject({
    version: z.literal(EVIDENCE_COUNCIL_ARTIFACT_VERSION),
    advisoryOnly: z.literal(true),
    artifactDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    evidenceTextDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    createdDigest: z.string().min(1).max(120),
    escrowObjectId: z.string().regex(/^0x[0-9a-f]{64}$/),
    recipient: z.string().min(1).max(40),
    purpose: z.string().min(1).max(120).nullable(),
    youPayMinor: z.string().regex(/^\d+$/),
    familyReceivesMinor: z.string().regex(/^\d+$/),
    amountMicro: z.string().regex(/^[1-9]\d*$/),
    deadlineMs: z.number().int().safe().positive(),
    createdCheckedAt: z.iso.datetime(),
    assessedAt: z.iso.datetime(),
    checks: EvidenceCouncilChecksSchema,
    corroboratedFacts: z.array(CorroboratedFactSchema).max(5),
    disputedFacts: z.array(DisputedFactSchema).max(5),
    questionIds: z.array(EvidenceCouncilQuestionIdSchema).max(4),
    reviews: z.tuple([ProvenanceSchema, ProvenanceSchema]),
  })
  .superRefine((artifact, context) => {
    const [first, second] = artifact.reviews;
    if (
      first.reviewer !== "review_a" ||
      second.reviewer !== "review_b" ||
      first.requestId === second.requestId ||
      first.responseModel === second.responseModel
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviews"],
        message: "Council provenance must use distinct requests and models.",
      });
    }
    if (new Set(artifact.questionIds).size !== artifact.questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["questionIds"],
        message: "Question ids must be unique.",
      });
    }
    for (const fact of artifact.corroboratedFacts) {
      if (fact.evidence.some((span) => span.id !== fact.id)) {
        context.addIssue({
          code: "custom",
          path: ["corroboratedFacts"],
          message: "Corroborated fact evidence ids must match.",
        });
      }
    }
    for (const fact of artifact.disputedFacts) {
      if (fact.evidence.some((span) => span.id !== fact.id)) {
        context.addIssue({
          code: "custom",
          path: ["disputedFacts"],
          message: "Disputed fact evidence ids must match.",
        });
      }
    }
    const { artifactDigest, ...payload } = artifact;
    if (artifactDigest !== computeEvidenceCouncilArtifactDigest(payload)) {
      context.addIssue({
        code: "custom",
        path: ["artifactDigest"],
        message: "Artifact digest must match the canonical advisory artifact.",
      });
    }
  });
export type EvidenceCouncilArtifact = z.infer<typeof EvidenceCouncilArtifactSchema>;

export function computeEvidenceCouncilArtifactDigest(
  payload: Omit<EvidenceCouncilArtifact, "artifactDigest">,
): `0x${string}` {
  return toHex(
    blake2b256(new TextEncoder().encode(JSON.stringify(payload))),
  );
}

export interface EvidenceCouncilArtifactExport {
  filename: string;
  json: string;
}

/**
 * Serializes a portable advisory artifact only when it is still strictly
 * schema-valid and its canonical digest recomputes. Any malformed or tampered
 * artifact yields null so the UI can offer no copy/download at all.
 */
export function buildEvidenceCouncilArtifactExport(
  artifact: EvidenceCouncilArtifact,
): EvidenceCouncilArtifactExport | null {
  const parsed = EvidenceCouncilArtifactSchema.safeParse(artifact);
  if (!parsed.success) return null;
  const { artifactDigest, ...payload } = parsed.data;
  if (artifactDigest !== computeEvidenceCouncilArtifactDigest(payload)) {
    return null;
  }
  return {
    filename: `convey-evidence-council-${artifactDigest.slice(2, 14)}.json`,
    json: `${JSON.stringify(parsed.data, null, 2)}\n`,
  };
}

export const EvidenceCouncilResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready_for_human_review"),
    advisoryOnly: z.literal(true),
    artifact: EvidenceCouncilArtifactSchema,
  }),
  z.strictObject({
    kind: z.literal("questions_needed"),
    advisoryOnly: z.literal(true),
    reason: z.enum([
      "deterministic_mismatch",
      "missing_corroboration",
      "partial_review",
    ]),
    artifact: EvidenceCouncilArtifactSchema.nullable(),
    questionIds: z.array(EvidenceCouncilQuestionIdSchema).min(1).max(4),
  }),
  z.strictObject({
    kind: z.literal("disputed"),
    advisoryOnly: z.literal(true),
    artifact: EvidenceCouncilArtifactSchema,
    questionIds: z.array(EvidenceCouncilQuestionIdSchema).min(1).max(4),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    advisoryOnly: z.literal(true),
    reason: z.enum(["not_configured", "provider_error"]),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    advisoryOnly: z.literal(true),
    reason: z.enum([
      "invalid_request",
      "created_not_verified",
      "created_not_found",
      "created_check_unavailable",
      "receipt_mismatch",
      "deadline_passed",
    ]),
  }),
]);
export type EvidenceCouncilResponse = z.infer<
  typeof EvidenceCouncilResponseSchema
>;

export interface RequestEvidenceCouncilInput {
  request: EvidenceCouncilRequest;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function requestEvidenceCouncilReview(
  input: RequestEvidenceCouncilInput,
): Promise<EvidenceCouncilResponse> {
  const request = EvidenceCouncilRequestSchema.parse(input.request);
  const response = await (input.fetchImpl ?? fetch)(
    "/api/remittance/protected-transfer/evidence",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: input.signal,
    },
  );
  if (!response.ok) throw new Error("Evidence review request failed.");
  const parsed = EvidenceCouncilResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Evidence review response did not match the strict schema.");
  }
  return parsed.data;
}
