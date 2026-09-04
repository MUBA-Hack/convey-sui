// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrategyProtectionPayoff } from "@/components/strategy/strategy-protection-payoff";
import type { LiveRecommendation } from "@/lib/strategy/shield-recommendation";

const LIVE: LiveRecommendation = {
  kind: "live",
  fetchedAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  asset: "ETH",
  optionType: "put",
  strikeUsd: 4000,
  pricePerContractUsd: 1.25,
  premiumBudgetUsd: 3,
  premiumAmountUsdc: "3000000",
  maximumLossUsdc: "3000000",
  numContracts: "2400000",
  collateralToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chainId: 8453,
  execution: "none",
  approvalRequired: true,
  disclosure: "Read-only protective-put preflight.",
  offerFingerprint: "0x" + "a".repeat(64),
};

function renderPanel(overrides: Partial<LiveRecommendation> = {}) {
  return render(<StrategyProtectionPayoff recommendation={{ ...LIVE, ...overrides }} />);
}

function resultText(): string {
  return screen.getByTestId("payoff-result").textContent ?? "";
}

afterEach(cleanup);

describe("StrategyProtectionPayoff — settlement control", () => {
  it("renders a labelled, keyboard-operable slider bounded at twice the strike", () => {
    renderPanel();
    const slider = screen.getByRole("slider", { name: /If ETH settles at/ });
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "8000");
    expect(slider).toHaveAttribute("step", "10");
    expect(slider).toHaveAttribute("value", "4000");
    expect(screen.getByTestId("payoff-settlement-value").textContent).toBe("$4,000");
  });

  it("states the option payoff and the net value after premium below the strike", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("slider", { name: /If ETH settles at/ }), {
      target: { value: "3000" },
    });
    expect(screen.getByTestId("payoff-settlement-value").textContent).toBe("$3,000");
    expect(resultText()).toBe(
      "At $3,000, the protection pays $2,400.00. After the premium, it is worth $2,397.00 net.",
    );
  });

  it("distinguishes a payout smaller than the premium near the strike", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("slider", { name: /If ETH settles at/ }), {
      target: { value: "3999" },
    });
    expect(resultText()).toBe(
      "At $3,999, the protection pays $2.40, which is less than the $3.00 USDC premium.",
    );
  });

  it("states the unused outcome at the strike without inventing a payout", () => {
    renderPanel();
    expect(resultText()).toBe(
      "At $4,000, the protection expires unused. Your ETH keeps its market value; the premium is not returned.",
    );
  });

  it("announces result changes to assistive technology", () => {
    renderPanel();
    expect(screen.getByTestId("payoff-result")).toHaveAttribute("aria-live", "polite");
  });
});

describe("StrategyProtectionPayoff — truth boundaries", () => {
  it("states the maximum loss as the premium, never the portfolio value", () => {
    const html = renderToStaticMarkup(<StrategyProtectionPayoff recommendation={LIVE} />);
    expect(html).toContain("Maximum loss: $3.00 USDC.");
    expect(html).toContain("The premium, paid once. Nothing else is at risk from this proposal.");
    expect(html).not.toContain("portfolio");
  });

  it("shows the premium as a fraction of the maximum possible payout", () => {
    const html = renderToStaticMarkup(<StrategyProtectionPayoff recommendation={LIVE} />);
    expect(html).toContain("The premium is 0.03% of the most this protection could ever pay ($9,600.00).");
  });

  it("keeps custody and the wallet approval boundary explicit", () => {
    const html = renderToStaticMarkup(<StrategyProtectionPayoff recommendation={LIVE} />);
    expect(html).toContain("Your ETH stays in your wallet.");
    expect(html).toContain("nothing happens until you approve it in your wallet.");
  });

  it("shows quote freshness only from the recommendation's own timestamp", () => {
    const html = renderToStaticMarkup(<StrategyProtectionPayoff recommendation={LIVE} />);
    expect(html).toContain("Terms matched Sep 4, 2026 · 00:00 UTC · Base");
    expect(html).not.toContain("spot");
    expect(html).not.toContain("now");
  });

  it("omits the freshness line when the timestamp is unusable", () => {
    renderPanel({ fetchedAt: "not-a-date" });
    expect(screen.queryByTestId("payoff-freshness")).toBeNull();
  });

  it("makes no execution, confirmation, or purchase claim", () => {
    const html = renderToStaticMarkup(<StrategyProtectionPayoff recommendation={LIVE} />);
    for (const forbidden of ["Confirmed", "Submitted", "Purchased", "Executed", "Successful", "thetanuts", "0x833589"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe("StrategyProtectionPayoff — missing data", () => {
  it("falls back honestly when payoff inputs are unusable", () => {
    renderPanel({ numContracts: "0" });
    expect(screen.getByTestId("protection-payoff").textContent).toContain(
      "The payoff breakdown is not available for these terms.",
    );
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByTestId("payoff-freshness")).toBeNull();
  });

  it("falls back honestly on a non-positive strike", () => {
    renderPanel({ strikeUsd: 0 });
    expect(screen.getByTestId("protection-payoff").textContent).toContain(
      "The payoff breakdown is not available for these terms.",
    );
  });
});
