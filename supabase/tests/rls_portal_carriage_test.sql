-- RLS regression test — Portal ocean/air tracking visibility (Phase 7.5A). BEGIN/ROLLBACK.
-- ---------------------------------------------------------------------------
-- Proves the additive portal SELECT policies on the shipment-linked ocean/air child tables
-- scope to tenant + customer + portal-account, and leak nothing across customers or tenants:
--   * an ACTIVE portal user (client A1) sees its OWN shipment's ocean_container/event + air_awb -> 1
--   * NOT another customer's container in the SAME tenant                                       -> 0
--   * NOT another tenant's container                                                            -> 0
--   * a DISABLED portal user sees nothing                                                       -> 0
--   * staff (transport:read) is unaffected                                                      -> 1
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country) values ('00000000-0000-0000-0000-0000000000c2', 'Carriage Tenant C', 'SN') on conflict (id) do nothing;

-- S1 = staff (transport:read via OPS_SUPERVISOR); P1 = active portal (client A1); P2 = disabled portal.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ca00', 'carrStaff@test.local'),
  ('00000000-0000-0000-0000-00000000ca01', 'carrP1@test.local'),
  ('00000000-0000-0000-0000-00000000ca02', 'carrP2@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000ca00', '00000000-0000-0000-0000-000000000001', 'carrStaff@test.local')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ca00', r.id, r.tenant_id from public.role r
where r.code = 'OPS_SUPERVISOR' and r.tenant_id = '00000000-0000-0000-0000-000000000001' on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000001', 'Carriage Client A1'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000001', 'Carriage Client A2'),
  ('00000000-0000-0000-0000-00000000cc0b', '00000000-0000-0000-0000-0000000000c2', 'Carriage Client B1')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cc01', 'carrP1@test.local', 'ACTIVE', 'CLIENT_USER'),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cc01', 'carrP2@test.local', 'DISABLED', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95001', 'IMP', '00000000-0000-0000-0000-00000000cc01'),
  ('00000000-0000-0000-0000-00000000cf02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95002', 'IMP', '00000000-0000-0000-0000-00000000cc02'),
  ('00000000-0000-0000-0000-00000000cf0b', '00000000-0000-0000-0000-0000000000c2', 'EFT-IMP-2099-95003', 'IMP', '00000000-0000-0000-0000-00000000cc0b')
on conflict (id) do nothing;
insert into public.shipment (id, tenant_id, file_id, transport_mode, ocean_milestone) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cf01', 'SEA', 'VESSEL_ARRIVED'),
  ('00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cf02', 'SEA', 'VESSEL_ARRIVED'),
  ('00000000-0000-0000-0000-00000000c50b', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000cf0b', 'SEA', 'VESSEL_ARRIVED')
on conflict (id) do nothing;
insert into public.shipment (id, tenant_id, file_id, transport_mode, air_milestone) values
  ('00000000-0000-0000-0000-00000000c5a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cf01', 'AIR', 'DEPARTED')
on conflict (id) do nothing;

insert into public.ocean_container (id, tenant_id, shipment_id, container_number) values
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c501', 'CSQU3054383'),
  ('00000000-0000-0000-0000-00000000cb02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c502', 'MSKU0000001'),
  ('00000000-0000-0000-0000-00000000cb0b', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c50b', 'MSKU0000002')
on conflict (id) do nothing;
insert into public.ocean_tracking_event (id, tenant_id, shipment_id, event_type, occurred_at, source, confidence, fingerprint, latitude, longitude, vessel_name) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c501', 'VESSEL_ARRIVED', now(), 'CARRIER', 'CONFIRMED', 'fp-carr-a1', 14.67, -17.43, 'MV Test')
on conflict (id) do nothing;
insert into public.air_awb (id, tenant_id, shipment_id, mawb) values
  ('00000000-0000-0000-0000-00000000caa1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c5a1', '020-12345675')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare p1_k int; p1_ok int; p1_bk int; p1_ev int; p1_awb int; p2_k int; s_k int;
begin
  perform set_config('role', 'authenticated', true);
  -- P1 active portal (client A1)
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000ca01','role','authenticated')::text, true);
  select count(*) into p1_k   from public.ocean_container where id='00000000-0000-0000-0000-00000000cb01';
  select count(*) into p1_ok  from public.ocean_container where id='00000000-0000-0000-0000-00000000cb02';
  select count(*) into p1_bk  from public.ocean_container where id='00000000-0000-0000-0000-00000000cb0b';
  select count(*) into p1_ev  from public.ocean_tracking_event where id='00000000-0000-0000-0000-00000000ce01';
  select count(*) into p1_awb from public.air_awb where id='00000000-0000-0000-0000-00000000caa1';
  -- P2 disabled portal
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000ca02','role','authenticated')::text, true);
  select count(*) into p2_k from public.ocean_container where id='00000000-0000-0000-0000-00000000cb01';
  -- Staff (transport:read) unaffected
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000ca00','role','authenticated')::text, true);
  select count(*) into s_k from public.ocean_container where id='00000000-0000-0000-0000-00000000cb01';
  perform set_config('role', 'postgres', true);
  insert into _r values ('p1_own_container', p1_k), ('p1_other_client', p1_ok), ('p1_other_tenant', p1_bk),
    ('p1_own_event', p1_ev), ('p1_own_awb', p1_awb), ('p2_disabled', p2_k), ('staff_unaffected', s_k);
  if p1_k<>1 or p1_ok<>0 or p1_bk<>0 or p1_ev<>1 or p1_awb<>1 or p2_k<>0 or s_k<>1 then
    raise exception 'RLS PORTAL CARRIAGE FAIL: p1(k=% ok=% bk=% ev=% awb=%) p2=% staff=%', p1_k, p1_ok, p1_bk, p1_ev, p1_awb, p2_k, s_k;
  end if;
end $$;

select * from _r order by check_name;
rollback;
