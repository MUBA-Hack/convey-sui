import "server-only";

import { z } from "zod";
import {
  createGonkaStructuredRouter,
  type GonkaDomainSpec,
  type GonkaRunResultGeneric,
  type GonkaStructuredRouter,
} from "../gonka/core";
import type {
  GonkaAdapterConfig,
  GonkaAdapterDependencies,
  GonkaResponseMetadata,
} from "../gonka/types";
import { blake2b256, toHex } from "../protocol/hash";
import {
  EVIDENCE_COUNCIL_ARTIFACT_VERSION,
  EVIDENCE_COUNCIL_MIN_CONFIDENCE,
  EvidenceCouncilArtifactSchema,
  EvidenceCouncilFactIdSchema,
  EvidenceCouncilQuestionIdSchema,
  EvidenceCouncilResponseSchema,
  EvidenceCouncilTextSchema,
  computeEvidenceCouncilArtifactDigest,
  type EvidenceCouncilArtifact,
  type EvidenceCouncilChecks,
  type EvidenceCouncilFactId,
  type EvidenceCouncilProvenance,
  type EvidenceCouncilQuestionId,
  type EvidenceCouncilResponse,
  type EvidenceCouncilSpan,
} from "./evidence-council-client";

const FACT_IDS = [
  "recipient",
  "amount",
  "purpose",
  "fulfillment",
  "reference",
] as const satisfies readonly EvidenceCouncilFactId[];
const QUESTION_IDS = [
  "confirm_recipient",
  "confirm_amount",
  "confirm_purpose",
  "provide_clearer_evidence",
] as const satisfies readonly EvidenceCouncilQuestionId[];
export const EVIDENCE_COUNCIL_CREATED_FRESHNESS_MS = 60_000;

const CandidateFactSchema = z.strictObject({
  id: EvidenceCouncilFactIdSchema,
  text: EvidenceCouncilTextSchema,
  occurrence: z.number().int().min(1).max(20),
});

export const EvidenceCouncilCandidateSchema = z
  .strictObject({
    facts: z.array(CandidateFactSchema).max(5),
    questionIds: z.array(EvidenceCouncilQuestionIdSchema).max(4),
    confidence: z.number().finite().min(0).max(1),
    uncertain: z.boolean(),
  })
  .superRefine((candidate, context) => {
    if (new Set(candidate.facts.map((fact) => fact.id)).size !== candidate.facts.length) {
      context.addIssue({ code: "custom", path: ["facts"], message: "Fact ids must be unique." });
    }
    if (new Set(candidate.questionIds).size !== candidate.questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["questionIds"],
        message: "Question ids must be unique.",
      });
    }
  });
export type EvidenceCouncilCandidate = z.infer<typeof EvidenceCouncilCandidateSchema>;

const ManifestSchema = z.strictObject({
  evidenceText: EvidenceCouncilTextSchema,
  factIds: z.tuple([
    z.literal("recipient"),
    z.literal("amount"),
    z.literal("purpose"),
    z.literal("fulfillment"),
    z.literal("reference"),
  ]),
  questionIds: z.tuple([
    z.literal("confirm_recipient"),
    z.literal("confirm_amount"),
    z.literal("confirm_purpose"),
    z.literal("provide_clearer_evidence"),
  ]),
});
type EvidenceCouncilManifest = z.infer<typeof ManifestSchema>;

const InputSchema = z
  .strictObject({
    prompt: EvidenceCouncilTextSchema,
    localeHint: z.string().min(1).max(16),
    manifest: ManifestSchema,
  })
  .refine((input) => input.prompt === input.manifest.evidenceText, {
    message: "Prompt must match evidence text.",
  });
type EvidenceCouncilRouterInput = z.infer<typeof InputSchema>;

function exactMatchStarts(source: string[], evidence: string[]): number[] {
  const starts: number[] = [];
  for (let start = 0; start <= source.length - evidence.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < evidence.length; offset += 1) {
      if (source[start + offset] !== evidence[offset]) {
        match = false;
        break;
      }
    }
    if (match) starts.push(start);
  }
  return starts;
}

export function resolveEvidenceCouncilCandidate(
  candidate: EvidenceCouncilCandidate,
  evidenceText: string,
): EvidenceCouncilSpan[] {
  const parsed = EvidenceCouncilCandidateSchema.parse(candidate);
  const source = Array.from(EvidenceCouncilTextSchema.parse(evidenceText));
  return parsed.facts.map((fact) => {
    const evidence = Array.from(fact.text);
    const start = exactMatchStarts(source, evidence)[fact.occurrence - 1];
    if (start === undefined) {
      throw new Error(`Evidence occurrence does not exist: ${fact.id}`);
    }
    return { id: fact.id, start, end: start + evidence.length, text: fact.text };
  });
}

function validateCandidateAgainstManifest(
  candidate: EvidenceCouncilCandidate,
  manifest: EvidenceCouncilManifest,
): void {
  resolveEvidenceCouncilCandidate(candidate, manifest.evidenceText);
}

const SYSTEM_PROMPT = [
  "Return one JSON object only. Never return prose, markdown, a verdict, or transaction instructions.",
  'Use exactly these keys: {"facts","questionIds","confidence","uncertain"}.',
  "Each fact uses exactly {id,text,occurrence}; copy text exactly from evidenceText.",
  "occurrence is the 1-based occurrence of exact text in evidenceText, from 1 to 20.",
  "Use only supplied factIds and questionIds, with each id at most once.",
  "Extract observable text only. Do not decide release, truth, safety, identity, or payment authority.",
  "confidence is 0..1. uncertain is a required boolean.",
].join(" ");

const REPAIR_SYSTEM_PROMPT = [
  "Repair candidate into one strict JSON object only.",
  "Copy exact evidence text; use only supplied ids; add no facts or verdicts.",
].join(" ");

function buildUserMessage(input: EvidenceCouncilRouterInput): string {
  return JSON.stringify({
    task: "locate_payment_evidence_fields",
    evidenceText: input.prompt,
    localeHint: input.localeHint,
    factIds: input.manifest.factIds,
    questionIds: input.manifest.questionIds,
  });
}

function buildRepairUserMessage(
  invalidOutput: string,
  manifest: EvidenceCouncilManifest,
): string {
  return JSON.stringify({
    task: "repair_payment_evidence_candidate",
    evidenceText: manifest.evidenceText,
    factIds: manifest.factIds,
    questionIds: manifest.questionIds,
    invalidOutput,
  });
}

const evidenceCouncilSpec: GonkaDomainSpec<
  EvidenceCouncilRouterInput,
  EvidenceCouncilManifest,
  EvidenceCouncilCandidate
> = {
  manifestSchema: ManifestSchema,
  inputSchema: InputSchema,
  candidateSchema: EvidenceCouncilCandidateSchema,
  systemPrompt: SYSTEM_PROMPT,
  repairSystemPrompt: REPAIR_SYSTEM_PROMPT,
  buildUserMessage,
  getManifest: (input) => input.manifest,
  validateCandidateAgainstManifest,
  buildRepairUserMessage,
  candidateKeyHint: "facts",
};

export interface GonkaEvidenceCouncilRouter {
  run(
    input: EvidenceCouncilRouterInput,
  ): Promise<GonkaRunResultGeneric<EvidenceCouncilCandidate>>;
}

export function createEvidenceCouncilManifest(
  evidenceText: string,
): EvidenceCouncilManifest {
  return ManifestSchema.parse({
    evidenceText,
    factIds: FACT_IDS,
    questionIds: QUESTION_IDS,
  });
}

export function createGonkaEvidenceCouncilRouter(
  config: GonkaAdapterConfig,
  dependencies: GonkaAdapterDependencies = {},
): GonkaEvidenceCouncilRouter {
  const router: GonkaStructuredRouter<
    EvidenceCouncilRouterInput,
    EvidenceCouncilCandidate
  > = createGonkaStructuredRouter(evidenceCouncilSpec, config, dependencies);
  return { run: (input) => router.run(input) };
}

export interface EvidenceCouncilModelReview {
  candidate: EvidenceCouncilCandidate;
  metadata: GonkaResponseMetadata;
}

export interface EvidenceCouncilContext {
  evidenceText: string;
  recipient: string;
  purpose: string | null;
  youPayMinor: string;
  familyReceivesMinor: string;
  amountMicro: string;
  deadlineMs: number;
  createdDigest: string;
  escrowObjectId: string;
  createdCheckedAt: string;
  assessedAtMs: number;
}

export interface AggregateEvidenceCouncilInput {
  context: EvidenceCouncilContext;
  first: EvidenceCouncilModelReview | null;
  second: EvidenceCouncilModelReview | null;
}

interface ValidReview {
  provenance: EvidenceCouncilProvenance;
  spans: EvidenceCouncilSpan[];
  questionIds: EvidenceCouncilQuestionId[];
}

function validReview(
  review: EvidenceCouncilModelReview | null,
  reviewer: EvidenceCouncilProvenance["reviewer"],
  evidenceText: string,
): ValidReview | null {
  if (review === null) return null;
  const candidate = EvidenceCouncilCandidateSchema.safeParse(review.candidate);
  if (!candidate.success) return null;
  if (
    candidate.data.confidence < EVIDENCE_COUNCIL_MIN_CONFIDENCE ||
    candidate.data.uncertain
  ) {
    return null;
  }
  const provenance = z
    .strictObject({
      reviewer: z.enum(["review_a", "review_b"]),
      requestId: z.string().min(1).max(120),
      responseModel: z.string().min(1).max(120),
    })
    .safeParse({
      reviewer,
      requestId: review.metadata.gonkaRequestId,
      responseModel: review.metadata.responseModel,
    });
  if (!provenance.success) return null;
  try {
    return {
      provenance: provenance.data,
      spans: resolveEvidenceCouncilCandidate(candidate.data, evidenceText),
      questionIds: candidate.data.questionIds,
    };
  } catch {
    return null;
  }
}

function searchable(value: string): string {
  return ` ${value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

function containsPhrase(source: string, expected: string): boolean {
  const phrase = searchable(expected).trim();
  return phrase.length > 0 && searchable(source).includes(` ${phrase} `);
}

function parseMinorAmount(raw: string): bigint | null {
  const value = raw.replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  try {
    return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  } catch {
    return null;
  }
}

function containsBoundAmount(
  evidenceText: string,
  youPayMinor: string,
  familyReceivesMinor: string,
): boolean {
  const pattern = /\b(?:(MYR|PHP)\s*([0-9][0-9,]*(?:\.\d{1,2})?)|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(MYR|PHP))\b/giu;
  for (const match of evidenceText.matchAll(pattern)) {
    const currency = (match[1] ?? match[4])?.toUpperCase();
    const amount = parseMinorAmount(match[2] ?? match[3] ?? "");
    if (
      (currency === "MYR" && amount === BigInt(youPayMinor)) ||
      (currency === "PHP" && amount === BigInt(familyReceivesMinor))
    ) {
      return true;
    }
  }
  return false;
}

export function evaluateEvidenceCouncilChecks(
  context: Pick<
    EvidenceCouncilContext,
    "evidenceText" | "recipient" | "purpose" | "youPayMinor" | "familyReceivesMinor"
  >,
): EvidenceCouncilChecks {
  return [
    {
      id: "recipient",
      status: containsPhrase(context.evidenceText, context.recipient) ? "matched" : "missing",
    },
    {
      id: "amount",
      status: containsBoundAmount(
        context.evidenceText,
        context.youPayMinor,
        context.familyReceivesMinor,
      )
        ? "matched"
        : "missing",
    },
    {
      id: "purpose",
      status:
        context.purpose === null
          ? "not_required"
          : containsPhrase(context.evidenceText, context.purpose)
            ? "matched"
            : "missing",
    },
  ];
}

function spanMap(review: ValidReview): Map<EvidenceCouncilFactId, EvidenceCouncilSpan> {
  return new Map(review.spans.map((span) => [span.id, span]));
}

function sameSpan(first: EvidenceCouncilSpan, second: EvidenceCouncilSpan): boolean {
  return (
    first.id === second.id &&
    first.start === second.start &&
    first.end === second.end &&
    first.text === second.text
  );
}

function orderedQuestions(
  requested: Iterable<EvidenceCouncilQuestionId>,
  requireOne = false,
): EvidenceCouncilQuestionId[] {
  const set = new Set(requested);
  const ordered = QUESTION_IDS.filter((id) => set.has(id));
  return ordered.length > 0 || !requireOne ? ordered : ["provide_clearer_evidence"];
}

function digest(value: unknown): `0x${string}` {
  return toHex(blake2b256(new TextEncoder().encode(JSON.stringify(value))));
}

function buildArtifact(input: {
  context: EvidenceCouncilContext;
  checks: EvidenceCouncilChecks;
  corroboratedFacts: EvidenceCouncilArtifact["corroboratedFacts"];
  disputedFacts: EvidenceCouncilArtifact["disputedFacts"];
  questionIds: EvidenceCouncilQuestionId[];
  reviews: [EvidenceCouncilProvenance, EvidenceCouncilProvenance];
}): EvidenceCouncilArtifact {
  const artifactWithoutDigest = {
    version: EVIDENCE_COUNCIL_ARTIFACT_VERSION,
    advisoryOnly: true as const,
    evidenceTextDigest: digest(input.context.evidenceText),
    createdDigest: input.context.createdDigest,
    escrowObjectId: input.context.escrowObjectId,
    recipient: input.context.recipient,
    purpose: input.context.purpose,
    youPayMinor: input.context.youPayMinor,
    familyReceivesMinor: input.context.familyReceivesMinor,
    amountMicro: input.context.amountMicro,
    deadlineMs: input.context.deadlineMs,
    createdCheckedAt: input.context.createdCheckedAt,
    assessedAt: new Date(input.context.assessedAtMs).toISOString(),
    checks: input.checks,
    corroboratedFacts: input.corroboratedFacts,
    disputedFacts: input.disputedFacts,
    questionIds: input.questionIds,
    reviews: input.reviews,
  };
  return EvidenceCouncilArtifactSchema.parse({
    ...artifactWithoutDigest,
    artifactDigest: computeEvidenceCouncilArtifactDigest(artifactWithoutDigest),
  });
}

function questionForCheck(id: EvidenceCouncilChecks[number]["id"]): EvidenceCouncilQuestionId {
  if (id === "recipient") return "confirm_recipient";
  if (id === "amount") return "confirm_amount";
  return "confirm_purpose";
}

export function aggregateEvidenceCouncil(
  input: AggregateEvidenceCouncilInput,
): EvidenceCouncilResponse {
  const context = input.context;
  if (
    !Number.isSafeInteger(context.assessedAtMs) ||
    context.assessedAtMs < 0 ||
    context.assessedAtMs > context.deadlineMs
  ) {
    return { kind: "rejected", advisoryOnly: true, reason: "deadline_passed" };
  }
  const checkedAtMs = Date.parse(context.createdCheckedAt);
  if (
    !Number.isFinite(checkedAtMs) ||
    checkedAtMs > context.assessedAtMs ||
    context.assessedAtMs - checkedAtMs > EVIDENCE_COUNCIL_CREATED_FRESHNESS_MS
  ) {
    return { kind: "rejected", advisoryOnly: true, reason: "created_not_verified" };
  }

  const first = validReview(input.first, "review_a", context.evidenceText);
  const second = validReview(input.second, "review_b", context.evidenceText);
  if (first === null && second === null) {
    return { kind: "unavailable", advisoryOnly: true, reason: "provider_error" };
  }
  if (
    first === null ||
    second === null ||
    first.provenance.responseModel === second.provenance.responseModel ||
    first.provenance.requestId === second.provenance.requestId
  ) {
    const questions = orderedQuestions(
      (first ?? second)?.questionIds ?? ["provide_clearer_evidence"],
      true,
    );
    return {
      kind: "questions_needed",
      advisoryOnly: true,
      reason: "partial_review",
      artifact: null,
      questionIds: questions,
    };
  }

  const firstFacts = spanMap(first);
  const secondFacts = spanMap(second);
  const corroboratedFacts: EvidenceCouncilArtifact["corroboratedFacts"] = [];
  const disputedFacts: EvidenceCouncilArtifact["disputedFacts"] = [];
  for (const id of FACT_IDS) {
    const a = firstFacts.get(id);
    const b = secondFacts.get(id);
    if (a && b && sameSpan(a, b)) {
      corroboratedFacts.push({ id, evidence: [a, b] });
    } else if (a || b) {
      disputedFacts.push({ id, evidence: [a, b].filter(Boolean) as EvidenceCouncilSpan[] });
    }
  }

  const checks = evaluateEvidenceCouncilChecks(context);
  const missingChecks = checks.filter((check) => check.status === "missing");
  const requiredFacts = context.purpose === null
    ? (["recipient", "amount"] as const)
    : (["recipient", "amount", "purpose"] as const);
  const corroboratedIds = new Set(corroboratedFacts.map((fact) => fact.id));
  const missingCorroboration = requiredFacts.some((id) => !corroboratedIds.has(id));
  const requestedQuestions = [
    ...first.questionIds,
    ...second.questionIds,
    ...missingChecks.map((check) => questionForCheck(check.id)),
    ...(disputedFacts.length > 0 || missingCorroboration
      ? (["provide_clearer_evidence"] as const)
      : []),
  ];
  const questionIds = orderedQuestions(requestedQuestions);
  const artifact = buildArtifact({
    context,
    checks,
    corroboratedFacts,
    disputedFacts,
    questionIds,
    reviews: [first.provenance, second.provenance],
  });

  if (disputedFacts.length > 0) {
    return { kind: "disputed", advisoryOnly: true, artifact, questionIds };
  }
  if (missingChecks.length > 0) {
    return {
      kind: "questions_needed",
      advisoryOnly: true,
      reason: "deterministic_mismatch",
      artifact,
      questionIds,
    };
  }
  if (missingCorroboration) {
    return {
      kind: "questions_needed",
      advisoryOnly: true,
      reason: "missing_corroboration",
      artifact,
      questionIds,
    };
  }
  return EvidenceCouncilResponseSchema.parse({
    kind: "ready_for_human_review",
    advisoryOnly: true,
    artifact,
  });
}
