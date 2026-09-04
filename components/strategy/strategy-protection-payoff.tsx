"use client";

import { useId, useMemo, useState } from "react";

import { Lock } from "@/components/icons";
import {
  formatMatchedAtUtc,
  formatSettlementUsd,
  formatUsdcMicro,
} from "@/lib/strategy/format";
import {
  maxProtectionPayoutMicro,
  parseProtectionPayoffInputs,
  payoffSliderBounds,
  premiumFractionPercent,
  protectionPayoffAt,
  type ProtectionPayoffInputs,
} from "@/lib/strategy/protection-payoff";
import type { LiveRecommendation } from "@/lib/strategy/shield-recommendation";

function formatPercent(percent: number): string {
  if (percent >= 0.01) return `${percent.toFixed(2)}%`;
  return "<0.01%";
}

function payoffSentence(
  asset: string,
  settlementUsd: number,
  outcome: { payoutMicro: bigint; netMicro: bigint; expiresUnused: boolean },
  premiumMicro: bigint,
): string {
  const settlement = formatSettlementUsd(settlementUsd);
  if (outcome.expiresUnused) {
    return `At ${settlement}, the protection expires unused. Your ${asset} keeps its market value; the premium is not returned.`;
  }
  const payout = formatUsdcMicro(outcome.payoutMicro.toString());
  if (outcome.netMicro >= 0n) {
    const net = formatUsdcMicro(outcome.netMicro.toString());
    return `At ${settlement}, the protection pays ${payout}. After the premium, it is worth ${net} net.`;
  }
  const premium = `${formatUsdcMicro(premiumMicro.toString())} USDC`;
  return `At ${settlement}, the protection pays ${payout}, which is less than the ${premium} premium.`;
}

function PayoffUnavailable() {
  return (
    <section
      data-testid="protection-payoff"
      aria-label="What this pays you"
      className="cv-money-tile mx-6 mt-5 overflow-hidden rounded-[22px] bg-black text-white md:mx-8"
    >
      <div className="px-5 py-5 md:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          What this pays you
        </p>
        <p className="mt-3 text-[14px] leading-6 text-white/80">
          The payoff breakdown is not available for these terms. The floor and
          end date above still apply.
        </p>
      </div>
    </section>
  );
}

function PayoffInteractive({
  recommendation,
  inputs,
}: {
  recommendation: LiveRecommendation;
  inputs: ProtectionPayoffInputs;
}) {
  const sliderId = useId();
  const bounds = payoffSliderBounds(recommendation.strikeUsd);
  const [settlementUsd, setSettlementUsd] = useState(bounds.value);

  const outcome = protectionPayoffAt(inputs, settlementUsd);
  const maxPayoutMicro = maxProtectionPayoutMicro(inputs);
  const fractionPercent = premiumFractionPercent(inputs);
  const matchedAt = formatMatchedAtUtc(recommendation.fetchedAt);

  return (
    <section
      data-testid="protection-payoff"
      aria-label="What this pays you"
      className="mt-5 flex flex-col gap-3"
    >
      <div className="cv-money-tile mx-6 overflow-hidden rounded-[22px] bg-black text-white md:mx-8">
        <div className="px-5 py-5 md:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
            What this pays you
          </p>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <label
              htmlFor={sliderId}
              className="text-[13px] font-medium text-white/55"
            >
              If {recommendation.asset} settles at
            </label>
            <span
              data-testid="payoff-settlement-value"
              className="text-[28px] font-semibold tabular-nums tracking-[-0.03em] text-white"
            >
              {formatSettlementUsd(settlementUsd)}
            </span>
          </div>
          <input
            id={sliderId}
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={settlementUsd}
            onChange={(event) => setSettlementUsd(Number(event.target.value))}
            className="mt-2 block h-11 w-full cursor-pointer accent-white"
          />

          <p
            data-testid="payoff-result"
            aria-live="polite"
            className="mt-3 min-h-12 text-[14px] leading-6 text-white/85"
          >
            {payoffSentence(
              recommendation.asset,
              settlementUsd,
              outcome,
              inputs.premiumMicro,
            )}
          </p>
        </div>

        <div className="border-t border-white/12 px-5 py-4 md:px-6">
          <p className="text-[14px] leading-6 text-white/85">
            <strong className="font-semibold text-white">
              Maximum loss: {formatUsdcMicro(inputs.premiumMicro.toString())}{" "}
              USDC.
            </strong>{" "}
            The premium, paid once. Nothing else is at risk from this proposal.
          </p>
          {fractionPercent !== null && (
            <p className="mt-2 text-[13px] leading-6 text-white/60">
              The premium is {formatPercent(fractionPercent)} of the most this
              protection could ever pay (
              {formatUsdcMicro(maxPayoutMicro.toString())}).
            </p>
          )}
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-6 text-white/60">
            <Lock size="15" variant="Linear" className="mt-1 shrink-0" aria-hidden="true" />
            <span>
              Your {recommendation.asset} stays in your wallet. Only this
              option purchase is proposed, and nothing happens until you
              approve it in your wallet.
            </span>
          </p>
        </div>
      </div>

      {matchedAt && (
        <p
          data-testid="payoff-freshness"
          className="px-6 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500 md:px-8"
        >
          Terms matched {matchedAt} · Base
        </p>
      )}
    </section>
  );
}

/**
 * What a proposed protection order pays at different settlement prices.
 *
 * Current market reference: the live-offer response carries no market
 * snapshot (the strategy route returns one only on the educational branch),
 * so no spot price is shown here. Quote freshness comes from the
 * recommendation's own fetchedAt; nothing is invented beyond it.
 */
export function StrategyProtectionPayoff({
  recommendation,
}: {
  recommendation: LiveRecommendation;
}) {
  const inputs = useMemo(
    () =>
      parseProtectionPayoffInputs({
        strikeUsd: recommendation.strikeUsd,
        premiumAmountUsdc: recommendation.premiumAmountUsdc,
        numContracts: recommendation.numContracts,
      }),
    [
      recommendation.strikeUsd,
      recommendation.premiumAmountUsdc,
      recommendation.numContracts,
    ],
  );

  if (!inputs) {
    return <PayoffUnavailable />;
  }
  return <PayoffInteractive recommendation={recommendation} inputs={inputs} />;
}
