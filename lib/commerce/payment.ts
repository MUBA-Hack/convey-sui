/**
 * Client-signed SUI payment core (Wave 3, Task 3.1).
 *
 * Pure, network-free helpers that validate payment inputs, resolve whether a
 * real testnet transfer is allowed or an explicit DEMO simulation must run,
 * build a native SUI coin transfer `Transaction`, inspect the wallet result
 * union, classify wallet errors, and produce a deterministic DEMO receipt.
 *
 * No function here signs, broadcasts, or fetches. The component layer wires
 * these helpers to `useDAppKit().signAndExecuteTransaction`. Inputs always
 * originate from a validated `PurchaseIntentPreview`; raw free text never
 * reaches this module.
 */

import { Transaction } from "@mysten/sui/transactions";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";

/** Demo cap: 100 SUI. Real testnet transfers above this are rejected. */
export const MAX_PAYMENT_MIST = 100n * 1_000_000_000n;

export type PaymentMode = "real" | "demo";

export type PaymentErrorCode = "rejection" | "insufficient" | "failure";

/** Wallet network identifiers used by the app's dAppKit registration. */
export type WalletNetwork = "localnet" | "testnet" | "mainnet";

export interface PaymentModeInput {
  /** Connected account address, or null when no wallet is connected. */
  account: string | null;
  /** Current dAppKit network. */
  network: WalletNetwork | string;
  /** Canonical merchant address resolved from NEXT_PUBLIC_MERCHANT_ADDRESS. */
  configuredMerchant: string | null;
  /** Canonical merchant address carried by the validated preview. */
  previewMerchant: string | null;
}

export interface BuildPaymentTransactionInput {
  amountMist: string;
  merchantAddress: string;
  sender: string;
}

export interface DemoReceiptInput {
  amountMist: string;
  merchantAddress: string;
  merchantName: string;
  itemName: string;
  quantity: number;
}

export interface PaymentReceipt {
  mode: PaymentMode;
  /** Real transaction digest, or a `DEMO-…` pseudo-digest for simulation. */
  digest: string;
  /** Explicit simulation flag — never inferred from the digest string. */
  demo: boolean;
  /** Explorer URL for real testnet digests; always null for DEMO. */
  explorerUrl: string | null;
  amountMist: string;
  merchantAddress: string;
  /** Human label; always denotes simulation for demo receipts. */
  label: string;
}

/**
 * Validate and canonicalize a merchant Sui address.
 * Returns the normalized lowercase `0x…` form, or null when invalid.
 */
export function validateMerchantAddress(value: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = normalizeSuiAddress(value.trim());
  return isValidSuiAddress(normalized) ? normalized : null;
}

/**
 * Validate a positive, bounded integer MIST amount string.
 * Returns null when valid, or a human reason when invalid.
 */
export function validateAmountMist(value: string): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return "Amount must be a positive integer in MIST.";
  }
  const mist = BigInt(value.trim());
  if (mist <= 0n) {
    return "Amount must be greater than zero.";
  }
  if (mist >= MAX_PAYMENT_MIST) {
    return "Amount exceeds the demo payment cap of 100 SUI.";
  }
  return null;
}

/**
 * Resolve the payment mode. Real testnet transfer is allowed only when a
 * wallet is connected, the network is testnet, and the configured merchant
 * address canonically matches the merchant carried by the validated preview.
 * Anything else is an explicitly labelled DEMO simulation.
 */
export function resolvePaymentMode(input: PaymentModeInput): PaymentMode {
  if (!input.account) return "demo";
  if (input.network !== "testnet") return "demo";
  if (!input.configuredMerchant || !input.previewMerchant) return "demo";
  // Compare canonical forms so an uppercase/no-0x configured address still
  // matches a lowercase/0x preview address (and vice versa).
  const configured = normalizeSuiAddress(input.configuredMerchant);
  const preview = normalizeSuiAddress(input.previewMerchant);
  if (!isValidSuiAddress(configured) || !isValidSuiAddress(preview)) {
    return "demo";
  }
  if (configured !== preview) return "demo";
  return "real";
}

/**
 * Build a native SUI coin transfer transaction: split the requested amount
 * off the gas coin and transfer it to the merchant. Synchronous and pure —
 * no network, no signer. The caller sets the sender here so the wallet can
 * resolve gas coins at sign time.
 */
export function buildPaymentTransaction(
  input: BuildPaymentTransactionInput,
): Transaction {
  const tx = new Transaction();
  tx.setSender(input.sender);

  const coin = tx.splitCoins(tx.gas, [tx.pure.u64(input.amountMist)]);
  tx.transferObjects([coin], input.merchantAddress);

  return tx;
}

/**
 * Inspect the `signAndExecuteTransaction` result union and return the digest.
 * Throws when the transaction failed on-chain so the component can surface a
 * friendly failure instead of mistaking a failed tx for success.
 */
export function extractDigest(
  result:
    | { $kind: "Transaction"; Transaction: { digest: string } }
    | {
        $kind: "FailedTransaction";
        FailedTransaction: {
          digest: string;
          status: { success: boolean; error: { message?: string } | null };
        };
      },
): string {
  if (result.$kind === "Transaction") {
    return result.Transaction.digest;
  }
  const message = result.FailedTransaction.status.error?.message;
  throw new Error(message ?? "The transaction failed on-chain.");
}

/**
 * Classify a wallet/signing error into a friendly code for the UI.
 */
export function classifyWalletError(error: unknown): PaymentErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/reject|cancel|denied/i.test(message)) return "rejection";
  if (/insufficient/i.test(message)) return "insufficient";
  return "failure";
}

/**
 * Deterministic, non-cryptographic hash (FNV-1a 64-bit) rendered as 16 hex
 * chars. Good enough to make the DEMO pseudo-digest unique per input set and
 * visibly fake (it is prefixed with `DEMO-` and never parsed as a real
 * digest). No crypto dependency is needed for a simulation receipt.
 */
function fnv1aHex(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0").slice(-16);
}

/**
 * Produce a deterministic DEMO receipt. No wallet is called, no chain is
 * touched, and the result is unmistakably labelled as a simulation.
 */
export function createDemoReceipt(input: DemoReceiptInput): PaymentReceipt {
  const fingerprint = fnv1aHex(
    [
      input.amountMist,
      input.merchantAddress,
      input.merchantName,
      input.itemName,
      String(input.quantity),
    ].join("|"),
  );
  return {
    mode: "demo",
    digest: `DEMO-${fingerprint}`,
    demo: true,
    explorerUrl: null,
    amountMist: input.amountMist,
    merchantAddress: input.merchantAddress,
    label: "DEMO simulation — no on-chain settlement",
  };
}

/**
 * Build a Sui testnet explorer URL for a real transaction digest.
 * Returns null for demo mode so the UI never links a fake digest.
 */
export function buildExplorerUrl(mode: PaymentMode, digest: string): string | null {
  if (mode !== "real") return null;
  if (!digest || digest.startsWith("DEMO-")) return null;
  return `https://suiscan.testnet.sui.io/tx/${encodeURIComponent(digest)}`;
}
