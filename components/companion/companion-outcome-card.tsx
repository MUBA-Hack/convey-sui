"use client";

import Link from "next/link";
import { ArrowRight, ShieldTick } from "@/components/icons";
import { OvernightProtectionCard } from "@/components/companion/overnight-protection-card";
import { PaymentRiskReview } from "@/components/companion/payment-risk-review";
import { ProtectedSupportDemoCard } from "@/components/companion/protected-support-demo-card";
import { ReceiptSplitFlow } from "@/components/companion/receipt-split-flow";
import type { CompanionResolution } from "@/lib/companion/contracts";
import type { CompanionMemory } from "@/lib/companion/memory";

function protectedScenario(purpose: string | null | undefined) {
  const normalized = purpose?.toLowerCase() ?? "";
  if (normalized.includes("freelance") || normalized.includes("deliverable")) return "freelance" as const;
  if (normalized.includes("rental") || normalized.includes("deposit")) return "rental" as const;
  if (normalized.includes("grant") || normalized.includes("milestone")) return "grant" as const;
  if (normalized.includes("relief") || normalized.includes("flood")) return "relief" as const;
  return "medicine" as const;
}

function PaymentRisk({ result, message, memory }: { result: CompanionResolution; message: string; memory: CompanionMemory }) {
  if (!result.proposal) return null;
  const contact = memory.contacts.find((entry) => entry.id === result.proposal?.contactId);
  if (!contact?.address) return null;
  return (
    <PaymentRiskReview
      context={{
      message,
      recipient: { isKnown: true, proposedAddress: contact.address, storedAddress: contact.address },
      amount: { amountMajor: result.proposal.amountMajor, usualMaximumMajor: "250" },
      invoice: null,
      qr: null,
      nowEpochMs: 0,
      }}
    />
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
    return <ReceiptSplitFlow />;
  }

  if (result.toolId === "strategies.propose") {
    return <OvernightProtectionCard />;
  }

  if (result.toolId === "missions.propose") {
    return (
      <ProtectedSupportDemoCard
        amountMajor={result.candidate?.amountMajor ?? "25"}
        scenario={protectedScenario(result.candidate?.purpose)}
      />
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
