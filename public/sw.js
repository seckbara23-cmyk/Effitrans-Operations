/**
 * Effitrans Operations Platform — service worker (Phase 8.3).
 * ---------------------------------------------------------------------------
 * SECURITY CONTRACT (the reason this file is hand-written and small):
 *   NOTHING AUTHENTICATED OR TENANT-SCOPED IS EVER CACHED. No HTML page except the public
 *   /offline fallback, no /api/* response, no Supabase request, no document, no AI answer,
 *   no audit data. The ONLY cacheable things are same-origin immutable build assets
 *   (/_next/static — content-hashed), the icon set, and the offline fallback page.
 *
 * Strategies (explicit, nothing implicit):
 *   - /_next/static/*           cache-first   (content-hashed => immutable)
 *   - /icons/*, /favicon.ico    stale-while-revalidate (public, tenant-neutral)
 *   - navigations (HTML)        network-ONLY; on network failure -> the precached /offline
 *                               fallback. Successful HTML responses are NEVER written to cache.
 *   - everything else           network-only (API, Supabase, uploads, AI, auth, cross-origin)
 *
 * Update model: a new deploy produces a byte-different sw.js; the new worker installs and
 * WAITS. The app shows a banner; activation happens only when the user clicks (SKIP_WAITING
 * message) or all tabs close. install() does NOT skipWaiting on its own — no mid-work refresh.
 */

/* The cache version is bumped by content: any change to this file re-installs. */
const STATIC_CACHE = "effitrans-static-v1";
const OFFLINE_URL = "/offline";

/* Small, fixed precache: the offline fallback + icons. Nothing else. */
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  /* Deliberately NO self.skipWaiting(): the waiting worker activates only on user consent. */
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /* Retire caches from older SW versions. */
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** May this request EVER touch the cache? Same-origin GET static assets only. */
function cacheableStatic(url, request) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false; // Supabase & providers: never
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname === "/favicon.ico") return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  /* Navigations: NETWORK ONLY. A successful page is served and FORGOTTEN (never cached —
     authenticated HTML must not be replayable offline). Offline -> the public fallback. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const fallback = await cache.match(OFFLINE_URL);
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  if (!cacheableStatic(url, request)) {
    /* API, Supabase, uploads, AI, auth, cross-origin, non-GET: the SW does not intervene.
       The browser's normal network path (and its real error states) apply untouched. */
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    /* Immutable content-hashed assets: cache-first. */
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  /* Icons / favicon: stale-while-revalidate. */
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit ?? refresh;
    }),
  );
});
