// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  RemittanceQuotePreview,
  type QuoteBlocker,
} from "@/components/remittance/remittance-quote-preview";
import { decodeHandoff, encodeHandoff, wrapQuote } from "@/lib/remittance/offline-handoff";

// Mock the wallet connect button so the blocked branch doesn't boot dapp-kit.
vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">
      Connect wallet
    </button>
  ),
}));

// Mock next/link so it renders a plain anchor without router context.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} data-testid="link" {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

const ADDR = "0x" + "ab".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };

function baseQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.444444 PHP" },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: "109000000",
    usdcAmount: "109",
    settlementRail: "Sui testnet USDC",
    payoutMethod: "Bank payout · Not available yet",
    estimatedArrival: "Within minutes after on-chain confirmation",
    payoutStatus: "Awaiting payout partner",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR,
    beneficiaryRef: "R-ABCD1234",
    attestation: VALID_ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    },
    clarification: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

function renderPreview(
  quote: QuoteEnvelope,
  blocker: QuoteBlocker = "none",
) {
  return render(
    <RemittanceQuotePreview
      quote={quote}
      status="pending"
      blocker={blocker}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onReopen={vi.fn()}
      onSubmitQuote={vi.fn()}
    />,
  );
}

describe("RemittanceQuotePreview — carry and no treasury cross-sell", () => {
  it("an eligible quote exposes cross-device carry and no treasury cross-sell", () => {
    renderPreview(baseQuote(), "none");
    expect(screen.getByTestId("carry-to-device")).toBeInTheDocument();
    // Treasury cross-sell is intentionally absent from the remittance quote so
    // the wallet/continue action stays the single dominant next step.
    expect(screen.queryByTestId("preview-eth-hedge")).not.toBeInTheDocument();
  });

  it("the carry secondary action is at least 44px high but visually subordinate", () => {
    renderPreview(baseQuote(), "none");
    const carry = screen.getByTestId("carry-to-device");
    // 44px minimum touch target.
    expect(carry.className).toMatch(/min-h-11|min-h-\[44px\]|h-11/);
    // Visually subordinate: never the solid primary button treatment.
    expect(carry.className).not.toMatch(/cv-btn-solid/);
  });

  it("the dismiss secondary action is at least 44px high but visually subordinate", () => {
    renderPreview(baseQuote(), "none");
    const dismiss = screen.getByRole("button", { name: /^Dismiss$/i });
    // 44px minimum touch target.
    expect(dismiss.className).toMatch(/min-h-11|min-h-\[44px\]|h-11/);
    // Visually subordinate: quiet text button, never the solid primary.
    expect(dismiss.className).not.toMatch(/cv-btn-solid/);
  });

  it("opening Carry renders a full-viewport handoff step with QR, actions, and honest copy", () => {
    renderPreview(baseQuote(), "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    const surface = screen.getByTestId("carry-to-device-surface");
    expect(surface).toBeInTheDocument();
    // Dedicated step header — eyebrow + H1 naming the recipient.
    expect(screen.getByTestId("carry-step-eyebrow")).toHaveTextContent(
      "Cross-device handoff",
    );
    expect(screen.getByTestId("carry-step-title")).toHaveTextContent(
      "Carry this Ana quote",
    );
    // Compact identity / amount row — not the whole quote card.
    expect(screen.getByTestId("carry-step-identity")).toHaveTextContent(
      "Ana · Manila",
    );
    expect(screen.getByTestId("carry-step-amount")).toHaveTextContent(
      "RM500.00",
    );
    // Honest copy: no funds move, verify before wallet approval, expiry line.
    expect(screen.getByTestId("carry-to-device-copy").textContent).toContain(
      "No funds move here. Open this quote on a connected device and verify it before wallet approval.",
    );
    expect(screen.getByTestId("carry-step-expiry").textContent).toContain(
      "Quote expires in",
    );
    // QR, copy, and download affordances are present.
    expect(surface.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download code/i })).toBeInTheDocument();
    // One quiet Close control.
    expect(screen.getByTestId("carry-close")).toBeInTheDocument();
  });

  it("opening Carry replaces the quote review surface — no underlying controls visible or accessible", () => {
    renderPreview(baseQuote(), "none");
    // Underlying controls are present before Carry opens.
    expect(screen.getByTestId("review-transfer")).toBeInTheDocument();
    expect(screen.getByTestId("edit-transfer")).toBeInTheDocument();
    expect(screen.getByTestId("carry-to-device")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("carry-to-device"));
    // The quote review surface is replaced by the dedicated handoff step.
    expect(screen.queryByTestId("remittance-quote-preview")).not.toBeInTheDocument();
    // No underlying review/action controls remain in the accessible tree.
    expect(screen.queryByTestId("review-transfer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-transfer")).not.toBeInTheDocument();
    // No second Carry link, no Dismiss.
    expect(screen.queryAllByTestId("carry-to-device")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Dismiss$/i })).not.toBeInTheDocument();
  });

  it("a wallet-blocked eligible quote hides the Sign-in control while Carry is open", () => {
    renderPreview(baseQuote(), "wallet");
    expect(screen.getByTestId("wallet-connect")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("carry-to-device"));
    // The wallet connect (Sign in) control is gone from the accessible tree.
    expect(screen.queryByTestId("wallet-connect")).not.toBeInTheDocument();
    expect(screen.getByTestId("carry-to-device-surface")).toBeInTheDocument();
  });

  it("closing Carry restores the exact quote review state", () => {
    renderPreview(baseQuote(), "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    expect(screen.getByTestId("carry-to-device-surface")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("carry-close"));
    // The quote review surface returns with all its controls.
    expect(screen.queryByTestId("carry-to-device-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("remittance-quote-preview")).toBeInTheDocument();
    expect(screen.getByTestId("review-transfer")).toBeInTheDocument();
    expect(screen.getByTestId("edit-transfer")).toBeInTheDocument();
    expect(screen.getByTestId("carry-to-device")).toBeInTheDocument();
  });

  it("locks body scrolling while Carry is open and restores it on close", () => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = originalOverflow;
    const { unmount } = renderPreview(baseQuote(), "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByTestId("carry-close"));
    expect(document.body.style.overflow).toBe(originalOverflow);
    // Unmounting an open Carry also restores scroll.
    fireEvent.click(screen.getByTestId("carry-to-device"));
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });

  it("the Carry overlay is portaled to document.body so fixed positioning escapes ancestor transforms", () => {
    renderPreview(baseQuote(), "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    const surface = screen.getByTestId("carry-to-device-surface");
    // Portaled to document.body — fixed positioning is relative to the
    // viewport, not any ancestor transform/overflow context.
    expect(surface.parentNode).toBe(document.body);
  });

  it("unmounting an open Carry removes the portaled surface from the DOM and restores body scroll", () => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = originalOverflow;
    const { unmount } = renderPreview(baseQuote(), "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    expect(screen.getByTestId("carry-to-device-surface")).toBeInTheDocument();
    unmount();
    // The portaled surface is removed from document.body on unmount.
    expect(screen.queryByTestId("carry-to-device-surface")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });

  it("the carried payload round-trips through the strict handoff wrapper", () => {
    const quote = baseQuote();
    renderPreview(quote, "none");
    fireEvent.click(screen.getByTestId("carry-to-device"));
    // The QR encodes a valid handoff that decodes back to the same quote.
    const json = encodeHandoff(wrapQuote(quote));
    const decoded = decodeHandoff(json);
    expect(decoded.quote).toEqual(quote);
  });

  it("an unattested quote cannot generate a handoff (no carry link)", () => {
    renderPreview(baseQuote({ attestation: null }), "unapproved");
    expect(screen.queryByTestId("carry-to-device")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-eth-hedge")).not.toBeInTheDocument();
  });

  it("an unmapped quote (no recipient address) cannot generate a handoff", () => {
    renderPreview(baseQuote({ recipientAddress: null }), "unmapped");
    expect(screen.queryByTestId("carry-to-device")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-eth-hedge")).not.toBeInTheDocument();
  });

  it("a wallet-blocked eligible quote still exposes carry", () => {
    // Eligible (mapped + attested) but blocked only by wallet absence.
    renderPreview(baseQuote(), "wallet");
    expect(screen.getByTestId("carry-to-device")).toBeInTheDocument();
  });
});
