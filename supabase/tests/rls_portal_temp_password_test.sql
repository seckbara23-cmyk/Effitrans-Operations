-- RLS regression test — Portal temporary-password onboarding (Phase 3.2B).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- The migration adds only the additive boolean client_user.must_change_password
-- (no policy change). This proves the existing policies still govern it safely:
--   * a portal user reads OWN row + its must_change_password flag               -> 1
--   * a portal user sees ONLY its own client_user row (self-select)             -> 1 total
--   * staff (portal:manage) see their tenant's client_user rows                 -> P1 = 1
--   * staff do NOT see another tenant's client_user row (tenant isolation)      -> PB = 0
--   * a tenant-B portal user cannot read a tenant-A client_user row             -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- S1 staff admin (app_user, SYSTEM_ADMIN → portal:manage). P1 portal tenant A.
-- PB portal tenant B.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'staff2@test.local'),
  ('00000000-0000-0000-0000-000000000a20', 'p1temp@test.local'),
  ('00000000-0000-0000-0000-000000000b20', 'pbtemp@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'staff2@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a1', '00000000-0000-0000-0000-000000000001', 'Client A1'),
  ('00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-0000000000b2', 'Client B1')
on conflict (id) do nothing;

-- P1: ACTIVE tenant-A portal user WITH the forced-change flag set.
-- PB: ACTIVE tenant-B portal user.
insert into public.client_user (id, tenant_id, client_id, email, status, role, must_change_password) values
  ('00000000-0000-0000-0000-000000000a20', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c1a1', 'p1temp@test.local', 'ACTIVE', 'CLIENT_USER', true),
  ('00000000-0000-0000-0000-000000000b20', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000c1b1', 'pbtemp@test.local', 'ACTIVE', 'CLIENT_USER', false)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  p1_self_flag int; p1_total int; p1_sees_pb int;
  staff_p1 int; staff_pb int;
  pb_sees_p1 int;
begin
  perform set_config('role', 'authenticated', true);

  -- P1 reads own row + flag; sees only its own client_user row.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000a20','role','authenticated')::text, true);
  select count(*) into p1_self_flag from public.client_user
    where id='00000000-0000-0000-0000-000000000a20' and must_change_password = true;
  select count(*) into p1_total    from public.client_user;
  select count(*) into p1_sees_pb  from public.client_user where id='00000000-0000-0000-0000-000000000b20';

  -- Staff (portal:manage) see tenant-A client_user, not tenant-B.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into staff_p1 from public.client_user where id='00000000-0000-0000-0000-000000000a20';
  select count(*) into staff_pb from public.client_user where id='00000000-0000-0000-0000-000000000b20';

  -- Tenant-B portal user cannot read a tenant-A client_user row.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000b20','role','authenticated')::text, true);
  select count(*) into pb_sees_p1 from public.client_user where id='00000000-0000-0000-0000-000000000a20';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('p1_self_flag', p1_self_flag), ('p1_total_visible', p1_total), ('p1_sees_pb', p1_sees_pb),
    ('staff_sees_p1', staff_p1), ('staff_sees_pb', staff_pb), ('pb_sees_p1', pb_sees_p1);

  if p1_self_flag<>1 or p1_total<>1 or p1_sees_pb<>0 or staff_p1<>1 or staff_pb<>0 or pb_sees_p1<>0 then
    raise exception 'RLS PORTAL TEMP-PW FAIL: p1(flag=% total=% seesPB=%) staff(p1=% pb=%) pb(seesP1=%)',
      p1_self_flag, p1_total, p1_sees_pb, staff_p1, staff_pb, pb_sees_p1;
  end if;
end $$;

select * from _r order by check_name;
rollback;
