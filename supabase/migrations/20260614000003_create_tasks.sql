-- 20260614000003_create_tasks.sql
-- Effitrans Operations Platform — PHASE 1.3: Tasks (operational tasks on a dossier)
-- Reuses Client/File patterns: tenant_id + RLS + helper reuse + audited
-- service-role writes. Soft-delete via status=CANCELLED (no hard delete).
--
-- SCOPE GUARD: tasks only. NO customs / documents / finance / transport module /
-- portal. Multi-tenant isolation preserved.

create table public.task (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  file_id      uuid not null references public.operational_file (id) on delete cascade,
  title        text not null,
  description  text,
  status       text not null default 'TODO'
                 check (status in ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
  priority     text not null default 'NORMAL'
                 check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_at       timestamptz,
  assigned_to  uuid references public.app_user (id),
  created_by   uuid references public.app_user (id),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_task_tenant on public.task (tenant_id);
create index idx_task_file on public.task (file_id);
create index idx_task_tenant_status on public.task (tenant_id, status);
create index idx_task_assigned on public.task (assigned_to);
create index idx_task_tenant_due on public.task (tenant_id, due_at);

create trigger trg_task_updated_at before update on public.task
  for each row execute function public.set_updated_at();

-- Integrity: a task's tenant must match its file's tenant.
create or replace function public.enforce_task_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'task tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_task_tenant before insert or update on public.task
  for each row execute function public.enforce_task_tenant();

-- ===========================================================================
-- RLS — reads via user-context client (tenant + task:read). Writes via the
-- service-role admin client in server actions (deny-by-default for authenticated).
-- ===========================================================================
alter table public.task enable row level security;

create policy task_select on public.task
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('task:read'));

grant select on public.task to authenticated;

-- ===========================================================================
-- Permissions (catalog + provisional role mappings, pending BLK-RB1).
-- Mirrored into seed.sql for fresh local resets. task:delete gates cancelTask
-- (soft delete -> status=CANCELLED).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('task:create', 'task', 'create', 'all', 'Create tasks'),
  ('task:read',   'task', 'read',   'all', 'View tasks'),
  ('task:update', 'task', 'update', 'all', 'Edit / assign / progress tasks'),
  ('task:delete', 'task', 'delete', 'all', 'Cancel tasks (soft delete)')
on conflict (code) do nothing;

-- Full task management.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('task:create', 'task:read', 'task:update', 'task:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'COORDINATOR', 'OPS_SUPERVISOR')
on conflict do nothing;

-- Execution roles: read + update (progress their assigned tasks).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('task:read', 'task:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER',
                 'DOCUMENTATION_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

-- CEO: read.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'task:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;
