import { describe, expect, it } from "vitest";
import {
  FamilyStewardRequestSchema,
  FamilyStewardResponseSchema,
  aggregateFamilyStewardCouncil,
  buildFamilyStewardLocalFallback,
  type FamilyStewardModelReview,
} from "@/lib/remittance/family-steward";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";

const MESSAGE = "Pay today and keep this secret";

function review(
  model: string,
  requestId: string,
  id: "urgency" | "secrecy",
  text: string,
): FamilyStewardModelReview {
  return {
    candidate: {
      signals: [{ id, text, occurrence: 1 }],
      questionIds: ["verify_sender_in_known_channel"],
      confidence: 0.9,
      uncertain: false,
    },
    metadata: {
      gonkaRequestId: requestId,
      responseModel: model,
      latencyMs: 20,
      usage: {},
    },
  };
}

describe("FamilyStewardRequestSchema", () => {
  it("rejects extra authority fields and overlong message text", () => {
    const quote = {} as QuoteEnvelope;
    expect(
      FamilyStewardRequestSchema.safeParse({
        quote,
        solicitationText: "pay",
        walletAddress: "0x123",
      }).success,
    ).toBe(false);
    expect(
      FamilyStewardRequestSchema.safeParse({ quote, solicitationText: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe("aggregateFamilyStewardCouncil", () => {
  it("returns corroborated evidence only when distinct models agree", () => {
    const first = review("model-a", "request-a", "secrecy", "secret");
    const second = review("model-b", "request-b", "secrecy", "secret");
    const result = aggregateFamilyStewardCouncil({
      solicitationText: MESSAGE,
      first,
      second,
    });

    expect(result.kind).toBe("live_council");
    if (result.kind !== "live_council") return;
    expect(result.assessment).toBe("pause_and_verify");
    expect(result.corroboratedSignals).toHaveLength(1);
    expect(result.disputedSignals).toEqual([]);
    expect(result.reviews.map((item) => item.responseModel)).toEqual([
      "model-a",
      "model-b",
    ]);
    expect(FamilyStewardResponseSchema.parse(result)).toEqual(result);
  });

  it("exposes one-model evidence as disagreement", () => {
    const result = aggregateFamilyStewardCouncil({
      solicitationText: MESSAGE,
      first: review("model-a", "request-a", "urgency", "today"),
      second: review("model-b", "request-b", "secrecy", "secret"),
    });

    expect(result.kind).toBe("live_council");
    if (result.kind !== "live_council") return;
    expect(result.corroboratedSignals).toEqual([]);
    expect(result.disputedSignals.map((item) => item.id)).toEqual([
      "urgency",
      "secrecy",
    ]);
    expect(result.assessment).toBe("review_recommended");
  });

  it("never claims consensus for duplicate model provenance", () => {
    const result = aggregateFamilyStewardCouncil({
      solicitationText: MESSAGE,
      first: review("model-a", "request-a", "secrecy", "secret"),
      second: review("model-a", "request-b", "secrecy", "secret"),
    });

    expect(result.kind).toBe("partial_review");
    if (result.kind !== "partial_review") return;
    expect(result.noConsensus).toBe(true);
  });

  it("never claims consensus for duplicate request provenance", () => {
    const result = aggregateFamilyStewardCouncil({
      solicitationText: MESSAGE,
      first: review("model-a", "same-request", "secrecy", "secret"),
      second: review("model-b", "same-request", "secrecy", "secret"),
    });

    expect(result.kind).toBe("partial_review");
  });

  it("rejects safe-union evidence whose wrapper id differs from its exact span", () => {
    const result = aggregateFamilyStewardCouncil({
      solicitationText: MESSAGE,
      first: review("model-a", "request-a", "secrecy", "secret"),
      second: review("model-b", "request-b", "secrecy", "secret"),
    });
    expect(result.kind).toBe("live_council");
    if (result.kind !== "live_council") return;

    const mismatched = structuredClone(result);
    mismatched.corroboratedSignals[0]!.id = "urgency";
    expect(FamilyStewardResponseSchema.safeParse(mismatched).success).toBe(false);
  });

  it("rejects low-confidence and uncertain reviews", () => {
    const first = review("model-a", "request-a", "secrecy", "secret");
    first.candidate.confidence = 0.4;
    const second = review("model-b", "request-b", "secrecy", "secret");
    second.candidate.uncertain = true;

    expect(
      aggregateFamilyStewardCouncil({ solicitationText: MESSAGE, first, second }),
    ).toEqual(buildFamilyStewardLocalFallback("candidate_rejected"));
  });
});
