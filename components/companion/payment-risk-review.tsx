"use client";

import { useEffect, useState } from "react";
import { ShieldSearch, ShieldTick } from "@/components/icons";
import {
  RiskCouncilAssessmentSchema,
  type RiskCouncilAssessment,
  type RiskCouncilContext,
} from "@/lib/companion/risk-council";

export function paymentRiskReviewCopy(assessment: RiskCouncilAssessment): string {
  if (assessment.action === "reject") return "Payment details do not match. Scan or enter them again.";
  if (assessment.action === "hold") return "Pause and confirm the recipient and amount.";
  if (assessment.aiCouncil.status === "live_agreement") return "Recipient, amount, and two independent reviews are aligned.";
  if (assessment.aiCouncil.status === "live_disagreement" || assessment.aiCouncil.status === "partial") {
    return "One more confirmation is needed before you continue.";
  }
  if (assessment.aiCouncil.status === "unavailable" || assessment.aiCouncil.status === "local") {
    return "Recipient and amount checks passed. Live second opinion is unavailable.";
  }
  return assessment.signals.length === 0
    ? "Saved recipient and amount checks passed."
    : "This request looks unusual. Review it before continuing.";
}

export function PaymentRiskReview({ context }: { context: RiskCouncilContext }) {
  const [assessment, setAssessment] = useState<RiskCouncilAssessment | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/companion/risk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("review_failed");
        const parsed = RiskCouncilAssessmentSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("invalid_review");
        setAssessment(parsed.data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUnavailable(true);
      });
    return () => controller.abort();
  }, [context]);

  const blocked = assessment?.action === "reject";
  return (
    <div className="companion-check-row" role="status">
      {assessment && !blocked ? <ShieldTick size={15} /> : <ShieldSearch size={15} />}
      <span>
        {unavailable
          ? "Live review is unavailable. Confirm the details yourself before continuing."
          : assessment
            ? paymentRiskReviewCopy(assessment)
            : "Checking the recipient and amount…"}
      </span>
    </div>
  );
}
