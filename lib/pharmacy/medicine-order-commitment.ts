/**
 * Medicine pickup ORDER commitment adapter.
 *
 * Pure, deterministic, client-safe adapter that lets the UI prepare a
 * privacy-minimal INITIAL ORDER commitment from an already-resolved
 * `PharmacySite` and a user-entered order reference. This is an initial order
 * commitment only — it is NOT final pickup evidence, NOT settlement, NOT
 * medical verification, NOT prescription validation, and NOT release
 * authorization.
 *
 * PRIVACY BOUNDARY: the raw beneficiary reference and raw order reference never
 * enter the manifest or its canonical encoding. Each is hashed separately with
 * the shared `blake2b256`/`toHex` helper. No health condition, medicine/drug
 * name, prescription body, person name, exact location, photo bytes/URL,
 * secret, key, or wallet data is accepted or stored. Extra input fields fail
 * closed.
 *
 * DETERMINISM: a bounded `missionId` is derived from stable non-secret
 * commitment material (site id + beneficiary digest + order digest + window).
 * Same input always yields the same mission id and manifest digest.
 *
 * No React, fetch, env, storage, Date.now, randomness, or new dependency. The
 * caller supplies the window. This adapter does NOT call
 * `evaluateCustodyEvidence`: with only a single `pharmacy_order` artifact the
 * custody evaluator would return `questions_needed`, and this adapter prepares
 * the initial commitment only. It also does NOT import the protected-transfer
 * template modules, because protected-transfer already imports
 * custody-evidence and a back-import would create a cycle.
 *
 * PROVENANCE BOUNDARY: the `provenance` carried in the summary is ADAPTER
 * PROVENANCE copied verbatim from the resolved `PharmacySite`. It describes
 * which network adapter produced the site. It is NOT a partnership claim, NOT
 * authenticity, NOT medical verification, and NOT live-network status. A
 * `reference` provenance can demonstrate software behavior only.
 */

import { z } from "zod";
import { blake2b256, toHex } from "../protocol/hash";
import {
  CUSTODY_EVIDENCE_SCHEMA_VERSION,
  CustodyManifestPayloadSchema,
  CustodyManifestSchema,
  computeCustodyManifestDigest,
  type CustodyManifest,
} from "./custody-evidence";
import {
  OrderRefSchema,
  PharmacySiteSchema,
  type CityLabel,
  type CountryCode,
  type OrderRef,
  type PharmacyId,
  type PharmacyProvenanceKind,
} from "./network";

// ---------------------------------------------------------------------------
// Input schema — strict, bounded, no passthrough
// ---------------------------------------------------------------------------

/**
 * Raw beneficiary reference. Canonical `R-` + exactly 8 uppercase alphanumerics.
 * The raw value is hashed before it enters any manifest; it never appears in
 * the canonical encoding.
 */
const BeneficiaryRefSchema = z.string().regex(/^R-[A-Z0-9]{8}$/);

/** Safe integer millisecond timestamp since the Unix epoch, non-negative. */
const TimestampMsSchema = z.number().int().safe().min(0);

/**
 * Strict input for an initial Medicine pickup order commitment. Strict object:
 * any extra top-level field (secret, key, URL, wallet data, drug name,
 * prescription body, person name, exact location, photo bytes/URL) is rejected.
 */
export const MedicineOrderCommitmentInputSchema = z
  .strictObject({
    site: PharmacySiteSchema,
    beneficiaryRef: BeneficiaryRefSchema,
    orderRef: OrderRefSchema,
    startMs: TimestampMsSchema,
    endMs: TimestampMsSchema,
  })
  .superRefine((input, context) => {
    if (input.endMs < input.startMs) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "endMs must not precede startMs.",
      });
    }
  });

export type MedicineOrderCommitmentInput = z.infer<
  typeof MedicineOrderCommitmentInputSchema
>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Compact display summary needed by the UI. The `orderRef` is the user-facing
 * reference and is intentionally retained here so the UI can show what the
 * user typed. The raw beneficiary reference is NEVER retained anywhere.
 *
 * `provenance` is ADAPTER PROVENANCE copied from the resolved site. It is not
 * a partnership claim, not authenticity, not medical verification, and not
 * live-network status.
 */
export interface MedicineOrderCommitmentSummary {
  readonly pharmacyId: PharmacyId;
  readonly pharmacyDisplayName: string;
  readonly coverage: { readonly city: CityLabel; readonly country: CountryCode };
  readonly orderRef: OrderRef;
  readonly provenance: {
    readonly kind: PharmacyProvenanceKind;
    readonly sourceLabel: string;
  };
}

/**
 * Initial Medicine pickup order commitment. Contains one fully strict
 * `CustodyManifest` with a single `pharmacy_order` artifact plus a compact UI
 * summary. Both are deeply frozen. This is an initial commitment only — it
 * carries no verified/approved/released status and is not pickup evidence.
 */
export interface MedicineOrderCommitment {
  readonly manifest: CustodyManifest;
  readonly summary: MedicineOrderCommitmentSummary;
}

export type MedicineOrderCommitmentReason = "malformed_input";

export type MedicineOrderCommitmentResult =
  | { ok: true; commitment: MedicineOrderCommitment }
  | { ok: false; reason: MedicineOrderCommitmentReason };

// ---------------------------------------------------------------------------
// Deterministic mission id derivation
// ---------------------------------------------------------------------------

/**
 * Bounded deterministic mission id derived from stable non-secret commitment
 * material. The seed uses only already-hashed digests and public site/window
 * data, so no raw beneficiary/order reference enters the id. Same input always
 * yields the same id. The hex suffix is truncated so the full id stays within
 * the custody-evidence `BoundedIdSchema` (<= 64 alphanumerics/hyphens).
 */
function deriveMissionId(seed: {
  pharmacyId: string;
  beneficiaryRefDigest: string;
  orderRefDigest: string;
  startMs: number;
  endMs: number;
}): string {
  const canonical = JSON.stringify({
    pharmacyId: seed.pharmacyId,
    beneficiaryRefDigest: seed.beneficiaryRefDigest,
    orderRefDigest: seed.orderRefDigest,
    startMs: seed.startMs,
    endMs: seed.endMs,
  });
  const hex = toHex(blake2b256(new TextEncoder().encode(canonical)));
  // `mission-` (8 chars) + 48 hex chars = 56 chars, well under the 64 bound.
  return `mission-${hex.slice(2, 50)}`;
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

/** Recursively `Object.freeze` a plain object/array tree. No-op on primitives. */
function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Prepare a privacy-minimal initial Medicine pickup ORDER commitment from an
 * already-resolved `PharmacySite` and a user-entered order reference. Pure,
 * deterministic, no side effects. Returns a fully strict `CustodyManifest`
 * with one `pharmacy_order` artifact plus a compact UI summary. Malformed
 * input, extra fields, invalid windows, or invalid references fail closed.
 */
export function prepareMedicineOrderCommitment(
  input: unknown,
): MedicineOrderCommitmentResult {
  const parsed = MedicineOrderCommitmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_input" };
  }
  const { site, beneficiaryRef, orderRef, startMs, endMs } = parsed.data;

  const encoder = new TextEncoder();
  const beneficiaryRefDigest = toHex(blake2b256(encoder.encode(beneficiaryRef)));
  const orderRefDigest = toHex(blake2b256(encoder.encode(orderRef)));

  const missionId = deriveMissionId({
    pharmacyId: site.id,
    beneficiaryRefDigest,
    orderRefDigest,
    startMs,
    endMs,
  });

  const payload = {
    schemaVersion: CUSTODY_EVIDENCE_SCHEMA_VERSION,
    missionId,
    pharmacyId: site.id,
    beneficiaryRefDigest,
    escrowWindowMs: { startMs, endMs },
    artifacts: [
      {
        kind: "pharmacy_order" as const,
        pharmacyId: site.id,
        orderRefDigest,
      },
    ],
  };

  // Re-validate the payload through the shared custody-evidence owner so the
  // cross-field invariants (unique kinds, pharmacy_id match, window order)
  // hold at this trust boundary too. This is the single policy owner; the
  // adapter does not duplicate its rules.
  const payloadResult = CustodyManifestPayloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    return { ok: false, reason: "malformed_input" };
  }

  const manifestDigest = computeCustodyManifestDigest(payloadResult.data);
  const manifestCandidate = { ...payloadResult.data, manifestDigest };

  // Final strict validation: confirms the digest binds to the canonical
  // payload and that no extra field slipped in. safeParse never throws.
  const manifestResult = CustodyManifestSchema.safeParse(manifestCandidate);
  if (!manifestResult.success) {
    return { ok: false, reason: "malformed_input" };
  }

  const summary: MedicineOrderCommitmentSummary = {
    pharmacyId: site.id,
    pharmacyDisplayName: site.displayName,
    coverage: { city: site.coverage.city, country: site.coverage.country },
    orderRef,
    provenance: {
      kind: site.provenance.kind,
      sourceLabel: site.provenance.sourceLabel,
    },
  };

  const commitment: MedicineOrderCommitment = deepFreeze({
    manifest: manifestResult.data as CustodyManifest,
    summary,
  });

  return { ok: true, commitment };
}
