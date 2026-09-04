import { NextResponse } from "next/server";
import { gonkaConfigFromEnv } from "@/lib/gonka";
import type { GonkaAdapterConfig, GonkaResponseMetadata } from "@/lib/gonka/types";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import { aggregateClaimConsensus } from "@/lib/verification/claim-consensus";
import {
  CLAIM_REPORT_REQUEST_MAX_BYTES,
  ClaimVerificationRequestSchema,
  ClaimVerificationResponseSchema,
  type ClaimVerificationResponse,
} from "@/lib/verification/claim-report";
import {
  createGonkaClaimExtractionRouter,
  createGonkaClaimReviewRouter,
  type ClaimExtractionCandidate,
  type ClaimReviewCandidate,
  type GonkaClaimExtractionRouter,
  type GonkaClaimReviewRouter,
} from "@/lib/verification/gonka-claim-verifier.server";
import { readPublicClaimSource } from "@/lib/verification/public-source.server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export type ClaimExtractionRouterFactory = (
  config: GonkaAdapterConfig,
) => GonkaClaimExtractionRouter;
export type ClaimReviewRouterFactory = (config: GonkaAdapterConfig) => GonkaClaimReviewRouter;

const TEST_FACTORIES: {
  extraction: ClaimExtractionRouterFactory | null;
  review: ClaimReviewRouterFactory | null;
} = { extraction: null, review: null };

export function __setClaimVerificationFactoriesForTest(
  factories: {
    extraction: ClaimExtractionRouterFactory;
    review: ClaimReviewRouterFactory;
  } | null,
): void {
  TEST_FACTORIES.extraction = factories?.extraction ?? null;
  TEST_FACTORIES.review = factories?.review ?? null;
}

function response(body: ClaimVerificationResponse) {
  return NextResponse.json(ClaimVerificationResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

function modelIds(env: NodeJS.ProcessEnv): [string, string] | null {
  const first = (
    env.GONKA_VERIFY_MODEL_A ??
    env.GONKA_FAMILY_STEWARD_MODEL_A ??
    env.GONKA_MODEL_ID ??
    ""
  ).trim();
  const second = (
    env.GONKA_VERIFY_MODEL_B ??
    env.GONKA_FAMILY_STEWARD_MODEL_B ??
    ""
  ).trim();
  if (first.length === 0 || second.length === 0 || first === second) return null;
  return [first, second];
}

type SuccessfulRun<TCandidate> = {
  candidate: TCandidate;
  metadata: GonkaResponseMetadata;
};

async function runExtraction(
  factory: ClaimExtractionRouterFactory,
  config: GonkaAdapterConfig,
  sourceText: string,
): Promise<SuccessfulRun<ClaimExtractionCandidate> | null> {
  try {
    const result = await factory(config).run({
      prompt: sourceText,
      localeHint: "en",
      manifest: { sourceText },
    });
    if (result.type !== "gonka-run-ok" || result.metadata.responseModel !== config.modelId) {
      return null;
    }
    return { candidate: result.candidate, metadata: result.metadata };
  } catch {
    return null;
  }
}

async function runReview(
  factory: ClaimReviewRouterFactory,
  config: GonkaAdapterConfig,
  sourceText: string,
  claimText: string,
): Promise<SuccessfulRun<ClaimReviewCandidate> | null> {
  try {
    const result = await factory(config).run({
      prompt: claimText,
      localeHint: "en",
      manifest: { sourceText, claimText },
    });
    if (result.type !== "gonka-run-ok" || result.metadata.responseModel !== config.modelId) {
      return null;
    }
    return { candidate: result.candidate, metadata: result.metadata };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const raw = await readBoundedUtf8Body(req, CLAIM_REPORT_REQUEST_MAX_BYTES);
  if (raw === null) return response({ kind: "rejected", reason: "invalid_input" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ kind: "rejected", reason: "invalid_input" });
  }
  const parsed = ClaimVerificationRequestSchema.safeParse(body);
  if (!parsed.success) return response({ kind: "rejected", reason: "invalid_input" });

  const source = await readPublicClaimSource(parsed.data);
  if (source.kind === "rejected") return response(source);

  const ids = modelIds(process.env);
  const { config: commonConfig, configured } = gonkaConfigFromEnv(process.env);
  if (!configured || ids === null) {
    return response({ kind: "unavailable", reason: "not_configured" });
  }

  const extractionFactory =
    TEST_FACTORIES.extraction ??
    ((config: GonkaAdapterConfig) => createGonkaClaimExtractionRouter(config));
  const reviewFactory =
    TEST_FACTORIES.review ??
    ((config: GonkaAdapterConfig) => createGonkaClaimReviewRouter(config));

  const extraction = await runExtraction(
    extractionFactory,
    { ...commonConfig, modelId: ids[0] },
    source.sourceText,
  );
  if (extraction === null) return response({ kind: "unavailable", reason: "provider_error" });

  // Gonka applies a low per-key concurrency ceiling. Starting both council
  // members together can reject one with 429 and turn a valid check into a
  // provider error. Keep reviewers independent by model, but execute them in
  // sequence so every accepted request gets a complete audit trail.
  const first = await runReview(
    reviewFactory,
    { ...commonConfig, modelId: ids[0] },
    source.sourceText,
    extraction.candidate.claim.text,
  );
  if (first === null) {
    return response({ kind: "unavailable", reason: "provider_error" });
  }
  const second = await runReview(
    reviewFactory,
    { ...commonConfig, modelId: ids[1] },
    source.sourceText,
    extraction.candidate.claim.text,
  );
  if (second === null) return response({ kind: "unavailable", reason: "provider_error" });

  const report = aggregateClaimConsensus({
    source: source.source,
    extraction,
    first,
    second,
    assessedAtMs: Date.now(),
  });
  return report === null
    ? response({ kind: "unavailable", reason: "insufficient_consensus" })
    : response(report);
}
