-- RLS regression test — tenant_branding isolation (Phase 4.0B-3). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves a tenant reads ONLY its own branding row:
--   * tenant-A user sees Effitrans branding (1), never tenant B's (0).
--   * tenant-B user sees tenant B branding (1), never tenant A's (0).
-- (Platform reads run via the service role and are covered by the platform-admin
--  boundary test; here we prove no cross-tenant branding leak through RLS.)

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.tenant_branding (tenant_id, display_name)
values ('00000000-0000-0000-0000-0000000000b2', 'Tenant B Brand')
on conflict (tenant_id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000bd0a', 'brand_a@test.local'),
  ('00000000-0000-0000-0000-00000000bd0b', 'brand_b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000bd0a', '00000000-0000-0000-0000-000000000001', 'brand_a@test.local'),
  ('00000000-0000-0000-0000-00000000bd0b', '00000000-0000-0000-0000-0000000000b2', 'brand_b@test.local')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  a_own int; a_other int; b_own int; b_other int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000000bd0a', 'role', 'authenticated')::text, true);
  select count(*) into a_own from public.tenant_branding where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into a_other from public.tenant_branding where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000000bd0b', 'role', 'authenticated')::text, true);
  select count(*) into b_own from public.tenant_branding where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  select count(*) into b_other from public.tenant_branding where tenant_id = '00000000-0000-0000-0000-000000000001';

  perform set_config('role', 'postgres', true);
  insert into _r values ('a_own', a_own), ('a_other', a_other), ('b_own', b_own), ('b_other', b_other);

  if a_own <> 1 then raise exception 'RLS BRANDING FAIL: tenant A cannot read own branding (% rows)', a_own; end if;
  if a_other <> 0 then raise exception 'RLS BRANDING FAIL: tenant A read tenant B branding (% rows)', a_other; end if;
  if b_own <> 1 then raise exception 'RLS BRANDING FAIL: tenant B cannot read own branding (% rows)', b_own; end if;
  if b_other <> 0 then raise exception 'RLS BRANDING FAIL: tenant B read tenant A branding (% rows)', b_other; end if;

  raise notice 'RLS tenant_branding isolation: PASS';
end $$;

select * from _r order by check_name;
rollback;
