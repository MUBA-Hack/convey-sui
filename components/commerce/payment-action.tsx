"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { ExportSquare, TickCircle, Warning2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  buildExplorerUrl,
  buildPaymentTransaction,
  classifyWalletError,
  createDemoReceipt,
  extractDigest,
  resolvePaymentMode,
  validateAmountMist,
  validateMerchantAddress,
  type PaymentErrorCode,
  type PaymentReceipt,
} from "@/lib/commerce/payment";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";

export interface PaymentActionProps {
  /** Validated purchase-intent preview; the only source of payment inputs. */
  preview: PurchaseIntentPreview;
  /** Fired when the user presses Cancel. */
  onCancel?: () => void;
  /** Fired with the receipt after a successful real or DEMO settlement. */
  onSettled?: (receipt: PaymentReceipt) => void;
  /**
   * Fired whenever the in-flight wallet resolution enters or leaves the
   * pending state. The hosting dialog uses this to lock its chrome (X /
   * Escape / outside-pointer) so a dismiss mid-pending can never unmount
   * this surface and race a late wallet resolution against settlement.
   */
  onPendingChange?: (pending: boolean) => void;
}

const MIST_PER_SUI = 1_000_000_000n;

const ERROR_MESSAGES: Record<PaymentErrorCode, string> = {
  rejection: "Signature request canceled. No payment was submitted.",
  insufficient: "This wallet does not have enough balance for the payment and gas.",
  failure: "Payment failed. Check the wallet and your balance, then try again.",
};

/** Render an integer MIST amount as a decimal SUI string (no float drift). */
function mistToSui(mist: string): string {
  const n = BigInt(mist);
  const whole = n / MIST_PER_SUI;
  const frac = n % MIST_PER_SUI;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

/** Shorten an address for display while keeping the full value available. */
function shortAddress(addr: string | null): string {
  if (!addr) return "Simulation — no merchant configured";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PaymentAction({ preview, onCancel, onSettled, onPendingChange }: PaymentActionProps) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();

  const [status, setStatus] = useState<"idle" | "pending" | "settled" | "error">("idle");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [errorCode, setErrorCode] = useState<PaymentErrorCode | null>(null);

  // Hard lifecycle stop: a wallet resolution that resolves after this surface
  // unmounted (dialog dismissed/closed, route change, parent re-render) must
  // never invoke onSettled or confirm the originating card. The dialog's
  // chrome lock is defence-in-depth; this guard is the single source of truth.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the configured merchant address from the public env.
  const configuredMerchant = validateMerchantAddress(
    process.env.NEXT_PUBLIC_MERCHANT_ADDRESS ?? "",
  );
  // The preview carries the merchant address the user accepted.
  const previewMerchant = preview.merchant.address
    ? validateMerchantAddress(preview.merchant.address)
    : null;

  const mode = resolvePaymentMode({
    account: account?.address ?? null,
    network,
    configuredMerchant,
    previewMerchant,
  });

  // Validate the amount from the preview (defence in depth — the preview is
  // already validated, but never trust an amount without a positive bound).
  const amountError = validateAmountMist(preview.totalMist);
  const merchantAddress = configuredMerchant ?? previewMerchant;

  const suiAmount = mistToSui(preview.totalMist);

  async function handleConfirm() {
    // Lock once a terminal settlement has landed — the receipt is the end
    // state, so a second confirm can never double-fire a transfer or DEMO
    // receipt. (The hosting dialog also closes on settle, unmounting this
    // surface; this guard is defence-in-depth.)
    if (status === "pending" || status === "settled") return;
    if (amountError) {
      setErrorCode("failure");
      setStatus("error");
      return;
    }

    setStatus("pending");
    setErrorCode(null);
    setReceipt(null);
    onPendingChange?.(true);

    if (mode === "demo") {
      // No wallet, no chain. Deterministic DEMO receipt only.
      const demoReceipt = createDemoReceipt({
        amountMist: preview.totalMist,
        merchantAddress: merchantAddress ?? "0x0",
        merchantName: preview.merchant.name,
        itemName: preview.item.name,
        quantity: preview.quantity,
      });
      if (!mountedRef.current) return;
      setReceipt(demoReceipt);
      setStatus("settled");
      onPendingChange?.(false);
      onSettled?.(demoReceipt);
      return;
    }

    try {
      const transaction = buildPaymentTransaction({
        amountMist: preview.totalMist,
        merchantAddress: merchantAddress!,
        sender: account!.address,
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction });
      // A late wallet resolution landing after unmount/dismiss must never
      // settle or confirm the originating card. Fail closed: drop the result.
      if (!mountedRef.current) return;
      const digest = extractDigest(result);
      const realReceipt: PaymentReceipt = {
        mode: "real",
        digest,
        demo: false,
        explorerUrl: buildExplorerUrl("real", digest),
        amountMist: preview.totalMist,
        merchantAddress: merchantAddress!,
        label: "Real testnet transfer",
      };
      setReceipt(realReceipt);
      setStatus("settled");
      onPendingChange?.(false);
      onSettled?.(realReceipt);
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorCode(classifyWalletError(error));
      setStatus("error");
      onPendingChange?.(false);
    }
  }

  const explorerUrl = receipt?.explorerUrl ?? null;
  const isReal = mode === "real";

  return (
    <div className="space-y-4" aria-label="SUI payment action">
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-mono tabular-nums text-foreground">
            {suiAmount} SUI
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">MIST</span>
          <span className="font-mono tabular-nums text-foreground">
            {preview.totalMist} MIST
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Merchant</span>
          <span className="text-foreground">{preview.merchant.name}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Address</span>
          <span className="font-mono text-foreground" title={merchantAddress ?? undefined}>
            {shortAddress(merchantAddress)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Mode</span>
          {isReal ? (
            <span className="font-semibold text-foreground">Real testnet transfer</span>
          ) : (
            <span className="font-semibold text-foreground">DEMO simulation — no on-chain settlement</span>
          )}
        </div>
      </div>

      {amountError && (
        <p className="text-xs text-destructive" role="alert">
          {amountError}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          className="min-h-[44px] flex-1"
          onClick={onCancel}
          disabled={status === "pending" || status === "settled"}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="min-h-[44px] flex-1"
          onClick={handleConfirm}
          disabled={status === "pending" || status === "settled"}
          aria-busy={status === "pending"}
        >
          {status === "pending"
            ? "Awaiting signature…"
            : status === "settled"
              ? "Settled"
              : "Confirm payment"}
        </Button>
      </div>

      {status === "error" && errorCode && (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <Warning2 size="18" variant="Bold" className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{ERROR_MESSAGES[errorCode]}</p>
        </div>
      )}

      {receipt && status === "settled" && (
        <div
          className="space-y-2 rounded-xl border border-yes/30 bg-yes/6 p-3"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TickCircle size="18" variant="Bold" className="text-yes" aria-hidden="true" />
            {receipt.demo ? "DEMO receipt" : "Payment submitted"}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{receipt.label}</p>
          <div className="font-mono text-xs text-foreground" data-testid="payment-digest">
            {receipt.digest}
          </div>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View transaction
              <ExportSquare size="15" variant="Linear" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
