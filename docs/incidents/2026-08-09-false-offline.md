# Incident — false « Vous êtes hors ligne » (observed ≥ 2×, production)

**Surface:** effitrans-operations.vercel.app · **Severity:** availability (no data
loss — reads only, nothing was written or lost) · **Status:** fixed (SW retry +
self-recovering fallback), pending rollout to installed clients via the standard
SW update consent.

## Symptom

The full-screen « Vous êtes hors ligne » card replaced the workspace while the
workstation had working Internet. The visible "shell" around it is the offline
document's own **static anonymous chrome** (the `/offline` route is statically
prerendered inside `AppShell` with empty navigation — nothing authenticated is
in the cache). Reload sometimes recovered; the state otherwise persisted.

## Architecture discovered (every "offline" source of truth)

| Source | Role | Verdict |
|---|---|---|
| `public/sw.js` navigation handler | `fetch(request).catch(→ serve precached /offline)` for every `mode:"navigate"` request | **The culprit** |
| `components/pwa/pwa-provider.tsx` (`useNetworkStatus`) | `navigator.onLine` + `online`/`offline` events → amber top **banner** only; documented as a hint; never replaces content | Not involved (different copy) |
| `components/driver/mission-tracker.tsx` | skips position POSTs when `navigator.onLine === false` | Driver-only, unrelated |
| Presence / tracking-health "offline" vocabularies | server-side data freshness labels | Unrelated |
| `app/error.tsx` / `app/global-error.tsx` | render-error boundaries — « Une erreur est survenue » | Different surface |
| `lib/supabase/middleware.ts` | auth redirects; `/offline` exempted | No offline logic |
| Health/reachability checks | none exist app-side | — |

Supabase failures, auth/session failures, RSC (soft) navigation failures and API
failures **cannot** produce this screen: the SW passes all of them through
untouched (they resolve into their own error states), and App Router soft
navigations are not `mode:"navigate"` requests. Only a **hard navigation** whose
fetch **rejects at the network layer** reaches the fallback. An HTTP 4xx/5xx
*resolves* and is served as-is — Vercel-side errors cannot trigger it either
(confirmed: production runtime errors for the last 7 days contain one unrelated
audit-write error and no 5xx cluster).

## Root cause

`public/sw.js` (Phase 8.3): **a single rejected navigation fetch was treated as
proof the device is offline.** Transient network-layer rejections happen on
connected machines — wake-from-sleep races, Wi-Fi/network switches
(`ERR_NETWORK_CHANGED`), connection resets, proxy/VPN blips. One such rejection
served the full offline document **under the original URL**, and the document
had no way back: no reachability probe, no `online` listener, and a « Réessayer »
link pointing at `/` (discarding the user's destination). `navigator.onLine`
was not consulted at all — the copy asserted "you are offline" on no evidence
beyond one failed request.

## Reproduction

DevTools → Application → Service Workers → check "Offline" (or Network →
Offline) → hard-navigate to any route → the fallback appears. Restore
connectivity: **before the fix** the page stayed until a manual reload; the
transient variant (the incident) is the same single-rejection path, hit when the
network stack drops one request while the machine is otherwise online.
Regression tests encode the contract structurally (`tests/offline-recovery.test.ts`).

## Fix (smallest robust; no migration, no RLS/RBAC change, no offline queue)

1. **`public/sw.js`** — one failed fetch is no longer offline: pause 400 ms,
   retry once; only a **second** network-layer rejection serves the fallback.
   HTTP errors still pass through untouched; successful HTML is still never
   cached. `STATIC_CACHE` bumped to `v2` so updating clients re-precache the
   recovering fallback page.
2. **`app/offline/page.tsx`** — the fallback recovers itself:
   * an **inline** script (this page's hydration chunks are not precached, so
     React hydration is exactly what cannot be relied on here) probes the
     public, secret-free `/api/version` every 4 s and immediately on the
     browser's `online` event; **only a real successful response** triggers
     `location.reload()` — which retries the ORIGINAL URL, since the fallback
     is served under it;
   * `navigator.onLine` is a **copy hint only**, in both directions: it selects
     « Service momentanément injoignable » vs « Vous êtes hors ligne » and never
     gates the probe;
   * « Réessayer » is now `href=""` (reload current URL) — deep link preserved,
     works with zero JavaScript;
   * the honesty line is untouched: nothing is ever saved offline.

**Deliberately not done:** no offline write queue; the offline protection was
not removed (a genuinely offline device still gets the fallback, now with
automatic resumption); AppShell's cosmetic empty chrome around the static
offline document was left alone (no authenticated content is involved).

## Rollout note

`sw.js` changed → the new worker installs on next visit and **waits** for the
standard user-consented activation (update banner / all tabs closed). Until a
client updates, it keeps the old behavior — expected, per the Phase 8.3 update
model. The kill-switch/rollback levers in docs/pwa-cache-policy.md are unchanged.

## Tests

`tests/offline-recovery.test.ts` (new, 12): SW retries once before any fallback,
fallback only from the inner catch, HTTP errors never intercepted, navigations
still never cached, cache bumped; page probes `/api/version` no-store on a
bounded interval, reloads only on `res.ok`, `online` event verifies (never
recovers by itself), `onLine` never gates the probe, retry preserves the URL,
recovery is inline, nothing-saved copy intact. `tests/pwa-mobile.test.ts`
updated: the page's only permitted fetch target is `/api/version`.
