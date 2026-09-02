import { describe, expect, it } from "vitest";
import {
  buildOvernightProtectionPolicyHash,
  evaluateOvernightProtection,
  parseOvernightProtectionPolicy,
  previewOvernightProtectionLimits,
} from "@/lib/companion/overnight-policy";

const NOW = 1_800_000_000;

const policy = {
  version: 1,
  policyId: "overnight-eth-floor",
  underlying: "ETH",
  optionType: "put",
  side: "buy",
  objective: "downside_protection",
  perTradePremiumCapMicro: "3000000",
  totalPremiumCapMicro: "9000000",
  maxLossMicro: "9000000",
  maxTrades: 3,
  minExpirySeconds: 7 * 86_400,
  maxExpirySeconds: 45 * 86_400,
  maxQuoteAgeSeconds: 30,
  maxSlippageBps: 75,
  activeWindow: {
    startsAtSeconds: NOW - 3_600,
    endsAtSeconds: NOW + 8 * 3_600,
  },
  authorityMode: "smart_account_session_key",
  killSwitchVersion: 4,
} as const;

const snapshot = {
  evaluatedAtSeconds: NOW,
  venueAvailable: true,
  underlying: "ETH",
  optionType: "put",
  side: "buy",
  objective: "downside_protection",
  premiumMicro: "2500000",
  estimatedMaxLossMicro: "2500000",
  totalLossCommittedMicro: "2000000",
  totalPremiumCommittedMicro: "3000000",
  tradesExecuted: 1,
  expirySeconds: NOW + 30 * 86_400,
  quoteObservedAtSeconds: NOW - 12,
  slippageBps: 50,
  authority: {
    mode: "smart_account_session_key",
    authorityId: "session-policy-7",
    policyHash: "",
    policyVersion: 1,
    premiumCapMicro: "9000000",
    lossCapMicro: "9000000",
    expiresAtSeconds: NOW + 3_600,
    remainingSpendMicro: "6000000",
  },
  killSwitch: { engaged: false, version: 4 },
} as const;

describe("overnight protection policy", () => {
  const boundSnapshot = {
    ...snapshot,
    authority: {
      ...snapshot.authority,
      policyHash: buildOvernightProtectionPolicyHash(policy),
    },
  } as const;

  it("strict-parses a bounded policy and rejects extra fields", () => {
    expect(parseOvernightProtectionPolicy(policy)?.policyId).toBe(policy.policyId);
    expect(parseOvernightProtectionPolicy({ ...policy, signer: "0xsecret" })).toBeNull();
  });

  it("discloses enforceable maximum spend and loss before authority exists", () => {
    expect(previewOvernightProtectionLimits(policy)).toEqual({
      kind: "disclosure",
      execution: "none",
      authorityRequiredForExecution: true,
      policyId: policy.policyId,
      policyVersion: 1,
      policyHash: buildOvernightProtectionPolicyHash(policy),
      maximumSpendPerTradeMicro: "3000000",
      maximumTotalSpendMicro: "9000000",
      maximumTotalLossMicro: "9000000",
      maximumTrades: 3,
      activeWindow: policy.activeWindow,
    });
    expect(previewOvernightProtectionLimits({ ...policy, maxTrades: 0 })).toEqual({
      kind: "invalid_policy",
      execution: "none",
    });
  });

  it("returns a non-executing eligible plan with explicit maximum spend and loss", () => {
    expect(evaluateOvernightProtection(policy, boundSnapshot)).toEqual({
      kind: "eligible",
      policyId: "overnight-eth-floor",
      policyHash: buildOvernightProtectionPolicyHash(policy),
      policyVersion: 1,
      execution: "none",
      requiresExplicitExecution: true,
      premiumMicro: "2500000",
      maximumSpendMicro: "3000000",
      maximumLossMicro: "2500000",
      totalLossLimitMicro: "9000000",
      remainingLossAfterPlanMicro: "4500000",
      remainingTotalPremiumMicro: "3500000",
      tradesRemainingAfterPlan: 1,
      quoteAgeSeconds: 12,
      authorityMode: "smart_account_session_key",
      evaluatedAtSeconds: NOW,
    });
  });

  it("reports a maximum spend no wider than remaining delegated authority", () => {
    const result = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: {
        ...boundSnapshot.authority,
        premiumCapMicro: "5500000",
        remainingSpendMicro: "9000000",
      },
    });
    expect(result).toMatchObject({ kind: "eligible", maximumSpendMicro: "2500000" });
  });

  it.each([
    ["stale quote", { quoteObservedAtSeconds: NOW - 31 }, "stale_quote"],
    ["future quote", { quoteObservedAtSeconds: NOW + 1 }, "stale_quote"],
    ["venue outage", { venueAvailable: false }, "venue_unavailable"],
    ["underlying mismatch", { underlying: "BTC" }, "policy_mismatch"],
    ["option mismatch", { optionType: "call" }, "policy_mismatch"],
    ["side mismatch", { side: "sell" }, "policy_mismatch"],
    ["objective mismatch", { objective: "income" }, "policy_mismatch"],
    ["per-trade premium exceeded", { premiumMicro: "3000001" }, "premium_limit"],
    ["total premium exceeded", { totalPremiumCommittedMicro: "7000000" }, "premium_limit"],
    ["loss cap exceeded", { estimatedMaxLossMicro: "9000001" }, "loss_limit"],
    ["aggregate loss cap exceeded", { totalLossCommittedMicro: "7000000" }, "loss_limit"],
    ["trade count exhausted", { tradesExecuted: 3 }, "trade_limit"],
    ["expiry too short", { expirySeconds: NOW + 6 * 86_400 }, "expiry_out_of_range"],
    ["slippage exceeded", { slippageBps: 76 }, "slippage_limit"],
    ["before active window", { evaluatedAtSeconds: NOW - 7_200 }, "outside_active_window"],
  ] as const)("blocks %s", (_name, override, reason) => {
    const result = evaluateOvernightProtection(policy, { ...boundSnapshot, ...override });
    expect(result).toMatchObject({ kind: "blocked", reason, execution: "none" });
  });

  it("blocks absent, wrong-mode, expired, or underfunded delegated authority", () => {
    const absent = evaluateOvernightProtection(policy, { ...boundSnapshot, authority: null });
    const wrongMode = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, mode: "funded_agent_wallet" as const },
    });
    const expired = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, expiresAtSeconds: NOW },
    });
    const underfunded = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, remainingSpendMicro: "2499999" },
    });

    expect(absent).toMatchObject({ kind: "blocked", reason: "missing_authority" });
    expect(wrongMode).toMatchObject({ kind: "blocked", reason: "authority_mismatch" });
    expect(expired).toMatchObject({ kind: "blocked", reason: "authority_expired" });
    expect(underfunded).toMatchObject({ kind: "blocked", reason: "authority_limit" });
  });

  it("blocks authority not bound to exact policy version/hash or broader than policy", () => {
    const wrongHash = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, policyHash: `0x${"0".repeat(64)}` },
    });
    const wrongVersion = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, policyVersion: 2 },
    });
    const premiumOverCap = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, premiumCapMicro: "9000001" },
    });
    const lossOverCap = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      authority: { ...boundSnapshot.authority, lossCapMicro: "9000001" },
    });

    expect(wrongHash).toMatchObject({ kind: "blocked", reason: "authority_mismatch" });
    expect(wrongVersion).toMatchObject({ kind: "blocked", reason: "authority_mismatch" });
    expect(premiumOverCap).toMatchObject({ kind: "blocked", reason: "authority_limit" });
    expect(lossOverCap).toMatchObject({ kind: "blocked", reason: "authority_limit" });
  });

  it("blocks engaged or version-mismatched kill switches", () => {
    const engaged = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      killSwitch: { engaged: true, version: 4 },
    });
    const staleVersion = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      killSwitch: { engaged: false, version: 3 },
    });

    expect(engaged).toMatchObject({ kind: "blocked", reason: "kill_switch" });
    expect(staleVersion).toMatchObject({ kind: "blocked", reason: "kill_switch_version" });
  });

  it("fails closed on malformed policy or snapshot input", () => {
    expect(evaluateOvernightProtection({ ...policy, maxTrades: 0 }, boundSnapshot)).toEqual({
      kind: "blocked",
      reason: "invalid_policy",
      execution: "none",
    });
    expect(evaluateOvernightProtection(policy, { ...boundSnapshot, premiumMicro: "2.5" })).toEqual({
      kind: "blocked",
      reason: "invalid_snapshot",
      execution: "none",
    });
  });

  it("accepts exact expiry, premium, loss, trade, and authority boundaries", () => {
    const exact = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      premiumMicro: "3000000",
      estimatedMaxLossMicro: "3000000",
      totalPremiumCommittedMicro: "6000000",
      totalLossCommittedMicro: "6000000",
      tradesExecuted: 2,
      expirySeconds: NOW + policy.maxExpirySeconds,
      slippageBps: policy.maxSlippageBps,
      authority: {
        ...boundSnapshot.authority,
        remainingSpendMicro: "3000000",
      },
    });

    expect(exact).toMatchObject({
      kind: "eligible",
      maximumSpendMicro: "3000000",
      maximumLossMicro: "3000000",
      remainingTotalPremiumMicro: "0",
      remainingLossAfterPlanMicro: "0",
      tradesRemainingAfterPlan: 0,
    });
  });

  it("treats active-window end as exclusive and blocks later evaluation", () => {
    const atEnd = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      evaluatedAtSeconds: policy.activeWindow.endsAtSeconds,
    });
    const afterEnd = evaluateOvernightProtection(policy, {
      ...boundSnapshot,
      evaluatedAtSeconds: policy.activeWindow.endsAtSeconds + 1,
    });

    expect(atEnd).toMatchObject({ kind: "blocked", reason: "outside_active_window" });
    expect(afterEnd).toMatchObject({ kind: "blocked", reason: "outside_active_window" });
  });
});
