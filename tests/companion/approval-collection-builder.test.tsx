// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanionChat } from "@/components/companion/companion-chat";
import { SAMPLE_COMPANION_MEMORY } from "@/components/companion/sample-context";

// The showcase companion never mounts wallet hooks, so these tests mock the
// dapp-kit surface the builder and its connect button consume. No wallet is
// connected here on purpose: the prepared, never-submitted state is the
// honest no-wallet outcome the UI must present.
vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => undefined,
  useCurrentNetwork: () => "testnet",
  useDAppKit: () => ({ signAndExecuteTransaction: vi.fn() }),
  useWalletConnection: () => ({ account: null, isConnecting: false, isReconnecting: false }),
  useWallets: () => [],
}));

const BENEFICIARY = "0x" + "a1".repeat(32);
const APPROVER_A = "0x" + "b2".repeat(32);
const APPROVER_B = "0x" + "c3".repeat(32);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openNgoControls() {
  fireEvent.click(screen.getByRole("button", { name: /switch workspace.*personal/i }));
  fireEvent.click(screen.getByRole("button", { name: /ngo operations/i }));
  fireEvent.click(screen.getByRole("button", { name: "Controls" }));
}

function openCollectionBuilder() {
  fireEvent.click(screen.getByRole("button", { name: /create approval collection/i }));
  return within(screen.getByRole("dialog", { name: /create approval collection/i }));
}

function fillValidDetails(dialog: ReturnType<typeof within>) {
  fireEvent.change(dialog.getByLabelText(/^purpose$/i), {
    target: { value: "Field stipend for September" },
  });
  fireEvent.change(dialog.getByLabelText(/beneficiary sui address/i), {
    target: { value: BENEFICIARY },
  });
  fireEvent.change(dialog.getByLabelText(/amount \(usdc\)/i), {
    target: { value: "12.5" },
  });
  fireEvent.change(dialog.getByLabelText("Approver 1 Sui address"), {
    target: { value: APPROVER_A },
  });
  fireEvent.click(dialog.getByRole("button", { name: /add approver/i }));
  fireEvent.change(dialog.getByLabelText("Approver 2 Sui address"), {
    target: { value: APPROVER_B },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Require 2 of 2 approvals" }));
}

function continueToReview(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole("button", { name: /review collection/i }));
}

describe("Approval collection builder — integration", () => {
  it("opens from organization Controls and keeps workspace state after closing", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    fireEvent.click(screen.getByRole("button", { name: /switch workspace.*personal/i }));
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "River Aid" } });
    fireEvent.change(screen.getByLabelText(/organization type/i), { target: { value: "ngo" } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Controls" }));

    expect(screen.getByRole("button", { name: /create approval collection/i })).toBeInTheDocument();
    openCollectionBuilder();

    expect(screen.getByRole("heading", { name: /create approval collection/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^purpose$/i)).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: /create approval collection/i }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /create approval collection/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /choose a task/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch workspace.*river aid/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /organization view/i })).toBeInTheDocument();
  });

  it("keeps the Chat/Controls switch working while the builder is open", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    openCollectionBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByLabelText(/companion message/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /create approval collection/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Controls" }));
    expect(screen.getByRole("button", { name: /create approval collection/i })).toBeInTheDocument();
  });
});

describe("Approval collection builder — configure and review", () => {
  it("shows every exact term on review before any wallet action", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    const dialog = openCollectionBuilder();
    fillValidDetails(dialog);
    continueToReview(dialog);

    const review = dialog.getByTestId("approval-collection-review");
    expect(review).toHaveTextContent("12.5 USDC");
    expect(review).toHaveTextContent("USDC on Sui testnet");
    expect(review).toHaveTextContent(BENEFICIARY);
    expect(review).toHaveTextContent("2 of 2 approvals required");
    expect(review).toHaveTextContent(APPROVER_A);
    expect(review).toHaveTextContent(APPROVER_B);
    expect(review).toHaveTextContent(/only after 2 of 2 approvers approve/i);
    expect(review).toHaveTextContent(/refund the full balance after the expiry/i);
    expect(review).toHaveTextContent(/Expiry\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(review).toHaveTextContent(/wallet signs the funding transaction/i);
    expect(review).toHaveTextContent(/no ai or server can approve this payment/i);
  });

  it("returns to details with every entry preserved when revising", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    const dialog = openCollectionBuilder();
    fillValidDetails(dialog);
    continueToReview(dialog);

    fireEvent.click(dialog.getByRole("button", { name: /back to details/i }));
    expect(dialog.getByLabelText(/^purpose$/i)).toHaveValue("Field stipend for September");
    expect(dialog.getByLabelText(/beneficiary sui address/i)).toHaveValue(BENEFICIARY);
    expect(dialog.getByLabelText(/amount \(usdc\)/i)).toHaveValue("12.5");
    expect(dialog.getByLabelText("Approver 1 Sui address")).toHaveValue(APPROVER_A);
    expect(dialog.getByLabelText("Approver 2 Sui address")).toHaveValue(APPROVER_B);
    expect(dialog.getByRole("button", { name: "Require 2 of 2 approvals" })).toHaveAttribute("aria-pressed", "true");

    continueToReview(dialog);
    expect(dialog.getByTestId("approval-collection-review")).toHaveTextContent("2 of 2 approvals required");
  });

  it("clamps the required approvals when an approver is removed", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    const dialog = openCollectionBuilder();

    fireEvent.click(dialog.getByRole("button", { name: /add approver/i }));
    fireEvent.click(dialog.getByRole("button", { name: /add approver/i }));
    fireEvent.click(dialog.getByRole("button", { name: "Require 3 of 3 approvals" }));
    expect(dialog.getByRole("button", { name: "Require 3 of 3 approvals" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(dialog.getByRole("button", { name: "Remove approver 3" }));
    expect(dialog.queryByRole("button", { name: "Require 3 of 3 approvals" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Require 2 of 2 approvals" })).toHaveAttribute("aria-pressed", "true");
    expect(dialog.getByText(/2 of 2 releases the balance/i)).toBeInTheDocument();
  });
});

describe("Approval collection builder — strict local validation", () => {
  function startBuilder() {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    return openCollectionBuilder();
  }

  it("rejects an empty purpose and an empty beneficiary with field alerts", () => {
    const dialog = startBuilder();
    continueToReview(dialog);

    expect(dialog.getByText(/add a short purpose/i)).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText(/^purpose$/i), { target: { value: "Field stipend" } });
    continueToReview(dialog);
    expect(dialog.getByText(/enter the beneficiary's sui address/i)).toBeInTheDocument();
    expect(dialog.queryByTestId("approval-collection-review")).not.toBeInTheDocument();
  });

  it("rejects a zero amount", () => {
    const dialog = startBuilder();
    fireEvent.change(dialog.getByLabelText(/^purpose$/i), { target: { value: "Field stipend" } });
    fireEvent.change(dialog.getByLabelText(/beneficiary sui address/i), { target: { value: BENEFICIARY } });
    fireEvent.change(dialog.getByLabelText(/amount \(usdc\)/i), { target: { value: "0" } });
    continueToReview(dialog);
    expect(dialog.getByText(/enter an amount above zero/i)).toBeInTheDocument();
  });

  it("rejects a duplicate approver address", () => {
    const dialog = startBuilder();
    fireEvent.change(dialog.getByLabelText(/^purpose$/i), { target: { value: "Field stipend" } });
    fireEvent.change(dialog.getByLabelText(/beneficiary sui address/i), { target: { value: BENEFICIARY } });
    fireEvent.change(dialog.getByLabelText(/amount \(usdc\)/i), { target: { value: "12.5" } });
    fireEvent.change(dialog.getByLabelText("Approver 1 Sui address"), { target: { value: APPROVER_A } });
    fireEvent.click(dialog.getByRole("button", { name: /add approver/i }));
    fireEvent.change(dialog.getByLabelText("Approver 2 Sui address"), { target: { value: APPROVER_A } });
    continueToReview(dialog);
    expect(dialog.getByText(/each approver address must be unique/i)).toBeInTheDocument();
  });

  it("rejects the beneficiary as an approver", () => {
    const dialog = startBuilder();
    fireEvent.change(dialog.getByLabelText(/^purpose$/i), { target: { value: "Field stipend" } });
    fireEvent.change(dialog.getByLabelText(/beneficiary sui address/i), { target: { value: BENEFICIARY } });
    fireEvent.change(dialog.getByLabelText(/amount \(usdc\)/i), { target: { value: "12.5" } });
    fireEvent.change(dialog.getByLabelText("Approver 1 Sui address"), { target: { value: BENEFICIARY } });
    continueToReview(dialog);
    expect(dialog.getByText(/the beneficiary cannot also be an approver/i)).toBeInTheDocument();
  });
});

describe("Approval collection builder — truthful pending state", () => {
  it("prepares without a wallet and never claims submission or chain success", async () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    const dialog = openCollectionBuilder();
    fillValidDetails(dialog);
    continueToReview(dialog);

    const prepare = dialog.getByTestId("approval-collection-prepare");
    expect(prepare).toHaveTextContent(/prepare for wallet review/i);
    expect(dialog.queryByTestId("approval-collection-approve")).not.toBeInTheDocument();

    fireEvent.click(prepare);

    await waitFor(() => {
      expect(dialog.getByTestId("approval-collection-prepared")).toHaveTextContent(
        "Prepared. Not submitted.",
      );
    });
    expect(dialog.queryByRole("link", { name: /explorer/i })).not.toBeInTheDocument();
    const text = dialog.getByTestId("approval-collection-builder").textContent ?? "";
    expect(text).not.toMatch(/created|live on sui|verified|confirmed on sui|agreement submitted/i);
    expect(text).not.toContain("Confirmation pending");
    expect(dialog.getByText(/connect a sui testnet wallet/i)).toBeInTheDocument();
  });

  it("keeps the wallet decision open after preparation is revised", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    openNgoControls();
    const dialog = openCollectionBuilder();
    fillValidDetails(dialog);
    continueToReview(dialog);
    fireEvent.click(dialog.getByTestId("approval-collection-prepare"));

    fireEvent.click(dialog.getByRole("button", { name: /back to details/i }));
    expect(dialog.queryByTestId("approval-collection-prepared")).not.toBeInTheDocument();
    continueToReview(dialog);
    expect(dialog.getByTestId("approval-collection-prepare")).toBeEnabled();
    const text = dialog.getByTestId("approval-collection-builder").textContent ?? "";
    expect(text).not.toContain("Confirmation pending");
  });
});
