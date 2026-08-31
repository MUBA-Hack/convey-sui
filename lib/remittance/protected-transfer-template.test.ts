import { describe, expect, it } from "vitest";
import {
  evaluateProtectedTransferTemplateCapabilities,
  getProtectedTransferTemplate,
  listProtectedTransferTemplates,
  prepareProtectedTransferTemplate,
  PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER,
  type ProtectedTransferTemplateCapability,
} from "./protected-transfer-template";
import { PROTECTED_TRANSFER_DEADLINE_PRESETS } from "./protected-transfer";

const ALL_CAPS: ProtectedTransferTemplateCapability[] = [
  "mapped_recipient",
  "verified_quote",
  "protected_transfer",
  "human_reviewer",
  "evidence_council",
  "pharmacy_network",
];

describe("protected-transfer-template registry", () => {
  it("exposes exactly four templates in stable order", () => {
    const list = listProtectedTransferTemplates();
    expect(list.map((t) => t.id)).toEqual([
      "family_support",
      "medicine_pickup",
      "tuition",
      "relief",
    ]);
    expect(list).toHaveLength(4);
  });

  it("every template is deeply frozen", () => {
    for (const template of listProtectedTransferTemplates()) {
      expect(Object.isFrozen(template)).toBe(true);
      expect(Object.isFrozen(template.evidenceChecklist)).toBe(true);
      expect(Object.isFrozen(template.allowedDeadlinePresets)).toBe(true);
      expect(Object.isFrozen(template.requiredCapabilities)).toBe(true);
      // Mutation attempts are no-ops in strict mode; assert frozen flag instead.
      expect(() => {
        // @ts-expect-error mutating readonly
        template.customerLabel = "x";
      }).toThrow();
    }
  });

  it("evidence checklist has between 1 and 4 entries", () => {
    for (const template of listProtectedTransferTemplates()) {
      expect(template.evidenceChecklist.length).toBeGreaterThanOrEqual(1);
      expect(template.evidenceChecklist.length).toBeLessThanOrEqual(4);
    }
  });

  it("allowed deadline presets are a non-empty spine subset containing the default", () => {
    for (const template of listProtectedTransferTemplates()) {
      expect(template.allowedDeadlinePresets.length).toBeGreaterThan(0);
      for (const preset of template.allowedDeadlinePresets) {
        expect(PROTECTED_TRANSFER_DEADLINE_PRESETS).toContain(preset);
      }
      expect(template.allowedDeadlinePresets).toContain(template.defaultDeadlinePreset);
    }
  });

  it("required capabilities are known and unique", () => {
    for (const template of listProtectedTransferTemplates()) {
      for (const cap of template.requiredCapabilities) {
        expect(PROTECTED_TRANSFER_TEMPLATE_CAPABILITY_ORDER).toContain(cap);
      }
      expect(new Set(template.requiredCapabilities).size).toBe(template.requiredCapabilities.length);
    }
  });

  it("medicine_pickup requires all six capabilities", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup");
    expect(medicine).toBeDefined();
    expect(medicine!.requiredCapabilities).toEqual(ALL_CAPS);
  });

  it("medicine_pickup defaults to three_days and never offers tomorrow", () => {
    // Safety: a quote issued before 09:00 PHT with a 24h (tomorrow) hold can
    // expire before next-day pickup even opens. The medicine template must
    // default to three_days and must not offer tomorrow unless runtime
    // validation proves the deadline outlasts pickup close.
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    expect(medicine.defaultDeadlinePreset).toBe("three_days");
    expect(medicine.allowedDeadlinePresets).not.toContain("tomorrow");
    expect(medicine.allowedDeadlinePresets).toContain("three_days");
  });

  it("non-medicine templates preserve their existing deadline defaults", () => {
    // Only the medicine default changes; every other purpose keeps its
    // previously shipped default and allowed set.
    const family = getProtectedTransferTemplate("family_support")!;
    expect(family.defaultDeadlinePreset).toBe("seven_days");
    expect(family.allowedDeadlinePresets).toEqual([
      "tomorrow",
      "three_days",
      "seven_days",
    ]);
    const tuition = getProtectedTransferTemplate("tuition")!;
    expect(tuition.defaultDeadlinePreset).toBe("seven_days");
    const relief = getProtectedTransferTemplate("relief")!;
    expect(relief.defaultDeadlinePreset).toBe("three_days");
  });

  it("non-medicine templates do not require pharmacy_network", () => {
    for (const template of listProtectedTransferTemplates()) {
      if (template.id === "medicine_pickup") continue;
      expect(template.requiredCapabilities).not.toContain("pharmacy_network");
    }
  });

  it("every template declares the four core capabilities", () => {
    const core: ProtectedTransferTemplateCapability[] = [
      "mapped_recipient",
      "verified_quote",
      "protected_transfer",
      "human_reviewer",
    ];
    for (const template of listProtectedTransferTemplates()) {
      for (const cap of core) {
        expect(template.requiredCapabilities).toContain(cap);
      }
    }
  });

  it("getProtectedTransferTemplate returns undefined for unknown id", () => {
    expect(getProtectedTransferTemplate("nope")).toBeUndefined();
    expect(getProtectedTransferTemplate("")).toBeUndefined();
    // @ts-expect-error non-string
    expect(getProtectedTransferTemplate(123)).toBeUndefined();
  });

  it("getProtectedTransferTemplate returns the same frozen registry reference", () => {
    const a = getProtectedTransferTemplate("tuition");
    const b = getProtectedTransferTemplate("tuition");
    expect(a).toBe(b);
    expect(a).toBe(listProtectedTransferTemplates()[2]);
  });

  it("templates do not claim verified/live/partnered status in self-description", () => {
    const forbidden = ["verified", "live", "partnered", "partner", "mock", "simulation"];
    for (const template of listProtectedTransferTemplates()) {
      // Self-description only; evidence checklist may legitimately use
      // "verified" as an evidence criterion (e.g. identity verified).
      const blob = [
        template.customerLabel,
        template.promise,
        template.suggestedPurpose,
        template.reviewerRoleLabel,
      ].join(" ").toLowerCase();
      for (const word of forbidden) {
        expect(blob).not.toContain(word);
      }
    }
  });
});

describe("evaluateProtectedTransferTemplateCapabilities", () => {
  it("returns ok when all required capabilities are available", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    const result = evaluateProtectedTransferTemplateCapabilities(medicine, ALL_CAPS);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns missing capabilities in canonical order", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    // Provide out-of-order and partial; missing must come back in canonical order.
    const result = evaluateProtectedTransferTemplateCapabilities(medicine, [
      "human_reviewer",
      "mapped_recipient",
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      "verified_quote",
      "protected_transfer",
      "evidence_council",
      "pharmacy_network",
    ]);
  });

  it("ignores unknown capabilities in the available set", () => {
    const tuition = getProtectedTransferTemplate("tuition")!;
    const available = [
      "mapped_recipient",
      "verified_quote",
      "protected_transfer",
      "human_reviewer",
      "time_travel",
    ] as unknown as ProtectedTransferTemplateCapability[];
    const result = evaluateProtectedTransferTemplateCapabilities(tuition, available);
    expect(result.ok).toBe(true);
  });

  it("family_support requires evidence_council but not pharmacy_network", () => {
    const family = getProtectedTransferTemplate("family_support")!;
    const ok = evaluateProtectedTransferTemplateCapabilities(family, [
      "mapped_recipient",
      "verified_quote",
      "protected_transfer",
      "human_reviewer",
      "evidence_council",
    ]);
    expect(ok.ok).toBe(true);
    const missing = evaluateProtectedTransferTemplateCapabilities(family, [
      "mapped_recipient",
      "verified_quote",
      "protected_transfer",
      "human_reviewer",
    ]);
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(["evidence_council"]);
  });

  it("evaluation result is frozen", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    const result = evaluateProtectedTransferTemplateCapabilities(medicine, []);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.missing)).toBe(true);
  });
});

describe("prepareProtectedTransferTemplate", () => {
  function okPrepare(
    templateId: string,
    deadlinePreset: string,
    reviewerDisplayLabel: string,
    customerNote: string,
  ) {
    return prepareProtectedTransferTemplate({
      templateId,
      deadlinePreset,
      reviewerDisplayLabel,
      customerNote,
    });
  }

  it("prepares a family_support mission with the default preset", () => {
    const result = okPrepare(
      "family_support",
      "seven_days",
      "Auntie Linda",
      "Monthly support for rent",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prepared = result.prepared;
    expect(prepared.templateId).toBe("family_support");
    expect(prepared.deadlinePreset).toBe("seven_days");
    expect(prepared.reviewNote).toBe("Monthly support for rent");
    expect(prepared.purpose).toBe("Family support");
    expect(prepared.reviewerRoleLabel).toBe("Family reviewer");
    expect(prepared.reviewerDisplayLabel).toBe("Auntie Linda");
    expect(prepared.evidenceChecklist).toEqual([
      "Recipient identity confirmed",
      "Agreed use of funds noted",
      "Reviewer approval recorded",
      "Settlement receipt captured",
    ]);
    expect(prepared.requiredCapabilities).toContain("evidence_council");
    expect(prepared.requiredCapabilities).not.toContain("pharmacy_network");
  });

  it("prepares a medicine_pickup mission with the three_days default preset", () => {
    const result = okPrepare(
      "medicine_pickup",
      "three_days",
      "Pharmacy reviewer",
      "Pickup for family member",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.templateId).toBe("medicine_pickup");
    expect(result.prepared.deadlinePreset).toBe("three_days");
    expect(result.prepared.requiredCapabilities).toEqual(ALL_CAPS);
  });

  it("rejects the tomorrow preset for medicine_pickup (unsafe before 09:00 PHT)", () => {
    const result = okPrepare(
      "medicine_pickup",
      "tomorrow",
      "Pharmacy reviewer",
      "Pickup for family member",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("deadline_not_allowed");
  });

  it("rejects an unknown template id", () => {
    const result = okPrepare("ghost", "tomorrow", "R", "note");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_template");
  });

  it("rejects a deadline preset not allowed by the template", () => {
    // medicine_pickup allows only three_days.
    const result = okPrepare(
      "medicine_pickup",
      "seven_days",
      "Reviewer",
      "note",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("deadline_not_allowed");
  });

  it("rejects a deadline preset that is not a spine preset at all", () => {
    const result = okPrepare("tuition", "one_year", "Reviewer", "note");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("deadline_not_allowed");
  });

  it("rejects an empty reviewer display label", () => {
    const result = okPrepare("tuition", "seven_days", "   ", "note");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_reviewer_label");
  });

  it("rejects a reviewer display label over 80 code points", () => {
    const long = "x".repeat(81);
    const result = okPrepare("tuition", "seven_days", long, "note");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_reviewer_label");
  });

  it("rejects a reviewer display label with control characters", () => {
    const result = okPrepare("tuition", "seven_days", "Bad\nLabel", "note");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_reviewer_label");
  });

  it("rejects an empty customer note", () => {
    const result = okPrepare("tuition", "seven_days", "Reviewer", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_note");
  });

  it("rejects a customer note over 120 code points", () => {
    const long = "x".repeat(121);
    const result = okPrepare("tuition", "seven_days", "Reviewer", long);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_note");
  });

  it("rejects a customer note with control characters", () => {
    const result = okPrepare("tuition", "seven_days", "Reviewer", "line\nbreak");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_note");
  });

  it("trims reviewer label and customer note", () => {
    const result = okPrepare(
      "relief",
      "three_days",
      "  Relief reviewer  ",
      "  Urgent relief  ",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.reviewerDisplayLabel).toBe("Relief reviewer");
    expect(result.prepared.reviewNote).toBe("Urgent relief");
  });

  it("accepts a 120-code-point customer note (exact boundary)", () => {
    const note = "x".repeat(120);
    const result = okPrepare("relief", "three_days", "Reviewer", note);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.reviewNote).toBe(note);
  });

  it("accepts an 80-code-point reviewer label (exact boundary)", () => {
    const label = "y".repeat(80);
    const result = okPrepare("relief", "three_days", label, "note");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.reviewerDisplayLabel).toBe(label);
  });

  it("returns a deeply frozen prepared object", () => {
    const result = okPrepare("relief", "three_days", "Reviewer", "note");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.prepared)).toBe(true);
    expect(Object.isFrozen(result.prepared.evidenceChecklist)).toBe(true);
    expect(Object.isFrozen(result.prepared.requiredCapabilities)).toBe(true);
  });

  it("prepared requiredCapabilities match the template registry reference", () => {
    const template = getProtectedTransferTemplate("relief")!;
    const result = okPrepare("relief", "three_days", "Reviewer", "note");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prepared.requiredCapabilities).toBe(template.requiredCapabilities);
    expect(result.prepared.evidenceChecklist).toBe(template.evidenceChecklist);
  });

  it("rejects a non-object input", () => {
    // @ts-expect-error invalid input shape
    const result = prepareProtectedTransferTemplate(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_template");
  });

  it("does not solicit medicine names, diagnoses, or prescription content in template copy", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    const blob = [
      medicine.customerLabel,
      medicine.promise,
      medicine.suggestedPurpose,
      medicine.reviewerRoleLabel,
      ...medicine.evidenceChecklist,
    ].join(" ").toLowerCase();
    for (const word of ["diagnosis", "prescription", "dosage", "mg"]) {
      expect(blob).not.toContain(word);
    }
  });
});
