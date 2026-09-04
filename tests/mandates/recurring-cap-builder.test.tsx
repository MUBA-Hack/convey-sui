// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  WalletStandardError,
} from "@wallet-standard/errors";

const ACCOUNT = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "ab".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const EXPIRY_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const { wallet } = vi.hoisted(() => ({
  wallet: {
    account: null as { address: string } | null,
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
  WalletConnectButton: () => <button type="button">Connect wallet</button>,
}));

import { RecurringCapBuilder } from "@/components/mandates/recurring-cap-builder";

function fillDraft(overrides: Record<string, string> = {}) {
  const values = {
    beneficiary: BENEFICIARY,
    purpose: "Rent support",
    funded: "100",
    total: "100",
    perPayment: "10",
    interval: "30",
    expiry: EXPIRY_DATE,
    ...overrides,
  };
  fireEvent.change(screen.getByTestId("input-beneficiary"), { target: { value: values.beneficiary } });
  fireEvent.change(screen.getByTestId("input-purpose"), { target: { value: values.purpose } });
  fireEvent.change(screen.getByTestId("input-funded"), { target: { value: values.funded } });
  fireEvent.change(screen.getByTestId("input-total"), { target: { value: values.total } });
  fireEvent.change(screen.getByTestId("input-per-payment"), { target: { value: values.perPayment } });
  fireEvent.change(screen.getByTestId("input-interval"), { target: { value: values.interval } });
  fireEvent.change(screen.getByTestId("input-expiry"), { target: { value: values.expiry } });
  fireEvent.submit(screen.getByTestId("mandate-form"));
}

const fillValidDraft = () => fillDraft();

beforeEach(() => {
  wallet.account = null;
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
});

afterEach(() => cleanup());

describe("RecurringCapBuilder — draft journey without a wallet", () => {
  it("renders the form and shows field errors on an empty submit without any wallet", () => {
    render(<RecurringCapBuilder />);
    fireEvent.submit(screen.getByTestId("mandate-form"));
    expect(screen.getByTestId("field-error-beneficiaryAddress")).toBeInTheDocument();
    expect(screen.getByTestId("field-error-funded")).toBeInTheDocument();
    expect(screen.getByTestId("field-error-perPayment")).toBeInTheDocument();
    expect(screen.getByText("Fix the highlighted fields to continue.")).toBeInTheDocument();
    expect(screen.getByTestId("mandate-form")).toBeInTheDocument();
  });

  it("blocks review when the lifetime cap is below the per-collection maximum", () => {
    render(<RecurringCapBuilder />);
    fillDraft({ perPayment: "50", total: "49.999999" });
    expect(screen.getByTestId("field-error-totalCap")).toHaveTextContent(
      /below the per-collection maximum/,
    );
    expect(screen.queryByTestId("review-limits")).not.toBeInTheDocument();
  });

  it("shows the exact hard limits on review and revises back with values intact", () => {
    render(<RecurringCapBuilder />);
    fillValidDraft();
    expect(screen.getByTestId("review-limits")).toBeInTheDocument();
    expect(screen.getByTestId("payoff-per-payment")).toHaveTextContent("10 USDC");
    expect(screen.getByTestId("payoff-total-cap")).toHaveTextContent("100 USDC");
    expect(screen.getByTestId("payoff-funded")).toHaveTextContent("100 USDC");
    expect(screen.getByTestId("payoff-interval")).toHaveTextContent(
      "30 days between collections",
    );
    expect(screen.getByTestId("payoff-expiry")).toBeInTheDocument();
    expect(screen.getByTestId("payoff-refund")).toHaveTextContent(/unspent balance returns/);

    fireEvent.click(screen.getByTestId("revise-button"));
    expect(screen.getByTestId("input-beneficiary")).toHaveValue(BENEFICIARY);
    expect(screen.getByTestId("input-funded")).toHaveValue("100");
    expect(screen.queryByTestId("review-limits")).not.toBeInTheDocument();
  });

  it("keeps the full draft, review, and revise journey available without a wallet", () => {
    render(<RecurringCapBuilder />);
    fillValidDraft();
    expect(screen.getByTestId("review-limits")).toBeInTheDocument();
    expect(screen.getByTestId("ready-for-wallet-review")).toBeInTheDocument();
    expect(screen.getByTestId("ready-blockers")).toHaveTextContent(
      "Connect a Sui testnet wallet to approve this mandate.",
    );
    expect(screen.getByTestId("prepare-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("revise-button"));
    expect(screen.getByTestId("mandate-form")).toBeInTheDocument();
  });
});

describe("RecurringCapBuilder — truthful prepared states", () => {
  it("shows the wallet connection boundary when no wallet is connected", () => {
    render(<RecurringCapBuilder />);
    fillValidDraft();
    expect(screen.getByTestId("ready-blockers")).toHaveTextContent(
      "Connect a Sui testnet wallet to approve this mandate.",
    );
    expect(screen.getByTestId("prepare-button")).toBeDisabled();
  });

  it("names the network boundary when the wallet is on the wrong network", () => {
    wallet.account = { address: ACCOUNT };
    wallet.network = "mainnet";
    render(<RecurringCapBuilder />);
    fillValidDraft();
    expect(screen.getByTestId("ready-blockers")).toHaveTextContent(
      "Switch your wallet to the Sui testnet network.",
    );
    expect(screen.getByTestId("prepare-button")).toBeDisabled();
  });

  it("prepares the exact transaction and requires an explicit wallet approval", () => {
    wallet.account = { address: ACCOUNT };
    render(<RecurringCapBuilder />);
    fillValidDraft();
    expect(screen.queryByTestId("ready-for-wallet-review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("prepare-button"));
    expect(screen.getByTestId("prepared-panel")).toBeInTheDocument();
    expect(screen.getByTestId("prepared-panel")).toHaveTextContent("100 USDC");
    expect(screen.getByTestId("prepared-panel")).toHaveTextContent("10 USDC");
    expect(screen.getByTestId("approve-button")).toBeInTheDocument();
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
    expect(screen.getByTestId("prepare-button")).toBeDisabled();
  });

  it("submits through the wallet and stays at confirmation pending with an explorer link", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest: DIGEST, status: { success: true } },
    });
    render(<RecurringCapBuilder />);
    fillValidDraft();
    fireEvent.click(screen.getByTestId("prepare-button"));
    fireEvent.click(screen.getByTestId("approve-button"));
    await waitFor(() => expect(screen.getByTestId("submitted-status")).toBeInTheDocument());
    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("submitted-explorer")).toHaveAttribute(
      "href",
      `https://suiscan.testnet.sui.io/tx/${DIGEST}`,
    );
    expect(screen.getByTestId("submitted-status")).toHaveTextContent(
      "Submitted. Confirmation pending.",
    );
    expect(screen.queryByTestId("approve-button")).not.toBeInTheDocument();
  });

  it("returns to the prepared state on an explicit wallet rejection", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.signAndExecuteTransaction.mockRejectedValue(
      new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED),
    );
    render(<RecurringCapBuilder />);
    fillValidDraft();
    fireEvent.click(screen.getByTestId("prepare-button"));
    fireEvent.click(screen.getByTestId("approve-button"));
    await waitFor(() => expect(screen.getByTestId("approve-button")).toBeInTheDocument());
    expect(screen.queryByTestId("submitted-status")).not.toBeInTheDocument();
  });

  it("shows an honest unknown outcome and locks revise when the result is a failed transaction", async () => {
    wallet.account = { address: ACCOUNT };
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "FailedTransaction",
      FailedTransaction: { digest: DIGEST },
    });
    render(<RecurringCapBuilder />);
    fillValidDraft();
    fireEvent.click(screen.getByTestId("prepare-button"));
    fireEvent.click(screen.getByTestId("approve-button"));
    await waitFor(() => expect(screen.getByTestId("unknown-status")).toBeInTheDocument());
    expect(screen.getByTestId("unknown-status")).toHaveTextContent("Outcome unknown.");
    expect(screen.getByTestId("revise-button")).toBeDisabled();
    expect(screen.queryByTestId("submitted-status")).not.toBeInTheDocument();
  });
});
