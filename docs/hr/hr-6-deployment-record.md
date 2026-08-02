# HR-6 — Deployment Record & Sequencing Deviation

**Date:** 2026-08-02 · **Migrations:** 78 `20260803000001_hr_performance.sql`,
79 `20260803000002_hr_training.sql` · **Production:** `xtpppzhkiagdpmnghdlc`
· **Ledger:** 79/79

---

## 1. DEVIATION — DEV-HR6-01: production applied before CI green

**The standing rule** (HR-6 mission §16, and the framework since RELEASE-0):
*"no production application until CI proves the clean 1→new chain"*, and
*"operator must wait for CI green before production application."*

**What happened.** Migrations 78 and 79 were applied to production while CI on
`91bb84c` was still running. That CI run subsequently came back **RED**
(`rls-tests` failed, 1 step failed, 1 step skipped), so at the moment of
application the chain had **not** been proven — and shortly afterwards was
demonstrably not green.

**Severity: LOW — and the reason is specific, not reassurance.** The CI failure
was located and it was in a **test assertion, not in either migration**:
`rls_hr_performance_test.sql` counted `objective_assigned` ledger events *before*
the amendment that emits the second one, and asserted 2. The fix commit
`cb5f736` therefore changed **exactly one file — the test** — which is
verifiable rather than asserted:

```
$ git diff --name-only 91bb84c cb5f736 -- supabase/migrations/ | wc -l
0
$ git diff --stat 91bb84c cb5f736
 supabase/tests/rls_hr_performance_test.sql | 6 ++++--
```

**The SQL applied to production is byte-identical to the SQL CI validates.**
No migration content changed between the applied commit and the green one.

**Why this is still recorded as a deviation.** That the risk did not materialise
is a fact about *this* failure, not about the rule. The rule exists precisely
because nobody knows, at application time, which of the two cases they are in —
and here the red run could just as easily have been a schema defect. A
compensating control (the byte-identical diff above) is not the same as the
control that was skipped.

**Aggravating factor worth naming.** The red run **skipped**
`rls_hr_training_test.sql` entirely — the aborting-step cascade this project has
been bitten by before. So at the moment migration 79 was applied to production,
**its RLS suite had never executed anywhere.** Its first execution is the
`cb5f736` run.

**Corrective action.** None to the schema. The control to reinforce is
procedural: application waits for a green run *and* a per-step check showing
zero skipped, because a green summary can hide a skipped suite.

---

## 2. Independent production verification

Performed by Claude against the linked production project, read-only. **Project
ref confirmed `xtpppzhkiagdpmnghdlc` before any command** (INC-HR3-01 discipline).

### 2.1 Migration ledger — PASS

`supabase migration list --linked`, parsed:

| Check | Result |
|---|---|
| Total rows | **79** |
| Local entries | 79 |
| Remote entries | 79 |
| In lockstep (local = remote) | **79** |
| Mismatched (local xor remote) | **none** |
| Last three | `20260802000003`, `20260803000001`, `20260803000002` |

Independently confirms the operator's history-only repair. **No replay was
performed or instructed.**

### 2.2 Tables — PASS (9/9)

`supabase inspect db table-stats --linked` — 134 public tables. All nine HR-6
tables present: `hr_performance_cycle` · `hr_competency` ·
`hr_competency_expectation` · `hr_evaluation` · `hr_objective` ·
`hr_competency_assessment` · `hr_training_course` · `hr_training_plan` ·
`hr_training_enrollment`.

**Control group** (`employee`, `hr_leave_request`, `hr_equipment`, `hr_document`,
`audit_log`) all present — the probe is proven to work before its result is
trusted. *A first pass compared bare names against a schema-qualified
(`public.x`) field and reported 0/9; that was a parser defect, caught by the
control, not a production finding.*

### 2.3 Indexes — PASS (13/13)

`supabase inspect db index-stats --linked`. All thirteen HR-6 indexes present,
**including `idx_enrollment_expiry`**, the last index in migration 79's DDL
section — evidence that both files executed well past their `create table`
statements rather than partially.

### 2.4 Residual checks — operator-verifiable

The CLI available here exposes stats, not catalogue queries, and this
environment has **no Docker** (so `supabase db dump` is unavailable) and **no
production Supabase keys** in `.env.local` (so the PostgREST probe path is
closed). Three checks therefore remain outside what I can verify independently:

```sql
-- 1. the new permission exists, and is granted to NOBODY (the whole point)
select count(*) from public.permission where code='hr:performance:finalize';       -- expect 1
select count(*) from public.role_permission rp join public.permission p
  on p.id=rp.permission_id where p.code='hr:performance:finalize';                 -- expect 0

-- 2. the nine transactional RPCs exist
select count(*) from pg_proc where proname in ('hr_open_performance_cycle',
  'hr_submit_self_assessment','hr_submit_manager_review','hr_finalize_evaluation',
  'hr_acknowledge_evaluation','hr_assign_objective','hr_assign_training',
  'hr_complete_training','hr_close_training_enrollment');                          -- expect 9

-- 3. RLS is enabled with a SELECT policy on all nine tables
select count(*) from pg_policies where schemaname='public' and policyname like '%_select'
  and tablename in ('hr_performance_cycle','hr_competency','hr_competency_expectation',
    'hr_evaluation','hr_objective','hr_competency_assessment',
    'hr_training_course','hr_training_plan','hr_training_enrollment');             -- expect 9
```

**These are read-only**, and they are now *belt-and-braces* rather than
outstanding risk. The reasoning, stated as the inference it is:

* The Supabase migration runner wraps **each migration file in a transaction**,
  and neither file contains an explicit `COMMIT`. A migration therefore either
  commits whole or not at all — partial application is not a state these files
  can reach.
* The ledger records both files as applied, and objects from the **end** of each
  file's DDL section are present in production (`idx_enrollment_expiry` is the
  last index in migration 79).
* Therefore the statements *after* those indexes — the permission insert, the
  nine functions, the RLS enables and policies — committed in the same
  transaction.
* CI independently executed those same statements on a clean 1→79 chain and
  asserted their effects, including `perm_rows=1 / perm_grants=0` and
  `perms=0` (no unintended permission code), on real PostgreSQL.

So the honest final statement is: **tables and indexes directly observed in
production; permission row, grants, RPCs and RLS policies established by
transactional atomicity plus CI, not by direct observation.** The three queries
remain available for anyone who wants direct observation, and running them costs
nothing.

---

## 3. CI evidence — run `30751865999`, commit `fc04190`

| Job | Conclusion | Steps | Skipped | Failed |
|---|---|---|---|---|
| `build` | **success** | 10 | **0** | 0 |
| `rls-tests` | **success** | 72 | **0** | 0 |

All seven HR RLS suites executed and passed, by name — HR-1 registry · HR-1
organization · HR-3 documents · HR-4 onboarding · HR-5 leave · **HR-6
performance** · **HR-6 training**. Zero skipped is asserted per step, not
inferred from a green summary.

**Two red runs preceded it, and both failures were in test assertions, never in
a migration:**

| Run | Commit | Failure | Cause |
|---|---|---|---|
| 30749600980 | `91bb84c` | HR-6 performance suite; **training suite SKIPPED** | `objective_assigned` counted before the amendment that emits the second event |
| 30749833283 | `cb5f736` | HR-6 training suite (first execution anywhere); 0 skipped | `training_assigned`/`training_completed` counted before the second enrollment |

The second fix moved **all** ledger counts to after all activity rather than
adjusting a number, because the same mistake had now occurred twice.

**No migration file changed across any of it:**

```
$ git diff --name-only 91bb84c fc04190 -- supabase/migrations/ | wc -l
0
```

## 4. DEV-HR6-01 — CLOSED

**Final disposition: CLOSED, no harm, control reinforced.**

The deviation was real: production was applied while the chain was unproven, and
the run at that moment was in fact red. The harm did not materialise, and the
reason is now verifiable rather than hopeful — every failure was in test
assertions, and the migration SQL in production is byte-identical to the SQL that
went green (`0` files differing across three commits).

**What was genuinely exposed:** when migration 79 was applied, its RLS suite had
**never executed anywhere** — it had been skipped behind an aborting step. That
suite has since run and passed, so the exposure is retired; but it is the part of
this deviation that could have gone badly, and it is the reason the rule exists.

**Control reinforced:** application waits for a green run **and** a per-step
check showing zero skipped. A green *summary* can hide a skipped suite; a green
summary is not evidence.

**No corrective action to schema or data. No replay was performed or
instructed.**

## 5. Verdict

**HR-6 deployment: PASS.** Ledger 79/79 · 9/9 tables · 13/13 indexes · CI green
with zero skipped and both HR-6 suites executed. **DEV-HR6-01 closed.**
