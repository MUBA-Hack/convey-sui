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

  it("searches current reporting and renders only server-grounded clickable sources", async () => {
    const report = {
      kind: "verified_report",
      source: { kind: "text", label: "Pasted text" },
      primaryClaim: "What is known about the recent Nepal earthquake?",
      claimType: "factual",
      truthScore: 79,
      verdict: "supported",
      consensus: { status: "aligned", scoreSpread: 6 },
      reasoningTrace: [
        { reviewer: "review_a", text: "Current reporting describes the event." },
        { reviewer: "review_a", text: "Location is explicit." },
        { reviewer: "review_b", text: "A second publisher corroborates it." },
        { reviewer: "review_b", text: "Early estimates may change." },
      ],
      evidence: [
        { reviewer: "review_a", text: "An earthquake struck Nepal on Thursday." },
        { reviewer: "review_b", text: "Emergency agencies issued an update." },
      ],
      limitations: ["Early reports may change."],
      steps: [
        { step: "claim_extraction", requestId: "web-extract", modelId: "model-a", latencyMs: 20 },
        { step: "review_a", requestId: "web-review-a", modelId: "model-a", latencyMs: 24 },
        { step: "review_b", requestId: "web-review-b", modelId: "model-b", latencyMs: 29 },
      ],
      assessedAt: "2026-09-04T06:00:00.000Z",
    };
    const response = {
      kind: "web_verified_report",
      query: "What is known about the recent Nepal earthquake?",
      searchWindow: "30d",
      searchedAt: "2026-09-04T06:00:00.000Z",
      report,
      sources: [
        {
          id: "source-1",
          url: "https://news-one.example.org/nepal",
          host: "news-one.example.org",
          title: "Nepal earthquake update",
          publishedAt: "2026-09-04T05:00:00.000Z",
          snippet: "An earthquake struck Nepal on Thursday.",
        },
        {
          id: "source-2",
          url: "https://news-two.example.net/nepal",
          host: "news-two.example.net",
          title: "Regional emergency update",
          publishedAt: null,
          snippet: "Emergency agencies issued an update.",
        },
      ],
      citations: [
        {
          sourceId: "source-1",
          url: "https://news-one.example.org/nepal",
          title: "Nepal earthquake update",
          quote: "An earthquake struck Nepal on Thursday.",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /search web/i }));
    fireEvent.click(screen.getByRole("button", { name: /run independent checks/i }));

    await waitFor(() => expect(screen.getByText("Current sources")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Nepal earthquake update/i })).toHaveAttribute(
      "href",
      "https://news-one.example.org/nepal",
    );
    expect(screen.getByRole("link", { name: /Regional emergency update/i })).toHaveAttribute(
      "href",
      "https://news-two.example.net/nepal",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/verification/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows web-search progress and a recoverable unavailable state", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /search web/i }));
    fireEvent.click(screen.getByRole("button", { name: /run independent checks/i }));
    expect(screen.getByText("Current evidence is being gathered.")).toBeInTheDocument();

    resolveFetch(new Response(JSON.stringify({
      kind: "web_verification_unavailable",
      reason: "search_unavailable",
    })));
    await waitFor(() => expect(screen.getByText(/Current web search is unavailable/i)).toBeInTheDocument());
    expect(screen.getByText("Review interrupted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retries a provider failure without losing the claim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "unavailable", reason: "provider_error" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /run independent checks/i }));
    await waitFor(() => expect(screen.getByText("Review interrupted.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Claim or passage") as HTMLTextAreaElement).value).toMatch(
      /42 water filters/i,
    );
  });
});
