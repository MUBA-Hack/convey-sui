import { z } from "zod";
import {
  createGonkaStructuredRouter,
  type GonkaDomainSpec,
  type GonkaRunResultGeneric,
  type GonkaStructuredRouter,
} from "./core";
import { byteLengthAtMost, MAX_LOCALE_BYTES } from "./schemas";
import type { GonkaAdapterConfig, GonkaAdapterDependencies } from "./types";

export const FAMILY_STEWARD_MAX_CODE_POINTS = 500;
export const FAMILY_STEWARD_MAX_TEXT_BYTES = 2_000;
export const FAMILY_STEWARD_MAX_SIGNALS = 6;
export const FAMILY_STEWARD_MAX_QUESTIONS = 3;
export const FAMILY_STEWARD_MAX_OCCURRENCE = 20;
export const FAMILY_STEWARD_MIN_CONFIDENCE = 0.7;

export const FAMILY_STEWARD_SIGNAL_IDS = [
  "urgency",
  "secrecy",
  "authority_pressure",
  "payment_change",
  "identity_uncertainty",
  "unusual_method",
] as const;

export const FAMILY_STEWARD_QUESTION_IDS = [
  "verify_sender_in_known_channel",
  "confirm_payment_details",
  "pause_and_ask_trusted_person",
] as const;

export const FamilyStewardSignalIdSchema = z.enum(FAMILY_STEWARD_SIGNAL_IDS);
export const FamilyStewardQuestionIdSchema = z.enum(FAMILY_STEWARD_QUESTION_IDS);

export type FamilyStewardSignalId = z.infer<typeof FamilyStewardSignalIdSchema>;
export type FamilyStewardQuestionId = z.infer<typeof FamilyStewardQuestionIdSchema>;

function codePointLength(text: string): number {
  return Array.from(text).length;
}

export const familyStewardSolicitationTextSchema = z
  .string()
  .refine((text) => codePointLength(text) >= 1, "message is empty")
  .refine(
    (text) => codePointLength(text) <= FAMILY_STEWARD_MAX_CODE_POINTS,
    `message exceeds ${FAMILY_STEWARD_MAX_CODE_POINTS} Unicode code points`,
  )
  .refine(
    byteLengthAtMost(FAMILY_STEWARD_MAX_TEXT_BYTES),
    `message exceeds ${FAMILY_STEWARD_MAX_TEXT_BYTES} bytes`,
  );

export const FamilyStewardSignalSchema = z.strictObject({
  id: FamilyStewardSignalIdSchema,
  start: z.number().int().safe().min(0).max(FAMILY_STEWARD_MAX_CODE_POINTS),
  end: z.number().int().safe().min(1).max(FAMILY_STEWARD_MAX_CODE_POINTS),
  text: familyStewardSolicitationTextSchema,
});

export const FamilyStewardCandidateSignalSchema = z.strictObject({
  id: FamilyStewardSignalIdSchema,
  text: familyStewardSolicitationTextSchema,
  occurrence: z.number().int().min(1).max(FAMILY_STEWARD_MAX_OCCURRENCE),
});

export const familyStewardCandidateSchema = z
  .strictObject({
    signals: z.array(FamilyStewardCandidateSignalSchema).max(FAMILY_STEWARD_MAX_SIGNALS),
    questionIds: z
      .array(FamilyStewardQuestionIdSchema)
      .max(FAMILY_STEWARD_MAX_QUESTIONS),
    confidence: z.number().finite().min(0).max(1),
    uncertain: z.boolean(),
  })
  .refine(
    (candidate) => new Set(candidate.signals.map((signal) => signal.id)).size === candidate.signals.length,
    "signal ids must be unique",
  )
  .refine(
    (candidate) => new Set(candidate.questionIds).size === candidate.questionIds.length,
    "question ids must be unique",
  );

const familyStewardManifestSchema = z.strictObject({
  solicitationText: familyStewardSolicitationTextSchema,
  signalIds: z.tuple([
    z.literal("urgency"),
    z.literal("secrecy"),
    z.literal("authority_pressure"),
    z.literal("payment_change"),
    z.literal("identity_uncertainty"),
    z.literal("unusual_method"),
  ]),
  questionIds: z.tuple([
    z.literal("verify_sender_in_known_channel"),
    z.literal("confirm_payment_details"),
    z.literal("pause_and_ask_trusted_person"),
  ]),
});

export const familyStewardInputSchema = z
  .strictObject({
    prompt: familyStewardSolicitationTextSchema,
    localeHint: z
      .string()
      .min(1)
      .refine(
        byteLengthAtMost(MAX_LOCALE_BYTES),
        `localeHint exceeds ${MAX_LOCALE_BYTES} bytes`,
      ),
    manifest: familyStewardManifestSchema,
  })
  .refine(
    (input) => input.prompt === input.manifest.solicitationText,
    "prompt must match manifest solicitationText",
  );

export type FamilyStewardSignal = z.infer<typeof FamilyStewardSignalSchema>;
export type FamilyStewardCandidateSignal = z.infer<
  typeof FamilyStewardCandidateSignalSchema
>;
export type FamilyStewardCandidate = z.infer<typeof familyStewardCandidateSchema>;
export type FamilyStewardResolvedCandidate = Omit<
  FamilyStewardCandidate,
  "signals"
> & { signals: FamilyStewardSignal[] };
export type FamilyStewardManifest = z.infer<typeof familyStewardManifestSchema>;
export type FamilyStewardInput = z.infer<typeof familyStewardInputSchema>;

export function createFamilyStewardManifest(
  solicitationText: string,
): FamilyStewardManifest {
  return familyStewardManifestSchema.parse({
    solicitationText,
    signalIds: FAMILY_STEWARD_SIGNAL_IDS,
    questionIds: FAMILY_STEWARD_QUESTION_IDS,
  });
}

function exactMatchStarts(source: string[], evidence: string[]): number[] {
  const starts: number[] = [];
  const lastStart = source.length - evidence.length;
  for (let start = 0; start <= lastStart; start += 1) {
    let matches = true;
    for (let offset = 0; offset < evidence.length; offset += 1) {
      if (source[start + offset] !== evidence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) starts.push(start);
  }
  return starts;
}

export function resolveFamilyStewardCandidate(
  candidate: FamilyStewardCandidate,
  solicitationText: string,
): FamilyStewardResolvedCandidate {
  const source = Array.from(solicitationText);
  const signals = candidate.signals.map((signal): FamilyStewardSignal => {
    const evidence = Array.from(signal.text);
    const starts = exactMatchStarts(source, evidence);
    if (starts.length === 0) {
      throw new Error(`candidate signal text not found: ${signal.id}`);
    }
    const start = starts[signal.occurrence - 1];
    if (start === undefined) {
      throw new Error(`candidate signal occurrence does not exist: ${signal.id}`);
    }
    return {
      id: signal.id,
      start,
      end: start + evidence.length,
      text: signal.text,
    };
  });
  return { ...candidate, signals };
}

export function validateFamilyStewardCandidate(
  candidate: FamilyStewardCandidate,
  solicitationText: string,
): void {
  resolveFamilyStewardCandidate(candidate, solicitationText);
}

function validateCandidateAgainstManifest(
  candidate: FamilyStewardCandidate,
  manifest: FamilyStewardManifest,
): void {
  validateFamilyStewardCandidate(candidate, manifest.solicitationText);
}

const SYSTEM_PROMPT = [
  "Return one JSON object only. Never return prose, markdown, advice, a score, or a verdict.",
  'Use exactly these keys: {"signals","questionIds","confidence","uncertain"}.',
  "Signal entries use exactly {id,text,occurrence}; no extra keys.",
  "text must be copied exactly from solicitationText.",
  "occurrence is the 1-based occurrence of that exact text in solicitationText, from 1 to 20.",
  "Use only supplied signalIds and questionIds. Do not infer identity or label a scam.",
  "Return at most six unique signal ids and three unique question ids.",
  "confidence is 0..1. uncertain is a required boolean.",
].join(" ");

const REPAIR_SYSTEM_PROMPT = [
  "Repair the candidate into one strict JSON object only.",
  "Preserve no prose from invalidOutput.",
  "Copy exact evidence text from solicitationText, use its 1-based occurrence, and only allowlisted ids.",
].join(" ");

function buildUserMessage(input: FamilyStewardInput): string {
  return JSON.stringify({
    task: "identify_payment_request_warning_signals",
    solicitationText: input.prompt,
    localeHint: input.localeHint,
    signalIds: input.manifest.signalIds,
    questionIds: input.manifest.questionIds,
  });
}

function buildRepairUserMessage(
  invalidContent: string,
  manifest: FamilyStewardManifest,
): string {
  return JSON.stringify({
    task: "repair_payment_warning_candidate",
    solicitationText: manifest.solicitationText,
    signalIds: manifest.signalIds,
    questionIds: manifest.questionIds,
    invalidOutput: invalidContent,
  });
}

const familyStewardSpec: GonkaDomainSpec<
  FamilyStewardInput,
  FamilyStewardManifest,
  FamilyStewardCandidate
> = {
  manifestSchema: familyStewardManifestSchema,
  inputSchema: familyStewardInputSchema,
  candidateSchema: familyStewardCandidateSchema,
  systemPrompt: SYSTEM_PROMPT,
  repairSystemPrompt: REPAIR_SYSTEM_PROMPT,
  buildUserMessage,
  getManifest: (input) => input.manifest,
  validateCandidateAgainstManifest,
  buildRepairUserMessage,
  candidateKeyHint: "signals",
};

export interface GonkaFamilyStewardRouter {
  run(input: FamilyStewardInput): Promise<GonkaRunResultGeneric<FamilyStewardCandidate>>;
}

export function createGonkaFamilyStewardRouter(
  cfg: GonkaAdapterConfig,
  dependencies: GonkaAdapterDependencies = {},
): GonkaFamilyStewardRouter {
  const router: GonkaStructuredRouter<FamilyStewardInput, FamilyStewardCandidate> =
    createGonkaStructuredRouter(familyStewardSpec, cfg, dependencies);
  return { run: (input) => router.run(input) };
}
