// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExecutableQuoteActions } from "@/components/remittance/executable-quote-actions";
import type { QuoteEnvelope } from "@/lib/remittance/quote";

// Capture the props MedicinePickupPanel receives so we can assert the stable
// quote issuance timestamp is threaded through as `nowMs` — never Date.now().
const medicineProps = vi.hoisted(() => ({
  last: null as
    | { nowMs?: number; beneficiaryRef?: string; disabled?: boolean }
    | null,
}));

vi.mock("@/components/remittance/medicine-pickup-panel", () => ({
  MedicinePickupPanel: (props: {
    disabled?: boolean;
    beneficiaryRef?: string;
    nowMs?: number;
    onCommitmentChange?: unknown;
  }) => {
    medicineProps.last = {
      disabled: props.disabled,
      beneficiaryRef: props.beneficiaryRef,
      nowMs: props.nowMs,
    };
    return (
      <div data-testid="medicine-pickup-panel">
        <span data-testid="medicine-nowMs">{props.nowMs ?? "undefined"}</span>
        <span data-testid="medicine-beneficiaryRef">
          {props.beneficiaryRef ?? "undefined"}
        </span>
      </div>
    );
  },
}));

vi.mock("@/components/remittance/family-review-action", () => ({
  FamilyReviewStatus: () => <div data-testid="family-review-status" />,
  useFamilyReviewSubmit: () => ({
    phase: { kind: "idle" },
    locked: false,
    busy: false,
    primaryLabel: "Hold for family review",
    holdApproveDisabled: true,
    submit: vi.fn(),
    approveFromReady: vi.fn(),
  }),
}));

const ISSUED_AT = 1_700_000_000_000;

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
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
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: "0x" + "1234567890abcdef".repeat(4),
    beneficiaryRef: "R-ABCD1234",
    attestation: { v: 1, hmac: "0x" + "ab".repeat(32) },
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
  medicineProps.last = null;
});
afterEach(() => {
  cleanup();
});

describe("ExecutableQuoteActions — medicine pickup anchor", () => {
  it("threads the quote's stable issuedAt to MedicinePickupPanel as nowMs, not Date.now", () => {
    render(
      <ExecutableQuoteActions
        quote={quote()}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        onDismiss={vi.fn()}
        handoffEligible={false}
        onCarry={vi.fn()}
        editable={false}
      />,
    );
    // Reveal the hold path, then choose Medicine pickup.
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    // The medicine panel is rendered with the quote's issuedAt as its anchor.
    expect(screen.getByTestId("medicine-pickup-panel")).toBeInTheDocument();
    expect(medicineProps.last?.nowMs).toBe(ISSUED_AT);
    expect(medicineProps.last?.beneficiaryRef).toBe("R-ABCD1234");
  });

  it("uses the issuedAt of the currently active quote, not a stale earlier one", () => {
    const laterIssuedAt = ISSUED_AT + 60_000;
    const { rerender } = render(
      <ExecutableQuoteActions
        quote={quote()}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        onDismiss={vi.fn()}
        handoffEligible={false}
        onCarry={vi.fn()}
        editable={false}
      />,
    );
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    expect(medicineProps.last?.nowMs).toBe(ISSUED_AT);
    // A fresh quote with a later issuedAt re-anchors the pickup window.
    rerender(
      <ExecutableQuoteActions
        quote={quote({ issuedAt: laterIssuedAt, expiresAt: laterIssuedAt + 120_000 })}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        onDismiss={vi.fn()}
        handoffEligible={false}
        onCarry={vi.fn()}
        editable={false}
      />,
    );
    expect(medicineProps.last?.nowMs).toBe(laterIssuedAt);
  });
});
