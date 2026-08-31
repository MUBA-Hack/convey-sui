/**
 * Server-only Protected Transfer terminal verification.
 *
 * Fixed to Sui testnet, read-only, at most one bounded transaction lookup,
 * events only, six-second abort, existing server-only config. Never signs,
 * submits, or accepts a client RPC/network/coin override. Typed `not_found`
 * for a missing digest; every other failure -> safe `unavailable`.
 */
import "server-only";

import { ObjectError, TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import { resolveProtectedTransferConfig } from "./protected-transfer-config.server";
import {
  evaluateProtectedTransferTerminal,
  ProtectedTransferTerminalVerifyResponseSchema,
  type ProtectedTransferTerminalVerifyRequest,
  type ProtectedTransferTerminalVerifyResponse,
} from "./protected-transfer-terminal";
import {
  evaluateProtectedTransferOpen,
  ProtectedTransferOpenResponseSchema,
  type ProtectedTransferOpenRequest,
  type ProtectedTransferOpenResponse,
} from "./protected-transfer-open";

export const PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS = 6_000;
const SUI_TESTNET_RPC_URL = "https://sui-testnet-rpc.publicnode.com";

type TerminalTransactionResult = SuiClientTypes.TransactionResult<{ events: true }>;

export interface ProtectedTransferTerminalReader {
  getTransaction(input: {
    digest: string;
    include: { events: true };
    signal: AbortSignal;
  }): Promise<TerminalTransactionResult>;
}

export type ProtectedTransferTerminalReaderFactory = () => ProtectedTransferTerminalReader;

const TEST_READER_FACTORY: { current: ProtectedTransferTerminalReaderFactory | null } = {
  current: null,
};

export function __setProtectedTransferTerminalReaderFactoryForTest(
  factory: ProtectedTransferTerminalReaderFactory | null,
): void {
  TEST_READER_FACTORY.current = factory;
}

function createReader(): ProtectedTransferTerminalReader {
  if (TEST_READER_FACTORY.current) return TEST_READER_FACTORY.current();
  const client = new SuiJsonRpcClient({ network: "testnet", url: SUI_TESTNET_RPC_URL });
  return { getTransaction: (input) => client.core.getTransaction(input) };
}

function safeResponse(
  response: ProtectedTransferTerminalVerifyResponse,
): ProtectedTransferTerminalVerifyResponse {
  return ProtectedTransferTerminalVerifyResponseSchema.parse(response);
}

export async function verifyProtectedTransferTerminalOnSui(
  request: ProtectedTransferTerminalVerifyRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProtectedTransferTerminalVerifyResponse> {
  const configResult = resolveProtectedTransferConfig(env);
  if (!configResult.ok) {
    return safeResponse({ kind: "rejected", reason: "not_configured" });
  }
  const { packageId } = configResult.config;
  if (packageId !== request.packageId) {
    return safeResponse({ kind: "rejected", reason: "not_configured" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS);
  try {
    const result = await createReader().getTransaction({
      digest: request.digest,
      include: { events: true },
      signal: controller.signal,
    });
    const evidence = evaluateProtectedTransferTerminal({
      expectation: request,
      packageId,
      result,
    });
    if (evidence.kind === "rejected") return safeResponse(evidence);
    return safeResponse({
      kind: "verified",
      network: "testnet",
      action: evidence.action,
      digest: evidence.digest,
      escrowObjectId: evidence.escrowObjectId,
      actorAddress: evidence.actorAddress,
      payerAddress: evidence.payerAddress,
      beneficiaryAddress: evidence.beneficiaryAddress,
      reviewerAddress: evidence.reviewerAddress,
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

// === Open-state seam ===

type OpenObjectResponse = SuiClientTypes.GetObjectResponse<{ content: true }>;

export interface ProtectedTransferOpenReader {
  getObject(input: {
    objectId: string;
    include: { content: true };
    signal: AbortSignal;
  }): Promise<OpenObjectResponse>;
}

export type ProtectedTransferOpenReaderFactory = () => ProtectedTransferOpenReader;

const TEST_OPEN_READER_FACTORY: { current: ProtectedTransferOpenReaderFactory | null } = {
  current: null,
};

export function __setProtectedTransferOpenReaderFactoryForTest(
  factory: ProtectedTransferOpenReaderFactory | null,
): void {
  TEST_OPEN_READER_FACTORY.current = factory;
}

function createOpenReader(): ProtectedTransferOpenReader {
  if (TEST_OPEN_READER_FACTORY.current) return TEST_OPEN_READER_FACTORY.current();
  const client = new SuiJsonRpcClient({ network: "testnet", url: SUI_TESTNET_RPC_URL });
  return { getObject: (input) => client.core.getObject(input) };
}

function safeOpenResponse(
  response: ProtectedTransferOpenResponse,
): ProtectedTransferOpenResponse {
  return ProtectedTransferOpenResponseSchema.parse(response);
}

/**
 * One bounded read-only shared-object lookup against the Created anchor.
 * Object absent/deleted -> `terminal_unknown` (never optimistic open). Any
 * field/type mismatch -> `rejected`. Provider/timeout/shape failure ->
 * `unavailable`. Never signs, submits, or accepts a client override.
 */
export async function readProtectedTransferOpenOnSui(
  request: ProtectedTransferOpenRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProtectedTransferOpenResponse> {
  const configResult = resolveProtectedTransferConfig(env);
  if (!configResult.ok) {
    return safeOpenResponse({ kind: "rejected", reason: "not_configured" });
  }
  const { packageId } = configResult.config;
  if (packageId !== request.packageId) {
    return safeOpenResponse({ kind: "rejected", reason: "not_configured" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROTECTED_TRANSFER_TERMINAL_TIMEOUT_MS);
  try {
    const response = await createOpenReader().getObject({
      objectId: request.escrowObjectId,
      include: { content: true },
      signal: controller.signal,
    });
    const object = response.object;
    const evidence = evaluateProtectedTransferOpen({
      expectation: request,
      packageId,
      object,
    });
    if (evidence.kind === "open") {
      return safeOpenResponse({
        kind: "open",
        network: "testnet",
        escrowObjectId: evidence.escrowObjectId,
        packageId,
        payerAddress: evidence.payerAddress,
        beneficiaryAddress: evidence.beneficiaryAddress,
        reviewerAddress: evidence.reviewerAddress,
        coinType: USDC_COIN_TYPE_TESTNET,
        amountMicro: evidence.amountMicro,
        deadlineMs: evidence.deadlineMs,
        evidenceCommitmentHex: evidence.evidenceCommitmentHex,
        heldBalanceMicro: evidence.heldBalanceMicro,
        checkedAt: new Date().toISOString(),
      });
    }
    return safeOpenResponse(evidence);
  } catch (error) {
    if (error instanceof ObjectError && (error.reason === "notFound" || error.reason === "deleted")) {
      return safeOpenResponse({ kind: "terminal_unknown", reason: "object_absent" });
    }
    return safeOpenResponse({ kind: "unavailable", reason: "rpc_unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}
