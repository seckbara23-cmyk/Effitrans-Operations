# Release Status — standing table (updated at every release event)

*Last updated: 2026-07-31 (R1.0-R — **ledger reconciliation EXECUTED**: 16-version
repair applied under operator GO after 30/30 verification rows passed; ledger reads
**72/72**).*

> **Correction (2026-07-31).** The previous version of this table stated "schema current
> through migration 67; 68–72 pending". The Operator-Task-1 audit proved that wrong:
> **migrations 57–72 are all structurally present in production**; only the *ledger*
> stops at 56 (`20260724000001`). The error came from inferring state from phase reports
> instead of probing — the exact drift the release framework exists to catch, caught on
> its first run.

> **History sanitation, 2026-07-31.** Two business documents were committed by mistake into
> a public repository and were purged from git history with `git-filter-repo`, followed by a
> lease-guarded force-push. **Five commit SHAs changed as a result. No application behaviour,
> code, schema or configuration changed** — the trees are identical apart from the two
> removed files. Full mapping and verification in
> [`R1.0/history-sanitation-2026-07-31.md`](R1.0/history-sanitation-2026-07-31.md). Every SHA
> cited elsewhere in this document predates the rewrite and still resolves.

## Current production (verified 2026-07-31, post-repair)

| Item | Value |
|---|---|
| Application | serves `main` HEAD (verified `1abccda` post-repair) via `/api/version` |
| Schema | **structurally current through migration 72** (probes + manual SQL audit + 30/30 verification script; evidence in `R1.0/verification-57-67.md`) |
| Migration ledger | **72 / 72 recorded** — reconciled 2026-07-31 via `migration repair --status applied` (16 versions, history-only; runbook §3.3); post-repair list: zero unrecorded, zero LOCAL≠REMOTE, last `20260729000002`. Operator SQL confirms `schema_migrations` = 72, `admin:users:%` = **8** (7 granular + retained umbrella `admin:users:manage`), `finance:aging:%` = 11 |
| Activation state | Aging dark via unset `EFFITRANS_FINANCE_AGING_ENABLED` (route 404s); permission grants for 70/71/72 live in DB per manual audit; rollout-row states unverified read-only |

## Pending releases

| Release | Content (REVISED) | State | Blockers |
|---|---|---|---|
| **R1.0-R** | **Ledger reconciliation DONE** (16 versions repaired, 72/72 verified, schema untouched) — remaining: smoke/UAT §A–C + sign-off | repair executed 2026-07-31 | operator UAT (B1–B4) + sign-offs |
| **R1.1** | **Activation only**: flag flip + smoke + sign-off (schema + grants already live) | checklist ready: `R1.0/smoke-uat-checklist.md` §D | Q-01 · preview visual sign-off · R1.0 complete |
| R1.2 | FIN-AGING-4 legacy import (unbuilt) | specified | R1.1 |
| R2.0 | HR-1..HR-4 (unbuilt; registry live **and its migration applied** — HR-1 runs in production already, gated by `hr:read` holders) | architecture ratified | HRQ-D2 · structure answers · go |

## R1.0 closure documents

| Document | Purpose |
|---|---|
| [`R1.0/operator-validation-checklist.md`](R1.0/operator-validation-checklist.md) | executable A2/A3/B1–B4: exact URL, seat, clicks, expected, pass/fail, remedy |
| [`release-signoff-R1.0.md`](release-signoff-R1.0.md) | the official sign-off record — R1.0 closes only when signed |

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
| R1.0-R (ledger reconciliation) | 2026-07-31 | `1abccda` (no code change; app already served it) | ledger repaired to **72/72** — `migration repair --status applied` × 16 (`20260724000002` → `20260729000002`); no DDL; schema spot-checks unchanged | verification 30/30 (operator) · repair GO (operator) · **UAT §A–C pending** |
