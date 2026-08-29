"use client";

import { useEffect, useState } from "react";
import { Copy, CopySuccess, DocumentDownload, ExportSquare } from "@/components/icons";
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

function shortId(value: string, head = 7, tail = 6): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Honest, monochrome mode label. Never infers settlement from the digest. */
function modeLabel(receipt: PaymentReceipt): { text: string; tone: string } {
  if (receipt.mode === "real") {
    return { text: "Real testnet", tone: "real" };
  }
  return { text: "DEMO simulation", tone: "demo" };
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
  title,
  description,
  actionLabel,
  onAction,
}: SettlementProofCardProps) {
  const amountSui = mistToSui(receipt.amountMist);
  const mode = modeLabel(receipt);
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

  return (
    <div
      data-testid="settlement-proof"
      data-proof-mode={mode.tone}
      className="cv-proof cv-enter space-y-3 rounded-xl border border-black/12 bg-white p-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="cv-proof__mark inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5L20 7" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-black">
          {title ?? (receipt.demo ? "DEMO receipt" : "Payment submitted")}
        </span>
        <span
          data-proof-mode={mode.tone}
          className="cv-proof__mode ml-auto inline-flex items-center rounded-full border border-black/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-700"
        >
          {mode.text}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-neutral-600">
        {description ?? receipt.label}
      </p>

      <dl className="cv-proof__grid grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-black/10 bg-neutral-50 p-3 text-xs">
        <dt className="text-neutral-500">Amount</dt>
        <dd className="font-mono tabular-nums text-black">{amountSui} SUI</dd>

        <dt className="text-neutral-500">Merchant</dt>
        <dd
          className="font-mono text-black"
          title={receipt.merchantAddress}
          data-full={receipt.merchantAddress}
        >
          <span className="cv-proof__id break-all">
            {shortId(receipt.merchantAddress)}
          </span>
        </dd>

        <dt className="text-neutral-500">Digest</dt>
        <dd
          className="font-mono text-black"
          title={receipt.digest}
          data-full={receipt.digest}
        >
          <span className="cv-proof__id break-all">{shortId(receipt.digest)}</span>
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="cv-proof__link inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 text-xs font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {actionLabel ?? "View transaction"}
            <ExportSquare size="14" variant="Linear" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-[11px] text-neutral-500">
            No explorer link for simulation
          </span>
        )}

        <button
          type="button"
          onClick={handleCopyProof}
          data-testid="copy-proof"
          aria-label="Copy proof JSON"
          className="cv-proof__btn inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 text-xs font-semibold text-black transition-colors hover:border-black/40 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {copied ? <CopySuccess size="14" variant="Bold" aria-hidden="true" /> : <Copy size="14" variant="Linear" aria-hidden="true" />}
          {copied ? "Copied" : "Copy proof"}
        </button>

        <button
          type="button"
          onClick={handleDownloadProof}
          data-testid="export-proof"
          aria-label="Download proof JSON"
          className="cv-proof__btn inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 text-xs font-semibold text-black transition-colors hover:border-black/40 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <DocumentDownload size="14" variant="Linear" aria-hidden="true" />
          Export JSON
        </button>

        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="cv-proof__btn ml-auto inline-flex min-h-[40px] items-center rounded-lg bg-black px-3 text-xs font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {actionLabel ?? "View transaction"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
