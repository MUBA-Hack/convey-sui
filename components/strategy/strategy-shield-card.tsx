"use client";

import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";

const USDC_MICRO = 1_000_000;

export function formatUsdcMicro(micro: string): string {
  const n = Number(micro);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n / USDC_MICRO);
}

export function formatStrike(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

interface StrategyShieldCardProps {
  recommendation: ShieldRecommendation;
  horizonDays: number | null;
  reviewed: boolean;
  onReview: () => void;
  onAdjust: () => void;
}

function ShieldShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div
      data-testid="shield-recommendation"
      role={role}
      className="cv-money-sheet flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl lg:min-h-[36rem]"
    >
      {children}
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
      <ShieldShell role="status">
        <div className="flex flex-1 flex-col justify-between px-6 py-6 md:px-8 md:py-8">
          <div>
            <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
              Purchase Power Shield
            </p>
            <h2 className="mt-3 max-w-[18ch] text-[32px] font-semibold leading-[1.05] tracking-[-0.04em] text-black">
              No matching {recommendation.asset} protection
            </h2>
            <p className="mt-4 max-w-[38ch] text-[17px] leading-7 text-neutral-600">
              Nothing currently fits this asset and time window at your premium
              budget. Adjust the horizon or budget, then look again.
            </p>
          </div>
          <button
            type="button"
            onClick={onAdjust}
            className="cv-btn-solid mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold tracking-[-0.01em] text-white sm:w-auto"
          >
            Adjust goal
          </button>
        </div>
      </ShieldShell>
    );
  }

  if (recommendation.kind === "unavailable") {
    return (
      <ShieldShell role="alert">
        <div className="flex flex-1 flex-col justify-between px-6 py-6 md:px-8 md:py-8">
          <div>
            <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
              Purchase Power Shield
            </p>
            <h2 className="mt-3 max-w-[16ch] text-[32px] font-semibold leading-[1.05] tracking-[-0.04em] text-black">
              Protection terms unavailable
            </h2>
            <p className="mt-4 max-w-[38ch] text-[17px] leading-7 text-neutral-600">
              Live protection could not be assembled right now. Your goal is
              unchanged, and nothing was purchased.
            </p>
          </div>
          <button
            type="button"
            onClick={onAdjust}
            className="cv-btn-solid mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold tracking-[-0.01em] text-white sm:w-auto"
          >
            Try again
          </button>
        </div>
      </ShieldShell>
    );
  }

  const horizon = horizonDays != null ? `${horizonDays}-day` : "Timed";

  return (
    <ShieldShell>
      <div className="flex flex-1 flex-col">
        <div className="px-6 pt-6 pb-5 md:px-8 md:pt-8">
          <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
            Purchase Power Shield
          </p>
          <h2 className="mt-3 text-[36px] font-semibold leading-none tracking-[-0.045em] text-black md:text-[42px]">
            {recommendation.asset} downside floor
          </h2>
          <p className="mt-3 text-[17px] leading-7 text-neutral-600">
            {horizon} protective put · strike {formatStrike(recommendation.strikeUsd)}
          </p>
        </div>

        <div className="mt-auto grid grid-cols-1 gap-px bg-black/6 sm:grid-cols-2">
          <div className="bg-white px-6 py-5 md:px-8">
            <p className="text-[13px] font-medium text-neutral-500">Cost today</p>
            <p className="mt-2 text-[34px] font-semibold tabular-nums tracking-[-0.04em] text-black">
              {formatUsdcMicro(recommendation.premiumAmountUsdc)}
            </p>
          </div>
          <div className="bg-white px-6 py-5 md:px-8">
            <p className="text-[13px] font-medium text-neutral-500">Maximum loss</p>
            <p className="mt-2 text-[34px] font-semibold tabular-nums tracking-[-0.04em] text-black">
              {formatUsdcMicro(recommendation.maximumLossUsdc)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 bg-white px-6 py-5 md:flex-row md:items-end md:justify-between md:px-8">
          <p className="text-[15px] leading-6 text-neutral-600">
            Expires {formatExpiry(recommendation.expiresAt)}
          </p>
          <button
            type="button"
            onClick={onReview}
            className="cv-btn-solid inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-sm font-semibold tracking-[-0.01em] text-white"
          >
            {reviewed ? "Terms reviewed" : "Review protection"}
          </button>
        </div>

        {reviewed && (
          <p className="border-t border-black/6 bg-white px-6 py-5 text-[15px] leading-6 text-neutral-600 md:px-8">
            This is a treasury protection review for {recommendation.asset} you
            already hold. It does not protect a family transfer rate or payout.
            Nothing is purchased from this screen.
          </p>
        )}
      </div>
    </ShieldShell>
  );
}
