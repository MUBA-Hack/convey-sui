"use client";

import { useMemo, useState } from "react";
import { Copy, CopySuccess, DocumentDownload, People } from "@/components/icons";
import {
  buildRemittanceReceipt,
  encodeRemittanceReceiptPayload,
} from "@/lib/remittance/receipt-proof";
import { copyReceiptUrl, exportReceiptJson } from "@/lib/remittance/receipt-share";
import { ReceiptSplitAction } from "./receipt-split-action";
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

export function RemittanceReceiptActions({
  quote,
  settlement,
}: RemittanceReceiptActionsProps) {
  const [copied, setCopied] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  // Memoize the receipt document and encoded payload by quote+settlement so
  // row edits inside the split panel (local child state) and `copied` toggles
  // here never rebuild the encoded proof.
  const receiptDoc = useMemo(
    () => buildRemittanceReceipt({ quote, settlement }),
    [quote, settlement],
  );
  const receiptPayload = useMemo(
    () => encodeRemittanceReceiptPayload(receiptDoc),
    [receiptDoc],
  );
  // SSR-safe: never dereference `window`/`location` during server render.
  // The split panel is closed at initial render so this URL is not in the SSR
  // DOM; the guard still keeps the memo safe and yields a deterministic
  // relative fallback until client hydration supplies an absolute origin.
  const splitReceiptUrl = useMemo(() => {
    let origin = "";
    if (typeof window !== "undefined") {
      try {
        origin = window.location.origin;
      } catch {
        origin = "";
      }
    }
    return origin ? `${origin}/proof?r=${receiptPayload}` : `/proof?r=${receiptPayload}`;
  }, [receiptPayload]);

  const handleShare = async () => {
    const ok = await copyReceiptUrl(receiptPayload, "r");
    setCopied(ok);
  };

  const handleExport = () => {
    exportReceiptJson(receiptDoc, "convey-remittance-proof.json");
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
      <button
        type="button"
        data-testid="remittance-split-toggle"
        aria-expanded={splitOpen}
        aria-controls="remittance-split-panel"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/15 px-3 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        onClick={() => setSplitOpen((v) => !v)}
      >
        <People size="14" variant="Linear" aria-hidden="true" />
        {splitOpen ? "Hide split" : "Split with friends"}
      </button>
      {splitOpen && (
        <div id="remittance-split-panel" className="w-full">
          <ReceiptSplitAction
            usdcMicro={settlement.usdcMicro}
            receiptUrl={splitReceiptUrl}
          />
        </div>
      )}
    </div>
  );
}
