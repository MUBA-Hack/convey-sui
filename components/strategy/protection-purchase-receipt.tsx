"use client";

import { ExportSquare, ShieldTick } from "@/components/icons";
import {
  formatProtectionExpiry,
  formatStrike8d,
  formatUsdcMicro,
} from "@/lib/strategy/format";
import type { ProtectionPurchaseReceiptDocument } from "@/lib/strategy/protection-purchase-receipt";
import { buildBaseScanTransactionUrl } from "@/lib/strategy/protection-purchase-receipt";

export function ProtectionPurchaseReceipt({
  receipt,
  receiptHref,
}: {
  receipt: ProtectionPurchaseReceiptDocument;
  receiptHref: string;
}) {
  const floor = receipt.plan.strikes8d[0] ?? "0";
  const ends = new Date(Number(receipt.plan.expirySeconds) * 1_000).toISOString();
  return (
    <section
      data-testid="protection-purchase-receipt"
      className="cv-money-sheet cv-preview-in min-w-0 overflow-hidden rounded-2xl"
      aria-labelledby="protection-receipt-title"
    >
      <div className="px-6 pb-5 pt-6 md:px-8 md:pt-8">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-neutral-600">
          <ShieldTick size="18" variant="Bold" aria-hidden="true" />
          Confirmed on Base
        </div>
        <h2
          id="protection-receipt-title"
          className="mt-3 text-[38px] font-semibold leading-[0.98] tracking-[-0.045em] text-black md:text-[46px]"
        >
          Protection active.
        </h2>
        <p className="mt-3 max-w-[38ch] text-[16px] leading-7 text-neutral-600">
          Your {receipt.plan.asset} protection was purchased and independently checked.
        </p>
      </div>

      <div className="mx-6 rounded-2xl bg-black p-5 text-white md:mx-8 md:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
          Downside floor
        </p>
        <p className="mt-2 text-[42px] font-semibold leading-none tracking-[-0.045em]">
          {formatStrike8d(floor)}
        </p>
        <p className="mt-3 text-[13px] text-white/60">
          Until {formatProtectionExpiry(ends)}
        </p>
      </div>

      <dl className="mx-6 grid grid-cols-2 gap-x-5 gap-y-4 border-b border-black/8 py-5 text-[13px] md:mx-8">
        <div>
          <dt className="text-neutral-500">Cost paid</dt>
          <dd className="mt-1 font-semibold text-black">
            {formatUsdcMicro(receipt.purchase.premiumAmountMicro)} USDC
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Network</dt>
          <dd className="mt-1 font-semibold text-black">Base</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-neutral-500">Wallet</dt>
          <dd className="mt-1 truncate font-mono text-black" title={receipt.purchase.buyerAddress}>
            {receipt.purchase.buyerAddress}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 px-6 py-5 sm:flex-row md:px-8">
        <a
          href={receiptHref}
          className="cv-btn-solid inline-flex min-h-12 flex-1 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white"
        >
          Open receipt
        </a>
        <a
          href={buildBaseScanTransactionUrl(receipt.purchase.txHash)}
          target="_blank"
          rel="noreferrer"
          className="cv-btn-ghost inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold"
        >
          View transaction
          <ExportSquare size="16" variant="Linear" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
