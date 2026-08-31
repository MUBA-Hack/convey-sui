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
import {
  PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM,
  buildProtectedTransferCreatedReceipt,
  encodeProtectedTransferCreatedReceiptPayload,
} from "@/lib/remittance/protected-transfer-created-receipt";

const NOW = 1_700_000_000_000;
const PAYER = "0x" + "22".repeat(32);
const BENEFICIARY = "0x" + "11".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const ESCROW = "0x" + "55".repeat(32);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";

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

function verifiedResponse(): Extract<
  ProtectedTransferCreatedVerifyResponse,
  { kind: "verified" }
> {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  return {
    kind: "verified",
    network: "testnet",
    digest: DIGEST,
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
}

function createdReceiptJson(): string {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const doc = buildProtectedTransferCreatedReceipt({
    verification: verifiedResponse(),
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
  return JSON.stringify(doc, null, 2);
}

function loadCreatedReceiptViaUrl() {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const doc = buildProtectedTransferCreatedReceipt({
    verification: verifiedResponse(),
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
  const payload = encodeProtectedTransferCreatedReceiptPayload(doc);
  window.history.replaceState({}, "", `/?${PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM}=${payload}`);
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(verifiedResponse())));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
}

describe("ProofVerifier — Protected Transfer Created receipt truth copy", () => {
  it("stays neutral while the Created event is being checked: no Held/Awaiting/locked headline", async () => {
    let resolveCheck: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveCheck = resolve; }));
    loadCreatedReceiptViaUrl();
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-result")).toBeInTheDocument(),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    // Neutral eyebrow + subline only — no Held/Awaiting/locked claim.
    expect(stage).toHaveTextContent(/Family review receipt/i);
    expect(stage).toHaveTextContent(/Reviewer: Convey Review/i);
    expect(stage.textContent ?? "").not.toMatch(/Held for/i);
    expect(stage.textContent ?? "").not.toMatch(/Awaiting/i);
    const result = screen.getByTestId("protected-transfer-created-result");
    expect(result.textContent ?? "").not.toMatch(/locked in escrow/i);
    // Page heading/intro stay neutral — no "held" or "this hold" claim.
    const title = screen.getByTestId("receipt-page-title");
    const intro = screen.getByTestId("receipt-page-intro");
    expect(title).toHaveTextContent(/Checking this family review receipt/i);
    expect(intro).toHaveTextContent(/proposed hold was created on Sui/i);
    expect(title.textContent ?? "").not.toMatch(/held/i);
    expect(title.textContent ?? "").not.toMatch(/this hold/i);
    expect(intro.textContent ?? "").not.toMatch(/held amount/i);
    expect(intro.textContent ?? "").not.toMatch(/this hold/i);
    // Explorer CTA uses neutral "Inspect transaction" wording.
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^view transaction$/i })).toBeNull();
    // No share/export while unverified.
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();

    resolveCheck(jsonResponse(verifiedResponse()));
  });

  it("stays neutral when the Created check is rejected: no Held/Awaiting/locked, keeps status + retry", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ kind: "rejected", reason: "amount" })),
    );
    loadCreatedReceiptViaUrl();
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-status")).toHaveTextContent(
        /did not match/i,
      ),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    expect(stage).toHaveTextContent(/Family review receipt/i);
    expect(stage.textContent ?? "").not.toMatch(/Held for/i);
    expect(stage.textContent ?? "").not.toMatch(/Awaiting/i);
    const result = screen.getByTestId("protected-transfer-created-result");
    expect(result.textContent ?? "").not.toMatch(/locked in escrow/i);
    // Page heading/intro stay neutral — no "held" or "this hold" claim.
    const title = screen.getByTestId("receipt-page-title");
    const intro = screen.getByTestId("receipt-page-intro");
    expect(title).toHaveTextContent(/This family review receipt needs review/i);
    expect(intro).toHaveTextContent(/proposed amount below/i);
    expect(title.textContent ?? "").not.toMatch(/held/i);
    expect(title.textContent ?? "").not.toMatch(/this hold/i);
    expect(intro.textContent ?? "").not.toMatch(/held amount/i);
    expect(intro.textContent ?? "").not.toMatch(/this hold/i);
    // Status line and retry control remain visible.
    expect(screen.getByTestId("protected-transfer-created-status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-check on sui/i })).toBeInTheDocument();
    // Explorer CTA stays neutral.
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^view transaction$/i })).toBeNull();
    // No share/export while unverified.
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
  });

  it("stays neutral for not_found and unavailable checks and keeps retry", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ kind: "not_found", reason: "transaction_not_found" })),
    );
    loadCreatedReceiptViaUrl();
    render(<ProofVerifier />);
    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-status")).toHaveTextContent(
        /not found/i,
      ),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    expect(stage.textContent ?? "").not.toMatch(/Held for/i);
    expect(stage.textContent ?? "").not.toMatch(/Awaiting/i);
    // not_found page heading/intro stay neutral.
    const title = screen.getByTestId("receipt-page-title");
    const intro = screen.getByTestId("receipt-page-intro");
    expect(title).toHaveTextContent(/This family review receipt needs review/i);
    expect(intro).toHaveTextContent(/proposed amount below/i);
    expect(title.textContent ?? "").not.toMatch(/held/i);
    expect(title.textContent ?? "").not.toMatch(/this hold/i);
    expect(intro.textContent ?? "").not.toMatch(/held amount/i);
    expect(intro.textContent ?? "").not.toMatch(/this hold/i);
    expect(screen.getByRole("button", { name: /re-check on sui/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();
  });

  it("stays neutral for an unavailable check and keeps retry", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ kind: "unavailable", reason: "rpc_unavailable" })),
    );
    loadCreatedReceiptViaUrl();
    render(<ProofVerifier />);
    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-status")).toHaveTextContent(
        /unavailable/i,
      ),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    expect(stage.textContent ?? "").not.toMatch(/Held for/i);
    expect(stage.textContent ?? "").not.toMatch(/Awaiting/i);
    const title = screen.getByTestId("receipt-page-title");
    const intro = screen.getByTestId("receipt-page-intro");
    expect(title).toHaveTextContent(/Family review status unavailable/i);
    expect(intro).toHaveTextContent(/proposed amount below/i);
    expect(title.textContent ?? "").not.toMatch(/held/i);
    expect(title.textContent ?? "").not.toMatch(/this hold/i);
    expect(intro.textContent ?? "").not.toMatch(/held amount/i);
    expect(intro.textContent ?? "").not.toMatch(/this hold/i);
    expect(screen.getByRole("button", { name: /re-check on sui/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();
  });

  it("promotes to Held/Awaiting/locked copy only after a verified Created response", async () => {
    loadCreatedReceiptViaUrl();
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-status")).toHaveTextContent(
        /Hold confirmed on Sui/i,
      ),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    expect(stage).toHaveTextContent(/Held for family review/i);
    expect(stage).toHaveTextContent(/Awaiting Convey Review/);
    expect(stage).toHaveTextContent(/review/i);
    expect(screen.getByTestId("protected-transfer-evidence-council")).toBeInTheDocument();
    expect(screen.getByText(/Check the evidence\. Keep the decision human\./i)).toBeInTheDocument();
    const result = screen.getByTestId("protected-transfer-created-result");
    expect(result).toHaveTextContent(/locked in escrow/i);
    // Verified page heading retains the Hold confirmed claim.
    const title = screen.getByTestId("receipt-page-title");
    expect(title).toHaveTextContent(/Hold confirmed on Sui/i);
    // Verified explorer CTA upgrades to "View transaction".
    expect(screen.getByRole("link", { name: /view transaction/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /inspect transaction/i })).toBeNull();
    // Share/export unlock after verification.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /export proof/i })).toBeInTheDocument();
  });

  it("also stays neutral when the Created receipt is pasted via Advanced details", async () => {
    let resolveCheck: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveCheck = resolve; }));
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: createdReceiptJson() } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    await waitFor(() =>
      expect(screen.getByTestId("protected-transfer-created-result")).toBeInTheDocument(),
    );
    const stage = screen.getByTestId("protected-transfer-created-stage");
    expect(stage).toHaveTextContent(/Family review receipt/i);
    expect(stage.textContent ?? "").not.toMatch(/Held for/i);
    expect(stage.textContent ?? "").not.toMatch(/Awaiting/i);
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();

    resolveCheck(jsonResponse(verifiedResponse()));
  });
});
