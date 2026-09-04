import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setWebVerificationDependenciesForTest,
  POST,
} from "@/app/api/verification/search/route";
import {
  classifySearchWindow,
  safeSearchResultUrl,
  searchCurrentWeb,
} from "@/lib/verification/gdelt-search.server";
import {
  groundReportCitations,
  relevantExcerpt,
  type ReadableEvidenceSource,
} from "@/lib/verification/web-verification.server";
import { WebVerificationResponseSchema } from "@/lib/verification/web-evidence";
import type { ClaimVerificationReport } from "@/lib/verification/claim-report";

const QUERY = "What is known about the recent Nepal earthquake?";

function request(body: unknown): Request {
  return new Request("http://localhost/api/verification/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function report(evidence: string): ClaimVerificationReport {
  return {
    kind: "verified_report",
    source: { kind: "text", label: "Pasted text" },
    primaryClaim: QUERY,
    claimType: "factual",
    truthScore: 82,
    verdict: "supported",
    consensus: { status: "aligned", scoreSpread: 4 },
    reasoningTrace: [
      { reviewer: "review_a", text: "Two current reports describe the same event." },
      { reviewer: "review_a", text: "The time and place are explicit." },
      { reviewer: "review_b", text: "Independent reporting corroborates the event." },
      { reviewer: "review_b", text: "Early magnitude estimates may change." },
    ],
    evidence: [
      { reviewer: "review_a", text: evidence },
      { reviewer: "review_b", text: evidence },
    ],
    limitations: ["Early reports may be revised."],
    steps: [
      { step: "claim_extraction", requestId: "request-search-extract", modelId: "model-a", latencyMs: 20 },
      { step: "review_a", requestId: "request-search-a", modelId: "model-a", latencyMs: 21 },
      { step: "review_b", requestId: "request-search-b", modelId: "model-b", latencyMs: 22 },
    ],
    assessedAt: "2026-09-04T12:00:00.000Z",
  };
}

afterEach(() => {
  __setWebVerificationDependenciesForTest(null);
  vi.restoreAllMocks();
});

describe("current web query policy", () => {
  it("classifies changing event questions into the recent search window", () => {
    expect(classifySearchWindow("latest Nepal earthquake")).toBe("30d");
    expect(classifySearchWindow("History of remittance policy")).toBe("3m");
  });

  it("allows only public-looking HTTPS result URLs before the DNS-safe reader", () => {
    expect(safeSearchResultUrl("https://news.example.org/story")?.hostname).toBe("news.example.org");
    for (const url of [
      "http://news.example.org/story",
      "https://localhost/story",
      "https://10.0.0.2/story",
      "https://user:pass@news.example.org/story",
      "file:///tmp/story",
    ]) expect(safeSearchResultUrl(url)).toBeNull();
  });

  it("strictly validates, normalizes, and de-duplicates search results by host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      articles: [
        { url: "https://first.example.org/a#fragment", title: "  First report  ", seendate: "20260904T120000Z" },
        { url: "https://first.example.org/b", title: "Duplicate host" },
        { url: "https://second.example.net/b", title: "Second report", seendate: "bad-date" },
        { url: "http://unsafe.example.com/c", title: "Unsafe" },
      ],
    }), { headers: { "content-type": "application/json" } }));

    const results = await searchCurrentWeb(QUERY, { limit: 6, searchWindow: "30d" }, { fetch: fetchImpl });

    expect(results).toEqual([
      {
        url: "https://first.example.org/a",
        host: "first.example.org",
        title: "First report",
        publishedAt: "2026-09-04T12:00:00.000Z",
      },
      {
        url: "https://second.example.net/b",
        host: "second.example.net",
        title: "Second report",
        publishedAt: null,
      },
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("sourcelang%3Aenglish");
  });
});

describe("citation grounding", () => {
  it("keeps only quotes found in server-opened sources and removes duplicates", () => {
    const evidence = "A magnitude 6.5 earthquake struck Nepal on Thursday.";
    const sources: ReadableEvidenceSource[] = [
      {
        public: {
          id: "source-1",
          url: "https://one.example.org/report",
          host: "one.example.org",
          title: "Nepal event report",
          publishedAt: null,
          snippet: evidence,
        },
        text: `Nepal event report ${evidence}`,
      },
      {
        public: {
          id: "source-2",
          url: "https://two.example.net/report",
          host: "two.example.net",
          title: "Regional report",
          publishedAt: null,
          snippet: "Emergency agencies issued an update.",
        },
        text: "Regional report Emergency agencies issued an update.",
      },
    ];

    expect(groundReportCitations(report(evidence), sources)).toEqual([
      {
        sourceId: "source-1",
        url: "https://one.example.org/report",
        title: "Nepal event report",
        quote: evidence,
      },
    ]);
    expect(relevantExcerpt(`Before ${"x".repeat(2_500)} Nepal earthquake evidence after`, QUERY, 300))
      .toContain("Nepal earthquake");
  });
});

describe("POST /api/verification/search", () => {
  it("searches, opens independent sources, runs the existing council, and returns grounded links", async () => {
    const evidence = "A magnitude 6.5 earthquake struck Nepal on Thursday.";
    const results = [
      { url: "https://one.example.org/report", host: "one.example.org", title: "Nepal event report", publishedAt: "2026-09-04T10:00:00.000Z" },
      { url: "https://two.example.net/report", host: "two.example.net", title: "Regional report", publishedAt: "2026-09-04T10:10:00.000Z" },
    ];
    const search = vi.fn().mockResolvedValue(results);
    const readSource = vi.fn(async ({ input }: { inputType: "url"; input: string }) => ({
      kind: "ready" as const,
      source: { kind: "url" as const, url: input, host: new URL(input).hostname, title: input.includes("one") ? "Nepal event report" : "Regional report" },
      sourceText: input.includes("one")
        ? `${evidence} Officials said assessments were continuing and figures could change as field reports arrived.`
        : "Emergency agencies issued an independent public update after regional monitoring centres recorded ground movement and began field assessments.",
    }));
    const verify = vi.fn().mockResolvedValue(new Response(JSON.stringify(report(evidence))));
    __setWebVerificationDependenciesForTest({ search, readSource, verify, now: () => Date.parse("2026-09-04T12:30:00.000Z") });

    const result = await POST(request({ query: QUERY }));
    const body: unknown = await result.json();

    expect(WebVerificationResponseSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      kind: "web_verified_report",
      query: QUERY,
      searchWindow: "30d",
      sources: [
        { url: "https://one.example.org/report" },
        { url: "https://two.example.net/report" },
      ],
      citations: [{ url: "https://one.example.org/report", quote: evidence }],
    });
    expect(search).toHaveBeenCalledWith(QUERY, { limit: 6, searchWindow: "30d" });
    const forwarded = JSON.parse(await (verify.mock.calls[0]?.[0] as Request).text());
    expect(forwarded.input).toContain(`Claim to check: ${QUERY}`);
    expect(forwarded.input).toContain("SOURCE 1");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed for malformed input and when fewer than two sources can be opened", async () => {
    const malformed = await POST(request({ query: "short" }));
    expect(await malformed.json()).toEqual({ kind: "web_verification_unavailable", reason: "invalid_input" });

    __setWebVerificationDependenciesForTest({
      search: vi.fn().mockResolvedValue([
        { url: "https://one.example.org/report", host: "one.example.org", title: "One", publishedAt: null },
        { url: "https://two.example.net/report", host: "two.example.net", title: "Two", publishedAt: null },
      ]),
      readSource: vi.fn().mockResolvedValue({ kind: "rejected", reason: "source_unavailable" }),
    });
    const unavailable = await POST(request({ query: QUERY }));
    expect(await unavailable.json()).toEqual({ kind: "web_verification_unavailable", reason: "insufficient_sources" });
  });
});
