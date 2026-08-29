"use client";

import { ExportSquare, TickCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { PaymentReceipt } from "@/lib/commerce/payment";

export interface SettlementProofCardProps {
  receipt: PaymentReceipt;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

function mistToSui(mist: string): string {
  const value = BigInt(mist);
  const whole = value / 1_000_000_000n;
  const frac = value % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

export function SettlementProofCard({
  receipt,
  title,
  description,
  actionLabel = "View transaction",
  onAction,
}: SettlementProofCardProps) {
  const amountSui = mistToSui(receipt.amountMist);

  return (
    <div className="space-y-3 rounded-xl border border-yes/30 bg-yes/6 p-3" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TickCircle size="18" variant="Bold" className="text-yes" aria-hidden="true" />
        {title ?? (receipt.demo ? "DEMO receipt" : "Payment submitted")}
      </div>
      <p className="text-xs text-muted-foreground">
        {description ?? receipt.label}
      </p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-lg border border-yes/20 bg-white/80 p-3 text-xs">
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="font-mono text-foreground">{amountSui} SUI</dd>
        <dt className="text-muted-foreground">Merchant</dt>
        <dd className="text-right text-foreground">{receipt.merchantAddress}</dd>
        <dt className="text-muted-foreground">Digest</dt>
        <dd className="font-mono text-right text-foreground">{receipt.digest}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {actionLabel}
            <ExportSquare size="15" variant="Linear" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">No explorer link for simulation</span>
        )}
        {onAction ? (
          <Button type="button" variant="outline" className="min-h-[44px] border-foreground/15" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
