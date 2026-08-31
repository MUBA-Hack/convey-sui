// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MotionConfig } from "motion/react";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { RemittanceQuoteActions } from "@/components/remittance/remittance-quote-actions";
import type { QuoteBlocker } from "@/lib/remittance/transfer";
import { PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS } from "@/lib/remittance/protected-transfer";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";

const ADDR = "0x" + "1234567890abcdef".repeat(4);
const ACCOUNT = "0x" + "22".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const NOW = 1_700_000_000_000;
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };
const CUSTODY_DIGEST = "0x" + "ab".repeat(32);

const { wallet } = vi.hoisted(() => ({
  wallet: {
    account: { address: "0x" + "22".repeat(32) } as { address: string } | null,
    network: "testnet" as string,
    signAndExecuteTransaction: vi.fn(),
  },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  useCurrentClient: () => ({ core: { waitForTransaction: vi.fn() } }),
}));

vi.mock("@/components/wallet/connect-button", () => ({
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">Connect wallet</button>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/remittance/protected-transfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remittance/protected-transfer")>();
  return {
    ...actual,
    buildProtectedTransfer: vi.fn((input: Parameters<typeof actual.buildProtectedTransfer>[0]) => {
      actual.parseProtectedTransferExecutionPlan(input.plan, input.nowMs);
      return {
        transaction: { __protected: true },
        metadata: {
          schemaVersion: "1",
          packageId: PACKAGE,
          module: "protected_transfer",
          function: "create_escrow",
          clockId: "0x6",
          coinType: USDC_COIN_TYPE_TESTNET,
          sender: ACCOUNT,
          beneficiary: ADDR,
          reviewer: REVIEWER,
          amountMicro: "109000000",
          deadlineMs: input.plan.deadlineMs,
          reviewNote: input.plan.reviewNote,
          commitmentHex: "0x" + "aa".repeat(32),
          commitmentBytes: Array(32).fill(0xaa),
          ...(input.plan.custodyManifestDigest === undefined
            ? {}
            : { custodyManifestDigest: input.plan.custodyManifestDigest }),
        },
      };
    }),
  };
});

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

function planResponse(custodyDigest?: string) {
  return {
    kind: "protected_transfer_execution_plan" as const,
    authorization: {
      kind: "authorization" as const,
      recipientAddress: ADDR,
      usdcMicro: "109000000",
      coinType: USDC_COIN_TYPE_TESTNET,
      beneficiaryRef: "R-ABCD1234",
      issuedAt: NOW,
      expiresAt: NOW + 120_000,
      corridor: { source: "MYR" as const, destination: "PHP" as const },
      youPayMinor: "50000",
      familyReceivesMinor: "610400",
      totalFeeMinor: "950",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
      recipient: "Ana",
      destinationCity: "manila",
      purpose: null,
      maximumFamilyLimitMinor: null,
    },
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    reviewerName: "Convey Review",
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS.tomorrow,
    reviewNote: "Hold until Ana confirms",
    ...(custodyDigest === undefined ? {} : { custodyManifestDigest: custodyDigest }),
  };
}

function renderActions(blocker: QuoteBlocker = "none") {
  return render(
    <RemittanceQuoteActions
      quote={quote()}
      expired={false}
      blocker={blocker}
      onConfirm={vi.fn()}
      onEdit={vi.fn()}
      onDismiss={vi.fn()}
      onRefresh={vi.fn()}
      handoffEligible={blocker === "none"}
      onCarry={vi.fn()}
      editable
    />,
  );
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  wallet.account = { address: ACCOUNT };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useFamilyReviewSubmit — custody manifest digest forwarding", () => {
  it("forwards custodyManifestDigest into the plan request when present", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(planResponse(CUSTODY_DIGEST)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderActions();
    // Choose Medicine pickup purpose which requires a custody digest.
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    // Provide a valid medicine commitment via the panel.
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "MARITES01" },
    });
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.custodyManifestDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("omits custodyManifestDigest for the default family-support purpose", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(planResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    // Default purpose is family_support; no medicine panel.
    expect(screen.queryByTestId("medicine-pharmacy-select")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("custodyManifestDigest");
  });

  it("keeps hold-prepare disabled until a valid medicine commitment exists", async () => {
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    // No pharmacy chosen, no refs -> hold-prepare disabled.
    expect(screen.getByTestId("hold-prepare")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FamilyReviewSelection — restrained purpose/medicine reveal motion
// ---------------------------------------------------------------------------

describe("FamilyReviewSelection — restrained reveal motion", () => {
  it("reveals the hold details through an opacity+y motion wrapper", () => {
    renderActions();
    expect(screen.queryByTestId("hold-reveal-motion")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    const wrapper = screen.getByTestId("hold-reveal-motion");
    expect(wrapper).toBeInTheDocument();
    // Only opacity + transform are animated; no layout/width/height inline
    // animation is declared on the wrapper.
    const style = (wrapper as HTMLElement).getAttribute("style") ?? "";
    expect(style).not.toMatch(/width|height|layout/i);
  });

  it("reveals the medicine panel through its own opacity+y motion wrapper", async () => {
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    expect(screen.queryByTestId("medicine-reveal-motion")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    expect(await screen.findByTestId("medicine-reveal-motion")).toBeInTheDocument();
  });

  it("zeroes the y offset when reduced motion is forced on", async () => {
    render(
      <MotionConfig reducedMotion="always">
        <RemittanceQuoteActions
          quote={quote()}
          expired={false}
          blocker="none"
          onConfirm={vi.fn()}
          onEdit={vi.fn()}
          onDismiss={vi.fn()}
          onRefresh={vi.fn()}
          handoffEligible
          onCarry={vi.fn()}
          editable
        />
      </MotionConfig>,
    );
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    const wrapper = await screen.findByTestId("medicine-reveal-motion");
    const style = (wrapper as HTMLElement).getAttribute("style") ?? "";
    // Reduced motion must not apply a non-zero translateY; transform is none
    // or translateY(0px).
    expect(style).not.toMatch(/translateY\(-?[1-9]/);
  });

  it("applies a non-zero y offset when reduced motion is forced off", async () => {
    render(
      <MotionConfig reducedMotion="never">
        <RemittanceQuoteActions
          quote={quote()}
          expired={false}
          blocker="none"
          onConfirm={vi.fn()}
          onEdit={vi.fn()}
          onDismiss={vi.fn()}
          onRefresh={vi.fn()}
          handoffEligible
          onCarry={vi.fn()}
          editable
        />
      </MotionConfig>,
    );
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("purpose-medicine_pickup"));
    const wrapper = await screen.findByTestId("medicine-reveal-motion");
    const style = (wrapper as HTMLElement).getAttribute("style") ?? "";
    // Default (no reduced motion) enters from a non-zero y offset.
    expect(style).toMatch(/translateY\(/);
  });
});
