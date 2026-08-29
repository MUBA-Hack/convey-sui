"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, CopySuccess, DocumentDownload, ExportSquare } from "@/components/icons";
import type { PaymentReceipt } from "@/lib/commerce/payment";
import {
  encodeReceiptProofPayload,
  type ReceiptProofDocument,
} from "@/lib/commerce/receipt-proof";

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

function shortId(value: string, head = 7, tail = 6): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Honest, monochrome mode label. Never infers settlement from the digest. */
function modeLabel(receipt: PaymentReceipt): { text: string; tone: string } {
  if (receipt.mode === "real") {
    return { text: "Real testnet", tone: "real" };
  }
  return { text: "Not submitted", tone: "demo" };
}

/** Honest, non-duplicating qualifier that pairs with the single mode mark. */
function subheadLabel(receipt: PaymentReceipt): string {
  if (receipt.mode === "real") {
    return "Client-signed testnet transfer";
  }
  return "No on-chain settlement";
}

/** Canonical JSON export shape for a receipt (stable key order). */
function receiptExportJson(receipt: PaymentReceipt): string {
  return JSON.stringify(
    {
      mode: receipt.mode,
      demo: receipt.demo,
      digest: receipt.digest,
      amountMist: receipt.amountMist,
      merchantAddress: receipt.merchantAddress,
      explorerUrl: receipt.explorerUrl,
      label: receipt.label,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

export function SettlementProofCard({
  receipt,
  description,
  actionLabel,
  onAction,
}: SettlementProofCardProps) {
  const amountSui = mistToSui(receipt.amountMist);
  const mode = modeLabel(receipt);
  const subhead = description ?? subheadLabel(receipt);
  const [copied, setCopied] = useState(false);

  // Clear the copied affordance after a short, restrained delay. The timeout
  // is cleared on unmount so a late callback never touches unmounted state.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopyProof = async () => {
    try {
      await navigator.clipboard.writeText(receiptExportJson(receipt));
      setCopied(true);
    } catch {
      // Clipboard may be unavailable; the export/download affordance remains.
    }
  };

  const handleDownloadProof = () => {
    const json = receiptExportJson(receipt);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = receipt.demo ? "convey-demo-proof.json" : "convey-proof.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const proofHref = useMemo(() => {
    const proof: ReceiptProofDocument = {
      mode: receipt.mode,
      demo: receipt.demo,
      digest: receipt.digest,
      amountMist: receipt.amountMist,
      merchantAddress: receipt.merchantAddress,
      explorerUrl: receipt.explorerUrl,
      label: receipt.label,
      exportedAt: new Date().toISOString(),
    };
    try {
      return `/proof?p=${encodeReceiptProofPayload(proof)}`;
    } catch {
      return null;
    }
  }, [receipt]);

  return (
    <div
      data-testid="settlement-proof"
      data-proof-mode={mode.tone}
      className="cv-proof cv-enter overflow-hidden rounded-2xl border border-black/12 bg-white p-4 sm:p-5"
      aria-live="polite"
    >
      {/* Single mode mark — the only place the mode is labelled. The title
          never duplicates it; the amount is the protagonist below. */}
      <div className="flex items-center justify-between gap-3">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5L20 7" />
          </svg>
        </span>
        <span
          data-proof-mode={mode.tone}
          className="cv-proof__mode inline-flex items-center rounded-full border border-black/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-700"
        >
          {mode.text}
        </span>
      </div>

      {/* Amount-led monument: 56px on mobile, 64px on desktop. The amount is
          the visual protagonist of the completed settlement object. */}
      <p
        data-testid="proof-amount"
        className="mt-3 text-[56px] font-medium leading-[0.92] tracking-[-0.04em] text-black md:text-[64px] md:tracking-[-0.05em]"
      >
        {amountSui}
        <span className="ml-2 align-baseline text-[18px] font-semibold uppercase tracking-[0.16em] text-neutral-500 md:text-[20px]">
          SUI
        </span>
      </p>

      {/* Merchant subhead — a single truncated monospace line with the full
          canonical address preserved in title/data-full for assistive tech. */}
      <dl className="mt-3 min-w-0 space-y-1.5">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Merchant
          </dt>
          <dd
            className="cv-proof__id mt-0.5 truncate font-mono text-xs text-black"
            title={receipt.merchantAddress}
            data-full={receipt.merchantAddress}
          >
            {shortId(receipt.merchantAddress)}
          </dd>
        </div>
        {/* Digest stripe — a single unwrapped/truncated monospace line; the
            full digest is accessible via title/data-full, never wrapped. */}
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Digest
          </dt>
          <dd
            className="cv-proof__id mt-0.5 truncate font-mono text-xs text-black"
            title={receipt.digest}
            data-full={receipt.digest}
          >
            {shortId(receipt.digest)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-neutral-600">{subhead}</p>

      {/* Full-width black Verify receipt primary action — leads the action
          stack so it is reachable above the fold on mobile. */}
      {proofHref ? (
        <a
          href={proofHref}
          className="cv-proof__btn mt-3 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-black px-4 text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Verify receipt
        </a>
      ) : null}

      {/* Subordinate compact actions — Copy/Export and the real explorer
          link (or an honest "no explorer" note for DEMO). */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="cv-proof__link inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {actionLabel ?? "View transaction"}
            <ExportSquare size="13" variant="Linear" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-[11px] text-neutral-500">
            No explorer link — not submitted on-chain
          </span>
        )}

        <button
          type="button"
          onClick={handleCopyProof}
          data-testid="copy-proof"
          aria-label="Copy proof JSON"
          className="cv-proof__btn inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black transition-colors hover:border-black/40 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {copied ? <CopySuccess size="13" variant="Bold" aria-hidden="true" /> : <Copy size="13" variant="Linear" aria-hidden="true" />}
          {copied ? "Copied" : "Copy proof"}
        </button>

        <button
          type="button"
          onClick={handleDownloadProof}
          data-testid="export-proof"
          aria-label="Download proof JSON"
          className="cv-proof__btn inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black transition-colors hover:border-black/40 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <DocumentDownload size="13" variant="Linear" aria-hidden="true" />
          Export JSON
        </button>

        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="cv-proof__btn inline-flex min-h-[36px] items-center rounded-lg bg-black px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {actionLabel ?? "View transaction"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
