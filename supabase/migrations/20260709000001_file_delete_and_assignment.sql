-- 20260709000001_file_delete_and_assignment.sql
-- Effitrans Operations Platform — PHASE 3.2A: Dossier Delete/Cancel + Assignment.
--
-- Additive + forward-only (DEC-A12). Two capabilities on an existing dossier:
--   A. Cancel (soft) / Delete (hard, empty dossiers only)
--      * New terminal status 'CANCELLED' (soft-cancel — never destroys records).
--      * Hard delete is guarded in the server action to empty dossiers only
--        (no invoices/documents/customs/transport/tasks); the rule lives in
--        lib/files/delete-policy.ts and is enforced BEFORE the destructive write.
--      * Gate: file:delete — additionally granted to OPS_SUPERVISOR here
--        (SYSTEM_ADMIN already holds it).
--   B. Assign a dossier to an active staff member.
--      * New additive nullable column operational_file.assigned_to_user_id.
--      * New permission file:assign (SYSTEM_ADMIN / OPS_SUPERVISOR / ACCOUNT_MANAGER).
--      * Assignment grants READ visibility to the assignee via the existing
--        user_readable_file_ids helper (recreated below with one extra predicate).
--      * FILE_ASSIGNED in-app notification type (best-effort, no spam).
--
-- NO new UPDATE/DELETE RLS policy: writes stay on the service-role admin client
-- inside server actions (deny-by-default for authenticated is preserved). The
-- only RLS-visible change is extending the read scope to the assignee — an
-- intentional widening, not a weakening.
--
-- SCOPE GUARD: operational_file status + assignment only. No other module.

-- ===========================================================================
-- A. 'CANCELLED' terminal status
-- ===========================================================================
alter table public.operational_file
  drop constraint if exists operational_file_status_check;
alter table public.operational_file
  add constraint operational_file_status_check
  check (status in ('DRAFT', 'OPENED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELLED'));

-- ===========================================================================
-- B. Assignment column (additive, nullable) + supporting index
-- ===========================================================================
alter table public.operational_file
  add column if not exists assigned_to_user_id uuid references public.app_user (id);

create index if not exists idx_operational_file_assigned_to
  on public.operational_file (assigned_to_user_id);

-- ===========================================================================
-- Permissions: file:assign (new) + widen file:delete to OPS_SUPERVISOR
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('file:assign', 'file', 'assign', 'all', 'Assign operational files to staff')
on conflict (code) do nothing;

-- file:assign -> SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

-- file:delete -> OPS_SUPERVISOR (SYSTEM_ADMIN already granted in Phase 1.2)
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- ===========================================================================
-- Assignment-based READ visibility: recreate user_readable_file_ids with the
-- assignee predicate added (single source of truth for RLS + the admin mirror).
-- Unchanged except for the `or f.assigned_to_user_id = p_user` line.
-- ===========================================================================
create or replace function public.user_readable_file_ids(p_user uuid, p_tenant uuid)
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select f.id
  from public.operational_file f
  where f.tenant_id = p_tenant
    and (
      exists (select 1 from public.get_user_permissions(p_user) gp where gp.code = 'file:read:all')
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.assigned_to_user_id = p_user
      or f.created_by = p_user
      or exists (select 1 from public.task t where t.file_id = f.id and t.assigned_to = p_user)
    );
$$;

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- C. FILE_ASSIGNED notification type (in-app, self-scoped — RLS unchanged)
-- ===========================================================================
alter table public.notification
  drop constraint if exists notification_type_check;
alter table public.notification
  add constraint notification_type_check
  check (type in ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'FILE_ASSIGNED'));
