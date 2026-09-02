import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const MicroAmountSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const PositiveMicroAmountSchema = z.string().regex(/^[1-9]\d*$/);
const UnixSecondsSchema = z.number().int().nonnegative();
const PolicyHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const OvernightProtectionPolicySchema = z
  .strictObject({
    version: z.literal(1),
    policyId: z.string().min(1).max(96),
    underlying: z.enum(["ETH", "BTC"]),
    optionType: z.enum(["put", "call"]),
    side: z.enum(["buy", "sell"]),
    objective: z.enum(["downside_protection", "upside_participation", "income"]),
    perTradePremiumCapMicro: PositiveMicroAmountSchema,
    totalPremiumCapMicro: PositiveMicroAmountSchema,
    maxLossMicro: PositiveMicroAmountSchema,
    maxTrades: z.number().int().min(1).max(24),
    minExpirySeconds: z.number().int().min(3_600).max(366 * 86_400),
    maxExpirySeconds: z.number().int().min(3_600).max(366 * 86_400),
    maxQuoteAgeSeconds: z.number().int().min(1).max(300),
    maxSlippageBps: z.number().int().min(0).max(2_000),
    activeWindow: z.strictObject({
      startsAtSeconds: UnixSecondsSchema,
      endsAtSeconds: UnixSecondsSchema,
    }),
    authorityMode: z.enum(["smart_account_session_key", "funded_agent_wallet"]),
    killSwitchVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.activeWindow.endsAtSeconds <= value.activeWindow.startsAtSeconds) {
      context.addIssue({
        code: "custom",
        path: ["activeWindow", "endsAtSeconds"],
        message: "active window must end after it starts",
      });
    }
    if (value.maxExpirySeconds < value.minExpirySeconds) {
      context.addIssue({
        code: "custom",
        path: ["maxExpirySeconds"],
        message: "maximum expiry must not precede minimum expiry",
      });
    }
    if (BigInt(value.totalPremiumCapMicro) < BigInt(value.perTradePremiumCapMicro)) {
      context.addIssue({
        code: "custom",
        path: ["totalPremiumCapMicro"],
        message: "total premium cap must cover one permitted trade",
      });
    }
  });

export const OvernightProtectionSnapshotSchema = z.strictObject({
  evaluatedAtSeconds: UnixSecondsSchema,
  venueAvailable: z.boolean(),
  underlying: z.enum(["ETH", "BTC"]),
  optionType: z.enum(["put", "call"]),
  side: z.enum(["buy", "sell"]),
  objective: z.enum(["downside_protection", "upside_participation", "income"]),
  premiumMicro: PositiveMicroAmountSchema,
  estimatedMaxLossMicro: PositiveMicroAmountSchema,
  totalLossCommittedMicro: MicroAmountSchema,
  totalPremiumCommittedMicro: MicroAmountSchema,
  tradesExecuted: z.number().int().nonnegative(),
  expirySeconds: UnixSecondsSchema,
  quoteObservedAtSeconds: UnixSecondsSchema,
  slippageBps: z.number().int().nonnegative(),
  authority: z
    .strictObject({
      mode: z.enum(["smart_account_session_key", "funded_agent_wallet"]),
      authorityId: z.string().min(1).max(128),
      policyHash: PolicyHashSchema,
      policyVersion: z.number().int().nonnegative(),
      premiumCapMicro: PositiveMicroAmountSchema,
      lossCapMicro: PositiveMicroAmountSchema,
      expiresAtSeconds: UnixSecondsSchema,
      remainingSpendMicro: MicroAmountSchema,
    })
    .nullable(),
  killSwitch: z.strictObject({
    engaged: z.boolean(),
    version: z.number().int().nonnegative(),
  }),
});

export const OvernightProtectionBlockReasonSchema = z.enum([
  "invalid_policy",
  "invalid_snapshot",
  "kill_switch",
  "kill_switch_version",
  "outside_active_window",
  "venue_unavailable",
  "policy_mismatch",
  "stale_quote",
  "premium_limit",
  "loss_limit",
  "trade_limit",
  "expiry_out_of_range",
  "slippage_limit",
  "missing_authority",
  "authority_mismatch",
  "authority_expired",
  "authority_limit",
]);

export const OvernightProtectionEvaluationSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("blocked"),
      reason: OvernightProtectionBlockReasonSchema,
      execution: z.literal("none"),
    }),
  z
    .strictObject({
      kind: z.literal("eligible"),
      policyId: z.string().min(1).max(96),
      policyHash: PolicyHashSchema,
      policyVersion: z.literal(1),
      execution: z.literal("none"),
      requiresExplicitExecution: z.literal(true),
      premiumMicro: PositiveMicroAmountSchema,
      maximumSpendMicro: PositiveMicroAmountSchema,
      maximumLossMicro: PositiveMicroAmountSchema,
      totalLossLimitMicro: PositiveMicroAmountSchema,
      remainingLossAfterPlanMicro: MicroAmountSchema,
      remainingTotalPremiumMicro: MicroAmountSchema,
      tradesRemainingAfterPlan: z.number().int().nonnegative(),
      quoteAgeSeconds: z.number().int().nonnegative(),
      authorityMode: z.enum(["smart_account_session_key", "funded_agent_wallet"]),
      evaluatedAtSeconds: UnixSecondsSchema,
    }),
]);

export const OvernightProtectionDisclosureSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("invalid_policy"), execution: z.literal("none") }),
  z.strictObject({
    kind: z.literal("disclosure"),
    execution: z.literal("none"),
    authorityRequiredForExecution: z.literal(true),
    policyId: z.string().min(1).max(96),
    policyVersion: z.literal(1),
    policyHash: PolicyHashSchema,
    maximumSpendPerTradeMicro: PositiveMicroAmountSchema,
    maximumTotalSpendMicro: PositiveMicroAmountSchema,
    maximumTotalLossMicro: PositiveMicroAmountSchema,
    maximumTrades: z.number().int().min(1).max(24),
    activeWindow: z.strictObject({
      startsAtSeconds: UnixSecondsSchema,
      endsAtSeconds: UnixSecondsSchema,
    }),
  }),
]);

export type OvernightProtectionPolicy = z.infer<typeof OvernightProtectionPolicySchema>;
export type OvernightProtectionSnapshot = z.infer<typeof OvernightProtectionSnapshotSchema>;
export type OvernightProtectionEvaluation = z.infer<typeof OvernightProtectionEvaluationSchema>;
export type OvernightProtectionDisclosure = z.infer<typeof OvernightProtectionDisclosureSchema>;
export type OvernightProtectionBlockReason = z.infer<
  typeof OvernightProtectionBlockReasonSchema
>;

export function parseOvernightProtectionPolicy(
  value: unknown,
): OvernightProtectionPolicy | null {
  const result = OvernightProtectionPolicySchema.safeParse(value);
  return result.success ? result.data : null;
}

function canonicalPolicy(policy: OvernightProtectionPolicy): readonly unknown[] {
  return [
    "convey-overnight-protection-policy-v1",
    policy.version,
    policy.policyId,
    policy.underlying,
    policy.optionType,
    policy.side,
    policy.objective,
    policy.perTradePremiumCapMicro,
    policy.totalPremiumCapMicro,
    policy.maxLossMicro,
    policy.maxTrades,
    policy.minExpirySeconds,
    policy.maxExpirySeconds,
    policy.maxQuoteAgeSeconds,
    policy.maxSlippageBps,
    policy.activeWindow.startsAtSeconds,
    policy.activeWindow.endsAtSeconds,
    policy.authorityMode,
    policy.killSwitchVersion,
  ];
}

export function buildOvernightProtectionPolicyHash(policyInput: unknown): string {
  const policy = OvernightProtectionPolicySchema.parse(policyInput);
  const digest = sha256(utf8ToBytes(JSON.stringify(canonicalPolicy(policy))));
  return `0x${bytesToHex(digest)}`;
}

export function previewOvernightProtectionLimits(
  policyInput: unknown,
): OvernightProtectionDisclosure {
  const result = OvernightProtectionPolicySchema.safeParse(policyInput);
  if (!result.success) return { kind: "invalid_policy", execution: "none" };

  const policy = result.data;
  return OvernightProtectionDisclosureSchema.parse({
    kind: "disclosure",
    execution: "none",
    authorityRequiredForExecution: true,
    policyId: policy.policyId,
    policyVersion: policy.version,
    policyHash: buildOvernightProtectionPolicyHash(policy),
    maximumSpendPerTradeMicro: policy.perTradePremiumCapMicro,
    maximumTotalSpendMicro: policy.totalPremiumCapMicro,
    maximumTotalLossMicro: policy.maxLossMicro,
    maximumTrades: policy.maxTrades,
    activeWindow: policy.activeWindow,
  });
}

function blocked(reason: OvernightProtectionBlockReason): OvernightProtectionEvaluation {
  return { kind: "blocked", reason, execution: "none" };
}

function minimum(...values: bigint[]): bigint {
  return values.reduce((lowest, value) => (value < lowest ? value : lowest));
}

export function evaluateOvernightProtection(
  policyInput: unknown,
  snapshotInput: unknown,
): OvernightProtectionEvaluation {
  const policy = OvernightProtectionPolicySchema.safeParse(policyInput);
  if (!policy.success) return blocked("invalid_policy");

  const snapshot = OvernightProtectionSnapshotSchema.safeParse(snapshotInput);
  if (!snapshot.success) return blocked("invalid_snapshot");

  const rule = policy.data;
  const state = snapshot.data;
  const policyHash = buildOvernightProtectionPolicyHash(rule);

  if (state.killSwitch.engaged) return blocked("kill_switch");
  if (state.killSwitch.version !== rule.killSwitchVersion) {
    return blocked("kill_switch_version");
  }
  if (
    state.evaluatedAtSeconds < rule.activeWindow.startsAtSeconds ||
    state.evaluatedAtSeconds >= rule.activeWindow.endsAtSeconds
  ) {
    return blocked("outside_active_window");
  }
  if (!state.venueAvailable) return blocked("venue_unavailable");
  if (
    state.underlying !== rule.underlying ||
    state.optionType !== rule.optionType ||
    state.side !== rule.side ||
    state.objective !== rule.objective
  ) {
    return blocked("policy_mismatch");
  }

  const quoteAgeSeconds = state.evaluatedAtSeconds - state.quoteObservedAtSeconds;
  if (quoteAgeSeconds < 0 || quoteAgeSeconds > rule.maxQuoteAgeSeconds) {
    return blocked("stale_quote");
  }

  const premium = BigInt(state.premiumMicro);
  const committed = BigInt(state.totalPremiumCommittedMicro);
  const perTradeCap = BigInt(rule.perTradePremiumCapMicro);
  const totalCap = BigInt(rule.totalPremiumCapMicro);
  if (premium > perTradeCap || committed > totalCap || premium > totalCap - committed) {
    return blocked("premium_limit");
  }
  const estimatedLoss = BigInt(state.estimatedMaxLossMicro);
  const committedLoss = BigInt(state.totalLossCommittedMicro);
  const lossCap = BigInt(rule.maxLossMicro);
  if (
    estimatedLoss > lossCap ||
    committedLoss > lossCap ||
    estimatedLoss > lossCap - committedLoss
  ) {
    return blocked("loss_limit");
  }
  if (state.tradesExecuted >= rule.maxTrades) return blocked("trade_limit");

  const expiryDistance = state.expirySeconds - state.evaluatedAtSeconds;
  if (
    expiryDistance < rule.minExpirySeconds ||
    expiryDistance > rule.maxExpirySeconds
  ) {
    return blocked("expiry_out_of_range");
  }
  if (state.slippageBps > rule.maxSlippageBps) return blocked("slippage_limit");

  if (state.authority === null) return blocked("missing_authority");
  if (state.authority.mode !== rule.authorityMode) return blocked("authority_mismatch");
  if (
    state.authority.policyVersion !== rule.version ||
    state.authority.policyHash !== policyHash
  ) {
    return blocked("authority_mismatch");
  }
  const authorityPremiumCap = BigInt(state.authority.premiumCapMicro);
  const authorityLossCap = BigInt(state.authority.lossCapMicro);
  if (authorityPremiumCap > totalCap || authorityLossCap > lossCap) {
    return blocked("authority_limit");
  }
  if (state.authority.expiresAtSeconds <= state.evaluatedAtSeconds) {
    return blocked("authority_expired");
  }
  const remainingTotal = totalCap - committed;
  const remainingAuthority = BigInt(state.authority.remainingSpendMicro);
  if (
    remainingAuthority < premium ||
    committed + premium > authorityPremiumCap ||
    committedLoss + estimatedLoss > authorityLossCap
  ) {
    return blocked("authority_limit");
  }
  const remainingAuthorityCap = authorityPremiumCap - committed;

  return OvernightProtectionEvaluationSchema.parse({
    kind: "eligible",
    policyId: rule.policyId,
    policyHash,
    policyVersion: rule.version,
    execution: "none",
    requiresExplicitExecution: true,
    premiumMicro: state.premiumMicro,
    maximumSpendMicro: minimum(
      perTradeCap,
      remainingTotal,
      remainingAuthority,
      remainingAuthorityCap,
    ).toString(),
    maximumLossMicro: state.estimatedMaxLossMicro,
    totalLossLimitMicro: rule.maxLossMicro,
    remainingLossAfterPlanMicro: (lossCap - committedLoss - estimatedLoss).toString(),
    remainingTotalPremiumMicro: (remainingTotal - premium).toString(),
    tradesRemainingAfterPlan: rule.maxTrades - state.tradesExecuted - 1,
    quoteAgeSeconds,
    authorityMode: state.authority.mode,
    evaluatedAtSeconds: state.evaluatedAtSeconds,
  });
}
