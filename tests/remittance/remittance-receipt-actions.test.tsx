// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { buildExplorerUrl } from "@/lib/remittance/transfer";
import { RemittanceReceiptActions } from "@/components/remittance/remittance-receipt-actions";
import type { RemittanceSettlement } from "@/components/remittance/remittance-payment-action";

const ADDR = "0x" + "1234567890abcdef".repeat(4);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };

function quote(): QuoteEnvelope {
  const issuedAt = Date.now();
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.44 PHP" },
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
    issuedAt,
    expiresAt: issuedAt + 120_000,
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
  };
}

function settlement(q: QuoteEnvelope): RemittanceSettlement {
  return {
    digest: DIGEST,
    explorerUrl: buildExplorerUrl(DIGEST),
    usdcMicro: q.usdcMicro,
    recipientAddress: ADDR,
    quoteExpiresAt: q.expiresAt,
    beneficiaryRef: q.beneficiaryRef,
    payoutStatus: "Awaiting payout partner",
    purpose: null,
    maximumFamilyLimitMinor: null,
    confirmedAt: q.issuedAt + 1_000,
  };
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => cleanup());

describe("RemittanceReceiptActions — share/export intact", () => {
  it("renders share, export, and split actions", () => {
    const q = quote();
    render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />);
    expect(screen.getByTestId("remittance-share-receipt")).toBeInTheDocument();
    expect(screen.getByTestId("remittance-export-receipt")).toBeInTheDocument();
    expect(screen.getByTestId("remittance-split-toggle")).toBeInTheDocument();
  });

  it("share copies a /proof?r= receipt URL", async () => {
    const q = quote();
    render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />);
    fireEvent.click(screen.getByTestId("remittance-share-receipt"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(copied).toMatch(/^https?:\/\/[^/]+\/proof\?r=[A-Za-z0-9_-]+$/);
  });
});

describe("RemittanceReceiptActions — split panel", () => {
  it("is hidden until the split toggle is clicked", () => {
    const q = quote();
    render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />);
    expect(screen.queryByTestId("receipt-split-action")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("remittance-split-toggle"));
    expect(screen.getByTestId("receipt-split-action")).toBeInTheDocument();
  });

  it("collapses on a second toggle without mutating share/export", () => {
    const q = quote();
    render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />);
    const toggle = screen.getByTestId("remittance-split-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("receipt-split-action")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("receipt-split-action")).not.toBeInTheDocument();
    // Share still works after collapse.
    fireEvent.click(screen.getByTestId("remittance-share-receipt"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("passes the confirmed settlement USDC total and a receipt URL into the panel", () => {
    const q = quote();
    render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />);
    fireEvent.click(screen.getByTestId("remittance-split-toggle"));
    expect(screen.getByTestId("split-source-total")).toHaveTextContent("109 USDC");
  });
});

describe("RemittanceReceiptActions — SSR safety", () => {
  it("renders without throwing when window.location is unavailable", () => {
    const q = quote();
    // Simulate server render: `window` exists but `location` access throws,
    // mirroring the ReferenceError a Client Component hits under SSR. jsdom
    // hides this by always providing `window.location`, so override it here.
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      get() {
        throw new ReferenceError("window is not defined");
      },
    });
    try {
      expect(() =>
        render(<RemittanceReceiptActions quote={q} settlement={settlement(q)} />),
      ).not.toThrow();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    }
  });
});
