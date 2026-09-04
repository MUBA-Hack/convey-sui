import { describe, expect, it } from "vitest";
import {
  maxProtectionPayoutMicro,
  parseProtectionPayoffInputs,
  payoffSliderBounds,
  premiumFractionPercent,
  protectionPayoffAt,
  type ProtectionPayoffInputsRaw,
} from "@/lib/strategy/protection-payoff";

function parse(raw: ProtectionPayoffInputsRaw) {
  const parsed = parseProtectionPayoffInputs(raw);
  if (!parsed) throw new Error("fixture must parse");
  return parsed;
}

const INPUTS = parse({
  strikeUsd: 4000,
  premiumAmountUsdc: "3000000",
  numContracts: "2400000",
});

describe("parseProtectionPayoffInputs", () => {
  it("accepts coherent live-order inputs", () => {
    expect(INPUTS).toEqual({
      strike8d: 400_000_000_000n,
      premiumMicro: 3_000_000n,
      contractsMicro: 2_400_000n,
    });
  });

  it("rejects a non-positive or non-finite strike", () => {
    expect(parseProtectionPayoffInputs({ strikeUsd: 0, premiumAmountUsdc: "1", numContracts: "1" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: -1, premiumAmountUsdc: "1", numContracts: "1" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: Number.NaN, premiumAmountUsdc: "1", numContracts: "1" })).toBeNull();
  });

  it("rejects malformed, fractional, zero, or negative premium and contract strings", () => {
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "3.00", numContracts: "2400000" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "0", numContracts: "2400000" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "-3000000", numContracts: "2400000" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "3000000", numContracts: "abc" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "3000000", numContracts: "0" })).toBeNull();
    expect(parseProtectionPayoffInputs({ strikeUsd: 4000, premiumAmountUsdc: "", numContracts: "2400000" })).toBeNull();
  });
});

describe("protectionPayoffAt", () => {
  it("returns zero payout at the strike and marks the protection unused", () => {
    expect(protectionPayoffAt(INPUTS, 4000)).toEqual({
      payoutMicro: 0n,
      netMicro: -3_000_000n,
      expiresUnused: true,
    });
  });

  it("pays (strike − settlement) × contracts in micro below the strike", () => {
    expect(protectionPayoffAt(INPUTS, 3000)).toEqual({
      payoutMicro: 2_400_000_000n,
      netMicro: 2_397_000_000n,
      expiresUnused: false,
    });
  });

  it("caps the payout at the maximum when settlement reaches zero", () => {
    const atZero = protectionPayoffAt(INPUTS, 0);
    expect(atZero.payoutMicro).toBe(9_600_000_000n);
    expect(atZero.payoutMicro).toBe(maxProtectionPayoutMicro(INPUTS));
  });

  it("shows a payout smaller than the premium near the strike", () => {
    const near = protectionPayoffAt(INPUTS, 3999);
    expect(near.payoutMicro).toBe(2_400_000n);
    expect(near.netMicro).toBe(-600_000n);
    expect(near.expiresUnused).toBe(false);
  });

  it("stays unused for any settlement at or above the strike", () => {
    expect(protectionPayoffAt(INPUTS, 4000.01).expiresUnused).toBe(true);
    expect(protectionPayoffAt(INPUTS, 8000).expiresUnused).toBe(true);
  });

  it("truncates exactly like integer contract math", () => {
    const odd = parse({ strikeUsd: 3333, premiumAmountUsdc: "1000000", numContracts: "1000001" });
    expect(protectionPayoffAt(odd, 0).payoutMicro).toBe(
      333_300_000_000n * 1_000_001n / 100_000_000n,
    );
  });

  it("treats a non-finite or negative settlement as zero", () => {
    expect(protectionPayoffAt(INPUTS, Number.NaN).payoutMicro).toBe(maxProtectionPayoutMicro(INPUTS));
    expect(protectionPayoffAt(INPUTS, -5).payoutMicro).toBe(maxProtectionPayoutMicro(INPUTS));
  });
});

describe("payoffSliderBounds", () => {
  it("spans zero to twice the strike with a readable step and strike default", () => {
    expect(payoffSliderBounds(4000)).toEqual({ min: 0, max: 8000, step: 10, value: 4000 });
  });

  it("scales the step with strike magnitude", () => {
    expect(payoffSliderBounds(95000)).toEqual({ min: 0, max: 190_000, step: 500, value: 95_000 });
    expect(payoffSliderBounds(250)).toEqual({ min: 0, max: 500, step: 1, value: 250 });
  });

  it("keeps a usable step for fractional strikes", () => {
    const bounds = payoffSliderBounds(4000.5);
    expect(bounds.step).toBe(20);
    expect(bounds.value).toBe(4000);
    expect(bounds.max).toBeCloseTo(8001);
  });
});

describe("premiumFractionPercent", () => {
  it("computes premium over the maximum possible payout", () => {
    expect(premiumFractionPercent(INPUTS)).toBeCloseTo((3_000_000 / 9_600_000_000) * 100, 10);
  });

  it("returns a positive ratio for a minimal position", () => {
    const tiny = parse({ strikeUsd: 1, premiumAmountUsdc: "1", numContracts: "1" });
    expect(premiumFractionPercent(tiny)).toBe(100);
  });
});
