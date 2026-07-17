# Release Manifest — Phase 8.0A Release Candidate

Reproducible pin of exactly what was audited. **The deployed commit must match this manifest at pilot start** (verification step in rollback-plan.md §Verify).

## Code

| Item | Value |
|---|---|
| Git commit (audited) | `d9c2c268f03795477daa07bf4991bd7b9655e324` |
| Branch | `main` |
| Commit title | Phase 7.7: Executive Intelligence Dashboard |
| Repository | github.com/seckbara23-cmyk/Effitrans-Operations (**public** — finding F-2) |
| Working tree at audit | clean except one untracked non-code file (`Effitrand SaaS Discovery Questionnaire.docx`) |

## Verification on this SHA

| Check | Result | Evidence |
|---|---|---|
| Unit suite | **2,238 tests / 128 files — green** | local run, 2026-07-17 (Node 24.11.1) |
| Typecheck | clean (`tsc --noEmit` exit 0) | local + CI |
| Production build | clean — 96 pages, 16 API routes compiled | local `next build` + CI |
| CI (GitHub Actions) | **Run #166 — success** (jobs: `build`, `rls-tests`) | api.github.com, head_sha = release SHA |
| Real-Postgres RLS suite | **green in CI** (`rls-tests`: `supabase start` on CLI 2.106.0 → full migration sequence → seed → RLS regression SQL with ON_ERROR_STOP) | CI run #166 |
| Clean migration reset | proven by the same CI job (fresh DB every run) | CI run #166 |
| npm audit | 1 high (Next.js — F-3, triaged), 1 moderate (esbuild dev-only — F-13) | local |
| Client-bundle secret scan | no key patterns; no server-only env names | local `.next/static` scan |

## Database

| Item | Value |
|---|---|
| Migration count | **50** (`20260613000001` … `20260719000001_executive_dashboard.sql`) |
| Duplicate timestamps | none |
| Destructive operations | none (no drop table/column, truncate, unguarded delete) |
| Seed | roles/permissions/catalog only; **no auth users, no passwords** |
| Latest migration | `20260719000001_executive_dashboard.sql` (permission grant only) |

## Deployment (Vercel)

| Item | Value |
|---|---|
| Team | `team_Wp0z3ITrNPAmPWmCVhyFpIxF` (seckbara23-6470's projects) |
| Project | `effitrans-operations` (`prj_9ADulyKEFY5s7pwxHqIFgojV5Vcn`), framework nextjs, Node **24.x** (CI tests Node 20 — F-11) |
| Production build of the audited SHA | `dpl_FFD4joXmeZLkpsQYyDMtLPppVzGn` — **READY**, target production, `githubCommitSha` = release SHA |
| Deployment trigger | git push to `main` (auto); manual dashboard redeploys observed during audit (F-5) |
| Domains | `effitrans-operations-seckbara23-6470s-projects.vercel.app` + git-main alias — **no custom domain** |
| Deployment protection | **ON for production** (302 → Vercel SSO) — F-1, must be flipped at pilot start |
| Runtime errors (7 d) | only the F-7 auth-refresh cluster (8 events, 1 user); no 5xx clusters |

⚠️ Because manual redeploys were in flight when the audit closed, **the operator must confirm the production alias serves this SHA** before pilot start (`x-vercel-id` + a 7.7-only route such as `/dashboard/executive` rendering, or the deployment list showing this SHA as current).

## Supabase

| Item | Value |
|---|---|
| Project ref / environment | **unverified from this environment** (management API token not available here) — F-6 |
| Applied migrations vs repo | to be confirmed by operator (`supabase migration list` against prod) — expected: the 50-migration sequence |
| Auth providers | email/password + Google OAuth (staff + portal), per code |
| Storage buckets | `documents` (private), `brand-assets` (public) — per migrations |

## Feature flags & providers at the release candidate (code defaults; per-env values in environment-matrix.md)

| Surface | Default state |
|---|---|
| AI copilots (all four) | enabled path exists; **dark unless a provider key is configured**; kill switch `AI_COPILOT_ENABLED=false` |
| Local AI providers (Ollama/vLLM) | **dark** (`AI_LOCAL_PROVIDER_ENABLED` default false) + refused on Vercel unless HTTPS+auth |
| Email | **no-op stub** unless `COMMUNICATIONS_EMAIL_PROVIDER` set; `resend.dev` sender blocked in production |
| Payments | **dark** (`PAYMENTS_ENABLED` default false; providers MOCK-only by default) |
| Real-time tracking | **dark** (master + 4 sub-flags default false) |
| Process engine (26-step) | **dark** (`EFFITRANS_PROCESS_ENGINE_ENABLED` + sub-flags default false) |
| GAINDE / carrier / AIS / airline APIs / OCR | not configured — honest stubs (`not_configured`), by design |

## External dependencies

GAINDE (blocked), carrier/AIS/airline/ADS-B (deferred), Azure OCR (conditional on DPA + eval — 7.4C-0), OpenAI production project (not created), Resend sender domain (unverified), CDP Senegal counsel review (open).
