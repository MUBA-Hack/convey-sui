// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrategyPayoffMap } from "@/components/strategy/strategy-payoff-map";
import type { StrategyResult } from "@/lib/strategy/intent";

function putIntent(asset: "ETH" | "BTC" = "ETH", horizonDays: number | null = 30): StrategyResult {
  return {
    kind: "strategy",
    asset,
    objective: "protect_downside",
    horizonDays,
    strategy: {
      name: "Protective put",
      action: "buy_put",
      thesis: "A put can define a downside floor for an asset you already hold.",
      tradeoff: "Protection costs premium and expires; this mapping does not select or submit a contract.",
    },
    educationOnly: true,
  };
}

function callIntent(asset: "ETH" | "BTC" = "ETH", horizonDays: number | null = 30): StrategyResult {
  return {
    kind: "strategy",
    asset,
    objective: "earn_premium",
    horizonDays,
    strategy: {
      name: "Covered call",
      action: "sell_call",
      thesis: "A call written against an existing holding can exchange some upside for premium income.",
      tradeoff: "Upside can be capped and losses on the underlying remain; no position is opened here.",
    },
    educationOnly: true,
  };
}

function collarIntent(asset: "ETH" | "BTC" = "ETH", horizonDays: number | null = 30): StrategyResult {
  return {
    kind: "strategy",
    asset,
    objective: "balanced_collar",
    horizonDays,
    strategy: {
      name: "Protective collar",
      action: "collar",
      thesis: "Pair a protective put with a covered call to define a downside floor while offsetting premium cost.",
      tradeoff: "The call can cap upside, and the hedge still depends on available strikes, expiry, and liquidity.",
    },
    educationOnly: true,
  };
}

/** Strip every disclaimer phrase so its mention of "strike/premium/quote/trade"
 * and "priced" does not trip the no-claim assertions. The SVG <title> carries
 * the full accessible disclaimer, so it is removed as a block. */
function withoutDisclaimer(text: string): string {
  return text
    .replace(/Conceptual payoff shape — not priced/gi, "")
    .replace(/No strike, premium, quote, or trade is selected\./gi, "")
    .replace(/Conceptual[\s\S]*?is selected\./gi, "")
    .replace(/not priced/gi, "");
}

describe("StrategyPayoffMap", () => {
  describe("truth boundary — every profile", () => {
    const profiles: Array<[string, StrategyResult]> = [
      ["protect_downside", putIntent()],
      ["earn_premium", callIntent()],
      ["balanced_collar", collarIntent()],
    ];

    for (const [name, intent] of profiles) {
      it(`${name}: states the two required disclaimers`, () => {
        const html = renderToStaticMarkup(<StrategyPayoffMap intent={intent} />);
        expect(html).toContain("Conceptual payoff shape — not priced");
        expect(html).toContain("No strike, premium, quote, or trade is selected.");
      });

      it(`${name}: is an accessible image with a descriptive label`, () => {
        const html = renderToStaticMarkup(<StrategyPayoffMap intent={intent} />);
        expect(html).toContain('role="img"');
        expect(html).toContain("aria-label");
      });

      it(`${name}: labels the three qualitative axes and no others`, () => {
        const html = renderToStaticMarkup(<StrategyPayoffMap intent={intent} />);
        expect(html).toContain("Falls");
        expect(html).toContain("Unchanged");
        expect(html).toContain("Rises");
      });

      it(`${name}: draws a dashed unprotected line and a solid protected path`, () => {
        const html = renderToStaticMarkup(<StrategyPayoffMap intent={intent} />);
        // The unprotected holding line is dashed.
        expect(html).toMatch(/stroke-dasharray="[^"]+"/);
        // The protected payoff path is a distinct solid path (no dasharray).
        expect(html).toContain("<path");
      });

      it(`${name}: fabricates no numeric payoff, price, strike, or return`, () => {
        const { container } = render(<StrategyPayoffMap intent={intent} />);
        const text = withoutDisclaimer(container.textContent ?? "");
        // No execution, breakeven, P/L, price, or return claims in the text.
        expect(text.toLowerCase()).not.toContain("breakeven");
        expect(text.toLowerCase()).not.toContain("p/l");
        expect(text.toLowerCase()).not.toContain("execute");
        expect(text.toLowerCase()).not.toContain("return");
        expect(text.toLowerCase()).not.toContain("price");
        expect(text).not.toContain("$");
        // The only digits allowed are the user's own horizon (e.g. "30-day").
        // No standalone numeric tick/strike/premium labels: strip the horizon
        // phrase, then no digits should remain in the text content.
        const stripped = text.replace(/\d+-day horizon/g, "").replace(/open horizon/gi, "");
        expect(stripped.replace(/[^0-9]/g, "")).toBe("");
        cleanup();
      });
    }
  });

  describe("visible line-style legend", () => {
    it("renders a two-item legend: Unprotected asset and selected strategy", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={putIntent()} />);
      expect(html).toContain("Unprotected asset");
      expect(html).toContain("selected strategy");
    });

    it("marks the unprotected legend item with a dashed line indicator", () => {
      const { container } = render(<StrategyPayoffMap intent={putIntent()} />);
      const legend = container.querySelector("[data-testid='payoff-legend']");
      expect(legend).not.toBeNull();
      const dashed = legend!.querySelector("[data-line-style='dashed']");
      expect(dashed).not.toBeNull();
      cleanup();
    });

    it("marks the strategy legend item with a solid line indicator", () => {
      const { container } = render(<StrategyPayoffMap intent={putIntent()} />);
      const legend = container.querySelector("[data-testid='payoff-legend']");
      const solid = legend!.querySelector("[data-line-style='solid']");
      expect(solid).not.toBeNull();
      cleanup();
    });
  });

  describe("aria descriptions — financial outcomes", () => {
    it("protect_downside: aria describes limiting downside while retaining upside", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={putIntent()} />);
      expect(html).toContain("Limits downside while retaining upside participation");
    });

    it("earn_premium: aria describes adding income while capping upside", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={callIntent()} />);
      expect(html).toContain("Adds income while capping upside");
    });

    it("balanced_collar: aria describes a truthful collar outcome", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={collarIntent()} />);
      expect(html).toContain("Limits downside while capping upside");
    });
  });

  describe("profile semantics", () => {
    it("protect_downside: describes a downside floor (protective put)", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={putIntent()} />);
      expect(html.toLowerCase()).toContain("downside floor");
      expect(html).toContain("Protective put");
    });

    it("earn_premium: describes capped upside (covered call)", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={callIntent()} />);
      expect(html.toLowerCase()).toContain("capped upside");
      expect(html).toContain("Covered call");
    });

    it("balanced_collar: describes a floor and a cap (protective collar)", () => {
      const html = renderToStaticMarkup(<StrategyPayoffMap intent={collarIntent()} />);
      expect(html.toLowerCase()).toContain("floor");
      expect(html.toLowerCase()).toContain("cap");
      expect(html).toContain("Protective collar");
    });

    it("carries the resolved asset and horizon as qualitative labels", () => {
      const html = renderToStaticMarkup(
        <StrategyPayoffMap intent={putIntent("ETH", 30)} />,
      );
      expect(html).toContain("ETH");
      expect(html).toContain("30-day horizon");
    });

    it("labels an open horizon qualitatively, never with a placeholder glyph", () => {
      const html = renderToStaticMarkup(
        <StrategyPayoffMap intent={putIntent("ETH", null)} />,
      );
      expect(html).toContain("Open horizon");
      // No question-mark placeholder for the horizon in the text content.
      expect(html).not.toContain("?");
    });

    it("keeps one persistent normalized path while the profile morphs", async () => {
      const { container, rerender } = render(
        <StrategyPayoffMap intent={putIntent()} />,
      );
      const path = container.querySelector(".cv-payoff-path");
      expect(path).not.toBeNull();
      expect(path?.getAttribute("d")?.match(/\bL\b/g)).toHaveLength(3);
      const startPath = path?.getAttribute("d");

      rerender(<StrategyPayoffMap intent={callIntent("BTC", null)} />);

      expect(container.querySelector(".cv-payoff-path")).toBe(path);
      expect(path?.getAttribute("d")).toBe(startPath);
      expect(
        screen.getAllByText(/Downside floor|Capped upside|Floor and cap/),
      ).toHaveLength(1);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
      });
      expect(path?.getAttribute("d")).not.toBe(startPath);
      expect(path?.getAttribute("d")).not.toBe(
        "M 60 116 L 176 56 L 290 56 L 290 56",
      );
      await waitFor(
        () => {
          expect(path?.getAttribute("d")).toBe(
            "M 60 116 L 176 56 L 290 56 L 290 56",
          );
        },
        { timeout: 1_000 },
      );
      cleanup();
    });
  });
});
