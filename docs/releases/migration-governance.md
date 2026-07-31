# Migration Governance — Bundles, Execution, Validation, Failure Handling

Part of [RELEASE-0](README.md). No migration is executed by this phase.

## 1. Doctrine (already practiced; now stated as policy)

- **Forward-only.** No down-scripts exist and none will be written; reversal is forward-fix
  or restore. Every migration must therefore be **additive** and **idempotent** — policy
  and trigger drop-guards included (`CREATE POLICY` has no `IF NOT EXISTS`; `create
  trigger` needs `drop trigger if exists` — the migration-72 lessons, now test-pinned for
  aging and mandatory for all future migrations).
- **Expand → activate → contract.** Code that needs a migration ships *first*, engineered
  to be safe without it (fallback permissions, fail-open policy gates, fail-soft column
  reads, routes dark because their permission does not exist). The migration is the
  *activation half*. Contraction (removing fallbacks like the `admin:users:manage`
  umbrella) is its own later release, never bundled with expansion.
- **The ledger is truth, and it is repaired honestly.** Applied-state is tracked by the
  Supabase migration history; a history gap is repaired via migration-history commands,
  **never** `db push` (the 9.0F incident: prod schema was current, the ledger was not —
  pushing would have re-run DDL against live objects).
- **CI is the rehearsal.** Every bundle has already executed, in order, from empty, on
  every CI run (`supabase db reset` applies all migrations + seed before 58 RLS suites).
  A bundle that has never been through CI does not exist.

## 2. Bundling rules

1. A bundle = consecutive migrations released together under one manifest.
2. **Ratified sequencing is never re-bundled**: management ordered 68→71 (+ their UAT
   gates) *before and separate from* 72. The framework respects standing ratifications
   even where a single bundle would be operationally convenient.
3. A bundle must be **UAT-able as a unit**: everything needed to validate it is inside it
   or already live.
4. Activation (grants coming into existence, env flags, tenant rollout rows) is listed in
   the manifest next to the migrations — an unlisted activation is a defect.

## 3. The live backlog, bundled (the concrete first releases)

> **AUDIT OUTCOME (2026-07-31, Operator Task 1 + manual SQL audit):** the bundles below
> were written assuming 68–72 were unapplied. Production probes proved **57–72 are all
> structurally applied**; only the ledger (56/72) lags. R1.0 therefore became **R1.0-R —
> ledger reconciliation, not DDL deployment**: see `R1.0/reconciliation-runbook.md` for
> the evidence matrix and the exact `migration repair` commands (all 16 versions — five
> alone would leave 57–67 as pending non-idempotent booby traps). The §3 tables below are
> retained as the per-migration *validation* reference, which is unchanged. This is the
> §1 verify-first rule doing its job on its first outing.

### Bundle R1.0 — Governance & Finance Consolidation (migrations 68–71)

| # | Migration | Delivers | Post-migration validation |
|---|---|---|---|
| 68 | `20260728000001_invoice_artifact_and_charge_uniqueness` | official-invoice artifact + charge uniqueness | `document_type` has `OFFICIAL_INVOICE`; `uq_invoice_line_charge_once` exists; then the UAT-2B three-hash smoke |
| 69 | `20260728000002_customs_department_discovery` | Douane dossier discoverability | unassigned customs login sees required-customs dossiers |
| 70 | `20260728000003_file_transition_permission` | `file:transition` + grants | permission row exists; OPS_SUPERVISOR holds it; « Avancer » renders |
| 71 | `20260729000001_user_administration_and_password_lifecycle` | `admin:users:*` (7) + staff password lifecycle columns | permission rows exist; `app_user.must_change_password` present; temp-password UAT |

Prerequisites: current backup confirmed; `/api/version` SHA = manifest SHA.
Estimated duration: seconds each (additive DDL + catalog inserts; no table rewrites — the
`file_id` NOT NULL drop in 72 is metadata-only too). Run in one sitting, in order.

### Bundle R1.1 — Finance Aging Foundation (migration 72)

`20260729000002_aging_balance_foundation` — after R1.0's UAT gates close **and** the aging
preview sign-off + Q-01 confirmation. Validation: the four-row probe already documented in
the aging preview runbook (tables exist, `invoice.provenance` present, `file_id` nullable,
11 permission rows), then the aging RLS invariants are trusted from CI (they ran 58/58).

### Verify-first note

Before R1.0 executes, the operator confirms none of 68–72 was ever hand-applied
(the information_schema probes per migration above). Any surprise → stop, reconcile the
ledger per §1, re-plan.

## 4. Execution protocol (per bundle)

```
1. Freeze: no merges to main during the window (short — minutes, not hours)
2. Backup checkpoint recorded (docs/production/backup-and-recovery.md procedure)
3. For each migration, in order:
     a. apply (supabase migration up / dashboard SQL per environment-matrix)
     b. run its validation probe (§3 tables)
     c. record result in the manifest
     d. FAILURE → stop the bundle. Do not skip forward. Diagnose:
          - error on already-existing object → ledger gap → repair history, re-verify
          - real DDL failure → the transaction rolled back whole → forward-fix in a new
            migration; the bundle re-enters CI before another attempt
4. Post-bundle: core smoke sweep (verify-production.mjs + /api/version SHA check),
   /platform/operations migration probe shows the expected latest migration
5. UAT window opens; sign-off closes the release
```

## 5. Failure handling & rollback expectations

| Failure point | Response |
|---|---|
| Migration errors mid-bundle | transaction rolls back whole (CLI wraps each migration); **stop**, diagnose per §4.3d; never bypass with manual DDL |
| Migration applied, smoke fails | prefer forward-fix (the code fallbacks mean a bad activation usually degrades, not breaks); deactivate via flag/grant-revocation where the failure is activation-level |
| Data damage discovered | `docs/production/rollback-plan.md` CRITICAL path: stop writes, assess via audit_log, restore per backup-and-recovery — **restore is the last resort and announces a data-loss window first** |
| Old code needed | Vercel promote-previous — but **never across a migration boundary backwards**; if the schema moved, fix forward |
