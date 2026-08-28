-- Behaviour test — D3: the HR-maintained working-day calendar.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves:
--   * the table exists with the ratified kinds, and rejects any other kind
--   * one ruling per day — a day cannot be both férié and fermeture
--   * a blank label is refused (a non-worked day must say WHY)
--   * RLS: reads require hr:read AND the caller's own tenant
--   * NO write policy exists — the hr:manage actions are the boundary (HR-A2)
--   * cross-tenant rows are invisible even to an hr:read holder
--   * operational roles gained no HR authority
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d3001', 'd3-hr@test.local'),
  ('00000000-0000-0000-0000-0000000d3002', 'd3-ops@test.local'),
  ('00000000-0000-0000-0000-0000000d3003', 'd3-xtenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000d30b2', 'D3 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000d3001', '00000000-0000-0000-0000-000000000001', 'd3-hr@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3002', '00000000-0000-0000-0000-000000000001', 'd3-ops@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d3003', '00000000-0000-0000-0000-0000000d30b2', 'd3-xtenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000d30c1', '00000000-0000-0000-0000-000000000001', 'D3_HR', 'RH (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c2', '00000000-0000-0000-0000-000000000001', 'D3_OPS', 'Ops (test D3)'),
  ('00000000-0000-0000-0000-0000000d30c3', '00000000-0000-0000-0000-0000000d30b2', 'D3_HR_B', 'RH B (test D3)')
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

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000d3001', '00000000-0000-0000-0000-0000000d30c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3002', '00000000-0000-0000-0000-0000000d30c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d3003', '00000000-0000-0000-0000-0000000d30c3', '00000000-0000-0000-0000-0000000d30b2')
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
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000d3001"}';
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  insert into _r values ('hr_reader_sees_own_tenant_only', n);
  if n <> 2 then raise exception 'D3 RLS FAIL: hr:read holder saw % rows, expected 2', n; end if;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000d3002"}';
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day;
  insert into _r values ('operational_role_sees_nothing', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'D3 RLS FAIL: an operational role saw % calendar rows', n; end if;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000d3003"}';
do $$
declare n int;
begin
  select count(*) into n from public.hr_calendar_day
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  insert into _r values ('cross_tenant_calendar_invisible', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'D3 RLS FAIL: cross-tenant leak of % rows', n; end if;
end $$;

reset role;
set local request.jwt.claims = '';

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

select * from _r order by check_name;
rollback;
