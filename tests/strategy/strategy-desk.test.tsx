import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StrategyDesk } from "@/components/strategy/strategy-desk";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";

const REMITTANCE_CTX: RemittanceContext = {
  source: "remittance",
  amountMyr: 500,
  recipient: "Ana",
  city: "Manila",
};

describe("StrategyDesk", () => {
  it("renders the educational preview disclaimer and product labels", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    // Product heading and primary action label.
    expect(html).toContain("Protect");
    expect(html).toContain("Preview strategy");
    // Concise honest disclaimer near the bottom.
    expect(html).toContain("Educational preview");
    expect(html).toContain("you review before any trade");
  });

  it("leads the black hero with the protected notional and ETH downside label", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    // Primary metric is the default protected notional, not a duration.
    expect(html).toContain("RM2,400");
    // Companion label is the ETH downside, with horizon as secondary context.
    expect(html).toContain("ETH downside");
    expect(html).toContain("planning context");
    // Editable notional control is present and labelled as planning context.
    expect(html).toContain("Protected notional");
    expect(html).toContain('id="strategy-notional"');
  });

  it("states the educational-preview constraint exactly once", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    const matches = html.match(/you review before any trade/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does not surface SDK/version/server-only/no-signer badges in the hero", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).not.toContain("Server-only SDK");
    expect(html).not.toContain("No signer");
    expect(html).not.toContain("No trade submitted");
    expect(html).not.toContain("Official SDK");
    expect(html).not.toContain("not bounty-complete");
    expect(html).not.toContain("qualifying submission");
    expect(html).not.toContain("real Base mainnet OptionBook or Factory trade");
  });

  it("renders natural-language presets without a wallet gate", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Protect ETH downside");
    expect(html).toContain("Earn premium on BTC");
    expect(html).not.toContain("Connect wallet");
  });

  describe("remittance deep-link context", () => {
    it("shows the exact transfer row and caveat in context mode", () => {
      const html = renderToStaticMarkup(
        <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
      );
      // Eyebrow + heading for the context mode.
      expect(html).toContain("Optional treasury preview");
      expect(html).toContain("If these funds are held in ETH");
      // Related transfer row reads the actual carried values.
      expect(html).toContain("Related transfer");
      expect(html).toContain("Ana, Manila · RM500.00");
      // Primary action label is the ETH hedge preview.
      expect(html).toContain("Preview ETH hedge");
      // Always-visible disclosure — exact caveat copy.
      expect(html).toContain(
        "This educational preview is for an ETH position on Base. It does not protect the MYR→PHP rate, guarantee Ana’s payout, or execute a trade.",
      );
    });

    it("uses the carried amount as the planning notional in context mode", () => {
      const html = renderToStaticMarkup(
        <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
      );
      // The black hero leads with the carried RM500 planning notional.
      expect(html).toContain("RM500");
    });

    it("does not claim the hedge protects the FX rate or guarantees payout", () => {
      const html = renderToStaticMarkup(
        <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
      );
      // The disclosure explicitly disclaims protection/guarantee/execution.
      expect(html).toContain("does not protect the MYR→PHP rate");
      expect(html).toContain("guarantee Ana’s payout");
      expect(html).toContain("execute a trade");
    });

    it("standalone mode remains intact when no context is passed", () => {
      const html = renderToStaticMarkup(<StrategyDesk />);
      expect(html).toContain("Downside protection");
      expect(html).toContain("Protect");
      expect(html).toContain("Preview strategy");
      expect(html).not.toContain("Optional treasury preview");
      expect(html).not.toContain("Related transfer");
      expect(html).not.toContain("Preview ETH hedge");
    });
  });
});
