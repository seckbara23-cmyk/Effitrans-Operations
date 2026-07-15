-- RLS: Digital Brand Center isolation (DBC-1) — bidirectional, non-destructive.
-- ---------------------------------------------------------------------------
-- Proves the four Brand Center tables are tenant-isolated in BOTH directions and that
-- writes are service-role only (a cross-tenant write is prevented — no write grant / RLS).
-- Tenant A = seeded Effitrans (…001, SYSTEM_ADMIN → admin:config:manage/admin:users:manage).
-- Tenant B is created here WITH its own SYSTEM_ADMIN role + the same grants, so a read miss
-- is isolation, not lack of permission.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_brand_center_test.sql

begin;

-- --- Setup (superuser — RLS bypassed) ------------------------------------------
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Brand Center Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'brand-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'brand-b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'brand-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'brand-b@test.local')
on conflict (id) do nothing;

-- A → tenant A SYSTEM_ADMIN (seeded, already has the grants).
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- B → a tenant B SYSTEM_ADMIN role WITH admin:config:manage + admin:users:manage.
insert into public.role (id, tenant_id, code, label_fr, label_en)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2', 'SYSTEM_ADMIN', 'Admin', 'Admin')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000000f2', p.id from public.permission p
where p.code in ('admin:config:manage', 'admin:users:manage')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2')
on conflict do nothing;

-- Brand records for each tenant.
insert into public.brand_asset (id, tenant_id, kind, storage_path, mime, bytes, alt_text) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000001', 'LOGO_PRIMARY', '000…001/logos/a/v1/logo.png', 'image/png', 1000, 'A'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b2', 'LOGO_PRIMARY', '000…0b2/logos/b/v1/logo.png', 'image/png', 1000, 'B')
on conflict (id) do nothing;
insert into public.tenant_brand_profile (tenant_id, slogan) values
  ('00000000-0000-0000-0000-000000000001', 'A slogan'),
  ('00000000-0000-0000-0000-0000000000b2', 'B slogan')
on conflict (tenant_id) do nothing;
insert into public.tenant_membership_registry (id, tenant_id, organization_name) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-000000000001', 'WCA First'),
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-0000000000b2', 'FIATA')
on conflict (id) do nothing;
insert into public.workforce_profile (user_id, tenant_id, job_title) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'CEO'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'CEO')
on conflict (user_id) do nothing;

-- --- Direction A → B ------------------------------------------------------------
do $$
declare v int; affected int; prevented boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);

  select count(*) into v from public.brand_asset where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v < 1 then raise exception 'A cannot read own brand_asset (%)', v; end if;
  select count(*) into v from public.brand_asset where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B brand_asset (%)', v; end if;

  select count(*) into v from public.tenant_brand_profile where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 1 then raise exception 'A cannot read own profile (%)', v; end if;
  select count(*) into v from public.tenant_brand_profile where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B profile (%)', v; end if;

  select count(*) into v from public.tenant_membership_registry where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B membership (%)', v; end if;

  select count(*) into v from public.workforce_profile where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B workforce (%)', v; end if;

  -- MUTATE tenant B → prevented (no write grant / RLS).
  prevented := false;
  begin
    update public.tenant_brand_profile set slogan = 'HACK' where tenant_id = '00000000-0000-0000-0000-0000000000b2';
    get diagnostics affected = row_count; prevented := (affected = 0);
  exception when others then prevented := true; end;
  if not prevented then raise exception 'CROSS-TENANT WRITE: A updated B profile'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'Brand Center A→B: PASS';
end $$;

-- --- Direction B → A ------------------------------------------------------------
do $$
declare v int; affected int; prevented boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);

  select count(*) into v from public.brand_asset where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v < 1 then raise exception 'B cannot read own brand_asset (%)', v; end if;
  select count(*) into v from public.brand_asset where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A brand_asset (%)', v; end if;
  select count(*) into v from public.tenant_brand_profile where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A profile (%)', v; end if;
  select count(*) into v from public.tenant_membership_registry where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A membership (%)', v; end if;
  select count(*) into v from public.workforce_profile where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A workforce (%)', v; end if;

  prevented := false;
  begin
    update public.brand_asset set alt_text = 'HACK' where tenant_id = '00000000-0000-0000-0000-000000000001';
    get diagnostics affected = row_count; prevented := (affected = 0);
  exception when others then prevented := true; end;
  if not prevented then raise exception 'CROSS-TENANT WRITE: B updated A brand_asset'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'Brand Center B→A: PASS';
  raise notice 'BRAND CENTER RLS: PASS (bidirectional isolation, no cross-tenant write)';
end $$;

rollback;
