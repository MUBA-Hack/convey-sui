import "server-only";

import { ClaimVerificationResponseSchema, type ClaimVerificationReport } from "./claim-report";
import { readPublicClaimSource, type PublicSourceResult } from "./public-source.server";
import { classifySearchWindow, type WebSearchResult } from "./gdelt-search.server";
import { searchConfiguredWeb } from "./web-search-provider.server";
import {
  WebVerificationResponseSchema,
  type GroundedCitation,
  type WebEvidenceSource,
  type WebVerificationResponse,
} from "./web-evidence";

const MAX_OPEN_RESULTS = 6;
const MAX_EVIDENCE_SOURCES = 4;
const EXCERPT_CHARS = 2_200;

export interface ReadableEvidenceSource {
  public: WebEvidenceSource;
  text: string;
}

export interface WebVerificationDependencies {
  search?: (query: string, options: { limit: number; searchWindow: "30d" | "3m" }) => Promise<WebSearchResult[]>;
  readSource?: (request: { inputType: "url"; input: string }) => Promise<PublicSourceResult>;
  verify?: (request: Request) => Promise<Response>;
  now?: () => number;
}

function compact(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function queryTerms(query: string): string[] {
  return compact(query)
    .toLocaleLowerCase("en")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3 && !/^(about|after|before|current|currently|from|happen|happened|known|latest|near|recent|recently|tell|their|there|today|what|when|where|which|with)$/u.test(term));
}

export function filterRelevantSearchResults(
  query: string,
  results: WebSearchResult[],
): WebSearchResult[] {
  const terms = [...new Set(queryTerms(query))];
  if (terms.length === 0) return results;
  const minimumMatches = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.35));
  return results.filter((result) => {
    const title = compact(result.title).toLocaleLowerCase("en");
    return terms.filter((term) => title.includes(term)).length >= minimumMatches;
  });
}

export function relevantExcerpt(text: string, query: string, maximum = EXCERPT_CHARS): string {
  const normalized = compact(text);
  if (normalized.length <= maximum) return normalized;
  const lower = normalized.toLocaleLowerCase("en");
  const match = queryTerms(query)
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, match - Math.floor(maximum * 0.22));
  const raw = normalized.slice(start, start + maximum);
  const firstSpace = start === 0 ? 0 : raw.indexOf(" ") + 1;
  const lastSpace = raw.lastIndexOf(" ");
  return raw.slice(firstSpace, lastSpace > firstSpace ? lastSpace : raw.length).trim();
}

async function openEvidenceSources(
  query: string,
  results: WebSearchResult[],
  readSource: NonNullable<WebVerificationDependencies["readSource"]>,
): Promise<ReadableEvidenceSource[]> {
  const opened = await Promise.all(
    results.slice(0, MAX_OPEN_RESULTS).map(async (result) => {
      let source: PublicSourceResult;
      try {
        source = await readSource({ inputType: "url", input: result.url });
      } catch {
        return null;
      }
      if (source.kind !== "ready" || source.source.kind !== "url") return null;
      const excerpt = relevantExcerpt(source.sourceText, query);
      if (excerpt.length < 80) return null;
      return {
        public: {
          id: "source-1",
          url: source.source.url,
          host: source.source.host,
          title: (source.source.title ?? result.title).slice(0, 240),
          publishedAt: result.publishedAt,
          snippet: excerpt.slice(0, 420),
        },
        text: `${result.title} ${excerpt}`,
      } satisfies ReadableEvidenceSource;
    }),
  );
  const unique = new Map<string, ReadableEvidenceSource>();
  for (const source of opened) {
    if (source !== null && !unique.has(source.public.host)) unique.set(source.public.host, source);
  }
  return [...unique.values()].slice(0, MAX_EVIDENCE_SOURCES).map((source, index) => ({
    ...source,
    public: { ...source.public, id: `source-${index + 1}` },
  }));
}

function evidenceBundle(query: string, sources: ReadableEvidenceSource[]): string {
  const sections = sources.map((source) => [
    `SOURCE ${source.public.id.slice(7)}`,
    `Title: ${source.public.title}`,
    `URL: ${source.public.url}`,
    `Published: ${source.public.publishedAt ?? "Date unavailable"}`,
    `Excerpt: ${source.text}`,
  ].join("\n"));
  return [
    `Claim to check: ${compact(query)}`,
    "Use only these independently retrieved current sources as evidence.",
    "The primary claim must directly answer the claim or question above; do not substitute a nearby story.",
    ...sections,
  ].join("\n\n").slice(0, 12_000);
}

export function groundReportCitations(
  report: ClaimVerificationReport,
  sources: ReadableEvidenceSource[],
): GroundedCitation[] {
  const citations: GroundedCitation[] = [];
  const seen = new Set<string>();
  for (const evidence of report.evidence) {
    const quote = compact(evidence.text);
    const source = sources.find((candidate) => compact(candidate.text).includes(quote));
    if (!source) continue;
    const key = `${source.public.id}:${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      sourceId: source.public.id,
      url: source.public.url,
      title: source.public.title,
      quote,
    });
  }
  return citations.slice(0, 12);
}

export async function runWebVerification(
  query: string,
  dependencies: WebVerificationDependencies = {},
): Promise<WebVerificationResponse> {
  const searchWindow = classifySearchWindow(query);
  const search = dependencies.search ?? ((value, options) => searchConfiguredWeb(value, options));
  const readSource = dependencies.readSource ?? ((request) => readPublicClaimSource(request));
  const verify = dependencies.verify ?? (async (request) => {
    const route = await import("@/app/api/verify/route");
    return route.POST(request);
  });
  let results: WebSearchResult[];
  try {
    results = await search(query, { limit: MAX_OPEN_RESULTS, searchWindow });
  } catch {
    return { kind: "web_verification_unavailable", reason: "search_unavailable" };
  }
  results = filterRelevantSearchResults(query, results);
  if (results.length < 2) return { kind: "web_verification_unavailable", reason: "insufficient_sources" };
  const sources = await openEvidenceSources(query, results, readSource);
  if (sources.length < 2) return { kind: "web_verification_unavailable", reason: "insufficient_sources" };

  const request = new Request("http://convey.internal/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputType: "text", input: evidenceBundle(query, sources) }),
  });
  let rawReport: unknown;
  try {
    rawReport = await (await verify(request)).json();
  } catch {
    return { kind: "web_verification_unavailable", reason: "verification_unavailable" };
  }
  const parsed = ClaimVerificationResponseSchema.safeParse(rawReport);
  if (!parsed.success || parsed.data.kind !== "verified_report") {
    return { kind: "web_verification_unavailable", reason: "verification_unavailable" };
  }
  const citations = groundReportCitations(parsed.data, sources);
  if (citations.length === 0) {
    return { kind: "web_verification_unavailable", reason: "insufficient_sources" };
  }
  return WebVerificationResponseSchema.parse({
    kind: "web_verified_report",
    query: compact(query),
    searchWindow,
    searchedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    report: parsed.data,
    sources: sources.map((source) => source.public),
    citations,
  });
}
