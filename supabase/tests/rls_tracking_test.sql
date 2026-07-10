-- RLS regression test — Tracking (Phase 3.4). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the three read audiences on tracking_event / tracking_position:
--   * staff  (OPS_SUPERVISOR, tracking:read + file:read:all) sees ALL tenant-A
--     tracking rows, NEVER tenant B (isolation).
--   * staff  (COORDINATOR, tracking:read, coordinates fileX) sees fileX rows,
--     not the unrelated fileY.
--   * no-perm (QUOTATION_MANAGER) sees none.
--   * driver (DRIVER role, driver_user_id on fileX's transport) sees fileX rows
--     via is_assigned_driver, but NOT fileY (not their transport). Fails
--     can_read_file, so the staff policy never applies to them.
--   * portal (client_user for Client A) sees ONLY customer-visible rows on its
--     own client's file, never internal-only rows, never another tenant's.
--
-- Requires all migrations + seed applied. Run like the other RLS tests:
--   psql "$DATABASE_URL" -f supabase/tests/rls_tracking_test.sql

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Staff + driver identities (app_user) and the portal identity (client_user).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000d40001', 'trk_ops@test.local'),
  ('00000000-0000-0000-0000-000000d40002', 'trk_coord@test.local'),
  ('00000000-0000-0000-0000-000000d40003', 'trk_none@test.local'),
  ('00000000-0000-0000-0000-000000d40004', 'trk_driver@test.local'),
  ('00000000-0000-0000-0000-000000d40005', 'trk_portal@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-000000d40001', '00000000-0000-0000-0000-000000000001', 'trk_ops@test.local'),
  ('00000000-0000-0000-0000-000000d40002', '00000000-0000-0000-0000-000000000001', 'trk_coord@test.local'),
  ('00000000-0000-0000-0000-000000d40003', '00000000-0000-0000-0000-000000000001', 'trk_none@test.local'),
  ('00000000-0000-0000-0000-000000d40004', '00000000-0000-0000-0000-000000000001', 'trk_driver@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-000000d40001'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-000000d40002'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-000000d40003'::uuid, 'QUOTATION_MANAGER'),
  ('00000000-0000-0000-0000-000000d40004'::uuid, 'DRIVER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-000000c40001', '00000000-0000-0000-0000-000000000001', 'Track Client A'),
  ('00000000-0000-0000-0000-000000c40002', '00000000-0000-0000-0000-0000000000b2', 'Track Client B')
on conflict (id) do nothing;

-- Portal user for Client A (portal identity — no app_user row).
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-000000d40005', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000c40001', 'trk_portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-000000f40001', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-97001', 'TRP', '00000000-0000-0000-0000-000000c40001', '00000000-0000-0000-0000-000000d40002'),
  ('00000000-0000-0000-0000-000000f40002', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-97002', 'TRP', '00000000-0000-0000-0000-000000c40001', null),
  ('00000000-0000-0000-0000-000000f40003', '00000000-0000-0000-0000-0000000000b2', 'EFT-TRP-2099-97003', 'TRP', '00000000-0000-0000-0000-000000c40002', null)
on conflict (id) do nothing;

-- fileX transport is assigned to the driver; fileY transport is not.
insert into public.transport_record (id, tenant_id, file_id, status, driver_user_id) values
  ('00000000-0000-0000-0000-000000740001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40001', 'IN_TRANSIT', '00000000-0000-0000-0000-000000d40004'),
  ('00000000-0000-0000-0000-000000740002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40002', 'IN_TRANSIT', null)
on conflict (id) do nothing;

-- Events: fileX customer-visible + fileX internal-only + fileY visible + tenant-B.
insert into public.tracking_event (id, tenant_id, file_id, transport_id, type, source, customer_visible) values
  ('00000000-0000-0000-0000-000000e40001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40001', '00000000-0000-0000-0000-000000740001', 'DEPARTED',     'manual', true),
  ('00000000-0000-0000-0000-000000e40002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40001', '00000000-0000-0000-0000-000000740001', 'CUSTOMS_STOP', 'manual', false),
  ('00000000-0000-0000-0000-000000e40003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40002', '00000000-0000-0000-0000-000000740002', 'DEPARTED',     'manual', true),
  ('00000000-0000-0000-0000-000000e40004', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000f40003', null, 'DEPARTED', 'manual', true)
on conflict (id) do nothing;

insert into public.tracking_position (id, tenant_id, file_id, transport_id, latitude, longitude, source, customer_visible, recorded_at) values
  ('00000000-0000-0000-0000-000000504001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40001', '00000000-0000-0000-0000-000000740001', 14.6796, -17.4249, 'manual', true,  now()),
  ('00000000-0000-0000-0000-000000504002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40001', '00000000-0000-0000-0000-000000740001', 14.7000, -17.4000, 'manual', false, now()),
  ('00000000-0000-0000-0000-000000504003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f40002', '00000000-0000-0000-0000-000000740002', 14.7167, -17.4677, 'manual', true,  now()),
  ('00000000-0000-0000-0000-000000504004', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000f40003', null, 12.6392, -8.0029, 'manual', true, now())
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  ops_xv int; ops_xi int; ops_y int; ops_b int; ops_pxv int; ops_pb int;
  coord_xv int; coord_xi int; coord_y int;
  none_xv int;
  drv_xv int; drv_xi int; drv_y int; drv_pxv int;
  por_xv int; por_xi int; por_b int; por_pxv int; por_pxi int;
begin
  perform set_config('role', 'authenticated', true);

  -- OPS_SUPERVISOR (tracking:read + file:read:all): all tenant-A, no tenant-B.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d40001','role','authenticated')::text, true);
  select count(*) into ops_xv from public.tracking_event where id='00000000-0000-0000-0000-000000e40001';
  select count(*) into ops_xi from public.tracking_event where id='00000000-0000-0000-0000-000000e40002';
  select count(*) into ops_y  from public.tracking_event where id='00000000-0000-0000-0000-000000e40003';
  select count(*) into ops_b  from public.tracking_event where id='00000000-0000-0000-0000-000000e40004';
  select count(*) into ops_pxv from public.tracking_position where id='00000000-0000-0000-0000-000000504001';
  select count(*) into ops_pb  from public.tracking_position where id='00000000-0000-0000-0000-000000504004';

  -- COORDINATOR (tracking:read, coordinates fileX): fileX rows, not fileY.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d40002','role','authenticated')::text, true);
  select count(*) into coord_xv from public.tracking_event where id='00000000-0000-0000-0000-000000e40001';
  select count(*) into coord_xi from public.tracking_event where id='00000000-0000-0000-0000-000000e40002';
  select count(*) into coord_y  from public.tracking_event where id='00000000-0000-0000-0000-000000e40003';

  -- QUOTATION_MANAGER (no tracking:read): nothing.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d40003','role','authenticated')::text, true);
  select count(*) into none_xv from public.tracking_event where id='00000000-0000-0000-0000-000000e40001';

  -- DRIVER (assigned to fileX transport): fileX rows via is_assigned_driver, not fileY.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d40004','role','authenticated')::text, true);
  select count(*) into drv_xv from public.tracking_event where id='00000000-0000-0000-0000-000000e40001';
  select count(*) into drv_xi from public.tracking_event where id='00000000-0000-0000-0000-000000e40002';
  select count(*) into drv_y  from public.tracking_event where id='00000000-0000-0000-0000-000000e40003';
  select count(*) into drv_pxv from public.tracking_position where id='00000000-0000-0000-0000-000000504001';

  -- PORTAL (Client A): only customer-visible rows on own client's file.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d40005','role','authenticated')::text, true);
  select count(*) into por_xv from public.tracking_event where id='00000000-0000-0000-0000-000000e40001';
  select count(*) into por_xi from public.tracking_event where id='00000000-0000-0000-0000-000000e40002';
  select count(*) into por_b  from public.tracking_event where id='00000000-0000-0000-0000-000000e40004';
  select count(*) into por_pxv from public.tracking_position where id='00000000-0000-0000-0000-000000504001';
  select count(*) into por_pxi from public.tracking_position where id='00000000-0000-0000-0000-000000504002';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('ops_xv', ops_xv), ('ops_xi', ops_xi), ('ops_y', ops_y), ('ops_b', ops_b), ('ops_pxv', ops_pxv), ('ops_pb', ops_pb),
    ('coord_xv', coord_xv), ('coord_xi', coord_xi), ('coord_y', coord_y),
    ('none_xv', none_xv),
    ('drv_xv', drv_xv), ('drv_xi', drv_xi), ('drv_y', drv_y), ('drv_pxv', drv_pxv),
    ('por_xv', por_xv), ('por_xi', por_xi), ('por_b', por_b), ('por_pxv', por_pxv), ('por_pxi', por_pxi);

  if ops_xv<>1 or ops_xi<>1 or ops_y<>1 or ops_b<>0 or ops_pxv<>1 or ops_pb<>0 then
    raise exception 'RLS TRACKING FAIL (ops): xv=% xi=% y=% b=% pxv=% pb=%', ops_xv, ops_xi, ops_y, ops_b, ops_pxv, ops_pb;
  end if;
  if coord_xv<>1 or coord_xi<>1 or coord_y<>0 then
    raise exception 'RLS TRACKING FAIL (coord): xv=% xi=% y=%', coord_xv, coord_xi, coord_y;
  end if;
  if none_xv<>0 then
    raise exception 'RLS TRACKING FAIL (no-perm): xv=%', none_xv;
  end if;
  if drv_xv<>1 or drv_xi<>1 or drv_y<>0 or drv_pxv<>1 then
    raise exception 'RLS TRACKING FAIL (driver): xv=% xi=% y=% pxv=%', drv_xv, drv_xi, drv_y, drv_pxv;
  end if;
  if por_xv<>1 or por_xi<>0 or por_b<>0 or por_pxv<>1 or por_pxi<>0 then
    raise exception 'RLS TRACKING FAIL (portal): xv=% xi=% b=% pxv=% pxi=%', por_xv, por_xi, por_b, por_pxv, por_pxi;
  end if;
end $$;

select * from _r order by check_name;
rollback;
