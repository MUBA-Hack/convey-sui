// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";

/**
 * Wave 3 Task 3.1 — DOM tests for the gated SUI payment action.
 *
 * Only the dapp-kit v2 hooks are mocked (account/network/signAndExecute).
 * The real payment core (`@/lib/commerce/payment`) and the real `Transaction`
 * builder are exercised, so the transaction shape and mode gating are tested
 * for real without a network. DEMO mode never calls the wallet; real mode
 * calls signAndExecuteTransaction exactly once and inspects the $kind union.
 */

const ADDR = "0x" + "1234567890abcdef".repeat(4);
const ACCOUNT = "0x" + "22".repeat(32);

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
}));

import { PaymentAction } from "@/components/commerce/payment-action";

function preview(overrides: Partial<PurchaseIntentPreview> = {}): PurchaseIntentPreview {
  return {
    kind: "preview",
    action: "buy",
    item: { id: "iced-coffee", name: "Iced Coffee" },
    quantity: 2,
    unitPriceMist: "3000000000",
    totalMist: "6000000000",
    priceCeilingMist: "8000000000",
    merchant: { id: "river-cafe", name: "River Cafe", address: null },
    confidence: 1.0,
    clarification: null,
    ...overrides,
  };
}

beforeEach(() => {
  wallet.account = { address: ACCOUNT };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", "");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PaymentAction — DEMO simulation mode", () => {
  it("renders the DEMO simulation label, amount, and merchant when no merchant is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", "");
    render(<PaymentAction preview={preview()} />);

    expect(screen.getByText(/DEMO simulation/i)).toBeInTheDocument();
    // Amount shown in SUI (6 SUI = 6_000_000_000 MIST) and raw MIST.
    expect(screen.getByText("6 SUI")).toBeInTheDocument();
    expect(screen.getByText("6000000000 MIST")).toBeInTheDocument();
    expect(screen.getByText("River Cafe")).toBeInTheDocument();
  });

  it("never claims on-chain settlement in DEMO mode", () => {
    render(<PaymentAction preview={preview()} />);
    const label = screen.getByText(/DEMO simulation/i);
    expect(label.textContent).toMatch(/DEMO|simulation/i);
    expect(label.textContent).not.toMatch(/settled on-chain|confirmed on-chain/i);
  });

  it("produces a DEMO receipt on confirm without calling the wallet", async () => {
    const onSettled = vi.fn();
    render(<PaymentAction preview={preview()} onSettled={onSettled} />);

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByText(/DEMO-/i)).toBeInTheDocument();
    });

    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    const receipt: PaymentReceipt = onSettled.mock.calls[0]![0];
    expect(receipt.demo).toBe(true);
    expect(receipt.digest.startsWith("DEMO-")).toBe(true);
    expect(receipt.explorerUrl).toBeNull();
    // No explorer link is rendered for a DEMO receipt.
    expect(screen.queryByRole("link", { name: /View transaction/i })).not.toBeInTheDocument();
  });
});

describe("PaymentAction — real testnet mode", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", ADDR);
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
  });

  it("renders the Real testnet label when connected, testnet, and merchant matches preview", () => {
    render(<PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />);
    expect(screen.getByText(/Real testnet transfer/i)).toBeInTheDocument();
  });

  it("signs, executes, and shows the real digest plus explorer link", async () => {
    const digest = "ABCdef123456GHI789";
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "Transaction",
      Transaction: { digest },
    });
    const onSettled = vi.fn();

    render(
      <PaymentAction
        preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })}
        onSettled={onSettled}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByText(digest)).toBeInTheDocument();
    });

    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    const link = screen.getByRole("link", { name: /View transaction/i });
    expect(link).toHaveAttribute("href", `https://suiscan.testnet.sui.io/tx/${digest}`);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]![0].demo).toBe(false);
    expect(onSettled.mock.calls[0]![0].digest).toBe(digest);
  });

  it("shows a friendly canceled message on wallet rejection and clears pending", async () => {
    wallet.signAndExecuteTransaction.mockRejectedValue(new Error("User rejected the request"));
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/cancel/i);
    });
    expect(screen.queryByText(/DEMO-/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View transaction/i })).not.toBeInTheDocument();
    // Confirm is usable again.
    expect(screen.getByRole("button", { name: /Confirm/i })).not.toBeDisabled();
  });

  it("shows a friendly insufficient-balance message", async () => {
    wallet.signAndExecuteTransaction.mockRejectedValue(new Error("Insufficient gas balance"));
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/enough balance|insufficient/i);
    });
  });

  it("surfaces a friendly failure when the transaction fails on-chain ($kind FailedTransaction)", async () => {
    wallet.signAndExecuteTransaction.mockResolvedValue({
      $kind: "FailedTransaction",
      FailedTransaction: {
        digest: "faildigest",
        status: { success: false, error: { message: "move abort: vector index out of bounds" } },
      },
    });
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // No success digest or explorer link is rendered for a failed tx.
    expect(screen.queryByRole("link", { name: /View transaction/i })).not.toBeInTheDocument();
  });

  it("shows pending state within one render while awaiting the wallet", async () => {
    let resolveFn!: (value: unknown) => void;
    wallet.signAndExecuteTransaction.mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Awaiting signature|Confirm/i })).toBeDisabled();
    });
    const confirm = screen.getByRole("button", { name: /Awaiting signature|Confirm/i });
    expect(confirm).toHaveAttribute("aria-busy", "true");

    // Release the wallet and confirm it recovers.
    resolveFn({ $kind: "Transaction", Transaction: { digest: "XYZ123" } });
    await waitFor(() => {
      expect(screen.getByText("XYZ123")).toBeInTheDocument();
    });
  });
});

describe("PaymentAction — mode gating", () => {
  it("falls back to DEMO when connected on mainnet even if a merchant is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", ADDR);
    wallet.account = { address: ACCOUNT };
    wallet.network = "mainnet";
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: ADDR } })} />,
    );
    expect(screen.getByText(/DEMO simulation/i)).toBeInTheDocument();
    expect(screen.queryByText(/Real testnet transfer/i)).not.toBeInTheDocument();
  });

  it("falls back to DEMO when the configured merchant does not match the preview merchant", () => {
    const other = "0x" + "99".repeat(32);
    vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", ADDR);
    wallet.account = { address: ACCOUNT };
    wallet.network = "testnet";
    render(
      <PaymentAction preview={preview({ merchant: { id: "river-cafe", name: "River Cafe", address: other } })} />,
    );
    expect(screen.getByText(/DEMO simulation/i)).toBeInTheDocument();
  });
});

describe("PaymentAction — cancel and hit targets", () => {
  it("fires onCancel when the cancel button is pressed", () => {
    const onCancel = vi.fn();
    render(<PaymentAction preview={preview()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("uses at least 44px hit targets for confirm and cancel", () => {
    render(<PaymentAction preview={preview()} />);
    const confirm = screen.getByRole("button", { name: /Confirm/i });
    const cancel = screen.getByRole("button", { name: /Cancel/i });
    expect(confirm.className).toContain("min-h-[44px]");
    expect(cancel.className).toContain("min-h-[44px]");
  });
});
