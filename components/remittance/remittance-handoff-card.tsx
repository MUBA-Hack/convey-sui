"use client";

import { useState } from "react";
import { useCurrentAccount, useCurrentNetwork } from "@mysten/dapp-kit-react";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { resolveQuoteBlocker } from "@/lib/remittance/transfer";
import {
  RemittanceQuotePreview,
  type QuotePreviewStatus,
} from "./remittance-quote-preview";
import { RemittanceCheckoutDialog } from "./remittance-checkout-dialog";
import { RemittanceReceiptActions } from "./remittance-receipt-actions";
import type {
  RemittanceSettlement,
  RemittanceTerminalState,
} from "./remittance-payment-action";

export interface RemittanceHandoffCardProps {
  quote: QuoteEnvelope;
}

const TERMINAL_STATUSES: ReadonlySet<QuotePreviewStatus> = new Set([
  "submitted",
  "unknown",
  "confirmed",
]);

export function RemittanceHandoffCard({ quote }: RemittanceHandoffCardProps) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();

  const [status, setStatus] = useState<QuotePreviewStatus>("pending");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settlement, setSettlement] = useState<RemittanceSettlement | null>(null);

  const blocker = resolveQuoteBlocker({
    account: account?.address ?? null,
    network,
    recipientAddress: quote.recipientAddress,
    attestation: quote.attestation,
  });
  const isExecutable = blocker === "none";

  const openCheckout = () => {
    if (!isExecutable || TERMINAL_STATUSES.has(status)) return;
    setDialogOpen(true);
  };

  const handleSettled = (result: RemittanceSettlement) => {
    setSettlement(result);
    setStatus("confirmed");
  };

  const handleTerminal = (state: RemittanceTerminalState) => {
    switch (state.kind) {
      case "submitted":
      case "unknown":
        setStatus(state.kind);
        break;
      case "confirmed":
        setStatus("confirmed");
        setSettlement(state.settlement);
        break;
    }
  };

  return (
    <div data-testid="remittance-handoff-card" className="mt-3 rounded-xl border border-black bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Quote carried
      </p>
      <p className="mt-1 text-sm font-semibold text-black">Not paid yet</p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        Before your wallet opens, we check the recipient, amount, expiry,
        and server seal on this quote.
      </p>

      <RemittanceQuotePreview
        quote={quote}
        status={status}
        blocker={blocker}
        confirmLabel="Review and approve"
        onConfirm={openCheckout}
        onCancel={() => setStatus("cancelled")}
        onReopen={() => setStatus("pending")}
      />

      {settlement && (
        <div data-testid="remittance-settlement" className="mt-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Transaction digest
          </p>
          <p
            data-testid="remittance-digest"
            className="mt-1 truncate font-mono text-xs text-black"
            title={settlement.digest}
            data-full={settlement.digest}
          >
            {settlement.digest}
          </p>
          <a
            href={settlement.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline"
          >
            View on SuiScan
          </a>
          <dl className="mt-3 space-y-1.5 border-t border-black/10 pt-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-neutral-500">Payout status</dt>
              <dd className="font-semibold">Awaiting payout partner</dd>
            </div>
          </dl>
          {/* Confirmed-only receipt actions — share/export a tamper-evident
              receipt ONLY after a real testnet settlement is confirmed. */}
          <RemittanceReceiptActions quote={quote} settlement={settlement} />
        </div>
      )}

      <RemittanceCheckoutDialog
        open={dialogOpen}
        quote={quote}
        onOpenChange={setDialogOpen}
        onSettled={handleSettled}
        onTerminal={handleTerminal}
        // The handoff card renders its own receipt actions on its settlement
        // card; suppress the in-dialog copy to avoid duplicate Share/Export
        // controls while both surfaces are mounted.
        suppressReceiptActions
      />
    </div>
  );
}
