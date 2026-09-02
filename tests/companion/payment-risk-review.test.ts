import { describe, expect, it } from "vitest";
import { paymentRiskReviewCopy } from "@/components/companion/payment-risk-review";
import { RiskCouncilAssessmentSchema } from "@/lib/companion/risk-council";

const sourceMessage = "Pay Dave 12 USDC for dinner";

function assessment(status: "live_agreement" | "partial", action: "continue" | "hold") {
  const live = {
    modelId: "reviewer-a",
    requestId: "req-a",
    decision: "confirm" as const,
    observedAt: "2026-09-02T00:00:00.000Z",
    origin: "https://api.gonkarouter.io",
    evidenceSpans: [{ id: "request", start: 0, end: sourceMessage.length, text: sourceMessage }],
  };
  return RiskCouncilAssessmentSchema.parse({
    sourceMessage,
    outcome: "needs_confirmation",
    action,
    advisoryOnly: true,
    signals: [],
    questionIds: action === "hold" ? ["review_request_details"] : ["confirm_request_before_payment"],
    aiCouncil: {
      status,
      reviews: status === "live_agreement"
        ? [live, { ...live, modelId: "reviewer-b", requestId: "req-b" }]
        : [live],
    },
  });
}

describe("paymentRiskReviewCopy", () => {
  it("explains aligned reviews without implementation jargon", () => {
    const copy = paymentRiskReviewCopy(assessment("live_agreement", "continue"));
    expect(copy).toMatch(/two independent reviews are aligned/i);
    expect(copy).not.toMatch(/gonka|model|sdk/i);
  });

  it("asks for confirmation when a review is incomplete", () => {
    expect(paymentRiskReviewCopy(assessment("partial", "hold"))).toMatch(/pause and confirm/i);
  });

  it("does not present deterministic checks as a live second opinion", () => {
    const local = RiskCouncilAssessmentSchema.parse({
      sourceMessage,
      outcome: "needs_confirmation",
      action: "continue",
      advisoryOnly: true,
      signals: [],
      questionIds: ["confirm_request_before_payment"],
      aiCouncil: { status: "unavailable", reviews: [] },
    });
    expect(paymentRiskReviewCopy(local)).toMatch(/live second opinion is unavailable/i);
  });
});
