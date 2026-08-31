/**
 * Pharmacy pickup custody-evidence commitments.
 *
 * Pure, client-safe, deterministic module that binds a Medicine pickup mission
 * to a small set of custody artifacts via a canonical fixed-order JSON encoding
 * hashed with the shared `blake2b256` helper. It evaluates CUSTODY COHERENCE
 * only — never medicine authenticity, prescription validity, or medical
 * suitability. The evaluator outputs `ready_for_human_review`,
 * `questions_needed`, or `rejected`; it never outputs `verified`, `authentic`,
 * `safe`, `approved`, or `released`. Models may later point at this evidence
 * but cannot change the evaluator result or authorize release.
 *
 * PRIVACY BOUNDARY: no health condition, drug name, prescription body, exact
 * geolocation, photo bytes, person name, URL, secret, or wallet key is stored.
 * Photo and witness artifacts carry only a blake2b256 digest; pickup carries
 * only a coarse region code plus a safe integer timestamp.
 *
 * No React, fetch, env, secret, HMAC, RPC, signing, submission, or storage.
 */

import { z } from "zod";
import { blake2b256, toHex } from "../protocol/hash";

/** Schema/domain version bound into every manifest digest. */
export const CUSTODY_EVIDENCE_SCHEMA_VERSION =
  "convey.pharmacy.custody-evidence.v1" as const;

/**
 * Strict lowercase `0x` + 64 hex blake2b256 digest string. Exported as the
 * single canonical digest schema so the Protected Transfer truth chain can
 * bind a custody manifest digest without duplicating the regex.
 */
export const CustodyManifestDigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const DigestHexSchema = CustodyManifestDigestSchema;

/** Allowed witness roles. Custody roles only — never medical roles. */
export const CUSTODY_WITNESS_ROLES = [
  "carrier",
  "pharmacy_staff",
  "beneficiary_representative",
] as const;
export type CustodyWitnessRole = (typeof CUSTODY_WITNESS_ROLES)[number];
const WitnessRoleSchema = z.enum(CUSTODY_WITNESS_ROLES);

/** Coarse region code: 1–32 ASCII alphanumerics, hyphens, or underscores. */
const RegionCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/)
  .max(32);

/** Safe integer millisecond timestamp since the Unix epoch, non-negative. */
const TimestampMsSchema = z
  .number()
  .int()
  .safe()
  .min(0);

/** Bounded mission/pharmacy identifier: 1–64 ASCII alphanumerics/hyphens/underscores. */
const BoundedIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .max(64);

/** All four custody artifact kinds. */
export const CUSTODY_ARTIFACT_KINDS = [
  "pharmacy_order",
  "package_photo",
  "pickup_event",
  "witness_statement",
] as const;
export type CustodyArtifactKind = (typeof CUSTODY_ARTIFACT_KINDS)[number];

const PharmacyOrderArtifactSchema = z.strictObject({
  kind: z.literal("pharmacy_order"),
  /** Exact pharmacy identifier; must equal the manifest `pharmacyId`. */
  pharmacyId: BoundedIdSchema,
  /** blake2b256 digest of the canonical order reference. */
  orderRefDigest: DigestHexSchema,
});

const PackagePhotoArtifactSchema = z.strictObject({
  kind: z.literal("package_photo"),
  /** blake2b256 digest of the package photo. Bytes/URL never stored. */
  photoDigest: DigestHexSchema,
});

const PickupEventArtifactSchema = z.strictObject({
  kind: z.literal("pickup_event"),
  /** Coarse region code only — no exact geolocation. */
  regionCode: RegionCodeSchema,
  /** Safe integer millisecond timestamp; must fall inside the escrow window. */
  timestampMs: TimestampMsSchema,
});

const WitnessStatementArtifactSchema = z.strictObject({
  kind: z.literal("witness_statement"),
  /** Custody role only. */
  role: WitnessRoleSchema,
  /** blake2b256 digest of the statement text. Raw text never stored. */
  textDigest: DigestHexSchema,
});

export const CustodyArtifactSchema = z.discriminatedUnion("kind", [
  PharmacyOrderArtifactSchema,
  PackagePhotoArtifactSchema,
  PickupEventArtifactSchema,
  WitnessStatementArtifactSchema,
]);
export type CustodyArtifact = z.infer<typeof CustodyArtifactSchema>;

const EscrowWindowSchema = z.strictObject({
  startMs: TimestampMsSchema,
  endMs: TimestampMsSchema,
});

/**
 * Strict manifest payload (without the computed digest). Binds the schema
 * version, mission id, exact pharmacy id, beneficiary reference digest, escrow
 * window, and 1–4 unique artifacts. Strict object: any extra top-level field
 * (secret, key, URL, person name, prescription body, etc.) is rejected.
 */
export const CustodyManifestPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(CUSTODY_EVIDENCE_SCHEMA_VERSION),
    missionId: BoundedIdSchema,
    pharmacyId: BoundedIdSchema,
    beneficiaryRefDigest: DigestHexSchema,
    escrowWindowMs: EscrowWindowSchema,
    artifacts: z.array(CustodyArtifactSchema).min(1).max(4),
  })
  .superRefine((payload, context) => {
    if (payload.escrowWindowMs.endMs < payload.escrowWindowMs.startMs) {
      context.addIssue({
        code: "custom",
        path: ["escrowWindowMs"],
        message: "escrow window endMs must not precede startMs.",
      });
    }
    const kinds = payload.artifacts.map((artifact) => artifact.kind);
    if (new Set(kinds).size !== kinds.length) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "artifact kinds must be unique.",
      });
    }
    for (const artifact of payload.artifacts) {
      if (artifact.kind === "pharmacy_order" && artifact.pharmacyId !== payload.pharmacyId) {
        context.addIssue({
          code: "custom",
          path: ["artifacts"],
          message: "pharmacy_order artifact pharmacyId must match the manifest pharmacyId.",
        });
      }
      if (artifact.kind === "pickup_event") {
        const { startMs, endMs } = payload.escrowWindowMs;
        if (artifact.timestampMs < startMs || artifact.timestampMs > endMs) {
          context.addIssue({
            code: "custom",
            path: ["artifacts"],
            message: "pickup_event timestampMs must fall inside the escrow window.",
          });
        }
      }
    }
  });

export type CustodyManifestPayload = z.infer<typeof CustodyManifestPayloadSchema>;

export const CustodyManifestSchema = z
  .strictObject({
    ...CustodyManifestPayloadSchema.shape,
    manifestDigest: DigestHexSchema,
  })
  .superRefine((manifest, context) => {
    const { manifestDigest, ...payload } = manifest;
    // Re-validate the payload portion through the shared payload schema first
    // so cross-field invariants (escrow window, unique kinds, pickup-in-window,
    // pharmacyId match) hold before digest comparison. `safeParse` never
    // throws, so `CustodyManifestSchema.safeParse` cannot throw on a malformed
    // payload — the prior throwing `computeCustodyManifestDigest` path is gone.
    const payloadResult = CustodyManifestPayloadSchema.safeParse(payload);
    if (!payloadResult.success) {
      context.addIssue({
        code: "custom",
        path: ["manifestDigest"],
        message: "manifestDigest cannot be verified against an invalid payload.",
      });
      return;
    }
    const computed = computeCustodyManifestDigest(payloadResult.data);
    if (manifestDigest !== computed) {
      context.addIssue({
        code: "custom",
        path: ["manifestDigest"],
        message: "manifestDigest must match the canonical manifest payload.",
      });
    }
  });
export type CustodyManifest = z.infer<typeof CustodyManifestSchema>;

/**
 * Canonical fixed-order encoding of the manifest payload. Property order is
 * pinned here so reordering object keys at the input boundary produces an
 * identical digest. Artifacts are encoded in their manifest array order with
 * each artifact's own fixed property order.
 */
function canonicalManifestPayload(
  payload: CustodyManifestPayload,
): Record<string, unknown> {
  return {
    schemaVersion: payload.schemaVersion,
    missionId: payload.missionId,
    pharmacyId: payload.pharmacyId,
    beneficiaryRefDigest: payload.beneficiaryRefDigest,
    escrowWindowMs: {
      startMs: payload.escrowWindowMs.startMs,
      endMs: payload.escrowWindowMs.endMs,
    },
    artifacts: payload.artifacts.map((artifact) => {
      switch (artifact.kind) {
        case "pharmacy_order":
          return {
            kind: artifact.kind,
            pharmacyId: artifact.pharmacyId,
            orderRefDigest: artifact.orderRefDigest,
          };
        case "package_photo":
          return {
            kind: artifact.kind,
            photoDigest: artifact.photoDigest,
          };
        case "pickup_event":
          return {
            kind: artifact.kind,
            regionCode: artifact.regionCode,
            timestampMs: artifact.timestampMs,
          };
        case "witness_statement":
          return {
            kind: artifact.kind,
            role: artifact.role,
            textDigest: artifact.textDigest,
          };
        default: {
          // Exhaustiveness guard: a future union kind added without a case
          // here fails closed instead of serializing as `{}`/`null`.
          const _exhaustive: never = artifact;
          throw new Error(`Unhandled custody artifact kind: ${String(_exhaustive)}`);
        }
      }
    }),
  };
}

/**
 * blake2b256 digest of the canonical manifest payload encoding.
 *
 * Trust boundary: the caller MUST pass an already strict-parsed payload
 * (via `CustodyManifestPayloadSchema`). This helper does not re-parse, so the
 * evaluator and the manifest schema share one parse across the same trust
 * boundary instead of validating the same payload twice.
 */
export function computeCustodyManifestDigest(
  payload: Omit<CustodyManifest, "manifestDigest">,
): `0x${string}` {
  return toHex(
    blake2b256(
      new TextEncoder().encode(JSON.stringify(canonicalManifestPayload(payload))),
    ),
  );
}

/**
 * Explicit custody-evidence policy. Required artifact kinds are named
 * explicitly — no implicit 3-of-4 threshold. The policy itself is validated:
 * unknown or duplicate required kinds are rejected.
 */
export interface CustodyEvidencePolicy {
  requiredArtifactKinds: readonly CustodyArtifactKind[];
}

const CustodyEvidencePolicySchema = z
  .strictObject({
    // `.min(1)`: an empty required-artifact list would mark any coherent
    // manifest review-ready without naming any custody artifact, so at least
    // one kind is required. Callers that want "no requirements" must declare
    // the kind(s) they actually rely on.
    requiredArtifactKinds: z.array(z.enum(CUSTODY_ARTIFACT_KINDS)).min(1).max(4),
  })
  .superRefine((policy, context) => {
    if (new Set(policy.requiredArtifactKinds).size !== policy.requiredArtifactKinds.length) {
      context.addIssue({
        code: "custom",
        path: ["requiredArtifactKinds"],
        message: "requiredArtifactKinds must be unique.",
      });
    }
  });

export type CustodyEvidenceResult =
  | { kind: "ready_for_human_review"; manifestDigest: `0x${string}` }
  | {
      /**
       * `manifestDigest` here is only a commitment to the supplied manifest
       * data. It is NOT a receipt, approval, authorization, or evidence that
       * any artifact is authentic, medically valid, or released. Missing
       * required kinds mean human review cannot yet proceed.
       */
      kind: "questions_needed";
      missingArtifactKinds: CustodyArtifactKind[];
      manifestDigest: `0x${string}`;
    }
  | { kind: "rejected"; reason: CustodyEvidenceRejectionReason };

export type CustodyEvidenceRejectionReason =
  | "invalid_manifest"
  | "invalid_policy";

export interface EvaluateCustodyEvidenceInput {
  policy: CustodyEvidencePolicy;
  manifest: Omit<CustodyManifest, "manifestDigest">;
}

/**
 * Pure deterministic custody-coherence evaluator. Strict-parses the manifest
 * payload and policy, then checks that every required artifact kind is present.
 * Missing required -> `questions_needed`. Malformed, mismatched, duplicate,
 * out-of-window, oversized, or forbidden-field input -> `rejected`. Complete
 * and coherent -> `ready_for_human_review`. Never returns `verified`,
 * `authentic`, `safe`, `approved`, or `released`.
 */
export function evaluateCustodyEvidence(
  input: EvaluateCustodyEvidenceInput,
): CustodyEvidenceResult {
  const policy = CustodyEvidencePolicySchema.safeParse(input.policy);
  if (!policy.success) {
    return { kind: "rejected", reason: "invalid_policy" };
  }
  const payload = CustodyManifestPayloadSchema.safeParse(input.manifest);
  if (!payload.success) {
    return { kind: "rejected", reason: "invalid_manifest" };
  }
  const manifestDigest = computeCustodyManifestDigest(payload.data);
  const present = new Set(payload.data.artifacts.map((artifact) => artifact.kind));
  const missing = CUSTODY_ARTIFACT_KINDS.filter(
    (kind) => policy.data.requiredArtifactKinds.includes(kind) && !present.has(kind),
  );
  if (missing.length > 0) {
    return { kind: "questions_needed", missingArtifactKinds: missing, manifestDigest };
  }
  return { kind: "ready_for_human_review", manifestDigest };
}
