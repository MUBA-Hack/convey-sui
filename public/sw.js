/*
 * Convey service worker — offline-safe shell only.
 *
 * Policy (enforced by tests/commerce/pwa.test.ts):
 *   - Cache ONLY same-origin, GET, static/offline-shell assets under a
 *     versioned cache. Bump CACHE_VERSION to invalidate.
 *   - NEVER cache: /api/**, POST or any non-GET method, cross-origin
 *     requests, or any URL whose host/path touches wallet, RPC, fullnode,
 *     explorer, checkout, payment, transaction, or auth surfaces.
 *   - Navigation requests go to the network first; on failure fall back to
 *     /offline so the user always gets a meaningful shell.
 *   - On activate: delete every cache that is not the current version, then
 *     skipWaiting + clients.claim so the new SW takes over promptly.
 *
 * This worker has no signer, no transaction authority, and no knowledge of
 * wallet keys. It is a read-only static-asset cache plus an offline shell.
 */

// Bump this string to invalidate every previously cached asset. The cache
// name embeds the version so old caches are recognizable as "not current".
const CACHE_VERSION = "v1";
const CACHE_NAME = `convey-${CACHE_VERSION}`;

const OFFLINE_URL = "/offline";

// Hosts/paths that must NEVER be served from cache. Any match means the
// request bypasses the cache entirely and goes straight to the network.
// Order matters only for readability; every entry is checked.
const NEVER_CACHE_PATHS = [
  "/api/",
  "wallet",
  "rpc",
  "fullnode",
  "explorer",
  "suiscan",
  "checkout",
  "payment",
  "transaction",
  "tx",
  "auth",
  "enoki",
  "googleusercontent",
  "google",
];

self.addEventListener("install", (event) => {
  // Pre-cache the offline shell so the navigation fallback always has a body.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.skipWaiting();
      await self.clients.claim();
    })(),
  );
});

function shouldNeverCache(url) {
  const full = (url.origin + url.pathname + url.search).toLowerCase();
  return NEVER_CACHE_PATHS.some((term) => full.includes(term));
}

function isCacheable(request, url) {
  // Only same-origin GET requests may be cached, and never the sensitive
  // surfaces enumerated in NEVER_CACHE_PATHS.
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (shouldNeverCache(url)) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    // Never intercept non-GET (POST mutations, wallet signing, etc.).
    return;
  }

  const url = new URL(request.url);

  // Navigation requests: network-first, fall back to /offline on failure.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            Response.error() // No cached shell: fail closed.
          );
        }
      })(),
    );
    return;
  }

  // Never-cache surfaces and cross-origin: always bypass to the network.
  if (!isCacheable(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Static GET assets: stale-while-revalidate from the versioned cache.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          // Only cache valid, same-origin, basic responses.
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
