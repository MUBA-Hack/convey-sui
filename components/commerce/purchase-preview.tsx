"use client";

import type { PurchaseIntentPreview } from "@/lib/commerce/intent";

/**
 * Wave 2 Task 2.2 — inline purchase preview card.
 *
 * Renders the validated preview inside the chat thread: item, quantity, total
 * SUI, merchant, and network mode. It carries the cancel/reopen confirm gate:
 * `pending` shows Confirm + Cancel, `cancelled` shows Reopen only, `confirmed`
 * shows neither. It never constructs a transaction — confirm merely notifies
 * the parent, which opens the checkout dialog.
 */

const MIST_PER_SUI = 1_000_000_000n;

/** Format a MIST string as a human-readable SUI amount (trailing zeros trimmed). */
export function mistToSui(mist: string): string {
  const n = BigInt(mist);
  const sui = n / MIST_PER_SUI;
  const frac = n % MIST_PER_SUI;
  if (frac === 0n) return sui.toString();
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${sui.toString()}.${fracStr}`;
}

export type PreviewStatus = "pending" | "cancelled" | "confirmed";

export interface PurchasePreviewProps {
  preview: PurchaseIntentPreview;
  networkMode: "demo" | "live";
  status: PreviewStatus;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
}

export function PurchasePreview({
  preview,
  networkMode,
  status,
  onConfirm,
  onCancel,
  onReopen,
}: PurchasePreviewProps) {
  const totalSui = mistToSui(preview.totalMist);
  const unitSui = mistToSui(preview.unitPriceMist);

  return (
    <div
      data-testid="purchase-preview"
      className="cv-preview-in mt-3 rounded-xl border border-black/10 bg-[#f7f7f5] p-4"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
        Purchase preview
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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
            className="inline-block rounded-md border border-black/12 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em]"
            data-network-mode={networkMode}
          >
            {networkMode === "live" ? "Live testnet" : "Demo"}
          </span>
        </dd>
      </dl>

      {status === "pending" && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-solid inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onConfirm}
          >
            Confirm
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
          <p className="text-sm text-neutral-500">Preview dismissed.</p>
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

      {status === "confirmed" && (
        <p className="mt-4 text-sm font-medium">Checkout complete.</p>
      )}
    </div>
  );
}
