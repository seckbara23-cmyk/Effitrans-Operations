# Release Decision — Phase 8.0A

## Decision: **CONDITIONAL GO**

for a controlled internal pilot on release candidate `d9c2c268f03795477daa07bf4991bd7b9655e324`, under the eight conditions below. Every condition has an owner and a gate. This is **not** a GO: live operational evidence for the deployed environment does not yet exist, because production is deliberately sealed behind Vercel Deployment Protection (F-1) and this audit environment cannot cross that wall.

## Why not NO-GO

Checked against every NO-GO criterion:

| NO-GO criterion | Status | Evidence |
|---|---|---|
| Cross-tenant / cross-customer exposure | none found | real-Postgres RLS suite green in CI run #166 **on this SHA**; bidirectional suites cover all Phase-7 tables; structural adversarial tests green (2,238) |
| Unauthorized platform action | none found | identity walls (platform/tenant/portal) tested; tenant templates carry no `platform:*` (machine-enforced) |
| Secret exposure | none found | bundle scan clean; git-history scan clean; no secret ever committed; no key returned by any endpoint |
| Production login broken | not broken — **sealed** | deliberate protection wall; one-setting fix, then verify (C1) |
| Migration failure | none | 50 migrations, clean apply + seed + RLS from scratch in CI on this SHA; no destructive ops |
| Unrecoverable data-loss risk | not demonstrated, not disproven | platform backups presumed but **unverified** → C2 gates real data |
| Critical journey failure | untested live | journeys pass structurally (2,238 tests) but live evidence is required → C1 |
| AI exposing unauthorized data | none found | guardrails structural tests across all four copilots; contexts bounded + permission-degraded; audit metadata-only |
| No viable backup/rollback path | path exists, restore untested | rollback plan documented + schema-safe code rollback verified; restore drill required (C2) |

## Why not GO

GO requires live evidence this audit could not produce: the deployed app has never been exercised by a real user session end-to-end on this SHA (F-1), backup restore has never been tested (F-4), environment separation is unconfirmed (F-6), and email delivery is unproven (stub default). Claiming GO would violate the audit's own rule against claiming GO without live operational evidence.

## Conditions (all must be met; C1–C5 before pilot users, C2/C6/C7 before real data)

| # | Condition | Owner | Gate |
|---|---|---|---|
| **C1** | Open production (Deployment Protection → previews only), **verify served SHA = manifest SHA**, execute the day-0 live sweep: routes, identity matrix, five journeys (pilot-plan §Go-live 1–6). Any privilege crossover ⇒ NO-GO. | Operator + pilot lead | before first pilot user |
| **C2** | Confirm Supabase plan/backup tier; run the restore drill; record RTO evidence (backup-and-recovery.md §Drill). | Operator | before real dossiers |
| **C3** | Confirm environment separation: Preview + local do NOT point at the production Supabase project; document project refs in environment-matrix.md. Rotate keys if sharing is found. | Operator | before pilot |
| **C4** | Production config: `NEXT_PUBLIC_SITE_URL`, email provider trio (`COMMUNICATIONS_EMAIL_PROVIDER`, `RESEND_API_KEY`, `COMMUNICATIONS_EMAIL_FROM` with a verified sender domain); send + verify one live invitation. | Operator | before inviting users |
| **C5** | AI acceptance in **Preview only** (six representative questions; latency/tokens/fallback/audit recorded). Production AI remains dark until separately approved after C5 evidence. | Operator + engineering | before enabling copilots for pilot users |
| **C6** | Repository visibility decision — recommendation: **make private**. | Repo owner | before real data |
| **C7** | Privacy/CDP Senegal: counsel review + privacy notice; explicit decision on AI processing of operational data containing client names. | Business + counsel | before real customer data |
| **C8** | Schedule the Next.js 14→current upgrade as its own phase with full regression (F-3). | Engineering | before GA (not pilot-blocking) |

## Fixes implemented in this phase (audit rule: verified findings only)

| Finding | Fix | Regression test |
|---|---|---|
| F-7 middleware auth-error (production-log-verified) | `updateSession` treats any `getUser()` auth failure as signed-out → clean login redirect, no unhandled error | `tests/middleware-session.test.ts` (structural: catch present, redirect path preserved) |
| F-12 `.env.example` gaps (docs-only) | all consumed variables documented with safe defaults noted | n/a (contract file) |

No other code was changed. Speculative improvements (Sentry wiring, CSP, Node alignment, Next upgrade) were deliberately **not** implemented inside the audit.

## Standing rollback authority

Any trigger in rollback-plan.md fires without further approval. Cross-tenant exposure, privilege crossover, or AI data leakage additionally suspends the pilot pending re-audit.

## Re-issue

This decision is re-issued as **GO** when C1–C5 evidence is attached (checklist outcomes + drill record + AI acceptance record), or downgraded to **NO-GO** if any C1 identity/journey check fails on the live environment.
