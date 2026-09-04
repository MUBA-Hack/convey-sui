import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FamilyWatch } from "@/components/strategy/family-watch";
import { deriveFamilyWatchBrief } from "@/lib/strategy/family-watch";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { StrategyIntent } from "@/lib/strategy/intent";

const REMITTANCE: RemittanceContext = {
  source: "remittance",
  amountMyr: 500,
  recipient: "Ana",
  city: "Manila",
};

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
        asset: "ETH",
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

describe("FamilyWatch", () => {
  it("renders the Family Watch heading and the declared obligation", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).toContain("Family Watch");
    expect(html).toContain("Ana");
    expect(html).toContain("Manila");
    expect(html).toContain("RM500");
  });

  it("shows the current ETH read and why it matters to the obligation", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).toContain("$4,123");
    // Relevance ties the read back to the family recipient.
    expect(html).toContain("Ana");
  });

  it("shows a customer-readable feed name and both times in expandable evidence, no SDK badge", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    // Source is a product feed name, rendered in the expandable evidence block.
    expect(html).toContain("Thetanuts options feed");
    // Both fetch time and market-updated time are rendered in product-friendly form.
    expect(html).toContain("31 Aug 2026 · 10:00 UTC");
    expect(html).toContain("31 Aug 2026 · 09:59 UTC");
    // Raw ISO timestamps are not dumped into the customer surface.
    expect(html).not.toContain("2026-08-31T10:00:00.000Z");
    expect(html).not.toContain("2026-08-31T09:59:00.000Z");
    // Provenance disclosure is present in the expandable evidence block only.
    expect(html).toContain("Read-only snapshot from");
    expect(html).toContain("Not independent fact-checking");
    // SDK version / chain badges are NOT on the surface.
    expect(html).not.toContain("0.3.0");
    expect(html).not.toContain("Base mainnet");
    expect(html).not.toContain("SDK");
  });

  it("labels absent evidence as a confidence/evidence state, not a system-availability state", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: null, strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    // The absent confidence is presented as "No evidence", an evidence state.
    expect(html).toContain("No evidence");
    // The ambiguous "Unavailable" label is not used for the confidence chip.
    expect(html).not.toMatch(/<span[^>]*>Unavailable<\/span>/);
  });

  it("renders finished customer-outcome copy for an absent market, with a recipient-aware next step", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: null, strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    // Primary surface reads as a finished product outcome.
    expect(html).toContain("Market context will appear after you preview a strategy");
    // Recipient-aware next step ties the outcome back to the declared family.
    expect(html).toContain("Ana");
    expect(html).toContain("RM500");
    // No internal plumbing leaks onto the primary surface.
    expect(html).not.toContain("snapshot carried");
    expect(html).not.toContain("market evidence absent");
  });

  it("shows one bounded suggested intent that explicitly requires review", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).toContain("Protective put");
    expect(html).toContain("Review required");
    // No execution / submission claims on the primary surface.
    expect(html).not.toContain("submit");
    expect(html).not.toContain("execute");
  });

  it("renders a useful unavailable state when there is no obligation to watch", () => {
    const brief = deriveFamilyWatchBrief({ remittance: null, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).toContain("Family Watch");
    expect(html).toContain("No family obligation is declared");
    expect(html).not.toContain("Protective put");
  });

  it("renders an honest market-unavailable state without inventing a suggestion", () => {
    const brief = deriveFamilyWatchBrief({
      remittance: REMITTANCE,
      market: {
        status: "unavailable",
        source: "Thetanuts Finance SDK",
        sdkVersion: "0.3.0",
        chain: "Base mainnet",
        fetchedAt: "2026-08-31T10:00:00.000Z",
        reason: "Live market data is currently unavailable.",
      },
      strategy: ETH_DOWNSIDE_INTENT,
    });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).toContain("Live market data is currently unavailable.");
    expect(html).not.toContain("Protective put");
  });

  it("does not leak demo/mock/SDK badges into the primary surface", () => {
    const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market: liveMarket({}), strategy: ETH_DOWNSIDE_INTENT });
    const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
    expect(html).not.toContain("DEMO");
    expect(html).not.toContain("mock");
    expect(html).not.toContain("simulation");
    expect(html).not.toContain("SDK");
  });

  it("renders state-valid customer language in the boundary note across ready states, no plumbing jargon", () => {
    // The note is the always-visible primary boundary copy. It must read as
    // customer language across pre-preview, BTC, and no-suggestion states, and
    // must never claim protection is always suggested. The exact read-only
    // provenance boundary stays in the expandable evidence block only.
    const cases = [
      { label: "live ETH with put liquidity", market: liveMarket({}) as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
      { label: "pre-preview (absent market)", market: null as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
      { label: "BTC earn-premium", market: liveMarket({}) as ThetanutsSnapshot | null, strategy: BTC_EARN_PREMIUM_INTENT },
      { label: "ETH downside with no puts", market: liveMarketNoPuts() as ThetanutsSnapshot | null, strategy: ETH_DOWNSIDE_INTENT },
    ];
    for (const { label, market, strategy } of cases) {
      const brief = deriveFamilyWatchBrief({ remittance: REMITTANCE, market, strategy });
      expect(brief.status, label).toBe("ready");
      const html = renderToStaticMarkup(<FamilyWatch brief={brief} />);
      // State-valid customer comparison language is on the primary surface.
      expect(html, label).toContain("compares this transfer with current market context");
      expect(html, label).toContain("Review any suggested protection before you act");
      // The old always-visible plumbing copy is gone from the note. (The
      // expandable provenance still says "Read-only snapshot from …", which is
      // a different phrase and is intentionally not asserted against here.)
      expect(html, label).not.toContain("read-only market snapshot");
      expect(html, label).not.toContain("suggests a protection intent");
      // No execution / submission claims on the primary surface.
      expect(html, label).not.toContain("execute");
      expect(html, label).not.toContain("submit");
    }
  });
});

// A live read with only call orders — no put liquidity to support a hedge.
function liveMarketNoPuts(): ThetanutsSnapshot {
  return liveMarket({
    samples: [
      {
        asset: "BTC",
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
