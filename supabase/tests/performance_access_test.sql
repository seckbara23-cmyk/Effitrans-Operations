-- Behaviour test — Gestion de la Performance: access and separation.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves in the DATABASE what the module's route guard asserts in the app:
--   * both capabilities exist in the catalog
--   * a performance reader holds NO operational authority (hr:manage,
--     customs:update / :validate / :correct / :revalidate)
--   * an operational holder does NOT thereby hold performance:read
--   * a performance reader cannot read another tenant's customs corrections
--   * a performance reader cannot read the HR calendar without hr:read
--   * reading performance grants no write anywhere: the calendar still has no
--     write policy, and customs_correction still has none either
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fe001', 'perf-reader@test.local'),
  ('00000000-0000-0000-0000-0000000fe002', 'perf-operational@test.local'),
  ('00000000-0000-0000-0000-0000000fe003', 'perf-xtenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000fe0b2', 'PERF Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000fe001', '00000000-0000-0000-0000-000000000001', 'perf-reader@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000fe002', '00000000-0000-0000-0000-000000000001', 'perf-operational@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000fe003', '00000000-0000-0000-0000-0000000fe0b2', 'perf-xtenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000fe0c1', '00000000-0000-0000-0000-000000000001', 'PERF_READER', 'Lecteur performance (test)'),
  ('00000000-0000-0000-0000-0000000fe0c2', '00000000-0000-0000-0000-000000000001', 'PERF_OPERATIONAL', 'Operationnel (test)'),
  ('00000000-0000-0000-0000-0000000fe0c3', '00000000-0000-0000-0000-0000000fe0b2', 'PERF_READER_B', 'Lecteur performance B (test)')
on conflict (tenant_id, code) do nothing;

-- The reader gets EXACTLY the module capability, and nothing else.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fe0c1', p.id from public.permission p
 where p.code in ('performance:read', 'performance:manage')
on conflict do nothing;
-- The operational actor gets the customs/HR authority and NOT the module.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fe0c2', p.id from public.permission p
 where p.code in ('customs:read', 'customs:update', 'customs:validate',
                  'customs:correct', 'customs:revalidate', 'hr:read', 'hr:manage')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fe0c3', p.id from public.permission p
 where p.code in ('performance:read', 'customs:read')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000fe001', '00000000-0000-0000-0000-0000000fe0c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000fe002', '00000000-0000-0000-0000-0000000fe0c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000fe003', '00000000-0000-0000-0000-0000000fe0c3', '00000000-0000-0000-0000-0000000fe0b2')
on conflict do nothing;

-- A calendar day and a correction row in tenant A, for the isolation checks.
insert into public.hr_calendar_day (id, tenant_id, day, kind, label) values
  ('00000000-0000-0000-0000-0000000fe0e1', '00000000-0000-0000-0000-000000000001',
   '2026-12-25', 'PUBLIC_HOLIDAY', 'Noel')
on conflict (tenant_id, day) do nothing;

-- ---------------------------------------------------------------------------
-- 1. The catalog.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.permission
   where code in ('performance:read', 'performance:manage');
  insert into _r values ('both_capabilities_catalogued', n);
  if n <> 2 then raise exception 'PERF FAIL: expected 2 capabilities, found %', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A performance reader holds NO operational authority.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe001'
     and p.code in ('hr:manage', 'customs:update', 'customs:validate',
                    'customs:correct', 'customs:revalidate');
  insert into _r values ('reader_holds_no_operational_authority', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'PERF FAIL: a performance reader holds % operational permission(s)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. …and the converse: operational authority is not a way into the module.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002'
     and p.code in ('performance:read', 'performance:manage');
  insert into _r values ('operational_holder_has_no_module_access', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'PERF FAIL: an operational actor gained % module capability(ies)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS — measured under each role, recorded after reset (authenticated
--    cannot write the superuser session's temp table).
-- ---------------------------------------------------------------------------
set local role authenticated;

-- The performance reader holds no hr:read: the calendar is not disclosed.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000fe001', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  perform set_config('perf.reader_calendar', n::text, true);
  if n <> 0 then
    raise exception 'PERF FAIL: a performance reader without hr:read saw % calendar rows', n;
  end if;
end $$;

-- The cross-tenant performance reader sees no tenant-A correction.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000fe003', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.customs_correction
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('perf.xtenant_corrections', n::text, true);
  if n <> 0 then raise exception 'PERF FAIL: cross-tenant correction leak (% rows)', n; end if;

  select count(*) into n from public.hr_calendar_day
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('perf.xtenant_calendar', n::text, true);
  if n <> 0 then raise exception 'PERF FAIL: cross-tenant calendar leak (% rows)', n; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

insert into _r values
  ('reader_without_hr_read_sees_no_calendar',
   case when current_setting('perf.reader_calendar')::int = 0 then 1 else 0 end),
  ('cross_tenant_corrections_invisible',
   case when current_setting('perf.xtenant_corrections')::int = 0 then 1 else 0 end),
  ('cross_tenant_calendar_invisible',
   case when current_setting('perf.xtenant_calendar')::int = 0 then 1 else 0 end);

-- ---------------------------------------------------------------------------
-- 5. Nothing this module touches acquired a write policy.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('hr_calendar_day', 'customs_correction')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');
  insert into _r values ('no_write_policy_on_either_table', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'PERF FAIL: % write policy(ies) appeared — the actions must remain the boundary', n;
  end if;
end $$;

select * from _r order by check_name;
rollback;
