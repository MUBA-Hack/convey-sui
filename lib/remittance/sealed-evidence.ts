import { z } from "zod";

export const SEALED_EVIDENCE_SCHEMA_VERSION = "convey.sealed-evidence.v1";
export const WALRUS_TESTNET_PUBLISHER =
  "https://publisher.walrus-testnet.walrus.space";
export const WALRUS_TESTNET_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";
export const SEAL_TESTNET_KEY_SERVER_IDS = Object.freeze([
  "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
  "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
] as const);
export const SEALED_EVIDENCE_THRESHOLD = 2;

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).max(66);
const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const SealIdSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const BlobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const SealedEvidenceStoredSchema = z
  .strictObject({
    kind: z.literal("stored"),
    schemaVersion: z.literal(SEALED_EVIDENCE_SCHEMA_VERSION),
    packageId: AddressSchema,
    sealIdHex: SealIdSchema,
    walrusBlobId: BlobIdSchema,
    walrusBlobObjectId: AddressSchema.optional(),
    walrusEndEpoch: z.number().int().safe().nonnegative(),
    walrusUrl: z.string().url().max(512),
    ciphertextDigestHex: DigestSchema,
    plaintextDigestHex: DigestSchema,
    threshold: z.literal(SEALED_EVIDENCE_THRESHOLD),
    keyServerObjectIds: z.tuple([
      z.literal(SEAL_TESTNET_KEY_SERVER_IDS[0]),
      z.literal(SEAL_TESTNET_KEY_SERVER_IDS[1]),
    ]),
  })
  .superRefine((value, ctx) => {
    const expectedUrl = `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${value.walrusBlobId}`;
    if (value.walrusUrl !== expectedUrl) {
      ctx.addIssue({ code: "custom", path: ["walrusUrl"], message: "Blob URL mismatch" });
    }
  });

export type SealedEvidenceStored = z.infer<typeof SealedEvidenceStoredSchema>;
