# Release Status — standing table (updated at every release event)

*Last updated: 2026-08-02 (**HR-6 CLOSED** — migrations 78–79 applied, ledger **79/79**,
CI green with zero skipped; deployment PASS with **DEV-HR6-01** recorded and closed. See
`docs/hr/hr-6-deployment-record.md`. Previously: **R1.0 RELEASED** 2026-08-01 — §3 all
PASS, §4 signed, `release-signoff-R1.0.md` §7).*

> **DEV-HR6-01 (2026-08-02) — sequencing deviation, CLOSED.** Migrations 78–79 were
> applied to production *before* CI was green, against the standing rule; the run at that
> moment was in fact red. **No harm, verifiably:** both CI failures were in test
> assertions, and `git diff --name-only 91bb84c fc04190 -- supabase/migrations/` returns
> **0 files** — the SQL in production is byte-identical to the SQL that went green. The
> real exposure was that migration 79 was applied while its RLS suite had **never executed
> anywhere** (skipped behind an aborting step); that suite has since run and passed.
> **Control reinforced: application waits for a green run AND a per-step check showing
> zero skipped — a green summary can hide a skipped suite.**

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
| ~~R1.0~~ | ✅ **RELEASED 2026-08-01** — moved to Deployment history | signed: `release-signoff-R1.0.md` §4/§7 | — |
| **R1.1** | ⏸ **ACCEPTANCE DEFERRED 2026-08-01** (management decision): implementation complete, preview infrastructure live (`qrotqyaaugyzgljcwcpg`, corrected dataset `3c2cb58`); remaining work is **acceptance/governance only** (D2 visual review → D5 flag → D6 smoke → D7 DAF). Production flag stays **unset** until the gates complete. D1 ✅ D3 ✅ D4 ✅ | parked at D2 | resumes on management go |
| **R2.0 — HR** *(active focus)* | **HR-1 → HR-6 DEPLOYED** (**HR-6 CLOSED 2026-08-02**: migrations **78–79**, ledger **79/79**; performance cycles, objectives, competencies, evaluations + training register live-dark; **one** new permission `hr:performance:finalize`, **granted to nobody** pending RATIFY-HR6-1; no scoring formula, no LMS, no procurement — each pinned absent by test; **DEV-HR6-01** early-application deviation recorded and closed. Reports: `docs/hr/hr-6-completion-report.md`, `docs/hr/hr-6-deployment-record.md`). Previously: (HR-5 closed 2026-08-02: migration **77**, ledger **77/77**; leave + attendance live-dark, ON_LEAVE derived, `hr:leave:approve` ungranted pending ratification). Previously: (HR-4 closed 2026-08-02: migration **76**, ledger **76/76**; onboarding cases, checklists, equipment custody + 4 transactional RPCs live-dark; department icons made distinct). Previously: (HR-3 closed 2026-08-02: migration **75**, ledger **75/75** after INC-HR3-01 drift repair; employee file + contracts live-dark; `employee_identifier` withheld per DEC-B63). Previously: (HR-2 closed 2026-08-02: migration **74** applied, ledger **74/74**; assignment engine + timeline ledger + EMPLOYEES staging live-dark; ADR-HR2-01 recorded). Previously: HR-1 — migration **73 applied in production** (operator; ledger repaired → **73/73**); dashboard + org foundation + config center + import staging live-dark; `hr:config:manage`/`hr:sensitive:read` catalog-only, **0 grants verified in prod** (B1 pause intact). Report: `docs/hr/hr-1-completion-report.md` | HR-1 & HR-2 **CLOSED**; HR-3 brief ready (`docs/hr/hr-3-implementation-brief.md`), awaits explicit approval | B1 grant ratification · B2 structure seeds · B3 purge window (blocks batch application only) |
| R1.2 | FIN-AGING-4 legacy import (unbuilt) | specified | R1.1 |
| R2.0 | HR-1..HR-4 (unbuilt; registry live **and its migration applied** — HR-1 runs in production already, gated by `hr:read` holders) | architecture ratified | HRQ-D2 · structure answers · go |

## R1.0 closure documents

| Document | Purpose |
|---|---|
| [`R1.0/operator-validation-checklist.md`](R1.0/operator-validation-checklist.md) | executable A2/A3/B1–B4: exact URL, seat, clicks, expected, pass/fail, remedy |
| [`release-signoff-R1.0.md`](release-signoff-R1.0.md) | the official sign-off record — R1.0 closes only when signed |

## Outstanding UAT

**R1.0 UAT complete 2026-08-01** — B1 (H1 = H2 = H3 on `EFT-INV-2026-00001`), B2
(positive target; negative control not executable — limitation recorded), B3
(`EFT-IMP-2026-00003` → Clôturé), B4 (temp-password lifecycle) all PASS.
**Still open, deferred with recorded triggers:** B4 expired path (preview-only) · B2
negative control (first non-customs dossier) · B1 corrected-layout check (next new
invoice, `uat2b-2`) · aging preview visual checklist (**D2**, blocks R1.1).

## Known decision blockers

~~Q-01~~ **CLOSED 2026-08-01**, verbatim: « Montant = outstanding balance as of the
reporting date. » (Finance Manager — unblocks R1.1 D1) · HRQ-D2 ceiling
9→11 · HRQ-A4 staging purge · HRQ-D1 reason vocabulary · DEC-B63 legal gates ·
Messaging Center activation state — *verify at R3.0 planning*.

**Opened by HR-6 (2026-08-02), all management — no operator action:**
**RATIFY-HR6-1** which seat holds `hr:performance:finalize` (**nothing can be finalized
until granted**; note the finalizer≠reviewer constraint means a single-seat HR department
cannot finalize at all) · **HRQ-P1** employee self-service (today self-assessment is
entered by HR *on the employee's behalf*) · **HRQ-P2** manager-scoped write authority
(*would amend DEC-B63*) · **HRQ-P3** aggregate scoring formula (none exists; primitives
only) · **HRQ-P4** the competency framework (catalogue ships empty by design).

## Deployment history

| Release | Date | SHA | Migrations | Sign-off |
|---|---|---|---|---|
| — (pre-framework) | ≤ 2026-07-31 | rolling | 1–72 applied (57–72 outside the ledger; reconciliation = R1.0-R) | Phase 8.0 gate documents |
| R1.0-R (ledger reconciliation) | 2026-07-31 | `1abccda` (no code change; app already served it) | ledger repaired to **72/72** — `migration repair --status applied` × 16 (`20260724000002` → `20260729000002`); no DDL; schema spot-checks unchanged | verification 30/30 (operator) · repair GO (operator) |
| **R1.0** (reconciliation + validation) | 2026-07-31 → **2026-08-01 RELEASED** | `c29b7cf` at completion (post-sanitation head) | none — validation only. Side products shipped during UAT: invoice-renderer geometry fix `733c116` (`uat2b-2`, immutable artifacts untouched) + history sanitation (5 SHAs remapped) | A1–A3, B1–B4 **all PASS** (B2 with stated limitation) · **§4 signed 2026-08-01** (Bara Seck, all seats; provenance note in the sign-off) |
| **HR-1** (Dashboard & Organization Foundation) | 2026-08-01 **DEPLOYED** | `43bf42e` (migration) / `c47f95b` (repo at deploy) | **73** applied in production by the operator after the `scope`→`data_scope` correction; ledger repaired → **73/73**; prod verification: 2 permission rows · **0 grants** (B1 pause) · all tables present | operator deployment PASS · CI 67/67 RLS steps ×2 · business gates open (B1/B2/B3) |
| **HR-6** (Performance & Training) | 2026-08-02 **CLOSED** | `91bb84c` (migrations) → `fc04190` (CI green; **no migration file differs**) | **78–79** applied by the operator **ahead of CI** (DEV-HR6-01); ledger repaired → **79/79**. Independent verification: ledger 79/79 zero-mismatched · **9/9 tables** (control group first) · **13/13 indexes** incl. the last of migration 79 | deployment **PASS** · CI run `30751865999` **green, 72+10 steps, 0 skipped, 0 failed**, both HR-6 suites executed by name · DEV-HR6-01 **closed** · open: RATIFY-HR6-1 + HRQ-P1..P4 (**management, not operator**) |
