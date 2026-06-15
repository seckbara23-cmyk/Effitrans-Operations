-- RLS regression test — Documents (Phase 1.8). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves document reads INHERIT dossier visibility (Phase 1.7) AND require
-- document:read:
--   * manager (OPS_SUPERVISOR, file:read:all + document:read) sees docs on any
--     tenant-A dossier, but NOT tenant B (isolation)
--   * COORDINATOR (document:read, coordinates fileX) sees fileX's doc, not the
--     unrelated fileY's
--   * QUOTATION_MANAGER (no document:read) sees nothing
-- Expected: see the final assertion (raises on any mismatch).
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'dcoord@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'dnone@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'dmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'dcoord@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000001', 'dnone@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000d1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000d2'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-0000000000d3'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- fileX coordinated by U2; fileY unrelated; fileZ tenant B.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96002', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null),
  ('00000000-0000-0000-0000-00000000fd03', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-96003', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null)
on conflict (id) do nothing;

insert into public.document (id, tenant_id, file_id, type_code, status, storage_path) values
  ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fd01', 'OTHER', 'UPLOADED', 't/x/dc01.pdf'),
  ('00000000-0000-0000-0000-00000000dc02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fd02', 'OTHER', 'UPLOADED', 't/y/dc02.pdf'),
  ('00000000-0000-0000-0000-00000000dc03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000fd03', 'OTHER', 'UPLOADED', 't/z/dc03.pdf')
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
    json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  select count(*) into mgr_x from public.document where id='00000000-0000-0000-0000-00000000dc01';
  select count(*) into mgr_y from public.document where id='00000000-0000-0000-0000-00000000dc02';
  select count(*) into mgr_z from public.document where id='00000000-0000-0000-0000-00000000dc03';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d2','role','authenticated')::text, true);
  select count(*) into coord_x from public.document where id='00000000-0000-0000-0000-00000000dc01';
  select count(*) into coord_y from public.document where id='00000000-0000-0000-0000-00000000dc02';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d3','role','authenticated')::text, true);
  select count(*) into none_x from public.document where id='00000000-0000-0000-0000-00000000dc01';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_docX', mgr_x), ('mgr_docY', mgr_y), ('mgr_docB', mgr_z),
    ('coord_docX', coord_x), ('coord_docY', coord_y),
    ('nodocperm_docX', none_x);

  if mgr_x<>1 or mgr_y<>1 or mgr_z<>0 or coord_x<>1 or coord_y<>0 or none_x<>0 then
    raise exception 'RLS DOCUMENT FAIL: mgr(x=% y=% b=%) coord(x=% y=%) noperm(x=%)',
      mgr_x, mgr_y, mgr_z, coord_x, coord_y, none_x;
  end if;
end $$;

select * from _r order by check_name;
rollback;
