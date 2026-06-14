-- 20260614000001_create_client_management.sql
-- Effitrans Operations Platform — PHASE 1.1: Client Management (first business module)
-- Follows docs/s2-security-patterns.md: tenant_id + RLS + helper reuse
-- (auth_tenant_id / has_permission), audited service-role writes, user-context reads.
--
-- SCOPE GUARD: clients only. NO shipments / customs / documents / finance /
-- workflow / transport / notifications. Multi-tenant isolation preserved.

-- ===========================================================================
-- client
-- ===========================================================================
create table public.client (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  name               text not null,
  ninea              text,                       -- Senegalese business id (unique per tenant)
  segment            text,                       -- oil_gas / mining / industrial / other
  email              text,
  phone              text,
  address            text,
  account_manager_id uuid references public.app_user (id),
  status             text not null default 'active' check (status in ('active', 'archived')),
  created_by         uuid references public.app_user (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);

create index idx_client_tenant on public.client (tenant_id);
create index idx_client_tenant_status on public.client (tenant_id, status);
create index idx_client_account_manager on public.client (account_manager_id);

-- NINEA uniqueness PER TENANT (only when present).
create unique index uq_client_ninea_per_tenant
  on public.client (tenant_id, ninea)
  where ninea is not null;

create trigger trg_client_updated_at before update on public.client
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- client_contact
-- ===========================================================================
create table public.client_contact (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  client_id   uuid not null references public.client (id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_client_contact_tenant on public.client_contact (tenant_id);
create index idx_client_contact_client on public.client_contact (client_id);

create trigger trg_client_contact_updated_at before update on public.client_contact
  for each row execute function public.set_updated_at();

-- Integrity: a contact's tenant must match its client's tenant.
create or replace function public.enforce_client_contact_tenant()
returns trigger language plpgsql as $$
declare
  c_tenant uuid;
begin
  select tenant_id into c_tenant from public.client where id = new.client_id;
  if new.tenant_id is distinct from c_tenant then
    raise exception 'client_contact tenant mismatch (client_tenant=%, given=%)', c_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_client_contact_tenant
  before insert or update on public.client_contact
  for each row execute function public.enforce_client_contact_tenant();

-- ===========================================================================
-- RLS — reads via the user-context client (tenant + client:read). Writes go via
-- the service-role admin client in server actions (assertPermission + tenant
-- scope + audit), so RLS-enabled-with-no-write-policy denies direct writes by
-- authenticated (deny-by-default). RLS-1 tenant isolation preserved.
-- ===========================================================================
alter table public.client         enable row level security;
alter table public.client_contact enable row level security;

create policy client_select on public.client
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('client:read'));

create policy client_contact_select on public.client_contact
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('client:read'));

-- Reads only for authenticated; writes via service role.
grant select on public.client, public.client_contact to authenticated;

-- ===========================================================================
-- Permissions (catalog + provisional role mappings, pending BLK-RB1).
-- Catalog has no role dependency -> applies everywhere. Mappings apply where the
-- roles already exist (production push); fresh local resets get them from seed.sql.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('client:create', 'client', 'create', 'all', 'Create clients'),
  ('client:read',   'client', 'read',   'all', 'View clients'),
  ('client:update', 'client', 'update', 'all', 'Edit clients'),
  ('client:delete', 'client', 'delete', 'all', 'Archive / restore clients')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('client:create', 'client:read', 'client:update', 'client:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('client:create', 'client:read', 'client:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'client:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CEO', 'COORDINATOR', 'OPS_SUPERVISOR')
on conflict do nothing;
