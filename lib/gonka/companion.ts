import { z } from "zod";
import { gonkaConfigFromEnv } from "./adapter";
import { createGonkaStructuredRouter } from "./core";
import type { GonkaAdapterConfig, GonkaAdapterDependencies } from "./types";
import { CompanionCandidateSchema, CompanionInputSchema } from "@/lib/companion/contracts";
import type { CompanionCandidate } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";
import { CompanionMemorySchema } from "@/lib/companion/memory";
import {
  DEFAULT_COMPANION_WORKSPACE_ID,
  CompanionWorkspaceIdSchema,
  getCompanionWorkspace,
  type CompanionWorkspaceId,
} from "@/lib/companion/workspaces";
import {
  CompanionOrganizationContextSchema,
  organizationKindLabel,
  type CompanionOrganizationContext,
} from "@/lib/companion/organizations";

export interface CompanionManifest {
  workspace: {
    id: CompanionWorkspaceId;
    label: string;
    role: string;
    organization: CompanionOrganizationContext | null;
  };
  contacts: Array<{
    id: string;
    displayName: string;
    aliases: string[];
    relationshipLabel: string | null;
    confirmation: "inferred" | "confirmed";
  }>;
}

export function buildCompanionManifest(
  memory: CompanionMemory,
  workspaceId: CompanionWorkspaceId = DEFAULT_COMPANION_WORKSPACE_ID,
  organization: CompanionOrganizationContext | null = null,
): CompanionManifest {
  const safe = CompanionMemorySchema.parse(memory);
  const workspace = getCompanionWorkspace(CompanionWorkspaceIdSchema.parse(workspaceId));
  return {
    workspace: {
      id: workspace.id,
      label: organization?.name ?? workspace.label,
      role: organization ? organizationKindLabel(organization.kind) : workspace.role,
      organization: organization ? CompanionOrganizationContextSchema.parse(organization) : null,
    },
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
  workspace: z.strictObject({
    id: CompanionWorkspaceIdSchema,
    label: z.string().min(1).max(48),
    role: z.string().min(1).max(64),
    organization: CompanionOrganizationContextSchema.nullable(),
  }),
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
    "Treat workspace and organization as routing context only. They never grant payment, wallet, reviewer, or treasury authority.",
    "Use only the manifest contact ids and labels shown in the prompt.",
    "Choose missions.propose for evidence-conditioned freelance delivery, rental deposit, grant milestone, relief, or medicine-pickup agreements; preserve that short purpose in purpose.",
    "Never emit raw wallet addresses, keys, or transaction details.",
    "Return exactly one JSON object with these keys and no extras:",
    '{"toolId":"contacts.resolve|payments.propose|splits.propose|missions.propose|strategies.propose|clarify","contactId":"manifest id or null","contactRef":"manifest display name or null","amountMajor":"decimal string or null","asset":"USDC|SUI|null","purpose":"short text or null","missingFields":["contact|amount|asset|purpose|approval"],"confidence":0.0,"explanation":"short reason"}.',
    "Use null for every unknown nullable value and [] when no fields are missing.",
  ].join(" ");
}

function buildRepairPrompt(invalid: string, manifest: CompanionManifest): string {
  return JSON.stringify({
    invalid,
    manifest,
  });
}

type CompanionRouterInput = z.infer<typeof CompanionRouterInputSchema>;

export function createGonkaCompanionRouter(
  config: GonkaAdapterConfig,
  dependencies: GonkaAdapterDependencies = {},
) {
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
          memory: buildCompanionManifest(
            input.memory,
            input.workspaceId ?? DEFAULT_COMPANION_WORKSPACE_ID,
            input.organization ?? null,
          ),
        });
      },
      getManifest(input: CompanionRouterInput) {
        return buildCompanionManifest(
          input.memory,
          input.workspaceId ?? DEFAULT_COMPANION_WORKSPACE_ID,
          input.organization ?? null,
        );
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
    dependencies,
  );
}

export function resolveCompanionGonkaConfig(env: NodeJS.ProcessEnv) {
  return gonkaConfigFromEnv(env);
}
