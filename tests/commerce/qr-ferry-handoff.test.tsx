// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QrFerry } from "@/components/commerce/qr-ferry";
import {
  createEnvelope,
  exportEnvelopeJson,
} from "@/lib/commerce/qr-ferry";

/**
 * Focused test for the QR Ferry handoff: an approved payment on the connected
 * device reaches the SAME guarded checkout/proof path (PaymentAction) the
 * home chat uses. The dapp-kit hooks are mocked so PaymentAction resolves to
 * DEMO mode.
 */

const MERCHANT = "0x".concat("11".repeat(32)) as `0x${string}`;
const NOW = 1_700_000_000_000;
const EXPIRY_MS = 60 * 60 * 1000;

// Mock dapp-kit v2 hooks so PaymentAction runs in deterministic DEMO mode.
const wallet = vi.hoisted(() => ({
  account: null as { address: string } | null,
  network: "testnet" as string,
  signAndExecuteTransaction: vi.fn(),
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
}));

function craftJson(nonce: string): string {
  const env = createEnvelope({
    item: "Iced Coffee",
    quantity: 2,
    totalMist: 6_000_000_000n,
    merchantAddress: MERCHANT,
    nonce,
    createdAt: NOW,
    expiresAt: NOW + EXPIRY_MS,
  });
  return exportEnvelopeJson(env);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  wallet.account = null;
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  cleanup();
});

describe("QrFerry — handoff to the same guarded checkout", () => {
  // The manual paste/file fallback is collapsed behind "Enter manually" by
  // default; open it before driving the manual import path.
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("connected device: import -> validate -> continue to checkout renders PaymentAction", () => {
    render(<QrFerry />);
    openManual();

    const json = craftJson("nonce-handoff-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();

    // Continue to checkout hands the validated envelope into PaymentAction.
    fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/i }));

    // PaymentAction is now mounted: the preview mode label and the
    // payable Confirm control are present — the same guarded path as home.
    expect(screen.getByText(/^Preview — no on-chain settlement$/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm payment/i }),
    ).toBeInTheDocument();
  });

  it("connected device: the checkout header labels it as the same guarded checkout", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-handoff-002");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/i }));
    expect(screen.getAllByText(/same guarded checkout/i).length).toBeGreaterThanOrEqual(1);
  });

  it("connected device: settling the DEMO payment produces a proof card without calling the wallet", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-handoff-003");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm payment/i }));

    // The DEMO proof card appears and the wallet was never called.
    expect(screen.getByTestId("settlement-proof")).toBeInTheDocument();
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });
});
