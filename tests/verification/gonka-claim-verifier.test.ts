import { describe, expect, it } from "vitest";
import {
  ClaimReviewCandidateSchema,
  createGonkaClaimExtractionRouter,
  type ClaimExtractionCandidate,
} from "@/lib/verification/gonka-claim-verifier.server";
import { fakeFetch } from "../gonka/fake-fetch";

const MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
const SOURCE =
  "Independent auditors confirmed the flood relief fund paid for 42 water filters delivered to three evacuation centres.";

function candidate(claimType: string): ClaimExtractionCandidate | Record<string, unknown> {
  return {
    claim: { text: SOURCE, occurrence: 1 },
    claimType,
    detectedLanguage: "en",
    confidence: 0.95,
  };
}

describe("Gonka claim extraction contract", () => {
  it("names every allowed claim type in both primary and repair instructions", async () => {
    const provider = fakeFetch([
      { kind: "ok", body: candidate("accountability"), requestId: "extract-invalid", model: MODEL },
      { kind: "ok", body: candidate("factual"), requestId: "extract-repaired", model: MODEL },
    ]);
    const router = createGonkaClaimExtractionRouter(
      { apiKey: "test-key", modelId: MODEL, maxRetries: 0 },
      { fetch: provider.fetch as unknown as typeof fetch },
    );

    const result = await router.run({
      prompt: SOURCE,
      localeHint: "en",
      manifest: { sourceText: SOURCE },
    });

    expect(result.type).toBe("gonka-run-ok");
    expect(provider.calls).toHaveLength(2);
    for (const call of provider.calls) {
      const body = call.body as { messages: Array<{ role: string; content: string }> };
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      expect(system).toContain("factual, opinion, prediction, or unverifiable");
    }
  });
});

describe("Gonka claim review contract", () => {
  it("bounds a complete long explanation instead of discarding the review", () => {
    const parsed = ClaimReviewCandidateSchema.safeParse({
      verdict: "supported",
      truthScore: 92,
      reasoningTrace: [
        `The source directly supports the frozen claim. ${"Relevant context. ".repeat(24)}`,
        "A second independently retrieved source reports the same outcome.",
      ],
      evidence: [{ text: SOURCE, occurrence: 1 }],
      limitations: ["The earliest report may be revised as officials publish more detail."],
      confidence: 0.91,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.reasoningTrace[0]?.length : 0).toBeLessThanOrEqual(280);
  });
});
