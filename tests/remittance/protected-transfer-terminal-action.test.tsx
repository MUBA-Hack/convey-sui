// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferCreatedVerifyResponse } from "@/lib/remittance/protected-transfer-created";
import {
  buildProtectedTransferCreatedReceipt,
  verifyProtectedTransferCreatedReceipt,
  type VerifiedProtectedTransferCreatedReceipt,
} from "@/lib/remittance/protected-transfer-created-receipt";
import type {
  ProtectedTransferTerminalVerifyRequest,
  ProtectedTransferTerminalVerifyResponse,
} from "@/lib/remittance/protected-transfer-terminal";
import {
  buildProtectedTransferTerminalReceipt,
  decodeProtectedTransferTerminalReceiptPayload,
  encodeProtectedTransferTerminalReceiptPayload,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import { buildExplorerUrl } from "@/lib/remittance/transfer";
import { loadActivity, recordActivity } from "@/lib/activity/storage";
import {
  ProtectedTransferTerminalAction,
  resolveProtectedTransferTerminalAction,
  terminalActivityItem,
} from "@/components/commerce/protected-transfer-terminal-action";

const wallet = vi.hoisted(() => ({
  account: null as { address: string } | null,
  network: "testnet" as string,
  signAndExecuteTransaction: vi.fn(),
}));
const requestTerminal = vi.hoisted(() => vi.fn());

vi.mock("@mysten/dapp-kit-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mysten/dapp-kit-react")>();
  return {
    ...actual,
    useCurrentAccount: () => wallet.account,
    useCurrentNetwork: () => wallet.network,
    useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
  };
});

vi.mock("@/lib/remittance/protected-transfer-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remittance/protected-transfer-client")>();
  return {
    ...actual,
    requestProtectedTransferTerminalVerification: requestTerminal,
  };
});

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const STRANGER = "0x" + "66".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const CREATED_DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const TERMINAL_DIGEST = "EnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eZ";
const DEADLINE = NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS;

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

function createdReceipt(): VerifiedProtectedTransferCreatedReceipt {
  const plan: ProtectedTransferExecutionPlan = {
    kind: "protected_transfer_execution_plan",
    authorization: authorization(),
    packageId: PACKAGE,
    reviewerAddress: REVIEWER,
    reviewerName: "Convey Review",
    deadlineMs: DEADLINE,
    reviewNote: "Hold until Ana confirms delivery",
  };
  const metadata = buildProtectedTransfer({ plan, sender: PAYER, nowMs: NOW }).metadata;
  const verification: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
    kind: "verified",
    network: "testnet",
    digest: CREATED_DIGEST,
    escrowObjectId: ESCROW,
    payerAddress: PAYER,
    beneficiaryAddress: BENEFICIARY,
    reviewer: { name: "Convey Review", address: REVIEWER },
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: "109000000",
    deadlineMs: DEADLINE,
    evidenceCommitmentHex: metadata.commitmentHex,
    checkedAt: new Date(NOW + 30_000).toISOString(),
  };
  const document = buildProtectedTransferCreatedReceipt({
    verification,
    plan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
  const result = verifyProtectedTransferCreatedReceipt(document);
  if (!result.ok) throw new Error("fixture must verify");
  return result;
}

function verifiedTerminal(
  request: ProtectedTransferTerminalVerifyRequest,
): Extract<ProtectedTransferTerminalVerifyResponse, { kind: "verified" }> {
  return {
    kind: "verified",
    network: "testnet",
    action: request.action,
    digest: request.digest,
    escrowObjectId: request.escrowObjectId,
    actorAddress: request.action === "release" ? request.reviewerAddress : request.payerAddress,
    payerAddress: request.payerAddress,
    beneficiaryAddress: request.beneficiaryAddress,
    reviewerAddress: request.reviewerAddress,
    coinType: USDC_COIN_TYPE_TESTNET,
    amountMicro: request.amountMicro,
    deadlineMs: request.deadlineMs,
    evidenceCommitmentHex: request.evidenceCommitmentHex,
    checkedAt: new Date(NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS + 60_000).toISOString(),
  };
}

function successResult() {
  return {
    $kind: "Transaction",
    Transaction: { digest: TERMINAL_DIGEST, status: { success: true } },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  wallet.account = { address: REVIEWER };
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  wallet.signAndExecuteTransaction.mockResolvedValue(successResult());
  requestTerminal.mockReset();
  requestTerminal.mockImplementation(async ({ request }: { request: ProtectedTransferTerminalVerifyRequest }) => ({
    response: verifiedTerminal(request),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("resolveProtectedTransferTerminalAction", () => {
  it.each([
    ["reviewer before deadline", REVIEWER, "testnet", true, DEADLINE - 1, "release"],
    ["reviewer at deadline", REVIEWER, "testnet", true, DEADLINE, "release"],
    ["reviewer after deadline", REVIEWER, "testnet", true, DEADLINE + 1, null],
    ["payer at deadline", PAYER, "testnet", true, DEADLINE, null],
    ["payer after deadline", PAYER, "testnet", true, DEADLINE + 1, "refund"],
    ["wrong role", STRANGER, "testnet", true, DEADLINE - 1, null],
    ["wrong network", REVIEWER, "mainnet", true, DEADLINE - 1, null],
    ["unverified Created", REVIEWER, "testnet", false, DEADLINE - 1, null],
    ["no wallet", null, "testnet", true, DEADLINE - 1, null],
    ["malformed wallet address", "not-an-address", "testnet", true, DEADLINE - 1, null],
  ] as const)("resolves %s", (_label, accountAddress, network, createdVerified, nowMs, expected) => {
    expect(resolveProtectedTransferTerminalAction({
      accountAddress,
      network,
      createdVerified,
      payerAddress: PAYER,
      reviewerAddress: REVIEWER,
      deadlineMs: DEADLINE,
      nowMs,
    })).toBe(expected);
  });
});

describe("ProtectedTransferTerminalAction", () => {
  it.each([
    ["wrong role", STRANGER, "testnet", true],
    ["wrong network", REVIEWER, "mainnet", true],
    ["unverified Created", REVIEWER, "testnet", false],
  ])("shows no action for %s", (_label, address, network, createdVerified) => {
    wallet.account = { address };
    wallet.network = network;
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified={createdVerified}
      nowMs={() => DEADLINE - 1}
    />);
    expect(screen.queryByTestId("protected-transfer-terminal-action")).toBeNull();
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it("shows release at the exact deadline and refund only after it", () => {
    const receipt = createdReceipt();
    const { unmount } = render(<ProtectedTransferTerminalAction
      receipt={receipt}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    expect(screen.getByRole("button", { name: "Release funds" })).toBeInTheDocument();
    unmount();
    wallet.account = { address: PAYER };
    render(<ProtectedTransferTerminalAction
      receipt={receipt}
      createdVerified
      nowMs={() => DEADLINE + 1}
    />);
    expect(screen.getByRole("button", { name: "Refund payer" })).toBeInTheDocument();
  });

  it("unlocks after a typed wallet rejection", async () => {
    const rejection = Object.assign(new Error("canceled"), {
      name: "WalletStandardError",
      context: { __code: 4_001_000 },
    });
    wallet.signAndExecuteTransaction.mockRejectedValue(rejection);
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/canceled/i));
    expect(screen.getByRole("button", { name: "Release funds" })).toBeEnabled();
    expect(requestTerminal).not.toHaveBeenCalled();
  });

  it("locks an unknown post-sign outcome and never verifies", async () => {
    wallet.signAndExecuteTransaction.mockResolvedValue({ unexpected: true });
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/outcome unknown/i));
    expect(screen.queryByRole("button", { name: "Release funds" })).toBeNull();
    expect(requestTerminal).not.toHaveBeenCalled();
  });

  it("preserves the submitted transaction without retrying a rejected result", async () => {
    requestTerminal.mockResolvedValue({
      response: { kind: "rejected", reason: "sender" },
    });
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/did not match/i));
    expect(screen.queryByRole("button", { name: "Release funds" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check outcome again" })).toBeNull();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      buildExplorerUrl(TERMINAL_DIGEST),
    );
  });

  it("requires review when confirmation names a different transaction", async () => {
    requestTerminal.mockImplementation(async ({ request }: { request: ProtectedTransferTerminalVerifyRequest }) => ({
      response: { ...verifiedTerminal(request), digest: CREATED_DIGEST },
    }));
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/did not match/i));
    expect(screen.queryByRole("button", { name: "Check outcome again" })).toBeNull();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      buildExplorerUrl(TERMINAL_DIGEST),
    );
  });

  it.each([
    ["not found", { response: { kind: "not_found" } }, /not confirmed/i],
    ["unavailable", { response: { kind: "unavailable", reason: "rpc_unavailable" } }, /temporarily unavailable/i],
    ["request failure", new Error("offline"), /temporarily unavailable/i],
  ] as const)("rechecks %s without submitting another wallet action", async (_label, outcome, copy) => {
    if (outcome instanceof Error) requestTerminal.mockRejectedValue(outcome);
    else requestTerminal.mockResolvedValue(outcome);
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(copy));
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      buildExplorerUrl(TERMINAL_DIGEST),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check outcome again" }));
    await waitFor(() => expect(requestTerminal).toHaveBeenCalledTimes(2));
    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledOnce();
    expect(requestTerminal.mock.calls[1]![0]).toEqual(requestTerminal.mock.calls[0]![0]);
  });

  it("navigates after a verification retry succeeds", async () => {
    const navigate = vi.fn();
    requestTerminal
      .mockResolvedValueOnce({ response: { kind: "not_found" } })
      .mockImplementationOnce(async ({ request }: { request: ProtectedTransferTerminalVerifyRequest }) => ({
        response: verifiedTerminal(request),
      }));
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
      navigate={navigate}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await screen.findByRole("button", { name: "Check outcome again" });
    fireEvent.click(screen.getByRole("button", { name: "Check outcome again" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(wallet.signAndExecuteTransaction).toHaveBeenCalledOnce();
    expect(requestTerminal).toHaveBeenCalledTimes(2);
    expect(requestTerminal.mock.calls[1]![0]).toEqual(requestTerminal.mock.calls[0]![0]);
    expect(navigate.mock.calls[0]![0]).toMatch(/^\/proof\?t=/);
  });

  it("builds a terminal receipt and navigates to its t proof after strict verification", async () => {
    const navigate = vi.fn();
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
      navigate={navigate}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    const url = navigate.mock.calls[0]![0] as string;
    expect(url).toMatch(/^\/proof\?t=/);
    const payload = new URL(url, "http://localhost").searchParams.get("t");
    expect(payload).not.toBeNull();
    const document = decodeProtectedTransferTerminalReceiptPayload(payload!);
    expect(document.transfer.action).toBe("release");
    expect(document.transfer.digest).toBe(TERMINAL_DIGEST);
    expect(requestTerminal).toHaveBeenCalledWith({
      request: expect.objectContaining({
        action: "release",
        digest: TERMINAL_DIGEST,
        packageId: PACKAGE,
        escrowObjectId: ESCROW,
      }),
    });
  });
});

function terminalRequestFor(action: "release" | "refund", digest: string): ProtectedTransferTerminalVerifyRequest {
  const created = createdReceipt().document;
  return {
    action,
    digest,
    packageId: created.transfer.packageId,
    escrowObjectId: created.transfer.escrowObjectId,
    payerAddress: created.transfer.payerAddress,
    beneficiaryAddress: created.transfer.beneficiaryAddress,
    reviewerAddress: created.transfer.reviewerAddress,
    amountMicro: created.transfer.amountMicro,
    deadlineMs: created.transfer.deadlineMs,
    evidenceCommitmentHex: created.transfer.evidenceCommitmentHex,
  };
}

function builtTerminalReceipt(action: "release" | "refund", digest: string) {
  const created = createdReceipt();
  const terminal = verifiedTerminal(terminalRequestFor(action, digest));
  return buildProtectedTransferTerminalReceipt({ createdReceipt: created.document, terminal });
}

describe("terminalActivityItem", () => {
  it("builds a strict release item bound to the verified terminal digest and recipient", () => {
    const doc = builtTerminalReceipt("release", TERMINAL_DIGEST);
    const payload = encodeProtectedTransferTerminalReceiptPayload(doc);
    const item = terminalActivityItem(doc, payload, "Ana");
    expect(item).toEqual({
      id: `pt-terminal:${TERMINAL_DIGEST}:release`,
      href: `/proof?t=${payload}`,
      title: "Protected Transfer",
      amountLabel: "109 USDC",
      detailLabel: "Released to Ana",
      nextOwner: "Ana",
      updatedAt: doc.terminal.checkedAt,
    });
    expect(item.href).toMatch(/^\/proof\?t=[A-Za-z0-9_-]+$/);
  });

  it("builds a refund item that says returned to payer, not released", () => {
    const doc = builtTerminalReceipt("refund", TERMINAL_DIGEST);
    const payload = encodeProtectedTransferTerminalReceiptPayload(doc);
    const item = terminalActivityItem(doc, payload, "Ana");
    expect(item.id).toBe(`pt-terminal:${TERMINAL_DIGEST}:refund`);
    expect(item.detailLabel).toBe("Returned to payer");
    expect(item.nextOwner).toBe("Payer");
  });

  it("stable id differs by outcome so release and refund do not collide", () => {
    const release = builtTerminalReceipt("release", TERMINAL_DIGEST);
    const refund = builtTerminalReceipt("refund", TERMINAL_DIGEST);
    const a = terminalActivityItem(release, "p", "Ana");
    const b = terminalActivityItem(refund, "p", "Ana");
    expect(a.id).not.toBe(b.id);
  });
});

describe("ProtectedTransferTerminalAction activity recording", () => {
  it("records one Activity item after a verified release and links the t receipt", async () => {
    const navigate = vi.fn();
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
      navigate={navigate}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    const items = loadActivity();
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.id).toBe(`pt-terminal:${TERMINAL_DIGEST}:release`);
    expect(item.href).toMatch(/^\/proof\?t=/);
    expect(item.detailLabel).toBe("Released to Ana");
    expect(item.title).toBe("Protected Transfer");
  });

  it("upserts instead of duplicating when the same verified outcome is recorded twice", async () => {
    const navigate = vi.fn();
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
      navigate={navigate}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(loadActivity()).toHaveLength(1);

    // A second verified recheck on a fresh mount re-records the same id; upsert, not duplicate.
    const doc = builtTerminalReceipt("release", TERMINAL_DIGEST);
    const payload = encodeProtectedTransferTerminalReceiptPayload(doc);
    recordActivity(terminalActivityItem(doc, payload, "Ana"));
    recordActivity(terminalActivityItem(doc, payload, "Ana"));
    const items = loadActivity();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(`pt-terminal:${TERMINAL_DIGEST}:release`);
  });

  it("records nothing for non-verified branches (not_found, unavailable, request failure)", async () => {
    requestTerminal.mockResolvedValue({ response: { kind: "not_found" } });
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/not confirmed/i));
    expect(loadActivity()).toEqual([]);

    requestTerminal.mockResolvedValue({ response: { kind: "unavailable", reason: "rpc_unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Check outcome again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/temporarily unavailable/i));
    expect(loadActivity()).toEqual([]);

    requestTerminal.mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Check outcome again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/temporarily unavailable/i));
    expect(loadActivity()).toEqual([]);
  });

  it("records nothing when verification names a different transaction", async () => {
    requestTerminal.mockImplementation(async ({ request }: { request: ProtectedTransferTerminalVerifyRequest }) => ({
      response: { ...verifiedTerminal(request), digest: CREATED_DIGEST },
    }));
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/did not match/i));
    expect(loadActivity()).toEqual([]);
  });

  it("still navigates and records nothing when localStorage is unavailable", async () => {
    const navigate = vi.fn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<ProtectedTransferTerminalAction
      receipt={createdReceipt()}
      createdVerified
      nowMs={() => DEADLINE}
      navigate={navigate}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(navigate.mock.calls[0]![0]).toMatch(/^\/proof\?t=/);
    expect(loadActivity()).toEqual([]);
  });
});
