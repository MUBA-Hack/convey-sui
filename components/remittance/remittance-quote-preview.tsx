"use client";

import type { QuoteEnvelope } from "@/lib/remittance/quote";
import { formatMyr, formatPhp, formatUsdc } from "@/lib/remittance/quote";

/**
 * Inline remittance quote preview — renders every field a customer needs:
 * recipient, destination, You pay, Family receives, exchange rate, total fee,
 * estimated arrival, payout method, settlement rail, and the non-PII
 * beneficiary reference. It carries the confirm gate that opens the checkout
 * dialog. It never builds a transaction.
 *
 * Status lifecycle:
 *  - `pending`   — the quote is awaiting a customer decision (Review details).
 *  - `cancelled` — the customer dismissed the quote; Reopen returns to pending.
 *  - `submitted` — a broadcast succeeded but confirmation is pending. The
 *                  preview is locked: NO Reopen, NO Review details. The
 *                  customer must check the wallet/explorer.
 *  - `unknown`   — the post-submit outcome is unknown. The preview is locked:
 *                  NO Reopen, NO Review details. The customer must check the
 *                  wallet before taking any action.
 *  - `confirmed` — the transfer is confirmed; the settlement is shown.
 */

export type QuotePreviewStatus =
  | "pending"
  | "cancelled"
  | "submitted"
  | "unknown"
  | "confirmed";

export interface RemittanceQuotePreviewProps {
  quote: QuoteEnvelope;
  status: QuotePreviewStatus;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
}

export function RemittanceQuotePreview({
  quote,
  status,
  onConfirm,
  onCancel,
  onReopen,
}: RemittanceQuotePreviewProps) {
  const youPay = formatMyr(quote.youPayMinor);
  const familyReceives = formatPhp(quote.familyReceivesMinor);
  const totalFee = formatMyr(quote.totalFeeMinor);
  const usdcAmount = formatUsdc(quote.usdcMicro);

  // A terminal-for-retry state locks the preview: no Reopen, no Review details.
  const locked = status === "submitted" || status === "unknown" || status === "confirmed";

  return (
    <div
      data-testid="remittance-quote-preview"
      className="cv-preview-in mt-3 rounded-2xl border border-black/10 bg-[#f8f8f6] p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
          Remittance quote
        </p>
        <span className="inline-flex items-center rounded-full border border-black/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
          Reference
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-neutral-500">Recipient</dt>
        <dd data-testid="quote-recipient" className="font-medium">{quote.recipient}</dd>

        <dt className="text-neutral-500">Destination</dt>
        <dd data-testid="quote-destination" className="font-medium">
          {quote.destinationCity}, {quote.destinationCountry}
        </dd>

        <dt className="text-neutral-500">You pay</dt>
        <dd data-testid="quote-you-pay" className="font-mono text-lg font-semibold tabular-nums">
          {youPay} MYR
        </dd>

        <dt className="text-neutral-500">Family receives</dt>
        <dd data-testid="quote-family-receives" className="font-mono tabular-nums">
          {familyReceives} PHP
        </dd>

        <dt className="text-neutral-500">Exchange rate</dt>
        <dd data-testid="quote-rate" className="font-mono tabular-nums text-xs">
          {quote.exchangeRate.rateText}
        </dd>

        <dt className="text-neutral-500">Total fee</dt>
        <dd data-testid="quote-fee" className="font-mono tabular-nums">
          {totalFee} MYR
        </dd>

        <dt className="text-neutral-500">Estimated arrival</dt>
        <dd data-testid="quote-arrival" className="text-neutral-700">
          {quote.estimatedArrival}
        </dd>

        <dt className="text-neutral-500">Payout method</dt>
        <dd data-testid="quote-payout-method" className="text-neutral-700">
          {quote.payoutMethod}
        </dd>

        <dt className="text-neutral-500">Settlement rail</dt>
        <dd data-testid="quote-rail" className="text-neutral-700">
          {quote.settlementRail}
        </dd>

        <dt className="text-neutral-500">USDC transfer</dt>
        <dd data-testid="quote-usdc" className="font-mono tabular-nums">
          {usdcAmount} USDC
        </dd>

        <dt className="text-neutral-500">Reference</dt>
        <dd data-testid="quote-reference" className="font-mono text-xs">
          {quote.beneficiaryRef}
        </dd>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Reference pricing — not a live rate. Quote expires{" "}
        {new Date(quote.expiresAt).toLocaleTimeString()}.
      </p>

      {status === "pending" && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-solid inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onConfirm}
          >
            Review details
          </button>
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {status === "cancelled" && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-neutral-500">Quote dismissed.</p>
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onReopen}
          >
            Reopen
          </button>
        </div>
      )}

      {status === "submitted" && (
        <div data-testid="remittance-preview-submitted" className="mt-4 rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-medium text-black">Submitted — confirmation pending</p>
          <p className="mt-1 text-neutral-600">
            The transfer was submitted. Check your wallet or the explorer before taking any
            action. Do not retry.
          </p>
        </div>
      )}

      {status === "unknown" && (
        <div data-testid="remittance-preview-unknown" className="mt-4 rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-medium text-black">Transfer outcome unknown</p>
          <p className="mt-1 text-neutral-600">
            Transfer outcome unknown — check your wallet before taking any action.
          </p>
        </div>
      )}

      {locked && (
        <p className="mt-3 text-[11px] text-neutral-400" aria-hidden>
          This quote is locked while the transfer is in flight.
        </p>
      )}
    </div>
  );
}
