"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { CloseCircle, Copy, DocumentDownload } from "@/components/icons";
import type { QuoteEnvelope } from "@/lib/remittance/quote";
import { encodeHandoff, wrapQuote } from "@/lib/remittance/offline-handoff";

interface RemittanceQuoteCarryProps {
  quote: QuoteEnvelope;
  city: string;
  sendAmount: string;
  expired: boolean;
  expiryLabel: string;
  onClose: () => void;
}

export function RemittanceQuoteCarry({
  quote,
  city,
  sendAmount,
  expired,
  expiryLabel,
  onClose,
}: RemittanceQuoteCarryProps) {
  const recipient = quote.recipient;
  const json = encodeHandoff(wrapQuote(quote));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      return;
    }
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "convey-remittance-quote.json";
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  };

  return createPortal(
    <div
      data-testid="carry-to-device-surface"
      role="dialog"
      aria-modal="true"
      aria-label={`Carry this ${recipient} quote to another device`}
      className="cv-enter fixed inset-0 top-[68px] z-[998] flex flex-col overflow-y-auto bg-[var(--cv-paper)] px-5 pb-8 pt-6 sm:px-6"
    >
      <div className="mx-auto w-full max-w-md text-center">
        <p
          data-testid="carry-step-eyebrow"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500"
        >
          Cross-device handoff
        </p>
        <h1
          data-testid="carry-step-title"
          className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-black sm:text-[30px]"
        >
          Carry this {recipient} quote
        </h1>
      </div>

      <div className="mx-auto mt-4 flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3">
        <p
          data-testid="carry-step-identity"
          className="truncate text-sm font-medium text-neutral-700"
        >
          {recipient} · {city}
        </p>
        <p
          data-testid="carry-step-amount"
          className="shrink-0 font-sans text-base font-semibold tabular-nums tracking-[-0.01em] text-black"
        >
          {sendAmount}
        </p>
      </div>

      <div className="mx-auto mt-6 flex w-full max-w-md flex-1 flex-col items-center justify-center">
        <div className="flex w-full max-w-[280px] justify-center rounded-2xl border border-black/8 bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
          <QRCodeSVG
            value={json}
            size={280}
            level="M"
            marginSize={4}
            fgColor="#000000"
            bgColor="#ffffff"
            title={`Carry ${recipient} quote to a connected device`}
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      </div>

      <div className="mx-auto mt-6 flex w-full max-w-md gap-3">
        <button
          type="button"
          data-testid="carry-copy"
          data-hit-target="true"
          className="cv-btn-ghost inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={handleCopy}
        >
          <Copy size={16} variant="Linear" />
          Copy code
        </button>
        <button
          type="button"
          data-testid="carry-download"
          data-hit-target="true"
          className="cv-btn-ghost inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={handleDownload}
        >
          <DocumentDownload size={16} variant="Linear" />
          Download code
        </button>
      </div>

      <p
        data-testid="carry-to-device-copy"
        className="mx-auto mt-4 w-full max-w-md text-center text-[12px] leading-relaxed text-neutral-500"
      >
        No funds move here. Open this quote on a connected device and verify it
        before wallet approval.{" "}
        <span data-testid="carry-step-expiry" className="text-neutral-700">
          {expired ? "This quote has expired." : `Quote expires in ${expiryLabel}.`}
        </span>
      </p>

      <div className="mx-auto mt-5 flex w-full max-w-md justify-center">
        <button
          type="button"
          data-testid="carry-close"
          data-hit-target="true"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-medium text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
          onClick={onClose}
        >
          <CloseCircle size={15} variant="Linear" />
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
