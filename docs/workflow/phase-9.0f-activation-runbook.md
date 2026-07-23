# Phase 9.0F — Production Activation & Acceptance Runbook

**Date:** 2026-07-23 · **Deployed SHA:** `3c62d901788ceefd0f26b4d7b37e3db1ee3b3357` · **Status of this document:** AUDIT-COMPLETE / OPERATOR-READY

> **⚠ CORRECTION (2026-07-23) — the "migrations pending" premise below is superseded.**
> Subsequent read-only SQL against production proved that **production schema was
> already current. The missing component was the Supabase migration-history
> ledger, which was reconciled using metadata-only `migration repair`.** No
> migration was replayed and no schema/app/data/rollout change was made. The
> per-migration "pending / prod at 52 / must apply" framing in the *Activation
> audit findings* section is retained only as the historical analysis that led to
> the reconciliation; treat **`MIGRATED`** as **RECONCILED (ledger, 55/55)**.
> Full record: [`docs/operations/migration-ledger-reconciliation.md`](../operations/migration-ledger-reconciliation.md).
> Flag activation (Vercel env + `tenant_process_rollout`) remains the operator step.

> **Read this first.** Phase 9.0F is an **operator activation phase**. Applying
> production migrations, toggling per-tenant flags, and running authenticated
> live acceptance all require production credentials — a Supabase access token
> for the production project and an authenticated production login. **From the
> engineering environment those credentials are not available** (the Supabase
> MCP returns `Unauthorized`, and `/platform/operations` redirects to `/login`).
> This document is therefore the **executable runbook** for the designated
> operator, plus the complete pre-computed audit so no analysis is repeated
> under production pressure. Nothing in Stages 2–11 has been executed; every
> "✅ done" below is limited to the public, non-credentialed preflight.

---

## Status ladder (do not conflate)

| Status | Meaning | Reached? |
|---|---|---|
| **AUDIT-COMPLETE** | migrations analyzed, risks known, runbook written | ✅ yes |
| **PREFLIGHT-VERIFIED** | deployed SHA + production gate confirmed | ✅ yes |
| **~~MIGRATED~~ → RECONCILED** | schema already current; **ledger reconciled 55/55 via `migration repair`** | ✅ done (2026-07-23) |
| **ACTIVATED** | flags enabled in dependency order for Effitrans | ⛔ operator |
| **ACCEPTANCE-PASSED** | 9.0B–9.0E checklists + E2E pass live | ⛔ operator |
| **OBSERVED** | observation period clean | ⛔ operator |
| **PRODUCTION-READY** | all of the above | ⛔ operator |

---

## What was verified without credentials (Stage 1, partial)

- **`/api/version`** → `{"sha":"3c62d90…","env":"production"}` — matches the intended deployed SHA. ✅
- **`verify-production.mjs`** against `3c62d90` → **ALL CHECKS PASSED** (route sweep, auth/portal redirects, uniform 404, HSTS/x-content-type-options/x-frame-options). ✅
- **`/platform/operations`** → `307 → /login` — the ops console (migration ledger, build-info probe) is behind auth; the operator must open it while signed in.
- **CI** for `3c62d90` → **green**, including the `rls_workflow_structures_test` (9.0B) and `rls_finance_requests_test` (9.0E) SQL suites, which executed against a real Postgres for the first time after the messaging-test repair.
- **Feature flags** are off *by design* (env defaults `false`; a missing/false `tenant_process_rollout` row = disabled; all sub-flags require their chain). Live values still require operator confirmation (Vercel env + the DB row) — see Stage 1.2.

---

## Activation audit findings

### Migration inventory (historical analysis — see CORRECTION banner above)

> These three were the focus of the original audit. It was later proven their
> **objects already existed in production**; only the ledger was missing. They
> were not replayed — the ledger was reconciled. Retained for the object-level
> detail, which the equivalence verification confirmed matches production.

| # | File | Adds | Class |
|---|---|---|---|
| 53 | `20260722000001_messaging_center.sql` | 5 tables (conversation, conversation_participant, message, message_attachment, tenant_messaging_rollout), 4 RLS'd tables + 2 security-definer functions + 8 policies, `messaging:*` permissions + **seed-tenant** grants, 2 nullable cols + **2 CHECK-constraint swaps** on `notification`/`client_notification`, 1 storage bucket | additive + **one brief lock** |
| 54 | `20260723000001_workflow_structures.sql` | 4 nullable cols on `process_instance`/`process_step_execution`, 3 tables (process_decision, process_blocker, organization_team_member) + triggers (incl. decision immutability) + 3 SELECT policies, `process:owner:assign`/`decision:*`/`blocker:manage`/`team:manage`/`step:skip` permissions + **seed-tenant** grants | additive |
| 55 | `20260723000002_finance_requests.sql` | 1 table (finance_request) + 3 indexes + tenant trigger + 1 SELECT policy; **no permission, no grant** | additive |

**Ordering & dependencies:** timestamp order is correct and self-consistent —
`finance_request` FK-references `process_decision` (created in #54, applied
first) plus pre-existing `customs_record`/`document`/`billing_charge`/
`operational_file`. No forward references.

### Migration risk assessment

- **Transactional / atomic:** none use `CREATE INDEX CONCURRENTLY` or any
  non-transactional statement, so each file runs inside a single transaction —
  any error auto-rolls-back that migration whole. The runner records a
  migration as applied only on commit.
- **Additive, non-destructive:** no `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/
  `DELETE`. The only `drop constraint if exists` (×2) immediately re-adds a
  **superset** CHECK — see below.
- **One locking operation (low risk, plan a quiet window):** #53 swaps the
  `notification.type` and `client_notification.category` CHECK constraints. The
  new sets are strict supersets of the old (`type` adds `MESSAGE_RECEIVED`,
  `CONVERSATION_ASSIGNED`; `category` adds `message`), so re-validation passes
  for every existing row, but the `ADD CONSTRAINT` takes a brief
  `ACCESS EXCLUSIVE` lock and full-scans each table to validate. Harmless on
  today's volumes; still apply during low traffic.
- **Idempotency:** all catalog/grant inserts carry `on conflict do nothing`;
  the storage bucket carries `on conflict (id) do nothing`. Column adds use
  `if not exists`. Safe to re-run the file if a transaction was rolled back.
- **New nullable columns, no default:** metadata-only on modern Postgres (no
  table rewrite) → fast even on large `process_*` tables.

### ⚠ CRITICAL precondition — permission grant scope (permission drift)

The `role_permission` grants in #53 and #54 are **hardcoded to the seed tenant**
`00000000-0000-0000-0000-000000000001`:

```sql
insert into public.role_permission (role_id, permission_id)
select r.id, p.id ...
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code in (...)
on conflict do nothing;
```

The `permission` catalog rows are global, but the **grants apply only to the
seed tenant's roles**. Consequently:

- If the **production Effitrans tenant IS the seed tenant** (`…0001`) → the
  grants land, and enabling flags works.
- If the production Effitrans tenant was **provisioned separately** (its own
  UUID, created via `provision_tenant`) → after migration the `messaging:*` and
  `process:*` permissions exist in the catalog **but are not granted to that
  tenant's roles**. Flags could then be on while staff silently lack the
  permissions — features would render permission-degraded/empty, not error.

**This must be resolved before Stage 5.** It cannot be checked from the
engineering environment (no DB access). The operator runs the Stage-0 query
below; if grants are missing for the real tenant, run the documented backfill
(same select-driven insert with the real `tenant_id`) **before** enabling
STRUCTURES/INTAKE/TRANSIT.

---

## Stage 0 — Resolve the Effitrans tenant and confirm grant scope (READ-ONLY)

```sql
-- 0a. Identify the production tenant(s). Confirm which is Effitrans.
select id, name, country, created_at from public.organization order by created_at;

-- 0b. After migration (or now, for messaging which is already in the catalog if
--     #53 is applied), confirm the tenant's roles actually hold the new grants.
--     Replace :tenant with the real Effitrans id.
select r.code as role, count(rp.permission_id) filter (where p.code like 'messaging:%') as messaging_grants,
       count(rp.permission_id) filter (where p.code like 'process:%')   as process_grants
from public.role r
left join public.role_permission rp on rp.role_id = r.id
left join public.permission p on p.id = rp.permission_id
where r.tenant_id = :tenant
group by r.code order by r.code;
```

If `:tenant` ≠ `…0001` and the counts are zero for roles that should hold them
(SYSTEM_ADMIN, OPS_SUPERVISOR, CHIEF_OF_TRANSIT, COORDINATOR, CUSTOMS_DECLARANT,
FINANCE_OFFICER, …), backfill with the **same** select-driven inserts from #53
and #54 with `where r.tenant_id = :tenant`, then re-run 0b. (`lib/platform/
role-templates.ts` is the parity source of which role holds which permission.)

---

## Stage 1 — Preflight (operator portion)

1. **Deployment** — confirm `/api/version` = `3c62d90…`; run
   `node scripts/gate/verify-production.mjs https://effitrans-operations.vercel.app 3c62d901788ceefd0f26b4d7b37e3db1ee3b3357`. *(Both already pass.)*
2. **Flags off** — Vercel env: confirm `EFFITRANS_PROCESS_ENGINE_ENABLED`,
   `…STRUCTURES…`, `…OPERATIONS_INTAKE…`, `…TRANSIT_EXECUTION…`,
   `…FINANCE_EXECUTION…` are unset/`false`. DB: `select * from
   public.tenant_process_rollout where tenant_id = :tenant;` — expect no row or
   `process_engine=false`. Record the exact values.
3. **Migration ledger** — `/platform/operations` (signed in) should show latest
   = `20260721000001_transport_manage`, count 52; expected post = count 55,
   latest `20260723000002_finance_requests`. Cross-check
   `select * from supabase_migrations.schema_migrations order by version desc limit 6;`
4. **Backup / recovery** — follow `docs/backup-recovery-runbook.md`: confirm PITR
   enabled + retention window, note latest backup timestamp, the responsible
   operator, and the restore steps/ETA. **Do not proceed without a known
   recovery path.**
5. **Prechecks (READ-ONLY)** — run Stage 0 + the block below; store **counts
   only** in the activation report, never row contents.

```sql
-- Nothing should already exist (these migrations are unapplied):
select to_regclass('public.finance_request') as finance_request_exists,     -- expect NULL
       to_regclass('public.process_decision')  as process_decision_exists,   -- expect NULL
       to_regclass('public.conversation')      as conversation_exists;       -- expect NULL
-- No name collisions for the functions/policies about to be created:
select proname from pg_proc where proname in
  ('enforce_finance_request_tenant','enforce_process_decision_tenant','messaging_staff_can_access_conversation');  -- expect 0 rows
-- Existing notification rows all satisfy the FUTURE superset CHECK (so the swap validates):
select count(*) from public.notification
  where type not in ('TASK_ASSIGNED','TASK_DUE_SOON','TASK_OVERDUE','FILE_ASSIGNED','MESSAGE_RECEIVED','CONVERSATION_ASSIGNED');  -- expect 0
select count(*) from public.client_notification
  where category not in ('shipment','invoice','payment','message');  -- expect 0
```

---

## Stage 2 — Apply the migrations (approved process only)

Apply via the project's approved production migration path (`supabase db push`
against the production project, or the Supabase dashboard SQL runner executing
each file **in order, one transaction each**). For **each** of `20260722000001`
→ `20260723000001` → `20260723000002`: record filename + start time, apply,
record success/exact error, confirm it appears in
`supabase_migrations.schema_migrations`, verify its objects (below), and check
DB/app logs before the next.

**Post-sequence verification:**

```sql
select count(*) as applied from supabase_migrations.schema_migrations;  -- expect 55
-- Objects present:
select to_regclass('public.finance_request'), to_regclass('public.process_decision'),
       to_regclass('public.process_blocker'), to_regclass('public.organization_team_member'),
       to_regclass('public.conversation'), to_regclass('public.message');   -- all non-NULL
-- RLS enabled on every new table:
select relname, relrowsecurity from pg_class
 where relname in ('finance_request','process_decision','process_blocker',
                   'organization_team_member','conversation','conversation_participant',
                   'message','message_attachment','tenant_messaging_rollout')
 order by relname;   -- relrowsecurity = true for all
-- New permissions in the catalog:
select code from public.permission where code like 'messaging:%' or code in
  ('process:owner:assign','process:decision:create','process:decision:approve',
   'process:blocker:manage','process:team:manage','process:step:skip')
 order by code;
```

Then re-run `verify-production.mjs` — behaviour must be **unchanged** (features
still dark). `/platform/operations` should now show latest =
`20260723000002_finance_requests`, count 55, and the `process:owner:assign`
data-probe present. **Applying migrations does NOT authorize activation** —
Stage 3 first.

---

## Stage 3 — Database security acceptance (transaction-wrapped, no residue)

The repository already ships transaction-wrapped (`begin … rollback`) RLS
suites that CI runs on every push; they are the canonical proof and leave zero
residue:

- `supabase/tests/rls_finance_requests_test.sql` — tenant isolation,
  no-portal, `finance:read` gate, cross-tenant trigger rejection, dedup index.
- `supabase/tests/rls_workflow_structures_test.sql` — decisions/blockers/teams
  isolation, portal-blind (even customer-visible blockers), cross-tenant
  triggers.
- `supabase/tests/rls_messaging_test.sql` — department scoping, portal
  customer isolation, internal-note invisibility (repaired in `3c62d90`).

Run these against production **read-replica or inside `begin…rollback`** if
policy permits DB test execution; otherwise rely on the CI evidence (they
passed on `3c62d90`) and spot-check with a signed-in staff + portal session
after Stage 5. Confirm additionally: anonymous access denied (already covered by
`verify-production.mjs` redirects), service-role key absent from any client
bundle (`grep -r SERVICE_ROLE .next/static` → nothing; server-only by design).

---

## Stages 4–8 — Staged flag activation (dependency order)

Controls: the **env kill-switches** (Vercel env vars → redeploy) stage the
chain; the **tenant gate** is `tenant_process_rollout.process_engine=true` for
Effitrans. Enable **one stage at a time**, run its acceptance, and only then
proceed. If a gate fails: turn that flag off, confirm the panel disappears /
degrades, preserve records, investigate.

| Stage | Env flag to set `true` | Tenant gate | Acceptance source |
|---|---|---|---|
| 4 ENGINE | `EFFITRANS_PROCESS_ENGINE_ENABLED` | `tenant_process_rollout.process_engine=true` | engine reads load, no panel yet, ownership unchanged, `/files/[id]/process` renders |
| 5 STRUCTURES | `EFFITRANS_PROCESS_STRUCTURES_ENABLED` | (env-only over ENGINE) | `docs/workflow/phase-9.0b-migration-and-rollout.md` |
| 6 INTAKE | `EFFITRANS_OPERATIONS_INTAKE_ENABLED` | (env-only) | `docs/workflow/phase-9.0c-operations-intake.md` §11 |
| 7 TRANSIT | `EFFITRANS_TRANSIT_EXECUTION_ENABLED` | (env-only) | `docs/workflow/phase-9.0d-transit-execution.md` §24 |
| 8 FINANCE | `EFFITRANS_FINANCE_EXECUTION_ENABLED` | (env-only) | `docs/workflow/phase-9.0e-finance-execution.md` §11 |

Each panel is server-gated (`if (tenantFlags.X)` + `getXState → null`) so an
unmet prerequisite hides it rather than breaking the inspector. Verify after
each stage that no *later* panel appears.

### Stage 8 Finance acceptance — money-safety spot checks (use a clearly-marked acceptance dossier)

- **20 Intake:** a finance request creates a `finance_request` row and **no**
  `payment`/`invoice`/`billing_charge` (`select count(*) from payment where …`).
- **21 Review:** distinct reviewer approves; self-review blocked
  (`self_review_forbidden`); reject/return needs a note; approval creates no
  payment.
- **22 Disbursement:** only `APPROVED`→`DISBURSED`; a second attempt fails
  (CAS); no `payment` row created.
- **23 Duty seam:** disbursing a `CUSTOMS_DUTY` request leaves
  `customs_record.status` unchanged — customs clears **only** via
  `releaseCustoms`.
- **24 Evidence:** attach → `SUBMITTED`; the executor cannot self-verify; a
  distinct verifier sets `VERIFIED`/`REJECTED`.
- **25 Billing:** convert a reimbursable disbursed request → exactly one
  `billing_charge`; idempotent; an `INTERNAL_COST` request offers no conversion;
  no invoice issued/paid.
- **26 Clearance:** blocked while any condition is open; after resolution
  `finance.cleared` is audited and the `gainde_registration →
  coordinator_to_declarant` handoff (or fallback notice) fires; ownership,
  delivery, settlement all unchanged.

---

## Stage 9 — End-to-end acceptance

One acceptance dossier through Structures → Intake → Transit (reception →
declarant → chef validation → finance-gate decision → BAE via `releaseCustoms`
→ AIBD/Maritime dispatch) → Finance (request → review → disbursement → evidence
→ optional billing → clearance) → next-team handoff. Assert across the full
audit trail: one tenant, one workflow chain, no duplicate transitions, no owner
drift, no false customs clearance, no fabricated settlement, no invoice marked
paid without a real `payment`, honest French UI states, names not UUIDs.

---

## Stage 10 — Rollback drill (flags, not schema)

1. Set `EFFITRANS_FINANCE_EXECUTION_ENABLED=false` → redeploy → confirm the
   Finance panel disappears and `getFinanceState` returns null; a finance write
   now returns `finance_disabled`; **existing `finance_request` rows remain
   intact** (`select count(*)`).
2. Re-enable → confirm state returns.
3. Optionally repeat at the TRANSIT boundary.

The emergency rollback is **feature deactivation**, never schema reversal —
these migrations are additive and were not built as down-migrations. Do not drop
tables to "simulate" rollback.

---

## Stage 11 — Monitoring & observation

Watch for a defined period (align to deployment practice, e.g. 24–72h of
business activity): application error logs, DB errors, RLS-denial spikes, failed
actions, audit anomalies, duplicate-request attempts, workflow-transition
failures, notification failures, unexpected 404/redirect changes, process-
inspector latency, and — importantly — **no missing-table fallbacks** (their
absence confirms migrations took). Only after a clean window is the status
**OBSERVED**; only then **PRODUCTION-READY**.

---

## Defect policy (unchanged from the brief)

Operator/config defect → fix config, document, repeat the gate. Application
defect → smallest fix, regression test first, full verify (tsc/lint/tests/
build), commit/push, CI green, deploy, re-verify SHA + gate, repeat the gate.
Migration defect → **stop**, do not improvise destructive SQL, document
(failure, whether the txn rolled back, impact, remediation, backup status, flags
confirmed off).
