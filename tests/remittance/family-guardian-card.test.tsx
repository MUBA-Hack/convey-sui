// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  FamilyGuardianCard,
  type FamilyGuardianCardProps,
} from "@/components/remittance/family-guardian-card";

const ADDR = "0x" + "ab".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };
const NOW = 1_700_000_000_000;

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
    issuedAt: NOW,
    expiresAt: NOW + 120_000,
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

function renderCard(props: Partial<FamilyGuardianCardProps> & { quote?: QuoteEnvelope } = {}) {
  const full: FamilyGuardianCardProps = {
    quote: props.quote ?? baseQuote(),
    blocker: props.blocker ?? "none",
    now: props.now ?? NOW,
  };
  return render(<FamilyGuardianCard {...full} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("FamilyGuardianCard — overall state", () => {
  it("renders the ready headline when all checks pass", () => {
    renderCard();
    expect(screen.getByTestId("family-guardian-headline")).toHaveTextContent(
      "Ready to review.",
    );
  });

  it("renders the blocked headline when a check fails", () => {
    renderCard({ quote: baseQuote({ recipientAddress: null }), blocker: "unmapped" });
    expect(screen.getByTestId("family-guardian-headline")).toHaveTextContent(
      "Review before continuing.",
    );
  });
});

describe("FamilyGuardianCard — collapsible evidence", () => {
  it("hides the evidence checks until expanded", () => {
    renderCard();
    expect(screen.queryByTestId("family-guardian-check-recipient")).toBeNull();
  });

  it("reveals all six checks when the trigger is clicked", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-recipient")).toBeInTheDocument();
    expect(screen.getByTestId("family-guardian-check-asset-network")).toBeInTheDocument();
    expect(screen.getByTestId("family-guardian-check-freshness")).toBeInTheDocument();
    expect(screen.getByTestId("family-guardian-check-family-rule")).toBeInTheDocument();
    expect(screen.getByTestId("family-guardian-check-purpose")).toBeInTheDocument();
    expect(screen.getByTestId("family-guardian-check-approval")).toBeInTheDocument();
  });

  it("collapses the evidence when clicked again", () => {
    renderCard();
    const trigger = screen.getByTestId("family-guardian-evidence-trigger");
    fireEvent.click(trigger);
    expect(screen.getByTestId("family-guardian-check-recipient")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("family-guardian-check-recipient")).toBeNull();
  });
});

describe("FamilyGuardianCard — check status rendering", () => {
  it("renders a product display label, not a raw enum, for a pinned recipient", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-recipient-status")).toHaveTextContent(
      "Checked",
    );
  });

  it("renders a product display label, not a raw enum, for wallet approval when ready", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-approval-status")).toHaveTextContent(
      "Action needed",
    );
  });

  it("renders a product display label, not a raw enum, for an expired quote", () => {
    renderCard({ quote: baseQuote({ expiresAt: NOW - 1 }), now: NOW });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-freshness-status")).toHaveTextContent(
      "Needs attention",
    );
  });

  it("renders a Not stated label for an absent family purpose — never pass", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-purpose-status")).toHaveTextContent(
      "Not stated",
    );
  });

  it("renders a Not stated label for an absent family limit — never Checked", () => {
    // A null maximumFamilyLimitMinor means no per-transfer rule was stated.
    // The card must render "Not stated", not "Checked", so the customer never
    // sees a false success implying the limit was reviewed and cleared.
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-family-rule-status")).toHaveTextContent(
      "Not stated",
    );
  });

  it("renders a Checked label for a stated within-limit family rule", () => {
    renderCard({
      quote: baseQuote({
        youPayMinor: "40000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: null,
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-family-rule-status")).toHaveTextContent(
      "Checked",
    );
  });

  it("renders a Needs attention label for an over-cap family rule", () => {
    renderCard({
      quote: baseQuote({
        youPayMinor: "60000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: null,
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-family-rule-status")).toHaveTextContent(
      "Needs attention",
    );
  });

  it("renders a Checked label for a stated family purpose", () => {
    renderCard({
      quote: baseQuote({
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: null,
          ruleStatus: "not_set",
        },
      }),
    });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-purpose-status")).toHaveTextContent(
      "Checked",
    );
  });

  it("never exposes a raw enum label (pass/fail/required/not-stated) in the card", () => {
    renderCard({ quote: baseQuote({ expiresAt: NOW - 1 }), now: NOW });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    const card = screen.getByTestId("family-guardian-card");
    expect(card.textContent).not.toMatch(/\b(pass|fail|required|not-stated)\b/i);
  });
});

describe("FamilyGuardianCard — product language", () => {
  it("never leaks SDK, debug, or demo jargon in the rendered card", () => {
    renderCard({ blocker: "wallet" });
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    const card = screen.getByTestId("family-guardian-card");
    expect(card.textContent).not.toMatch(/mock|simulation|sdk|v1|v2|debug|hmac|nonce/i);
  });

  it("never claims on-chain settlement before approval", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    const card = screen.getByTestId("family-guardian-card");
    expect(card.textContent).not.toMatch(
      /verified on-chain|settled|settlement complete|confirmed on chain/i,
    );
  });

  it("uses strictly pre-verification language — never safe-to-sign, verified, authorized, or ready-for-approval", () => {
    // A forged 64-hex HMAC passes the upstream shape check, so blocker can
    // resolve to `none` and the card reaches the `ready` state without any
    // server verification. The rendered copy must therefore stay pre-verification.
    renderCard();
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    const card = screen.getByTestId("family-guardian-card");
    expect(card.textContent).not.toMatch(
      /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
    );
    // The trigger label is "Transfer checks", not "Safe-to-sign checks".
    expect(screen.getByTestId("family-guardian-evidence-trigger")).toHaveTextContent(
      "Transfer checks",
    );
  });
});
