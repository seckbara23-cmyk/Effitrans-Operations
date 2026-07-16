-- RLS regression test — Air Cargo Platform (Phase 7.3A). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the air tables are tenant-isolated (transport:read) in BOTH directions and that the
-- authenticated client can never write them (SELECT-only grant):
--   * tenant-A operator sees tenant-A air_uld/air_airline, NOT tenant B; and vice versa
--   * a user without transport:read sees none
--   * cross-tenant + same-tenant writes via the authenticated client are rejected
-- Expected: A(1/0 uld, 1/0 airline), B(1/0), noperm(0), writes blocked.

begin;

insert into public.organization (id, name, country) values ('00000000-0000-0000-0000-0000000000d2', 'Air Tenant B', 'SN') on conflict (id) do nothing;
insert into public.role (id, tenant_id, code, label_fr) values ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000000d2', 'B_AIR', 'B Air') on conflict (id) do nothing;
insert into public.role_permission (role_id, permission_id) select '00000000-0000-0000-0000-0000000000db', p.id from public.permission p where p.code = 'transport:read' on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'airA@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'airB@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'airN@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'airA@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2', 'airB@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000001', 'airN@test.local')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000d1', r.id, r.tenant_id from public.role r where r.code = 'OPS_SUPERVISOR' and r.tenant_id = '00000000-0000-0000-0000-000000000001' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000000d2') on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000cd1a', '00000000-0000-0000-0000-000000000001', 'Air Client A'),
  ('00000000-0000-0000-0000-00000000cd1b', '00000000-0000-0000-0000-0000000000d2', 'Air Client B')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fd1a', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-99001', 'IMP', '00000000-0000-0000-0000-00000000cd1a'),
  ('00000000-0000-0000-0000-00000000fd1b', '00000000-0000-0000-0000-0000000000d2', 'EFT-IMP-2099-99002', 'IMP', '00000000-0000-0000-0000-00000000cd1b')
on conflict (id) do nothing;
insert into public.shipment (id, tenant_id, file_id, transport_mode, air_milestone) values
  ('00000000-0000-0000-0000-00000000ad1a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fd1a', 'AIR', 'DEPARTED'),
  ('00000000-0000-0000-0000-00000000ad1b', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000fd1b', 'AIR', 'DEPARTED')
on conflict (id) do nothing;
insert into public.air_airline (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000aa1a', '00000000-0000-0000-0000-000000000001', 'Airline A'),
  ('00000000-0000-0000-0000-00000000aa1b', '00000000-0000-0000-0000-0000000000d2', 'Airline B')
on conflict (id) do nothing;
insert into public.air_uld (id, tenant_id, shipment_id, uld_number) values
  ('00000000-0000-0000-0000-00000000ed1a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad1a', 'AKE11111AA'),
  ('00000000-0000-0000-0000-00000000ed1b', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000ad1b', 'AKE22222BB')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare a_u int; a_ou int; a_al int; a_oal int; b_u int; b_ou int; n_u int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  select count(*) into a_u  from public.air_uld where id='00000000-0000-0000-0000-00000000ed1a';
  select count(*) into a_ou from public.air_uld where id='00000000-0000-0000-0000-00000000ed1b';
  select count(*) into a_al  from public.air_airline where id='00000000-0000-0000-0000-00000000aa1a';
  select count(*) into a_oal from public.air_airline where id='00000000-0000-0000-0000-00000000aa1b';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d2','role','authenticated')::text, true);
  select count(*) into b_u  from public.air_uld where id='00000000-0000-0000-0000-00000000ed1b';
  select count(*) into b_ou from public.air_uld where id='00000000-0000-0000-0000-00000000ed1a';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d3','role','authenticated')::text, true);
  select count(*) into n_u from public.air_uld where id='00000000-0000-0000-0000-00000000ed1a';
  perform set_config('role', 'postgres', true);
  insert into _r values ('A_ownUld', a_u), ('A_otherUld', a_ou), ('A_ownAirline', a_al), ('A_otherAirline', a_oal), ('B_ownUld', b_u), ('B_otherUld', b_ou), ('noperm_uld', n_u);
  if a_u<>1 or a_ou<>0 or a_al<>1 or a_oal<>0 or b_u<>1 or b_ou<>0 or n_u<>0 then
    raise exception 'RLS AIR FAIL: A(u=% ou=% al=% oal=%) B(u=% ou=%) noperm=%', a_u, a_ou, a_al, a_oal, b_u, b_ou, n_u;
  end if;
end $$;

do $$
declare x_b boolean := false; x_a int := 0; s_b boolean := false; s_a int := 0;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  begin update public.shipment set air_milestone='CANCELLED', air_tracking_version=air_tracking_version+1 where id='00000000-0000-0000-0000-00000000ad1b'; get diagnostics x_a = row_count; exception when others then x_b := true; end;
  begin update public.air_uld set status='RETURNED' where id='00000000-0000-0000-0000-00000000ed1a'; get diagnostics s_a = row_count; exception when others then s_b := true; end;
  perform set_config('role', 'postgres', true);
  insert into _r values ('xtenant_shipment_write_blocked', case when x_b or x_a=0 then 1 else 0 end), ('sametenant_uld_write_blocked', case when s_b or s_a=0 then 1 else 0 end);
  if not (x_b or x_a=0) or not (s_b or s_a=0) then raise exception 'RLS AIR WRITE FAIL: xtenant(b=% a=%) same(b=% a=%)', x_b, x_a, s_b, s_a; end if;
end $$;

select * from _r order by check_name;
rollback;
