"use client";

import Link from "next/link";
import { ArrowRight, DocumentText, ShieldSearch, ShieldTick } from "@/components/icons";
import type { CompanionResolution } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";
import { assessCompanionRisk } from "@/lib/companion/risk-council";

function PaymentRisk({ result, message, memory }: { result: CompanionResolution; message: string; memory: CompanionMemory }) {
  if (!result.proposal) return null;
  const contact = memory.contacts.find((entry) => entry.id === result.proposal?.contactId);
  if (!contact?.address) return null;
  const assessment = assessCompanionRisk({
    context: {
      message,
      recipient: { isKnown: true, proposedAddress: contact.address, storedAddress: contact.address },
      amount: { amountMajor: result.proposal.amountMajor, usualMaximumMajor: "250" },
      invoice: null,
      qr: null,
      nowEpochMs: 0,
    },
  });
  return (
    <div className="companion-check-row">
      <ShieldSearch size={15} />
      <span>{assessment.signals.length === 0 ? "Saved recipient and amount checks passed" : "Extra confirmation recommended"}</span>
    </div>
  );
}

export function CompanionOutcomeCard({ result, message, memory }: { result: CompanionResolution; message: string; memory: CompanionMemory }) {
  if (result.outcome === "proposal" && result.proposal) {
    return (
      <div className="companion-result companion-result--dark">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="companion-eyebrow text-white/55">Ready to review</p>
            <p className="mt-2 text-2xl font-medium tracking-[-0.035em] text-white">{result.proposal.amountMajor} {result.proposal.asset}</p>
            <p className="mt-1 text-sm text-white/65">To {result.proposal.contactLabel}{result.proposal.purpose ? ` · ${result.proposal.purpose}` : ""}</p>
          </div>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black"><ShieldTick size={17} /></span>
        </div>
        <PaymentRisk result={result} message={message} memory={memory} />
        {result.routing.mode === "live" && result.routing.requestId && (
          <a className="companion-receipt-link" href={`/api/companion/receipt/${encodeURIComponent(result.routing.requestId)}`} target="_blank" rel="noreferrer">
            Verify AI route <ArrowRight size={13} />
          </a>
        )}
        <Link href="/pay" className="mt-4 inline-flex min-h-11 w-full items-center justify-between rounded-full bg-white px-5 text-sm font-semibold text-black">
          Review payment <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  if (result.toolId === "splits.propose") {
    return (
      <div className="companion-result companion-feature-result">
        <span className="companion-result-icon"><DocumentText size={18} /></span>
        <p className="mt-4 text-lg font-medium tracking-[-0.03em]">Add the receipt.</p>
        <p className="mt-1 text-sm leading-6 text-black/58">Convey will extract the items, let you correct them, then turn each share into a request.</p>
        <label className="companion-upload-button">
          Choose receipt photo
          <input className="sr-only" type="file" accept="image/*" capture="environment" />
        </label>
      </div>
    );
  }

  if (result.toolId === "strategies.propose") {
    return (
      <div className="companion-result companion-feature-result companion-feature-result--ink">
        <p className="companion-eyebrow text-white/45">Protection plan</p>
        <p className="mt-3 text-xl font-medium tracking-[-0.035em] text-white">Protect up to 500 USDC overnight.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <span className="companion-limit"><b>30 days</b> maximum term</span>
          <span className="companion-limit"><b>3 trades</b> maximum</span>
        </div>
        <p className="mt-4 text-xs leading-5 text-white/50">You set the spending and loss limits before anything can run.</p>
        <Link href="/strategy" className="mt-4 inline-flex min-h-11 w-full items-center justify-between rounded-full bg-white px-5 text-sm font-semibold text-black">Review protection <ArrowRight size={16} /></Link>
      </div>
    );
  }

  if (result.clarification) {
    return (
      <div className="companion-result">
        <p className="companion-eyebrow text-black/45">One detail first</p>
        <p className="mt-2 text-sm leading-6 text-black/72">{result.clarification.reason}</p>
      </div>
    );
  }
  return null;
}
