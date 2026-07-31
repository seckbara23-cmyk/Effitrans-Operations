# R1.0-R — Production Ledger Reconciliation Runbook

**Date:** 2026-07-31 · **Type:** operator instructions — nothing in this document executes
anything. The operator runs the commands; every command here is either read-only or a
**ledger-history repair** (the sanctioned CLI mechanism). No DDL. No `db push`. No manual
SQL on `supabase_migrations`. No re-run of any migration.

## 1. Production-state conclusion

**The production schema is ahead of the migration ledger.** The ledger records 56 of 72
migrations (last: `20260724000001`); structural probes (automated, 2026-07-31) and the
manual SQL-editor audit (operator, 2026-07-31) together confirm the objects of **all
sixteen unrecorded migrations** exist in production. Migrations 68–72 **must not be
executed again** — and neither may 57–67.

### ⚠️ Scope extension beyond the mission as stated — with its reason

The mission names five versions (68–72). The audit found **sixteen** unrecorded versions
(57–72). Repairing only the last five would leave a hole in the middle of the ledger:
57–67 would still read as *pending*, and any future `supabase migration up` would try to
execute them against a schema where they already ran. Nine of those eleven contain **bare
`CREATE TABLE`** (they predate the idempotency policy), so that attempt fails hard on
"relation already exists" — or worse, tempts someone toward `db push`. **The repair
therefore covers all sixteen versions.** Every one has direct structural evidence (§2).

## 2. Evidence matrix

| # | Version | Migration | Evidence the objects exist in production | Source |
|---|---|---|---|---|
| 57 | 20260724000002 | hr_employee_registry | `employee`, `employee_counter` present | probe 2026-07-31 |
| 58 | 20260725000001 | expense_documents | `expense_authorization_counter` present | probe |
| 59 | 20260726000001 | expense_attachments | `expense_attachment` present | probe |
| 60 | 20260726000002 | expense_approval_chain | `expense_visa` present | probe |
| 61 | 20260726000003 | workflow_policy_registry | `workflow_policy_version` present | probe |
| 62 | 20260726000004 | business_event_ledger | `business_event` present | probe |
| 63 | 20260727000001 | business_event_atomicity | `business_event.causation_id` present | probe |
| 64 | 20260727000002 | assignment_history | `assignment_event` present | probe |
| 65 | 20260727000003 | document_governance | `document_review` present | probe |
| 66 | 20260727000004 | generated_artifacts | `document.artifact_code` present | probe |
| 67 | 20260727000005 | process_reconciliation | `evidence_consumption` present | probe |
| 68 | 20260728000001 | invoice_artifact_and_charge_uniqueness | `uq_invoice_line_charge_once`, `OFFICIAL_INVOICE` in `document_type`, `document.invoice_id` | probe + **manual SQL audit** |
| 69 | 20260728000002 | customs_department_discovery | `user_readable_file_ids(uuid,uuid)` contains the customs branch (`customs_record`, `CUSTOMS_FIELD_AGENT`) | **manual SQL audit** |
| 70 | 20260728000003 | file_transition_permission | `file:transition` in `public.permission` | **manual SQL audit** |
| 71 | 20260729000001 | user_administration_and_password_lifecycle | all 7 `admin:users:*` rows; SYSTEM_ADMIN holds all 7; `password_changed_at`, `must_change_password`, `temp_password_expires_at` present; umbrella retained | probe + **manual SQL audit** (earlier false negative traced to the misspelled column `temporary_password_expires_at`; the real column is `temp_password_expires_at`) |
| 72 | 20260729000002 | aging_balance_foundation | all 10 tables (`aging_template_version` … `legacy_receivable_link`), `invoice.provenance`, `invoice.legacy_file_reference` | probe + **manual SQL audit** |

Probe methodology was validated with negative controls (`PGRST205` for a nonexistent
table, `42703` for a nonexistent column) before any positive result was trusted.

> **Verification Addendum (2026-07-31), REQUIRED BEFORE §3:** the stricter
> versioned-change standard exposed two wrong-object probes in the original matrix —
> migration 60 had been "confirmed" via a table that belongs to 58, and migration 63 via a
> column that belongs to 62. The corrected, per-migration evidence with **exact SQL** is
> in [`verification-57-67.md`](verification-57-67.md), and the consolidated read-only
> script the operator must run **first** is [`verification-57-67.sql`](verification-57-67.sql).
> The repair in §3 is authorized only when every row of that script returns `passed=true`.
> Sequence: **script → share results → review → repair (§3.3) → verify 72/72 (§3.4) →
> spot-checks (§3.5) → smoke/UAT → sign-off.** REST RPC probes were additionally retracted
> as evidence (PGRST202 fires on signature mismatch, not only absence).

## 3. The repair — commands

**Mechanism ruling:** `supabase migration repair --status applied <version> [<version> …]`
is the correct and only sanctioned operation. It writes ledger history through the CLI's
managed path — this is *not* the forbidden manual `INSERT`. The CLI accepts **multiple
versions in one invocation**, and one invocation is preferred (single connection, ordered,
one review of the argument list). The per-version loop below is the fallback if the CLI
version in use rejects multiple arguments.

### 3.1 Environment preparation (both shells)

A malformed `SUPABASE_ACCESS_TOKEN` previously broke the CLI; the **stored login** works
once the variable is gone. Clear it in the session before anything else.

**PowerShell:**
```powershell
Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
cd "c:\Projects\Effitrans Operation Platform"
npx supabase projects list   # sanity: stored login works; effitrans project visible
```

**Git Bash:**
```bash
unset SUPABASE_ACCESS_TOKEN
cd "/c/Projects/Effitrans Operation Platform"
npx supabase projects list
```

The repo is already linked to production (`supabase/.temp/project-ref` =
`xtpppzhkiagdpmnghdlc`, verified to match the deployed app's Supabase URL). If the CLI
reports "not linked": `npx supabase link --project-ref xtpppzhkiagdpmnghdlc` (read-only
association) — then re-check.

### 3.2 Pre-repair ledger query (read-only; STOP GATE)

```powershell
npx supabase migration list
```
**Expected:** 56 rows with both LOCAL and REMOTE filled, last remote `20260724000001`;
exactly these 16 with REMOTE empty:
`20260724000002 20260725000001 20260726000001 20260726000002 20260726000003
20260726000004 20260727000001 20260727000002 20260727000003 20260727000004
20260727000005 20260728000001 20260728000002 20260728000003 20260729000001
20260729000002`.
**If the list differs in any way → STOP** (someone changed production since the audit;
re-audit before repairing).

### 3.3 The repair (identical in both shells)

Preferred — one command, versions in chronological order:
```powershell
npx supabase migration repair --status applied 20260724000002 20260725000001 20260726000001 20260726000002 20260726000003 20260726000004 20260727000001 20260727000002 20260727000003 20260727000004 20260727000005 20260728000001 20260728000002 20260728000003 20260729000001 20260729000002
```

Fallback — per version, in order (PowerShell):
```powershell
$versions = @("20260724000002","20260725000001","20260726000001","20260726000002","20260726000003","20260726000004","20260727000001","20260727000002","20260727000003","20260727000004","20260727000005","20260728000001","20260728000002","20260728000003","20260729000001","20260729000002")
foreach ($v in $versions) { npx supabase migration repair --status applied $v; if (-not $?) { Write-Host "STOP at $v"; break } }
```

Fallback — per version (Git Bash):
```bash
for v in 20260724000002 20260725000001 20260726000001 20260726000002 20260726000003 \
         20260726000004 20260727000001 20260727000002 20260727000003 20260727000004 \
         20260727000005 20260728000001 20260728000002 20260728000003 20260729000001 \
         20260729000002; do
  npx supabase migration repair --status applied "$v" || { echo "STOP at $v"; break; }
done
```

**Expected output:** one `Repaired migration history: [<version>] => applied` line per
version (16 total), no other output classes. The command **must not** print anything about
applying migrations, pushing, or DDL — if it does, you ran the wrong command: STOP.

### 3.4 Post-repair verification (read-only)

```powershell
npx supabase migration list
```
**Expected:** all **72** rows with LOCAL = REMOTE, last = `20260729000002`, zero empty
remotes.

### 3.5 Structural spot-check after repair (read-only; proves repair touched ONLY history)

Supabase SQL editor:
```sql
-- ledger now complete
select count(*) from supabase_migrations.schema_migrations;              -- expect 72
select version from supabase_migrations.schema_migrations
 order by version desc limit 1;                                          -- expect 20260729000002

-- schema unchanged by the repair (same answers as the pre-repair audit)
select count(*) from public.permission where code like 'admin:users:%';  -- expect 7
select count(*) from public.permission where code like 'finance:aging:%';-- expect 11
select column_name from information_schema.columns
 where table_name='invoice' and column_name in ('provenance','legacy_file_reference'); -- 2 rows
```

*(These SELECTs are read-only; running them in the dashboard editor is within this
runbook's rules.)*

## 4. Stop conditions

| Condition | Action |
|---|---|
| Pre-repair list ≠ exactly 56/16 as in §3.2 | STOP; re-audit; do not repair |
| CLI auth/connection error | STOP; re-run §3.1 (the token unset); never paste an access token inline |
| Repair output mentions apply/push/DDL | STOP — wrong command was issued |
| Repaired count ≠ 16 | STOP; run §3.4; repair only the still-missing versions |
| Post-repair list ≠ 72/72 | STOP; do not proceed to smoke; report the diff |
| Anyone proposes `db push` "to fix it" | refuse — standing doctrine (9.0F; migration-governance §1) |

## 5. Reversal of an incorrect repair

A repair writes **history only**; reversing it also touches history only — the schema is
never involved in either direction.

```powershell
# wrongly marked applied (e.g. a typo'd version):
npx supabase migration repair --status reverted <version>
```

Then `npx supabase migration list` must show that version back to REMOTE-empty. Note the
asymmetry of risk: a version wrongly marked *applied* would make the CLI skip a migration
that genuinely needs to run — reverse it immediately; a version wrongly *reverted* only
re-exposes it as pending, which §3.2's stop gate catches before harm.

## 6. What this release does NOT include

No activation changes (no env flag, no tenant row, no grant script — migration 72's
grants already exist in the DB and stay inert while `EFFITRANS_FINANCE_AGING_ENABLED` is
unset). No code deploy (production already serves current `main`). R1.0 completes only
when the [smoke/UAT checklist](smoke-uat-checklist.md) passes and sign-offs are recorded.
