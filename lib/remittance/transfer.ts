/**
 * Client-signed USDC transfer core for remittance.
 *
 * Pure helpers: address validation, mode gating, transaction construction,
 * result inspection, and quote↔authorization binding. No secrets/HMAC.
 * Product cap is the client-pinned absolute `MAX_USDC_MICRO`.
 */

import { Transaction } from "@mysten/sui/transactions";
import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  isWalletStandardError,
} from "@wallet-standard/errors";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET, U64_MAX } from "./constants";
import {
  ATTESTATION_VERSION,
  type Attestation,
  type CanonicalAuthorization,
  type QuoteEnvelope,
} from "./quote-schema";

export type RemittanceTransferMode = "real" | "prepared";
export type WalletNetwork = "localnet" | "testnet" | "mainnet";
export type QuoteBlocker =
  | "none"
  | "unmapped"
  | "unapproved"
  | "wallet"
  | "wrong-network";

export type RemittanceWalletErrorCode =
  | "rejection"
  | "insufficient"
  | "failure"
  | "expired"
  | "verification"
  | "over_cap";

export interface RemittanceTransferModeInput {
  account: string | null;
  network: WalletNetwork | string;
  authorizedRecipient: string | null;
  attestation: Attestation | null;
}

export interface QuoteReadinessInput {
  account: string | null;
  network: WalletNetwork | string;
  recipientAddress: string | null;
  attestation: Attestation | null;
}

export interface BuildUsdcTransferInput {
  usdcMicro: string;
  recipientAddress: string;
  sender: string;
  coinType: string;
  productCapMicro: bigint;
}

/** Discriminated dAppKit signAndExecuteTransaction result. */
export type SignAndExecuteResult =
  | {
      $kind: "Transaction";
      Transaction: { digest: string; status?: { success?: boolean; error?: { message?: string } | null } };
      FailedTransaction?: never;
    }
  | {
      $kind: "FailedTransaction";
      FailedTransaction: {
        digest: string;
        status?: { success?: boolean; error?: { message?: string } | null };
      };
      Transaction?: never;
    };

/** JSON-RPC waitForTransaction response shape used by SuiJsonRpcClient. */
export interface WaitForTransactionResponse {
  digest?: string;
  effects?: {
    status?: { status?: "success" | "failure"; error?: string };
  } | null;
}

export function validateRecipientAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = normalizeSuiAddress(value.trim());
  return isValidSuiAddress(normalized) ? normalized : null;
}

export function hasValidAttestation(attestation: Attestation | null): boolean {
  if (!attestation) return false;
  if (attestation.v !== ATTESTATION_VERSION) return false;
  return /^0x[0-9a-f]{64}$/.test(attestation.hmac);
}

function hasCanonicalRecipientAddress(value: string | null): boolean {
  if (!value) return false;
  return validateRecipientAddress(value) === value;
}

export function resolveQuoteBlocker(input: QuoteReadinessInput): QuoteBlocker {
  if (!hasCanonicalRecipientAddress(input.recipientAddress)) return "unmapped";
  if (!hasValidAttestation(input.attestation)) return "unapproved";
  if (!input.account) return "wallet";
  if (input.network !== "testnet") return "wrong-network";
  return "none";
}

export function resolveTransferMode(input: RemittanceTransferModeInput): RemittanceTransferMode {
  return resolveQuoteBlocker({
    account: input.account,
    network: input.network,
    recipientAddress: input.authorizedRecipient,
    attestation: input.attestation,
  }) === "none"
    ? "real"
    : "prepared";
}

export function buildUsdcTransfer(input: BuildUsdcTransferInput): Transaction {
  const sender = normalizeSuiAddress(input.sender);
  if (!isValidSuiAddress(sender)) throw new Error("Invalid sender address.");
  const recipient = normalizeSuiAddress(input.recipientAddress);
  if (!isValidSuiAddress(recipient)) throw new Error("Invalid recipient address.");
  if (input.coinType !== USDC_COIN_TYPE_TESTNET) {
    throw new Error("Coin type must be the pinned testnet USDC type.");
  }
  let micro: bigint;
  try {
    micro = BigInt(input.usdcMicro);
  } catch {
    throw new Error("USDC micro amount must be an integer string.");
  }
  if (micro <= 0n) throw new Error("USDC micro amount must be greater than zero.");
  if (micro > U64_MAX) throw new Error("USDC micro amount exceeds u64.");
  if (micro > input.productCapMicro) throw new Error("USDC micro amount exceeds the product cap.");
  const tx = new Transaction();
  tx.setSender(sender);
  const coin = tx.coin({ type: input.coinType, balance: micro });
  tx.transferObjects([coin], recipient);
  return tx;
}

export function isValidDigest(digest: string): boolean {
  return isValidTransactionDigest(digest);
}

export function buildExplorerUrl(digest: string): string {
  return `https://suiscan.testnet.sui.io/tx/${encodeURIComponent(digest)}`;
}

/**
 * Bind a verified authorization to the customer-reviewed quote and client-pinned
 * constants. Any mismatch rejects before the wallet is invoked.
 *
 * The family-rule fields (`purpose`, `maximumFamilyLimitMinor`) are bound here
 * too: a tampered rule is a verification failure. The one core execution
 * invariant — the authorized max cap must not be below the authorized send
 * amount — returns `"over_cap"` so the customer sees an honest, specific
 * rejection rather than a generic verification error.
 */
export function bindAuthorizationToQuote(
  auth: CanonicalAuthorization,
  quote: QuoteEnvelope,
): string | null {
  if (auth.kind !== "authorization") return "verification";
  if (auth.coinType !== USDC_COIN_TYPE_TESTNET) return "verification";
  if (auth.recipientAddress !== quote.recipientAddress) return "verification";
  if (auth.usdcMicro !== quote.usdcMicro) return "verification";
  if (auth.beneficiaryRef !== quote.beneficiaryRef) return "verification";
  if (auth.issuedAt !== quote.issuedAt) return "verification";
  if (auth.expiresAt !== quote.expiresAt) return "verification";
  if (auth.corridor.source !== quote.corridor.source) return "verification";
  if (auth.corridor.destination !== quote.corridor.destination) return "verification";
  if (auth.youPayMinor !== quote.youPayMinor) return "verification";
  if (auth.familyReceivesMinor !== quote.familyReceivesMinor) return "verification";
  if (auth.totalFeeMinor !== quote.totalFeeMinor) return "verification";
  if (auth.myrPerUsdc !== quote.provenance.myrPerUsdc) return "verification";
  if (auth.phpPerUsdc !== quote.provenance.phpPerUsdc) return "verification";
  if (auth.fixedFeeMyr !== quote.provenance.fixedFeeMyr) return "verification";
  if (auth.feeBps !== quote.provenance.feeBps) return "verification";
  if (auth.recipient !== quote.recipient) return "verification";
  if (auth.destinationCity !== quote.destinationCity) return "verification";
  if (auth.purpose !== quote.intentReview.purpose) return "verification";
  if (auth.maximumFamilyLimitMinor !== quote.intentReview.maximumFamilyLimitMinor) {
    return "verification";
  }
  try {
    const micro = BigInt(auth.usdcMicro);
    if (micro <= 0n || micro > MAX_USDC_MICRO) return "verification";
    // Core execution invariant: an authorized family-rule cap must not be
    // below the authorized send amount. This is the single rule boundary the
    // wallet seam enforces — not a broad failure matrix.
    if (
      auth.maximumFamilyLimitMinor !== null &&
      BigInt(auth.maximumFamilyLimitMinor) < BigInt(auth.youPayMinor)
    ) {
      return "over_cap";
    }
  } catch {
    return "verification";
  }
  return null;
}

export function authorizationToTransferInput(
  auth: CanonicalAuthorization,
  sender: string,
): BuildUsdcTransferInput {
  return {
    usdcMicro: auth.usdcMicro,
    recipientAddress: auth.recipientAddress,
    sender,
    coinType: USDC_COIN_TYPE_TESTNET,
    productCapMicro: MAX_USDC_MICRO,
  };
}

/** Structural recognition of a dAppKit FailedTransaction result. */
export function isFailedTransactionResult(result: unknown): result is Extract<
  SignAndExecuteResult,
  { $kind: "FailedTransaction" }
> {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { $kind?: unknown }).$kind === "FailedTransaction" &&
    typeof (result as { FailedTransaction?: { digest?: unknown } }).FailedTransaction?.digest ===
      "string"
  );
}

export function isSuccessfulTransactionResult(result: unknown): result is Extract<
  SignAndExecuteResult,
  { $kind: "Transaction" }
> {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { $kind?: unknown }).$kind === "Transaction" &&
    typeof (result as { Transaction?: { digest?: unknown } }).Transaction?.digest === "string"
  );
}

/**
 * Extract a successful broadcast digest, or null when the result is a known
 * FailedTransaction. Throws only on a malformed union (treated as unknown by
 * the caller after signing starts).
 */
export function extractSuccessfulDigest(result: unknown): string | null {
  if (isFailedTransactionResult(result)) return null;
  if (!isSuccessfulTransactionResult(result)) {
    throw new Error("Malformed sign-and-execute result.");
  }
  // Defence: some clients may still put success=false on a Transaction arm.
  if (result.Transaction.status && result.Transaction.status.success === false) {
    return null;
  }
  return result.Transaction.digest;
}

/** Inspect JSON-RPC waitForTransaction response. Missing effects stays pending. */
export function inspectFinality(
  response: WaitForTransactionResponse | null | undefined,
  expectedDigest: string,
): "success" | "failure" | "pending" {
  if (response?.digest !== expectedDigest) return "pending";
  const status = response?.effects?.status?.status;
  if (status === "success") return "success";
  if (status === "failure") return "failure";
  return "pending";
}

/**
 * Typed wallet rejection only. Wallet Standard REQUEST_REJECTED (4001000).
 * Unrecognized provider text is NOT treated as rejection.
 */
export function isTypedWalletRejection(error: unknown): boolean {
  if (isWalletStandardError(error, WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED)) {
    return true;
  }
  // Support duck-typed copies that preserve name + context without instanceof.
  if (error instanceof Error && error.name === "WalletStandardError") {
    const code = (error as unknown as { context?: { __code?: unknown } }).context?.__code;
    if (code === WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED) return true;
  }
  return false;
}

export function classifyPreSignError(error: unknown): RemittanceWalletErrorCode {
  if (isTypedWalletRejection(error)) return "rejection";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/insufficient/i.test(message)) return "insufficient";
  return "failure";
}
