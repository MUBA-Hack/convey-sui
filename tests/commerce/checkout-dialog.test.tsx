// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { CheckoutDialog } from "@/components/commerce/checkout-dialog";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";

/**
 * Checkout lifecycle regression tests for the real-wallet race fixed in
 * this change.
 *
 * The payment step must not be dismissible via dialog chrome (X / Escape /
 * outside-pointer) while a wallet resolution is pending, and a late async
 * wallet resolution that lands after unmount/dismiss must never invoke
 * onSettled or confirm the originating card. The explicit Cancel inside the
 * payment step still works when idle and is disabled while pending.
 *
 * The dapp-kit v2 hooks are mocked and `signAndExecuteTransaction` is driven
 * by a controlled promise so the pending window is deterministic. The real
 * `PaymentAction` + payment core run for real, so the mounted guard and
 * onPendingChange wiring are exercised end-to-end. The radix Dialog
 * primitives are inlined (portals/focus traps are flaky in jsdom) but threaded
 * with `onOpenChange` so the chrome-guard logic in `CheckoutDialog` runs for
 * real — a "Chrome close" button stands in for X / Escape / outside-pointer,
 * all of which radix routes through `onOpenChange(false)`.
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

// Inline Dialog primitives so portals/focus traps don't run in jsdom, while
// still threading `onOpenChange` so CheckoutDialog's chrome guard is real.
// The "Chrome close" button simulates X / Escape / outside-pointer — every
// radix dismissal path routes through onOpenChange(false).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="dialog-root">
        <button
          type="button"
          data-testid="dialog-chrome-close"
          onClick={() => onOpenChange?.(false)}
        >
          ChromeClose
        </button>
        {children}
      </div>
    ) : null,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogOverlay: () => <div data-testid="dialog-overlay" />,
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({
    children,
    showCloseButton,
  }: {
    children: ReactNode;
    showCloseButton?: boolean;
  }) => (
    <div
      data-testid="dialog-content"
      role="dialog"
      aria-modal="true"
      data-show-close={showCloseButton === false ? "false" : "true"}
    >
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

function preview(overrides: Partial<PurchaseIntentPreview> = {}): PurchaseIntentPreview {
  return {
    kind: "preview",
    action: "buy",
    item: { id: "iced-coffee", name: "Iced Coffee" },
    quantity: 2,
    unitPriceMist: "3000000000",
    totalMist: "6000000000",
    priceCeilingMist: "8000000000",
    merchant: { id: "river-cafe", name: "River Cafe", address: ADDR },
    confidence: 1.0,
    clarification: null,
    ...overrides,
  };
}

beforeEach(() => {
  wallet.account = { address: ACCOUNT };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", ADDR);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A controlled pending promise so the pending window is deterministic. */
function pendingWallet() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  wallet.signAndExecuteTransaction.mockReturnValue(promise);
  return { resolve, reject };
}

/** Drive the dialog to the payment step (review -> payment). */
function goToPaymentStep() {
  fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
  return waitFor(() =>
    expect(screen.getByRole("button", { name: /confirm payment/i })).toBeInTheDocument(),
  );
}

/** Click Confirm payment and wait for the pending state to surface. */
async function startPending() {
  fireEvent.click(screen.getByRole("button", { name: /confirm payment/i }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /awaiting signature/i })).toBeDisabled(),
  );
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const onSettled = vi.fn();
  const onPaymentCancel = vi.fn();
  const utils = render(
    <CheckoutDialog
      open
      preview={preview()}
      networkMode="live"
      onOpenChange={onOpenChange}
      onSettled={onSettled}
      onPaymentCancel={onPaymentCancel}
    />,
  );
  return { ...utils, onOpenChange, onSettled, onPaymentCancel };
}

describe("CheckoutDialog — chrome guards while payment is pending", () => {
  it("hides the X close button while a wallet resolution is pending", async () => {
    pendingWallet();
    renderDialog();
    const content = screen.getByTestId("dialog-content");
    // Idle payment step: the X close button is available.
    expect(content).toHaveAttribute("data-show-close", "true");

    await goToPaymentStep();
    expect(screen.getByTestId("dialog-content")).toHaveAttribute("data-show-close", "true");

    await startPending();
    // Pending: the X close button is suppressed.
    expect(screen.getByTestId("dialog-content")).toHaveAttribute("data-show-close", "false");
  });

  it("blocks X / Escape / outside dismissal while pending (onOpenChange not called)", async () => {
    pendingWallet();
    const { onOpenChange } = renderDialog();
    await goToPaymentStep();
    await startPending();

    // Chrome dismissal attempts (X / Escape / outside all route here) are
    // swallowed while pending — the dialog must not close.
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).not.toHaveBeenCalled();
    // The dialog body is still mounted.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /awaiting signature/i })).toBeInTheDocument();
  });

  it("allows chrome dismissal when the payment step is idle (not pending)", async () => {
    pendingWallet();
    const { onOpenChange } = renderDialog();
    await goToPaymentStep();
    // Idle: chrome dismissal is allowed — it acts as a cancel.
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("re-enables chrome dismissal after a wallet rejection clears pending", async () => {
    const { reject } = pendingWallet();
    const { onOpenChange } = renderDialog();
    await goToPaymentStep();
    await startPending();

    // Chrome is locked while pending.
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).not.toHaveBeenCalled();

    // Wallet rejects -> pending clears -> chrome reopens.
    await act(async () => {
      reject(new Error("User rejected the request"));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm payment/i })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CheckoutDialog — explicit cancel semantics", () => {
  it("fires onPaymentCancel and closes when Cancel is pressed while idle", async () => {
    pendingWallet();
    const { onPaymentCancel, onOpenChange } = renderDialog();
    await goToPaymentStep();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onPaymentCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Cancel while a wallet resolution is pending", async () => {
    pendingWallet();
    renderDialog();
    await goToPaymentStep();
    await startPending();

    const cancel = screen.getByRole("button", { name: /cancel/i });
    expect(cancel).toBeDisabled();
  });
});

describe("CheckoutDialog — late wallet resolution after unmount/dismiss", () => {
  it("never invokes onSettled when the wallet resolves after the dialog unmounts mid-pending", async () => {
    const { resolve } = pendingWallet();
    const { onSettled, unmount } = renderDialog();
    await goToPaymentStep();
    await startPending();

    // The host tears down the whole tree (route change, parent unmount) while
    // the wallet prompt is still open.
    unmount();

    // The wallet eventually resolves. A late settle must NOT fire onSettled
    // or confirm the originating card.
    await act(async () => {
      resolve({ $kind: "Transaction", Transaction: { digest: "LATE-UNMOUNT" } });
    });
    // Flush any pending microtasks.
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("never invokes onSettled when the wallet resolves after a forced dismiss mid-pending", async () => {
    const { resolve } = pendingWallet();
    const { onSettled, rerender } = renderDialog();

    await goToPaymentStep();
    await startPending();

    // The parent force-closes the dialog (open=false) while pending — e.g. a
    // higher-level guard bypasses the chrome lock. PaymentAction unmounts.
    rerender(
      <CheckoutDialog
        open={false}
        preview={preview()}
        networkMode="live"
        onOpenChange={vi.fn()}
        onSettled={onSettled}
        onPaymentCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Late wallet resolution must not settle or confirm the card.
    await act(async () => {
      resolve({ $kind: "Transaction", Transaction: { digest: "LATE-DISMISS" } });
    });
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("still settles legitimately when the wallet resolves while mounted (no false negative)", async () => {
    const { resolve } = pendingWallet();
    const { onSettled, onOpenChange } = renderDialog();
    await goToPaymentStep();
    await startPending();

    // A blocked chrome dismissal must NOT abort the in-flight settlement.
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).not.toHaveBeenCalled();

    // The wallet resolves while still mounted -> legitimate settlement fires
    // exactly once and the dialog closes on terminal success.
    await act(async () => {
      resolve({ $kind: "Transaction", Transaction: { digest: "OK-123" } });
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    const receipt = onSettled.mock.calls[0]![0];
    expect(receipt.demo).toBe(false);
    expect(receipt.digest).toBe("OK-123");
    // Terminal close is not blocked by the chrome guard (pending flipped false
    // before onSettled).
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CheckoutDialog — review step is unaffected by the payment lock", () => {
  it("allows chrome dismissal from the review step (no transaction is built there)", () => {
    pendingWallet();
    const { onOpenChange } = renderDialog();
    // Review step: chrome dismissal closes without settling.
    fireEvent.click(screen.getByTestId("dialog-chrome-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets to the review step and clears any pending flag when reopened", async () => {
    const { resolve } = pendingWallet();
    const { onSettled, rerender } = renderDialog();
    await goToPaymentStep();
    await startPending();

    // Close + reopen the dialog. A stale pending flag must not leak.
    rerender(
      <CheckoutDialog
        open={false}
        preview={preview()}
        networkMode="live"
        onOpenChange={vi.fn()}
        onSettled={onSettled}
        onPaymentCancel={vi.fn()}
      />,
    );
    rerender(
      <CheckoutDialog
        open
        preview={preview()}
        networkMode="live"
        onOpenChange={vi.fn()}
        onSettled={onSettled}
        onPaymentCancel={vi.fn()}
      />,
    );

    // Back on the review step; the X close button is available (not locked).
    expect(screen.getByTestId("dialog-content")).toHaveAttribute("data-show-close", "true");
    expect(screen.getByRole("button", { name: /continue to payment/i })).toBeInTheDocument();

    // The late resolution from the prior session must not settle this fresh
    // checkout.
    await act(async () => {
      resolve({ $kind: "Transaction", Transaction: { digest: "STALE" } });
    });
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
