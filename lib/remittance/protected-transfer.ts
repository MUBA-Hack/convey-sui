/**
 * Protected Transfer — pure, client-safe, deterministic transaction core.
 *
 * Builds exactly one `protected_transfer::create_escrow<T>` Move call that locks
 * pinned testnet USDC into an escrow controlled by a reviewer and released to a
 * beneficiary. The escrow is bound to a 32-byte blake2b256 commitment over a
 * canonical fixed-order JSON encoding of every bound term.
 *
 * This module contains no React, fetch, environment access, secrets, HMAC,
 * storage, signing, submission, RPC, or fake lifecycle state. It validates every
 * input and fails closed before constructing the transaction. Callers cannot
 * override the module, function, Clock, coin type, product cap, commitment
 * algorithm, or commitment schema version — those are pinned here.
 *
 * PROVENANCE BOUNDARY (read before integrating):
 * This pure builder validates the STRUCTURE of a Protected Transfer execution
 * plan and the PINNED client constants (module/function/Clock/coin/cap/hash/
 * version). It CANNOT prove the plan's PROVENANCE. When the server plan
 * endpoint is configured, product code must only call `buildProtectedTransfer`
 * with a plan returned by that endpoint, never with a plan assembled from loose
 * caller inputs. The endpoint's plan is response-channel provenance only —
 * unsigned and unattested — and this builder cannot prove package deployment,
 * immutability, or on-chain state. This builder must never be exposed as a
 * loose local feature toggle, and the plan must never be described as signed,
 * attested, verified, safe, deployed, or immutable on the strength of this
 * module or the plan endpoint alone — those are evidence claims owned by later
 * layers.
 */

import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { z } from "zod";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET, U64_MAX } from "./constants";
import {
  CanonicalAuthorizationSchema,
  VerifyRejectedSchema,
  type CanonicalAuthorization,
} from "./quote-schema";
import { blake2b256, toHex } from "../protocol/hash";
import { CustodyManifestDigestSchema } from "../pharmacy/custody-evidence";

/** Schema/domain version bound into every commitment. */
export const PROTECTED_TRANSFER_SCHEMA_VERSION = "convey.protected-transfer.v1";
/** Fixed Move module name. Callers cannot override this. */
export const PROTECTED_TRANSFER_MODULE = "protected_transfer";
/** Fixed Move function name. Callers cannot override this. */
export const PROTECTED_TRANSFER_FUNCTION = "create_escrow";
/**
 * Standard Sui Clock object ID, sourced from the installed SDK constant.
 * Callers cannot override the Clock reference used by the transaction.
 */
export const PROTECTED_TRANSFER_CLOCK_ID = SUI_CLOCK_OBJECT_ID;
/** Maximum review-note length in Unicode code points. */
export const PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS = 120;
/** Minimum escrow lifetime: 1 hour after `nowMs`. Exact boundary is valid. */
export const PROTECTED_TRANSFER_DEADLINE_MIN_MS = 60 * 60 * 1000;
/** Maximum escrow lifetime: 30 days after `nowMs`. Exact boundary is valid. */
export const PROTECTED_TRANSFER_DEADLINE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export const PROTECTED_AGREEMENT_TEMPLATE_IDS = [
  "family_support",
  "medicine_pickup",
  "tuition",
  "relief",
  "purpose_allowance",
  "refundable_link",
] as const;
export type ProtectedAgreementTemplateId =
  (typeof PROTECTED_AGREEMENT_TEMPLATE_IDS)[number];
export const ProtectedAgreementTemplateIdSchema = z.enum(
  PROTECTED_AGREEMENT_TEMPLATE_IDS,
);

/** Sui address/object ID: 0x + up to 64 hex, used for plan address fields. */
const PlanSuiAddressString = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/)
  .max(66);

/**
 * Atomic Protected Transfer execution plan — the single strict unit that binds a
 * verified direct authorization together with the protection terms (package,
 * reviewer, deadline, review note) it is executed against. The server plan
 * endpoint authors this unit; this builder validates its structure and pinned
 * client constants only — see the PROVENANCE BOUNDARY at the top of this file.
 */
export interface ProtectedTransferExecutionPlan {
  kind: "protected_transfer_execution_plan";
  authorization: CanonicalAuthorization;
  /** Configured/candidate package object ID that would expose `protected_transfer`; existence/deployment is unverified. */
  packageId: string;
  /** Canonical reviewer/arbiter address for the escrow. */
  reviewerAddress: string;
  reviewerName?: string;
  /** Escrow deadline in milliseconds since the Unix epoch. */
  deadlineMs: number;
  /** Free-form review note. Trimmed; control characters rejected. */
  reviewNote: string;
  agreementTemplateId?: ProtectedAgreementTemplateId;
  evidenceRequirements?: string[];
  /**
   * Optional custody manifest digest (lowercase `0x` + 64 hex blake2b256).
   * When present it is bound into the canonical commitment encoding so a
   * different or tampered digest changes the outer commitment. The Move call
   * still receives only the single 32-byte outer commitment; this digest is
   * NOT a separate Move argument and is never verified, authenticated, or
   * approved by this builder. Ordinary transfers omit it; medicine-pickup
   * flows require it later at the medicine UI layer. Typed `string` to match
   * the strict runtime schema inference; the regex is the fail-closed guard.
   */
  custodyManifestDigest?: string;
}

/**
 * Strict runtime schema for the execution plan. Rejects missing and extra fields
 * recursively and reuses `CanonicalAuthorizationSchema` for the authorization
 * sub-object. This is the fail-closed structural boundary; semantic validation
 * (address canonicalization, deadline window, review-note characters) runs
 * afterwards against the parsed plan.
 */
export const ProtectedTransferExecutionPlanSchema = z.strictObject({
  kind: z.literal("protected_transfer_execution_plan"),
  authorization: CanonicalAuthorizationSchema,
  packageId: PlanSuiAddressString,
  reviewerAddress: PlanSuiAddressString,
  reviewerName: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Array.from(value).length <= 80)
    .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value))
    .optional(),
  deadlineMs: z.number().int().finite().safe(),
  // Structural bound only; semantic trim/empty/control-char validation stays
  // in `validateReviewNote` so the fail-closed empty boundary is preserved.
  // A missing property is still rejected by `strictObject`.
  reviewNote: z.string().max(500),
  agreementTemplateId: ProtectedAgreementTemplateIdSchema.optional(),
  evidenceRequirements: z.array(z.string().min(1).max(120)).min(1).max(8).optional(),
  // Optional custody manifest digest. Reuses the single canonical digest
  // schema from the custody-evidence module — no duplicated regex. A missing
  // property is accepted (ordinary transfers); a present-but-malformed value
  // fails closed through the strict schema.
  custodyManifestDigest: CustodyManifestDigestSchema.optional(),
});

/**
 * Server-issued deadline presets. The client may only name a preset; the
 * server resolves the exact duration and computes `deadlineMs`. All three
 * durations sit inside the core 1h–30d deadline window.
 */
export const PROTECTED_TRANSFER_DEADLINE_PRESETS = [
  "tomorrow",
  "three_days",
  "seven_days",
] as const;
export type ProtectedTransferDeadlinePreset =
  (typeof PROTECTED_TRANSFER_DEADLINE_PRESETS)[number];
export const ProtectedTransferDeadlinePresetSchema = z.enum(
  PROTECTED_TRANSFER_DEADLINE_PRESETS,
);
/** Frozen preset → duration map. Readonly and runtime-frozen. */
export const PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS: Readonly<
  Record<ProtectedTransferDeadlinePreset, number>
> = Object.freeze({
  tomorrow: 24 * 60 * 60 * 1000,
  three_days: 72 * 60 * 60 * 1000,
  seven_days: 168 * 60 * 60 * 1000,
});

/**
 * Maximum raw request body size accepted by the plan endpoint, in bytes. The
 * quote envelope plus preset and note fit well under this; oversized bodies are
 * rejected before buffering completes. Matches the settlement verifier cap.
 */
export const PROTECTED_TRANSFER_PLAN_MAX_BYTES = 16 * 1024;

/**
 * Strict top-level request surface for `POST /api/remittance/protected-transfer/plan`.
 * Owns only the three allowed field names, the preset enum, and the note size
 * guard. The quote envelope is NOT re-validated here — the shared
 * `verifyRemittanceQuote` policy remains the authoritative quote parser, so the
 * quote is parsed exactly once. `z.unknown()` accepts any JSON value including
 * `undefined`, so an explicit presence refinement rejects a missing quote at
 * the request surface while keeping quote parsing authoritative in the
 * verifier. `strictObject` rejects any extra top-level field. No package ID,
 * reviewer address, deadline timestamp, module, function, Clock, coin type,
 * cap, hash, version, sender, transaction bytes, or signer input is accepted.
 */
export const ProtectedTransferPlanRequestSchema = z
  .strictObject({
    quote: z.unknown().refine((v) => v !== undefined, {
      message: "quote is required",
    }),
    deadlinePreset: ProtectedTransferDeadlinePresetSchema,
    reviewNote: z.string().max(500),
    agreementTemplateId: ProtectedAgreementTemplateIdSchema.optional(),
    // Optional custody manifest digest. Ordinary transfers omit it; a
    // medicine-pickup flow may supply one. The route preserves it after quote
    // verification; no client package/reviewer/network/coin override is added.
    custodyManifestDigest: CustodyManifestDigestSchema.optional(),
  });
export type ProtectedTransferPlanRequest = z.infer<
  typeof ProtectedTransferPlanRequestSchema
>;

/**
 * Strict response schema for the plan endpoint: either a fully normalized
 * execution plan or a safe rejection. Reuses `VerifyRejectedSchema` so the
 * endpoint shares the existing safe rejection vocabulary — no second error
 * vocabulary is introduced.
 */
export const ProtectedTransferPlanResponseSchema = z.discriminatedUnion("kind", [
  ProtectedTransferExecutionPlanSchema,
  VerifyRejectedSchema,
]);
export type ProtectedTransferPlanResponse = z.infer<
  typeof ProtectedTransferPlanResponseSchema
>;

/** Public input. The surface is intentionally narrow: the caller supplies one
 * atomic plan, the sender, and the current time. No module/function/clock/
 * coin-type/cap/algorithm/version overrides are possible, and package/reviewer/
 * deadline/note may appear only inside the parsed plan. */
export interface BuildProtectedTransferInput {
  /** Strict atomic execution plan authored by the server plan endpoint. */
  plan: ProtectedTransferExecutionPlan;
  /** Sender (escrow funder) address. Canonicalized before use. */
  sender: string;
  /** Caller-supplied current time in milliseconds since the Unix epoch. */
  nowMs: number;
}

/** Immutable metadata bound to the built transaction for later UI/receipt use.
 *
 * The object itself is frozen with `Object.freeze` before return, and
 * `commitmentBytes` is a frozen `readonly number[]` snapshot of the digest —
 * receipt-facing code never receives a live mutable `Uint8Array`. The
 * `Transaction` receives its own separate `Uint8Array` copy and is not frozen. */
export interface ProtectedTransferMetadata {
  readonly schemaVersion: string;
  /** Canonical package object ID used as the Move call target. */
  readonly packageId: string;
  readonly module: string;
  readonly function: string;
  readonly clockId: string;
  readonly coinType: string;
  readonly sender: string;
  readonly beneficiary: string;
  readonly reviewer: string;
  /** Authorized USDC micro amount, as a decimal string. */
  readonly amountMicro: string;
  readonly deadlineMs: number;
  /** Normalized (trimmed) review note. */
  readonly reviewNote: string;
  /** Lowercase 0x-prefixed 32-byte commitment. */
  readonly commitmentHex: string;
  /** Frozen 32-byte commitment as a readonly number list. */
  readonly commitmentBytes: readonly number[];
  /** Canonical JSON encoding that was hashed. */
  readonly canonicalEncoding: string;
  /** Full Move target string: `${packageId}::${module}::${function}`. */
  readonly target: string;
  /**
   * Optional custody manifest digest bound into the commitment. Present only
   * when the plan carried one. Immutable. This is a commitment to supplied
   * custody data only — never a verified, authentic, medically valid,
   * authorized, or approved artifact.
   */
  readonly custodyManifestDigest?: string;
}

export interface BuildProtectedTransferResult {
  transaction: Transaction;
  metadata: ProtectedTransferMetadata;
}

/** Canonical Sui zero address (64 zero hex digits). */
const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);

/** Canonicalize and validate a Sui address/object ID. Throws on invalid input. */
function canonicalizeAddress(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: missing or empty.`);
  }
  const normalized = normalizeSuiAddress(value.trim());
  if (!isValidSuiAddress(normalized)) {
    throw new Error(`Invalid ${label}: not a valid Sui address.`);
  }
  return normalized;
}

/**
 * Shared zero/distinct-role invariant for a Protected Transfer party set.
 * Mirrors the Move `create_escrow` guards (`EZeroBeneficiary`,
 * `EZeroReviewer`, `ECollidingRoles`). The payer is the wallet sender and is
 * checked against the beneficiary and reviewer here so the builder and the
 * plan parser share one policy owner. Throws on any violation.
 */
export function assertProtectedTransferRolesDistinct(input: {
  payer: string;
  beneficiary: string;
  reviewer: string;
}): void {
  if (input.payer === SUI_ZERO_ADDRESS) {
    throw new Error("Payer must not be the zero address.");
  }
  if (input.beneficiary === SUI_ZERO_ADDRESS) {
    throw new Error("Beneficiary must not be the zero address.");
  }
  if (input.reviewer === SUI_ZERO_ADDRESS) {
    throw new Error("Reviewer must not be the zero address.");
  }
  if (input.payer === input.beneficiary) {
    throw new Error("Payer and beneficiary must be distinct.");
  }
  if (input.payer === input.reviewer) {
    throw new Error("Payer and reviewer must be distinct.");
  }
  if (input.beneficiary === input.reviewer) {
    throw new Error("Beneficiary and reviewer must be distinct.");
  }
}

/** Validate the USDC micro amount and return it as a bounded bigint.
 * The `UsdcMicroString` schema already guarantees a non-empty decimal digit
 * string, so a direct `BigInt` parse is sufficient. The positive, u64, and
 * product-cap bounds remain enforced here. */
function validateAmountMicro(usdcMicro: string): bigint {
  const micro = BigInt(usdcMicro);
  if (micro <= 0n) {
    throw new Error("USDC micro amount must be greater than zero.");
  }
  if (micro > U64_MAX) {
    throw new Error("USDC micro amount exceeds u64.");
  }
  if (micro > MAX_USDC_MICRO) {
    throw new Error("USDC micro amount exceeds the product cap.");
  }
  return micro;
}

/** Validate `nowMs`/`deadlineMs` and the deadline window. Exact bounds are valid. */
function validateDeadline(nowMs: number, deadlineMs: number): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("nowMs must be a finite safe integer.");
  }
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new Error("deadlineMs must be a finite safe integer.");
  }
  const delta = deadlineMs - nowMs;
  if (delta < PROTECTED_TRANSFER_DEADLINE_MIN_MS) {
    throw new Error("Deadline is below the 1-hour minimum.");
  }
  if (delta > PROTECTED_TRANSFER_DEADLINE_MAX_MS) {
    throw new Error("Deadline exceeds the 30-day maximum.");
  }
}

/**
 * Enforce authorization freshness against the caller-supplied current time.
 * Rejects a future-issued authorization (`issuedAt > nowMs`) and an expired
 * authorization (`expiresAt <= nowMs`). The exact `issuedAt === nowMs`
 * boundary is accepted; the exact `expiresAt === nowMs` boundary is expired
 * and rejected. `issuedAt`/`expiresAt` are safe integers by the strict
 * authorization schema; `nowMs` is checked by `validateDeadline`.
 *
 * This is a structural freshness check only. The caller's `nowMs` does not
 * prove server provenance; the PROVENANCE BOUNDARY at the top of this file
 * remains authoritative.
 */
function validateAuthorizationFreshness(
  issuedAt: number,
  expiresAt: number,
  nowMs: number,
): void {
  if (issuedAt > nowMs) {
    throw new Error("Authorization issuedAt is in the future.");
  }
  if (expiresAt <= nowMs) {
    throw new Error("Authorization has expired.");
  }
}

/**
 * Validate and normalize the review note. Trims leading/trailing whitespace,
 * rejects empty input, rejects notes over 120 Unicode code points, and rejects
 * C0/C1 control characters (newlines and tabs included). Internal whitespace is
 * preserved — no truncation or collapsing is performed.
 */
function validateReviewNote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Review note must not be empty.");
  }
  const codePoints = Array.from(trimmed).length;
  if (codePoints > PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS) {
    throw new Error("Review note exceeds 120 Unicode code points.");
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      throw new Error("Review note contains an invalid character.");
    }
    // C0 (0x00-0x1F), DEL (0x7F), and C1 (0x80-0x9F) control characters.
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
      throw new Error("Review note must not contain control characters.");
    }
  }
  return trimmed;
}

/**
 * Canonical fixed-order encoding of the strict authorization. Every field is
 * listed explicitly with a stable property order; nullable fields use JSON
 * `null` unambiguously. The beneficiary (canonicalized recipient) is bound here
 * so equivalent textual address forms produce an identical commitment.
 */
function canonicalAuthorizationEncoding(
  auth: CanonicalAuthorization,
  canonicalBeneficiary: string,
) {
  return {
    kind: auth.kind,
    recipientAddress: canonicalBeneficiary,
    usdcMicro: auth.usdcMicro,
    coinType: auth.coinType,
    beneficiaryRef: auth.beneficiaryRef,
    issuedAt: auth.issuedAt,
    expiresAt: auth.expiresAt,
    corridor: {
      source: auth.corridor.source,
      destination: auth.corridor.destination,
    },
    youPayMinor: auth.youPayMinor,
    familyReceivesMinor: auth.familyReceivesMinor,
    totalFeeMinor: auth.totalFeeMinor,
    myrPerUsdc: auth.myrPerUsdc,
    phpPerUsdc: auth.phpPerUsdc,
    fixedFeeMyr: auth.fixedFeeMyr,
    feeBps: auth.feeBps,
    recipient: auth.recipient,
    destinationCity: auth.destinationCity,
    purpose: auth.purpose,
    maximumFamilyLimitMinor: auth.maximumFamilyLimitMinor,
    ...(auth.intentBinding === undefined
      ? {}
      : {
          intentBinding: {
            version: auth.intentBinding.version,
            originalIntent: auth.intentBinding.originalIntent,
            interpretation:
              auth.intentBinding.interpretation.kind === "gonka"
                ? {
                    kind: auth.intentBinding.interpretation.kind,
                    provider: auth.intentBinding.interpretation.provider,
                    requestId: auth.intentBinding.interpretation.requestId,
                    modelId: auth.intentBinding.interpretation.modelId,
                    detectedLanguage: auth.intentBinding.interpretation.detectedLanguage,
                  }
                : {
                    kind: auth.intentBinding.interpretation.kind,
                    provider: auth.intentBinding.interpretation.provider,
                    fallbackReason: auth.intentBinding.interpretation.fallbackReason,
                  },
            policy: {
              engine: auth.intentBinding.policy.engine,
              result: auth.intentBinding.policy.result,
              ruleStatus: auth.intentBinding.policy.ruleStatus,
              purpose: auth.intentBinding.policy.purpose,
              maximumFamilyLimitMinor:
                auth.intentBinding.policy.maximumFamilyLimitMinor,
            },
          },
        }),
  };
}

/**
 * Pure plan parser/normalizer — the single shared entry point that strict-parses
 * a candidate execution plan, canonicalizes package/reviewer/beneficiary,
 * normalizes the review note, and enforces amount/freshness/deadline invariants.
 *
 * Used by both `buildProtectedTransfer` (transaction construction) and the
 * server-only plan endpoint. Returns a typed plan built from already
 * strict-parsed fields plus the canonicalizers; the input was strict-parsed up
 * front, so no second schema parse is needed.
 *
 * Throws on any validation failure. Callers at security boundaries (the plan
 * route) catch and fail closed as `invalid_envelope`. This is a pure function:
 * no React, fetch, env, secret, HMAC, RPC, signing, or submission.
 */
export function parseProtectedTransferExecutionPlan(
  input: unknown,
  nowMs: number,
): ProtectedTransferExecutionPlan {
  // Strict runtime schema parses the complete plan first. Rejects malformed
  // input, missing fields, extra fields, and a wrong kind through the schema
  // rather than leaking a TypeError deeper in the parser.
  const parsed = ProtectedTransferExecutionPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Protected Transfer plan failed the strict execution-plan schema.");
  }
  const plan = parsed.data;

  const auth = plan.authorization;
  if (auth.coinType !== USDC_COIN_TYPE_TESTNET) {
    throw new Error("Authorization coin type must be pinned testnet USDC.");
  }

  // Canonicalize every bound address before any window/freshness check so a
  // non-canonical-but-valid textual form produces an identical normalized plan.
  const canonicalBeneficiary = canonicalizeAddress(auth.recipientAddress, "beneficiary");
  const canonicalPackage = canonicalizeAddress(plan.packageId, "packageId");
  const canonicalReviewer = canonicalizeAddress(plan.reviewerAddress, "reviewerAddress");

  // Enforce amount, deadline window, authorization freshness, and note
  // semantics against the caller-supplied current time.
  validateAmountMicro(auth.usdcMicro);
  validateDeadline(nowMs, plan.deadlineMs);
  validateAuthorizationFreshness(auth.issuedAt, auth.expiresAt, nowMs);
  const normalizedNote = validateReviewNote(plan.reviewNote);

  // Zero/distinct role invariants mirror the Move `create_escrow` guards.
  // The payer is the wallet sender, resolved only at build time, so the plan
  // parser owns beneficiary/reviewer zero and beneficiary!=reviewer here; the
  // builder owns the payer-distinct checks against the canonical sender.
  if (canonicalBeneficiary === SUI_ZERO_ADDRESS) {
    throw new Error("Beneficiary must not be the zero address.");
  }
  if (canonicalReviewer === SUI_ZERO_ADDRESS) {
    throw new Error("Reviewer must not be the zero address.");
  }
  if (canonicalBeneficiary === canonicalReviewer) {
    throw new Error("Beneficiary and reviewer must be distinct.");
  }

  // Build the normalized plan from already strict-parsed fields plus
  // canonicalizers. The authorization is rebuilt with the canonical
  // beneficiary; every other authorization field is carried verbatim.
  return {
    kind: "protected_transfer_execution_plan",
    authorization: { ...auth, recipientAddress: canonicalBeneficiary },
    packageId: canonicalPackage,
    reviewerAddress: canonicalReviewer,
    ...(plan.reviewerName === undefined ? {} : { reviewerName: plan.reviewerName }),
    deadlineMs: plan.deadlineMs,
    reviewNote: normalizedNote,
    ...(plan.agreementTemplateId === undefined
      ? {}
      : { agreementTemplateId: plan.agreementTemplateId }),
    ...(plan.evidenceRequirements === undefined
      ? {}
      : { evidenceRequirements: plan.evidenceRequirements }),
    // Preserve the optional custody manifest digest verbatim. The strict
    // schema already validated its shape; the parser does not transform it.
    ...(plan.custodyManifestDigest === undefined
      ? {}
      : { custodyManifestDigest: plan.custodyManifestDigest }),
  };
}

/**
 * Build one Protected Transfer transaction and its immutable commitment metadata.
 *
 * Delegates plan parsing/normalization to `parseProtectedTransferExecutionPlan`
 * (the shared strict entry point), then only canonicalizes the sender and builds
 * the commitment/PTB. Package, reviewer, deadline, and review note may appear
 * only inside the parsed plan. The commitment is a 32-byte blake2b256 digest
 * over the UTF-8 bytes of a canonical fixed-order JSON encoding that binds the
 * schema version, fixed module/function/Clock, pinned coin type, canonical
 * addresses, deadline, normalized review note, and every strict authorization
 * field.
 *
 * This does not deploy, settle, release, or pay out anything. A built
 * transaction is not settlement, and the plan is not signed, attested, verified,
 * safe, deployed, or immutable on the strength of this builder alone.
 */
export function buildProtectedTransfer(
  input: BuildProtectedTransferInput,
): BuildProtectedTransferResult {
  if (!input || typeof input !== "object") {
    throw new Error("Protected Transfer input is required.");
  }

  // Shared strict plan parser/normalizer is the single validation entry point.
  const plan = parseProtectedTransferExecutionPlan(input.plan, input.nowMs);
  const auth = plan.authorization;

  // The builder owns only sender canonicalization and the commitment/PTB.
  const canonicalSender = canonicalizeAddress(input.sender, "sender");
  const canonicalBeneficiary = auth.recipientAddress;
  const canonicalPackage = plan.packageId;
  const canonicalReviewer = plan.reviewerAddress;

  // Payer-distinct invariants mirror the Move `create_escrow` guards. The
  // plan parser already enforced beneficiary/reviewer zero and distinctness;
  // the builder owns the payer (sender) distinctness against both.
  assertProtectedTransferRolesDistinct({
    payer: canonicalSender,
    beneficiary: canonicalBeneficiary,
    reviewer: canonicalReviewer,
  });

  // The parser already enforced the amount invariants; a direct BigInt parse
  // is sufficient for the coin intent.
  const micro = BigInt(auth.usdcMicro);
  const normalizedNote = plan.reviewNote;

  // Canonical fixed-order JSON encoding. No object spread; every key explicit.
  // The optional `custodyManifestDigest` is appended only when present, so
  // no-digest plans keep their existing canonical encoding and commitment
  // byte-for-byte (a new null field is never injected into old encodings).
  // When present, the digest is bound into the outer commitment, so a
  // different or tampered digest changes the 32-byte commitment the Move call
  // receives. The Move call signature and argument count are unchanged.
  const encoding = {
    schemaVersion: PROTECTED_TRANSFER_SCHEMA_VERSION,
    package: canonicalPackage,
    module: PROTECTED_TRANSFER_MODULE,
    function: PROTECTED_TRANSFER_FUNCTION,
    clockId: PROTECTED_TRANSFER_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: canonicalBeneficiary,
    reviewer: canonicalReviewer,
    deadlineMs: plan.deadlineMs,
    reviewNote: normalizedNote,
    ...(plan.agreementTemplateId === undefined
      ? {}
      : { agreementTemplateId: plan.agreementTemplateId }),
    ...(plan.evidenceRequirements === undefined
      ? {}
      : { evidenceRequirements: plan.evidenceRequirements }),
    authorization: canonicalAuthorizationEncoding(auth, canonicalBeneficiary),
    ...(plan.custodyManifestDigest === undefined
      ? {}
      : { custodyManifestDigest: plan.custodyManifestDigest }),
  };
  const canonicalJson = JSON.stringify(encoding);
  const digest = blake2b256(new TextEncoder().encode(canonicalJson));
  const commitmentHex = toHex(digest);
  // Receipt-facing frozen readonly list — no live mutable Uint8Array escapes.
  const commitmentBytes: readonly number[] = Object.freeze(Array.from(digest));
  // The Transaction receives its own independent Uint8Array copy.
  const txCommitmentBytes = new Uint8Array(digest);

  const target = `${canonicalPackage}::${PROTECTED_TRANSFER_MODULE}::${PROTECTED_TRANSFER_FUNCTION}`;

  const transaction = new Transaction();
  transaction.setSender(canonicalSender);
  const coin = transaction.coin({
    type: USDC_COIN_TYPE_TESTNET,
    balance: micro,
  });
  // Single Move call. Arguments follow the Move signature order exactly:
  //   create_escrow<T>(Coin<T>, beneficiary, reviewer, vector<u8>, deadlineMs, &Clock)
  transaction.moveCall({
    target,
    typeArguments: [USDC_COIN_TYPE_TESTNET],
    arguments: [
      coin,
      transaction.pure.address(canonicalBeneficiary),
      transaction.pure.address(canonicalReviewer),
      transaction.pure.vector("u8", txCommitmentBytes),
      transaction.pure.u64(plan.deadlineMs),
      transaction.object.clock(),
    ],
  });

  const metadata: ProtectedTransferMetadata = {
    schemaVersion: PROTECTED_TRANSFER_SCHEMA_VERSION,
    packageId: canonicalPackage,
    module: PROTECTED_TRANSFER_MODULE,
    function: PROTECTED_TRANSFER_FUNCTION,
    clockId: PROTECTED_TRANSFER_CLOCK_ID,
    coinType: USDC_COIN_TYPE_TESTNET,
    sender: canonicalSender,
    beneficiary: canonicalBeneficiary,
    reviewer: canonicalReviewer,
    amountMicro: auth.usdcMicro,
    deadlineMs: plan.deadlineMs,
    reviewNote: normalizedNote,
    commitmentHex,
    commitmentBytes,
    canonicalEncoding: canonicalJson,
    target,
    ...(plan.custodyManifestDigest === undefined
      ? {}
      : { custodyManifestDigest: plan.custodyManifestDigest }),
  };
  Object.freeze(metadata);

  return { transaction, metadata };
}
