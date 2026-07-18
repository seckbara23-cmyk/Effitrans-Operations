# Mobile UX Acceptance — Phase 8.3 (install UX redesign: Phase 8.5)

Two evidence classes, honestly separated (same discipline as the production gate):
**EXECUTED** = machine-verified in this environment (tests/build). **OPERATOR** = requires real
devices/browsers; exact checklist below. Lighthouse and device screenshots cannot be produced
from the engineering environment (no browser available) — they are operator rows, not claims.

## Executed (CI-pinned)

| Standard | Mechanism | Evidence |
|---|---|---|
| No iOS zoom-on-focus | global 16 px controls < 640 px | globals.css rule + test |
| Reduced motion | global `prefers-reduced-motion` collapse | test |
| Safe-area (notch/home bar) | `viewport-fit=cover` + `env(safe-area-inset-*)` on shells/banners | test |
| Drawer accessibility | shared hook: focus trap, Escape, initial focus, restore, scroll lock; `role=dialog`/`aria-modal`; route-change close; ≥44 px targets | tests |
| Platform nav reachable on mobile | new drawer (was: unreachable < 1024 px) | test |
| Tables never clip the page | `overflow-x-auto` pattern audit — 2 outliers fixed, ~30 verified | audit + tests |
| Maps responsive height, no scroll-trap | breakpoint heights; `scrollWheelZoom` already off | test |
| Offline honesty | static public fallback with the four required statements | test |
| Update never destroys work | click-to-activate only, single guarded reload | test |
| Desktop unbroken | full suite 2,406 green incl. every frozen-contract nav test | CI |
| Compact install: iOS-Safari-only detection, standalone detection, 30-day dismissal math | pure unit tests | `tests/pwa-install.test.ts` |
| Compact install: native prompt only from a click handler, cleared after use (accept or reject) | structural | `tests/pwa-install.test.ts` |
| Compact install: header action stays available after the large banner is dismissed | structural (`available` independent of `dismissedAt`) | `tests/pwa-install.test.ts` |
| Compact install: no broken action for non-installable browsers (desktop Firefox, non-Safari iOS) | structural (`if (!pwa.available) return null`) | `tests/pwa-install.test.ts` |
| Compact install: only a timestamp is ever written to localStorage, under the namespaced key | structural + unit | `tests/pwa-install.test.ts` |
| iOS instructions dialog: accessible title/description/close, shared a11y hook | structural | `tests/pwa-install.test.ts` |

## OPERATOR — device pass (fill per row; stop on any privilege/data anomaly)

Viewports: **360×800 (Android), 390×844 (iPhone), 768×1024 (tablet), 1440×900 (desktop).**
For each critical workflow, verify: no horizontal page overflow · navigation reachable ·
primary actions visible · forms completable · dialogs fit.

| # | Workflow | 360 | 390 | 768 | 1440 |
|---|---|---|---|---|---|
| 1 | Login + password setup | ☐ | ☐ | ☐ | ☐ |
| 2 | Tenant dashboard | ☐ | ☐ | ☐ | ☐ |
| 3 | Command center | ☐ | ☐ | ☐ | ☐ |
| 4 | Shipment list + detail | ☐ | ☐ | ☐ | ☐ |
| 5 | Ocean shipment/container detail | ☐ | ☐ | ☐ | ☐ |
| 6 | Air cargo/AWB detail | ☐ | ☐ | ☐ | ☐ |
| 7 | Customs workflow | ☐ | ☐ | ☐ | ☐ |
| 8 | Portal tracking (PRIORITY) | ☐ | ☐ | ☐ | ☐ |
| 9 | Document upload/preview | ☐ | ☐ | ☐ | ☐ |
| 10 | Copilot conversation | ☐ | ☐ | ☐ | ☐ |
| 11 | Users + archive/restore | ☐ | ☐ | ☐ | ☐ |
| 12 | Platform administration (via NEW drawer) | ☐ | ☐ | ☐ | ☐ |
| 13 | Operations console | ☐ | ☐ | ☐ | ☐ |
| 14 | Settings/branding | ☐ | ☐ | ☐ | ☐ |
| 15 | Notifications | ☐ | ☐ | ☐ | ☐ |

Known read-first surfaces on phones (communicated, not silently broken): heavy admin tables
(users 920 px, finance 900 px, docintel 900 px) scroll horizontally by design — bulk operations
are tablet/desktop workflows.

## OPERATOR — PWA pass (`NEXT_PUBLIC_PWA_ENABLED=true`, now live in Production)

No browser is available in the engineering environment, so every row below is an OPERATOR step,
not a claim — same honesty discipline as the rest of this document. Compact install UX
(Phase 8.5) supersedes the old always-on full-width bar; the flows below replace the previous
generic "install prompt" rows with exact, repeatable steps.

| Check | Evidence |
|---|---|
| Lighthouse (mobile, throttled) on /login + /portal: installability pass, perf/a11y scores recorded WITH environment | ☐ |
| Update banner appears after a deploy; activation preserves a draft form until click | ☐ |
| Offline: airplane mode → navigation shows /offline; cache contains no authenticated entry (cache-policy §Verification) | ☐ |
| Desktop Chrome/Edge install (header action, no dropdown menu in this shell) | ☐ |

### Android Chrome — compact install flow

1. Clear site storage/data for the app's origin.
2. Open the production URL.
3. Verify the compact first-visit prompt appears (small corner card, NOT a full-width bar) and
   does not cover the page title or any operational action button.
4. Tap "Plus tard".
5. Verify the compact prompt disappears and does not reappear on reload.
6. Open the header — locate the "Installer l'application" action next to the notification bell.
7. Verify the action is still present (dismissal only affects the corner card, not the header
   action).
8. Tap "Installer l'application".
9. Verify the native Chrome install prompt appears (this is the browser's own UI — never
   simulated by the app).
10. Complete the installation via the native prompt.
11. Launch Effitrans from the home screen icon.
12. Verify no installation controls (header action or corner card) are displayed once running
    standalone.

### Android Edge — repeat the Chrome flow, note differences

Repeat steps 1–12 above in Edge for Android. Expected differences to record:
- Edge's native install prompt UI/copy differs from Chrome's (Edge-branded chrome); the
  `beforeinstallprompt` contract and this app's handling of it are identical — only the browser's
  own dialog differs.
- Edge may label its install affordance "Ajouter à l'écran d'accueil" in its own menu in addition
  to firing `beforeinstallprompt` — both paths lead to the same native `prompt()`/`userChoice`
  call from this app's side.

### iPhone Safari — manual install flow (no `beforeinstallprompt` on iOS)

1. Open the production URL in Safari.
2. Select the header's "Installer" action (compact label on narrow iPhone widths).
3. Verify the accessible dialog opens with the title "Installer sur iPhone / iPad" and the exact
   instruction text "Dans Safari, touchez Partager, puis Ajouter à l'écran d'accueil."
4. Follow the Safari share-sheet steps to install manually (the app cannot trigger this itself —
   iOS exposes no install API).
5. Launch Effitrans from the home screen.
6. Verify standalone detection (`navigator.standalone === true`) hides all installation controls.

Non-Safari iOS browsers (Chrome/CriOS, Edge/EdgiOS, Firefox/FxiOS) are WebKit wrappers with no
"Add to Home Screen" capability — the header action does not render for them (verified
structurally: `isIosSafariBrowser` excludes these UAs).

## Accessibility spot-pass (operator, any screen reader)

Drawer announce/trap/restore · form error association on login · status announcements
(aria-live on PWA banners) · contrast of the new banners.
