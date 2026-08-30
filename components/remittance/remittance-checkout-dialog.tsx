"use client";

import { useEffect, useState } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import { formatMyr, formatPhp, formatUsdc } from "@/lib/remittance/quote";
import { isExpired } from "@/lib/remittance/quote-schema";
import type { RemittanceSettlement, RemittanceTerminalState } from "./remittance-payment-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RemittancePaymentAction } from "./remittance-payment-action";

/**
 * Remittance checkout dialog — two human gates, one modal.
 *
 *  - `review`  — shows the validated quote one more time behind an explicit
 *                "Review details" gate. Continue advances to `payment`; Cancel
 *                closes without submitting. No transaction is built here.
 *  - `payment` — renders `RemittancePaymentAction`, the only surface that may
 *                build, sign, and execute a testnet USDC transfer. It owns the
 *                strict real-vs-prepared gating and the post-submit lifecycle.
 *
 * Settlement is the single terminal-success path: `onSettled` fires with the
 * real settlement and the dialog closes. A wallet rejection or known failure
 * is surfaced inside `RemittancePaymentAction` and never reaches `onSettled`.
 *
 * Lifecycle lock (P0): once the payment action reports a terminal-for-retry
 * state (`submitted`, `submitted_pending`, `unknown`, or `confirmed`), the
 * dialog chrome (X / Escape / outside-pointer / Cancel) is locked so a dismiss
 * mid-flight can never unmount the payment surface and the parent cannot reopen
 * a second confirmation for the same quote. The dialog propagates the terminal
 * state to the parent via `onTerminal` so the originating quote preview cannot
 * reopen either.
 */

export interface RemittanceCheckoutDialogProps {
  open: boolean;
  quote: QuoteEnvelope | null;
  onOpenChange: (open: boolean) => void;
  onSettled: (result: RemittanceSettlement) => void;
  onPaymentCancel?: () => void;
  /** Propagate a terminal-for-retry state to the parent so it cannot reopen. */
  onTerminal?: (state: RemittanceTerminalState) => void;
}

export function RemittanceCheckoutDialog({
  open,
  quote,
  onOpenChange,
  onSettled,
  onPaymentCancel,
  onTerminal,
}: RemittanceCheckoutDialogProps) {
  const [step, setStep] = useState<"review" | "payment">("review");
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
      setStep("review");
      setPaymentPending(false);
      setTerminalForRetry(false);
    }
  }

  // The dialog chrome is locked while a wallet resolution is in flight OR the
  // payment action is in a terminal-for-retry state. A dismiss mid-pending can
  // never unmount the payment surface and race a late resolution; a dismiss
  // mid-terminal-for-retry can never let the parent reopen a second
  // confirmation for the same quote.
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

  const youPay = formatMyr(quote.youPayMinor);
  const familyReceives = formatPhp(quote.familyReceivesMinor);
  const usdcAmount = formatUsdc(quote.usdcMicro);

  // Enforce quote expiry at the review gate: an expired quote shows a clear
  // "Quote expired — get a new quote" message and never advances to payment.
  const quoteExpired = isExpired(quote.expiresAt, now);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!chromeLocked}>
        {step === "review" ? (
          <>
            <DialogHeader>
              <DialogTitle>Review remittance</DialogTitle>
              <DialogDescription>
                Review the validated quote. No transaction is built until you continue
                to payment.
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-black/10 bg-[#f7f7f5] p-4 text-sm">
              <dt className="text-neutral-500">Recipient</dt>
              <dd className="font-medium">{quote.recipient}</dd>

              <dt className="text-neutral-500">Destination</dt>
              <dd className="font-medium">
                {quote.destinationCity}, {quote.destinationCountry}
              </dd>

              <dt className="text-neutral-500">You pay</dt>
              <dd className="font-mono font-semibold tabular-nums">{youPay} MYR</dd>

              <dt className="text-neutral-500">Family receives</dt>
              <dd className="font-mono tabular-nums">{familyReceives} PHP</dd>

              <dt className="text-neutral-500">Exchange rate</dt>
              <dd className="font-mono tabular-nums text-xs">{quote.exchangeRate.rateText}</dd>

              <dt className="text-neutral-500">Total fee</dt>
              <dd className="font-mono tabular-nums">{formatMyr(quote.totalFeeMinor)} MYR</dd>

              <dt className="text-neutral-500">USDC transfer</dt>
              <dd className="font-mono tabular-nums">{usdcAmount} USDC</dd>

              <dt className="text-neutral-500">Settlement rail</dt>
              <dd>{quote.settlementRail}</dd>

              <dt className="text-neutral-500">Payout method</dt>
              <dd>{quote.payoutMethod}</dd>

              <dt className="text-neutral-500">Estimated arrival</dt>
              <dd>{quote.estimatedArrival}</dd>
            </dl>

            <DialogFooter>
              {quoteExpired ? (
                <>
                  <p className="flex-1 text-sm font-medium text-black">
                    Quote expired — get a new quote
                  </p>
                  <button
                    type="button"
                    data-hit-target="true"
                    className="cv-btn-solid inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-hit-target="true"
                    className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-hit-target="true"
                    className="cv-btn-solid inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
                    onClick={() => setStep("payment")}
                  >
                    Continue to payment
                  </button>
                </>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm transfer</DialogTitle>
              <DialogDescription>
                A real testnet USDC transfer is built and signed only when you confirm
                below and a wallet is connected on testnet.
              </DialogDescription>
            </DialogHeader>

            <RemittancePaymentAction
              quote={quote}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
