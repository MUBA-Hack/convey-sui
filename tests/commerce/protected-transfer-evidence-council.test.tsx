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
  EvidenceCouncilArtifactSchema,
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

function readyResponseWithSpans() {
  const base = readyResponse().artifact;
  const payload: Omit<EvidenceCouncilArtifact, "artifactDigest"> = {
    version: base.version,
    advisoryOnly: base.advisoryOnly,
    evidenceTextDigest: base.evidenceTextDigest,
    createdDigest: base.createdDigest,
    escrowObjectId: base.escrowObjectId,
    recipient: base.recipient,
    purpose: base.purpose,
    youPayMinor: base.youPayMinor,
    familyReceivesMinor: base.familyReceivesMinor,
    amountMicro: base.amountMicro,
    deadlineMs: base.deadlineMs,
    createdCheckedAt: base.createdCheckedAt,
    assessedAt: base.assessedAt,
    checks: base.checks,
    corroboratedFacts: [
      {
        id: "recipient",
        evidence: [
          { id: "recipient", start: 0, end: 3, text: "Ana" },
          { id: "recipient", start: 0, end: 3, text: "Ana" },
        ],
      },
      {
        id: "amount",
        evidence: [
          { id: "amount", start: 12, end: 24, text: "PHP 6,104.00" },
          { id: "amount", start: 12, end: 24, text: "PHP 6,104.00" },
        ],
      },
      {
        id: "purpose",
        evidence: [
          { id: "purpose", start: 29, end: 44, text: "school supplies" },
          { id: "purpose", start: 29, end: 44, text: "school supplies" },
        ],
      },
    ],
    disputedFacts: base.disputedFacts,
    questionIds: base.questionIds,
    reviews: base.reviews,
  };
  return {
    kind: "ready_for_human_review",
    advisoryOnly: true,
    artifact: {
      ...payload,
      artifactDigest: computeEvidenceCouncilArtifactDigest(payload),
    },
  };
}

async function submitEvidence(response: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));
  render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
  fireEvent.change(screen.getByLabelText(/Evidence text/i), {
    target: { value: "Ana received PHP 6,104.00 for school supplies." },
  });
  fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));
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

  it("clears a completed decision when the evidence text changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(readyResponse()));
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    const evidence = screen.getByLabelText(/Evidence text/i);
    fireEvent.change(evidence, {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));
    await waitFor(() => expect(screen.getByText(/Details line up/i)).toBeInTheDocument());

    fireEvent.change(evidence, { target: { value: "Different evidence" } });

    expect(screen.queryByText(/Details line up/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy record/i })).not.toBeInTheDocument();
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

  it("shows the three bounded checking steps while the review is running", async () => {
    let resolveReview: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveReview = resolve; }),
    );
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.change(screen.getByLabelText(/Evidence text/i), {
      target: { value: "Ana received PHP 6,104.00 for school supplies." },
    });
    fireEvent.click(screen.getByRole("button", { name: /check evidence/i }));

    await waitFor(() =>
      expect(screen.getByText(/Re-checking the Created receipt on Sui/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Reading the evidence with two independent reviews/i)).toBeInTheDocument();
    expect(screen.getByText(/Comparing exact terms with the agreement/i)).toBeInTheDocument();

    resolveReview(jsonResponse(readyResponse()));
  });

  it("fills the expected evidence example from receipt terms without submitting", () => {
    render(<ProtectedTransferEvidenceCouncil receipt={receipt()} />);
    fireEvent.click(screen.getByRole("button", { name: /use expected evidence example/i }));

    expect(screen.getByLabelText(/Evidence text/i)).toHaveValue(
      "Received PHP 6,104.00 for Ana for school supplies.",
    );
    expect(screen.getByTestId("protected-transfer-evidence-example-tag")).toHaveTextContent(
      /example/i,
    );
    expect(screen.getByTestId("protected-transfer-evidence-example-note")).toHaveTextContent(
      /example/i,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("shows exact matched spans next to each verified term", async () => {
    await submitEvidence(readyResponseWithSpans());

    await waitFor(() => expect(screen.getByText(/Ready for your decision/i)).toBeInTheDocument());
    expect(screen.getByTestId("protected-transfer-evidence-term-recipient")).toHaveTextContent(
      "Exact match found",
    );
    expect(screen.getByTestId("protected-transfer-evidence-corroborated-recipient")).toHaveTextContent(
      "Ana",
    );
    expect(screen.getByTestId("protected-transfer-evidence-term-amount")).toHaveTextContent(
      "PHP 6,104.00",
    );
    expect(screen.getByTestId("protected-transfer-evidence-corroborated-amount")).toHaveTextContent(
      "PHP 6,104.00",
    );
    expect(
      screen.getByTestId("protected-transfer-evidence-corroborated-purpose"),
    ).toHaveTextContent("school supplies");
  });

  it("leads clarification outcomes and hides artifact actions when no artifact exists", async () => {
    await submitEvidence(questionsResponse());

    await waitFor(() => expect(screen.getByText(/Needs clarification/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /copy record/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download record/i })).not.toBeInTheDocument();
  });

  it("shows could not verify for unavailable outcomes without artifact actions", async () => {
    await submitEvidence({ kind: "unavailable", advisoryOnly: true, reason: "provider_error" });

    await waitFor(() => expect(screen.getByText(/Could not verify/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /copy record/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download record/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-transfer-evidence-provenance")).not.toBeInTheDocument();
  });

  it("copies and downloads a schema-valid advisory artifact with a recomputable digest", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    try {
      const expectedArtifact = readyResponse().artifact;
      await submitEvidence(readyResponse());
      await waitFor(() => expect(screen.getByText(/Details line up/i)).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /copy record/i }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^copied$/i })).toBeInTheDocument(),
      );
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
      const copiedJson = clipboardWrite.mock.calls[0]?.[0];
      if (typeof copiedJson !== "string") {
        throw new Error("Clipboard received no artifact JSON.");
      }
      const copiedArtifact = EvidenceCouncilArtifactSchema.parse(JSON.parse(copiedJson));
      const { artifactDigest, ...payload } = copiedArtifact;
      expect(computeEvidenceCouncilArtifactDigest(payload)).toBe(artifactDigest);
      expect(artifactDigest).toBe(expectedArtifact.artifactDigest);

      fireEvent.click(screen.getByRole("button", { name: /download record/i }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const downloadedBlob = createObjectURL.mock.calls[0]?.[0];
      if (downloadedBlob === undefined) {
        throw new Error("Download received no blob.");
      }
      await expect(downloadedBlob.text()).resolves.toBe(copiedJson);
      const anchor = clickSpy.mock.contexts[0];
      if (!(anchor instanceof HTMLAnchorElement)) {
        throw new Error("Download did not click an anchor element.");
      }
      expect(anchor.download).toMatch(/^convey-evidence-council-[0-9a-f]{12}\.json$/);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    } finally {
      clickSpy.mockRestore();
      Reflect.deleteProperty(window.navigator, "clipboard");
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("states the exact advisory boundary inside the provenance disclosure", async () => {
    await submitEvidence(readyResponse());

    await waitFor(() => expect(screen.getByText(/Details line up/i)).toBeInTheDocument());
    expect(
      screen.getByTestId("protected-transfer-evidence-advisory-boundary"),
    ).toHaveTextContent(/cannot release funds/i);
    expect(
      screen.getByTestId("protected-transfer-evidence-advisory-boundary"),
    ).toHaveTextContent("Convey Review");
  });
});
