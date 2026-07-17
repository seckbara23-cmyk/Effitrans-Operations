# Mobile UX Acceptance — Phase 8.3

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
| Desktop unbroken | full suite 2,341 green incl. every frozen-contract nav test | CI |

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

## OPERATOR — PWA pass (Preview first, `NEXT_PUBLIC_PWA_ENABLED=true`)

| Check | Evidence |
|---|---|
| Lighthouse (mobile, throttled) on /login + /portal: installability pass, perf/a11y scores recorded WITH environment | ☐ |
| Android Chrome: install prompt → standalone launch → icon correct | ☐ |
| iOS Safari: manual install banner → Partager → écran d'accueil → standalone | ☐ |
| Update banner appears after a deploy; activation preserves a draft form until click | ☐ |
| Offline: airplane mode → navigation shows /offline; cache contains no authenticated entry (cache-policy §Verification) | ☐ |
| Desktop Chrome/Edge install | ☐ |

## Accessibility spot-pass (operator, any screen reader)

Drawer announce/trap/restore · form error association on login · status announcements
(aria-live on PWA banners) · contrast of the new banners.
