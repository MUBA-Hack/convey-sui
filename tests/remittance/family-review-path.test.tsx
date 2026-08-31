// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import { RemittanceQuoteActions } from "@/components/remittance/remittance-quote-actions";
import { buildExplorerUrl, type QuoteBlocker } from "@/lib/remittance/transfer";
import { PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS } from "@/lib/remittance/protected-transfer";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";

const ADDR = "0x" + "1234567890abcdef".repeat(4);
const ACCOUNT = "0x" + "22".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const VALID_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "ab".repeat(32) };
const NOW = 1_700_000_000_000;

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
    <button type="button" data-testid="wallet-connect">
      Connect wallet
    </button>
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
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
        },
      };
    }),
  };
});

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  const issuedAt = NOW;
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
    ...overrides,
  };
}

const REVIEWER_NAME = "Convey Review";

function planResponse() {
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
    reviewerName: REVIEWER_NAME,
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS.tomorrow,
    reviewNote: "Hold until Ana confirms",
  };
}

function renderActions(
  blocker: QuoteBlocker = "none",
  onConfirm = vi.fn(),
  extra: { expired?: boolean } = {},
) {
  return render(
    <RemittanceQuoteActions
      quote={quote()}
      expired={extra.expired ?? false}
      blocker={blocker}
      onConfirm={onConfirm}
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
});

describe("family review path on executable quote review", () => {
  it("keeps Send directly as the default and calls onConfirm unchanged", () => {
    const onConfirm = vi.fn();
    renderActions("none", onConfirm);
    expect(screen.getByTestId("send-path-direct")).toBeChecked();
    expect(screen.queryByTestId("family-review-deadline")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("review-transfer"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides hold selection when the quote is blocked", () => {
    renderActions("wallet");
    expect(screen.queryByTestId("send-path-direct")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-path-hold")).not.toBeInTheDocument();
  });

  it("keeps hold compact until Add a note or a missing-note Hold CTA", () => {
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    expect(screen.getByText(/waits for someone in your family/i)).toBeInTheDocument();
    expect(screen.queryByText(/USDC|Sui|reviewer/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("family-review-deadline")).toBeInTheDocument();
    expect(screen.getByTestId("family-review-deadline-tomorrow")).toBeInTheDocument();
    expect(screen.getByTestId("family-review-deadline-three_days")).toBeInTheDocument();
    expect(screen.getByTestId("family-review-deadline-seven_days")).toBeInTheDocument();
    expect(screen.queryByTestId("family-review-note")).not.toBeInTheDocument();
    const addNote = screen.getByTestId("family-review-add-note");
    expect(addNote).toBeEnabled();
    expect(addNote).toHaveTextContent("+ Add a note");
    expect(addNote.tagName).toBe("BUTTON");
    expect(addNote).toHaveClass("h-11", "w-full");
    expect(screen.getByTestId("hold-prepare")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("family-review-add-note"));
    expect(screen.getByTestId("family-review-note")).toBeInTheDocument();
    expect(screen.getByText("What should they check?")).toBeInTheDocument();
    expect(screen.getByTestId("family-review-note")).toHaveClass("resize-none");
  });

  it("requires a note of at most 120 code points before requesting a plan", () => {
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    expect(screen.getByTestId("family-review-deadline")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hold-prepare"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("family-review-note")).toBeInTheDocument();
    expect(screen.getByTestId("family-review-note-error")).toHaveTextContent(
      "Add a short note for your family reviewer.",
    );

    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "a".repeat(121) },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests an unchanged plan after a valid note", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ kind: "rejected", reason: "not_configured" }), { status: 200 }),
    );
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-deadline-three_days"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      quote: quote(),
      deadlinePreset: "three_days",
      reviewNote: "Hold until Ana confirms",
    });
  });

  it("shows not_configured copy and keeps Send directly one action away", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ kind: "rejected", reason: "not_configured" }), { status: 200 }),
    );
    const onConfirm = vi.fn();
    renderActions("none", onConfirm);
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(screen.getByTestId("family-review-error")).toHaveTextContent(
        "Family review isn't available right now. Send directly to continue.",
      );
    });
    expect(screen.getByTestId("family-review-error").textContent).not.toMatch(/not_configured|package|endpoint/i);
    fireEvent.click(screen.getByTestId("send-path-direct"));
    await waitFor(() => {
      expect(screen.getByTestId("review-transfer")).toHaveTextContent(/Review transfer/i);
    });
    fireEvent.click(screen.getByTestId("review-transfer"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("locks duplicate plan and wallet submit and never claims Created or payout", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    wallet.signAndExecuteTransaction.mockImplementation(
      () =>
        new Promise(() => {
          /* hang after first wallet call */
        }),
    );

    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    const primary = screen.getByTestId("hold-prepare");
    fireEvent.click(primary);
    fireEvent.click(primary);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify(planResponse()), { status: 200, headers: { "content-type": "application/json" } }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("family-review-summary")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("hold-approve"));
    fireEvent.click(screen.getByTestId("hold-approve"));
    await waitFor(() => {
      expect(screen.getByTestId("hold-approve")).toHaveTextContent(/Confirm in your wallet/i);
    });
    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Created|Released|Refunded|family payout/i)).not.toBeInTheDocument();

    expect(screen.getByTestId("send-path-direct")).toBeDisabled();
    expect(screen.getByTestId("send-path-hold")).toBeDisabled();
    expect(screen.getByTestId("send-path-hold")).toBeChecked();
    expect(screen.getByTestId("family-review-note")).toBeDisabled();
    expect(screen.getByTestId("edit-transfer")).toBeDisabled();
    expect(screen.getByTestId("carry-to-device")).toBeDisabled();
    expect(screen.getByTestId("hold-approve")).toBeDisabled();
    expect(screen.getByTestId("hold-approve")).toHaveTextContent(/Confirm in your wallet/i);
  });

  it("re-enables Send directly after a pre-sign rejection", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ kind: "rejected", reason: "not_configured" }), { status: 200 }),
    );
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(screen.getByTestId("family-review-error")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("send-path-direct")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("send-path-direct"));
    expect(screen.getByTestId("send-path-direct")).toBeChecked();
    expect(screen.getByTestId("review-transfer")).toHaveTextContent(/Review transfer/i);
  });

  it("shows hold submitted pending after a digest without claiming lifecycle", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(planResponse()), { status: 200, headers: { "content-type": "application/json" } }),
    );
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: VALID_DIGEST },
    });

    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(screen.getByTestId("family-review-summary")).toBeInTheDocument();
    });
    // Step 1 (hold-prepare) resolves the plan only; wallet is never invoked yet.
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("hold-approve"));

    await waitFor(() => {
      expect(screen.getByTestId("family-review-status")).toHaveTextContent(
        "Hold submitted — confirmation pending",
      );
    });
    expect(screen.queryByText(/Created|Released|Refunded/i)).not.toBeInTheDocument();
    const explorer = screen.getByTestId("family-review-explorer");
    expect(explorer).toHaveTextContent("View on Sui Explorer");
    expect(explorer).toHaveAttribute("href", buildExplorerUrl(VALID_DIGEST));
    expect(explorer).toHaveAttribute("target", "_blank");
    expect(explorer).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("locks unknown without inventing an explorer link", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(planResponse()), { status: 200, headers: { "content-type": "application/json" } }),
    );
    wallet.signAndExecuteTransaction.mockResolvedValue({ $kind: "FailedTransaction" });

    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(screen.getByTestId("family-review-summary")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("hold-approve"));

    await waitFor(() => {
      expect(screen.getByTestId("family-review-status")).toHaveTextContent(
        "Outcome unknown — check wallet and explorer",
      );
    });
    expect(screen.queryByTestId("family-review-explorer")).not.toBeInTheDocument();
    expect(screen.queryByText("View on Sui Explorer")).not.toBeInTheDocument();
    // Single compact CTA in unknown phase; locked, no second hold action.
    expect(screen.getByTestId("hold-prepare")).toBeDisabled();
    expect(screen.queryByTestId("hold-approve")).not.toBeInTheDocument();
  });

  it("keeps hold idle to a single Hold for family review CTA and never signs on prepare", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(planResponse()), { status: 200, headers: { "content-type": "application/json" } }),
    );
    renderActions();
    fireEvent.click(screen.getByTestId("send-path-hold"));
    // Idle: exactly one primary hold CTA, no wallet/approve action yet.
    expect(screen.getByTestId("hold-prepare")).toHaveTextContent("Hold for family review");
    expect(screen.queryByTestId("hold-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-transfer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("family-review-add-note"));
    fireEvent.change(screen.getByTestId("family-review-note"), {
      target: { value: "Hold until Ana confirms" },
    });
    fireEvent.click(screen.getByTestId("hold-prepare"));
    await waitFor(() => {
      expect(screen.getByTestId("family-review-summary")).toBeInTheDocument();
    });
    // Step 1 resolves the plan only; the wallet is never invoked by prepare.
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
    // Step 2 is now the only remaining action.
    expect(screen.getByTestId("hold-approve")).toBeInTheDocument();
    expect(screen.queryByTestId("hold-prepare")).not.toBeInTheDocument();
  });
});

describe("unmapped recipient copy", () => {
  it("labels the edit CTA as Choose another recipient without claiming payout details", () => {
    renderActions("unmapped");
    expect(screen.getByTestId("edit-transfer")).toHaveTextContent("Choose another recipient");
    expect(screen.getByTestId("remittance-preview-only")).toHaveTextContent(
      /not ready for wallet transfers/i,
    );
    expect(screen.queryByText(/payout details/i)).not.toBeInTheDocument();
  });
});
