-- 20260728000003_file_transition_permission.sql
-- Effitrans Operations Platform — separate dossier EDITING from workflow TRANSITIONS.
-- ---------------------------------------------------------------------------
-- FORWARD-ONLY. Adds one permission and grants it. No table, no column.
--
-- ===========================================================================
-- THE DEFECT
-- ===========================================================================
-- Advancing `operational_file.status` was guarded by `file:update` — the
-- permission that authorizes EDITING the dossier record. The two were never
-- separated, so a role could only advance the workflow if it was also allowed
-- to change master data.
--
-- OPS_SUPERVISOR holds file:read:all, file:assign, file:delete,
-- transport:complete, process:manage and process:owner:assign. It can open a
-- dossier's workflow, assign its owner, complete transport, and delete the
-- dossier — but it does NOT hold file:update, so the transition controls never
-- rendered and « Avancer → Clôturé » was invisible. A supervisor could do
-- almost everything to a dossier except advance its status.
--
-- That is a permission-design consequence, not a rendering bug: the status
-- ladder inherited the edit permission instead of having one of its own.
--
-- ===========================================================================
-- THE DOCTRINE
-- ===========================================================================
--   file:update      edit dossier / master data
--   file:transition  advance operational_file.status through the approved
--                    state machine
--
-- INDEPENDENT. Holding one grants nothing about the other: a supervisor may
-- close a dossier without being able to rewrite its client or references, and
-- an editor keeps editing without gaining closure authority.
--
-- Every existing control is unchanged and still applies on top of this
-- permission: the ALLOWED_TRANSITIONS legality check, the CAS on the row, the
-- closure blockers (customs, delivery, invoice settlement, payment
-- verification), the state-history row and the audit entry.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('file:transition', 'file', 'transition', 'all',
   'Advance an operational file through its status state machine (distinct from editing)')
on conflict (code) do nothing;

-- ===========================================================================
-- GRANTS — ACROSS EVERY EXISTING TENANT, NOT JUST THE SEED TENANT
-- ===========================================================================
-- Deliberately NOT filtered by tenant_id. Most seed migrations scope grants to
-- the reference tenant because they run before any other tenant exists; this
-- one is a BACKFILL of a capability those tenants' roles already ought to have,
-- so it must reach every tenant provisioned so far. New tenants receive it from
-- the role templates, which are updated in the same change — the two paths are
-- kept in parity by tests/role-templates.test.ts.
--
-- The four holders mirror the intent of the old coupling plus the role it
-- wrongly excluded:
--   * SYSTEM_ADMIN, ACCOUNT_MANAGER, COORDINATOR — already held file:update
--     and therefore already could transition;
--   * OPS_SUPERVISOR — the supervisory operations role this fix is for.
--
-- Deliberately NOT granted: FINANCE_OFFICER, CASHIER, the customs roles and
-- the transport roles. None of them advanced the dossier ladder before, and
-- widening by analogy is exactly what the Douane audit warned against.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:transition'
where r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'COORDINATOR', 'OPS_SUPERVISOR')
on conflict do nothing;

comment on column public.permission.code is
  'Permission catalogue. NOTE file:update vs file:transition — editing dossier '
  'master data and advancing the status state machine are INDEPENDENT '
  'authorities and must not be conflated again.';
