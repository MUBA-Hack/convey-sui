import { describe, expect, it, vi } from "vitest";
import { searchFirecrawlWeb } from "@/lib/verification/firecrawl-search.server";
import { searchConfiguredWeb } from "@/lib/verification/web-search-provider.server";

const QUERY = "What is known about the recent Nepal earthquake?";

describe("Firecrawl web search", () => {
  it("returns normalized, unique public HTTPS results from the v2 web response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        web: [
          {
            url: "https://news.example.org/nepal#top",
            title: "  Nepal earthquake update  ",
            publishedDate: "2026-09-04T10:00:00Z",
          },
          {
            url: "https://news.example.org/duplicate",
            title: "Duplicate host",
          },
          {
            url: "https://wire.example.net/nepal",
            title: "Second Nepal earthquake report",
            date: "2026-09-04",
          },
          { url: "http://unsafe.example.com/story", title: "Unsafe" },
        ],
      },
    }), { headers: { "content-type": "application/json" } }));

    const results = await searchFirecrawlWeb(QUERY, { limit: 6, searchWindow: "30d" }, {
      apiKey: "fc-test-key",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(results).toEqual([
      {
        url: "https://news.example.org/nepal",
        host: "news.example.org",
        title: "Nepal earthquake update",
        publishedAt: "2026-09-04T10:00:00.000Z",
      },
      {
        url: "https://wire.example.net/nepal",
        host: "wire.example.net",
        title: "Second Nepal earthquake report",
        publishedAt: "2026-09-04T00:00:00.000Z",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.firecrawl.dev/v2/search");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: "Bearer fc-test-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({ query: QUERY, limit: 6, sources: ["web"] });
  });

  it("uses configured Firecrawl first and falls back when it is unavailable", async () => {
    const firecrawl = vi.fn().mockRejectedValue(new Error("unavailable"));
    const fallback = vi.fn().mockResolvedValue([
      { url: "https://fallback.example.org/story", host: "fallback.example.org", title: "Nepal earthquake report", publishedAt: null },
    ]);

    const results = await searchConfiguredWeb(QUERY, { limit: 6, searchWindow: "30d" }, {
      env: { FIRECRAWL_API_KEY: "fc-live" },
      firecrawl,
      fallback,
    });

    expect(firecrawl).toHaveBeenCalledWith(QUERY, { limit: 6, searchWindow: "30d" }, { apiKey: "fc-live" });
    expect(fallback).toHaveBeenCalledWith(QUERY, { limit: 6, searchWindow: "30d" });
    expect(results).toHaveLength(1);
  });
});
