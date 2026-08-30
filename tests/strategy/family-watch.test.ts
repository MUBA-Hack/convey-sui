import { describe, expect, it } from "vitest";
import { deriveFamilyWatchBrief, formatEvidenceTime } from "@/lib/strategy/family-watch";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { StrategyIntent } from "@/lib/strategy/intent";

const REMITTANCE: RemittanceContext = {
  source: "remittance",
  amountMyr: 500,
  recipient: "Ana",
  city: "Manila",
};

function liveMarket(overrides: Partial<Extract<ThetanutsSnapshot, { status: "live" }>>): ThetanutsSnapshot {
  return {
    status: "live",
    source: "Thetanuts Finance SDK",
    sdkVersion: "0.3.0",
    chain: "Base mainnet",
    fetchedAt: "2026-08-31T10:00:00.000Z",
    marketUpdatedAt: "2026-08-31T09:59:00.000Z",
    prices: { ETH: 4123.45, BTC: 112000 },
    orderCount: 12,
    samples: [
      {
        side: "maker_sells",
        optionType: "put",
        strikeUsd: 4000,
        premium: 125,
        expiry: "2026-10-01T00:00:00.000Z",
        availableAmount: "2",
      },
    ],
    ...overrides,
  };
}

const UNAVAILABLE: ThetanutsSnapshot = {
  status: "unavailable",
  source: "Thetanuts Finance SDK",
  sdkVersion: "0.3.0",
  chain: "Base mainnet",
  fetchedAt: "2026-08-31T10:00:00.000Z",
  reason: "Live market data is currently unavailable.",
};

// Strategy intents the desk's /api/strategy mapper resolves for the presets.
const ETH_DOWNSIDE_INTENT: StrategyIntent = {
  kind: "strategy",
  asset: "ETH",
  objective: "protect_downside",
  horizonDays: 30,
  strategy: {
    name: "Protective put",
    action: "buy_put",
    thesis: "A put can define a downside floor for an asset you already hold.",
    tradeoff: "Protection costs premium and expires; this mapping does not select or submit a contract.",
  },
  educationOnly: true,
};

const BTC_EARN_PREMIUM_INTENT: StrategyIntent = {
  kind: "strategy",
  asset: "BTC",
  objective: "earn_premium",
  horizonDays: null,
  strategy: {
    name: "Covered call",
    action: "sell_call",
    thesis: "A call written against an existing holding can exchange some upside for premium income.",
    tradeoff: "Upside can be capped and losses on the underlying remain; no position is opened here.",
  },
  educationOnly: true,
};

describe("deriveFamilyWatchBrief", () => {
  it("is unavailable when there is no family obligation to watch", () => {
    const brief = deriveFamilyWatchBrief({ remittance: null, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    expect(brief.status).toBe("unavailable");
    expect(brief.obligation).toBeNull();
    expect(brief.suggestedIntent).toBeNull();
    expect(brief.evidence).toBeNull();
    expect(brief.findings).toHaveLength(0);
  });

  it("is ready with the declared obligation even when market evidence is absent", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: null, strategy: ETH_DOWNSIDE_INTENT });
    expect(brief.status).toBe("ready");
    // ready always carries a non-null obligation; protectedNotionalMyr is no
    // longer duplicated from amountMyr.
    expect(brief.obligation).toEqual({
      recipient: "Ana",
      city: "Manila",
      amountMyr: 500,
    });
    expect(brief.evidence).toBeNull();
    // Honest absent-evidence finding, no suggestion.
    expect(brief.findings.some((f) => f.confidence === "absent")).toBe(true);
    expect(brief.suggestedIntent).toBeNull();
  });

  it("uses finished customer-outcome copy for the absent-market primary surface, not plumbing", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: null, strategy: ETH_DOWNSIDE_INTENT });
    const absent = brief.findings.find((f) => f.id === "market-absent");
    expect(absent).toBeDefined();
    // Primary copy reads as a finished product outcome, not internal plumbing.
    expect(absent?.headline).toBe("Market context will appear after you preview a strategy");
    // Recipient-aware next step ties the outcome back to the declared family.
    expect(absent?.relevance).toContain("Ana");
    expect(absent?.relevance).toContain("RM500");
    // No plumbing language leaks onto the primary surface.
    const json = JSON.stringify(absent);
    expect(json).not.toContain("snapshot carried");
    expect(json).not.toContain("market evidence absent");
  });

  it("always populates at least one finding when ready", () => {
    // Across every ready branch (live ETH, live non-ETH, unavailable market,
    // absent market) at least one finding is emitted — the ready variant of
    // the discriminated union never carries an empty findings array.
    const cases = [
      liveMarket({}),
      liveMarket({ prices: { ETH: null, BTC: 112000 } }),
      liveMarketNoPuts(),
      UNAVAILABLE,
      null,
    ] as const;
    for (const market of cases) {
      const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market, strategy: ETH_DOWNSIDE_INTENT });
      expect(brief.status).toBe("ready");
      expect(brief.findings.length).toBeGreaterThan(0);
    }
  });

  it("carries a customer-readable feed name (not an SDK badge) and honest provenance from a live read", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    expect(brief.evidence).not.toBeNull();
    // Source is a product feed name, not an SDK badge.
    expect(brief.evidence?.sourceLabel).toBe("Thetanuts options feed");
    expect(brief.evidence?.sourceLabel.toLowerCase()).not.toContain("sdk");
    // Both raw timestamps are carried for formatting downstream.
    expect(brief.evidence?.fetchedAt).toBe("2026-08-31T10:00:00.000Z");
    expect(brief.evidence?.marketUpdatedAt).toBe("2026-08-31T09:59:00.000Z");
    // Provenance is honest: read-only, and explicitly disclaims independent fact-checking.
    expect(brief.evidence?.provenance.toLowerCase()).toContain("read-only");
    expect(brief.evidence?.provenance.toLowerCase()).toContain("not independent");
  });

  it("reports the current ETH spot read and ties it to the family obligation", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({ prices: { ETH: 4123.45, BTC: null } }),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    const spot = brief.findings.find((f) => f.id === "eth-spot");
    expect(spot).toBeDefined();
    expect(spot?.headline).toContain("$4,123");
    expect(spot?.relevance).toContain("Ana");
    expect(spot?.confidence).toBe("observed");
  });

  it("surfaces a bounded suggested protective-put intent that always requires review", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    expect(brief.suggestedIntent).not.toBeNull();
    expect(brief.suggestedIntent).toMatchObject({
      asset: "ETH",
      objective: "protect_downside",
    });
    // Bounded: no strike, no transaction, no signer, no submission.
    const json = JSON.stringify(brief.suggestedIntent);
    expect(json).not.toContain("strike");
    expect(json).not.toContain("transaction");
    expect(json).not.toContain("calldata");
    expect(json).not.toContain("signer");
    expect(json).not.toContain("submit");
    // Tied to the declared obligation amount.
    expect(brief.suggestedIntent?.rationale).toContain("RM500");
  });

  it("does not suggest an intent when ETH spot is missing from the live read", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({ prices: { ETH: null, BTC: 112000 } }),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    expect(brief.findings.find((f) => f.id === "eth-spot")).toBeUndefined();
    expect(brief.suggestedIntent).toBeNull();
  });

  it("frames the read as a current snapshot and never invents a change delta", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    // No change-delta finding is ever produced — Family Watch has no prior
    // baseline in-product, so it must not fabricate a move.
    expect(brief.findings.find((f) => f.id === "eth-spot-change")).toBeUndefined();
    // Provenance is honest about the read-only boundary.
    expect(brief.evidence?.provenance.toLowerCase()).toContain("read-only");
  });

  it("shows an honest unavailable finding carrying the SDK reason and no suggestion", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: UNAVAILABLE,
      strategy: ETH_DOWNSIDE_INTENT,
    });
    const absent = brief.findings.find((f) => f.confidence === "absent");
    expect(absent).toBeDefined();
    expect(absent?.headline).toContain("Live market data is currently unavailable.");
    expect(brief.suggestedIntent).toBeNull();
  });

  it("keeps plumbing jargon out of the ready boundary note across every ready state", () => {
    // Pre-preview (absent market), BTC earn-premium, and ETH downside with no
    // put liquidity are the three no-suggestion ready states; the live ETH
    // read with puts is the one suggestion state. The primary note must read
    // as state-valid customer language in all of them.
    const cases = [
      { label: "live ETH with put liquidity", market: liveMarket({}) as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
      { label: "pre-preview (absent market)", market: null as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
      { label: "BTC earn-premium", market: liveMarket({}) as ThetanutsSnapshot | null, strategy: BTC_EARN_PREMIUM_INTENT },
      { label: "ETH downside with no puts", market: liveMarketNoPuts() as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
    ];
    for (const { label, market, strategy } of cases) {
      const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market, strategy });
      expect(brief.status).toBe("ready");
      const note = brief.note.toLowerCase();
      // No plumbing jargon on the primary surface; the read-only/provenance
      // boundary lives only in expandable evidence.
      expect(note, label).not.toContain("read-only");
      expect(note, label).not.toContain("snapshot");
      // Never claims protection is always suggested.
      expect(note, label).not.toContain("suggests a protection intent");
      // Never claims execution, signing, or submission.
      expect(note, label).not.toContain("execute");
      expect(note, label).not.toContain("sign");
      expect(note, label).not.toContain("submit");
      // State-valid customer comparison language is present.
      expect(note, label).toContain("compares");
      expect(note, label).toContain("market context");
      expect(note, label).toContain("review");
    }
  });

  it("keeps plumbing jargon out of the unavailable boundary note", () => {
    const brief = deriveFamilyWatchBrief({ remittance: null, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    expect(brief.status).toBe("unavailable");
    const note = brief.note.toLowerCase();
    expect(note).not.toContain("read-only");
    expect(note).not.toContain("snapshot");
    expect(note).not.toContain("suggests a protection intent");
    expect(note).not.toContain("execute");
    expect(note).not.toContain("sign");
    expect(note).not.toContain("submit");
  });
});

// A live read with only call orders — no put liquidity to support a hedge.
function liveMarketNoPuts(): ThetanutsSnapshot {
  return liveMarket({
    samples: [
      {
        side: "maker_sells",
        optionType: "call",
        strikeUsd: 120000,
        premium: 200,
        expiry: "2026-10-01T00:00:00.000Z",
        availableAmount: "1",
      },
    ],
  });
}

// Integration: the desk carries the resolved strategy intent/result into the
// pure brief input. Family Watch must never imply an ETH-backed obligation from
// remittance context alone, and must never recommend an ETH hedge for a BTC or
// earn-premium preview. A protective-put suggestion requires a genuinely ETH
// downside/protection strategy AND relevant put liquidity evidence.
describe("deriveFamilyWatchBrief — strategy-aware integration", () => {
  it("does not recommend ETH protection when the resolved strategy is BTC earn-premium", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: BTC_EARN_PREMIUM_INTENT,
    });
    expect(brief.status).toBe("ready");
    expect(brief.obligation).not.toBeNull();
    // No ETH protective-put suggestion for a BTC preview, even with ETH spot
    // and put liquidity visible in the same read.
    expect(brief.suggestedIntent).toBeNull();
    const html = JSON.stringify(brief);
    expect(html).not.toContain("protect_downside");
    // No finding frames ETH as backing the declared obligation.
    expect(brief.findings.find((f) => f.id === "eth-spot")).toBeUndefined();
    expect(brief.findings.find((f) => f.id === "put-liquidity")).toBeUndefined();
  });

  it("does not recommend ETH protection when ETH downside has no put orders in the read", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarketNoPuts(),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    expect(brief.status).toBe("ready");
    // ETH downside is the resolved strategy, but there is no put liquidity
    // evidence to support a protective-put suggestion — fail closed.
    expect(brief.suggestedIntent).toBeNull();
    expect(brief.findings.find((f) => f.id === "put-liquidity")).toBeUndefined();
  });

  it("recommends a bounded ETH protective put only for ETH downside with put liquidity", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: ETH_DOWNSIDE_INTENT,
    });
    expect(brief.suggestedIntent).not.toBeNull();
    expect(brief.suggestedIntent).toMatchObject({
      asset: "ETH",
      objective: "protect_downside",
    });
    expect(brief.findings.find((f) => f.id === "eth-spot")).toBeDefined();
    expect(brief.findings.find((f) => f.id === "put-liquidity")).toBeDefined();
  });

  it("never implies an ETH-backed obligation from remittance context alone (no strategy)", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: liveMarket({}),
      strategy: null,
    });
    expect(brief.suggestedIntent).toBeNull();
    expect(brief.findings.find((f) => f.id === "eth-spot")).toBeUndefined();
    expect(brief.findings.find((f) => f.id === "put-liquidity")).toBeUndefined();
  });
});

describe("formatEvidenceTime", () => {
  it("formats an ISO timestamp into a stable, product-friendly UTC label", () => {
    expect(formatEvidenceTime("2026-08-31T10:00:00.000Z")).toBe("31 Aug 2026 · 10:00 UTC");
    expect(formatEvidenceTime("2026-08-31T09:59:00.000Z")).toBe("31 Aug 2026 · 09:59 UTC");
  });

  it("returns a placeholder when the market-updated time is absent", () => {
    expect(formatEvidenceTime(null)).toBe("—");
  });

  it("returns a placeholder for an unparseable timestamp instead of throwing", () => {
    expect(formatEvidenceTime("not-a-date")).toBe("—");
  });
});
