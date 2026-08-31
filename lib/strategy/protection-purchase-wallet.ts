import { Interface, keccak256 } from "ethers";
import {
  PROTECTION_PURCHASE_CHAIN_ID,
  PROTECTION_PURCHASE_CHAIN_ID_HEX,
  type ProtectionPurchaseTransaction,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";
import { parseTransactionHash } from "@/lib/strategy/protection-purchase-receipt";

export interface Eip1193Request {
  method: string;
  params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(request: Eip1193Request): Promise<unknown>;
}

export type PreparedWalletTransaction = ProtectionPurchaseTransaction;

export type ProtectionWalletErrorCode =
  | "provider_missing"
  | "account_missing"
  | "account_mismatch"
  | "wrong_chain"
  | "rejected"
  | "invalid_response"
  | "reverted"
  | "transaction_mismatch"
  | "failed";

export class ProtectionWalletError extends Error {
  constructor(
    readonly code: ProtectionWalletErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProtectionWalletError";
  }
}

function errorCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function walletFailure(error: unknown, fallback: ProtectionWalletErrorCode): ProtectionWalletError {
  if (error instanceof ProtectionWalletError) return error;
  if (errorCode(error) === 4001) {
    return new ProtectionWalletError("rejected", "Wallet request canceled.");
  }
  return new ProtectionWalletError(fallback, "The wallet could not complete this request.");
}

function normalizedAddress(value: string): string {
  return value.toLowerCase();
}

const ERC20_APPROVAL_INTERFACE = new Interface([
  "function approve(address spender, uint256 amount)",
]);

export type ProtectionTransactionPurpose = "approval" | "fill";

export function validatePreparedProtectionTransaction(
  purpose: ProtectionTransactionPurpose,
  transaction: PreparedWalletTransaction,
  plan: ProtectionPurchasePlanSummary,
): void {
  const mismatch = () => {
    throw new ProtectionWalletError(
      "transaction_mismatch",
      "The wallet request does not match the reviewed purchase plan.",
    );
  };
  if (
    normalizedAddress(transaction.from) !== normalizedAddress(plan.account) ||
    transaction.chainId !== PROTECTION_PURCHASE_CHAIN_ID_HEX ||
    plan.chainId !== PROTECTION_PURCHASE_CHAIN_ID ||
    transaction.value !== "0x0"
  ) mismatch();

  if (purpose === "fill") {
    if (
      normalizedAddress(transaction.to) !== normalizedAddress(plan.optionBook) ||
      keccak256(transaction.data).toLowerCase() !== plan.fillDataHash.toLowerCase()
    ) mismatch();
    return;
  }

  if (normalizedAddress(transaction.to) !== normalizedAddress(plan.collateralToken)) mismatch();
  try {
    const decoded = ERC20_APPROVAL_INTERFACE.decodeFunctionData("approve", transaction.data);
    if (
      normalizedAddress(String(decoded[0])) !== normalizedAddress(plan.optionBook) ||
      decoded[1] !== BigInt(plan.allowanceAmountMicro)
    ) mismatch();
  } catch (error) {
    if (error instanceof ProtectionWalletError) throw error;
    mismatch();
  }
}

function readAccounts(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ProtectionWalletError("invalid_response", "The wallet returned an invalid account list.");
  }
  return value;
}

function readChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new ProtectionWalletError("invalid_response", "The wallet returned an invalid network.");
  }
  return Number.parseInt(value, 16);
}

export function getInjectedEip1193Provider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { ethereum?: unknown }).ethereum;
  if (!candidate || typeof candidate !== "object" || !("request" in candidate)) return null;
  if (typeof (candidate as { request?: unknown }).request !== "function") return null;
  return candidate as Eip1193Provider;
}

export async function connectBaseWallet(
  provider: Eip1193Provider,
  expectedAccount?: string,
): Promise<string> {
  let accounts: string[];
  try {
    accounts = readAccounts(await provider.request({ method: "eth_accounts" }));
    if (accounts.length === 0) {
      accounts = readAccounts(await provider.request({ method: "eth_requestAccounts" }));
    }
  } catch (error) {
    throw walletFailure(error, "failed");
  }
  const account = accounts[0];
  if (!account) {
    throw new ProtectionWalletError("account_missing", "No wallet account is available.");
  }
  if (expectedAccount && normalizedAddress(account) !== normalizedAddress(expectedAccount)) {
    throw new ProtectionWalletError("account_mismatch", "The connected account changed.");
  }

  let chainId: number;
  try {
    chainId = readChainId(await provider.request({ method: "eth_chainId" }));
    if (chainId !== PROTECTION_PURCHASE_CHAIN_ID) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: PROTECTION_PURCHASE_CHAIN_ID_HEX }],
      });
      chainId = readChainId(await provider.request({ method: "eth_chainId" }));
    }
  } catch (error) {
    throw walletFailure(error, "wrong_chain");
  }
  if (chainId !== PROTECTION_PURCHASE_CHAIN_ID) {
    throw new ProtectionWalletError("wrong_chain", "Switch the wallet to Base.");
  }

  const finalAccounts = readAccounts(await provider.request({ method: "eth_accounts" }));
  if (
    !finalAccounts[0] ||
    normalizedAddress(finalAccounts[0]) !== normalizedAddress(account)
  ) {
    throw new ProtectionWalletError("account_mismatch", "The connected account changed.");
  }
  return account;
}

export async function sendPreparedTransaction(
  provider: Eip1193Provider,
  transaction: PreparedWalletTransaction,
  expectedAccount: string,
  beforeSend?: () => Promise<void>,
): Promise<`0x${string}`> {
  const account = await connectBaseWallet(provider, expectedAccount);
  if (normalizedAddress(transaction.from) !== normalizedAddress(account)) {
    throw new ProtectionWalletError("account_mismatch", "The prepared account does not match the wallet.");
  }

  await beforeSend?.();

  let result: unknown;
  try {
    result = await provider.request({
      method: "eth_sendTransaction",
      params: [transaction],
    });
  } catch (error) {
    throw walletFailure(error, "failed");
  }
  const hash = parseTransactionHash(result);
  if (!hash) {
    throw new ProtectionWalletError("invalid_response", "The wallet did not return a transaction reference.");
  }
  return hash;
}

export interface WalletTransactionReceipt {
  transactionHash: `0x${string}`;
  status: "0x1" | "0x0";
}

export async function waitForWalletTransaction(
  provider: Eip1193Provider,
  hash: `0x${string}`,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<WalletTransactionReceipt | null> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 1_500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (value != null) {
      if (typeof value !== "object" || !("status" in value)) {
        throw new ProtectionWalletError("invalid_response", "The wallet returned an invalid confirmation.");
      }
      const status = (value as { status?: unknown }).status;
      if (status !== "0x1" && status !== "0x0") {
        throw new ProtectionWalletError("invalid_response", "The wallet returned an invalid confirmation.");
      }
      if (status === "0x0") {
        throw new ProtectionWalletError("reverted", "The transaction did not complete.");
      }
      return { transactionHash: hash, status };
    }
    if (attempt + 1 < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
