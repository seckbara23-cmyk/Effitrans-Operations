-- RLS regression test — Platform admin boundary (Phase 4.0B-1). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves the platform identity class is isolated from tenant identities:
--   * a tenant app_user CANNOT read platform_admin, and auth_is_platform_admin()
--     is FALSE for them.
--   * a platform_admin reads ONLY their own row (self-select), never a peer's.
--   * a platform_admin has NO tenant: auth_tenant_id() is null, so tenant RLS
--     (organization / client) returns ZERO rows — no cross-tenant leak.
--   * auth_is_platform_admin() is TRUE for the platform admin.
--
-- Run like the other RLS tests (psql -v ON_ERROR_STOP=1).

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fad01', 'plat_super@test.local'),
  ('00000000-0000-0000-0000-0000000fad02', 'plat_ro@test.local'),
  ('00000000-0000-0000-0000-0000000fad0a', 'plat_tenantuser@test.local')
on conflict (id) do nothing;

-- A tenant-A staff user (has a tenant; is NOT a platform admin).
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000fad0a', '00000000-0000-0000-0000-000000000001', 'plat_tenantuser@test.local')
on conflict (id) do nothing;

-- Two platform admins (separate identity class; NO tenant_id).
insert into public.platform_admin (id, email, platform_role) values
  ('00000000-0000-0000-0000-0000000fad01', 'plat_super@test.local', 'PLATFORM_SUPER_ADMIN'),
  ('00000000-0000-0000-0000-0000000fad02', 'plat_ro@test.local', 'PLATFORM_READ_ONLY')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  tu_reads_platform int; tu_is_platform int;
  pa_reads_self int; pa_reads_peer int; pa_is_platform int;
  pa_reads_org int; pa_reads_client int;
begin
  perform set_config('role', 'authenticated', true);

  -- Tenant app_user: cannot see any platform_admin row; is not a platform admin.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000fad0a', 'role', 'authenticated')::text, true);
  select count(*) into tu_reads_platform from public.platform_admin;
  select case when public.auth_is_platform_admin() then 1 else 0 end into tu_is_platform;

  -- Platform admin: sees own row only, never a peer; IS a platform admin; and has
  -- no tenant, so tenant RLS yields zero operational rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000fad01', 'role', 'authenticated')::text, true);
  select count(*) into pa_reads_self from public.platform_admin where id = '00000000-0000-0000-0000-0000000fad01';
  select count(*) into pa_reads_peer from public.platform_admin where id = '00000000-0000-0000-0000-0000000fad02';
  select case when public.auth_is_platform_admin() then 1 else 0 end into pa_is_platform;
  select count(*) into pa_reads_org from public.organization;
  select count(*) into pa_reads_client from public.client;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('tu_reads_platform', tu_reads_platform), ('tu_is_platform', tu_is_platform),
    ('pa_reads_self', pa_reads_self), ('pa_reads_peer', pa_reads_peer), ('pa_is_platform', pa_is_platform),
    ('pa_reads_org', pa_reads_org), ('pa_reads_client', pa_reads_client);

  if tu_reads_platform <> 0 then raise exception 'RLS PLATFORM FAIL: tenant user read platform_admin (% rows)', tu_reads_platform; end if;
  if tu_is_platform <> 0 then raise exception 'RLS PLATFORM FAIL: tenant user resolved as platform admin'; end if;
  if pa_reads_self <> 1 then raise exception 'RLS PLATFORM FAIL: platform admin cannot read own row (% rows)', pa_reads_self; end if;
  if pa_reads_peer <> 0 then raise exception 'RLS PLATFORM FAIL: platform admin read a peer row (% rows)', pa_reads_peer; end if;
  if pa_is_platform <> 1 then raise exception 'RLS PLATFORM FAIL: platform admin not resolved as platform admin'; end if;
  if pa_reads_org <> 0 then raise exception 'RLS PLATFORM FAIL: platform admin read organization rows (% rows)', pa_reads_org; end if;
  if pa_reads_client <> 0 then raise exception 'RLS PLATFORM FAIL: platform admin read client rows (% rows)', pa_reads_client; end if;

  raise notice 'RLS platform admin boundary: PASS';
end $$;

select * from _r order by check_name;
rollback;
