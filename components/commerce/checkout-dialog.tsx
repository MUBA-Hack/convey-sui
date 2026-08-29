"use client";

import { useState } from "react";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mistToSui } from "./purchase-preview";
import { PaymentAction } from "./payment-action";

/**
 * Wave 3 — checkout confirmation dialog with an embedded payment step.
 *
 * Two steps, one modal:
 *
 *  - `review`  — shows the validated preview one more time behind an explicit
 *                confirm gate. Confirm advances to `payment`; Cancel closes
 *                without settling. No transaction is built in this step.
 *  - `payment` — renders `PaymentAction`, the only surface that may build,
 *                sign, and execute a SUI transfer (or run an explicitly
 *                labelled DEMO simulation). `PaymentAction` owns the strict
 *                real-vs-demo gating; this dialog only hosts it.
 *
 * Settlement is the single terminal-success path: `onSettled` fires with the
 * receipt (real or DEMO) and the dialog closes. `onPaymentCancel` fires when
 * the user backs out of the payment step; the dialog closes WITHOUT settling
 * and the originating inline preview is left untouched (not confirmed). A
 * wallet rejection, insufficient balance, or on-chain failure is surfaced
 * inside `PaymentAction` and never reaches `onSettled` — so cancellation and
 * failure can never be mistaken for confirmation.
 *
 * Reset to `review` every time the dialog opens so a prior session's payment
 * step never leaks into a fresh checkout.
 */

export interface CheckoutDialogProps {
  open: boolean;
  preview: PurchaseIntentPreview | null;
  networkMode: "demo" | "live";
  onOpenChange: (open: boolean) => void;
  /** Fired with the receipt after terminal successful settlement (real or DEMO). */
  onSettled: (receipt: PaymentReceipt) => void;
  /** Fired when the user cancels the payment step without settling. */
  onPaymentCancel?: () => void;
}

export function CheckoutDialog({
  open,
  preview,
  networkMode,
  onOpenChange,
  onSettled,
  onPaymentCancel,
}: CheckoutDialogProps) {
  const [step, setStep] = useState<"review" | "payment">("review");
  // Whether the embedded PaymentAction has a wallet resolution in flight.
  // Drives the chrome lock (X / Escape / outside-pointer) below. The guard
  // only ever runs from chrome dismissal (a user event, well after this state
  // has committed); the settle and cancel paths call onOpenChange directly,
  // so plain state is sufficient and no synchronous ref mirror is needed.
  const [paymentPending, setPaymentPending] = useState(false);

  // Re-arm the review step each time the dialog is (re)opened so a stale
  // payment step from a previous checkout never carries over, and a pending
  // flag from a prior session can never leak into a fresh checkout. Adjusting
  // state during render (rather than in an effect) is the React-recommended
  // pattern for resetting state when a prop changes — it avoids a cascading
  // render and re-runs synchronously before the children commit.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setStep("review");
      setPaymentPending(false);
    }
  }

  // The payment step is the only surface that may build/sign/execute a real
  // transfer. While a wallet resolution is in flight, the dialog chrome (X,
  // Escape, outside-pointer) must NOT dismiss — a dismiss mid-pending would
  // unmount PaymentAction and race the late wallet resolution against
  // settlement. The explicit Cancel inside PaymentAction is the only
  // legitimate way out of the payment step, and it is disabled while pending.
  // (PaymentAction also fail-closes via its own mounted guard, so this is
  // defence-in-depth — neither layer alone is the whole safety story.)
  const handleOpenChange = (next: boolean) => {
    if (!next && paymentPending) return;
    onOpenChange(next);
  };

  // The dialog body only renders when open AND a preview is present; the Dialog
  // primitive itself also gates on `open`, so a null preview never reaches the
  // body below.
  if (!preview) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const totalSui = mistToSui(preview.totalMist);
  const unitSui = mistToSui(preview.unitPriceMist);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!paymentPending}>
        {step === "review" ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm checkout</DialogTitle>
              <DialogDescription>
                Review the validated preview. No transaction is built until you
                continue to payment.
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-neutral-500">Item</dt>
              <dd className="font-medium">{preview.item.name}</dd>

              <dt className="text-neutral-500">Quantity</dt>
              <dd className="font-mono tabular-nums">{preview.quantity}</dd>

              <dt className="text-neutral-500">Unit price</dt>
              <dd className="font-mono tabular-nums">{unitSui} SUI</dd>

              <dt className="text-neutral-500">Total</dt>
              <dd className="font-mono text-base font-semibold tabular-nums">
                {totalSui} SUI
              </dd>

              <dt className="text-neutral-500">Merchant</dt>
              <dd className="font-medium">{preview.merchant.name}</dd>

              <dt className="text-neutral-500">Network</dt>
              <dd>
                <span
                  className="cv-micro cv-micro-sm inline-block border border-[var(--cv-line)] px-2 py-0.5 uppercase"
                  data-network-mode={networkMode}
                >
                  {networkMode === "live" ? "Live testnet" : "Demo"}
                </span>
              </dd>
            </dl>

            <DialogFooter>
              <button
                type="button"
                data-hit-target="true"
                className="cv-micro inline-flex h-11 items-center justify-center border border-[var(--cv-line)] bg-white px-4 text-black transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                data-hit-target="true"
                className="cv-micro inline-flex h-11 items-center justify-center bg-black px-4 text-white transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                onClick={() => setStep("payment")}
              >
                Continue to payment
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Settle payment</DialogTitle>
              <DialogDescription>
                {networkMode === "live"
                  ? "A real testnet transfer is built and signed only when you confirm below."
                  : "No merchant is configured for a real transfer — an explicitly labelled DEMO simulation runs when you confirm below."}
              </DialogDescription>
            </DialogHeader>

            <PaymentAction
              preview={preview}
              onCancel={() => {
                onPaymentCancel?.();
                onOpenChange(false);
              }}
              onPendingChange={(pending) => {
                // Drives the chrome lock. The guard only runs from chrome
                // dismissal (a user event after this state commits); the
                // settle path calls onOpenChange directly, so plain state is
                // sufficient — no synchronous ref mirror needed.
                setPaymentPending(pending);
              }}
              onSettled={(receipt) => {
                onSettled(receipt);
                onOpenChange(false);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
