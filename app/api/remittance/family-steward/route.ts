import { NextResponse } from "next/server";
import {
  createFamilyStewardManifest,
  createGonkaFamilyStewardRouter,
  type GonkaFamilyStewardRouter,
} from "@/lib/gonka/family-steward";
import { gonkaConfigFromEnv } from "@/lib/gonka";
import type { GonkaAdapterConfig } from "@/lib/gonka/types";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import {
  FAMILY_STEWARD_REQUEST_MAX_BYTES,
  FamilyStewardRequestSchema,
  FamilyStewardResponseSchema,
  aggregateFamilyStewardCouncil,
  buildFamilyStewardLocalFallback,
  buildFamilyStewardRejected,
  type FamilyStewardModelReview,
  type FamilyStewardResponse,
} from "@/lib/remittance/family-steward";
import { verifyAdvisoryRemittanceQuote } from "@/lib/remittance/advisory-quote-verification.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export type GonkaFamilyStewardRouterFactory = (
  config: GonkaAdapterConfig,
) => GonkaFamilyStewardRouter;

const TEST_ROUTER_FACTORY: {
  current: GonkaFamilyStewardRouterFactory | null;
} = { current: null };

export function __setGonkaFamilyStewardRouterFactoryForTest(
  factory: GonkaFamilyStewardRouterFactory | null,
): void {
  TEST_ROUTER_FACTORY.current = factory;
}

function response(body: FamilyStewardResponse) {
  const parsed = FamilyStewardResponseSchema.parse(body);
  return NextResponse.json(parsed, { status: 200, headers: NO_STORE_HEADERS });
}

function modelIds(env: NodeJS.ProcessEnv): [string, string] | null {
  const first = env.GONKA_FAMILY_STEWARD_MODEL_A?.trim() ?? "";
  const second = env.GONKA_FAMILY_STEWARD_MODEL_B?.trim() ?? "";
  if (first.length === 0 || second.length === 0) return null;
  if (first === second) return null;
  return [first, second];
}

function modelReview(
  result: Awaited<ReturnType<GonkaFamilyStewardRouter["run"]>>,
  expectedModelId: string,
): FamilyStewardModelReview | null {
  if (result.type !== "gonka-run-ok") return null;
  if (result.metadata.responseModel !== expectedModelId) return null;
  return { candidate: result.candidate, metadata: result.metadata };
}

async function runModel(
  factory: GonkaFamilyStewardRouterFactory,
  config: GonkaAdapterConfig,
  solicitationText: string,
): Promise<FamilyStewardModelReview | null> {
  try {
    const router = factory(config);
    const result = await router.run({
      prompt: solicitationText,
      localeHint: "ms",
      manifest: createFamilyStewardManifest(solicitationText),
    });
    return modelReview(result, config.modelId);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const raw = await readBoundedUtf8Body(req, FAMILY_STEWARD_REQUEST_MAX_BYTES);
  if (raw === null) return response(buildFamilyStewardRejected("invalid_request"));

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response(buildFamilyStewardRejected("invalid_request"));
  }
  const request = FamilyStewardRequestSchema.safeParse(body);
  if (!request.success) return response(buildFamilyStewardRejected("invalid_request"));

  const quote = verifyAdvisoryRemittanceQuote({
    body: request.data.quote,
    nowMs: Date.now(),
    env: process.env,
  });
  if (quote.kind === "rejected") {
    return response(buildFamilyStewardRejected(quote.reason));
  }
  if (quote.kind !== "verified_advisory") {
    return response(buildFamilyStewardRejected("unverified"));
  }

  const ids = modelIds(process.env);
  const { config: commonConfig, configured } = gonkaConfigFromEnv(process.env);
  if (!configured || ids === null) {
    return response(buildFamilyStewardLocalFallback("not_configured"));
  }

  const factory =
    TEST_ROUTER_FACTORY.current ??
    ((config: GonkaAdapterConfig) => createGonkaFamilyStewardRouter(config));
  const [first, second] = await Promise.all([
    runModel(factory, { ...commonConfig, modelId: ids[0] }, request.data.solicitationText),
    runModel(factory, { ...commonConfig, modelId: ids[1] }, request.data.solicitationText),
  ]);

  if (first === null && second === null) {
    return response(buildFamilyStewardLocalFallback("provider_error"));
  }
  return response(
    aggregateFamilyStewardCouncil({
      solicitationText: request.data.solicitationText,
      first,
      second,
    }),
  );
}
