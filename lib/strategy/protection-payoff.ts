/**
 * Treasury protective-put payoff math — pure, client-safe, deterministic.
 *
 * Mirrors the cash-settled vanilla-put payout the Base option contract uses
 * (`simulatePayout(price, strikes, numContracts)`):
 *
 *   payoutMicro = max(0, strike8d − settlement8d) × numContractsMicro / 1e8
 *
 * `numContractsMicro` is the 6-decimal contract count produced by the live
 * order preview; one contract covers one unit of the underlying at the strike.
 * All arithmetic is integer and division truncates exactly like the contract,
 * so a displayed payoff can never drift from the on-chain formula.
 *
 * This module never fetches, never prices, and never asserts what the market
 * spot is. It evaluates one user-chosen hypothetical settlement price.
 */

const PRICE_SCALE_8D = 100_000_000n;

export interface ProtectionPayoffInputs {
  /** Strike in 8-decimal USD, positive. */
  strike8d: bigint;
  /** Quoted premium in USDC micro, positive. */
  premiumMicro: bigint;
  /** 6-decimal micro contract count from the order preview, positive. */
  contractsMicro: bigint;
}

export interface ProtectionPayoffInputsRaw {
  strikeUsd: number;
  premiumAmountUsdc: string;
  numContracts: string;
}

export interface ProtectionPayoffOutcome {
  /** Option payout at the settlement price, in USDC micro. */
  payoutMicro: bigint;
  /** Payout minus the quoted premium; negative when the payout is smaller. */
  netMicro: bigint;
  /** True when the settlement price is at or above the strike. */
  expiresUnused: boolean;
}

const MICRO_PATTERN = /^\d+$/u;

/** Null on any malformed, zero, or negative value. */
export function parseProtectionPayoffInputs(
  raw: ProtectionPayoffInputsRaw,
): ProtectionPayoffInputs | null {
  if (!Number.isFinite(raw.strikeUsd) || raw.strikeUsd <= 0) {
    return null;
  }
  if (!MICRO_PATTERN.test(raw.premiumAmountUsdc) || !MICRO_PATTERN.test(raw.numContracts)) {
    return null;
  }
  const premiumMicro = BigInt(raw.premiumAmountUsdc);
  const contractsMicro = BigInt(raw.numContracts);
  if (premiumMicro <= 0n || contractsMicro <= 0n) {
    return null;
  }
  const strike8d = BigInt(Math.round(raw.strikeUsd * Number(PRICE_SCALE_8D)));
  if (strike8d <= 0n) {
    return null;
  }
  return { strike8d, premiumMicro, contractsMicro };
}

export function protectionPayoffAt(
  inputs: ProtectionPayoffInputs,
  settlementUsd: number,
): ProtectionPayoffOutcome {
  const safeSettlement = Number.isFinite(settlementUsd) && settlementUsd > 0 ? settlementUsd : 0;
  const settlement8d = BigInt(Math.round(safeSettlement * Number(PRICE_SCALE_8D)));
  const intrinsic8d = settlement8d >= inputs.strike8d ? 0n : inputs.strike8d - settlement8d;
  const payoutMicro = intrinsic8d * inputs.contractsMicro / PRICE_SCALE_8D;
  return {
    payoutMicro,
    netMicro: payoutMicro - inputs.premiumMicro,
    expiresUnused: intrinsic8d === 0n,
  };
}

export function maxProtectionPayoutMicro(inputs: ProtectionPayoffInputs): bigint {
  return inputs.strike8d * inputs.contractsMicro / PRICE_SCALE_8D;
}

export function premiumFractionPercent(inputs: ProtectionPayoffInputs): number | null {
  const maxPayoutMicro = maxProtectionPayoutMicro(inputs);
  if (maxPayoutMicro <= 0n) {
    return null;
  }
  return (Number(inputs.premiumMicro) / Number(maxPayoutMicro)) * 100;
}

export function payoffSliderStep(strikeUsd: number): number {
  if (!Number.isFinite(strikeUsd) || strikeUsd <= 0) {
    return 1;
  }
  const target = strikeUsd / 400;
  for (let exponent = -3; exponent <= 6; exponent += 1) {
    for (const multiplier of [1, 2, 5]) {
      const candidate = multiplier * 10 ** exponent;
      if (candidate >= target) {
        return candidate;
      }
    }
  }
  return 1_000_000;
}

export interface PayoffSliderBounds {
  min: 0;
  max: number;
  step: number;
  value: number;
}

/** Slider bounds for hypothetical settlement prices: zero to twice the strike. */
export function payoffSliderBounds(strikeUsd: number): PayoffSliderBounds {
  const step = payoffSliderStep(strikeUsd);
  const max = Math.max(step, strikeUsd * 2);
  const value = Math.min(max, Math.max(0, Math.round(strikeUsd / step) * step));
  return { min: 0, max, step, value };
}
