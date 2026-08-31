// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProtectedTransferEvidenceCouncil } from "@/components/commerce/protected-transfer-evidence-council";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import type { CanonicalAuthorization } from "@/lib/remittance/quote-schema";
import {
  PROTECTED_TRANSFER_DEADLINE_MIN_MS,
  buildProtectedTransfer,
  type ProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import type { ProtectedTransferCreatedVerifyResponse } from "@/lib/remittance/protected-transfer-created";
import { buildProtectedTransferCreatedReceipt } from "@/lib/remittance/protected-transfer-created-receipt";
import {
  computeEvidenceCouncilArtifactDigest,
  type EvidenceCouncilArtifact,
} from "@/lib/remittance/evidence-council-client";

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

function receipt() {
  const executionPlan = plan();
  const metadata = buildProtectedTransfer({
    plan: executionPlan,
    sender: PAYER,
    nowMs: NOW,
  }).metadata;
  const verification: Extract<ProtectedTransferCreatedVerifyResponse, { kind: "verified" }> = {
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
  return buildProtectedTransferCreatedReceipt({
    verification,
    plan: executionPlan,
    metadata,
    exportedAt: new Date(NOW + 60_000).toISOString(),
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function readyResponse() {
  const artifactPayload: Omit<EvidenceCouncilArtifact, "artifactDigest"> = {
    version: "convey.evidence-council.v1",
    advisoryOnly: true,
    evidenceTextDigest: "0x" + "22".repeat(32),
    createdDigest: DIGEST,
    escrowObjectId: ESCROW,
    recipient: "Ana",
    purpose: "school supplies",
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    amountMicro: "109000000",
    deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_MIN_MS,
    createdCheckedAt: new Date(NOW + 30_000).toISOString(),
    assessedAt: new Date(NOW + 90_000).toISOString(),
    checks: [
      { id: "recipient", status: "matched" },
      { id: "amount", status: "matched" },
      { id: "purpose", status: "matched" },
    ],
    corroboratedFacts: [
      {
        id: "recipient",
        evidence: [
          { id: "recipient", start: 0, end: 3, text: "Ana" },
          { id: "recipient", start: 0, end: 3, text: "Ana" },
        ],
      },
    ],
    disputedFacts: [],
    questionIds: [],
    reviews: [
      { reviewer: "review_a", requestId: "request-a", responseModel: "provider/model-a" },
      { reviewer: "review_b", requestId: "request-b", responseModel: "provider/model-b" },
    ],
  };
  return {
    kind: "ready_for_human_review",
    advisoryOnly: true,
    artifact: {
      ...artifactPayload,
      artifactDigest: computeEvidenceCouncilArtifactDigest(artifactPayload),
    },
  };
}

function questionsResponse() {
  return {
    kind: "questions_needed",
    advisoryOnly: true,
    reason: "partial_review",
    artifact: null,
    questionIds: ["confirm_recipient", "confirm_amount"],
  };
}

function disputedResponse() {
  return {
    kind: "disputed",
    advisoryOnly: true,
    artifact: readyResponse().artifact,
    questionIds: ["confirm_purpose"],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProtectedTransferEvidenceCouncil", () => {
  it("starts empty and sends the created receipt plus typed evidence on submit", async () => {
    const fetchMock = vi.mocked(fetch);
    let resolveReview: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveReview = resolve; }),
    );

    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^checking$/i })).toBeDisabled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/remittance/protected-transfer/evidence");
    expect(init && typeof init === "object" ? (init as RequestInit).body : "").toEqual(
      JSON.stringify({
        createdReceipt: receipt(),
        evidenceText: "Ana received PHP 6,104.00 for school supplies.",
      }),
    );
    resolveReview(jsonResponse(readyResponse()));
  });

  it("renders ready-for-human-review with corroborated facts and provenance", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(readyResponse()));
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));

    await waitFor(() => expect(screen.getByText(/Details line up/i)).toBeInTheDocument());
    expect(screen.getByTestId("protected-transfer-evidence-corroborated-recipient")).toHaveTextContent(
      /Ana/,
    );
    expect(screen.getByTestId("protected-transfer-evidence-provenance-0")).toHaveTextContent(
      /provider\/model-a/,
    );
    expect(screen.getByText(/provider\/model-b/)).toBeInTheDocument();
    expect(screen.getByText(/You still decide whether to release/i)).toBeInTheDocument();
  });

  it("renders questions_needed with fixed reviewer questions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(questionsResponse()));
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));

    await waitFor(() => expect(screen.getByText(/Check these details/i)).toBeInTheDocument());
    expect(screen.getByText(/Confirm the recipient/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirm the amount/i)).toBeInTheDocument();
  });

  it("renders disputed evidence with provenance and disagreement copy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(disputedResponse()));
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));

    await waitFor(() => expect(screen.getByText(/Reviews disagree/i)).toBeInTheDocument());
    expect(screen.getByTestId("protected-transfer-evidence-provenance-0")).toHaveTextContent(
      /provider\/model-a/,
    );
  });

  it("renders unavailable and rejected states honestly", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ kind: "unavailable", advisoryOnly: true, reason: "provider_error" }))
      .mockResolvedValueOnce(jsonResponse({ kind: "rejected", advisoryOnly: true, reason: "created_not_verified" }));

    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));
    await waitFor(() => expect(screen.getByText(/Couldn’t check right now/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Evidence text/i), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));
    await waitFor(() => expect(screen.getByText(/This hold can’t be checked/i)).toBeInTheDocument());
  });
});
