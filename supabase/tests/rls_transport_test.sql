-- RLS regression test — Transport (Phase 1.10). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves transport_record reads INHERIT dossier visibility (Phase 1.7
-- can_read_file) AND require transport:read:
--   * manager (OPS_SUPERVISOR, file:read:all + transport:read) sees records on
--     any tenant-A dossier but NOT tenant B (isolation)
--   * COORDINATOR (transport:read, coordinates fileX) sees fileX's record, not
--     the unrelated fileY's
--   * QUOTATION_MANAGER (no transport:read) sees none
-- Expected: 1 / 1 / 0 / 1 / 0 / 0.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'tmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000a8', 'tcoord@test.local'),
  ('00000000-0000-0000-0000-0000000000a9', 'tnone@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000001', 'tmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000001', 'tcoord@test.local'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000001', 'tnone@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000a7'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000a8'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-0000000000a9'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-98001', 'TRP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000a8'),
  ('00000000-0000-0000-0000-00000000fb02', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-98002', 'TRP', '00000000-0000-0000-0000-00000000c1a0', null),
  ('00000000-0000-0000-0000-00000000fb03', '00000000-0000-0000-0000-0000000000b2', 'EFT-TRP-2099-98003', 'TRP', '00000000-0000-0000-0000-00000000c1b0', null)
on conflict (id) do nothing;

insert into public.transport_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-00000000eb01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fb01', 'NOT_STARTED'),
  ('00000000-0000-0000-0000-00000000eb02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fb02', 'NOT_STARTED'),
  ('00000000-0000-0000-0000-00000000eb03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000fb03', 'NOT_STARTED')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  mgr_x int; mgr_y int; mgr_z int;
  coord_x int; coord_y int;
  none_x int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a7','role','authenticated')::text, true);
  select count(*) into mgr_x from public.transport_record where id='00000000-0000-0000-0000-00000000eb01';
  select count(*) into mgr_y from public.transport_record where id='00000000-0000-0000-0000-00000000eb02';
  select count(*) into mgr_z from public.transport_record where id='00000000-0000-0000-0000-00000000eb03';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a8','role','authenticated')::text, true);
  select count(*) into coord_x from public.transport_record where id='00000000-0000-0000-0000-00000000eb01';
  select count(*) into coord_y from public.transport_record where id='00000000-0000-0000-0000-00000000eb02';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a9','role','authenticated')::text, true);
  select count(*) into none_x from public.transport_record where id='00000000-0000-0000-0000-00000000eb01';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_trX', mgr_x), ('mgr_trY', mgr_y), ('mgr_trB', mgr_z),
    ('coord_trX', coord_x), ('coord_trY', coord_y),
    ('noperm_trX', none_x);

  if mgr_x<>1 or mgr_y<>1 or mgr_z<>0 or coord_x<>1 or coord_y<>0 or none_x<>0 then
    raise exception 'RLS TRANSPORT FAIL: mgr(x=% y=% b=%) coord(x=% y=%) noperm(x=%)',
      mgr_x, mgr_y, mgr_z, coord_x, coord_y, none_x;
  end if;
end $$;

select * from _r order by check_name;
rollback;
