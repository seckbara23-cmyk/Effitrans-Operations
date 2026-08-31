-- Behaviour test — D3: the HR-maintained working-day calendar.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves:
--   * the table exists with the ratified kinds, and rejects any other kind
--   * one ruling per day — a day cannot be both férié and fermeture
--   * a blank label is refused (a non-worked day must say WHY)
--   * RLS: reads require (hr:read OR performance:read) AND the caller's own
--     tenant — UAT-PERF-CALENDAR-01, migration 134
--   * NO write policy exists — the hr:manage actions are the boundary (HR-A2)
--   * cross-tenant rows are invisible to BOTH read lanes
--   * two authorized same-tenant readers resolve the SAME calendar facts
--   * a Performance reader gains NO management authority
--   * operational roles gained no HR authority
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d3001', 'd3-hr@test.local'),
  ('00000000-0000-0000-0000-0000000d3002', 'd3-ops@test.local'),
  ('00000000-0000-0000-0000-0000000d3003', 'd3-xtenant@test.local'),
  -- UAT-PERF-CALENDAR-01: the reported shape — Performance authority, no HR.
  ('00000000-0000-0000-0000-0000000d3004', 'd3-perf@test.local'),
  ('00000000-0000-0000-0000-0000000d3005', 'd3-perf2@test.local'),
  ('00000000-0000-0000-0000-0000000d3006', 'd3-perf-xtenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000d30b2', 'D3 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000d3001', '00000000-0000-0000-0000-000000000001', 'd3-hr@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3002', '00000000-0000-0000-0000-000000000001', 'd3-ops@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3003', '00000000-0000-0000-0000-0000000d30b2', 'd3-xtenant@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3004', '00000000-0000-0000-0000-000000000001', 'd3-perf@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3005', '00000000-0000-0000-0000-000000000001', 'd3-perf2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3006', '00000000-0000-0000-0000-0000000d30b2', 'd3-perf-xtenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000d30c1', '00000000-0000-0000-0000-000000000001', 'D3_HR', 'RH (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c2', '00000000-0000-0000-0000-000000000001', 'D3_OPS', 'Ops (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c3', '00000000-0000-0000-0000-0000000d30b2', 'D3_HR_B', 'RH B (test D3)'),
  -- Performance authority WITHOUT any hr:* — exactly Fary's effective profile.
  ('00000000-0000-0000-0000-0000000d30c4', '00000000-0000-0000-0000-000000000001', 'D3_PERF', 'Performance (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c5', '00000000-0000-0000-0000-000000000001', 'D3_PERF_MGR', 'Performance manager (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c6', '00000000-0000-0000-0000-0000000d30b2', 'D3_PERF_B', 'Performance B (test D3)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c1', p.id from public.permission p
 where p.code in ('hr:read', 'hr:manage')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c2', p.id from public.permission p
 where p.code in ('process:read', 'file:read')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c3', p.id from public.permission p
 where p.code in ('hr:read', 'hr:manage')
on conflict do nothing;
-- Deliberately NO hr:* on any of the three below: the whole point is that the
-- Performance lane reads the calendar without borrowing HR authority.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c4', p.id from public.permission p
 where p.code = 'performance:read'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c5', p.id from public.permission p
 where p.code in ('performance:read', 'performance:manage')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d30c6', p.id from public.permission p
 where p.code in ('performance:read', 'performance:manage')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000d3001', '00000000-0000-0000-0000-0000000d30c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3002', '00000000-0000-0000-0000-0000000d30c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3003', '00000000-0000-0000-0000-0000000d30c3', '00000000-0000-0000-0000-0000000d30b2'),
  ('00000000-0000-0000-0000-0000000d3004', '00000000-0000-0000-0000-0000000d30c4', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3005', '00000000-0000-0000-0000-0000000d30c5', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3006', '00000000-0000-0000-0000-0000000d30c6', '00000000-0000-0000-0000-0000000d30b2')
on conflict do nothing;

insert into public.hr_calendar_day (id, tenant_id, day, kind, label, created_by) values
  ('00000000-0000-0000-0000-0000000d30e1', '00000000-0000-0000-0000-000000000001',
   '2026-04-04', 'PUBLIC_HOLIDAY', 'Fête de l''Indépendance', '00000000-0000-0000-0000-0000000d3001'),
  ('00000000-0000-0000-0000-0000000d30e2', '00000000-0000-0000-0000-000000000001',
   '2026-08-24', 'COMPANY_CLOSURE', 'Fermeture exceptionnelle Effitrans', '00000000-0000-0000-0000-0000000d3001'),
  ('00000000-0000-0000-0000-0000000d30e3', '00000000-0000-0000-0000-0000000d30b2',
   '2026-04-04', 'PUBLIC_HOLIDAY', 'Autre locataire', '00000000-0000-0000-0000-0000000d3003')
on conflict (tenant_id, day) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape and vocabulary.
-- ---------------------------------------------------------------------------
do $$
declare bad_kind boolean := false; dup boolean := false; blank boolean := false;
begin
  begin
    insert into public.hr_calendar_day (tenant_id, day, kind, label)
    values ('00000000-0000-0000-0000-000000000001', '2026-05-01', 'JOUR_CHOME', 'x');
  exception when check_violation then bad_kind := true; end;

  -- One ruling per day: a day is non-worked, or it is not.
  begin
    insert into public.hr_calendar_day (tenant_id, day, kind, label)
    values ('00000000-0000-0000-0000-000000000001', '2026-04-04', 'COMPANY_CLOSURE', 'doublon');
  exception when unique_violation then dup := true; end;

  -- A non-worked day must say why.
  begin
    insert into public.hr_calendar_day (tenant_id, day, kind, label)
    values ('00000000-0000-0000-0000-000000000001', '2026-05-01', 'PUBLIC_HOLIDAY', '   ');
  exception when check_violation then blank := true; end;

  insert into _r values ('invented_kind_rejected', case when bad_kind then 1 else 0 end),
                        ('one_ruling_per_day', case when dup then 1 else 0 end),
                        ('blank_label_rejected', case when blank then 1 else 0 end);
  if not (bad_kind and dup and blank) then
    raise exception 'D3 shape FAIL: kind=% dup=% blank=%', bad_kind, dup, blank;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. NO write policy — the hr:manage actions are the boundary (HR-A2).
-- ---------------------------------------------------------------------------
do $$
declare n_all int; n_write int;
begin
  select count(*) into n_all from pg_policies
   where schemaname='public' and tablename='hr_calendar_day';
  select count(*) into n_write from pg_policies
   where schemaname='public' and tablename='hr_calendar_day'
     and cmd in ('INSERT','UPDATE','DELETE');
  insert into _r values ('exactly_one_policy', n_all), ('no_write_policy', case when n_write=0 then 1 else 0 end);
  if n_all <> 1 or n_write <> 0 then
    raise exception 'D3 policy FAIL: total=% write=%', n_all, n_write;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS reads: hr:read only, own tenant only.
--
-- Measured under each impersonated role, recorded after `reset role`: the temp
-- results table belongs to the superuser session and `authenticated` cannot
-- write to it. Transaction-local settings cross the role boundary, so the
-- numbers below are the ones actually observed, not assumed.
-- ---------------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3001', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  perform set_config('d3.hr_reader', n::text, true);
  if n <> 2 then raise exception 'D3 RLS FAIL: hr:read holder saw % rows, expected 2', n; end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3002', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  perform set_config('d3.ops_reader', n::text, true);
  if n <> 0 then raise exception 'D3 RLS FAIL: an operational role saw % calendar rows', n; end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3003', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('d3.xtenant_reader', n::text, true);
  if n <> 0 then raise exception 'D3 RLS FAIL: cross-tenant leak of % rows', n; end if;
end $$;

-- UAT-PERF-CALENDAR-01 — the Performance lane. A performance:read holder with
-- NO hr:* sees the tenant's calendar: the reported defect, now a contract.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3004', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  perform set_config('d3.perf_reader', n::text, true);
  if n <> 2 then
    raise exception 'D3 RLS FAIL: a performance:read holder saw % calendar rows, expected 2', n;
  end if;
end $$;

-- …and a Performance MANAGER sees exactly the same facts — a second authorized
-- same-tenant reader must never resolve a different calendar.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3005', 'role', 'authenticated')::text, true);
do $$
declare n int; v_days text;
begin
  select count(*), string_agg(day::text, ',' order by day) into n, v_days
    from public.hr_calendar_day;
  perform set_config('d3.perf_mgr', n::text, true);
  perform set_config('d3.perf_mgr_days', v_days, true);
  if n <> 2 then
    raise exception 'D3 RLS FAIL: a performance manager saw % calendar rows, expected 2', n;
  end if;
end $$;

-- The HR reader's OWN row set, captured for the parity comparison below.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3001', 'role', 'authenticated')::text, true);
do $$
declare v_days text;
begin
  select string_agg(day::text, ',' order by day) into v_days from public.hr_calendar_day;
  perform set_config('d3.hr_days', v_days, true);
end $$;

-- Cross-tenant isolation holds for the NEW lane too: Performance authority in
-- tenant B sees nothing of tenant A.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000d3006', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('d3.perf_xtenant', n::text, true);
  if n <> 0 then
    raise exception 'D3 RLS FAIL: a performance reader leaked % cross-tenant rows', n;
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

insert into _r values
  ('hr_reader_sees_own_tenant_only', current_setting('d3.hr_reader')::int),
  ('operational_role_sees_nothing', case when current_setting('d3.ops_reader')::int = 0 then 1 else 0 end),
  ('cross_tenant_calendar_invisible', case when current_setting('d3.xtenant_reader')::int = 0 then 1 else 0 end),
  -- UAT-PERF-CALENDAR-01
  ('performance_reader_sees_calendar', case when current_setting('d3.perf_reader')::int = 2 then 1 else 0 end),
  ('performance_manager_sees_calendar', case when current_setting('d3.perf_mgr')::int = 2 then 1 else 0 end),
  ('cross_tenant_invisible_to_performance', case when current_setting('d3.perf_xtenant')::int = 0 then 1 else 0 end),
  -- THE INVARIANT: same tenant, two authorized readers, identical facts —
  -- compared day by day, not merely by row count.
  ('two_authorized_readers_identical_facts',
   case when current_setting('d3.hr_days') = current_setting('d3.perf_mgr_days') then 1 else 0 end);

do $$
begin
  if current_setting('d3.hr_days') is distinct from current_setting('d3.perf_mgr_days') then
    raise exception 'D3 PARITY FAIL: HR reader saw [%] but the performance manager saw [%] — the calendar became viewer-dependent',
      current_setting('d3.hr_days'), current_setting('d3.perf_mgr_days');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. No operational role acquired HR authority.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code in ('hr:manage','hr:read')
     and r.code in ('CHIEF_OF_TRANSIT','CUSTOMS_DECLARANT','COORDINATOR','ACCOUNT_MANAGER',
                    'TRANSPORT_OFFICER','COLLECTIONS_OFFICER','COURIER');
  insert into _r values ('no_operational_role_holds_hr', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'D3 authority FAIL: % operational grants of hr:*', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. UAT-PERF-CALENDAR-01 — the read lane granted NO management authority.
-- ---------------------------------------------------------------------------
do $$
declare n_write int; n_hr int;
begin
  -- Still no write policy at all: management remains the hr:manage actions.
  select count(*) into n_write from pg_policies
   where schemaname='public' and tablename='hr_calendar_day'
     and cmd in ('INSERT','UPDATE','DELETE');
  insert into _r values ('read_widening_added_no_write_policy', case when n_write=0 then 1 else 0 end);
  if n_write <> 0 then
    raise exception 'D3 FAIL: the read widening introduced % write policy(ies)', n_write;
  end if;

  -- And no Performance role acquired hr:* anywhere.
  select count(*) into n_hr
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code like 'hr:%'
     and r.code in ('PERFORMANCE_MANAGEMENT','PERFORMANCE_PUBLISHER','D3_PERF','D3_PERF_MGR');
  insert into _r values ('performance_roles_hold_no_hr', case when n_hr=0 then 1 else 0 end);
  if n_hr <> 0 then
    raise exception 'D3 FAIL: % hr:* grant(s) reached a Performance role — the fix must widen a POLICY, never HR authority', n_hr;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Every recorded check must be 1 (a silent 0 must not pass unnoticed).
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*), min(check_name) into v_n, v_bad from _r where value <> 1;
  if v_n <> 0 then raise exception 'D3 FAIL: % check(s) did not hold (e.g. %)', v_n, v_bad; end if;
end $$;

select * from _r order by check_name;
rollback;
