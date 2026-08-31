import "server-only";

import { TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import { resolveProtectedTransferConfig } from "./protected-transfer-config.server";
import {
  evaluateProtectedTransferCreated,
  ProtectedTransferCreatedVerifyResponseSchema,
  type ProtectedTransferCreatedVerifyRequest,
  type ProtectedTransferCreatedVerifyResponse,
} from "./protected-transfer-created";

export const PROTECTED_TRANSFER_CREATED_TIMEOUT_MS = 6_000;
const SUI_TESTNET_RPC_URL = "https://sui-testnet-rpc.publicnode.com";

type CreatedTransactionResult = SuiClientTypes.TransactionResult<{ events: true }>;

export interface ProtectedTransferCreatedReader {
  getTransaction(input: {
    digest: string;
    include: { events: true };
    signal: AbortSignal;
  }): Promise<CreatedTransactionResult>;
}

export type ProtectedTransferCreatedReaderFactory = () => ProtectedTransferCreatedReader;

const TEST_READER_FACTORY: { current: ProtectedTransferCreatedReaderFactory | null } = {
  current: null,
};

export function __setProtectedTransferCreatedReaderFactoryForTest(
  factory: ProtectedTransferCreatedReaderFactory | null,
): void {
  TEST_READER_FACTORY.current = factory;
}

function createReader(): ProtectedTransferCreatedReader {
  if (TEST_READER_FACTORY.current) return TEST_READER_FACTORY.current();
  const client = new SuiJsonRpcClient({ network: "testnet", url: SUI_TESTNET_RPC_URL });
  return { getTransaction: (input) => client.core.getTransaction(input) };
}

function safeResponse(
  response: ProtectedTransferCreatedVerifyResponse,
): ProtectedTransferCreatedVerifyResponse {
  return ProtectedTransferCreatedVerifyResponseSchema.parse(response);
}

export async function verifyProtectedTransferCreatedOnSui(
  request: ProtectedTransferCreatedVerifyRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProtectedTransferCreatedVerifyResponse> {
  const configResult = resolveProtectedTransferConfig(env);
  if (!configResult.ok) {
    return safeResponse({ kind: "rejected", reason: "not_configured" });
  }
  const { packageId, reviewerAddress, reviewerName } = configResult.config;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROTECTED_TRANSFER_CREATED_TIMEOUT_MS);
  try {
    const result = await createReader().getTransaction({
      digest: request.digest,
      include: { events: true },
      signal: controller.signal,
    });
    const evidence = evaluateProtectedTransferCreated({
      expectation: request,
      packageId,
      reviewerAddress,
      result,
    });
    if (evidence.kind === "rejected") return safeResponse(evidence);
    return safeResponse({
      kind: "verified",
      network: "testnet",
      digest: evidence.digest,
      escrowObjectId: evidence.escrowObjectId,
      payerAddress: evidence.payerAddress,
      beneficiaryAddress: evidence.beneficiaryAddress,
      reviewer: { name: reviewerName, address: evidence.reviewerAddress },
      coinType: USDC_COIN_TYPE_TESTNET,
      amountMicro: evidence.amountMicro,
      deadlineMs: evidence.deadlineMs,
      evidenceCommitmentHex: evidence.evidenceCommitmentHex,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof TransactionError && error.reason === "notFound") {
      return safeResponse({ kind: "not_found", reason: "transaction_not_found" });
    }
    return safeResponse({ kind: "unavailable", reason: "rpc_unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}
