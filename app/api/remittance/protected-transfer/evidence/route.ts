import { NextResponse } from "next/server";
import { gonkaConfigFromEnv } from "@/lib/gonka";
import type { GonkaAdapterConfig } from "@/lib/gonka/types";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import {
  aggregateEvidenceCouncil,
  createEvidenceCouncilManifest,
  createGonkaEvidenceCouncilRouter,
  type EvidenceCouncilModelReview,
  type GonkaEvidenceCouncilRouter,
} from "@/lib/remittance/evidence-council";
import {
  EVIDENCE_COUNCIL_REQUEST_MAX_BYTES,
  EvidenceCouncilRequestSchema,
  EvidenceCouncilResponseSchema,
  type EvidenceCouncilResponse,
} from "@/lib/remittance/evidence-council-client";
import { verifyProtectedTransferCreatedOnSui } from "@/lib/remittance/protected-transfer-created.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export type GonkaEvidenceCouncilRouterFactory = (
  config: GonkaAdapterConfig,
) => GonkaEvidenceCouncilRouter;

const TEST_ROUTER_FACTORY: {
  current: GonkaEvidenceCouncilRouterFactory | null;
} = { current: null };

export function __setGonkaEvidenceCouncilRouterFactoryForTest(
  factory: GonkaEvidenceCouncilRouterFactory | null,
): void {
  TEST_ROUTER_FACTORY.current = factory;
}

function response(body: EvidenceCouncilResponse) {
  return NextResponse.json(EvidenceCouncilResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

function rejected(reason: Extract<EvidenceCouncilResponse, { kind: "rejected" }>["reason"]) {
  return response({ kind: "rejected", advisoryOnly: true, reason });
}

function modelIds(env: NodeJS.ProcessEnv): [string, string] | null {
  const first = env.GONKA_FAMILY_STEWARD_MODEL_A?.trim() ?? "";
  const second = env.GONKA_FAMILY_STEWARD_MODEL_B?.trim() ?? "";
  if (first.length === 0 || second.length === 0 || first === second) return null;
  return [first, second];
}

async function runModel(
  factory: GonkaEvidenceCouncilRouterFactory,
  config: GonkaAdapterConfig,
  evidenceText: string,
): Promise<EvidenceCouncilModelReview | null> {
  try {
    const result = await factory(config).run({
      prompt: evidenceText,
      localeHint: "ms",
      manifest: createEvidenceCouncilManifest(evidenceText),
    });
    if (
      result.type !== "gonka-run-ok" ||
      result.metadata.responseModel !== config.modelId
    ) {
      return null;
    }
    return { candidate: result.candidate, metadata: result.metadata };
  } catch {
    return null;
  }
}

function receiptMatchesFreshCheck(
  request: ReturnType<typeof EvidenceCouncilRequestSchema.parse>,
  verified: Extract<
    Awaited<ReturnType<typeof verifyProtectedTransferCreatedOnSui>>,
    { kind: "verified" }
  >,
): boolean {
  const transfer = request.createdReceipt.transfer;
  return (
    verified.digest === transfer.digest &&
    verified.escrowObjectId === transfer.escrowObjectId &&
    verified.payerAddress === transfer.payerAddress &&
    verified.beneficiaryAddress === transfer.beneficiaryAddress &&
    verified.reviewer.address === transfer.reviewerAddress &&
    verified.reviewer.name === transfer.reviewerName &&
    verified.coinType === transfer.coinType &&
    verified.amountMicro === transfer.amountMicro &&
    verified.deadlineMs === transfer.deadlineMs &&
    verified.evidenceCommitmentHex === transfer.evidenceCommitmentHex
  );
}

export async function POST(req: Request) {
  const raw = await readBoundedUtf8Body(req, EVIDENCE_COUNCIL_REQUEST_MAX_BYTES);
  if (raw === null) return rejected("invalid_request");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rejected("invalid_request");
  }
  const request = EvidenceCouncilRequestSchema.safeParse(body);
  if (!request.success) return rejected("invalid_request");

  const transfer = request.data.createdReceipt.transfer;
  const created = await verifyProtectedTransferCreatedOnSui({
    digest: transfer.digest,
    payerAddress: transfer.payerAddress,
    beneficiaryAddress: transfer.beneficiaryAddress,
    amountMicro: transfer.amountMicro,
    deadlineMs: transfer.deadlineMs,
    evidenceCommitmentHex: transfer.evidenceCommitmentHex,
  });
  if (created.kind === "not_found") return rejected("created_not_found");
  if (created.kind === "unavailable") return rejected("created_check_unavailable");
  if (created.kind === "rejected") return rejected("created_not_verified");
  if (!receiptMatchesFreshCheck(request.data, created)) return rejected("receipt_mismatch");

  const assessedAtMs = Date.now();
  if (!Number.isSafeInteger(assessedAtMs) || assessedAtMs > created.deadlineMs) {
    return rejected("deadline_passed");
  }

  const ids = modelIds(process.env);
  const { config: commonConfig, configured } = gonkaConfigFromEnv(process.env);
  if (!configured || ids === null) {
    return response({ kind: "unavailable", advisoryOnly: true, reason: "not_configured" });
  }

  const factory =
    TEST_ROUTER_FACTORY.current ??
    ((config: GonkaAdapterConfig) => createGonkaEvidenceCouncilRouter(config));
  const [first, second] = await Promise.all([
    runModel(factory, { ...commonConfig, modelId: ids[0] }, request.data.evidenceText),
    runModel(factory, { ...commonConfig, modelId: ids[1] }, request.data.evidenceText),
  ]);

  return response(
    aggregateEvidenceCouncil({
      context: {
        evidenceText: request.data.evidenceText,
        recipient: request.data.createdReceipt.plan.authorization.recipient,
        purpose: request.data.createdReceipt.plan.authorization.purpose,
        youPayMinor: request.data.createdReceipt.plan.authorization.youPayMinor,
        familyReceivesMinor:
          request.data.createdReceipt.plan.authorization.familyReceivesMinor,
        amountMicro: created.amountMicro,
        deadlineMs: created.deadlineMs,
        createdDigest: created.digest,
        escrowObjectId: created.escrowObjectId,
        createdCheckedAt: created.checkedAt,
        assessedAtMs,
      },
      first,
      second,
    }),
  );
}
