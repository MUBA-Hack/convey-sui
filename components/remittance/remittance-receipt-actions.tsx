"use client";

import { useState } from "react";
import { Copy, CopySuccess, DocumentDownload } from "@/components/icons";
import {
  buildRemittanceReceipt,
  encodeRemittanceReceiptPayload,
  type RemittanceReceiptDocument,
} from "@/lib/remittance/receipt-proof";
import { copyReceiptUrl, exportReceiptJson } from "@/lib/remittance/receipt-share";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { RemittanceSettlement } from "./remittance-payment-action";

/**
 * Confirmed-only receipt actions — share and export a tamper-evident
 * remittance settlement receipt. Rendered ONLY after a real testnet
 * settlement is confirmed (a digest + effects success). The receipt is built
 * from the verified quote and the captured settlement evidence, then
 * validated against the strict receipt schema before any share/export, so a
 * malformed settlement never produces a receipt.
 *
 * No signature or authorization is implied by the receipt; it is a
 * transport envelope for evidence the customer already saw on-chain.
 */
export interface RemittanceReceiptActionsProps {
  quote: QuoteEnvelope;
  settlement: RemittanceSettlement;
}

function buildReceipt(
  quote: QuoteEnvelope,
  settlement: RemittanceSettlement,
): RemittanceReceiptDocument {
  return buildRemittanceReceipt({
    quote,
    settlement: {
      digest: settlement.digest,
      explorerUrl: settlement.explorerUrl,
      recipientAddress: settlement.recipientAddress,
      usdcMicro: settlement.usdcMicro,
      beneficiaryRef: settlement.beneficiaryRef,
      quoteExpiresAt: settlement.quoteExpiresAt,
      payoutStatus: settlement.payoutStatus,
      purpose: settlement.purpose,
      maximumFamilyLimitMinor: settlement.maximumFamilyLimitMinor,
      // Bound once at settlement confirmation; reused on every share/export so
      // repeated shares produce identical evidence, not a new timestamp.
      confirmedAt: settlement.confirmedAt,
    },
  });
}

export function RemittanceReceiptActions({
  quote,
  settlement,
}: RemittanceReceiptActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const doc = buildReceipt(quote, settlement);
    const payload = encodeRemittanceReceiptPayload(doc);
    const ok = await copyReceiptUrl(payload, "r");
    setCopied(ok);
  };

  const handleExport = () => {
    const doc = buildReceipt(quote, settlement);
    exportReceiptJson(doc, "convey-remittance-proof.json");
  };

  return (
    <div
      data-testid="remittance-receipt-actions"
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        data-testid="remittance-share-receipt"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        onClick={handleShare}
      >
        {copied ? (
          <CopySuccess size="14" variant="Bold" aria-hidden="true" />
        ) : (
          <Copy size="14" variant="Linear" aria-hidden="true" />
        )}
        {copied ? "Receipt link copied" : "Share receipt"}
      </button>
      <button
        type="button"
        data-testid="remittance-export-receipt"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        onClick={handleExport}
      >
        <DocumentDownload size="14" variant="Linear" aria-hidden="true" />
        Export receipt
      </button>
    </div>
  );
}
