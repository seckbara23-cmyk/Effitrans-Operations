# Phase 8.0A — Production Readiness Audit & Findings Register

**Audited release candidate:** `d9c2c268f03795477daa07bf4991bd7b9655e324` (Phase 7.7, main)
**Audit date:** 2026-07-17 · **Auditor environment:** engineering workstation (no Docker, no Supabase management-API token, no live-session credentials — constraints recorded per finding)

This register lists every finding with classification, evidence, impact, and pilot-blocking status.
The release decision derived from it is in [release-decision.md](release-decision.md).

Classification: BLOCKER · HIGH · MEDIUM · LOW · INFORMATIONAL · EXTERNAL_DEPENDENCY.

---

## BLOCKER

### F-1 — Production is unreachable: Vercel Deployment Protection covers the production alias

- **Evidence:** `GET https://effitrans-operations-seckbara23-6470s-projects.vercel.app/login` → `302` to `https://vercel.com/sso-api?...` (observed 2026-07-17, twice, incl. via the authenticated Vercel fetch path). The project has no custom domain (`domains`: the two `*.vercel.app` aliases; `live: false`).
- **Affected surface:** the entire application — staff login, portal login, public business cards (`/card/{token}`), every API route.
- **User impact:** no pilot user (staff, driver, or customer) can reach the app at all; the customer portal is unreachable by customers; public card links are broken.
- **Security/operational impact:** currently *positive* (nothing is publicly exposed while development continues) — but it is incompatible with starting the pilot.
- **Reproduction:** open the production URL in a browser without a Vercel team session.
- **Recommended correction:** Vercel → Project → Settings → Deployment Protection → protect **previews only** (keep previews protected; open production). Then execute the live route/journey verification (see pilot-plan §Go-live steps).
- **Owner:** operator (Vercel dashboard). **Pilot-blocking: YES** — one-setting fix, verify immediately after.
- **Note:** this is judged a deliberate development-time posture, not a defect; it becomes a blocker only at pilot start.

---

## HIGH

### F-2 — The source repository is PUBLIC

- **Evidence:** unauthenticated `api.github.com` access to the repo succeeded (CI runs listed without a token); Vercel deployment metadata records `githubRepoVisibility: "public"`.
- **Affected surface:** entire codebase, migrations, seed, docs (incl. threat matrix and runbooks).
- **User impact:** none directly. **Business impact:** the proprietary platform is world-readable; docs reveal internal architecture and security posture to any attacker.
- **Mitigating facts (verified):** no secret has ever been committed (`.gitignore` covers `.env*` from wave 0; history scans for key patterns and `.env` additions returned only `.env.example`); seed.sql creates **no** auth users and **no** passwords.
- **Recommended correction:** make the repository private (the Vercel Git integration continues to work). If public is intentional (it does not appear to be), record that decision explicitly.
- **Owner:** repository owner. **Pilot-blocking: NO** (no secret exposure) — but strongly recommended **before real operational data** and definitely before GA.

### F-3 — Next.js 14.2.35 carries a published advisory stack (fix = 16.2.10, breaking)

- **Evidence:** `npm audit` — 1 high (next, 13 advisories incl. RSC DoS, RSC cache poisoning, middleware-redirect cache poisoning, image-optimizer DoS, i18n middleware bypass), 1 moderate (transitive postcss). Fix version 16.2.10 — a major upgrade.
- **Applicability triage (verified against this codebase):**
  - `next/image`: **not used** → the three Image-Optimizer advisories have no in-app surface.
  - `rewrites`/`redirects` in config: **none** → request-smuggling-in-rewrites N/A.
  - Pages-Router i18n: **N/A** (App Router only) → middleware bypass N/A.
  - CSP nonces: **not used**; `beforeInteractive` scripts: **not used**; WebSocket upgrades: **not used** → those XSS/SSRF advisories N/A.
  - Middleware redirects: only same-origin login redirects → cache-poisoning surface minimal.
  - **Residual:** the Server-Components DoS / RSC cache-poisoning family — availability-class, applies to any App Router app.
- **User impact:** worst plausible case for the pilot is denial of service, not data exposure. All surfaces except `/login`, `/portal/login`, `/auth/*`, `/card/*` require authentication.
- **Recommended correction:** schedule a dedicated Next 14→latest upgrade phase (breaking: middleware/config/API changes) with full regression, **before GA**. Do NOT `npm audit fix --force` inside the audit phase.
- **Owner:** engineering. **Pilot-blocking: NO** (bounded internal pilot; availability-class residual; mitigations recorded). **GA-blocking: YES** until upgraded.

### F-4 — Backup exists only as a platform default; restore has never been tested; plan tier unverified

- **Evidence:** the Supabase management API is not reachable from this environment (MCP unauthorized), so plan tier / PITR availability / backup schedule could not be verified. No restore drill is recorded anywhere in the repo or docs.
- **User impact:** if the database is corrupted or data is destroyed during the pilot, recovery is unproven.
- **Recommended correction:** operator verifies the Supabase plan (daily backups are included on paid plans; PITR is an add-on), documents RPO/RTO, and **performs one restore drill to a scratch project** before real operational data enters the system. Procedure and evidence table: [backup-and-recovery.md](backup-and-recovery.md).
- **Owner:** operator. **Pilot-blocking: YES for real data** — the pilot may start on test data, but the switch to real dossiers requires the drill evidence.

### F-5 — One-click dashboard redeploys can silently regress production to an old commit

- **Evidence (observed live during this audit):** production deployment sequence on 2026-07-17: `d9c2c26` push-build READY (23:59) → manual **redeploy of `8d18f76` (7.6A — five commits old)** created 00:16 targeting production (`action: "redeploy"`, `originalDeploymentId` of the 7.6A build) → manual redeploy of `d9c2c26` created 00:19 → another redeploy 00:26. Had the stale redeploy completed last, production would serve 7.6A with the 7.7 (and 7.6B/C) database migrations already applied — exactly the "stale deploy" failure mode recorded in Phase 7.2C.
- **User impact:** stale production; features 404; code/schema skew.
- **Recommended correction:** deployment discipline in the runbook — (1) production changes ship only by push to `main`; (2) dashboard "Redeploy" is reserved for rolling back and only ever on the newest known-good build; (3) after ANY production deployment, verify the served SHA (rollback-plan.md §Verify). Optional hardening: enable Vercel's promotion protection ("require approval for production").
- **Owner:** operator + runbook. **Pilot-blocking: NO** (process control, documented); the final served SHA must be verified at pilot start (release condition C1).

### F-6 — No staging environment; environment separation is partial and partly unverifiable

- **Evidence:** exactly one Vercel project (`effitrans-operations`) serving production + previews; no `.vercel/project.json` link locally; Supabase management API unreachable from here, so whether previews share the production database could not be verified. Historical posture (6.0G): staging = Vercel Preview + a separate Supabase project, executed by the operator.
- **User impact:** if previews point at the production Supabase project, a preview deployment can write production data.
- **Recommended correction:** operator confirms (and documents in environment-matrix.md §Separation) which Supabase project each Vercel environment's `NEXT_PUBLIC_SUPABASE_URL`/keys point to. Required end-state: **previews and local dev must NOT use the production Supabase project.** AI keys: Preview-only until Production AI is deliberately enabled (Part 8 posture).
- **Owner:** operator. **Pilot-blocking: YES to confirm, small effort** (a read of the Vercel env settings; rotation only if sharing is found).

---

## MEDIUM

### F-7 — Middleware surfaces `AuthApiError: Invalid Refresh Token` as production runtime errors

- **Evidence:** Vercel runtime-error clusters (7 days): 2 groups, 8 events, 1 user, route `/middleware` — `refresh_token_not_found` (status 400) from `supabase.auth.getUser()` in `lib/supabase/middleware.ts:77` when a browser presents a stale refresh cookie.
- **User impact:** at minimum error-log noise that will mask real incidents; at worst (if the throw escapes) a 500 instead of a clean redirect to login.
- **Reproduction:** present an expired/revoked refresh-token cookie to any protected route.
- **Correction (IMPLEMENTED in this phase — bounded, behavior-preserving):** wrap the `getUser()` call; any auth error is treated as *signed out* (the code path that already exists: redirect to the matching login). Regression test added. See release-decision.md §Fixes.
- **Owner:** engineering (done). **Pilot-blocking: NO.**

### F-8 — `NEXT_PUBLIC_SITE_URL` silently falls back to `""` — emailed/portal links break if unset

- **Evidence:** consumed in 8 modules (invitations, welcome, customer notifications, brand cards, provisioning); every consumer defaults to empty string, producing relative or broken links in emails.
- **Recommended correction:** set it in Vercel production env (and Preview, to the preview URL); verify one invitation link end-to-end at pilot start (pilot-plan checklist). Consider a startup warning when unset in hosted production (deferred — not a verified defect).
- **Owner:** operator (config). **Pilot-blocking: YES as configuration item** (checklist line, minutes).

### F-9 — No error monitor / alerting wired (structured logs only)

- **Evidence:** `lib/observability/report.ts` is a deliberate single integration point emitting `[observe]` structured lines to Vercel logs; `monitoringEnabled()` exists but `@sentry/nextjs` is not installed; no alert rules exist anywhere.
- **User impact:** incidents are discovered by manual log review or user report.
- **Recommended correction:** for the pilot: the manual daily log-review cadence + the alert definitions in [observability-plan.md](observability-plan.md). Before GA: wire the monitor at the existing integration point.
- **Owner:** operator (cadence) + engineering (Sentry wiring, post-pilot). **Pilot-blocking: NO** (explicitly accepted as a pilot condition with cadence).

### F-10 — Content-Security-Policy absent (documented deferral)

- **Evidence:** `next.config.mjs` sets XFO/nosniff/Referrer-Policy/Permissions-Policy/HSTS on every route; CSP intentionally deferred (inline-script nonce work) since Phase 1.18 with written rationale.
- **Recommended correction:** roll out `Content-Security-Policy-Report-Only` first; enforce after observation. Post-pilot.
- **Owner:** engineering. **Pilot-blocking: NO.**

### F-11 — Vercel runs Node 24.x; CI verifies on Node 20

- **Evidence:** project `nodeVersion: "24.x"`; `.github/workflows/ci.yml` pins `node-version: "20"`. Local dev observed on Node 24.
- **User impact:** the runtime executing production was never exactly exercised by CI (low practical risk for this dependency set, but it is a gap in "CI verifies what runs").
- **Recommended correction:** align (either pin Vercel to 20.x or bump CI to 24) in a normal change, not during the audit.
- **Owner:** engineering. **Pilot-blocking: NO.**

---

## LOW

### F-12 — `.env.example` is missing ~15 documented-in-code variables

- **Evidence:** env audit — absent: `NEXT_PUBLIC_MAP_TILE_URL`, all `EFFITRANS_*` process flags, all six copilot rate-limit vars, `PORTAL_ALLOW_PASSWORD_EMAIL`, Sentry DSNs. All are optional with safe defaults, so nothing breaks — but the contract file understates the surface.
- **Correction (IMPLEMENTED — docs-only):** `.env.example` completed with names + comments (no values).
- **Pilot-blocking: NO.**

### F-14 — LATENT (8.0B discovery): middleware would redirect unauthenticated machine webhooks

- **Evidence:** `middleware.ts` matches all non-static routes; `updateSession` redirects any
  unauthenticated request outside `isPublicPath` to a login page. `POST /api/payments/webhook/[provider]`
  is a cookie-less machine call secured by signature verification (per its own header comment) — it would
  receive a 307 redirect instead of being processed.
- **Impact today:** none — payments are DARK (`PAYMENTS_ENABLED` unset); no webhook is registered anywhere.
- **Recommended correction:** when payments are enabled, exempt the webhook path in `isPublicPath`
  (same pattern as `/api/version`) — belongs to the payments-enablement phase, with its own tests.
- **Owner:** engineering (payments phase). **Pilot-blocking: NO.**

### F-13 — esbuild dev-server advisory (GHSA-g7r4-m6w7-qqqr)

- **Evidence:** `npm audit` moderate — arbitrary file read via the *development server* on Windows. Never runs in production. `npm audit fix` available.
- **Correction:** apply with the next routine dependency pass. **Pilot-blocking: NO.**

---

## INFORMATIONAL

- **I-1 — Production runtime is healthy:** 7 days of runtime errors contain ONLY the F-7 auth-refresh cluster (8 events, 1 user). No 5xx clusters, no route failures.
- **I-2 — No secret reaches the client:** `.next/static` scans found no key patterns and no server-only env names; the only `NEXT_PUBLIC_` names in bundles are `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public by design), `MAP_TILE_URL`, `SENTRY_DSN` (public by design).
- **I-3 — Migration hygiene is clean:** 50 migrations, no duplicate timestamps, no `drop table/column`, `truncate`, or raw `delete from` anywhere; clean-replay rules are machine-enforced (`tests/migration-clean-replay.test.ts`); CI run #166 applied the full sequence + seed + RLS suite from a clean database on the release SHA.
- **I-4 — Seed is credential-free:** seed.sql creates roles/permissions/catalog only; no `auth.users`, no passwords.
- **I-5 — AI hosted-production safety verified in code:** on Vercel (`VERCEL=1`), localhost AI URLs, plain-HTTP remotes, and unauthenticated local providers are refused (`unsafe_config` → 503); local providers are dark by default (`AI_LOCAL_PROVIDER_ENABLED`); master kill switch `AI_COPILOT_ENABLED=false` blacks out every copilot. A stray local Ollama config **cannot** affect production.
- **I-6 — `DATABASE_URL` is CLI-only** (migration scripts); intentionally not read at runtime.

---

## EXTERNAL_DEPENDENCY (not defects — tracked in the feature-flag/provider matrix)

| Dependency | State | Blocking? |
|---|---|---|
| GAINDE customs API | `EXTERNALLY_BLOCKED` (BLK-1, no API contract since 7.1B) | Customs remains manual-intelligence — by design |
| Carrier / AIS / airline / ADS-B APIs | `DEFERRED` (honest stubs, `not_configured`) | Manual tracking is the pilot mode — by design |
| Azure Document Intelligence (OCR) | `EXTERNALLY_BLOCKED` (7.4C-0: signed DPA + accuracy eval required) | OCR_REQUIRED docs stay in review queue |
| OpenAI production project | Not created; Preview-only acceptance pending (Part 8) | Production AI stays dark until deliberate |
| Email provider (Resend) + sender domain | Unverified from this environment; `resend.dev` sender blocked in prod by code | Pilot needs a verified sender or explicit link-returned mode |
| CDP Senegal / privacy counsel | Legal review not performed — engineering cannot claim compliance | Legal item, before real customer data |

---

## Audit scope executed vs. deferred (honesty table)

| Part | Executed here | Evidence | Deferred to operator/pilot |
|---|---|---|---|
| 1 Release candidate | ✅ | release-manifest.md | — |
| 2 Environment separation | ◐ | one Vercel project confirmed; Supabase link unverifiable | F-6 confirmation |
| 3 Env vars | ✅ | environment-matrix.md (full enumeration) | value presence per env |
| 4 Deployment routes | ◐ | all 96 pages + 16 APIs exist and build on the release SHA; deployment SHA matches | live fetch blocked by F-1 → checklist |
| 5 Identity classes | ◐ | structural tests + journeys suite (2,238 green) | live logins per identity → checklist |
| 6 RLS | ✅ (CI) | CI run #166 rls-tests job green on release SHA; bidirectional suites in repo | adversarial manual pass post-unprotect |
| 7 Journeys | ✖ | — | pilot-plan §Journeys (6.0G harness) |
| 8 AI acceptance | ◐ | structural guardrails tested; no provider key here | Preview run with OpenAI → checklist |
| 9 DocIntel | ◐ | unit/structural suites green | live PDF pass → checklist |
| 10 Email | ◐ | provider code audit (stub default, prod sender guard) | real delivery test → checklist |
| 11 Storage | ◐ | bucket policy migrations + tests | live signed-URL probe → checklist |
| 12 Migrations | ✅ | I-3 + CI clean apply | apply-to-prod-baseline is a no-op check (same sequence) |
| 13 Backup/DR | ✖ | — | F-4 drill |
| 14 Observability | ✅ (defined) | observability-plan.md; live runtime errors reviewed | alert wiring post-pilot |
| 15 Error handling | ◐ | closed-vocabulary patterns verified in code+tests | UX pass during pilot |
| 16 Performance | ◐ | performance-report.md (budgets + bundle facts; live p50/p95 not measurable from here) | measure in pilot week 1 |
| 17–19 A11y/mobile/browser | ✖ | not executable from this environment | pilot-plan checklist, owners assigned |
| 20 Security | ✅ | security-review.md | destructive tests never run on prod |
| 21 Dependencies | ✅ | F-3, F-13 | — |
| 22 Privacy/CDP | ◐ | engineering posture documented | counsel review (external) |
| 23 Pilot model | ✅ | pilot-plan.md | — |
| 24 Flags/providers | ✅ | environment-matrix.md §Matrix | — |
| 25 Rollback | ✅ | rollback-plan.md | — |
| 26 Decision | ✅ | release-decision.md | — |
