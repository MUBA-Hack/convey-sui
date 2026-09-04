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
  const intent = plan.authorization.intentBinding;
  const interpreter =
    intent?.interpretation.kind === "gonka"
      ? `Gonka · ${intent.interpretation.modelId}`
      : "Deterministic policy";
  return (
    <div
      data-testid="family-review-summary"
      className="mb-2 rounded-lg border border-black/10 bg-white p-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Enforceable Sui agreement
          </p>
          <p className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums text-black">
            <span className="text-base font-semibold">{formatUsdcGrouped(metadata.amountMicro)}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">USDC</span>
          </p>
        </div>
        <span className="rounded-full bg-black px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
          Ready to approve
        </span>
      </div>
      {intent && (
        <div className="mt-2 rounded-md bg-neutral-100 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Bound to your request
          </p>
          <p className="mt-1 text-xs font-medium leading-snug text-black">
            {intent.originalIntent}
          </p>
          <p className="mt-1 text-[10px] text-neutral-500">{interpreter}</p>
        </div>
      )}
      {plan.evidenceRequirements && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Release checks
          </p>
          <ul className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2">
            {plan.evidenceRequirements.map((requirement) => (
              <li key={requirement} className="flex items-start gap-1.5 text-[10px] leading-4 text-neutral-600">
                <span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-black" />
                {requirement}
              </li>
            ))}
          </ul>
        </div>
      )}
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
      <p className="mt-1 font-mono text-[9px] text-neutral-400" title={metadata.commitmentHex}>
        Agreement {compactAddress(metadata.commitmentHex)} · hash anchored on Sui
      </p>
    </div>
  );
}
