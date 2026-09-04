import "server-only";

import { isIP } from "node:net";
import { z } from "zod";

const GDELT_DOC_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const SEARCH_TIMEOUT_MS = 25_000;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_MIN_INTERVAL_MS = 5_500;
const SEARCH_CACHE_MS = 120_000;

const SEARCH_CACHE = new Map<string, { expiresAt: number; results: WebSearchResult[] }>();
let searchGate: Promise<void> = Promise.resolve();
let lastSearchAt = 0;

const GdeltArticleSchema = z.strictObject({
  url: z.string(),
  url_mobile: z.string().optional(),
  title: z.string(),
  seendate: z.string().optional(),
  socialimage: z.string().optional(),
  domain: z.string().optional(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
});

const GdeltResponseSchema = z.strictObject({
  articles: z.array(GdeltArticleSchema).max(250),
});

export interface WebSearchResult {
  url: string;
  host: string;
  title: string;
  publishedAt: string | null;
}

export interface WebSearchOptions {
  limit?: number;
  searchWindow: "30d" | "3m";
}

export interface WebSearchDependencies {
  fetch?: typeof fetch;
}

export class WebSearchUnavailableError extends Error {
  constructor() {
    super("Current web search is unavailable.");
    this.name = "WebSearchUnavailableError";
  }
}

function normalizeQuery(value: string): string {
  const words = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => !/^(a|an|the|did|do|does|is|was|were|what|when|where|why|how|has|have|had|happen|happened|occur|occurred|known|recent|recently|latest|current|currently)$/iu.test(word));
  return words.join(" ").slice(0, 240).trim();
}

export function classifySearchWindow(query: string): "30d" | "3m" {
  return /\b(today|tonight|yesterday|recent|recently|latest|current|currently|breaking|this\s+(week|month)|earthquake|quake|flood|election|outbreak)\b/iu.test(query)
    ? "30d"
    : "3m";
}

function publicIpv4(host: string): boolean {
  const values = host.split(".").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = values as [number, number, number, number];
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function safeSearchResultUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.length === 0
  ) return null;
  if (isIP(host) === 4 && !publicIpv4(host)) return null;
  if (isIP(host) === 6) return null;
  url.hash = "";
  return url;
}

function parseGdeltDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}T\d{6}Z$/u.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export async function searchCurrentWeb(
  query: string,
  options: WebSearchOptions,
  dependencies: WebSearchDependencies = {},
): Promise<WebSearchResult[]> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 3) return [];
  const limit = Math.min(SEARCH_RESULT_LIMIT, Math.max(2, options.limit ?? 6));
  const cacheKey = `${options.searchWindow}:${limit}:${normalized.toLocaleLowerCase("en")}`;
  if (!dependencies.fetch) {
    const cached = SEARCH_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
  }
  const params = new URLSearchParams({
    query: `${normalized} sourcelang:english`,
    mode: "artlist",
    maxrecords: String(limit),
    format: "json",
    sort: "datedesc",
    timespan: options.searchWindow,
  });
  const execute = async (): Promise<WebSearchResult[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await (dependencies.fetch ?? fetch)(`${GDELT_DOC_ENDPOINT}?${params}`, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "Convey-Web-Evidence/1.0" },
      signal: controller.signal,
      });
      if (!response.ok) throw new WebSearchUnavailableError();
      const payload: unknown = await response.json();
      const parsed = GdeltResponseSchema.safeParse(payload);
      if (!parsed.success) throw new WebSearchUnavailableError();

      const seenUrls = new Set<string>();
      const seenHosts = new Set<string>();
      const results: WebSearchResult[] = [];
      for (const article of parsed.data.articles) {
        const url = safeSearchResultUrl(article.url);
        const title = article.title.replace(/\s+/gu, " ").trim().slice(0, 240);
        if (url === null || title.length < 4) continue;
        const canonical = url.toString();
        const host = url.hostname.toLowerCase();
        if (seenUrls.has(canonical) || seenHosts.has(host)) continue;
        seenUrls.add(canonical);
        seenHosts.add(host);
        results.push({ url: canonical, host, title, publishedAt: parseGdeltDate(article.seendate) });
        if (results.length >= limit) break;
      }
      if (!dependencies.fetch) SEARCH_CACHE.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_MS, results });
      return results;
    } catch (error) {
      if (error instanceof WebSearchUnavailableError) throw error;
      throw new WebSearchUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  };

  if (dependencies.fetch) return execute();
  let release!: () => void;
  const previous = searchGate;
  searchGate = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, SEARCH_MIN_INTERVAL_MS - (Date.now() - lastSearchAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastSearchAt = Date.now();
    return await execute();
  } finally {
    release();
  }
}
