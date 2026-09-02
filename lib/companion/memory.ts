import { z } from "zod";

export const COMPANION_MEMORY_VERSION = "convey.companion-memory.v1" as const;

export const CompanionAssetSchema = z.enum(["SUI", "USDC"]);

export const CompanionContactSchema = z.strictObject({
  id: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  aliases: z.array(z.string().min(1).max(48)).max(5),
  relationshipLabel: z.string().min(1).max(64).nullable(),
  address: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  previousAddress: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  confirmation: z.enum(["inferred", "confirmed"]),
  confirmedAt: z.number().int().nonnegative().nullable(),
});

export const CompanionInteractionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
  kind: z.enum(["payment", "split", "mission", "strategy"]),
  summary: z.string().min(1).max(120).nullable(),
  occurredAt: z.number().int().nonnegative(),
});

export const CompanionMemorySchema = z.strictObject({
  version: z.literal(COMPANION_MEMORY_VERSION),
  ownerLabel: z.string().min(1).max(96).nullable().optional(),
  contacts: z.array(CompanionContactSchema).max(20),
  interactions: z.array(CompanionInteractionSchema).max(20),
});

export type CompanionAsset = z.infer<typeof CompanionAssetSchema>;
export type CompanionContact = z.infer<typeof CompanionContactSchema>;
export type CompanionInteraction = z.infer<typeof CompanionInteractionSchema>;
export type CompanionMemory = z.infer<typeof CompanionMemorySchema>;

export const EMPTY_COMPANION_MEMORY: CompanionMemory = {
  version: COMPANION_MEMORY_VERSION,
  ownerLabel: null,
  contacts: [],
  interactions: [],
};

export function normalizeContactKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
