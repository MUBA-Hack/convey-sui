import { describe, expect, it } from "vitest";
import {
  aggregateEvidenceCouncil,
  evaluateEvidenceCouncilChecks,
  resolveEvidenceCouncilCandidate,
  type EvidenceCouncilContext,
  type EvidenceCouncilModelReview,
} from "@/lib/remittance/evidence-council";
import {
  buildEvidenceCouncilArtifactExport,
  computeEvidenceCouncilArtifactDigest,
  EvidenceCouncilArtifactSchema,
  type EvidenceCouncilArtifact,
} from "@/lib/remittance/evidence-council-client";

const NOW = 1_700_000_000_000;
const TEXT =
  "Ana received PHP 6,104.00 for school supplies. Receipt RC-42 confirms fulfillment.";

function context(overrides: Partial<EvidenceCouncilContext> = {}): EvidenceCouncilContext {
  return {
    evidenceText: TEXT,
    recipient: "Ana",
    purpose: "school supplies",
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    amountMicro: "109000000",
    deadlineMs: NOW + 3_600_000,
    createdDigest: "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR",
    escrowObjectId: "0x" + "55".repeat(32),
    createdCheckedAt: new Date(NOW - 1_000).toISOString(),
    assessedAtMs: NOW,
    ...overrides,
  };
}

function review(
  reviewer: "a" | "b",
  overrides: Partial<EvidenceCouncilModelReview["candidate"]> = {},
): EvidenceCouncilModelReview {
  return {
    candidate: {
      facts: [
        { id: "recipient", text: "Ana", occurrence: 1 },
        { id: "amount", text: "PHP 6,104.00", occurrence: 1 },
        { id: "purpose", text: "school supplies", occurrence: 1 },
        { id: "fulfillment", text: "confirms fulfillment", occurrence: 1 },
      ],
      questionIds: [],
      confidence: 0.94,
      uncertain: false,
      ...overrides,
    },
    metadata: {
      gonkaRequestId: `request-${reviewer}`,
      responseModel: `provider/model-${reviewer}`,
      latencyMs: 25,
      usage: {},
    },
  };
}

describe("Evidence Council", () => {
  it("resolves exact Unicode code-point spans rather than trusting model offsets", () => {
    const evidenceText = "🧾 Ana paid PHP 6,104.00";
    const spans = resolveEvidenceCouncilCandidate(
      {
        facts: [{ id: "recipient", text: "Ana", occurrence: 1 }],
        questionIds: [],
        confidence: 0.9,
        uncertain: false,
      },
      evidenceText,
    );

    expect(spans).toEqual([{ id: "recipient", start: 2, end: 5, text: "Ana" }]);
    expect(() =>
      resolveEvidenceCouncilCandidate(
        {
          facts: [{ id: "recipient", text: "Ana", occurrence: 2 }],
          questionIds: [],
          confidence: 0.9,
          uncertain: false,
        },
        evidenceText,
      ),
    ).toThrow(/occurrence/i);
  });

  it("checks recipient, exact currency amount, and purpose without model authority", () => {
    expect(evaluateEvidenceCouncilChecks(context())).toEqual([
      { id: "recipient", status: "matched" },
      { id: "amount", status: "matched" },
      { id: "purpose", status: "matched" },
    ]);
    expect(
      evaluateEvidenceCouncilChecks(
        context({ evidenceText: "Banana receipt for PHP 6,104.00" }),
      ),
    ).toEqual([
      { id: "recipient", status: "missing" },
      { id: "amount", status: "matched" },
      { id: "purpose", status: "missing" },
    ]);
  });

  it("returns a stable advisory artifact only after distinct models corroborate bound facts", () => {
    const input = { context: context(), first: review("a"), second: review("b") };
    const first = aggregateEvidenceCouncil(input);
    const second = aggregateEvidenceCouncil(input);

    expect(first.kind).toBe("ready_for_human_review");
    expect(second).toEqual(first);
    if (first.kind !== "ready_for_human_review") return;
    expect(first.advisoryOnly).toBe(true);
    expect(first.artifact.artifactDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.artifact.evidenceTextDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.artifact.reviews.map((item) => item.responseModel)).toEqual([
      "provider/model-a",
      "provider/model-b",
    ]);
    expect(first.artifact.questionIds).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/approved|authorized|safe/i);
    expect(
      EvidenceCouncilArtifactSchema.safeParse({
        ...first.artifact,
        recipient: "Someone else",
      }).success,
    ).toBe(false);
  });

  it("fails to questions when deterministic bindings do not match", () => {
    const result = aggregateEvidenceCouncil({
      context: context({ evidenceText: TEXT.replace("6,104.00", "6,105.00") }),
      first: review("a", {
        facts: [
          { id: "recipient", text: "Ana", occurrence: 1 },
          { id: "purpose", text: "school supplies", occurrence: 1 },
        ],
      }),
      second: review("b", {
        facts: [
          { id: "recipient", text: "Ana", occurrence: 1 },
          { id: "purpose", text: "school supplies", occurrence: 1 },
        ],
      }),
    });

    expect(result.kind).toBe("questions_needed");
    if (result.kind !== "questions_needed") return;
    expect(result.reason).toBe("deterministic_mismatch");
    expect(result.questionIds).toContain("confirm_amount");
  });

  it("surfaces model disagreement and never promotes a partial review", () => {
    const disputed = aggregateEvidenceCouncil({
      context: context(),
      first: review("a"),
      second: review("b", {
        facts: [
          { id: "recipient", text: "Ana", occurrence: 1 },
          { id: "amount", text: "6,104.00", occurrence: 1 },
          { id: "purpose", text: "school supplies", occurrence: 1 },
        ],
      }),
    });
    expect(disputed.kind).toBe("disputed");

    const partial = aggregateEvidenceCouncil({
      context: context(),
      first: review("a"),
      second: null,
    });
    expect(partial).toMatchObject({
      kind: "questions_needed",
      reason: "partial_review",
      artifact: null,
    });
  });

  it("rejects stale Created evidence and the exact post-deadline boundary", () => {
    expect(
      aggregateEvidenceCouncil({
        context: context({
          createdCheckedAt: new Date(NOW - 60_001).toISOString(),
        }),
        first: review("a"),
        second: review("b"),
      }),
    ).toEqual({
      kind: "rejected",
      advisoryOnly: true,
      reason: "created_not_verified",
    });

    expect(
      aggregateEvidenceCouncil({
        context: context({ deadlineMs: NOW - 1 }),
        first: review("a"),
        second: review("b"),
      }),
    ).toEqual({
      kind: "rejected",
      advisoryOnly: true,
      reason: "deadline_passed",
    });
  });
});

describe("buildEvidenceCouncilArtifactExport", () => {
  function readyArtifact(): EvidenceCouncilArtifact {
    const result = aggregateEvidenceCouncil({
      context: context(),
      first: review("a"),
      second: review("b"),
    });
    if (result.kind !== "ready_for_human_review") {
      throw new Error(`Expected ready artifact, received ${result.kind}.`);
    }
    return result.artifact;
  }

  it("exports a schema-valid artifact whose digest is recomputable from the JSON", () => {
    const artifact = readyArtifact();
    const exported = buildEvidenceCouncilArtifactExport(artifact);
    if (exported === null) throw new Error("Expected a portable export.");
    expect(exported.filename).toMatch(/^convey-evidence-council-[0-9a-f]{12}\.json$/);

    const reparsed = EvidenceCouncilArtifactSchema.parse(JSON.parse(exported.json));
    const { artifactDigest, ...payload } = reparsed;
    expect(computeEvidenceCouncilArtifactDigest(payload)).toBe(artifactDigest);
    expect(artifactDigest).toBe(artifact.artifactDigest);
  });

  it("refuses to export an artifact whose digest no longer matches its content", () => {
    const artifact = readyArtifact();
    const tampered: EvidenceCouncilArtifact = { ...artifact, recipient: "Someone else" };
    expect(buildEvidenceCouncilArtifactExport(tampered)).toBeNull();
  });
});
