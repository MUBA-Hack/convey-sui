"use client";

import { Refresh, ShieldSearch, type IconComponent } from "@/components/icons";
import {
  formatProtectionExpiry,
  formatStrike,
  formatUsdcMicro,
} from "@/lib/strategy/format";
import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";

interface StrategyShieldCardProps {
  recommendation: ShieldRecommendation;
  horizonDays: number | null;
  reviewed: boolean;
  onReview: () => void;
  onAdjust: () => void;
}

function ShieldShell({
  children,
  matchDeskHeight = false,
  role,
}: {
  children: React.ReactNode;
  matchDeskHeight?: boolean;
  role?: "status" | "alert";
}) {
  return (
    <div
      data-testid="shield-recommendation"
      role={role}
      className={`cv-money-sheet flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl ${matchDeskHeight ? "lg:min-h-[42.375rem]" : "lg:min-h-[36rem]"}`}
    >
      {children}
    </div>
  );
}

interface ShieldStatusCardProps {
  actionLabel: string;
  actionNote: string;
  body: string;
  facts: ReadonlyArray<{ label: string; value: string }>;
  icon: IconComponent;
  statusLabel: string;
  statusTitle: string;
  title: string;
  onAction: () => void;
}

function ShieldStatusCard({
  actionLabel,
  actionNote,
  body,
  facts,
  icon: StatusIcon,
  statusLabel,
  statusTitle,
  title,
  onAction,
}: ShieldStatusCardProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-6 pt-6 pb-5 md:px-8 md:pt-8">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
          Purchase Power Shield
        </p>
        <h2 className="mt-3 max-w-[18ch] text-[32px] font-semibold leading-[1.05] tracking-[-0.04em] text-black">
          {title}
        </h2>
        <p className="mt-3 max-w-[38ch] text-[16px] leading-7 text-neutral-600">
          {body}
        </p>
      </div>

      <div
        data-testid="shield-status-motif"
        className="cv-money-tile mx-6 overflow-hidden rounded-[22px] bg-black text-white md:mx-8"
      >
        <div className="flex items-center gap-4 px-5 py-5 md:px-6">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/18 text-white">
            <StatusIcon size="22" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-white/55">{statusLabel}</p>
            <p className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-white">
              {statusTitle}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-white/12 bg-white/12">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-black px-5 py-4 md:px-6">
              <dt className="text-[12px] font-medium text-white/50">{fact.label}</dt>
              <dd className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-white">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-auto flex flex-col gap-4 border-t border-black/6 px-6 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <p className="max-w-[24ch] text-[14px] leading-6 text-neutral-600">
          {actionNote}
        </p>
        <button
          type="button"
          onClick={onAction}
          className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold tracking-[-0.01em] text-white sm:w-auto"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export function StrategyShieldCard({
  recommendation,
  horizonDays,
  reviewed,
  onReview,
  onAdjust,
}: StrategyShieldCardProps) {
  if (recommendation.kind === "no_match") {
    return (
      <ShieldShell role="status" matchDeskHeight>
        <ShieldStatusCard
          actionLabel="Adjust goal"
          actionNote="Change the window or budget, then search again."
          body="No current offer fits both your timing and premium budget."
          facts={[
            { label: "Asset", value: recommendation.asset },
            {
              label: "Window",
              value: horizonDays == null ? "Flexible" : `${horizonDays} days`,
            },
          ]}
          icon={ShieldSearch}
          statusLabel="Search complete"
          statusTitle="No offer fits"
          title={`No matching ${recommendation.asset} protection`}
          onAction={onAdjust}
        />
      </ShieldShell>
    );
  }

  if (recommendation.kind === "unavailable") {
    return (
      <ShieldShell role="alert" matchDeskHeight>
        <ShieldStatusCard
          actionLabel="Try again"
          actionNote="Retry with the same goal when you are ready."
          body="Terms are not ready right now. Your goal remains unchanged."
          facts={[
            { label: "Goal", value: "Kept" },
            { label: "Purchase", value: "None" },
          ]}
          icon={Refresh}
          statusLabel="Search paused"
          statusTitle="Terms not ready"
          title="Protection terms unavailable"
          onAction={onAdjust}
        />
      </ShieldShell>
    );
  }

  return (
    <ShieldShell>
      <div className="flex flex-1 flex-col">
        <div className="px-6 pt-6 pb-5 md:px-8 md:pt-8">
          <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
            Protection offer
          </p>
          <h2 className="mt-3 text-[36px] font-semibold leading-none tracking-[-0.045em] text-black md:text-[42px]">
            Protect your {recommendation.asset} {horizonDays == null ? "for a set time" : `for ${horizonDays} days`}
          </h2>
          <p className="mt-3 max-w-[38ch] text-[17px] leading-7 text-neutral-600">
            Keep a floor under {recommendation.asset} you already hold. It can
            expire unused if the market stays above that floor.
          </p>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-px bg-black/6 sm:grid-cols-3">
          <div className="bg-white px-6 py-5 md:px-8">
            <p className="text-[13px] font-medium text-neutral-500">Floor</p>
            <p className="mt-2 text-[30px] font-semibold tabular-nums tracking-[-0.04em] text-black">
              {formatStrike(recommendation.strikeUsd)}
            </p>
          </div>
          <div className="bg-white px-6 py-5 md:px-8">
            <p className="text-[13px] font-medium text-neutral-500">Budget limit</p>
            <p className="mt-2 text-[30px] font-semibold tabular-nums tracking-[-0.04em] text-black">
              {formatUsdcMicro(recommendation.premiumAmountUsdc)}
            </p>
          </div>
          <div className="col-span-2 bg-white px-6 py-5 sm:col-span-1 md:px-8">
            <p className="text-[13px] font-medium text-neutral-500">Ends</p>
            <p className="mt-2 text-[23px] font-semibold tracking-[-0.03em] text-black">
              {formatProtectionExpiry(recommendation.expiresAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 bg-white px-6 py-5 md:flex-row md:items-end md:justify-between md:px-8">
          <p className="text-[14px] leading-6 text-neutral-600">
            Your final cost may be lower. It will never exceed this limit.
          </p>
          <button
            type="button"
            onClick={onReview}
            className="cv-btn-solid inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-sm font-semibold tracking-[-0.01em] text-white"
          >
            {reviewed ? "Continue to wallet" : "Review and continue"}
          </button>
        </div>

        {reviewed && (
          <p className="border-t border-black/6 bg-white px-6 py-5 text-[15px] leading-6 text-neutral-600 md:px-8">
            This covers {recommendation.asset} you already hold. It does not
            protect a family transfer rate or payout.
          </p>
        )}
      </div>
    </ShieldShell>
  );
}
