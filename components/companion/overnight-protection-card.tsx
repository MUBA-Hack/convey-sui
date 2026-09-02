"use client";

import Link from "next/link";
import { ArrowRight, ShieldTick } from "@/components/icons";
import { previewOvernightProtectionLimits } from "@/lib/companion/overnight-policy";

const MICRO = 1_000_000n;

export function formatMicroAmount(value: string): string {
  const amount = BigInt(value);
  const whole = amount / MICRO;
  const fraction = (amount % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function OvernightProtectionCard() {
  const limits = previewOvernightProtectionLimits({
    version: 1,
    policyId: "overnight-protection-preview",
    underlying: "ETH",
    optionType: "put",
    side: "buy",
    objective: "downside_protection",
    perTradePremiumCapMicro: "25000000",
    totalPremiumCapMicro: "50000000",
    maxLossMicro: "50000000",
    maxTrades: 3,
    minExpirySeconds: 86_400,
    maxExpirySeconds: 30 * 86_400,
    maxQuoteAgeSeconds: 30,
    maxSlippageBps: 100,
    activeWindow: { startsAtSeconds: 0, endsAtSeconds: 12 * 60 * 60 },
    authorityMode: "smart_account_session_key",
    killSwitchVersion: 0,
  });

  if (limits.kind !== "disclosure") return null;
  return (
    <div className="companion-result companion-feature-result companion-feature-result--ink">
      <div className="flex items-center justify-between gap-3">
        <p className="companion-eyebrow text-white/45">Overnight protection</p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white"><ShieldTick size={15} /></span>
      </div>
      <p className="mt-3 text-xl font-medium tracking-[-0.035em] text-white">Set the boundaries before you sleep.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <span className="companion-limit"><b>{formatMicroAmount(limits.maximumSpendPerTradeMicro)} USDC</b> per action</span>
        <span className="companion-limit"><b>{formatMicroAmount(limits.maximumTotalLossMicro)} USDC</b> maximum loss</span>
        <span className="companion-limit"><b>{limits.maximumTrades} actions</b> at most</span>
        <span className="companion-limit"><b>12 hours</b> active window</span>
      </div>
      <p className="mt-4 text-xs leading-5 text-white/55">This is a policy preview. Nothing can run until you create limited authority and approve the final plan.</p>
      <Link href="/strategy" className="mt-4 inline-flex min-h-11 w-full items-center justify-between rounded-full bg-white px-5 text-sm font-semibold text-black">
        Shape the plan <ArrowRight size={16} />
      </Link>
    </div>
  );
}
