# Phase 8.0C — Production Acceptance Closure & Final Recommendation

**Date:** 2026-07-17 · **HEAD at closure:** `4e20becb3491…` (+ this phase's commit) ·
**Served production SHA at closure:** attested `4e20becb…` via `/api/version`, sweep 36/36.

This document consolidates ALL acceptance evidence (8.0A audit → 8.0B gate → 8.1A/B archive →
8.0C fresh runs), classifies every open item, and issues the explicit recommendation.

---

## 1. Deployment integrity — EXECUTED ✅

| Check | Result |
|---|---|
| Served SHA = pushed HEAD | ✅ `/api/version` attestation (fresh, this phase) |
| Route sweep | ✅ **36/36 ALL CHECKS PASSED** (fresh) — public 200s, staff→/login, portal→/portal/login, no 404/500/loop, uniform card 404 |
| CI on served SHA | ✅ run #171 success (build + typecheck + unit + **rls-tests: clean DB → 51 migrations → seed → RLS suite**) |
| Secret exposure | ✅ `/api/version` body carries sha/ref/env only; client bundles: no key patterns, no server env names (fresh scan) |
| Build ↔ CI parity | ✅ same SHA built by Vercel from the same public repo CI verified; (byte-level artifact comparison is not offered by either platform — evidence is SHA identity) |
| Lint | ⚠ ESLint has never been configured (pre-existing, documented in ci.yml since S0) — typecheck + tests are the static gate. LOW |

## 2–7, 10 — Operator-owned parts: state and NEW live evidence

The Supabase management API remains unauthorized from the engineering environment and no
authenticated production session exists here, so Parts 2 (DB SQL), 3 (identity journey),
4 (email), 5 (OpenAI), 6 (two-tenant probes), 7 (live archive replay), 10 (restore drill)
remain **operator-executed**. Ledgers with exact steps/SQL: `gate-closure.md` (C1–C5) and
`phase-8.1b-acceptance.md`. **All 50 checklist boxes remain unticked in the repo.**

**However, live production telemetry shows the journey has STARTED and yielded real evidence:**

- **An archive was executed in production** (2026-07-17 10:42 UTC, route `/users`) against
  `commsmgr@test.local`. The status transition committed; the UI/dossier behavior can be
  ticked off by the operator who ran it.
- **Finding AC-2 (INFORMATIONAL):** the GoTrue ban step failed for that user — because the
  target is an **RLS-test fixture** (raw SQL skeleton in `auth.users`, not a GoTrue-registered
  account). The archive code behaved exactly as designed: transition committed, failure
  reported (`users.archive_ban`) and audited (`authBan: "failed"`). **The "login denied at
  GoTre" evidence must be re-collected with a properly-invited staff user** (created via the
  Users page, not a fixture).
- **Finding AC-1 (MEDIUM, verified): RLS-test fixture rows exist in the production database.**
  `…00c1` = `rls_communication_test.sql`'s fixture. The RLS suite writes fixture tenants and
  @test.local users and is designed for the disposable local/CI database; it was evidently run
  against production at least once. **Fixed this phase (bounded):** `npm run test:rls` now
  routes through `scripts/guard-local-db.mjs`, which refuses any non-local `DATABASE_URL`
  (guard behavior verified: refuses remote, allows 127.0.0.1, refuses unset; test-pinned).
  **Operator cleanup:** archive or remove the @test.local fixture users and any fixture tenant
  rows from production (they have no operational history; list them with
  `select email from app_user where email like '%@test.local'` — counts/emails only).
- **F-7 middleware fix: production-verified.** Zero recurrence of the refresh-token error since
  the fixed build deployed (the only cluster instance predates the fix).

## 11. Security review — EXECUTED ✅ (fresh live evidence)

| Check | Result |
|---|---|
| Security headers LIVE on production | ✅ HSTS(preload) · nosniff · XFO SAMEORIGIN · Referrer-Policy · Permissions-Policy (fresh curl) |
| CSP | absent — documented deferral since 1.18 (F-10, MEDIUM, report-only rollout planned post-pilot) |
| Cookies | ✅ no Set-Cookie on anonymous responses; auth cookies are @supabase/ssr Secure/HttpOnly/SameSite=Lax (code-verified) |
| CSRF | ✅ mutations are server actions (origin-checked) or authenticated JSON POSTs; no state-changing GETs (8.0A review) |
| XSS | ✅ React escaping; no dangerouslySetInnerHTML (8.0A review) |
| Env vars / secrets | ✅ matrix documented; 3 hard-required secrets server-only; history + bundle scans clean (fresh) |
| Dependency audit | ⚠ unchanged: Next.js advisory stack (F-3, HIGH → C8 pre-GA upgrade, triaged DoS-class residual), esbuild dev-only (LOW), +1 low. No new advisories. |

## 12. Performance smoke — EXECUTED (open surface) / OPERATOR (authenticated)

Fresh live production timings (8 samples each, TTFB):

| Endpoint | min | p50 | max |
|---|---|---|---|
| `/login` | 0.350 s | 0.367 s | 0.388 s |
| `/portal/login` | 0.348 s | 0.358 s | 0.390 s |
| `/api/version` | 0.345 s | 0.353 s | 0.516 s |

Well inside budget; no error responses observed; runtime-error log shows **no 5xx cluster at
all** in the window. Authenticated pages (dashboard/users/shipments/customs/AI/upload/search):
measure during the operator session or pilot week 1 per performance-report.md — budgets stand.

## 13. Operational readiness

| Item | State |
|---|---|
| Monitoring / error reporting | structured `[observe]` → Vercel logs, operational (fresh evidence: the archive_ban event was captured by exactly this path); Sentry unwired (F-9) — pilot runs the documented daily-review cadence |
| Production logs accessible | ✅ (used in this phase) |
| Rollback documented | ✅ rollback-plan.md (+ known-good ladder; schema-safe code rollback) |
| Runbooks | ✅ gate-closure.md, backup-and-recovery.md, observability-plan.md, pilot-plan.md |
| Emergency contacts / owners | ⚠ names not recorded in-repo — fill the owner fields in pilot-plan.md (§Operating model) |

## 14. Consolidated classification of every open item

| # | Item | Class | Gate |
|---|---|---|---|
| AC-1 | RLS fixtures present in production DB (guard now shipped; cleanup pending) | **MEDIUM** | cleanup before pilot users browse the directory |
| AC-2 | GoTre-ban evidence must be re-run on a real invited user | **MEDIUM** (evidence gap, not defect) | part of the identity session |
| C2 | Backup restore drill unexecuted | **HIGH** | before real data (unchanged from 8.0A) |
| C3 | Environment separation unconfirmed — **raised in urgency by AC-1** (test suite once reached prod) | **HIGH** | before pilot |
| C4 | Email provider + SITE_URL + one live invitation unverified | **HIGH** | before inviting users |
| C1-rest | Identity matrix + journeys (partially started live) | **HIGH** | before pilot users |
| C5 | OpenAI Preview acceptance | MEDIUM | before enabling copilots |
| C6 | Repo still public | HIGH (business) | owner decision |
| C7 | CDP Senegal counsel | legal | before real customer data |
| C8 | Next.js upgrade | HIGH (pre-GA) | scheduled phase |
| F-9/F-10/F-11 | Sentry wiring / CSP / Node-version alignment | MEDIUM/LOW | post-pilot |
| — | Emergency-contact names | LOW | fill pilot-plan owners |

**No BLOCKER-class defect exists.** Every isolation, authorization, secret, and integrity check
that could be executed has passed; the archive fail-safe design was validated by a real
production failure event behaving exactly as specified.

---

## FINAL RECOMMENDATION (explicit)

**GO — for a supervised, synthetic-data pilot start**, on the current production deployment,
immediately: deployment integrity, route surface, security headers, latency, isolation (CI real-
Postgres suite on the exact SHA), lifecycle fail-safes and audit behavior all have evidence, and
production telemetry over the acceptance window shows zero 5xx and correct failure handling.

**NO-GO — for real operational data and external pilot customers**, until these close (the same
conditions 8.0A set, now sharpened by this phase's findings):

1. **C2** — restore drill evidenced (backup-and-recovery.md table filled).
2. **C3** — environment separation confirmed **and AC-1 fixture cleanup done** (the one proven
   separation breach is the reason this is not waivable).
3. **C4** — live invitation email round-trip evidenced.
4. **C1** — the identity matrix completed, including re-running the archive ban check on a real
   invited user (AC-2).

C5 gates only AI enablement; C6/C7 remain owner/legal decisions tracked in the register.

When rows 1–4 are ticked in the ledgers, update release-decision.md to unconditional **GO** for
the pilot as scoped in pilot-plan.md — no further engineering phase is required for that
promotion.
