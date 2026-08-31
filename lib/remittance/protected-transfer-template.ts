/**
 * Protected Transfer Mission templates — pure, client-safe, immutable.
 *
 * Reusable customer Mission templates layered over the existing Protected
 * Transfer spine. A template only CONFIGURES intent/reviewer/evidence
 * language and capability requirements; it does not create a new state
 * machine, sign or submit transactions, call AI/network, read env, or claim
 * any capability is available, verified, live, or partnered.
 *
 * Truth boundary: `prepareProtectedTransferTemplate` returns bounded data
 * consumable by the existing protected-transfer flow (deadline preset,
 * normalized review note, purpose suggestion, reviewer role, evidence
 * checklist, capability requirements). A SEPARATE evaluator
 * (`evaluateProtectedTransferTemplateCapabilities`) returns `ready` or a
 * typed list of missing capabilities; the caller must fail closed when any
 * required capability is missing. This module never claims a capability is
 * satisfied — it only declares what a template needs.
 *
 * No floats, no new dependencies, no transaction/network/model authority.
 * Every returned object is deeply frozen.
 */

import {
  PROTECTED_TRANSFER_DEADLINE_PRESETS,
  PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS,
  type ProtectedTransferDeadlinePreset,
} from "./protected-transfer";

// ---------------------------------------------------------------------------
// Capability model
// ---------------------------------------------------------------------------

/**
 * The full capability union a template may declare. `pharmacy_network` is
 * declared only by `medicine_pickup`; every other template declares only the
 * truthful capabilities its mission needs. A template never claims a
 * capability is available — it only lists what it requires.
 */
export type ProtectedTransferTemplateCapability =
  | "mapped_recipient"
  | "verified_quote"
  | "protected_transfer"
  | "human_reviewer"
  | "evidence_council"
  | "pharmacy_network";

/** Stable canonical capability order used by the evaluator and tests. */
export const PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER: readonly ProtectedTransferTemplateCapability[] =
  Object.freeze([
    "mapped_recipient",
    "verified_quote",
    "protected_transfer",
    "human_reviewer",
    "evidence_council",
    "pharmacy_network",
  ] as const);

// ---------------------------------------------------------------------------
// Template model
// ---------------------------------------------------------------------------

export type ProtectedTransferTemplateId =
  | "family_support"
  | "medicine_pickup"
  | "tuition"
  | "relief";

/**
 * Immutable Mission template. Every field is readonly and the object is
 * frozen at construction. `evidenceChecklist` has at most 4 entries.
 * `allowedDeadlinePresets` is a non-empty subset of the existing spine
 * presets and must contain `defaultDeadlinePreset`.
 */
export interface ProtectedTransferTemplate {
  readonly id: ProtectedTransferTemplateId;
  /** Customer-facing label, e.g. "Family support". */
  readonly customerLabel: string;
  /** One-line promise describing the mission, no provider or live claims. */
  readonly promise: string;
  /** Suggested purpose text fed into the existing intent flow. */
  readonly suggestedPurpose: string;
  /** Reviewer role label, e.g. "Family reviewer". */
  readonly reviewerRoleLabel: string;
  /** Bounded evidence checklist (1–4 entries). */
  readonly evidenceChecklist: readonly string[];
  /** Non-empty subset of the spine deadline presets. */
  readonly allowedDeadlinePresets: readonly ProtectedTransferDeadlinePreset[];
  /** Must be a member of `allowedDeadlinePresets`. */
  readonly defaultDeadlinePreset: ProtectedTransferDeadlinePreset;
  /** Truthful required capabilities; never claims availability. */
  readonly requiredCapabilities: readonly ProtectedTransferTemplateCapability[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Reviewer display label bound, matching the spine reviewer-name bound. */
const REVIEWER_LABEL_MAX_CODE_POINTS = 80;

/** Reject C0 (0x00-0x1F), DEL (0x7F), and C1 (0x80-0x9F) control characters. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      return true;
    }
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Deeply freeze a plain object/array tree. Returns the same reference. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
  }
  return value;
}

/** Build a frozen template, asserting structural invariants at module load. */
function makeTemplate(
  template: ProtectedTransferTemplate,
): ProtectedTransferTemplate {
  if (template.evidenceChecklist.length < 1 || template.evidenceChecklist.length > 4) {
    throw new Error(`Template ${template.id} evidenceChecklist must have 1–4 entries.`);
  }
  if (template.allowedDeadlinePresets.length === 0) {
    throw new Error(`Template ${template.id} allowedDeadlinePresets must be non-empty.`);
  }
  for (const preset of template.allowedDeadlinePresets) {
    if (!PROTECTED_TRANSFER_DEADLINE_PRESETS.includes(preset)) {
      throw new Error(`Template ${template.id} allowedDeadlinePresets has unknown preset ${preset}.`);
    }
  }
  if (!template.allowedDeadlinePresets.includes(template.defaultDeadlinePreset)) {
    throw new Error(`Template ${template.id} defaultDeadlinePreset must be allowed.`);
  }
  for (const cap of template.requiredCapabilities) {
    if (!PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER.includes(cap)) {
      throw new Error(`Template ${template.id} requiredCapabilities has unknown capability ${cap}.`);
    }
  }
  return deepFreeze({ ...template });
}

// ---------------------------------------------------------------------------
// Template registry — stable order: family_support, medicine_pickup, tuition,
// relief. Medicine requires all six capabilities; others declare only the
// truthful capabilities their mission needs.
// ---------------------------------------------------------------------------

const FAMILY_SUPPORT_TEMPLATE = makeTemplate({
  id: "family_support",
  customerLabel: "Family support",
  promise: "Send support to family with a human reviewer and an evidence trail.",
  suggestedPurpose: "Family support",
  reviewerRoleLabel: "Family reviewer",
  evidenceChecklist: Object.freeze([
    "Recipient identity confirmed",
    "Agreed use of funds noted",
    "Reviewer approval recorded",
    "Settlement receipt captured",
  ]),
  allowedDeadlinePresets: Object.freeze([
    "tomorrow",
    "three_days",
    "seven_days",
  ]) as readonly ProtectedTransferDeadlinePreset[],
  defaultDeadlinePreset: "seven_days",
  requiredCapabilities: Object.freeze([
    "mapped_recipient",
    "verified_quote",
    "protected_transfer",
    "human_reviewer",
    "evidence_council",
  ]) as readonly ProtectedTransferTemplateCapability[],
});

const MEDICINE_PICKUP_TEMPLATE = makeTemplate({
  id: "medicine_pickup",
  customerLabel: "Medicine pickup",
  promise: "Fund a pharmacy pickup reviewed by a human and an evidence council.",
  suggestedPurpose: "Medicine pickup",
  reviewerRoleLabel: "Pickup reviewer",
  evidenceChecklist: Object.freeze([
    "Pharmacy pickup confirmed",
    "Recipient identity verified at pickup",
    "Item count matched at handover",
    "Payment receipt captured",
  ]),
  allowedDeadlinePresets: Object.freeze([
    "tomorrow",
    "three_days",
  ]) as readonly ProtectedTransferDeadlinePreset[],
  defaultDeadlinePreset: "tomorrow",
  requiredCapabilities: Object.freeze([
    "mapped_recipient",
    "verified_quote",
    "protected_transfer",
    "human_reviewer",
    "evidence_council",
    "pharmacy_network",
  ]) as readonly ProtectedTransferTemplateCapability[],
});

const TUITION_TEMPLATE = makeTemplate({
  id: "tuition",
  customerLabel: "Tuition",
  promise: "Send tuition support with a human reviewer and a settlement receipt.",
  suggestedPurpose: "Tuition support",
  reviewerRoleLabel: "Tuition reviewer",
  evidenceChecklist: Object.freeze([
    "Recipient identity confirmed",
    "Study program noted",
    "Reviewer approval recorded",
    "Settlement receipt captured",
  ]),
  allowedDeadlinePresets: Object.freeze([
    "three_days",
    "seven_days",
  ]) as readonly ProtectedTransferDeadlinePreset[],
  defaultDeadlinePreset: "seven_days",
  requiredCapabilities: Object.freeze([
    "mapped_recipient",
    "verified_quote",
    "protected_transfer",
    "human_reviewer",
  ]) as readonly ProtectedTransferTemplateCapability[],
});

const RELIEF_TEMPLATE = makeTemplate({
  id: "relief",
  customerLabel: "Relief",
  promise: "Send relief support with a human reviewer and an evidence council.",
  suggestedPurpose: "Relief support",
  reviewerRoleLabel: "Relief reviewer",
  evidenceChecklist: Object.freeze([
    "Recipient identity confirmed",
    "Relief need noted",
    "Reviewer approval recorded",
    "Settlement receipt captured",
  ]),
  allowedDeadlinePresets: Object.freeze([
    "tomorrow",
    "three_days",
    "seven_days",
  ]) as readonly ProtectedTransferDeadlinePreset[],
  defaultDeadlinePreset: "three_days",
  requiredCapabilities: Object.freeze([
    "mapped_recipient",
    "verified_quote",
    "protected_transfer",
    "human_reviewer",
    "evidence_council",
  ]) as readonly ProtectedTransferTemplateCapability[],
});

/** Stable ordered registry. Frozen at module load. */
const PROTECTED_TRANSFER_TEMPLATES: readonly ProtectedTransferTemplate[] = Object.freeze([
  FAMILY_SUPPORT_TEMPLATE,
  MEDICINE_PICKUP_TEMPLATE,
  TUITION_TEMPLATE,
  RELIEF_TEMPLATE,
]);

const PROTECTED_TRANSFER_TEMPLATE_BY_ID: Readonly<
  Record<ProtectedTransferTemplateId, ProtectedTransferTemplate>
> = Object.freeze({
  family_support: FAMILY_SUPPORT_TEMPLATE,
  medicine_pickup: MEDICINE_PICKUP_TEMPLATE,
  tuition: TUITION_TEMPLATE,
  relief: RELIEF_TEMPLATE,
});

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

/**
 * Return the immutable template for `id`, or `undefined` for an unknown id.
 * The returned reference is the frozen registry entry; callers must not mutate.
 */
export function getProtectedTransferTemplate(
  id: string,
): ProtectedTransferTemplate | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  return PROTECTED_TRANSFER_TEMPLATE_BY_ID[id as ProtectedTransferTemplateId];
}

/**
 * Return all four templates in stable order
 * (family_support, medicine_pickup, tuition, relief). The returned array is
 * the frozen registry; callers must not mutate.
 */
export function listProtectedTransferTemplates(): readonly ProtectedTransferTemplate[] {
  return PROTECTED_TRANSFER_TEMPLATES;
}

// ---------------------------------------------------------------------------
// Capability evaluator — pure; never claims availability.
// ---------------------------------------------------------------------------

export interface ProtectedTransferTemplateCapabilityEvaluation {
  readonly ok: boolean;
  /** Missing capabilities in canonical order; empty when `ok`. */
  readonly missing: readonly ProtectedTransferTemplateCapability[];
}

/**
 * Evaluate whether `available` capabilities satisfy the template's
 * `requiredCapabilities`. Returns `{ ok: true, missing: [] }` when satisfied,
 * or `{ ok: false, missing: [...] }` with the missing capabilities in
 * canonical order. The caller must fail closed when `ok` is false.
 *
 * This evaluator never claims a capability is live, verified, or partnered —
 * it only compares two sets. Provenance of `available` is the caller's
 * responsibility.
 */
export function evaluateProtectedTransferTemplateCapabilities(
  template: ProtectedTransferTemplate,
  available: Iterable<ProtectedTransferTemplateCapability>,
): ProtectedTransferTemplateCapabilityEvaluation {
  const availableSet = new Set<ProtectedTransferTemplateCapability>();
  for (const cap of available) {
    if (PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER.includes(cap)) {
      availableSet.add(cap);
    }
  }
  const missing: ProtectedTransferTemplateCapability[] = [];
  for (const cap of PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER) {
    if (template.requiredCapabilities.includes(cap) && !availableSet.has(cap)) {
      missing.push(cap);
    }
  }
  return deepFreeze({ ok: missing.length === 0, missing: Object.freeze(missing) });
}

// ---------------------------------------------------------------------------
// Prepare — pure; returns bounded data for the existing flow.
// ---------------------------------------------------------------------------

/** Normalized reviewer display label. */
export interface ProtectedTransferTemplateReviewerLabel {
  readonly value: string;
}

/** Bounded prepare input. */
export interface PrepareProtectedTransferTemplateInput {
  readonly templateId: string;
  readonly deadlinePreset: string;
  readonly reviewerDisplayLabel: string;
  readonly customerNote: string;
}

/** Bounded prepared output, consumable by the existing protected-transfer flow. */
export interface PreparedProtectedTransferTemplate {
  readonly templateId: ProtectedTransferTemplateId;
  readonly deadlinePreset: ProtectedTransferDeadlinePreset;
  /** Normalized (trimmed, control-char-free, bounded) review note. */
  readonly reviewNote: string;
  /** Purpose suggestion from the template. */
  readonly purpose: string;
  /** Reviewer role label from the template (e.g. "Family reviewer"). */
  readonly reviewerRoleLabel: string;
  /** Normalized caller-supplied reviewer display label, for the flow's `reviewerName`. */
  readonly reviewerDisplayLabel: string;
  /** Evidence checklist from the template (max 4). */
  readonly evidenceChecklist: readonly string[];
  /** Required capabilities from the template; availability is not implied. */
  readonly requiredCapabilities: readonly ProtectedTransferTemplateCapability[];
}

export type PrepareProtectedTransferTemplateResult =
  | { readonly ok: true; readonly prepared: PreparedProtectedTransferTemplate }
  | {
      readonly ok: false;
      readonly reason:
        | "unknown_template"
        | "deadline_not_allowed"
        | "invalid_reviewer_label"
        | "invalid_note";
    };

/** Validate and normalize the reviewer display label. Returns null on failure. */
function normalizeReviewerLabel(
  raw: string,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (Array.from(trimmed).length > REVIEWER_LABEL_MAX_CODE_POINTS) {
    return null;
  }
  if (hasControlChar(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Validate and normalize the customer note. Returns null on failure. */
function normalizeCustomerNote(raw: string): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (Array.from(trimmed).length > PROTECTED_TRANSFER_REVIEW_NOTE_MAX_CODE_POINTS) {
    return null;
  }
  if (hasControlChar(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Prepare a Protected Transfer Mission from a template id, a selected allowed
 * deadline preset, a reviewer display label, and a customer note. Returns a
 * discriminated result; failures are typed reasons and never throw.
 *
 * The returned `prepared` object is deeply frozen and carries only bounded
 * data consumable by the existing protected-transfer flow. It does NOT
 * evaluate capability availability — call `evaluateProtectedTransferTemplateCapabilities`
 * separately and fail closed when any capability is missing. It does NOT
 * construct, sign, or submit a transaction, call AI/network, or read env.
 *
 * The customer note is bounded and control-char safe. Templates do not
 * solicit medicine names, diagnoses, or prescription content; the suggested
 * purpose and evidence checklist carry no such content.
 */
export function prepareProtectedTransferTemplate(
  input: PrepareProtectedTransferTemplateInput,
): PrepareProtectedTransferTemplateResult {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "unknown_template" };
  }

  const template = getProtectedTransferTemplate(input.templateId);
  if (!template) {
    return { ok: false, reason: "unknown_template" };
  }

  if (typeof input.deadlinePreset !== "string") {
    return { ok: false, reason: "deadline_not_allowed" };
  }
  const preset = input.deadlinePreset as ProtectedTransferDeadlinePreset;
  if (!template.allowedDeadlinePresets.includes(preset)) {
    return { ok: false, reason: "deadline_not_allowed" };
  }

  const reviewerLabel = normalizeReviewerLabel(input.reviewerDisplayLabel);
  if (reviewerLabel === null) {
    return { ok: false, reason: "invalid_reviewer_label" };
  }

  const note = normalizeCustomerNote(input.customerNote);
  if (note === null) {
    return { ok: false, reason: "invalid_note" };
  }

  const prepared: PreparedProtectedTransferTemplate = deepFreeze({
    templateId: template.id,
    deadlinePreset: preset,
    reviewNote: note,
    purpose: template.suggestedPurpose,
    reviewerRoleLabel: template.reviewerRoleLabel,
    reviewerDisplayLabel: reviewerLabel,
    evidenceChecklist: template.evidenceChecklist,
    requiredCapabilities: template.requiredCapabilities,
  });

  return { ok: true, prepared };
}
