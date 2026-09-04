"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CompanionProposal } from "@/lib/companion/contracts";
import type { CompanionContact } from "@/lib/companion/memory";

const COPY_RESET_MS = 2_000;

function contactStatusLine(contact: CompanionContact): string {
  return contact.confirmation === "confirmed" && contact.address
    ? "Saved, address confirmed"
    : "Saved, address not confirmed";
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/10 py-2 first:border-t-0 first:pt-0">
      <span className="companion-eyebrow shrink-0 pt-0.5 text-white/45">{label}</span>
      <span className="min-w-0 text-right text-sm leading-5 text-white">{value}</span>
    </div>
  );
}

/**
 * The compact "Convey understood" confirmation for a payment proposal.
 * Shows only what the proposal deterministically carries: recipient label,
 * exact amount and asset, purpose, saved-contact state from device memory,
 * and the next authority step. The full Sui address is never printed into
 * the chat flow; it stays behind an explicit reveal, with copy.
 */
export function CompanionIntentSummary({
  proposal,
  contact,
  onRequestRevision,
}: {
  proposal: CompanionProposal;
  contact: CompanionContact | null;
  onRequestRevision?: () => void;
}) {
  const [addressRevealed, setAddressRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const address = contact?.address ?? null;

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  function copyAddress() {
    if (!address || typeof navigator.clipboard?.writeText !== "function") return;
    navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
      })
      .catch(() => {
        setCopied(false);
      });
  }

  return (
    <section aria-label="Convey understood">
      <div className="flex items-start justify-between gap-3">
        <p className="companion-eyebrow text-white/55">Convey understood</p>
        {onRequestRevision && (
          <button
            type="button"
            onClick={onRequestRevision}
            className="-mr-2 inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            Change request
          </button>
        )}
      </div>
      <div className="mt-1">
        <Row
          label="To"
          value={
            <span className="inline-block">
              <span className="font-medium">{proposal.contactLabel}</span>
              {contact && (
                <span className="mt-0.5 block text-[11px] text-white/55">{contactStatusLine(contact)}</span>
              )}
            </span>
          }
        />
        <Row label="Amount" value={`${proposal.amountMajor} ${proposal.asset}`} />
        <Row
          label="Purpose"
          value={proposal.purpose ?? <span className="text-white/55">Not specified</span>}
        />
        {address && (
          <div className="border-t border-white/10 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="companion-eyebrow shrink-0 text-white/45">Recipient address</span>
              <button
                type="button"
                aria-expanded={addressRevealed}
                aria-label={addressRevealed ? "Hide recipient address" : "Show recipient address"}
                onClick={() => setAddressRevealed((current) => !current)}
                className="-mr-2 inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {addressRevealed ? "Hide" : "Reveal"}
              </button>
            </div>
            {addressRevealed && (
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="min-w-0 break-all font-mono text-[11px] leading-5 text-white/85">{address}</p>
                <button
                  type="button"
                  onClick={copyAddress}
                  aria-label="Copy recipient address"
                  className="-mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}
        <Row label="Next step" value={<span className="font-medium">You review and approve</span>} />
      </div>
    </section>
  );
}
