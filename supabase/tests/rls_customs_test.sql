-- RLS regression test — Customs (Phase 1.9). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves customs_record reads INHERIT dossier visibility (Phase 1.7
-- can_read_file) AND require customs:read:
--   * manager (OPS_SUPERVISOR, file:read:all + customs:read) sees records on any
--     tenant-A dossier but NOT tenant B (isolation)
--   * COORDINATOR (customs:read, coordinates fileX) sees fileX's record, not the
--     unrelated fileY's
--   * QUOTATION_MANAGER (no customs:read) sees none
-- Expected: 1 / 1 / 0 / 1 / 0 / 0.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'cmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'ccoord@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'cnone@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'cmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'ccoord@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000001', 'cnone@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000e1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000e2'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-0000000000e3'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- fileX coordinated by U2; fileY unrelated; fileZ tenant B.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97001', 'IMP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-00000000fc02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97002', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null),
  ('00000000-0000-0000-0000-00000000fc03', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-97003', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null)
on conflict (id) do nothing;

-- Phase 7.1B — seed the canonical intelligence columns so isolation is proven to cover
-- them too (they live on customs_record and inherit customs_record_select).
insert into public.customs_record (id, tenant_id, file_id, status, intel_status, provider_code) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fc01', 'NOT_STARTED', 'SUBMITTED', 'GAINDE'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fc02', 'NOT_STARTED', 'DRAFT', 'manual'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000fc03', 'NOT_STARTED', 'ACCEPTED', 'manual')
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
    json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into mgr_x from public.customs_record where id='00000000-0000-0000-0000-00000000cc01';
  select count(*) into mgr_y from public.customs_record where id='00000000-0000-0000-0000-00000000cc02';
  select count(*) into mgr_z from public.customs_record where id='00000000-0000-0000-0000-00000000cc03';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into coord_x from public.customs_record where id='00000000-0000-0000-0000-00000000cc01';
  select count(*) into coord_y from public.customs_record where id='00000000-0000-0000-0000-00000000cc02';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e3','role','authenticated')::text, true);
  select count(*) into none_x from public.customs_record where id='00000000-0000-0000-0000-00000000cc01';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_custX', mgr_x), ('mgr_custY', mgr_y), ('mgr_custB', mgr_z),
    ('coord_custX', coord_x), ('coord_custY', coord_y),
    ('noperm_custX', none_x);

  if mgr_x<>1 or mgr_y<>1 or mgr_z<>0 or coord_x<>1 or coord_y<>0 or none_x<>0 then
    raise exception 'RLS CUSTOMS FAIL: mgr(x=% y=% b=%) coord(x=% y=%) noperm(x=%)',
      mgr_x, mgr_y, mgr_z, coord_x, coord_y, none_x;
  end if;
end $$;

-- Phase 7.1B — the canonical intelligence columns are covered by the SAME policy: the
-- manager reads fileX's intel_status but a tenant-B declaration returns nothing.
do $$
declare
  mgr_intel_x text; mgr_intel_b text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select intel_status into mgr_intel_x from public.customs_record where id='00000000-0000-0000-0000-00000000cc01';
  select intel_status into mgr_intel_b from public.customs_record where id='00000000-0000-0000-0000-00000000cc03';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_intelX_visible', case when mgr_intel_x='SUBMITTED' then 1 else 0 end),
    ('mgr_intelB_hidden',  case when mgr_intel_b is null then 1 else 0 end);

  if mgr_intel_x is distinct from 'SUBMITTED' or mgr_intel_b is not null then
    raise exception 'RLS CUSTOMS INTEL READ FAIL: x=% (want SUBMITTED), b=% (want null)', mgr_intel_x, mgr_intel_b;
  end if;
end $$;

-- Phase 7.1B — the RLS (authenticated) client can NEVER write a canonical transition:
-- customs_record grants SELECT only, so any UPDATE raises insufficient_privilege. This
-- proves a cross-tenant (and same-tenant) transition cannot be forced through the client
-- — writes go exclusively through the permission-gated service role.
do $$
declare
  x_blocked boolean := false; x_affected int := 0;  -- cross-tenant (tenant B row)
  s_blocked boolean := false; s_affected int := 0;  -- same-tenant own row
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);

  begin
    update public.customs_record set intel_status='CANCELLED', intel_version=intel_version+1
      where id='00000000-0000-0000-0000-00000000cc03';
    get diagnostics x_affected = row_count;
  exception when others then x_blocked := true;
  end;

  begin
    update public.customs_record set intel_status='CANCELLED', intel_version=intel_version+1
      where id='00000000-0000-0000-0000-00000000cc01';
    get diagnostics s_affected = row_count;
  exception when others then s_blocked := true;
  end;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('xtenant_write_blocked', case when x_blocked or x_affected=0 then 1 else 0 end),
    ('sametenant_write_blocked', case when s_blocked or s_affected=0 then 1 else 0 end);

  if not (x_blocked or x_affected=0) or not (s_blocked or s_affected=0) then
    raise exception 'RLS CUSTOMS WRITE FAIL: xtenant(blocked=% affected=%) same(blocked=% affected=%)',
      x_blocked, x_affected, s_blocked, s_affected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
