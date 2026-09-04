// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  RemittanceQuotePreview,
  type QuotePreviewStatus,
  type QuoteBlocker,
} from "@/components/remittance/remittance-quote-preview";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";

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

// The preview imports the wallet connect button (dapp-kit/enoki network) and the
// transfer module (@mysten/sui). Mock both so this focused guardian-gating test
// never boots the wallet stack; only the guardian render boundary is exercised.
vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">
      Connect wallet
    </button>
  ),
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => ({ address: "0x" + "22".repeat(32) }),
  useCurrentNetwork: () => "testnet",
  useDAppKit: () => ({ signAndExecuteTransaction: vi.fn() }),
  useCurrentClient: () => ({
    core: { waitForTransaction: vi.fn() },
  }),
}));

vi.mock("@/lib/remittance/transfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remittance/transfer")>();
  return { ...actual, hasValidAttestation: actual.hasValidAttestation };
});

const noop = () => {};

function renderPreview(
  status: QuotePreviewStatus,
  blocker: QuoteBlocker = "none",
  quote: QuoteEnvelope = baseQuote(),
) {
  return render(
    <RemittanceQuotePreview
      quote={quote}
      status={status}
      blocker={blocker}
      onConfirm={noop}
      onCancel={noop}
      onReopen={noop}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("RemittanceQuotePreview — guardian render boundary", () => {
  it("renders the guardian card in the actionable pre-submission (pending) state", () => {
    renderPreview("pending");
    expect(screen.getByTestId("family-guardian-card")).toBeInTheDocument();
  });

  it("never renders the guardian card once the transfer is submitted", () => {
    renderPreview("submitted");
    expect(screen.queryByTestId("family-guardian-card")).toBeNull();
    expect(screen.queryByTestId("family-guardian-headline")).toBeNull();
  });

  it("never renders the guardian card when the transfer outcome is unknown", () => {
    renderPreview("unknown");
    expect(screen.queryByTestId("family-guardian-card")).toBeNull();
  });

  it("never renders the guardian card once the transfer is confirmed", () => {
    renderPreview("confirmed");
    expect(screen.queryByTestId("family-guardian-card")).toBeNull();
  });

  it("never renders the guardian card when the quote is cancelled", () => {
    renderPreview("cancelled");
    expect(screen.queryByTestId("family-guardian-card")).toBeNull();
  });

  it("a submitted card never claims a verified or approval-ready state", () => {
    renderPreview("submitted");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /ready for your approval|ready for approval|safe-to-sign|safe to sign|verified|authorized|authorised/i,
    );
  });

  it("recomposes into two desktop groups with the guardian in the right group", () => {
    const { container } = renderPreview("pending");
    const preview = container.querySelector(
      '[data-testid="remittance-quote-preview"]',
    ) as HTMLElement;
    expect(preview).not.toBeNull();
    const grid = preview.querySelector('[data-testid="quote-workspace-grid"]');
    expect(grid?.className).toContain(
      "lg:grid-cols-[minmax(0,56fr)_minmax(0,44fr)]",
    );
    const left = preview.querySelector('[data-testid="quote-left-group"]');
    const right = preview.querySelector('[data-testid="quote-right-group"]');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    // The guardian lives in the right group, never the left.
    expect(left?.querySelector('[data-testid="family-guardian-card"]')).toBeNull();
    expect(right?.querySelector('[data-testid="family-guardian-card"]')).not.toBeNull();
  });
});
