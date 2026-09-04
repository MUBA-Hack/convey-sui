import "server-only";

import { searchCurrentWeb as searchGdeltWeb, type WebSearchOptions, type WebSearchResult } from "./gdelt-search.server";
import { searchFirecrawlWeb } from "./firecrawl-search.server";

type SearchFunction = (
  query: string,
  options: WebSearchOptions,
  dependencies?: { apiKey: string },
) => Promise<WebSearchResult[]>;

export interface ConfiguredWebSearchDependencies {
  env?: Pick<NodeJS.ProcessEnv, "FIRECRAWL_API_KEY">;
  firecrawl?: SearchFunction;
  fallback?: (query: string, options: WebSearchOptions) => Promise<WebSearchResult[]>;
}

export async function searchConfiguredWeb(
  query: string,
  options: WebSearchOptions,
  dependencies: ConfiguredWebSearchDependencies = {},
): Promise<WebSearchResult[]> {
  const env = dependencies.env ?? process.env;
  const apiKey = env.FIRECRAWL_API_KEY?.trim() ?? "";
  const fallback = dependencies.fallback ?? searchGdeltWeb;
  if (apiKey.length === 0) return fallback(query, options);

  try {
    const results = await (dependencies.firecrawl ?? searchFirecrawlWeb)(query, options, { apiKey });
    if (results.length >= 2) return results;
  } catch {}
  return fallback(query, options);
}
