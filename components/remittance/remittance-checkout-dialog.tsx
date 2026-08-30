"use client";

import { useEffect, useState } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import { formatMyrFixedGrouped, formatPhpFixedGrouped, formatUsdcGrouped } from "@/lib/remittance/quote";
import { isExpired } from "@/lib/remittance/quote-schema";
import { titleCaseCity } from "@/lib/remittance/quote-form";
import type { RemittanceSettlement, RemittanceTerminalState } from "./remittance-payment-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RemittancePaymentAction } from "./remittance-payment-action";
import { SheetDisclosure } from "./sheet-disclosure";

/**
 * Remittance checkout dialog — a single consumer-finance review surface.
 *
 * The dialog opens ONLY for an executable quote (recipient mapping + attestation
 * + wallet + testnet); the parent never opens it for a prepared quote, so there
 * is no dead-end payment modal. The focal point is a reference-style consumer
 * summary card: big "Ana · Manila" and "RM500 → ₱6,104 illustrative", the
 * reference fee, and the USDC wallet transfer. Technical rail / address /
 * reference data sits in a collapsed "Transfer details" disclosure — never the
 * visual focal point. One black primary Confirm drives the USDC payment action.
 *
 * There is one close affordance (the dialog X), locked while a wallet resolution
 * is in flight or the payment action is in a terminal-for-retry state. No
 * duplicate Close buttons, no repeated status line.
 *
 * Lifecycle lock (P0): once the payment action reports a terminal-for-retry
 * state (`submitted`, `submitted_pending`, `unknown`, or `confirmed`), the
 * dialog chrome (X / Escape / outside-pointer) is locked so a dismiss mid-flight
 * can never unmount the payment surface and the parent cannot reopen a second
 * confirmation for the same quote. The dialog propagates the terminal state to
 * the parent via `onTerminal` so the originating quote preview cannot reopen
 * either.
 */

export interface RemittanceCheckoutDialogProps {
  open: boolean;
  quote: QuoteEnvelope | null;
  onOpenChange: (open: boolean) => void;
  onSettled: (result: RemittanceSettlement) => void;
  onPaymentCancel?: () => void;
  /** Propagate a terminal-for-retry state to the parent so it cannot reopen. */
  onTerminal?: (state: RemittanceTerminalState) => void;
  /**
   * When true, the in-dialog payment action omits its Share/Export receipt
   * actions. Used by the offline handoff flow, where the parent handoff card
   * renders its own receipt actions for the same settlement — preventing
   * duplicate Share/Export controls when both surfaces are mounted.
   */
  suppressReceiptActions?: boolean;
}

export function RemittanceCheckoutDialog({
  open,
  quote,
  onOpenChange,
  onSettled,
  onPaymentCancel,
  onTerminal,
  suppressReceiptActions = false,
}: RemittanceCheckoutDialogProps) {
  const [paymentPending, setPaymentPending] = useState(false);
  // Whether the payment action is in a terminal-for-retry state. While true,
  // the dialog chrome is locked and the parent cannot reopen a second
  // confirmation.
  const [terminalForRetry, setTerminalForRetry] = useState(false);
  // Tick every second so expiry is reactive while the dialog is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setPaymentPending(false);
      setTerminalForRetry(false);
    }
  }

  // The dialog chrome is locked while a wallet resolution is in flight OR the
  // payment action is in a terminal-for-retry state.
  const chromeLocked = paymentPending || terminalForRetry;

  const handleOpenChange = (next: boolean) => {
    if (!next && chromeLocked) return;
    onOpenChange(next);
  };

  if (!quote) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const sendAmount = formatMyrFixedGrouped(quote.youPayMinor);
  const phpPayout = formatPhpFixedGrouped(quote.familyReceivesMinor);
  const usdcAmount = formatUsdcGrouped(quote.usdcMicro);
  const fee = formatMyrFixedGrouped(quote.totalFeeMinor);
  const city = titleCaseCity(quote.destinationCity);

  // Enforce quote expiry: an expired quote shows a clear "Quote expired" message
  // and never reaches the wallet.
  const quoteExpired = isExpired(quote.expiresAt, now);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!chromeLocked}
        className="max-w-[calc(100%-1.5rem)] sm:max-w-[420px]"
      >
        <DialogHeader>
          <DialogTitle>Review testnet transfer</DialogTitle>
          <DialogDescription>
            A real testnet USDC transfer is built and signed only when you confirm
            below.
          </DialogDescription>
        </DialogHeader>

        {/* Consumer summary card — the focal point. */}
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-base font-medium tracking-[-0.01em] text-black">
            {quote.recipient} · {city}
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-[-0.02em] text-black">
            RM{sendAmount}{" "}
            <span className="text-neutral-400">→</span>{" "}
            <span className="text-neutral-600">₱{phpPayout}</span>
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Illustrative PHP payout — not initiated by Convey.
          </p>

          <dl className="mt-3 space-y-1.5 border-t border-black/8 pt-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-neutral-500">Reference fee</dt>
              <dd className="font-mono tabular-nums">RM{fee}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-neutral-500">Wallet transfer</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {usdcAmount} testnet USDC
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            No MYR charged; no bank payout occurs here. Reference rate and fee are
            reference figures.
          </p>
        </div>

        {/* Transfer details — collapsed technical disclosure (shared
            primitive). */}
        <div className="rounded-xl border border-black/10">
          <SheetDisclosure label="Transfer details" triggerTestId="checkout-transfer-details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-neutral-500">Settlement rail</dt>
              <dd className="text-neutral-700">{quote.settlementRail}</dd>

              <dt className="text-neutral-500">Recipient address</dt>
              <dd
                className="font-mono text-neutral-700"
                title={quote.recipientAddress ?? ""}
              >
                {quote.recipientAddress
                  ? `${quote.recipientAddress.slice(0, 6)}…${quote.recipientAddress.slice(-4)}`
                  : "—"}
              </dd>

              <dt className="text-neutral-500">Reference</dt>
              <dd className="font-mono">{quote.beneficiaryRef}</dd>

              <dt className="text-neutral-500">Quote expiry</dt>
              <dd className="font-mono tabular-nums text-xs">
                {new Date(quote.expiresAt).toLocaleTimeString()}
              </dd>
            </dl>
          </SheetDisclosure>
        </div>

        {quoteExpired ? (
          <div
            data-testid="remittance-expired"
            className="rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm"
          >
            <p className="font-medium text-black">Quote expired — get a new quote</p>
          </div>
        ) : (
          <RemittancePaymentAction
            quote={quote}
            summaryMode
            suppressReceiptActions={suppressReceiptActions}
            onCancel={() => {
              onPaymentCancel?.();
              onOpenChange(false);
            }}
            onPendingChange={(pending) => setPaymentPending(pending)}
            onSettled={(result) => {
              // Keep dialog mounted with evidence; parent owns reopen lock.
              onSettled(result);
            }}
            onTerminal={(state) => {
              // submitted/unknown/confirmed/failed are all terminal-for-retry.
              // Keep the action mounted so finality evidence remains visible.
              setTerminalForRetry(true);
              onTerminal?.(state);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
