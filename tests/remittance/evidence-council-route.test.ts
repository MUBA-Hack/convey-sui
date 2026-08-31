import { bcs as suiBcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setGonkaEvidenceCouncilRouterFactoryForTest,
  POST,
} from "@/app/api/remittance/protected-transfer/evidence/route";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import {
  EVIDENCE_COUNCIL_REQUEST_MAX_BYTES,
  EvidenceCouncilResponseSchema,
  requestEvidenceCouncilReview,
} from "@/lib/remittance/evidence-council-client";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferCreatedVerifyResponse } from "@/lib/remittance/protected-transfer-created";
import {
  buildProtectedTransferCreatedReceipt,
  type ProtectedTransferCreatedReceiptDocument,
} from "@/lib/remittance/protected-transfer-created-receipt";
import {
  __setProtectedTransferCreatedReaderFactoryForTest,
  type ProtectedTransferCreatedReader,
} from "@/lib/remittance/protected-transfer-created.server";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const MODEL_A = "provider/model-a";
const MODEL_B = "provider/model-b";
const TEXT = "Ana received PHP 6,104.00 for school supplies.";

const Created = suiBcs.struct("Created", {
  id: suiBcs.Address,
  payer: suiBcs.Address,
  beneficiary: suiBcs.Address,
  reviewer: suiBcs.Address,
  amount: suiBcs.u64(),
  deadline: suiBcs.u64(),
  evidence_commitment: suiBcs.vector(suiBcs.u8()),
});

function authorization(): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: BENEFICIARY,
    usdcMicro: "109000000",
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: "R-ABCD1234",
    issuedAt: NOW,
    expiresAt: NOW + 120_000,
    corridor: { source: "MYR", destination: "PHP" },
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    totalFeeMinor: "950",
    myrPerUsdc: "450",
    phpPerUsdc: "5600",
    fixedFeeMyr: "200",
    feeBps: 150,
    recipient: "Ana",
    destinationCity: "manila",
    purpose: "school supplies",
    maximumFamilyLimitMinor: "52000",
  };
}

function fixture(): {
  receipt: ProtectedTransferCreatedReceiptDocument;
  chainResult: SuiClientTypes.TransactionResult<{ events: true }>;
} {
  const plan: ProtectedTransferExecutionPlan = {
    kind: "protected_transfer_execution_plan",
    authorization: authorization(),
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    reviewerName: "Convey Review",
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
    reviewNote: "Hold until Ana confirms delivery",
  };
  const metadata = buildProtectedTransfer({ plan, sender: PAYER, nowMs: NOW }).metadata;
  const verification: Extract<
    ProtectedTransferCreatedVerifyResponse,
    { kind: "verified" }
  > = {
    kind: "verified",
    network: "testnet",
    digest: DIGEST,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewer: { name: "Convey Review", address: REVIEWER },
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "109000000",
    deadlineMs: plan.deadlineMs,
    evidenceCommitmentHex: metadata.commitmentHex,
    checkedAt: new Date(NOW + 30_000).toISOString(),
  };
  const receipt = buildProtectedTransferCreatedReceipt({
    verification,
    plan,
    metadata,
    exportedAt: new Date(NOW + 40_000).toISOString(),
  });
  const chainResult: SuiClientTypes.TransactionResult<{ events: true }> = {
    $kind: "Transaction",
    Transaction: {
      digest: DIGEST,
      signatures: [],
      epoch: null,
      status: { success: true, error: null },
      events: [
        {
          packageId: PACKAGE,
          module: "protected_transfer",
          sender: PAYER,
          eventType: `${PACKAGE}::protected_transfer::Created<${USDC_COIN_TYPE_TESTNET}>`,
          bcs: Created.serialize({
            id: ESCROW,
            payer: PAYER,
            beneficiary: BENEFICIARY,
            reviewer: REVIEWER,
            amount: "109000000",
            deadline: plan.deadlineMs.toString(),
            evidence_commitment: metadata.commitmentBytes,
          }).toBytes(),
          json: null,
        },
      ],
      balanceChanges: undefined,
      effects: undefined,
      objectTypes: undefined,
      transaction: undefined,
      bcs: undefined,
    },
  };
  return { receipt, chainResult };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/remittance/protected-transfer/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function modelSuccess(model: string, requestId: string) {
  return {
    type: "gonka-run-ok" as const,
    candidate: {
      facts: [
        { id: "recipient" as const, text: "Ana", occurrence: 1 },
        { id: "amount" as const, text: "PHP 6,104.00", occurrence: 1 },
        { id: "purpose" as const, text: "school supplies", occurrence: 1 },
      ],
      questionIds: [],
      confidence: 0.95,
      uncertain: false,
    },
    metadata: {
      gonkaRequestId: requestId,
      responseModel: model,
      latencyMs: 20,
      usage: {},
    },
    attempts: [],
  };
}

const getTransaction = vi.fn<ProtectedTransferCreatedReader["getTransaction"]>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW + 60_000);
  getTransaction.mockReset();
  __setProtectedTransferCreatedReaderFactoryForTest(() => ({ getTransaction }));
  __setGonkaEvidenceCouncilRouterFactoryForTest(null);
  vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", PACKAGE);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_ADDRESS", REVIEWER);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "Convey Review");
  vi.stubEnv("GONKA_ROUTER_API_KEY", "test-key");
  vi.stubEnv("GONKA_ROUTER_BASE_URL", "https://provider.invalid/v1");
  vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_A", MODEL_A);
  vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_B", MODEL_B);
});

afterEach(() => {
  __setProtectedTransferCreatedReaderFactoryForTest(null);
  __setGonkaEvidenceCouncilRouterFactoryForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST Protected Transfer evidence council", () => {
  it("rejects malformed and oversized requests before RPC or models", async () => {
    const factory = vi.fn();
    __setGonkaEvidenceCouncilRouterFactoryForTest(factory);
    for (const body of ["{", "x".repeat(EVIDENCE_COUNCIL_REQUEST_MAX_BYTES + 1)]) {
      const response = await POST(request(body));
      expect(await response.json()).toEqual({
        kind: "rejected",
        advisoryOnly: true,
        reason: "invalid_request",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(getTransaction).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("freshly checks exact Created evidence before starting either model", async () => {
    const { receipt, chainResult } = fixture();
    getTransaction.mockResolvedValue(chainResult);
    vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "Different review desk");
    const factory = vi.fn();
    __setGonkaEvidenceCouncilRouterFactoryForTest(factory);

    const response = await POST(request({ createdReceipt: receipt, evidenceText: TEXT }));

    expect(await response.json()).toEqual({
      kind: "rejected",
      advisoryOnly: true,
      reason: "receipt_mismatch",
    });
    expect(getTransaction).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses two distinct models and returns a strict advisory artifact", async () => {
    const { receipt, chainResult } = fixture();
    getTransaction.mockResolvedValue(chainResult);
    const factory = vi.fn((config: { modelId: string }) => ({
      run: vi.fn().mockResolvedValue(
        config.modelId === MODEL_A
          ? modelSuccess(MODEL_A, "request-a")
          : modelSuccess(MODEL_B, "request-b"),
      ),
    }));
    __setGonkaEvidenceCouncilRouterFactoryForTest(factory as never);

    const response = await POST(request({ createdReceipt: receipt, evidenceText: TEXT }));
    const body: unknown = await response.json();

    expect(EvidenceCouncilResponseSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({ kind: "ready_for_human_review", advisoryOnly: true });
    expect(factory.mock.calls.map(([config]) => config.modelId)).toEqual([MODEL_A, MODEL_B]);
    expect(getTransaction).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toMatch(/test-key|provider\.invalid|approved|authorized/i);
  });

  it("reports configuration absence only after the Created receipt is rechecked", async () => {
    const { receipt, chainResult } = fixture();
    getTransaction.mockResolvedValue(chainResult);
    vi.stubEnv("GONKA_FAMILY_STEWARD_MODEL_B", "");
    const factory = vi.fn();
    __setGonkaEvidenceCouncilRouterFactoryForTest(factory);

    const response = await POST(request({ createdReceipt: receipt, evidenceText: TEXT }));

    expect(await response.json()).toEqual({
      kind: "unavailable",
      advisoryOnly: true,
      reason: "not_configured",
    });
    expect(getTransaction).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("requestEvidenceCouncilReview", () => {
  it("rejects any response outside the strict safe union", async () => {
    const { receipt } = fixture();
    await expect(
      requestEvidenceCouncilReview({
        request: { createdReceipt: receipt, evidenceText: TEXT },
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ kind: "ready_for_human_review", apiKey: "leak" })),
        ),
      }),
    ).rejects.toThrow(/strict schema/i);
  });
});
