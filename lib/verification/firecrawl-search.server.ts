import "server-only";

import { z } from "zod";
import { safeSearchResultUrl, type WebSearchOptions, type WebSearchResult } from "./gdelt-search.server";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const SEARCH_TIMEOUT_MS = 25_000;

const FirecrawlItemSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  date: z.string().optional(),
  publishedDate: z.string().optional(),
});

const FirecrawlSearchSchema = z.object({
  success: z.literal(true),
  data: z.object({ web: z.array(FirecrawlItemSchema).max(100) }),
});

export interface FirecrawlSearchDependencies {
  apiKey: string;
  fetch?: typeof fetch;
}

function publishedAt(item: z.infer<typeof FirecrawlItemSchema>): string | null {
  const value = item.date ?? item.publishedDate;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function searchFirecrawlWeb(
  query: string,
  options: WebSearchOptions,
  dependencies: FirecrawlSearchDependencies,
): Promise<WebSearchResult[]> {
  const apiKey = dependencies.apiKey.trim();
  if (apiKey.length === 0) throw new Error("Web search is not configured.");
  const limit = Math.min(8, Math.max(2, options.limit ?? 6));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await (dependencies.fetch ?? fetch)(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit, sources: ["web"], timeout: SEARCH_TIMEOUT_MS }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Web search provider rejected the request.");
    const parsed = FirecrawlSearchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Web search provider returned an invalid response.");

    const seenHosts = new Set<string>();
    const results: WebSearchResult[] = [];
    for (const item of parsed.data.data.web) {
      const url = safeSearchResultUrl(item.url);
      const title = (item.title ?? "").replace(/\s+/gu, " ").trim().slice(0, 240);
      if (url === null || title.length < 4) continue;
      const host = url.hostname.toLowerCase();
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      results.push({ url: url.toString(), host, title, publishedAt: publishedAt(item) });
      if (results.length >= limit) break;
    }
    return results;
  } catch {
    throw new Error("Current web search is unavailable.");
  } finally {
    clearTimeout(timer);
  }
}
