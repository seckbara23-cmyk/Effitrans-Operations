# PWA & Mobile Architecture (Phase 8.3, install UX redesigned in Phase 8.5)

## What was found (audit) and what was built

The platform had **no PWA surface at all** (no `public/`, no manifest, no icons, no service
worker, no viewport export) and three shells in different states: tenant (mobile drawer existed,
no dialog semantics), driver (already mobile-first), **platform (nav completely unreachable
below 1024 px)**, portal (wrapping header, cramped targets). All operational tables already
followed the `overflow-x-auto + min-w` pattern except two.

## Components

| Piece | File | Notes |
|---|---|---|
| Manifest | `app/manifest.ts` | Next-native, served at `/manifest.webmanifest`, **static & tenant-neutral by construction** (test-pinned: no session/tenant/env input) |
| Icons | `public/icons/*` | 192/512 + maskable 192/512 + Apple 180 — generated PNGs, teal ground, white E glyph, maskable variants keep the glyph in the 80 % safe zone |
| Mobile metadata | `app/layout.tsx` | `viewport` export (`viewport-fit=cover`, themeColor `#0F766E`), `appleWebApp`, `formatDetection.telephone=false` (shipment refs must not become phone links), apple-touch-icon |
| Service worker | `public/sw.js` | hand-written (~100 lines, auditable) — policy in [pwa-cache-policy.md](pwa-cache-policy.md) |
| Offline fallback | `app/offline/page.tsx` | static (build-verified `○`), public (middleware-exempt), honest copy |
| PWA runtime | `components/pwa/pwa-provider.tsx` | SW registration (flag-gated), update banner, network status, **compact** first-visit install banner — mounted in the root layout OUTSIDE `AppShell`, so every surface (tenant/portal/platform/driver/cards) gets it |
| Install decision logic | `lib/pwa/install-logic.ts` | PURE, no DOM — iOS/iOS-Safari detection, standalone detection, 30-day dismissal-window math. Unit-tested directly (`tests/pwa-install.test.ts`) |
| Install shared state | `components/pwa/pwa-install-context.tsx` | `PwaInstallProvider` / `usePwaInstall()` — THE one place that listens for `beforeinstallprompt`/`appinstalled` and owns the dismissal timestamp. Mounted once in `app/layout.tsx`, wrapping `AppShell` + `PwaProvider`, so the header action and the banner never disagree about installability |
| Compact install action | `components/pwa/pwa-install-action.tsx` | Small header button ("Installer" / "Installer l'application"), rendered in `components/shell/topbar.tsx`. Renders nothing unless installable |
| iOS install instructions | `components/pwa/pwa-install-ios-dialog.tsx` | Accessible dialog (shared `useDialogA11y` hook) showing the Safari "Partager → Ajouter à l'écran d'accueil" steps — iOS has no `beforeinstallprompt` |
| Shared dialog a11y | `lib/ui/use-dialog-a11y.ts` | THE one implementation: focus trap, Escape, initial focus, focus restore, body scroll lock |

## Shells

- **Tenant** (`components/shell/*`): existing drawer upgraded to full dialog semantics
  (`role=dialog`, `aria-modal`, shared hook) + closes on route change + safe-area padding.
- **Platform** (`components/platform/platform-shell.tsx`): **new mobile drawer** — the same
  `visiblePlatformNav` data rendered twice (desktop aside + drawer), hamburger in the sticky
  header, 44 px targets, workspace switcher & logout preserved. No duplicated destinations
  (test-pinned: one `visiblePlatformNav` call).
- **Portal** (`components/portal/portal-shell.tsx`): kept the simple wrapping header (5
  destinations — a drawer would be overhead), links became ≥44 px touch targets, safe-area on
  header/main, client name hidden on the narrowest widths.
- **Driver**: untouched (already mobile-first).

## Global mobile standards (`app/globals.css`)

- form controls render at **16 px below 640 px** (kills iOS zoom-on-focus product-wide without
  touching individual forms; the design's 14 px returns at `sm+`);
- `prefers-reduced-motion` collapses all animations/transitions;
- safe-area insets on shells and PWA banners (`env(safe-area-inset-*)`, enabled by
  `viewport-fit=cover`).

## Data presentation policy

Operational tables use **controlled horizontal scrolling** (`overflow-x-auto` + `min-w`) — the
established pattern, audit-verified across ~30 tables. Two outliers were fixed (settings audit
was clipping; portal invoice lines unwrapped). The portal surface is card-based already.

## Update model

Deploy → new `sw.js` bytes → new worker installs and **waits** → banner ("Nouvelle version
disponible (sha)") → user clicks → `SKIP_WAITING` → single guarded reload. No auto-refresh, no
loops (test-pinned). The build identifier comes from `/api/version` (8.0B).

## Install UX (Phase 8.5 — compact redesign)

The Phase 8.3 install UX was a persistent full-width bottom bar ("Installer Effitrans sur cet
appareil ?"). It is replaced by a small, enterprise-style control; the underlying SW/manifest/
`beforeinstallprompt` mechanics are unchanged — only the presentation and state-sharing moved.

**State transitions** (all owned by `PwaInstallProvider`):

| State | Condition | Effect |
|---|---|---|
| `available` | not installed AND (a `beforeinstallprompt` event is held OR the browser is iOS Safari) | Compact header action (`PwaInstallAction`) renders |
| `showLargePrompt` | `available` AND the 30-day dismissal window has expired | Compact first-visit banner (in `PwaProvider`) renders |
| dismiss (large banner only) | user clicks "Plus tard" | Writes `Date.now()` to `effitrans:pwa-install-prompt-dismissed`; does **not** touch `available` — the header action stays reachable |
| install (Android/desktop) | user clicks Installer | `deferred.prompt()` → awaits `userChoice` → clears the spent event either way (accept **and** reject) — a rejection is recoverable only via a fresh browser-fired event on a later visit, never re-simulated |
| install (iOS Safari) | user clicks Installer | Opens `PwaInstallIosDialog` with the manual "Partager → Ajouter à l'écran d'accueil" steps — no native prompt exists on iOS |
| `installed` | `display-mode: standalone` matches, OR `navigator.standalone === true`, OR the `appinstalled` event fires | All install controls (banner + header action) disappear |

Only a numeric timestamp is ever written to `localStorage`, under the namespaced key
`effitrans:pwa-install-prompt-dismissed` — never a tenant id, user id, email, or session value.

Placement: the compact action lives in `components/shell/topbar.tsx`'s header button cluster.
The tenant shell has **no** profile/account dropdown menu (confirmed by audit — `Topbar` renders
a flat identity block, not a menu), so the brief's documented fallback — "small unobtrusive
header action" — applies. `Topbar` is shared by desktop and mobile breakpoints, so one placement
covers both. It is intentionally **not** duplicated into `platform-shell.tsx` or
`portal-shell.tsx` in this phase (see acceptance doc, "Remaining limitations") — `PwaInstallAction`
is a standalone component reusable there with no further plumbing, since `PwaInstallProvider` is
already mounted globally.

## Rollout (Phase 8.3 §S, flag flipped in Phase 8.5)

SW registration is **dark by default** — `NEXT_PUBLIC_PWA_ENABLED="true"` enables it. Sequence:
enable in **Preview** → verify (scope `/`, install, update banner, offline fallback, cache
contents) → enable in Production after mobile acceptance. `NEXT_PUBLIC_PWA_ENABLED=true` was set
in Vercel Production and the app redeployed as part of Phase 8.5 — the compact install UX above
is what that flag now activates for real users. Manifest/icons/metadata ship always (inert
without the SW; installability requires the flag). Rollback: see
[pwa-cache-policy.md](pwa-cache-policy.md) §Rollback.

## Out of scope (deliberate)

Push notifications, background sync / offline write queues for operational data, biometric
auth, native wrappers — all excluded by the phase contract.
