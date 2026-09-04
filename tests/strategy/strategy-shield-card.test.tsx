// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrategyDesk } from "@/components/strategy/strategy-desk";
import { StrategyShieldCard } from "@/components/strategy/strategy-shield-card";
import { formatStrike, formatUsdcMicro } from "@/lib/strategy/format";
import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";

const LIVE: ShieldRecommendation = {
  kind: "live",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  asset: "ETH",
  optionType: "put",
  strikeUsd: 4000,
  pricePerContractUsd: 1.25,
  premiumBudgetUsd: 3,
  premiumAmountUsdc: "3000000",
  maximumLossUsdc: "3000000",
  numContracts: "40",
  collateralToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chainId: 8453,
  execution: "none",
  approvalRequired: true,
  disclosure: "Read-only protective-put preflight.",
  offerFingerprint: "0x" + "a".repeat(64),
};

function shieldResponse(recommendation: ShieldRecommendation) {
  return {
    ok: true,
    json: async () => ({
      intent: {
        kind: "strategy",
        asset: "ETH",
        objective: "protect_downside",
        horizonDays: 30,
        strategy: {
          name: "Protective put",
          action: "buy_put",
          thesis: "A put can define a downside floor for an asset you already hold.",
          tradeoff: "Protection costs premium and expires.",
        },
        educationOnly: true,
      },
      recommendation,
      execution: "none",
      disclosure: "Actionable protective-put preflight.",
    }),
  };
}

describe("StrategyShieldCard copy", () => {
  it("formats micro USDC as dollars", () => {
    expect(formatUsdcMicro("50000000")).toBe("$50.00");
    expect(formatStrike(4000)).toBe("$4,000");
  });

  it("renders live terms without developer badges", () => {
    const html = renderToStaticMarkup(
      <StrategyShieldCard
        recommendation={LIVE}
        horizonDays={30}
        reviewed={false}
        onReview={() => {}}
        onAdjust={() => {}}
      />,
    );
    expect(html).toContain("Protect your ETH for 30 days");
    expect(html).toContain("Budget limit");
    expect(html).toContain("Ends");
    expect(html).toContain("Review and continue");
    expect(html).toContain("$3.00");
    expect(html).toContain("$4,000");
    expect(html).not.toContain("OFFICIAL SDK");
    expect(html).not.toContain("SERVER-ONLY");
    expect(html).not.toContain("NO SIGNER");
    expect(html).not.toContain("thetanuts");
    expect(html).not.toContain("0x833589");
    expect(html).not.toContain("orderBinding");
    expect(html).not.toContain("Buy");
    expect(html).not.toContain("Execute");
  });

  it("renders honest no-match and unavailable copy", () => {
    const noMatch = renderToStaticMarkup(
      <StrategyShieldCard
        recommendation={{ kind: "no_match", fetchedAt: "2026-08-31T00:00:00.000Z", asset: "ETH" }}
        horizonDays={30}
        reviewed={false}
        onReview={() => {}}
        onAdjust={() => {}}
      />,
    );
    expect(noMatch).toContain("No matching ETH protection");
    expect(noMatch).toContain("Search complete");
    expect(noMatch).toContain("No offer fits");
    expect(noMatch).toContain("Asset");
    expect(noMatch).toContain("30 days");
    expect(noMatch).toContain("Change the window or budget");
    const unavailable = renderToStaticMarkup(
      <StrategyShieldCard
        recommendation={{
          kind: "unavailable",
          fetchedAt: "2026-08-31T00:00:00.000Z",
          reason: "Live market data is currently unavailable.",
        }}
        horizonDays={30}
        reviewed={false}
        onReview={() => {}}
        onAdjust={() => {}}
      />,
    );
    expect(unavailable).toContain("Protection terms unavailable");
    expect(unavailable).toContain("Search paused");
    expect(unavailable).toContain("Terms not ready");
    expect(unavailable).toContain("Goal");
    expect(unavailable).toContain("Kept");
    expect(unavailable).toContain("Purchase");
    expect(unavailable).toContain("None");
    expect(unavailable).toContain("Try again");
    expect(unavailable).not.toContain("Live market data is currently unavailable.");
  });
});

describe("StrategyDesk — shield live path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { premiumBudgetUsd?: number };
      expect(body.premiumBudgetUsd).toBe(3);
      return shieldResponse(LIVE);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("posts a premium budget and shows one live protective put", async () => {
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByTestId("shield-recommendation")).toBeInTheDocument(),
    );
    expect(screen.getByText("Protect your ETH for 30 days")).toBeInTheDocument();
    expect(screen.getByText("Budget limit")).toBeInTheDocument();
    expect(screen.getByText("Ends")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and continue" })).toBeInTheDocument();
    expect(screen.queryByText("Market context")).toBeNull();
    expect(screen.queryByText("Buy")).toBeNull();
  });

  it("reveals honest review copy without implying a purchase", async () => {
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review and continue" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review and continue" }));
    expect(screen.getByText("A floor for your ETH")).toBeInTheDocument();
    expect(screen.getByText(/family transfers remain separate/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is purchased until you approve it there/)).toBeInTheDocument();
  });
});

describe("StrategyDesk — shield no_match and unavailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows no-match copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        shieldResponse({ kind: "no_match", fetchedAt: "2026-08-31T00:00:00.000Z", asset: "ETH" }),
      ),
    );
    render(<StrategyDesk />);
    await fireEvent.submit(screen.getByLabelText("Strategy goal").closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("No matching ETH protection")).toBeInTheDocument(),
    );
  });

  it("shows unavailable copy without leaking reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        shieldResponse({
          kind: "unavailable",
          fetchedAt: "2026-08-31T00:00:00.000Z",
          reason: "Live market data is currently unavailable.",
        }),
      ),
    );
    render(<StrategyDesk />);
    await fireEvent.submit(screen.getByLabelText("Strategy goal").closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("Protection terms unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Live market data is currently unavailable.")).toBeNull();
  });
});

describe("StrategyDesk — earn premium stays educational", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("does not send a premium budget for earn_premium", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).not.toHaveProperty("premiumBudgetUsd");
      return {
        ok: true,
        json: async () => ({
          intent: {
            kind: "strategy",
            asset: "BTC",
            objective: "earn_premium",
            horizonDays: null,
            strategy: {
              name: "Covered call",
              action: "sell_call",
              thesis: "Income.",
              tradeoff: "Caps upside.",
            },
            educationOnly: true,
          },
          market: null,
          execution: "none",
          disclosure: "Educational.",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StrategyDesk />);
    fireEvent.click(
      screen.getByRole("button", { name: "Earn premium on BTC" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Reserve scenario in USDC" }),
    ).toBeInTheDocument();
    await fireEvent.submit(screen.getByLabelText("Strategy goal").closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
