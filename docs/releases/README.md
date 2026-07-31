# Effitrans Release Engineering Framework (RELEASE-0)

**Date:** 2026-07-31 · **Status:** governance documentation — no code, no migration, no CI
change, no deployment performed by this phase.

## The one fact this framework is built around

On this platform, **the deployment unit is not the application binary — it is the
migration bundle plus its activation.** Vercel continuously deploys `main` to production;
that has been true since Phase 8.0B and is not what goes wrong. What needs governance is
everything the code cannot do for itself:

1. **applying migrations** (operator-run, deliberately decoupled from deploys),
2. **activation** — permissions coming into existence, env kill-switches, tenant rollout
   rows,
3. **validation** — smoke, UAT, sign-off,
4. **the record** — what shipped, who approved it, how to undo it.

Every recent phase was engineered for this reality: code ships **ahead** of its migration
and stays safe through deliberate fallbacks (the `admin:users:manage` umbrella, the
fail-open password gate, fail-soft directory reads, permissions-that-don't-exist-yet
gating routes dark). The framework names this doctrine — **expand → activate → contract**
— and makes it the required shape of every future change.

## Documents

| Doc | Contents |
|---|---|
| [release-governance.md](release-governance.md) | Lifecycle, release types, approval matrix, required release documentation |
| [migration-governance.md](migration-governance.md) | Bundling rules, the live backlog (68–72) as the first bundles, execution/validation/failure handling, the forward-only doctrine |
| [production-readiness-and-runbook.md](production-readiness-and-runbook.md) | The readiness checklist, the reusable deployment runbook, rollback strategy |
| [smoke-tests-and-uat.md](smoke-tests-and-uat.md) | Smoke-test library per module (owner + criteria), technical-vs-business validation, sign-off matrix |
| [release-boundaries-and-dashboard.md](release-boundaries-and-dashboard.md) | The project-wide release-boundary audit (1.0 → 4.0), the release dashboard design, future automation |

## What this formalizes rather than invents

Phase 8.0 already produced one-off versions of most release artifacts:
`docs/production/release-manifest.md` (the pin), `release-decision.md` (the go/no-go),
`rollback-plan.md` (triggers + smallest-lever-first actions), `backup-and-recovery.md`,
`environment-matrix.md`, `scripts/gate/verify-production.mjs` (the automated smoke core),
`/api/version` (served-SHA verification), the `/platform/operations` console (build-info +
migration probe), and the Vercel runtime-errors tooling. RELEASE-0 turns those one-offs
into templates and standing process — reuse before rebuild applies to governance too.

## Standing rules this framework inherits (unchanged)

CI conclusions are verified **per job, per step** after every push (a skipped RLS suite is
a red flag, not a pass) · new RLS suites append **last** in the CI list · migrations are
forward-only, additive, idempotent (policy/trigger drop-guards — the migration-72 lessons)
· the migration ledger is repaired via migration history, never `db push` (the 9.0F
lesson) · no real client or personal data in fixtures, docs, or screenshots.
