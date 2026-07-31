# Release Status — standing table (updated at every release event)

*Last updated: 2026-07-31 (R1.0-R — production state verified; reconciliation package
prepared).*

> **Correction (2026-07-31).** The previous version of this table stated "schema current
> through migration 67; 68–72 pending". The Operator-Task-1 audit proved that wrong:
> **migrations 57–72 are all structurally present in production**; only the *ledger*
> stops at 56 (`20260724000001`). The error came from inferring state from phase reports
> instead of probing — the exact drift the release framework exists to catch, caught on
> its first run.

## Current production (verified 2026-07-31, read-only audit)

| Item | Value |
|---|---|
| Application | serves `main` HEAD (verified `a4b07d7` at audit time) via `/api/version` |
| Schema | **structurally current through migration 72** (probes + manual SQL audit; evidence matrix in `R1.0/reconciliation-runbook.md`) |
| Migration ledger | **56 / 72 recorded** — 16 versions unrecorded (`20260724000002` → `20260729000002`); **repair pending** |
| Activation state | Aging dark via unset `EFFITRANS_FINANCE_AGING_ENABLED` (route 404s); permission grants for 70/71/72 live in DB per manual audit; rollout-row states unverified read-only |

## Pending releases

| Release | Content (REVISED) | State | Blockers |
|---|---|---|---|
| **R1.0-R** | **Ledger reconciliation** (repair 16 versions — no DDL) + the outstanding UAT (three-hash, Douane, closure, temp password) | package ready: `R1.0/` | operator execution |
| **R1.1** | **Activation only**: flag flip + smoke + sign-off (schema + grants already live) | checklist ready: `R1.0/smoke-uat-checklist.md` §D | Q-01 · preview visual sign-off · R1.0 complete |
| R1.2 | FIN-AGING-4 legacy import (unbuilt) | specified | R1.1 |
| R2.0 | HR-1..HR-4 (unbuilt; registry live **and its migration applied** — HR-1 runs in production already, gated by `hr:read` holders) | architecture ratified | HRQ-D2 · structure answers · go |

## Outstanding UAT (defined, not yet run)

Three-hash (B1) · Douane discovery (B2) · closure EFT-IMP-2026-00003 (B3) · temp-password
lifecycle incl. expired path via preview (B4) · aging preview visual checklist (D2).

## Known decision blockers

Q-01 (« Montant » = outstanding — required verbatim closure for R1.1) · HRQ-D2 ceiling
9→11 · HRQ-A4 staging purge · HRQ-D1 reason vocabulary · DEC-B63 legal gates ·
Messaging Center activation state — *verify at R3.0 planning*.

## Deployment history

| Release | Date | SHA | Migrations | Sign-off |
|---|---|---|---|---|
| — (pre-framework) | ≤ 2026-07-31 | rolling | 1–72 applied (57–72 outside the ledger; reconciliation = R1.0-R) | Phase 8.0 gate documents |
