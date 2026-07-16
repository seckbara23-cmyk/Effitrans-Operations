-- RLS regression test — Shipping Line Platform (Phase 7.2A). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the ocean satellite tables are tenant-isolated (transport:read) in BOTH
-- directions, and that the authenticated client can never write them (SELECT-only grant):
--   * tenant-A operator sees tenant-A ocean_container/ocean_tracking_event, NOT tenant B
--   * tenant-B operator sees tenant-B rows, NOT tenant A
--   * a user without transport:read sees none
--   * cross-tenant + same-tenant writes via the authenticated client are rejected
-- Expected: A(1/0), B(1/0), noperm(0), writes blocked.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c2', 'Ship Tenant B', 'SN')
on conflict (id) do nothing;

-- A dedicated tenant-B role holding transport:read (the permission catalog is global).
insert into public.role (id, tenant_id, code, label_fr)
values ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000c2', 'B_OPS', 'B Ops')
on conflict (id) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000000cb', p.id from public.permission p where p.code = 'transport:read'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'shipA@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'shipB@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'shipN@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'shipA@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2', 'shipB@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', 'shipN@test.local')
on conflict (id) do nothing;

-- shipA → OPS_SUPERVISOR (tenant A, has transport:read); shipB → B_OPS; shipN → no transport role.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f1', r.id, r.tenant_id
from public.role r where r.code = 'OPS_SUPERVISOR' and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000c2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000caa0', '00000000-0000-0000-0000-000000000001', 'Ship Client A'),
  ('00000000-0000-0000-0000-00000000cbb0', '00000000-0000-0000-0000-0000000000c2', 'Ship Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-98001', 'IMP', '00000000-0000-0000-0000-00000000caa0'),
  ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-0000000000c2', 'EFT-IMP-2099-98002', 'IMP', '00000000-0000-0000-0000-00000000cbb0')
on conflict (id) do nothing;

insert into public.shipment (id, tenant_id, file_id, transport_mode, ocean_milestone, provider_code) values
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fa01', 'SEA', 'IN_TRANSIT', 'manual'),
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000fb01', 'SEA', 'IN_TRANSIT', 'manual')
on conflict (id) do nothing;

insert into public.ocean_container (id, tenant_id, shipment_id, container_number, status) values
  ('00000000-0000-0000-0000-00000000ca11', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a501', 'MSKU1234565', 'ON_VESSEL'),
  ('00000000-0000-0000-0000-00000000cb11', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000b501', 'MSCU7654321', 'ON_VESSEL')
on conflict (id) do nothing;

insert into public.ocean_tracking_event (id, tenant_id, shipment_id, event_type, occurred_at, source, confidence, fingerprint) values
  ('00000000-0000-0000-0000-00000000ea11', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a501', 'VESSEL_DEPARTED', now(), 'MANUAL', 'MANUAL', 'fpA'),
  ('00000000-0000-0000-0000-00000000eb11', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000b501', 'VESSEL_DEPARTED', now(), 'MANUAL', 'MANUAL', 'fpB')
on conflict do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  a_ownC int; a_otherC int; a_ownE int; a_otherE int;
  b_ownC int; b_otherC int;
  n_c int;
begin
  perform set_config('role', 'authenticated', true);

  -- Tenant-A operator (transport:read via OPS_SUPERVISOR).
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f1','role','authenticated')::text, true);
  select count(*) into a_ownC   from public.ocean_container where id='00000000-0000-0000-0000-00000000ca11';
  select count(*) into a_otherC from public.ocean_container where id='00000000-0000-0000-0000-00000000cb11';
  select count(*) into a_ownE   from public.ocean_tracking_event where id='00000000-0000-0000-0000-00000000ea11';
  select count(*) into a_otherE from public.ocean_tracking_event where id='00000000-0000-0000-0000-00000000eb11';

  -- Tenant-B operator (transport:read via B_OPS) — opposite direction.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f2','role','authenticated')::text, true);
  select count(*) into b_ownC   from public.ocean_container where id='00000000-0000-0000-0000-00000000cb11';
  select count(*) into b_otherC from public.ocean_container where id='00000000-0000-0000-0000-00000000ca11';

  -- No-permission user in tenant A.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f3','role','authenticated')::text, true);
  select count(*) into n_c from public.ocean_container where id='00000000-0000-0000-0000-00000000ca11';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('A_ownContainer', a_ownC), ('A_otherContainer', a_otherC),
    ('A_ownEvent', a_ownE), ('A_otherEvent', a_otherE),
    ('B_ownContainer', b_ownC), ('B_otherContainer', b_otherC),
    ('noperm_container', n_c);

  if a_ownC<>1 or a_otherC<>0 or a_ownE<>1 or a_otherE<>0 or b_ownC<>1 or b_otherC<>0 or n_c<>0 then
    raise exception 'RLS SHIPPING FAIL: A(own=% other=% ownE=% otherE=%) B(own=% other=%) noperm=%',
      a_ownC, a_otherC, a_ownE, a_otherE, b_ownC, b_otherC, n_c;
  end if;
end $$;

-- Writes via the authenticated client are impossible (SELECT-only grant): cross-tenant AND
-- same-tenant milestone updates are rejected — writes go only through the service role.
do $$
declare
  x_blocked boolean := false; x_affected int := 0;
  s_blocked boolean := false; s_affected int := 0;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f1','role','authenticated')::text, true);

  begin
    update public.shipment set ocean_milestone='CANCELLED', tracking_version=tracking_version+1
      where id='00000000-0000-0000-0000-00000000b501';
    get diagnostics x_affected = row_count;
  exception when others then x_blocked := true;
  end;
  begin
    update public.ocean_container set status='RETURNED'
      where id='00000000-0000-0000-0000-00000000ca11';
    get diagnostics s_affected = row_count;
  exception when others then s_blocked := true;
  end;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('xtenant_shipment_write_blocked', case when x_blocked or x_affected=0 then 1 else 0 end),
    ('sametenant_container_write_blocked', case when s_blocked or s_affected=0 then 1 else 0 end);

  if not (x_blocked or x_affected=0) or not (s_blocked or s_affected=0) then
    raise exception 'RLS SHIPPING WRITE FAIL: xtenant(blocked=% affected=%) same(blocked=% affected=%)',
      x_blocked, x_affected, s_blocked, s_affected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
