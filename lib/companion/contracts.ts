import { z } from "zod";
import {
  CompanionAssetSchema,
  CompanionContactSchema,
  CompanionInteractionSchema,
  CompanionMemorySchema,
} from "./memory";
import { CompanionWorkspaceIdSchema } from "./workspaces";
import { CompanionOrganizationContextSchema } from "./organizations";

export const CompanionToolIdSchema = z.enum([
  "contacts.resolve",
  "payments.propose",
  "splits.propose",
  "missions.propose",
  "strategies.propose",
  "clarify",
]);

export const CompanionInputSchema = z.strictObject({
  message: z.string().min(1).max(1_280),
  localeHint: z.string().min(1).max(32),
  memory: CompanionMemorySchema,
  workspaceId: CompanionWorkspaceIdSchema.optional(),
  organization: CompanionOrganizationContextSchema.optional(),
});

export const CompanionTurnRequestSchema = CompanionInputSchema;

export const CompanionCandidateSchema = z.strictObject({
  toolId: CompanionToolIdSchema,
  contactId: z.string().min(1).max(64).nullable(),
  contactRef: z.string().min(1).max(96).nullable(),
  amountMajor: z
    .string()
    .regex(/^\d{1,9}(?:\.\d{1,6})?$/)
    .nullable(),
  asset: CompanionAssetSchema.nullable(),
  purpose: z.string().min(1).max(120).nullable(),
  missingFields: z.array(
    z.enum(["contact", "amount", "asset", "purpose", "approval"]),
  ).max(5),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(240),
});

export const CompanionProposalSchema = z.strictObject({
  toolId: z.literal("payments.propose"),
  contactId: z.string().min(1).max(64),
  contactLabel: z.string().min(1).max(96),
  amountMajor: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/),
  asset: CompanionAssetSchema,
  purpose: z.string().min(1).max(120).nullable(),
  requiresUserApproval: z.literal(true),
});

export const CompanionClarificationSchema = z.strictObject({
  toolId: z.literal("clarify"),
  reason: z.string().min(1).max(200),
  question: z.string().min(1).max(200),
  missingFields: z.array(
    z.enum(["contact", "amount", "asset", "purpose", "approval"]),
  ).max(5),
});

export const CompanionResolutionSchema = z.strictObject({
  toolId: CompanionToolIdSchema,
  outcome: z.enum(["proposal", "clarification", "unavailable", "rejected"]),
  routing: z.strictObject({
    provider: z.enum(["gonkarouter", "deterministic"]),
    mode: z.enum(["live", "fallback"]),
    requestId: z.string().max(96).nullable(),
    responseModel: z.string().max(128).nullable(),
    fallbackReason: z
      .enum(["not_configured", "provider_error", "candidate_rejected", "deterministic_only"])
      .nullable(),
  }),
  candidate: CompanionCandidateSchema.nullable(),
  proposal: CompanionProposalSchema.nullable(),
  clarification: CompanionClarificationSchema.nullable(),
});

export const CompanionTurnResponseSchema = CompanionResolutionSchema;

export type CompanionInput = z.infer<typeof CompanionInputSchema>;
export type CompanionCandidate = z.infer<typeof CompanionCandidateSchema>;
export type CompanionProposal = z.infer<typeof CompanionProposalSchema>;
export type CompanionClarification = z.infer<typeof CompanionClarificationSchema>;
export type CompanionResolution = z.infer<typeof CompanionResolutionSchema>;
export type CompanionAsset = z.infer<typeof CompanionAssetSchema>;
export type CompanionContact = z.infer<typeof CompanionContactSchema>;
export type CompanionInteraction = z.infer<typeof CompanionInteractionSchema>;
export type CompanionMemory = z.infer<typeof CompanionMemorySchema>;

export { CompanionMemorySchema } from "./memory";

export const COMPANION_REQUEST_MAX_BYTES = 16_384;
