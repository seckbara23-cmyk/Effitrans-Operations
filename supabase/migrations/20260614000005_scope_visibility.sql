-- 20260614000005_scope_visibility.sql
-- Effitrans Operations Platform — PHASE 1.7: Own / Assigned visibility scoping.
--
-- Refines dossier/task READ visibility into two tiers (DEC-B20 follow-on; the
-- :all suffix follows the existing audit:read:all convention):
--   * tenant-wide  -> file:read:all / task:read:all  (managers, admin, CEO,
--     ops supervisor, account manager, compliance)
--   * assigned     -> plain file:read / task:read     (operational roles) — sees
--     only files where they are account_manager_id / coordinator_id / created_by
--     or have a task, and tasks they are assigned/created or on a visible file.
--
-- DB-level enforcement via RLS + SECURITY DEFINER helpers (which break the
-- file<->task policy recursion by bypassing inner RLS). The service-role list
-- reads mirror the same predicate through user_readable_file_ids (RLS is the
-- guarantee; the service mirror is the operative filter for admin-client reads).
--
-- SAFE / additive for tier-1 (no manager loses access). Tightens COORDINATOR
-- (was tenant-wide) and GRANTS scoped file:read to execution roles that lacked
-- it. Forward-only (DEC-A12); a rollback is documented in supabase/tests.
--
-- SCOPE GUARD: visibility only. No customs/documents/finance/transport/portal.
-- No schema (table/column) changes. AM-narrowed-to-clients (DEC-B15/BLK-RB5) and
-- coordinator team/zone (DEC-B14/BLK-RB4) are intentionally deferred.

-- ===========================================================================
-- 1. New tenant-wide read permissions
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('file:read:all', 'file', 'read', 'all', 'View ALL operational files in the tenant'),
  ('task:read:all', 'task', 'read', 'all', 'View ALL tasks in the tenant')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Role grants (mirrored in seed.sql). Tenant = Effitrans seed org.
-- ===========================================================================
-- Tier-1 (tenant-wide): file:read:all + task:read:all.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read:all', 'task:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE')
on conflict do nothing;

-- Baseline scoped file:read for execution roles that lack it today (+ compliance).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'COMPLIANCE_HSSE')
on conflict do nothing;

-- Baseline task:read for compliance (other tier-1 roles already hold it).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'task:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;

-- ===========================================================================
-- 3. Visibility helpers
--    user_readable_file_ids — the canonical scope logic (SECURITY DEFINER so it
--    bypasses operational_file/task RLS internally -> no recursion). Parameterized
--    by user so the service-role admin client (no auth.uid()) can call it too.
--    can_read_file / can_read_task — RLS predicates for the user-context path.
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
      or f.created_by = p_user
      or exists (select 1 from public.task t where t.file_id = f.id and t.assigned_to = p_user)
    );
$$;

create or replace function public.can_read_file(p_file uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.user_readable_file_ids(auth.uid(), public.auth_tenant_id()) v
    where v.id = p_file
  );
$$;

create or replace function public.can_read_task(p_task uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.task t
    where t.id = p_task
      and t.tenant_id = public.auth_tenant_id()
      and (
        exists (select 1 from public.get_user_permissions(auth.uid()) gp where gp.code = 'task:read:all')
        or t.assigned_to = auth.uid()
        or t.created_by = auth.uid()
        or t.file_id in (select v.id from public.user_readable_file_ids(auth.uid(), public.auth_tenant_id()) v)
      )
  );
$$;

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_file(uuid) to authenticated, service_role;
grant execute on function public.can_read_task(uuid) to authenticated, service_role;

-- Support indexes for the ownership predicates (account_manager already indexed).
create index if not exists idx_operational_file_coordinator on public.operational_file (coordinator_id);
create index if not exists idx_operational_file_created_by on public.operational_file (created_by);

-- ===========================================================================
-- 4. Replace the flat SELECT policies with the scoped predicate. Baseline
--    has_permission stays as the gate; can_read_* adds the row-level scope.
-- ===========================================================================
drop policy operational_file_select on public.operational_file;
create policy operational_file_select on public.operational_file
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('file:read')
    and public.can_read_file(id)
  );

drop policy shipment_select on public.shipment;
create policy shipment_select on public.shipment
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('file:read')
    and public.can_read_file(file_id)
  );

drop policy file_state_transition_select on public.file_state_transition;
create policy file_state_transition_select on public.file_state_transition
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('file:read')
    and public.can_read_file(file_id)
  );

drop policy task_select on public.task;
create policy task_select on public.task
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('task:read')
    and public.can_read_task(id)
  );
