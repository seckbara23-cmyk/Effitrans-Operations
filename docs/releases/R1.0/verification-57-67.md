# R1.0-R Verification Addendum — Evidence Matrix for Migrations 57–67

**Date:** 2026-07-31 · verification & documentation only — nothing executed against
production by this addendum. The consolidated read-only script is
[`verification-57-67.sql`](verification-57-67.sql); the operator runs it **before** any
ledger repair.

## What this addendum corrected in the earlier evidence

Applying the stricter standard (*verify the versioned change, not the object's
existence*) exposed **two wrong-object probes in my own earlier matrix** — exactly the
class of error the addendum was requested to catch:

1. **Migration 60** was "confirmed" via `expense_visa` — but that table is created by
   **58**. 60 creates no table at all; its real fingerprints are the
   `uq_expense_visa_attempt_step` index and the signer grants (58 deliberately granted
   `finance:expense:sign` to nobody — DEC-C11 put the signer seats in 60).
2. **Migration 63** was "confirmed" via `business_event.causation_id` — but that column is
   in **62's** `CREATE TABLE`. 63 only *replaces functions*; its versioned fingerprint is
   WES-9A's Model-A abort marker (`EF001`), present 15× in 63's bodies and 0× in 62.

Additionally, one Operator-Task-1 reading is retracted as unreliable: the REST RPC probe
reported `reconcile_step_completion` "ABSENT", but `PGRST202` also fires on a
**signature mismatch** (the function takes arguments; the probe passed none). Catalog
queries in the SQL script are definitive; REST RPC probes are not used as evidence here.

## Evidence matrix

Confidence reflects evidence **held today**; the script's run upgrades every PENDING
cell. Queries shown abbreviated — the exact executable text is in the `.sql` file.

| # | Version | Migration | Verification (exact query in script) | Expected | Actual (pre-script) | Confidence | Safe to repair? |
|---|---|---|---|---|---|---|---|
| 57 | 20260724000002 | hr_employee_registry | `to_regclass('public.employee')`, `…employee_counter`, `pg_proc next_employee_number`, `permission in ('hr:read','hr:manage')` = 2 | all true | tables + function confirmed (REST probe, validated w/ negative controls); permission rows PENDING (RLS-hidden from anon) | **CONFIRMED** (structural) | **YES** |
| 58 | 20260725000001 | expense_documents | `to_regclass('public.expense_voucher_counter')` (unique to 58), `…expense_visa`, `finance:expense:%` count = 6 | all true | counter table confirmed (probe); permission count PENDING | **CONFIRMED** (structural) | **YES** |
| 59 | 20260726000001 | expense_attachments | `to_regclass('public.expense_attachment')` | true | confirmed (probe) | **CONFIRMED** | **YES** |
| 60 | 20260726000002 | expense_approval_chain | `pg_indexes: uq_expense_visa_attempt_step`; `role_permission ∋ (TREASURER, finance:expense:sign)` | both true | **PENDING — prior evidence was wrong-object** (`expense_visa` proves 58) | **INSUFFICIENT** until script runs | only after both rows return true |
| 61 | 20260726000003 | workflow_policy_registry | `to_regclass('public.workflow_policy_version')`; `pg_indexes: uq_workflow_policy_tenant_active` | both true | table confirmed (probe) | **CONFIRMED** | **YES** |
| 62 | 20260726000004 | business_event_ledger | `to_regclass('public.business_event')`; `columns ∋ causation_id`; `pg_proc emit_business_event` | all true | table + column confirmed (probe) | **CONFIRMED** | **YES** |
| 63 | 20260727000001 | business_event_atomicity | `pg_get_functiondef(emit_business_event) LIKE '%EF001%'`; same for `emit_dossier_events` | both true | **PENDING — prior evidence (causation_id) proves 62, not 63** | **INSUFFICIENT** until script runs | only after both rows return true |
| 64 | 20260727000002 | assignment_history | `to_regclass('public.assignment_event')`; `pg_proc assign_task` | both true | table confirmed (probe) | **CONFIRMED** | **YES** |
| 65 | 20260727000003 | document_governance | `to_regclass('public.document_review')` (unique to 65); `document.superseded_by_id`; `document_status_check LIKE '%CONSUMED_AS_EVIDENCE%'` | all true | table confirmed (probe); constraint text PENDING | **CONFIRMED** (structural) | **YES** |
| 66 | 20260727000004 | generated_artifacts | `document.artifact_code` (added by 66); `pg_proc finalize_generated_artifact` | both true | column confirmed (probe) | **CONFIRMED** | **YES** |
| 67 | 20260727000005 | process_reconciliation | `to_regclass('public.evidence_consumption')` (unique to 67); `pg_proc reconcile_step_completion`; `business_event_event_domain_check LIKE '%process%'` | all true | table confirmed (probe); function + constraint PENDING (REST RPC probe retracted as unreliable) | **CONFIRMED** (structural) | **YES** |

**Limitations, stated:** REST-probe confirmations cover table/column existence only; the
permission-row, function-body and constraint-text checks require the SQL editor (they are
RLS-hidden or catalog-level) and are what the script adds. Negative controls are included
for all three probe classes (table, function, catalog row).

## Decision rule (as mandated)

- All 57–67 rows true → **proceed with the existing sixteen-version repair** (runbook §3).
- Any row false or unclear → **STOP.** Narrow the repair to the confirmed prefix only,
  and investigate the failing migration before touching its ledger entry. Application
  screenshots, phase reports and commit history are **not** admissible substitutes.

## Current recommendation

**CONDITIONAL GO for the 57–72 repair** — conditional on exactly two things the script
settles: the 60 rows (index + signer grants) and the 63 rows (`EF001` in both function
bodies). Everything else is CONFIRMED on validated structural evidence today. Given that
60 and 63 sit *between* confirmed migrations that depend on them (61–67's objects exist
and 64/65/67 build on 62/63's ledger machinery), a false result would be surprising — but
surprise is what verification is for, and the decision rule stands.

## Operator sequence (verbatim contract)

```
1. Run docs/releases/R1.0/verification-57-67.sql in the Supabase SQL editor (read-only).
2. Share the result set (all rows).
3. Results are reviewed against this matrix.
4. If ALL eleven migrations verify → execute the 16-version repair (runbook §3.3).
5. Verify the ledger reads 72/72 (runbook §3.4) + spot-checks (§3.5).
6. Perform the full R1.0 smoke/UAT checklist (smoke-uat-checklist.md §A–C).
7. Only after R1.0 sign-off may R1.1 (§D) begin.
```
