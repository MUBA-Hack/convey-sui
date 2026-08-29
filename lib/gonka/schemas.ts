/**
 * Strict Zod schemas for the GonkaRouter commerce intent router.
 *
 * The model is only allowed to emit fields that map to a deterministic
 * downstream validation step. No transaction command, recipient, digest, or
 * signing/confirmation authority fields exist on the output schema — the
 * route layer must re-resolve every candidate id against the canonical
 * catalog before checkout. Extra fields are rejected (fail closed).
 */

import { z } from "zod";

export const MAX_PROMPT_BYTES = 2_000;
export const MAX_LOCALE_BYTES = 32;
export const MAX_CATALOG_MERCHANTS = 64;
export const MAX_CATALOG_ITEMS = 256;
export const MAX_ID_BYTES = 128;
export const MAX_NAME_BYTES = 256;
export const MAX_LANGUAGE_BYTES = 32;
export const MAX_EXPLANATION_BYTES = 1_000;
export const MAX_QUANTITY = 100;
export const MAX_SPEND_SUI_BYTES = 32;

const byteLengthAtMost =
  (limit: number) =>
  (value: string): boolean =>
    new TextEncoder().encode(value).byteLength <= limit;

const boundedId = z
  .string()
  .min(1)
  .refine(byteLengthAtMost(MAX_ID_BYTES), `id exceeds ${MAX_ID_BYTES} bytes`);

const boundedName = z
  .string()
  .min(1)
  .refine(byteLengthAtMost(MAX_NAME_BYTES), `name exceeds ${MAX_NAME_BYTES} bytes`);

const catalogItemRefSchema = z.strictObject({
  id: boundedId,
  name: boundedName,
  priceSui: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_SPEND_SUI_BYTES), `priceSui exceeds ${MAX_SPEND_SUI_BYTES} bytes`),
});

const catalogMerchantRefSchema = z.strictObject({
  id: boundedId,
  name: boundedName,
  itemIds: z.array(boundedId).min(1).max(MAX_CATALOG_ITEMS),
});

export const gonkaCatalogManifestSchema = z.strictObject({
  merchants: z.array(catalogMerchantRefSchema).min(1).max(MAX_CATALOG_MERCHANTS),
  items: z.array(catalogItemRefSchema).min(1).max(MAX_CATALOG_ITEMS),
});

export const gonkaIntentInputSchema = z.strictObject({
  prompt: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_PROMPT_BYTES), `prompt exceeds ${MAX_PROMPT_BYTES} bytes`),
  localeHint: z
    .string()
    .min(1)
    .refine(byteLengthAtMost(MAX_LOCALE_BYTES), `localeHint exceeds ${MAX_LOCALE_BYTES} bytes`),
  catalog: gonkaCatalogManifestSchema,
});

/**
 * Candidate intent the model is allowed to emit. EXACT keys, no extras.
 *
 * Forbidden authority fields (recipient, transactionBytes, digest, signature,
 * gas, etc.) are absent by construction; the strict object rejects them.
 */
export const gonkaIntentCandidateSchema = z.strictObject({
  itemId: boundedId,
  itemName: boundedName,
  merchantId: boundedId,
  merchantName: boundedName,
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  maxSpendSui: z
    .string()
    .min(1)
    .refine(
      byteLengthAtMost(MAX_SPEND_SUI_BYTES),
      `maxSpendSui exceeds ${MAX_SPEND_SUI_BYTES} bytes`,
    ),
  detectedLanguage: z
    .string()
    .min(1)
    .refine(
      byteLengthAtMost(MAX_LANGUAGE_BYTES),
      `detectedLanguage exceeds ${MAX_LANGUAGE_BYTES} bytes`,
    ),
  explanation: z
    .string()
    .min(1)
    .refine(
      byteLengthAtMost(MAX_EXPLANATION_BYTES),
      `explanation exceeds ${MAX_EXPLANATION_BYTES} bytes`,
    ),
  confidence: z.number().min(0).max(1),
});

export type GonkaIntentCandidateParsed = z.infer<typeof gonkaIntentCandidateSchema>;

/**
 * Reject candidates whose item/merchant ids were not present in the frozen
 * manifest. The model must never invent catalog entries.
 */
export function validateCandidateAgainstManifest(
  candidate: GonkaIntentCandidateParsed,
  manifest: z.infer<typeof gonkaCatalogManifestSchema>,
): void {
  const itemIds = new Set(manifest.items.map((item) => item.id));
  const merchantIds = new Set(manifest.merchants.map((merchant) => merchant.id));
  if (!itemIds.has(candidate.itemId)) {
    throw new Error(`candidate itemId absent from manifest: ${candidate.itemId}`);
  }
  if (!merchantIds.has(candidate.merchantId)) {
    throw new Error(`candidate merchantId absent from manifest: ${candidate.merchantId}`);
  }
  const merchant = manifest.merchants.find((m) => m.id === candidate.merchantId);
  if (merchant && !merchant.itemIds.includes(candidate.itemId)) {
    throw new Error(
      `candidate itemId ${candidate.itemId} not sold by merchant ${candidate.merchantId}`,
    );
  }
}
