# Effitrans — Pilot Readiness Audit (Phase 1.17A)

**Date:** 2026-06-16
**Scope:** Operational-readiness audit before pilot deployment. Not a feature phase — no new modules, schemas, workflows, or permissions. Findings + low-risk quick wins only.
**Baseline at audit:** `tsc --noEmit` clean · 149 tests passing · `next build` succeeds.
**After quick wins:** `tsc --noEmit` clean · **153 tests passing** · `next build` succeeds.

---

## 1. Executive Summary

Effitrans is a well-structured, security-conscious multi-tenant logistics platform. The core operational spine — Clients, Operational Files, Customs, Transport, Documents, Tasks, Finance, Communications, Analytics, Portal — is implemented with consistent patterns: RLS tenant isolation, deny-by-default RBAC, audit logging on every mutation, and server-action gating throughout. Authentication (email, Google OAuth, password reset, session refresh, edge-level redirect of unauthenticated users) is solid and test-covered.

The platform is **close to pilot-ready**. The most material gap is not a security hole but a **credibility one**: three legacy prototype pages (`/customers`, `/shipments`, `/documents`) and two placeholders (`/reports`, `/settings`) ship hard-coded **mock data** and sit in the primary navigation **alongside the real, RBAC-gated modules** (`/clients`, `/files`, etc.). A pilot user would see fabricated clients and shipments next to their real data. This is the #1 thing to resolve before a pilot.

Secondary gaps: no production error monitoring (Sentry), no security headers, wide data tables overflow on mobile (the real tables are now fixed; the mock-data explorer tables remain wide), and online-payment / email delivery are intentionally dark (stubs) pending provider wiring.

**Recommendation: Ready with conditions** (see §6).

---

## 2. Findings by Category

Severity legend — **Blocker** (resolve before pilot) · **High** · **Medium** · **Low**.

### A. Empty States — GOOD

Coverage is strong. Every real list/queue page has a meaningful empty state (`t.*.empty` in a Notice surface): files, clients, tasks, customs, transport, finance, reconciliation (per-section), communications, audit, users, and all three portal lists. The mock-data explorers (`/customers`, `/shipments`, `/documents`) render a custom icon + message + reset button for empty filter results. The shared `EmptyState` component is used by `ModulePage` (placeholders).

| Area | Finding | Severity |
|---|---|---|
| Dashboard KPIs (`/dashboard`, portal home) | When all metrics are zero, the strip shows `0 0 0…` with no "nothing yet" context (first-use day-one experience). | Low |

### B. Loading States — IMPROVED

Only `/analytics` had a Suspense skeleton at audit time; no `loading.tsx` files existed.

| Route | Finding | Severity | Status |
|---|---|---|---|
| `/files/[id]` | Heavy fan-out (file + tasks + documents + customs + transport + finance + communications) with no loading indicator → blank screen on slow loads. | High | **Fixed** (added `loading.tsx`) |
| `/finance/reconciliation` | Multi-table aggregation with no loading indicator. | High | **Fixed** (added `loading.tsx`) |
| `/files`, `/clients`, `/communications` | List queries with no loading state; acceptable for small datasets, may feel janky at scale. | Low | Open (monitor) |

### C. Error States — IMPROVED

No `error.tsx` / `not-found.tsx` / `global-error.tsx` existed → uncaught errors and unknown routes fell back to Next.js bare defaults.

| Finding | Severity | Status |
|---|---|---|
| No global error boundary — render/data errors leak a default screen. | High | **Fixed** (added `app/error.tsx`) |
| No 404 page — unknown routes show Next.js default. | Medium | **Fixed** (added `app/not-found.tsx`) |
| Dynamic-route not-found handling is **inconsistent**: static/mock detail routes call `notFound()`; DB-backed detail routes (`/clients/[id]`, `/files/[id]`, portal detail) render an inline Notice. Both are acceptable; noted for consistency, not fixed (behavioural change). | Low | Open |

### D. Validation — IMPROVED

Foundational validation is good: tenant scope on every action, `assertPermission` gating, email/NINEA/phone/UUID regexes, document MIME allowlist + 25 MB size cap, HTML escaping in email render, and `recordPayment` amount validation (`Number.isFinite`, `> 0`, `≤ balance`).

| Location | Finding | Severity | Status |
|---|---|---|---|
| `lib/finance/actions.ts` — `createCharge`, `updateCharge`, `addInvoiceLine` | `quantity` / `unitAmount` / `taxRate` accepted with **no bounds** → negative charges (corrupting invoice totals), zero/huge amounts, non-finite values. | High | **Fixed** (`validateLineAmounts` + tests) |
| `lib/documents/storage.ts` | File extension derived from a spoofable browser MIME / unsanitised filename; no magic-byte check. Mitigated by UUID storage paths + MIME allowlist. | Medium | Open (recommend) |
| Text fields (descriptions, notes, references, locations, titles across finance/customs/transport/tasks) | No max-length enforcement server-side (DB columns are `text`). UI/perf risk, not security. | Medium | Open (recommend) |
| Email length (users / clients / portal invite) | Format validated, length not bounded (RFC 5321 = 254). | Low | Open (recommend) |

### E. Mobile / Responsive — IMPROVED

KPI grids (`grid-cols-2 … lg:grid-cols-4`) and the login page are properly responsive; the staff sidebar has a mobile drawer.

| Location | Finding | Severity | Status |
|---|---|---|---|
| `components/clients/clients-table.tsx`, `components/files/files-table.tsx` (real data tables) | Wrapped in `overflow-hidden` with no horizontal scroll → clipped on ~375px viewports. | Medium | **Fixed** (`overflow-x-auto` wrapper) |
| Mock-data explorer tables (`shipments` `min-w-[920px]`, `tasks` `min-w-[1240px]`, `customers` `min-w-[1040px]`, `documents` `min-w-[1180px]`, `customs` `min-w-[1080px]`) | Force horizontal scroll on mobile; no card-view fallback. These belong to the prototype pages (see Blocker B1). | Medium | Open (resolve with B1) |
| `components/portal/portal-shell.tsx` | No mobile hamburger; nav links wrap on narrow phones (staff app has a drawer, portal does not). | Medium | Open (recommend) |
| `components/shell/topbar.tsx` | Page title hidden `< 640px`, search hidden `< 768px` — acceptable for an ops tool. | Low | Open |

### F. Permissions — STRONG (with one structural gap)

- **Server actions:** every mutating action in `lib/*/actions.ts` calls `assertPermission(...)` at the top. **No ungated mutations found.** ✅
- **API:** `app/api/payments/webhook/[provider]/route.ts` authenticates by HMAC signature (machine-to-machine). ✅
- **Auth gate:** `lib/supabase/middleware.ts` redirects **all** unauthenticated requests on non-public paths to the correct login (the comment in `middleware.ts` is stale — the behaviour is correct). So no page is anonymous-reachable. ✅ *(Initial finder flagged these as anonymous-access blockers; verified false against `lib/supabase/middleware.ts:64-68`.)*
- **Real module pages:** `/clients`, `/files`, `/finance`, `/customs`, `/transport`, `/tasks`, `/communications`, `/analytics`, `/users`, `/settings/audit` all call `requireUser()` + a permission check. ✅

| Location | Finding | Severity |
|---|---|---|
| `/customers`, `/shipments`, `/documents`, `/reports`, `/settings` pages | No `requireUser()` and no permission check. Reachable by **any authenticated staff user** regardless of role. **However** these render only **static mock/placeholder data** (`lib/customers.ts`, `lib/shipments.ts`, `lib/documents.ts` singular mock files; `ModulePage` placeholders) — no tenant data is exposed. So this is an **inconsistency / prototype-residue** issue, not a data-confidentiality leak. Tied to Blocker B1. | Medium |
| `lib/nav.ts` | The same five items lack a `permission` property, so they appear in the sidebar for every role. | Medium |

### G. Production Readiness

| Area | Finding | Severity | Status |
|---|---|---|---|
| Env documentation | `PAYMENTS_*`, `WAVE_*`, `ORANGE_MONEY_*` (10 vars) were read in code but **absent from `.env.example`**. | High | **Fixed** (documented) |
| Error monitoring | No Sentry / monitoring. Production errors are console-only. | High | Open (recommend) |
| Security headers | `next.config.mjs` sets no `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / CSP. | Medium | Open (recommend) |
| Rate limiting | None on login, password reset, or webhook endpoints. | Medium | Open (recommend) |
| Email delivery | `lib/comms/provider.ts` is a no-op stub by default (queue-first); **no email actually leaves** until `COMMUNICATIONS_EMAIL_PROVIDER` is wired. Intentional. | Medium | Open (expected) |
| Online payments | Dark by default; only MOCK exists. Wave / Orange Money require their secrets. Intentional. | Low | Open (expected) |
| `NEXT_PUBLIC_SITE_URL` | Used for portal links in emails; not marked required-if-email-enabled. | Low | Open (recommend) |
| Backups | Docs note "Supabase-managed"; no documented frequency / RPO-RTO / restore runbook. | Medium | Open (recommend) |
| Data residency (BLK-9) | Supabase region not confirmed in docs. | Medium | Open (recommend) |

---

## 3. Readiness Scorecard

| Dimension | Score | Notes |
|---|---:|---|
| Authentication | 90% | Email + Google OAuth + reset + session refresh + edge redirect + audit; test-covered. |
| Portal | 85% | RLS-enforced, layout gate, dual-identity guard; lacks mobile hamburger. |
| Operations | 90% | Real modules solid; mock prototype pages removed from nav (B1 resolved, Phase 1.17B). |
| Finance | 88% | Strong action gating; payment + (now) charge amounts validated; reconciliation now has a loading state. |
| Communications | 80% | Queue-first, gated; no real delivery until provider wired. |
| Analytics | 90% | Suspense skeleton, empty-data handling, permission-gated. |
| Security | 83% | Robust RBAC/RLS/tenant isolation/webhook signatures; nav/permission inconsistency closed (B1); no monitoring, headers, or rate limiting. |
| Mobile UX | 85% | Real tables fixed; wide mock tables removed from nav; portal still lacks a mobile hamburger. |
| **Overall** | **~86%** | **Ready with conditions** (B1 resolved; conditions C1–C4 remain). |

---

## 4. Quick Wins Implemented (low-risk, in-scope)

All validated by `tsc --noEmit`, `vitest run` (153 passing), and `next build` (success).

1. **Finance amount integrity** — added pure `validateLineAmounts()` to `lib/finance/calc.ts` (rejects negative/zero quantity, negative unit amount, tax rate outside 0–100, non-finite, and overflow), wired into `createCharge` / `updateCharge` / `addInvoiceLine`, reusing the existing `invalid_amount` message. +4 unit tests.
2. **Global error boundary** — `app/error.tsx` (client, retry button, logs to console for future monitor).
3. **Global 404** — `app/not-found.tsx` (friendly page + route back to the operations centre).
4. **Loading states** — `app/files/[id]/loading.tsx` and `app/finance/reconciliation/loading.tsx` skeletons for the two heaviest routes.
5. **Mobile table overflow** — horizontal-scroll wrapper on the real `clients-table` and `files-table`.
6. **Env contract** — documented the 10 missing `PAYMENTS_*` / `WAVE_*` / `ORANGE_MONEY_*` variables in `.env.example`.

Out of scope (not done, per phase rules): no new modules, schemas, integrations, or permissions.

---

## 5. Recommended Fixes (not implemented — need a decision or exceed quick-win risk)

| # | Fix | Severity | Why deferred |
|---|---|---|---|
| R1 | Remove the mock-data pages from nav (or replace with real modules) — see Blocker B1. | Blocker | Product decision (changes nav/behaviour). |
| R2 | Integrate Sentry (or equivalent) error monitoring. | High | New integration — out of quick-win scope. |
| R3 | Add security headers (`X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`) in `next.config.mjs`; consider a CSP. | Medium | Needs testing against portal/embeds. |
| R4 | Server-side file upload hardening (filename sanitisation + MIME/extension cross-check). | Medium | Behavioural change; needs upload regression test. |
| R5 | Max-length validation on free-text fields. | Medium | Bulk change across modules; pick limits with product. |
| R6 | Portal mobile hamburger nav. | Medium | UI work beyond a one-line fix. |
| R7 | Rate limiting on auth + webhook endpoints. | Medium | New infrastructure. |
| R8 | Document backup/restore runbook + confirm Supabase region (BLK-9). | Medium | Ops/docs + external confirmation. |

---

## 6. Pilot Decision

### Pilot Blockers

- **B1 — Mock/prototype data in production nav. ✅ RESOLVED (Phase 1.17B).** The five prototype items (`/customers`, `/shipments`, `/documents`, `/reports`, `/settings`) were removed from the sidebar. `/customers` + `/customers/[customerId]` now redirect to `/clients`; `/shipments` + `/shipments/[shipmentId]` redirect to `/files`; `/documents` shows a clear "no global document view" notice (documents live in dossiers + portal) and `/documents/[documentId]` redirects to `/files`; `/reports` and `/settings` remain only as honest data-free `ModulePage` placeholders (off-nav), with the real **Audit** link (`/settings/audit`) retained. No fake records render on any production-facing page; this also closed the §F nav/permission inconsistency and the §E mock-table mobile overflow. No remaining pilot blockers.

### Conditions (strongly recommended before or during early pilot)

- **C1** — Stand up error monitoring (R2) so pilot errors are observable.
- **C2** — Add security headers (R3).
- **C3** — Confirm the email provider strategy: with the no-op stub, **no notifications actually send**. Either wire a provider or set pilot expectations explicitly.
- **C4** — Confirm Supabase backups + region (R8, BLK-9).

### Recommendation

> **Ready with conditions.** The engineering core (auth, RBAC, RLS, finance, audit) is pilot-grade and the quick wins close the validation/error/loading/mobile gaps on the real surfaces. **Blocker B1 is now resolved** (Phase 1.17B — mock/prototype pages removed from nav and neutralised). Address conditions **C1–C4** (error monitoring, security headers, email-provider strategy, backups/region) for a safe, observable pilot.
