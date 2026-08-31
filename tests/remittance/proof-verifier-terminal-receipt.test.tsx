// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProofVerifier } from "@/components/commerce/proof-verifier";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferCreatedVerifyResponse } from "@/lib/remittance/protected-transfer-created";
import { buildProtectedTransferCreatedReceipt } from "@/lib/remittance/protected-transfer-created-receipt";
import type { ProtectedTransferOpenResponse } from "@/lib/remittance/protected-transfer-open";
import type { ProtectedTransferTerminalVerifyResponse } from "@/lib/remittance/protected-transfer-terminal";
import {
  buildProtectedTransferTerminalReceipt,
  encodeProtectedTransferTerminalReceiptPayload,
  type ProtectedTransferTerminalReceiptDocument,
} from "@/lib/remittance/protected-transfer-terminal-receipt";

const { resolveLifecycle } = vi.hoisted(() => ({ resolveLifecycle: vi.fn() }));

vi.mock("@/lib/remittance/protected-transfer-terminal-lifecycle", () => ({
  resolveProtectedTransferTerminalLifecycle: resolveLifecycle,
}));

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const CREATED_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const RELEASE_DIGEST = "EnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eZ";
const REFUND_DIGEST = "FnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9ea";

function authorization(): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: BENEFICIARY,
    usdcMicro: "109000000",
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: "R-ABCD1234",
    issuedAt: NOW,
    expiresAt: NOW + 120_000,
    corridor: { source: "MYR", destination: "PHP" },
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    totalFeeMinor: "950",
    myrPerUsdc: "450",
    phpPerUsdc: "5600",
    fixedFeeMyr: "200",
    feeBps: 150,
    recipient: "Ana",
    destinationCity: "manila",
    purpose: "school supplies",
    maximumFamilyLimitMinor: "52000",
  };
}

function plan(): ProtectedTransferExecutionPlan {
  return {
    kind: "protected_transfer_execution_plan",
    authorization: authorization(),
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    reviewerName: "Convey Review",
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
    reviewNote: "Hold until Ana confirms delivery",
  };
}

function receipt(action: "release" | "refund" = "release"): ProtectedTransferTerminalReceiptDocument {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const created: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
    kind: "verified",
    network: "testnet",
    digest: CREATED_DIGEST,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewer: { name: "Convey Review", address: REVIEWER },
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "109000000",
    deadlineMs: executionPlan.deadlineMs,
    evidenceCommitmentHex: metadata.commitmentHex,
    checkedAt: new Date(NOW + 30_000).toISOString(),
  };
  const createdReceipt = buildProtectedTransferCreatedReceipt({
    verification: created,
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
  const terminal: Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }> = {
    kind: "verified",
    network: "testnet",
    action,
    digest: action === "release" ? RELEASE_DIGEST : REFUND_DIGEST,
    escrowObjectId: ESCROW,
    actorAddress: action === "release" ? REVIEWER : PAYER,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewerAddress: REVIEWER,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "109000000",
    deadlineMs: executionPlan.deadlineMs,
    evidenceCommitmentHex: metadata.commitmentHex,
    checkedAt: new Date(NOW + 90_000).toISOString(),
  };
  return buildProtectedTransferTerminalReceipt({
    createdReceipt,
    terminal,
    exportedAt: new Date(NOW + 120_000).toISOString(),
  });
}

function openReceipt(document: ProtectedTransferTerminalReceiptDocument) {
  const payload = encodeProtectedTransferTerminalReceiptPayload(document);
  window.history.replaceState({}, "", `/?t=${payload}`);
}

function liveOpen(document: ProtectedTransferTerminalReceiptDocument): Extract<
  ProtectedTransferOpenResponse,
  { kind: "open" }
> {
  return {
    kind: "open",
    network: "testnet",
    escrowObjectId: document.transfer.escrowObjectId,
    packageId: document.transfer.packageId,
    payerAddress: document.transfer.payerAddress,
    beneficiaryAddress: document.transfer.beneficiaryAddress,
    reviewerAddress: document.transfer.reviewerAddress,
    coinType: document.transfer.coinType,
    amountMicro: document.transfer.amountMicro,
    deadlineMs: document.transfer.deadlineMs,
    evidenceCommitmentHex: document.transfer.evidenceCommitmentHex,
    heldBalanceMicro: document.transfer.amountMicro,
    checkedAt: new Date(NOW + 150_000).toISOString(),
  };
}

beforeEach(() => {
  resolveLifecycle.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("ProofVerifier — Protected Transfer terminal receipt", () => {
  it("hydrates a t receipt and stays neutral while the live lifecycle is checking", async () => {
    resolveLifecycle.mockImplementation(() => new Promise(() => {}));
    openReceipt(receipt());
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-terminal-result")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(/checking the transfer outcome/i);
    expect(screen.getByTestId("protected-transfer-terminal-stage")).toHaveTextContent("109");
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export receipt/i })).toBeNull();
  });

  it.each([
    ["release" as const, /money released/i, /release confirmed on sui/i],
    ["refund" as const, /money refunded/i, /refund confirmed on sui/i],
  ])("shows a freshly verified %s outcome and unlocks receipt actions", async (action, title, status) => {
    const document = receipt(action);
    resolveLifecycle.mockResolvedValue({
      kind: "verified",
      created: document.created.created,
      terminal: document.terminal,
      receipt: document,
    });
    openReceipt(document);
    render(<ProofVerifier />);

    await waitFor(() => expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(title));
    expect(screen.getByTestId("protected-transfer-terminal-status")).toHaveTextContent(status);
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export receipt/i })).toBeInTheDocument();
  });

  it("shows still protected only for the lifecycle pending result", async () => {
    const document = receipt();
    resolveLifecycle.mockResolvedValue({
      kind: "pending",
      created: document.created.created,
      open: liveOpen(document),
    });
    openReceipt(document);
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(/still protected/i),
    );
    expect(screen.getByTestId("protected-transfer-terminal-status")).toHaveTextContent(/still protected/i);
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
  });

  it.each([
    [{ kind: "rejected", reason: "mismatch" }, /needs review/i],
    [{ kind: "unavailable" }, /status unavailable/i],
  ])("shows an honest retry state for $kind", async (lifecycle, title) => {
    openReceipt(receipt());
    resolveLifecycle.mockResolvedValue(lifecycle);
    render(<ProofVerifier />);

    await waitFor(() => expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(title));
    expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.getByTestId("protected-transfer-terminal-stage")).not.toHaveTextContent(
      /while the live check/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(resolveLifecycle).toHaveBeenCalledTimes(2);
  });

  it("keeps canonical terminal evidence under Advanced details", async () => {
    const document = receipt();
    resolveLifecycle.mockResolvedValue({
      kind: "verified",
      created: document.created.created,
      terminal: document.terminal,
      receipt: document,
    });
    openReceipt(document);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(/money released/i));

    expect(screen.queryByTestId("protected-transfer-terminal-technical")).toBeNull();
    expect(screen.getByTestId("protected-transfer-terminal-details")).toHaveClass(
      "grid-cols-2",
      "sm:grid-cols-3",
    );
    fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
    expect(screen.getByTestId("protected-transfer-terminal-technical")).toHaveTextContent(RELEASE_DIGEST);
  });
});
