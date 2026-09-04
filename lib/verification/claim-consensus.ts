import type { GonkaResponseMetadata } from "../gonka/types";
import {
  ClaimVerificationReportSchema,
  type ClaimSource,
  type ClaimVerificationReport,
  type ClaimReviewVerdict,
} from "./claim-report";
import type {
  ClaimExtractionCandidate,
  ClaimReviewCandidate,
} from "./gonka-claim-verifier.server";

export interface SuccessfulClaimRun<TCandidate> {
  candidate: TCandidate;
  metadata: GonkaResponseMetadata;
}

function verdictForScore(score: number, reviews: [ClaimReviewCandidate, ClaimReviewCandidate]): ClaimReviewVerdict {
  if (reviews.every((review) => review.verdict === "insufficient")) return "insufficient";
  if (score >= 75) return "supported";
  if (score >= 40) return "mixed";
  return "unsupported";
}

function uniqueStrings(values: string[], max: number): string[] {
  return [...new Set(values)].slice(0, max);
}

export function aggregateClaimConsensus(input: {
  source: ClaimSource;
  extraction: SuccessfulClaimRun<ClaimExtractionCandidate>;
  first: SuccessfulClaimRun<ClaimReviewCandidate>;
  second: SuccessfulClaimRun<ClaimReviewCandidate>;
  assessedAtMs: number;
}): ClaimVerificationReport | null {
  const requestIds = [
    input.extraction.metadata.gonkaRequestId,
    input.first.metadata.gonkaRequestId,
    input.second.metadata.gonkaRequestId,
  ];
  if (
    new Set(requestIds).size !== requestIds.length ||
    input.first.metadata.responseModel === input.second.metadata.responseModel ||
    !Number.isSafeInteger(input.assessedAtMs) ||
    input.assessedAtMs < 0
  ) {
    return null;
  }

  const reviews: [ClaimReviewCandidate, ClaimReviewCandidate] = [
    input.first.candidate,
    input.second.candidate,
  ];
  const truthScore = Math.round((reviews[0].truthScore + reviews[1].truthScore) / 2);
  const scoreSpread = Math.abs(reviews[0].truthScore - reviews[1].truthScore);
  const aligned = reviews[0].verdict === reviews[1].verdict && scoreSpread <= 15;

  return ClaimVerificationReportSchema.parse({
    kind: "verified_report",
    source: input.source,
    primaryClaim: input.extraction.candidate.claim.text,
    claimType: input.extraction.candidate.claimType,
    truthScore,
    verdict: verdictForScore(truthScore, reviews),
    consensus: { status: aligned ? "aligned" : "contested", scoreSpread },
    reasoningTrace: [
      ...reviews[0].reasoningTrace.map((text) => ({ reviewer: "review_a" as const, text })),
      ...reviews[1].reasoningTrace.map((text) => ({ reviewer: "review_b" as const, text })),
    ],
    evidence: [
      ...reviews[0].evidence.map((entry) => ({ reviewer: "review_a" as const, text: entry.text })),
      ...reviews[1].evidence.map((entry) => ({ reviewer: "review_b" as const, text: entry.text })),
    ],
    limitations: uniqueStrings([...reviews[0].limitations, ...reviews[1].limitations], 8),
    steps: [
      {
        step: "claim_extraction",
        requestId: input.extraction.metadata.gonkaRequestId,
        modelId: input.extraction.metadata.responseModel,
        latencyMs: Math.round(input.extraction.metadata.latencyMs),
      },
      {
        step: "review_a",
        requestId: input.first.metadata.gonkaRequestId,
        modelId: input.first.metadata.responseModel,
        latencyMs: Math.round(input.first.metadata.latencyMs),
      },
      {
        step: "review_b",
        requestId: input.second.metadata.gonkaRequestId,
        modelId: input.second.metadata.responseModel,
        latencyMs: Math.round(input.second.metadata.latencyMs),
      },
    ],
    assessedAt: new Date(input.assessedAtMs).toISOString(),
  });
}
