import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ClaimSource, ClaimVerificationRequest } from "./claim-report";

const SOURCE_TIMEOUT_MS = 8_000;
const SOURCE_MAX_BYTES = 160 * 1024;
const SOURCE_MODEL_CHARS = 12_000;
const MAX_REDIRECTS = 2;

type LookupResult = { address: string; family: number };

export interface PublicSourceDependencies {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<LookupResult[]>;
}

export type PublicSourceResult =
  | { kind: "ready"; source: ClaimSource; sourceText: string }
  | { kind: "rejected"; reason: "unsafe_url" | "source_unavailable" | "source_too_large" };

function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function ipv4IsPublic(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipIsPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return ipv4IsPublic(normalized.slice(7));
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function parsePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.length === 0;
  const allowedPort = url.port === "" || url.port === "80" || url.port === "443";
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    blockedName ||
    !allowedPort ||
    (isIP(host) !== 0 && !ipIsPublic(host))
  ) {
    return null;
  }
  url.hash = "";
  return url;
}

async function hostnameIsPublic(
  hostname: string,
  lookup: NonNullable<PublicSourceDependencies["lookup"]>,
): Promise<boolean> {
  if (isIP(hostname) !== 0) return ipIsPublic(hostname);
  try {
    const addresses = await lookup(hostname);
    return addresses.length > 0 && addresses.every((entry) => ipIsPublic(entry.address));
  } catch {
    return false;
  }
}

async function boundedResponseText(response: Response): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > SOURCE_MAX_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > SOURCE_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } catch {
    return "";
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, raw: string) => {
      const code = Number(raw);
      return Number.isInteger(code) && code >= 32 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : " ";
    });
}

function htmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title = titleMatch ? normalizeSourceText(decodeHtmlEntities(titleMatch[1] ?? "")) : "";
  const withoutHidden = html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
  return {
    text: normalizeSourceText(decodeHtmlEntities(withoutHidden)),
    title: title.length > 0 ? title.slice(0, 240) : null,
  };
}

function boundedModelText(value: string): string {
  if (value.length <= SOURCE_MODEL_CHARS) return value;
  const prefix = value.slice(0, SOURCE_MODEL_CHARS);
  const lastSpace = prefix.lastIndexOf(" ");
  return prefix.slice(0, Math.max(lastSpace, SOURCE_MODEL_CHARS - 400)).trim();
}

export async function readPublicClaimSource(
  request: ClaimVerificationRequest,
  dependencies: PublicSourceDependencies = {},
): Promise<PublicSourceResult> {
  if (request.inputType === "text") {
    const sourceText = normalizeSourceText(request.input);
    if (sourceText.length < 8) return { kind: "rejected", reason: "source_unavailable" };
    return { kind: "ready", source: { kind: "text", label: "Pasted text" }, sourceText };
  }

  const initial = parsePublicUrl(request.input);
  if (initial === null) return { kind: "rejected", reason: "unsafe_url" };
  const fetchImpl = dependencies.fetch ?? fetch;
  const lookup = dependencies.lookup ?? (async (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  let current = initial;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!(await hostnameIsPublic(current.hostname, lookup))) {
      return { kind: "rejected", reason: "unsafe_url" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html, text/plain, application/json;q=0.8",
          "user-agent": "Convey-Claim-Reader/1.0",
        },
      });
    } catch {
      clearTimeout(timer);
      return { kind: "rejected", reason: "source_unavailable" };
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirect === MAX_REDIRECTS) {
          return { kind: "rejected", reason: "source_unavailable" };
        }
        const redirected = parsePublicUrl(new URL(location, current).toString());
        if (redirected === null) return { kind: "rejected", reason: "unsafe_url" };
        current = redirected;
        continue;
      }
      if (!response.ok) return { kind: "rejected", reason: "source_unavailable" };
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!/^(text\/(html|plain)|application\/(json|ld\+json))/u.test(contentType)) {
        return { kind: "rejected", reason: "source_unavailable" };
      }
      const body = await boundedResponseText(response);
      if (body === null) return { kind: "rejected", reason: "source_too_large" };
      if (body.length === 0) return { kind: "rejected", reason: "source_unavailable" };
      const extracted = contentType.startsWith("text/html")
        ? htmlToText(body)
        : { text: normalizeSourceText(body), title: null };
      const sourceText = boundedModelText(extracted.text);
      if (sourceText.length < 8) return { kind: "rejected", reason: "source_unavailable" };
      return {
        kind: "ready",
        source: {
          kind: "url",
          url: current.toString(),
          host: current.hostname,
          title: extracted.title,
        },
        sourceText,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind: "rejected", reason: "source_unavailable" };
}
