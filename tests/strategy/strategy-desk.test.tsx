// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrategyDesk } from "@/components/strategy/strategy-desk";
import type { RemittanceContext } from "@/lib/strategy/remittance-context";

const REMITTANCE_CTX: RemittanceContext = {
  source: "remittance",
  amountMyr: 500,
  recipient: "Ana",
  city: "Manila",
};

function ethProtectResponse() {
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
          tradeoff: "Protection costs premium and expires; this mapping does not select or submit a contract.",
        },
        educationOnly: true,
      },
      market: {
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
      },
      execution: "none",
      disclosure: "Educational read-only mapping. Not financial advice.",
    }),
  };
}

function btcProtectResponse() {
  return {
    ok: true,
    json: async () => ({
      intent: {
        kind: "strategy",
        asset: "BTC",
        objective: "protect_downside",
        horizonDays: 30,
        strategy: {
          name: "Protective put",
          action: "buy_put",
          thesis: "A put can define a downside floor for an asset you already hold.",
          tradeoff: "Protection costs premium and expires; this mapping does not select or submit a contract.",
        },
        educationOnly: true,
      },
      market: {
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
            strikeUsd: 110000,
            premium: 125,
            expiry: "2026-10-01T00:00:00.000Z",
            availableAmount: "2",
          },
        ],
      },
      execution: "none",
      disclosure: "Educational read-only mapping. Not financial advice.",
    }),
  };
}

function clarificationResponse() {
  return {
    ok: true,
    json: async () => ({
      intent: {
        kind: "clarification",
        missing: "asset",
        message: "Which asset should the educational mapping use: ETH or BTC?",
      },
      market: null,
      execution: "none",
      disclosure: "Educational read-only mapping. Not financial advice.",
    }),
  };
}

describe("StrategyDesk — static standalone workspace", () => {
  it("removes the forbidden homework-form strings", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).not.toContain("Awaiting preview");
    expect(html).not.toContain("Educational preview");
    // No question-mark placeholder glyph rendered as text content.
    expect(html).not.toContain(">?</span>");
    expect(html).not.toContain(">?</p>");
  });

  it("uses the 1180px max width and the lg two-column workspace grid", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("max-w-[1180px]");
    expect(html).toContain("lg:grid-cols-[0.86fr_1.14fr]");
    expect(html).toContain("grid-cols-1");
  });

  it("has exactly one notional control and no duplicate formatted notional", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    const notionalControls = html.match(/id="strategy-notional"/g) ?? [];
    expect(notionalControls.length).toBe(1);
    // The editable black tile holds the raw input value; no separate formatted
    // "RM2,400" display duplicates it.
    expect(html).not.toContain("RM2,400");
  });

  it("shows the default ETH / 30-day draft labels from parseStrategyGoal before any preview", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    // Default goal is "Protect ETH downside for 30 days" → ETH, protect_downside, 30d.
    expect(html).toContain("Protective put");
    expect(html).toContain("ETH");
    expect(html).toContain("30-day horizon");
    expect(html).toContain("Downside floor");
  });

  it("always states the two payoff truth disclaimers", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Conceptual payoff shape — not priced");
    expect(html).toContain("No strike, premium, quote, or trade is selected.");
  });

  it("uses the Map strategy CTA in standalone mode", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Map strategy");
    expect(html).not.toContain("Preview strategy");
  });

  it("shows compact preset chips visibly, not buried in a disclosure", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Protect ETH downside");
    expect(html).toContain("Earn premium on BTC");
    expect(html).toContain("Protect ETH and offset cost with premium");
    // Presets are not hidden inside a <details> element.
    expect(html).not.toContain("Edit goal presets");
    expect(html).not.toContain("<details");
  });

  it("does not surface SDK/version/server-only/no-signer badges", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).not.toContain("Server-only SDK");
    expect(html).not.toContain("No signer");
    expect(html).not.toContain("No trade submitted");
    expect(html).not.toContain("Official SDK");
    expect(html).not.toContain("Connect wallet");
  });
});

describe("StrategyDesk — notional accessible name and preset sizing", () => {
  it("gives the notional spinbutton an explicit accessible name 'Protected notional in MYR'", () => {
    render(<StrategyDesk />);
    expect(
      screen.getByRole("spinbutton", { name: "Protected notional in MYR" }),
    ).toBeInTheDocument();
    cleanup();
  });

  it("keeps the dynamic strategy hero label visible above the notional input", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    // Default ETH protect draft → "ETH downside" hero label remains visible.
    expect(html).toContain("ETH downside");
  });

  it("sizes preset buttons to min-h-11 on mobile and lg:min-h-9 on large screens", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("min-h-11");
    expect(html).toContain("lg:min-h-9");
  });
});

describe("StrategyDesk — mobile order and overflow", () => {
  it("renders the request builder before the chart in DOM order", () => {
    const { container } = render(<StrategyDesk />);
    const goal = screen.getByLabelText("Strategy goal");
    const svg = container.querySelector("svg");
    expect(goal).toBeTruthy();
    expect(svg).toBeTruthy();
    // The goal textarea (request builder) precedes the payoff SVG (chart).
    expect(goal.compareDocumentPosition(svg!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    cleanup();
  });

  it("prevents chart overflow via overflow/min-width classes", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("min-w-0");
  });
});

describe("StrategyDesk — remittance deep-link context", () => {
  it("uses the Map protection CTA and shows the transfer row + caveat", () => {
    const html = renderToStaticMarkup(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    expect(html).toContain("Map protection");
    expect(html).toContain("Related transfer");
    expect(html).toContain("Ana, Manila · RM500.00");
    expect(html).toContain("Review the terms before you act");
    expect(html).toContain("does not protect the MYR→PHP rate");
    expect(html).not.toContain("execute a trade");
  });

  it("standalone mode remains intact when no context is passed", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).toContain("Treasury protection");
    expect(html).toContain("Map strategy");
    expect(html).not.toContain("Map protection");
    expect(html).not.toContain("Related transfer");
  });

  it("interpolates the context recipient into the caveat, never a hardcoded name", () => {
    const ctx: RemittanceContext = {
      source: "remittance",
      amountMyr: 750,
      recipient: "Lila",
      city: "Cebu",
    };
    const html = renderToStaticMarkup(<StrategyDesk remittanceContext={ctx} />);
    expect(html).toContain("Lila");
    expect(html).not.toContain("Ana");
  });
});

describe("StrategyDesk — invalid draft (no submit)", () => {
  it("shows Refine your goal and no payoff path when the draft has no asset", async () => {
    const { container } = render(<StrategyDesk />);
    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "just looking around" },
    });
    expect(screen.getByText("Refine your goal")).toBeInTheDocument();
    // No payoff SVG path is rendered for an invalid draft.
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Conceptual payoff shape — not priced")).toBeNull();
    cleanup();
  });
});

describe("StrategyDesk — pending state", () => {
  beforeEach(() => {
    let resolveEth: (value: Response) => void = () => {};
    const ethPromise = new Promise<Response>((resolve) => {
      resolveEth = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => ethPromise));
    // Expose the resolver so the test can settle the deferred fetch.
    (vi.mocked(fetch) as unknown as { __resolve: typeof resolveEth }).__resolve = resolveEth;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("keeps the draft payoff shape and shows Checking market context while pending", async () => {
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    // The CTA reflects the in-flight mapping.
    expect(screen.getByText("Mapping…")).toBeInTheDocument();
    // The payoff workspace shows the pending status.
    expect(screen.getByText("Checking market context")).toBeInTheDocument();
    // The default ETH/30-day draft shape is still shown (not cleared).
    expect(screen.getByText("Downside floor")).toBeInTheDocument();
    expect(screen.getByText("Protective put")).toBeInTheDocument();
  });
});

describe("StrategyDesk — resolved strategy", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ethProtectResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders thesis/tradeoff and live spot/order cards in a separate Market context block", async () => {
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    // Market context block appears with the resolved thesis and tradeoff.
    await waitFor(() =>
      expect(screen.getByText("Market context")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("A put can define a downside floor for an asset you already hold."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Protection costs premium and expires; this mapping does not select or submit a contract.",
      ),
    ).toBeInTheDocument();
    // Live spot + order cards.
    expect(screen.getByText(/\$4,123/)).toBeInTheDocument();
    expect(screen.getByText("12 live orders")).toBeInTheDocument();
  });
});

describe("StrategyDesk — resolved clarification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => clarificationResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows Refine your goal and no payoff path when the mapper clarifies", async () => {
    const { container } = render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByText("Refine your goal")).toBeInTheDocument(),
    );
    // No payoff SVG path is rendered for a clarification result.
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("StrategyDesk — error truth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("surfaces the honest unavailable error and keeps the draft shape", async () => {
    const { container } = render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(
        screen.getByText(
          "Live market context is unavailable. Your goal remains a conceptual shape and has not been priced.",
        ),
      ).toBeInTheDocument(),
    );
    // The draft payoff shape remains (the default ETH draft is valid).
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Downside floor")).toBeInTheDocument();
  });

  it("clears a successful market snapshot before a same-goal retry can fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ethProtectResponse())
        .mockRejectedValueOnce(new Error("network down")),
    );
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;

    await fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByText("Live · Base mainnet")).toBeInTheDocument(),
    );

    await fireEvent.submit(form);
    expect(screen.queryByText("Live · Base mainnet")).toBeNull();
    expect(screen.queryByText("12 live orders")).toBeNull();

    await waitFor(() =>
      expect(
        screen.getByText(
          "Live market context is unavailable. Your goal remains a conceptual shape and has not been priced.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Market context")).toBeNull();
    expect(screen.queryByText("Live · Base mainnet")).toBeNull();
  });
});

describe("StrategyDesk — stale-response race (generation guard)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ethProtectResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("clears the stale ETH result when a preset is chosen without resubmitting", async () => {
    render(<StrategyDesk remittanceContext={REMITTANCE_CTX} />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    // ETH result resolves.
    await waitFor(() =>
      expect(screen.getByText("ETH downside")).toBeInTheDocument(),
    );
    // Family Watch suggests a protective put from the carried ETH evidence.
    expect(
      within(screen.getByTestId("family-watch")).getByText("Protective put"),
    ).toBeInTheDocument();

    // Choose the BTC preset — invalidates the ETH result without resubmitting.
    fireEvent.click(screen.getByText("Earn premium on BTC"));

    // The stale ETH hero label is gone; the BTC draft shape takes over.
    expect(screen.queryByText("ETH downside")).toBeNull();
    // Family Watch no longer carries the stale ETH protective-put suggestion.
    expect(
      within(screen.getByTestId("family-watch")).queryByText("Protective put"),
    ).toBeNull();
    // The BTC draft label is now present (Covered call for earn_premium).
    expect(screen.getByText("Covered call")).toBeInTheDocument();
    // Family Watch still shows the declared obligation.
    expect(screen.getByText("Ana, Manila")).toBeInTheDocument();
  });

  it("clears the stale ETH result when the draft is edited", async () => {
    render(<StrategyDesk remittanceContext={REMITTANCE_CTX} />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByText("ETH downside")).toBeInTheDocument(),
    );

    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "Earn premium on BTC" },
    });

    expect(screen.queryByText("ETH downside")).toBeNull();
    expect(screen.getByText("Covered call")).toBeInTheDocument();
  });

  it("ignores a late response for an abandoned draft (in-flight race)", async () => {
    let resolveEth: (value: Response) => void = () => {};
    const ethPromise = new Promise<Response>((resolve) => {
      resolveEth = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => ethPromise));

    render(<StrategyDesk remittanceContext={REMITTANCE_CTX} />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    expect(screen.getByText("Mapping…")).toBeInTheDocument();

    // While the ETH fetch is pending, edit the draft to BTC without resubmitting.
    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "Earn premium on BTC" },
    });

    // Loading ends when the draft abandons the pending request.
    expect(screen.queryByText("Mapping…")).toBeNull();
    // The BTC draft shape is present, not a stale ETH preview.
    expect(screen.getByText("Covered call")).toBeInTheDocument();

    // Now resolve the late ETH response. It must not overwrite the BTC draft.
    resolveEth(ethProtectResponse() as unknown as Response);
    await waitFor(() =>
      expect(screen.getByText("Covered call")).toBeInTheDocument(),
    );
    expect(screen.queryByText("ETH downside")).toBeNull();
    expect(
      within(screen.getByTestId("family-watch")).queryByText("Protective put"),
    ).toBeNull();
    // The draft remains the BTC draft, not the stale ETH goal.
    expect(screen.getByLabelText("Strategy goal")).toHaveValue("Earn premium on BTC");
    expect(screen.queryByText("Mapping…")).toBeNull();
  });
});

describe("StrategyDesk — BTC result is asset-neutral across the whole page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => btcProtectResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the BTC result with no ETH-only framing and no ETH protection from Family Watch", async () => {
    const { container } = render(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "Protect BTC downside for 30 days" },
    });
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByText("BTC downside")).toBeInTheDocument(),
    );
    expect(screen.getByText("$112,000")).toBeInTheDocument();

    const page = container.textContent ?? "";
    expect(page).not.toContain("If these funds are held in ETH");
    expect(page).not.toContain("Preview ETH hedge");
    expect(page).not.toContain("ETH hedge");
    expect(page).not.toContain("ETH position");

    const familyWatch = screen.getByTestId("family-watch");
    expect(within(familyWatch).queryByText("Protective put")).toBeNull();
    expect(within(familyWatch).queryByText("Suggested protection")).toBeNull();
  });
});

describe("StrategyDesk — Family Watch surface", () => {
  it("does not render the Family Watch card in standalone mode", () => {
    const html = renderToStaticMarkup(<StrategyDesk />);
    expect(html).not.toContain("Family Watch");
    expect(html).not.toContain("No family obligation is declared");
  });

  it("renders the declared obligation inside Family Watch in context mode", () => {
    const html = renderToStaticMarkup(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    expect(html).toContain("Family Watch");
    expect(html).toContain("Declared obligation");
    expect(html).toContain("Ana, Manila");
    expect(html).toContain("RM500");
  });

  it("labels absent market evidence as a confidence state in context mode before any preview", () => {
    const html = renderToStaticMarkup(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    expect(html).toContain("No evidence");
    expect(html).not.toContain("Thetanuts Finance SDK");
  });

  it("does not suggest an ETH hedge inside Family Watch before any preview resolves", () => {
    // The payoff workspace legitimately shows the draft "Protective put" label
    // for the default ETH goal; Family Watch must not echo it as a suggestion.
    const { container } = render(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    const familyWatch = screen.getByTestId("family-watch");
    expect(within(familyWatch).queryByText("Protective put")).toBeNull();
    expect(within(familyWatch).queryByText("Suggested protection")).toBeNull();
    // No protect_downside objective string leaks from Family Watch.
    expect(within(familyWatch).queryByText("protect_downside")).toBeNull();
    cleanup();
    void container;
  });

  it("does not leak SDK, demo, or execution badges from Family Watch", () => {
    const html = renderToStaticMarkup(
      <StrategyDesk remittanceContext={REMITTANCE_CTX} />,
    );
    expect(html).not.toContain("DEMO");
    expect(html).not.toContain("mock");
    expect(html).not.toContain("simulation");
    expect(html.toLowerCase()).not.toContain("submitted");
    expect(html.toLowerCase()).not.toContain("submit a trade");
  });
});

describe("StrategyDesk — bounded external work (AbortController)", () => {
  // A fetch mock that captures the AbortSignal and rejects with an AbortError
  // when the signal aborts, mirroring real browser fetch semantics. This lets
  // the tests observe abort without resolving the deferred response.
  function abortableFetch() {
    const signals: AbortSignal[] = [];
    const fn = vi.fn((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    return { fn, signals };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("passes an AbortSignal to fetch on submit", async () => {
    const { fn, signals } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("aborts the in-flight fetch when the draft is edited", async () => {
    const { fn, signals } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    expect(screen.getByText("Mapping…")).toBeInTheDocument();
    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "Earn premium on BTC" },
    });
    // The first request's signal is aborted; loading ends.
    expect(signals[0]!.aborted).toBe(true);
    expect(screen.queryByText("Mapping…")).toBeNull();
  });

  it("aborts the in-flight fetch when a preset is chosen", async () => {
    const { fn, signals } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    fireEvent.click(screen.getByText("Earn premium on BTC"));
    expect(signals[0]!.aborted).toBe(true);
    expect(screen.queryByText("Mapping…")).toBeNull();
  });

  it("aborts the previous in-flight fetch on a new submit", async () => {
    const { fn, signals } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    await fireEvent.submit(form);
    // Two fetches, the first signal is aborted by the second submit.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(signals.length).toBe(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("aborts the in-flight fetch on unmount", async () => {
    const { fn, signals } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    const { unmount } = render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    unmount();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("stays silent on AbortError — no error copy, no unhandled rejection", async () => {
    const { fn } = abortableFetch();
    vi.stubGlobal("fetch", fn);
    const { container } = render(<StrategyDesk />);
    const form = screen.getByLabelText("Strategy goal").closest("form")!;
    await fireEvent.submit(form);
    // Edit to abort the in-flight request; the AbortError must not surface.
    await fireEvent.change(screen.getByLabelText("Strategy goal"), {
      target: { value: "Earn premium on BTC" },
    });
    // Flush the abort rejection so an unhandled rejection would surface here.
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(
      screen.queryByText(/Live market context is unavailable/),
    ).toBeNull();
  });
});
