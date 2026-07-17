# PWA Cache Security Policy (Phase 8.3)

## The contract

**Nothing authenticated or tenant-scoped is ever cached.** No HTML page except the public
`/offline` fallback, no `/api/*` response, no Supabase request, no document, no AI answer, no
audit data, no authorization decision. This is why `public/sw.js` is hand-written and ~100
lines: the allowlist is explicit and auditable, and `tests/pwa-mobile.test.ts` pins it.

## Exact rules

| Request | Strategy | Cached? |
|---|---|---|
| `/_next/static/*` (content-hashed build assets) | cache-first | ✅ immutable by construction |
| `/icons/*`, `/favicon.ico` | stale-while-revalidate | ✅ public, tenant-neutral |
| `/offline` + icon set | precached at install | ✅ the ONLY precache entries |
| Navigations (every HTML page) | **network-only**; on failure → precached `/offline` | ❌ successful HTML is never written to cache |
| `/api/*`, Supabase (cross-origin), uploads, documents, AI, auth | **SW does not intervene** (no `respondWith`) | ❌ browser's normal network path + real errors |
| Any non-GET, any cross-origin | not cacheable (guard clauses) | ❌ |

The cacheable set is a **same-origin GET allowlist** (`cacheableStatic()`); anything not
matching is passed through untouched. Failed requests keep their real error states — the SW
never fabricates a response for data.

## Update & version retirement

- `activate` deletes every cache except the current `STATIC_CACHE` version.
- New versions **wait** for user consent (no `skipWaiting` at install); activation via the
  banner posts `SKIP_WAITING`, followed by one guarded reload.

## Verification (repeat after any SW change)

1. DevTools → Application → Cache Storage: `effitrans-static-v1` must contain ONLY
   `/_next/static/*`, `/icons/*`, `/favicon.ico`, `/offline`. **Zero HTML documents besides
   `/offline`, zero `/api/`, zero supabase.co entries.**
2. Log in → browse a dossier → recheck the cache: still nothing tenant-scoped.
3. Go offline (DevTools) → navigate: the `/offline` page appears; going back online resumes
   live pages.
4. `tests/pwa-mobile.test.ts` §"cache-security contract" runs in CI on every commit.

## Rollback / SW retirement procedure

A bad service worker outlives a bad deploy (it's installed on devices). Three levers, strongest
first:

1. **Kill switch:** set `NEXT_PUBLIC_PWA_ENABLED` to anything but `"true"` and redeploy — new
   sessions stop registering. Existing installations still hold the old worker → also do (2).
2. **Replace with a no-op:** deploy a `public/sw.js` that only runs
   `self.registration.unregister()` in `activate` (+ `caches.keys().then(all delete)`), keep it
   deployed for ≥24 h. Browsers re-fetch `sw.js` on navigation (Vercel serves it
   `cache-control` revalidated) and the bad worker is replaced, then unregistered.
3. **Manual (support instruction):** DevTools → Application → Service Workers → Unregister, or
   browser site-settings → clear site data.

Never rely on "redeploy the previous commit" alone for SW problems — pair it with (2) if the
previous commit predates the SW.

## Known limitations

- The offline fallback is generic — it never claims data is current or saved (by design there
  is no offline write queue).
- iOS re-fetches `sw.js` less predictably; the update banner may appear later on iOS.
