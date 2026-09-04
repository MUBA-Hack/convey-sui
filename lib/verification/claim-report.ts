import { z } from "zod";

export const CLAIM_REPORT_REQUEST_MAX_BYTES = 18_432;
export const CLAIM_INPUT_MAX_LENGTH = 12_000;
export const CLAIM_URL_MAX_LENGTH = 2_048;

const ShortTextSchema = z.string().trim().min(1).max(280);
const ModelIdSchema = z.string().trim().min(1).max(160);
const RequestIdSchema = z.string().trim().min(1).max(160);

export const ClaimVerificationRequestSchema = z.discriminatedUnion("inputType", [
  z.strictObject({
    inputType: z.literal("text"),
    input: z.string().trim().min(8).max(CLAIM_INPUT_MAX_LENGTH),
  }),
  z.strictObject({
    inputType: z.literal("url"),
    input: z.string().trim().url().max(CLAIM_URL_MAX_LENGTH),
  }),
]);
export type ClaimVerificationRequest = z.infer<typeof ClaimVerificationRequestSchema>;

export const ClaimSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), label: z.literal("Pasted text") }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().url().max(CLAIM_URL_MAX_LENGTH),
    host: z.string().min(1).max(253),
    title: z.string().min(1).max(240).nullable(),
  }),
]);
export type ClaimSource = z.infer<typeof ClaimSourceSchema>;

export const ClaimReviewVerdictSchema = z.enum([
  "supported",
  "mixed",
  "unsupported",
  "insufficient",
]);
export type ClaimReviewVerdict = z.infer<typeof ClaimReviewVerdictSchema>;

const ClaimReportStepSchema = z.strictObject({
  step: z.enum(["claim_extraction", "review_a", "review_b"]),
  requestId: RequestIdSchema,
  modelId: ModelIdSchema,
  latencyMs: z.number().int().min(0).max(120_000),
});

const ClaimReportReasonSchema = z.strictObject({
  reviewer: z.enum(["review_a", "review_b"]),
  text: ShortTextSchema,
});

const ClaimReportEvidenceSchema = z.strictObject({
  reviewer: z.enum(["review_a", "review_b"]),
  text: z.string().trim().min(1).max(360),
});

export const ClaimVerificationReportSchema = z.strictObject({
  kind: z.literal("verified_report"),
  source: ClaimSourceSchema,
  primaryClaim: z.string().trim().min(1).max(600),
  claimType: z.enum(["factual", "opinion", "prediction", "unverifiable"]),
  truthScore: z.number().int().min(0).max(100),
  verdict: ClaimReviewVerdictSchema,
  consensus: z.strictObject({
    status: z.enum(["aligned", "contested"]),
    scoreSpread: z.number().int().min(0).max(100),
  }),
  reasoningTrace: z.array(ClaimReportReasonSchema).min(2).max(12),
  evidence: z.array(ClaimReportEvidenceSchema).max(12),
  limitations: z.array(ShortTextSchema).max(8),
  steps: z
    .tuple([ClaimReportStepSchema, ClaimReportStepSchema, ClaimReportStepSchema])
    .superRefine((steps, context) => {
      const expected = ["claim_extraction", "review_a", "review_b"] as const;
      steps.forEach((step, index) => {
        if (step.step !== expected[index]) {
          context.addIssue({ code: "custom", path: [index, "step"], message: "Unexpected step order." });
        }
      });
      if (new Set(steps.map((step) => step.requestId)).size !== steps.length) {
        context.addIssue({ code: "custom", message: "Request ids must be distinct." });
      }
      if (steps[1].modelId === steps[2].modelId) {
        context.addIssue({ code: "custom", message: "Review models must be distinct." });
      }
    }),
  assessedAt: z.string().datetime(),
});
export type ClaimVerificationReport = z.infer<typeof ClaimVerificationReportSchema>;

export const ClaimVerificationResponseSchema = z.discriminatedUnion("kind", [
  ClaimVerificationReportSchema,
  z.strictObject({
    kind: z.literal("rejected"),
    reason: z.enum(["invalid_input", "unsafe_url", "source_unavailable", "source_too_large"]),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.enum(["not_configured", "provider_error", "insufficient_consensus"]),
  }),
]);
export type ClaimVerificationResponse = z.infer<typeof ClaimVerificationResponseSchema>;

export async function requestClaimVerification(
  request: ClaimVerificationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimVerificationResponse> {
  const response = await fetchImpl("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ClaimVerificationRequestSchema.parse(request)),
  });
  const parsed = ClaimVerificationResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Verification service returned an invalid response.");
  return parsed.data;
}
