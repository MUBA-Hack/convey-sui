import { NextResponse } from "next/server";
import { gonkaConfigFromEnv } from "@/lib/gonka";
import {
  createFamilyStewardManifest,
  createGonkaFamilyStewardRouter,
  type GonkaFamilyStewardRouter,
} from "@/lib/gonka/family-steward";
import { parseDecisionProofResult, type DecisionProofResult } from "@/lib/gonka/decision-proof";
import type { GonkaAdapterConfig } from "@/lib/gonka/types";
import {
  RiskCouncilAssessmentSchema,
  RiskCouncilContextSchema,
  assessCompanionRisk,
} from "@/lib/companion/risk-council";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";

const RECEIPT_ORIGIN = "https://api.gonkarouter.io";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_REQUEST_BYTES = 16_384;

export type CompanionRiskRouterFactory = (config: GonkaAdapterConfig) => GonkaFamilyStewardRouter;

const TEST_FACTORY: { current: CompanionRiskRouterFactory | null } = { current: null };

export function __setCompanionRiskRouterFactoryForTest(factory: CompanionRiskRouterFactory | null): void {
  TEST_FACTORY.current = factory;
}

function reviewerModels(env: NodeJS.ProcessEnv): [string, string] | null {
  const first = env.GONKA_FAMILY_STEWARD_MODEL_A?.trim() ?? "";
  const second = env.GONKA_FAMILY_STEWARD_MODEL_B?.trim() ?? "";
  return first && second && first !== second ? [first, second] : null;
}

function nonLive(status: "local_fallback" | "unavailable", reason: string): DecisionProofResult {
  return parseDecisionProofResult({ status, reason }, [RECEIPT_ORIGIN]);
}

async function runReview(
  factory: CompanionRiskRouterFactory,
  config: GonkaAdapterConfig,
  message: string,
): Promise<DecisionProofResult> {
  try {
    const result = await factory(config).run({
      prompt: message,
      localeHint: "en",
      manifest: createFamilyStewardManifest(message),
    });
    if (result.type !== "gonka-run-ok" || result.metadata.responseModel !== config.modelId) {
      return nonLive("unavailable", "provider_error");
    }
    const candidate = result.candidate;
    const evidence = candidate.signals.length > 0
      ? candidate.signals.map((signal) => ({ id: signal.id, text: signal.text, occurrence: signal.occurrence }))
      : [{ id: "request", text: message.slice(0, 128), occurrence: 1 }];
    const decision = candidate.uncertain || candidate.confidence < 0.7
      ? "uncertain"
      : candidate.signals.length > 0
        ? "deny"
        : "confirm";
    return parseDecisionProofResult(
      {
        status: "live",
        modelId: result.metadata.responseModel,
        requestId: result.metadata.gonkaRequestId,
        decision,
        evidence,
        observedAt: new Date().toISOString(),
        origin: RECEIPT_ORIGIN,
      },
      [RECEIPT_ORIGIN],
      message,
    );
  } catch {
    return nonLive("unavailable", "provider_error");
  }
}

export async function POST(request: Request) {
  const raw = await readBoundedUtf8Body(request, MAX_REQUEST_BYTES);
  if (raw === null) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const context = RiskCouncilContextSchema.safeParse(decoded);
  if (!context.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });

  const { config, configured } = gonkaConfigFromEnv(process.env);
  const models = reviewerModels(process.env);
  let firstReview: DecisionProofResult;
  let secondReview: DecisionProofResult;
  if (!configured || models === null) {
    firstReview = nonLive("local_fallback", "not_configured");
    secondReview = nonLive("local_fallback", "not_configured");
  } else {
    const factory = TEST_FACTORY.current ?? ((modelConfig) => createGonkaFamilyStewardRouter(modelConfig));
    [firstReview, secondReview] = await Promise.all([
      runReview(factory, { ...config, modelId: models[0] }, context.data.message),
      runReview(factory, { ...config, modelId: models[1] }, context.data.message),
    ]);
  }
  const assessment = assessCompanionRisk({ context: context.data, firstReview, secondReview });
  return NextResponse.json(RiskCouncilAssessmentSchema.parse(assessment), { headers: NO_STORE_HEADERS });
}
