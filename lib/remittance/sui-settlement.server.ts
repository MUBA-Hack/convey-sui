import "server-only";

import { TransactionError, type SuiClientTypes } from "@mysten/sui/client";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import type { RemittanceReceiptDocument } from "./receipt-proof";
import {
  SuiSettlementVerificationResponseSchema,
  type SuiSettlementVerificationResponse,
} from "./sui-settlement-response";
import { verifySettlement } from "./sui-settlement-verification";

export { SuiSettlementVerificationResponseSchema };
export type { SuiSettlementVerificationResponse };

export const SUI_SETTLEMENT_TIMEOUT_MS = 6_000;
const SUI_TESTNET_RPC_URL = "https://sui-testnet-rpc.publicnode.com";

type SettlementTransactionResult = SuiClientTypes.TransactionResult<{
  balanceChanges: true;
}>;

export interface SuiSettlementReader {
  getTransaction(input: {
    digest: string;
    include: {
      effects: true;
      balanceChanges: true;
      transaction: true;
    };
    signal: AbortSignal;
  }): Promise<SettlementTransactionResult>;
}

export type SuiSettlementReaderFactory = () => SuiSettlementReader;

const TEST_READER_FACTORY: { current: SuiSettlementReaderFactory | null } = {
  current: null,
};

export function __setSuiSettlementReaderFactoryForTest(
  factory: SuiSettlementReaderFactory | null,
): void {
  TEST_READER_FACTORY.current = factory;
}

function createReader(): SuiSettlementReader {
  if (TEST_READER_FACTORY.current) return TEST_READER_FACTORY.current();
  const client = new SuiJsonRpcClient({
    network: "testnet",
    url: SUI_TESTNET_RPC_URL,
  });
  return {
    getTransaction: (input) => client.core.getTransaction(input),
  };
}

function safeResponse(
  response: SuiSettlementVerificationResponse,
): SuiSettlementVerificationResponse {
  return SuiSettlementVerificationResponseSchema.parse(response);
}

export async function verifyReceiptSettlementOnSui(
  receipt: RemittanceReceiptDocument,
): Promise<SuiSettlementVerificationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUI_SETTLEMENT_TIMEOUT_MS);

  try {
    const result = await createReader().getTransaction({
      digest: receipt.settlement.digest,
      include: {
        effects: true,
        balanceChanges: true,
        transaction: true,
      },
      signal: controller.signal,
    });
    const evidence = verifySettlement({
      expectedDigest: receipt.settlement.digest,
      expectedRecipientAddress: receipt.settlement.recipientAddress,
      expectedUsdcMicro: receipt.settlement.usdcMicro,
      result,
    });

    if (evidence.kind === "verified") {
      return safeResponse({
        kind: "verified",
        network: "testnet",
        digest: evidence.digest,
        coinType: USDC_COIN_TYPE_TESTNET,
        recipientAddress: evidence.recipientAddress,
        receivedMicro: evidence.usdcMicro.toString(),
        checkedAt: new Date().toISOString(),
      });
    }
    if (evidence.kind === "failed") {
      return safeResponse({ kind: "rejected", reason: "failed" });
    }
    return safeResponse({
      kind: "rejected",
      reason: evidence.reason,
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
