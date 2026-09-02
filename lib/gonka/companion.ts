import { z } from "zod";
import { gonkaConfigFromEnv } from "./adapter";
import { createGonkaStructuredRouter } from "./core";
import type { GonkaAdapterConfig } from "./types";
import { CompanionCandidateSchema, CompanionInputSchema } from "@/lib/companion/contracts";
import type { CompanionCandidate } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";
import { CompanionMemorySchema } from "@/lib/companion/memory";

export interface CompanionManifest {
  contacts: Array<{
    id: string;
    displayName: string;
    aliases: string[];
    relationshipLabel: string | null;
    confirmation: "inferred" | "confirmed";
  }>;
}

export function buildCompanionManifest(memory: CompanionMemory): CompanionManifest {
  const safe = CompanionMemorySchema.parse(memory);
  return {
    contacts: safe.contacts.map((contact) => ({
      id: contact.id,
      displayName: contact.displayName,
      aliases: contact.aliases,
      relationshipLabel: contact.relationshipLabel,
      confirmation: contact.confirmation,
    })),
  };
}

const CompanionManifestSchema = z.strictObject({
  contacts: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        displayName: z.string().min(1).max(96),
        aliases: z.array(z.string().min(1).max(48)).max(5),
        relationshipLabel: z.string().min(1).max(64).nullable(),
        confirmation: z.enum(["inferred", "confirmed"]),
      }),
    )
    .max(20),
});

const CompanionRouterInputSchema = CompanionInputSchema.extend({
  prompt: z.string().min(1).max(1_280),
});

function buildSystemPrompt(): string {
  return [
    "You are Convey's companion brain.",
    "Only choose a tool response, never execute a payment.",
    "Never invent contacts, amounts, assets, or authority.",
    "Prefer clarification when memory is missing or the contact is ambiguous.",
    "Use only the manifest contact ids and labels shown in the prompt.",
    "Never emit raw wallet addresses, keys, or transaction details.",
  ].join(" ");
}

function buildRepairPrompt(invalid: string, manifest: CompanionManifest): string {
  return JSON.stringify({
    invalid,
    manifest,
  });
}

type CompanionRouterInput = z.infer<typeof CompanionRouterInputSchema>;

export function createGonkaCompanionRouter(config: GonkaAdapterConfig) {
  return createGonkaStructuredRouter<CompanionRouterInput, CompanionManifest, CompanionCandidate>(
    {
      manifestSchema: CompanionManifestSchema,
      inputSchema: CompanionRouterInputSchema,
      candidateSchema: CompanionCandidateSchema,
      systemPrompt: buildSystemPrompt(),
      repairSystemPrompt: `${buildSystemPrompt()} Return only one valid JSON object.`,
      buildUserMessage(input: CompanionRouterInput) {
        return JSON.stringify({
          prompt: input.prompt,
          localeHint: input.localeHint,
          memory: buildCompanionManifest(input.memory),
        });
      },
      getManifest(input: CompanionRouterInput) {
        return buildCompanionManifest(input.memory);
      },
      validateCandidateAgainstManifest(candidate: CompanionCandidate, manifest: CompanionManifest) {
        if (candidate.contactId === null) return;
        if (!manifest.contacts.some((contact) => contact.id === candidate.contactId)) {
          throw new Error("candidate contactId missing from manifest");
        }
      },
      buildRepairUserMessage(invalidContent: string, manifest: CompanionManifest) {
        return buildRepairPrompt(invalidContent.slice(0, 4_000), manifest);
      },
      candidateKeyHint: "toolId",
    },
    config,
  );
}

export function resolveCompanionGonkaConfig(env: NodeJS.ProcessEnv) {
  return gonkaConfigFromEnv(env);
}
