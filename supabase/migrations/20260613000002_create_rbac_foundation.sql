-- 20260613000002_create_rbac_foundation.sql
-- Effitrans Operations Platform — RBAC FOUNDATION (Wave 3)
-- Task: AUTHZ-2 (role / permission / role_permission / user_role + resolution).
-- Decisions: DEC-C01 (tenant_id + RLS), DEC-B12 (single admin), DEC-B13 (union perms).
--
-- SCOPE GUARD: foundation/admin scopes only. NO business module permissions
-- (files/customs/documents/transport/...) — those depend on BLK-RB1 and arrive
-- with their modules. No business tables. RLS here is foundation-only.

-- permission (GLOBAL catalog — same across tenants) --------------------------
create table public.permission (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- e.g. 'admin:users:manage'
  module      text not null,
  action      text not null,
  data_scope  text not null,               -- own / team / client / all / fin / none
  description text,
  created_at  timestamptz not null default now()
);

-- role (TENANT-SCOPED) ------------------------------------------------------
create table public.role (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  code           text not null,
  label_fr       text,
  label_en       text,
  is_provisional boolean not null default true,   -- PROVISIONAL pending BLK-RB1
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, code)
);
create index idx_role_tenant on public.role (tenant_id);
create trigger trg_role_updated_at before update on public.role
  for each row execute function public.set_updated_at();

-- role_permission (M:N) ------------------------------------------------------
create table public.role_permission (
  role_id       uuid not null references public.role (id) on delete cascade,
  permission_id uuid not null references public.permission (id) on delete cascade,
  primary key (role_id, permission_id)
);

-- user_role (M:N, TENANT-SCOPED per security requirement) --------------------
create table public.user_role (
  user_id    uuid not null references public.app_user (id) on delete cascade,
  role_id    uuid not null references public.role (id) on delete cascade,
  tenant_id  uuid not null references public.organization (id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index idx_user_role_tenant on public.user_role (tenant_id);
create index idx_user_role_user on public.user_role (user_id);

-- Integrity: user_role.tenant_id must match BOTH the user's and the role's tenant.
create or replace function public.enforce_user_role_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
  r_tenant uuid;
begin
  select tenant_id into u_tenant from public.app_user where id = new.user_id;
  select tenant_id into r_tenant from public.role     where id = new.role_id;
  if new.tenant_id is distinct from u_tenant or new.tenant_id is distinct from r_tenant then
    raise exception 'user_role tenant mismatch (user_tenant=%, role_tenant=%, given=%)',
      u_tenant, r_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_user_role_tenant
  before insert or update on public.user_role
  for each row execute function public.enforce_user_role_tenant();

-- Effective permissions for a user = UNION across all their roles (DEC-B13).
create or replace function public.get_user_permissions(p_user uuid)
returns table(code text)
language sql
stable
as $$
  select distinct p.code
  from public.user_role ur
  join public.role_permission rp on rp.role_id = ur.role_id
  join public.permission p on p.id = rp.permission_id
  where ur.user_id = p_user;
$$;

-- RLS (foundation-only: read-own-tenant; no write policies) ------------------
alter table public.permission      enable row level security;
alter table public.role            enable row level security;
alter table public.role_permission enable row level security;
alter table public.user_role       enable row level security;

-- permission: non-sensitive global catalog, readable by any authenticated user.
create policy permission_select_all
  on public.permission for select
  to authenticated
  using (true);

-- role: readable within the caller's own tenant.
create policy role_select_own_tenant
  on public.role for select
  to authenticated
  using (tenant_id = (select u.tenant_id from public.app_user u where u.id = auth.uid()));

-- user_role: readable within the caller's own tenant.
create policy user_role_select_own_tenant
  on public.user_role for select
  to authenticated
  using (tenant_id = (select u.tenant_id from public.app_user u where u.id = auth.uid()));

-- role_permission: readable when its role is in the caller's tenant.
create policy role_permission_select_own_tenant
  on public.role_permission for select
  to authenticated
  using (role_id in (
    select r.id from public.role r
    where r.tenant_id = (select u.tenant_id from public.app_user u where u.id = auth.uid())
  ));

-- NOTE: no INSERT/UPDATE/DELETE policies — RBAC writes (seeding, admin user/role
-- management) run server-side via the service role until admin flows land. This
-- keeps full business RBAC out of scope while the foundation is locked down.
