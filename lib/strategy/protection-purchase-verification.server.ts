import "server-only";

import {
  OPTION_BOOK_ABI,
  buildPriceFeedSymbolMap,
  getChainConfigById,
} from "@thetanuts-finance/thetanuts-client";
import {
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  isHexString,
  keccak256,
} from "ethers";
import {
  ProtectionPurchaseVerifyRequestSchema,
  ProtectionPurchaseVerifyResponseSchema,
  type ProtectionPurchaseVerifyRequest,
  type ProtectionPurchaseVerifyResponse,
} from "./protection-purchase-receipt";
import {
  PROTECTION_PURCHASE_CHAIN_ID,
  buildProtectionPurchasePlanId,
} from "./protection-purchase";

export const PROTECTION_PURCHASE_VERIFY_TIMEOUT_MS = 6_000;
const BASE_MAINNET_RPC_URL = "https://base-rpc.publicnode.com";

interface BaseLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface ProtectionPurchaseTransaction {
  hash: string;
  from: string;
  to: string | null;
  data: string;
  value: bigint;
  chainId: bigint;
}

export interface ProtectionPurchaseTransactionReceipt {
  hash: string;
  from: string;
  to: string | null;
  status: number | null;
  blockNumber: number;
  logs: readonly BaseLog[];
}

export interface ProtectionPurchaseVerificationReader {
  getTransaction(hash: string): Promise<ProtectionPurchaseTransaction | null>;
  getTransactionReceipt(
    hash: string,
  ): Promise<ProtectionPurchaseTransactionReceipt | null>;
  getBlockTimestamp(blockNumber: number): Promise<number | null>;
}

export type ProtectionPurchaseVerificationReaderFactory =
  () => ProtectionPurchaseVerificationReader;

const TEST_READER_FACTORY: {
  current: ProtectionPurchaseVerificationReaderFactory | null;
} = { current: null };

export function __setProtectionPurchaseVerificationReaderFactoryForTest(
  factory: ProtectionPurchaseVerificationReaderFactory | null,
): void {
  TEST_READER_FACTORY.current = factory;
}

function createReader(): ProtectionPurchaseVerificationReader {
  if (TEST_READER_FACTORY.current) return TEST_READER_FACTORY.current();
  const provider = new JsonRpcProvider(
    BASE_MAINNET_RPC_URL,
    PROTECTION_PURCHASE_CHAIN_ID,
    {
    staticNetwork: true,
    },
  );
  return {
    getTransaction: async (hash) => {
      const tx = await provider.getTransaction(hash);
      if (!tx) return null;
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chainId: tx.chainId,
      };
    },
    getTransactionReceipt: async (hash) => {
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt) return null;
      return {
        hash: receipt.hash,
        from: receipt.from,
        to: receipt.to,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
        })),
      };
    },
    getBlockTimestamp: async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      return block?.timestamp ?? null;
    },
  };
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function safeResponse(
  response: ProtectionPurchaseVerifyResponse,
): ProtectionPurchaseVerifyResponse {
  return ProtectionPurchaseVerifyResponseSchema.parse(response);
}

function rejected(
  reason: Extract<ProtectionPurchaseVerifyResponse, { kind: "rejected" }>["reason"],
): ProtectionPurchaseVerifyResponse {
  return safeResponse({ kind: "rejected", reason });
}

function asTuple(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function bigintField(tuple: Record<string, unknown>, key: string): bigint | null {
  const value = tuple[key];
  return typeof value === "bigint" ? value : null;
}

function stringField(tuple: Record<string, unknown>, key: string): string | null {
  const value = tuple[key];
  return typeof value === "string" ? value : null;
}

function booleanField(tuple: Record<string, unknown>, key: string): boolean | null {
  const value = tuple[key];
  return typeof value === "boolean" ? value : null;
}

function bigintArrayField(
  tuple: Record<string, unknown>,
  key: string,
): bigint[] | null {
  const value = tuple[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "bigint")) {
    return null;
  }
  return value;
}

function sameDecimal(actual: bigint | null, expected: string): boolean {
  return actual !== null && actual.toString() === expected;
}

function sameAddress(actual: string | null, expected: string): boolean {
  return actual !== null && normalizeAddress(actual) === expected;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("BASE_RPC_TIMEOUT")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function evaluateProtectionPurchaseVerification(input: {
  request: ProtectionPurchaseVerifyRequest;
  transaction: ProtectionPurchaseTransaction;
  receipt: ProtectionPurchaseTransactionReceipt;
  executionBlockTimestampSeconds: number;
  checkedAt?: string;
}): ProtectionPurchaseVerifyResponse {
  const parsedRequest = ProtectionPurchaseVerifyRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) return rejected("invalid_request");
  const request = parsedRequest.data;
  const { transaction, receipt } = input;
  const plan = request.plan;
  const { planId, ...planContent } = plan;
  if (buildProtectionPurchasePlanId(planContent) !== planId) {
    return rejected("invalid_request");
  }
  const config = getChainConfigById(PROTECTION_PURCHASE_CHAIN_ID);
  const configuredOptionBook = config.contracts.optionBook?.toLowerCase();
  const configuredUsdc = config.tokens.USDC?.address.toLowerCase();
  const configuredPut = config.implementations.PUT?.toLowerCase();
  if (
    !configuredOptionBook ||
    !configuredUsdc ||
    !configuredPut ||
    plan.optionBook !== configuredOptionBook ||
    plan.collateralToken !== configuredUsdc
  ) {
    return rejected("transaction_mismatch");
  }

  if (
    transaction.hash.toLowerCase() !== request.txHash ||
    receipt.hash.toLowerCase() !== request.txHash ||
    normalizeAddress(transaction.from) !== plan.account ||
    normalizeAddress(receipt.from) !== plan.account ||
    normalizeAddress(transaction.to ?? "") !== configuredOptionBook ||
    normalizeAddress(receipt.to ?? "") !== configuredOptionBook ||
    transaction.chainId !== BigInt(PROTECTION_PURCHASE_CHAIN_ID) ||
    transaction.value !== 0n ||
    receipt.status !== 1 ||
    !isHexString(transaction.data) ||
    keccak256(transaction.data).toLowerCase() !== plan.fillDataHash
  ) {
    return rejected(receipt.status === 0 ? "failed_transaction" : "transaction_mismatch");
  }

  const executionTimestamp = input.executionBlockTimestampSeconds;
  if (
    !Number.isSafeInteger(receipt.blockNumber) ||
    receipt.blockNumber < 0 ||
    !Number.isSafeInteger(executionTimestamp) ||
    executionTimestamp < 0 ||
    executionTimestamp > Math.floor(Number.MAX_SAFE_INTEGER / 1_000) ||
    BigInt(executionTimestamp) >= BigInt(plan.signedOrderExpirySeconds) ||
    BigInt(executionTimestamp) >= BigInt(plan.expirySeconds)
  ) {
    return rejected("transaction_mismatch");
  }

  const iface = new Interface(OPTION_BOOK_ABI);
  let decoded: ReturnType<Interface["parseTransaction"]>;
  try {
    decoded = iface.parseTransaction({ data: transaction.data, value: transaction.value });
  } catch {
    return rejected("transaction_mismatch");
  }
  if (!decoded || decoded.name !== "fillOrder") {
    return rejected("transaction_mismatch");
  }
  const order = asTuple(decoded.args[0]);
  const signature = typeof decoded.args[1] === "string" ? decoded.args[1] : null;
  const referrer = typeof decoded.args[2] === "string" ? decoded.args[2] : null;
  if (!order || !signature || !referrer) return rejected("transaction_mismatch");

  const strikes = bigintArrayField(order, "strikes");
  const priceFeed = stringField(order, "priceFeed");
  const priceFeedSymbols = buildPriceFeedSymbolMap(PROTECTION_PURCHASE_CHAIN_ID);
  const resolvedAsset = priceFeed ? priceFeedSymbols[normalizeAddress(priceFeed)] : undefined;
  if (
    !sameAddress(stringField(order, "maker"), plan.maker) ||
    !sameDecimal(bigintField(order, "orderExpiryTimestamp"), plan.signedOrderExpirySeconds) ||
    !sameAddress(stringField(order, "collateral"), plan.collateralToken) ||
    booleanField(order, "isCall") !== false ||
    resolvedAsset !== plan.asset ||
    !sameAddress(stringField(order, "implementation"), configuredPut) ||
    booleanField(order, "isLong") !== true ||
    !strikes ||
    strikes.map(String).join(",") !== plan.strikes8d.join(",") ||
    !sameDecimal(bigintField(order, "expiry"), plan.expirySeconds) ||
    !sameDecimal(bigintField(order, "price"), plan.pricePerContract8d) ||
    !sameDecimal(bigintField(order, "numContracts"), plan.numContractsMicro) ||
    stringField(order, "extraOptionData") !== "0x" ||
    keccak256(signature).toLowerCase() !== plan.signatureHash ||
    normalizeAddress(referrer) !== plan.referrer
  ) {
    return rejected("transaction_mismatch");
  }

  const eventFragment = iface.getEvent("OrderFilled");
  if (!eventFragment) return rejected("event_mismatch");
  const exactLogs = receipt.logs.filter(
    (log) =>
      normalizeAddress(log.address) === configuredOptionBook &&
      log.topics[0]?.toLowerCase() === eventFragment.topicHash.toLowerCase(),
  );
  if (exactLogs.length === 0) return rejected("event_mismatch");
  if (exactLogs.length !== 1) return rejected("ambiguous_event");

  let parsedLog: ReturnType<Interface["parseLog"]>;
  try {
    parsedLog = iface.parseLog(exactLogs[0]!);
  } catch {
    return rejected("event_mismatch");
  }
  if (!parsedLog || parsedLog.name !== "OrderFilled") {
    return rejected("event_mismatch");
  }
  const args = parsedLog.args;
  const nonce = typeof args.nonce === "bigint" ? args.nonce : null;
  const buyer = typeof args.buyer === "string" ? args.buyer : null;
  const seller = typeof args.seller === "string" ? args.seller : null;
  const optionAddress =
    typeof args.optionAddress === "string" ? args.optionAddress : null;
  const premiumAmount =
    typeof args.premiumAmount === "bigint" ? args.premiumAmount : null;
  const feeCollected =
    typeof args.feeCollected === "bigint" ? args.feeCollected : null;
  const eventReferrer =
    typeof args.referrer === "string" ? args.referrer : null;
  const referralFeePaid =
    typeof args.referralFeePaid === "bigint" ? args.referralFeePaid : null;
  const sellerWasMaker =
    typeof args.sellerWasMaker === "boolean" ? args.sellerWasMaker : null;
  if (
    nonce === null ||
    premiumAmount === null ||
    feeCollected === null ||
    referralFeePaid === null ||
    eventReferrer === null
  ) {
    return rejected("event_mismatch");
  }
  if (
    !sameDecimal(nonce, plan.nonce) ||
    !sameAddress(buyer, plan.account) ||
    !sameAddress(seller, plan.maker) ||
    !optionAddress ||
    normalizeAddress(optionAddress) === ZeroAddress ||
    !sameDecimal(premiumAmount, plan.estimatedPremiumMicro) ||
    feeCollected < 0n ||
    referralFeePaid < 0n ||
    !sameAddress(eventReferrer, plan.referrer) ||
    sellerWasMaker !== true
  ) {
    return rejected("event_mismatch");
  }

  return safeResponse({
    kind: "verified",
    network: "base-mainnet",
    chainId: PROTECTION_PURCHASE_CHAIN_ID,
    txHash: request.txHash,
    blockNumber: receipt.blockNumber,
    buyerAddress: plan.account,
    makerAddress: plan.maker,
    optionAddress: normalizeAddress(optionAddress),
    nonce: nonce.toString(),
    premiumAmountMicro: premiumAmount.toString(),
    feeCollectedMicro: feeCollected.toString(),
    referralFeePaidMicro: referralFeePaid.toString(),
    referrerAddress: normalizeAddress(eventReferrer),
    sellerWasMaker: true,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  });
}

export async function verifyProtectionPurchaseOnBase(
  request: ProtectionPurchaseVerifyRequest,
): Promise<ProtectionPurchaseVerifyResponse> {
  const parsedRequest = ProtectionPurchaseVerifyRequestSchema.safeParse(request);
  if (!parsedRequest.success) return rejected("invalid_request");
  request = parsedRequest.data;
  const reader = createReader();
  try {
    const evidence = await withTimeout(
      (async () => {
        const [transactionResult, receiptResult] = await Promise.allSettled([
          reader.getTransaction(request.txHash),
          reader.getTransactionReceipt(request.txHash),
        ]);
        if (
          receiptResult.status === "fulfilled" &&
          receiptResult.value?.status === 0 &&
          receiptResult.value.hash.toLowerCase() === request.txHash
        ) {
          return { failedTransaction: true as const };
        }
        if (transactionResult.status === "rejected" || receiptResult.status === "rejected") {
          throw new Error("BASE_RPC_UNAVAILABLE");
        }
        const transaction = transactionResult.value;
        const receipt = receiptResult.value;
        if (!transaction || !receipt) return { transaction, receipt, blockTimestamp: null };
        if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
          throw new Error("INVALID_RECEIPT_BLOCK");
        }
        const blockTimestamp = await reader.getBlockTimestamp(receipt.blockNumber);
        return { transaction, receipt, blockTimestamp };
      })(),
      PROTECTION_PURCHASE_VERIFY_TIMEOUT_MS,
    );
    if ("failedTransaction" in evidence) {
      return rejected("failed_transaction");
    }
    if (!evidence.transaction || !evidence.receipt) {
      return safeResponse({ kind: "pending", reason: "transaction_not_found" });
    }
    if (evidence.blockTimestamp === null) {
      return safeResponse({ kind: "unavailable", reason: "rpc_unavailable" });
    }
    return evaluateProtectionPurchaseVerification({
      request,
      transaction: evidence.transaction,
      receipt: evidence.receipt,
      executionBlockTimestampSeconds: evidence.blockTimestamp,
    });
  } catch {
    return safeResponse({ kind: "unavailable", reason: "rpc_unavailable" });
  }
}
