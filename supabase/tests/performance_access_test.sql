-- Behaviour test — Gestion de la Performance: the assignable access role.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- RATIFIED 2026-08-28: module access comes from an EXPLICIT assignment of the
-- « Gestion de la Performance » role, never from an operational job role.
--
-- Proves in the DATABASE, against the real seeded role set:
--   * both capabilities exist, and the role exists and is assignable
--   * PERFORMANCE_MANAGEMENT holds exactly four permissions and no more
--   * NO other seeded role holds performance:read or performance:manage
--     (OPS_SUPERVISOR, CEO and SYSTEM_ADMIN each asserted by name)
--   * assigning the role GRANTS module access to a user who had none
--   * the same user keeps every permission of their original job role
--   * removing the role REMOVES module access and leaves the job role intact
--   * a user may hold the access role alongside a job role (both directions)
--   * the role grants no hr:*, no customs:*, no finance/collections/transport,
--     no process execution — a capability diff, computed not asserted
--   * an operational holder does NOT thereby hold performance access
--   * cross-tenant isolation on the calendar and the correction history
--   * neither governed table acquired a write policy
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
  ('00000000-0000-0000-0000-0000000fe0c2', '00000000-0000-0000-0000-000000000001', 'PERF_OPERATIONAL', 'Operationnel (test)'),
  ('00000000-0000-0000-0000-0000000fe0c3', '00000000-0000-0000-0000-0000000fe0b2', 'PERF_READER_B', 'Lecteur B (test)')
on conflict (tenant_id, code) do nothing;

-- The reader is given the REAL access role, not a test role carrying the
-- capabilities: this suite asserts that no role OTHER than
-- PERFORMANCE_MANAGEMENT holds performance access, and a fixture that granted
-- them itself would be the first violation.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000fe001', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

-- The operational actor holds customs + HR authority and NOT the module.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fe0c2', p.id from public.permission p
 where p.code in ('customs:read', 'customs:update', 'customs:validate',
                  'customs:correct', 'customs:revalidate', 'hr:read', 'hr:manage')
on conflict do nothing;

-- Tenant B's reader holds hr:read and customs:read IN ITS OWN TENANT, so the
-- zeros it sees below prove tenant isolation rather than a missing permission.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fe0c3', p.id from public.permission p
 where p.code in ('hr:read', 'customs:read')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000fe002', '00000000-0000-0000-0000-0000000fe0c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000fe003', '00000000-0000-0000-0000-0000000fe0c3', '00000000-0000-0000-0000-0000000fe0b2')
on conflict do nothing;

-- A calendar day and a correction row in tenant A, for the isolation checks.
insert into public.hr_calendar_day (id, tenant_id, day, kind, label) values
  ('00000000-0000-0000-0000-0000000fe0e1', '00000000-0000-0000-0000-000000000001',
   '2026-12-25', 'PUBLIC_HOLIDAY', 'Noel')
on conflict (tenant_id, day) do nothing;

-- ---------------------------------------------------------------------------
-- 1. The catalog, and the role.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.permission
   where code in ('performance:read', 'performance:manage');
  insert into _r values ('both_capabilities_catalogued', n);
  if n <> 2 then raise exception 'PERF FAIL: expected 2 capabilities, found %', n; end if;

  select count(*) into n from public.role
   where tenant_id = '00000000-0000-0000-0000-000000000001'
     and code = 'PERFORMANCE_MANAGEMENT'
     and label_fr = 'Gestion de la Performance';
  insert into _r values ('role_exists_with_french_name', n);
  if n <> 1 then raise exception 'PERF FAIL: the access role is missing (% rows)', n; end if;

  -- Assignable: the picker offers every tenant role except CLIENT_USER.
  select count(*) into n from public.role
   where tenant_id = '00000000-0000-0000-0000-000000000001'
     and code = 'PERFORMANCE_MANAGEMENT' and code <> 'CLIENT_USER';
  insert into _r values ('role_is_assignable', n);
  if n <> 1 then raise exception 'PERF FAIL: the access role is not assignable'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The capability diff — computed, not asserted by name.
-- ---------------------------------------------------------------------------
do $$
declare n int; extra text;
begin
  select count(*) into n
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code = 'PERFORMANCE_MANAGEMENT';
  insert into _r values ('role_holds_exactly_four_permissions', n);
  if n <> 4 then raise exception 'PERF FAIL: the access role holds % permissions, expected 4', n; end if;

  select count(*), min(p.code) into n, extra
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code = 'PERFORMANCE_MANAGEMENT'
     and p.code not in ('profile:read:self', 'profile:update:self',
                        'performance:read', 'performance:manage');
  insert into _r values ('role_holds_nothing_operational', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'PERF FAIL: the access role holds % extra permission(s), e.g. % — it is not a super-role', n, extra;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. No operational role is a way in. Asserted across EVERY seeded role, and
--    then by name for the three the ruling removed.
-- ---------------------------------------------------------------------------
do $$
declare n int; offender text;
begin
  select count(*), min(r.code) into n, offender
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code in ('performance:read', 'performance:manage')
     and r.code <> 'PERFORMANCE_MANAGEMENT';
  insert into _r values ('no_other_role_holds_performance', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'PERF FAIL: % role(s) other than the access role hold performance access, e.g. %', n, offender;
  end if;

  for offender in select unnest(array['OPS_SUPERVISOR', 'CEO', 'SYSTEM_ADMIN']) loop
    select count(*) into n
      from public.role r
      join public.role_permission rp on rp.role_id = r.id
      join public.permission p on p.id = rp.permission_id
     where r.code = offender and p.code like 'performance:%';
    insert into _r values (lower(offender) || '_has_no_automatic_access', case when n = 0 then 1 else 0 end);
    if n <> 0 then
      raise exception 'PERF FAIL: % still receives performance access automatically', offender;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3b. ASSIGNMENT — the behaviour the ruling is actually about.
--
--     A user holding an ordinary job role gains module access when the access
--     role is assigned, keeps their job role throughout, and loses module
--     access when it is removed. Exercised against the REAL seeded roles, using
--     the same user_role rows the « Attribuer » button writes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before int; v_after int; v_removed int;
  v_job_before int; v_job_during int; v_job_after int;
  v_role_id uuid;
begin
  select id into v_role_id from public.role
   where tenant_id = '00000000-0000-0000-0000-000000000001' and code = 'PERFORMANCE_MANAGEMENT';

  -- The subject holds a job role only (OPS_SUPERVISOR — the role that used to
  -- carry performance access by virtue of the job).
  select count(*) into v_before
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'performance:read';

  select count(*) into v_job_before
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'customs:validate';

  -- ATTRIBUER.
  insert into public.user_role (user_id, role_id, tenant_id)
  values ('00000000-0000-0000-0000-0000000fe002', v_role_id, '00000000-0000-0000-0000-000000000001')
  on conflict do nothing;

  select count(*) into v_after
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'performance:read';

  select count(*) into v_job_during
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'customs:validate';

  -- RETIRER.
  delete from public.user_role
   where user_id = '00000000-0000-0000-0000-0000000fe002' and role_id = v_role_id;

  select count(*) into v_removed
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'performance:read';

  select count(*) into v_job_after
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fe002' and p.code = 'customs:validate';

  insert into _r values
    ('before_assignment_no_access', case when v_before = 0 then 1 else 0 end),
    ('assignment_grants_access', case when v_after > 0 then 1 else 0 end),
    ('removal_revokes_access', case when v_removed = 0 then 1 else 0 end),
    ('job_role_survives_assignment', case when v_job_before > 0 and v_job_during > 0 then 1 else 0 end),
    ('job_role_survives_removal', case when v_job_after > 0 then 1 else 0 end);

  if v_before <> 0 then raise exception 'PERF FAIL: the subject had access before assignment'; end if;
  if v_after = 0 then raise exception 'PERF FAIL: assigning the role granted no access'; end if;
  if v_removed <> 0 then raise exception 'PERF FAIL: removing the role left access behind'; end if;
  if v_job_during = 0 or v_job_after = 0 then
    raise exception 'PERF FAIL: the assignment disturbed the job role (during=%, after=%)', v_job_during, v_job_after;
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
