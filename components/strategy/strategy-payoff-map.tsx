"use client";

import { motion, useReducedMotion } from "motion/react";
import type { StrategyResult, StrategyObjective } from "@/lib/strategy/intent";

export interface StrategyPayoffMapProps {
  /** The driving intent — a resolved preview wins over a draft, but either is
   * a qualitative shape only. No price, strike, or quote is implied. */
  intent: StrategyResult;
}

interface Profile {
  /** Human label for the protected shape (e.g. "Downside floor"). */
  shapeLabel: string;
  /** Accessible description of how the solid path relates to the dashed line. */
  ariaShape: string;
  /** SVG path data for the solid protected payoff. */
  protectedPath: string;
}

const PROFILES: Record<StrategyObjective, Profile> = {
  // A protective put caps losses below a floor, then rises with the holding.
  protect_downside: {
    shapeLabel: "Downside floor",
    ariaShape: "Limits downside while retaining upside participation",
    protectedPath: "M 60 96 L 176 96 L 176 96 L 290 32",
  },
  // A covered call keeps premium (shallower loss) but caps upside.
  earn_premium: {
    shapeLabel: "Capped upside",
    ariaShape: "Adds income while capping upside",
    protectedPath: "M 60 116 L 176 56 L 290 56 L 290 56",
  },
  // A collar pairs a downside floor with an upside cap.
  balanced_collar: {
    shapeLabel: "Floor and cap",
    ariaShape: "Limits downside while capping upside",
    protectedPath: "M 60 100 L 120 100 L 232 52 L 290 52",
  },
};

function horizonLabel(horizonDays: number | null): string {
  return horizonDays ? `${horizonDays}-day horizon` : "Open horizon";
}

/**
 * StrategyPayoffMap — a purely qualitative payoff workspace. The dashed line is
 * the unprotected holding; the solid path is the protected shape for the
 * objective. Axes are Falls / Unchanged / Rises with no numeric ticks. This is
 * a conceptual shape only: no strike, premium, quote, or trade is selected.
 */
export function StrategyPayoffMap({ intent }: StrategyPayoffMapProps) {
  const reduceMotion = useReducedMotion();
  const profile = PROFILES[intent.objective];
  const horizon = horizonLabel(intent.horizonDays);
  const ariaLabel =
    `Conceptual ${intent.strategy.name} payoff for ${intent.asset} over ${horizon.toLowerCase()}: ` +
    `${profile.ariaShape}. Not priced; no strike, premium, quote, or trade is selected.`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
          Conceptual payoff shape — not priced
        </p>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-400">
          <span className="font-semibold text-neutral-600">{intent.strategy.name}</span>
          {" · "}
          {intent.asset}
          {" · "}
          {horizon}
        </p>
      </div>

      <svg
        viewBox="0 0 320 180"
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full max-w-full"
      >
        <title>{ariaLabel}</title>

        {/* Axes — no numeric ticks, only qualitative direction labels. */}
        <line x1="36" y1="24" x2="36" y2="140" stroke="rgb(0 0 0 / 22%)" strokeWidth="1" />
        <line x1="36" y1="140" x2="300" y2="140" stroke="rgb(0 0 0 / 22%)" strokeWidth="1" />

        {/* Unprotected holding line — dashed. */}
        <line
          x1="60"
          y1="132"
          x2="290"
          y2="32"
          stroke="rgb(0 0 0 / 45%)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        <motion.path
          className="cv-payoff-path"
          initial={false}
          animate={{ d: profile.protectedPath }}
          transition={{
            duration: reduceMotion ? 0.001 : 0.6,
            ease: [0.22, 1, 0.36, 1],
          }}
          fill="none"
          stroke="rgb(0 0 0)"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis direction labels. */}
        <text x="80" y="158" textAnchor="middle" className="fill-neutral-500 text-[10px]">
          Falls
        </text>
        <text x="168" y="158" textAnchor="middle" className="fill-neutral-500 text-[10px]">
          Unchanged
        </text>
        <text x="256" y="158" textAnchor="middle" className="fill-neutral-500 text-[10px]">
          Rises
        </text>
      </svg>

      {/* Visible line-style legend — two items only: the dashed unprotected
          holding and the solid selected strategy. No numeric payoff is implied. */}
      <ul
        data-testid="payoff-legend"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-600"
      >
        <li data-line-style="dashed" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-5 border-t border-black/45 border-dashed"
          />
          Unprotected asset
        </li>
        <li data-line-style="solid" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-5 border-t-2 border-black"
          />
          selected strategy
        </li>
      </ul>

      <p className="text-[12px] font-medium tracking-[-0.01em] text-black">
        {profile.shapeLabel}
      </p>
      <p className="text-[11px] leading-5 text-neutral-500">
        No strike, premium, quote, or trade is selected.
      </p>
    </div>
  );
}
