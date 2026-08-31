"use client";

import type { ProtectedTransferMetadata } from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferExecutionPlan } from "@/lib/remittance/protected-transfer";
import { formatUsdcGrouped } from "@/lib/remittance/money";

function compactAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDeadline(deadlineMs: number): string {
  const date = new Date(deadlineMs);
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

export interface FamilyReviewSummaryProps {
  plan: ProtectedTransferExecutionPlan & { reviewerName?: string };
  metadata: ProtectedTransferMetadata;
}

/**
 * Compact pre-wallet summary shown after the strict plan resolves and before
 * the wallet is asked to sign. Lists exactly the terms the escrow will bind:
 * held USDC as the focal amount, named reviewer + short address, beneficiary,
 * and the deadline bound into the reclaim rule. Never mentions
 * Created/Released/Refunded or payout.
 */
export function FamilyReviewSummary({ plan, metadata }: FamilyReviewSummaryProps) {
  const reviewerName = plan.reviewerName ?? "Family reviewer";
  return (
    <div
      data-testid="family-review-summary"
      className="mb-2 rounded-lg border border-black/10 bg-white p-2.5"
    >
      <p className="flex items-baseline gap-1.5 font-mono tabular-nums text-black">
        <span className="text-base font-semibold">{formatUsdcGrouped(metadata.amountMicro)}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">USDC</span>
      </p>
      <dl className="mt-1.5 divide-y divide-black/8">
        <div className="flex items-center justify-between gap-3 py-1">
          <dt className="text-[11px] text-neutral-500">Reviewer</dt>
          <dd
            className="flex min-w-0 items-center gap-1.5 text-right text-[11px] text-black"
            title={`${reviewerName} ${metadata.reviewer}`}
          >
            <span className="font-medium">{reviewerName}</span>
            <span className="font-mono text-neutral-400">
              {compactAddress(metadata.reviewer)}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <dt className="text-[11px] text-neutral-500">Recipient</dt>
          <dd className="truncate text-right text-[11px] font-medium text-black">
            {plan.authorization.recipient}
          </dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
        Take it back after {formatDeadline(metadata.deadlineMs)} if they don’t act.
      </p>
    </div>
  );
}
