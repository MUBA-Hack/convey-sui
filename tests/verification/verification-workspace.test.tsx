// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerificationWorkspace } from "@/components/verification/verification-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VerificationWorkspace", () => {
  it("switches between text and public-link input without preserving stale content", () => {
    render(<VerificationWorkspace />);

    const claimInput = screen.getByLabelText("Claim or passage") as HTMLTextAreaElement;
    expect(claimInput.value).toMatch(/water filters/i);
    fireEvent.click(screen.getByRole("button", { name: /public link/i }));

    expect(screen.getByLabelText("Public page URL")).toHaveValue("");
    expect(screen.getByRole("button", { name: /public link/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders score, separate reasoning, and exact Gonka request ids", async () => {
    const response = {
      kind: "verified_report",
      source: { kind: "text", label: "Pasted text" },
      primaryClaim: "The relief fund paid for 42 water filters.",
      claimType: "factual",
      truthScore: 84,
      verdict: "supported",
      consensus: { status: "aligned", scoreSpread: 8 },
      reasoningTrace: [
        { reviewer: "review_a", text: "The supplied report names the purchase." },
        { reviewer: "review_a", text: "The quantity is explicit." },
        { reviewer: "review_b", text: "The stated use matches the claim." },
        { reviewer: "review_b", text: "Independent proof remains limited." },
      ],
      evidence: [
        { reviewer: "review_a", text: "42 water filters" },
        { reviewer: "review_b", text: "relief fund" },
      ],
      limitations: ["The audit attachment is not included."],
      steps: [
        { step: "claim_extraction", requestId: "gonka-extract-41", modelId: "model-a", latencyMs: 20 },
        { step: "review_a", requestId: "gonka-review-a-42", modelId: "model-a", latencyMs: 24 },
        { step: "review_b", requestId: "gonka-review-b-43", modelId: "model-b", latencyMs: 29 },
      ],
      assessedAt: "2026-09-04T06:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /run independent checks/i }));

    await waitFor(() => expect(screen.getByText("84")).toBeInTheDocument());
    expect(screen.getByText("Supported")).toBeInTheDocument();
    expect(screen.getByText("Review A")).toBeInTheDocument();
    expect(screen.getByText("Review B")).toBeInTheDocument();
    expect(screen.getByText("gonka-extract-41")).toBeInTheDocument();
    expect(screen.getByText("gonka-review-a-42")).toBeInTheDocument();
    expect(screen.getByText("gonka-review-b-43")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/verify",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
