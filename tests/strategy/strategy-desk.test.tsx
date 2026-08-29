import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StrategyDesk } from "@/components/strategy/strategy-desk";

describe("StrategyDesk", () => {
  it("renders the evidence boundary and bounty gap", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Server-only SDK");
    expect(html).toContain("No signer");
    expect(html).toContain("No trade submitted");
    expect(html).toContain("not bounty-complete");
    expect(html).toContain("real Base mainnet OptionBook or Factory trade");
  });

  it("renders natural-language presets without a wallet gate", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Protect ETH downside");
    expect(html).toContain("Earn premium on BTC");
    expect(html).not.toContain("Connect wallet");
  });
});
