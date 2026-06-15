-- 20260615000005_create_portal.sql
-- Effitrans Operations Platform — PHASE 1.12A: Customer Portal foundation.
--
-- A SECOND identity class on the SAME Supabase Auth project: staff resolve via
-- app_user, external clients via client_user. A given auth.users id is in
-- EXACTLY ONE of the two. Every existing internal policy keys on app_user
-- (has_permission / auth_tenant_id) -> a portal user resolves to NO internal
-- permissions/tenant and is denied everywhere internal. The portal gets its own
-- ADDITIVE RLS policies keyed on client_user.client_id (OR'd with staff policies
-- -> staff RLS is NOT weakened).
--
-- SCOPE GUARD (1.12A): identity + read foundation only. Portal can read its own
-- client's dossiers + shipment + transitions + customs/transport SUMMARY. NO
-- tasks, NO audit, NO documents, NO finance for portal. No client uploads.

-- ===========================================================================
-- 1. client_user (portal identity). id = auth.users.id, like app_user.
-- ===========================================================================
create table public.client_user (
  id            uuid primary key references auth.users (id) on delete cascade,
  tenant_id     uuid not null references public.organization (id),
  client_id     uuid not null references public.client (id),
  email         text not null,
  name          text,
  status        text not null default 'INVITED'
                  check (status in ('INVITED', 'ACTIVE', 'DISABLED')),
  role          text not null default 'CLIENT_USER'
                  check (role in ('CLIENT_ADMIN', 'CLIENT_USER')),
  invited_by    uuid references public.app_user (id),
  invited_at    timestamptz not null default now(),
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_client_user_client on public.client_user (client_id);
create index idx_client_user_tenant on public.client_user (tenant_id);
create unique index uq_client_user_email_per_tenant on public.client_user (tenant_id, email);

create trigger trg_client_user_updated_at before update on public.client_user
  for each row execute function public.set_updated_at();

alter table public.client_user enable row level security;

-- Portal user reads OWN row (any status — the app decides ACTIVE gating).
create policy client_user_self_select on public.client_user
  for select to authenticated using (id = auth.uid());

-- Staff with portal:manage read their tenant's client_user rows (user-context).
create policy client_user_staff_select on public.client_user
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('portal:manage'));

grant select on public.client_user to authenticated;

-- ===========================================================================
-- 2. Portal identity helpers (SECURITY INVOKER read the caller's own client_user
--    row; null for staff / disabled -> portal policies deny). portal_can_read_file
--    is DEFINER (bypasses inner RLS -> no recursion in shipment/customs/etc).
-- ===========================================================================
create or replace function public.auth_portal_client_id()
returns uuid language sql stable security invoker as $$
  select cu.client_id from public.client_user cu
  where cu.id = auth.uid() and cu.status = 'ACTIVE';
$$;

create or replace function public.auth_portal_tenant_id()
returns uuid language sql stable security invoker as $$
  select cu.tenant_id from public.client_user cu
  where cu.id = auth.uid() and cu.status = 'ACTIVE';
$$;

create or replace function public.portal_can_read_file(p_file uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.operational_file f
    join public.client_user cu on cu.client_id = f.client_id
    where f.id = p_file
      and cu.id = auth.uid()
      and cu.status = 'ACTIVE'
      and cu.tenant_id = f.tenant_id
  );
$$;

grant execute on function public.auth_portal_client_id() to authenticated;
grant execute on function public.auth_portal_tenant_id() to authenticated;
grant execute on function public.portal_can_read_file(uuid) to authenticated, service_role;

-- ===========================================================================
-- 3. ADDITIVE portal SELECT policies (OR'd with the existing staff policies).
--    Portal sees only its own client's dossier spine + customs/transport rows
--    (the service projects to SAFE columns — no internal notes are selected).
-- ===========================================================================
create policy client_portal_select on public.client
  for select to authenticated
  using (id = public.auth_portal_client_id());

create policy operational_file_portal_select on public.operational_file
  for select to authenticated
  using (
    tenant_id = public.auth_portal_tenant_id()
    and client_id = public.auth_portal_client_id()
  );

create policy shipment_portal_select on public.shipment
  for select to authenticated
  using (public.portal_can_read_file(file_id));

create policy file_state_transition_portal_select on public.file_state_transition
  for select to authenticated
  using (public.portal_can_read_file(file_id));

create policy customs_record_portal_select on public.customs_record
  for select to authenticated
  using (public.portal_can_read_file(file_id) and deleted_at is null);

create policy transport_record_portal_select on public.transport_record
  for select to authenticated
  using (public.portal_can_read_file(file_id) and deleted_at is null);

-- ===========================================================================
-- 4. Audit attribution for portal actors (additive, nullable; keeps the
--    append-only audit_log attributable without faking an app_user actor).
-- ===========================================================================
alter table public.audit_log
  add column if not exists client_user_id uuid references public.client_user (id);

-- ===========================================================================
-- 5. Internal permission to manage portal users (staff side). Mirrored in seed.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('portal:manage', 'portal', 'manage', 'all', 'Invite / manage client portal users')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'portal:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'OPS_SUPERVISOR')
on conflict do nothing;
