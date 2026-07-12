-- RLS regression test — Driver ops privacy (Phase 3.4C-3). BEGIN/ROLLBACK.
-- ---------------------------------------------------------------------------
-- Proves that driver-mobile delay / incident / delivered evidence honours the
-- customer/internal boundary on tracking_event:
--   * A customer-safe DELAY_REPORTED (customer_visible=true) and the DELIVERED
--     confirmation ARE visible to the dossier's portal client.
--   * An INCIDENT_REPORTED marked internal (customer_visible=false), carrying an
--     internal_note + detail jsonb, is NEVER visible to the portal client —
--     internal incident details cannot leak to the client through RLS.
--   * The assigned driver sees ALL of their mission's rows (evidence layer).
--
-- Run like the other RLS tests:
--   psql "$DATABASE_URL" -f supabase/tests/rls_driver_ops_privacy_test.sql

begin;

-- Identities: assigned driver (app_user) + portal client_user for Client A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000d70004', 'dops_driver@test.local'),
  ('00000000-0000-0000-0000-000000d70005', 'dops_portal@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-000000d70004', '00000000-0000-0000-0000-000000000001', 'dops_driver@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-000000d70004'::uuid, r.id, r.tenant_id
from public.role r
where r.code = 'DRIVER' and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-000000c70001', '00000000-0000-0000-0000-000000000001', 'DOps Client A')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-000000d70005', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000c70001', 'dops_portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-000000f70001', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-97701', 'TRP', '00000000-0000-0000-0000-000000c70001')
on conflict (id) do nothing;

insert into public.transport_record (id, tenant_id, file_id, status, driver_user_id) values
  ('00000000-0000-0000-0000-000000770001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f70001', 'IN_TRANSIT', '00000000-0000-0000-0000-000000d70004')
on conflict (id) do nothing;

-- Driver-mobile evidence: customer-safe delay, internal incident, delivered.
insert into public.tracking_event (id, tenant_id, file_id, transport_id, type, source, customer_visible, customer_message, internal_note, detail) values
  ('00000000-0000-0000-0000-000000e70001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f70001', '00000000-0000-0000-0000-000000770001',
    'DELAY_REPORTED', 'driver_mobile', true,  'Retard dû à la circulation', null, '{"category":"traffic","expectedDelayMinutes":30}'),
  ('00000000-0000-0000-0000-000000e70002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f70001', '00000000-0000-0000-0000-000000770001',
    'INCIDENT_REPORTED', 'driver_mobile', false, null, 'Chauffeur signale un vol partiel de cargaison — police contactée', '{"category":"security","severity":"high"}'),
  ('00000000-0000-0000-0000-000000e70003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000f70001', '00000000-0000-0000-0000-000000770001',
    'DELIVERED', 'driver_mobile', true, 'Livraison effectuée.', null, '{"recipientName":"M. Diop"}')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  drv_delay int; drv_incident int; drv_delivered int;
  por_delay int; por_incident int; por_delivered int;
begin
  perform set_config('role', 'authenticated', true);

  -- Assigned DRIVER: sees all three of their mission's evidence rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d70004','role','authenticated')::text, true);
  select count(*) into drv_delay     from public.tracking_event where id='00000000-0000-0000-0000-000000e70001';
  select count(*) into drv_incident  from public.tracking_event where id='00000000-0000-0000-0000-000000e70002';
  select count(*) into drv_delivered from public.tracking_event where id='00000000-0000-0000-0000-000000e70003';

  -- PORTAL client: customer-safe delay + delivered ONLY; internal incident invisible.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000d70005','role','authenticated')::text, true);
  select count(*) into por_delay     from public.tracking_event where id='00000000-0000-0000-0000-000000e70001';
  select count(*) into por_incident  from public.tracking_event where id='00000000-0000-0000-0000-000000e70002';
  select count(*) into por_delivered from public.tracking_event where id='00000000-0000-0000-0000-000000e70003';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('drv_delay', drv_delay), ('drv_incident', drv_incident), ('drv_delivered', drv_delivered),
    ('por_delay', por_delay), ('por_incident', por_incident), ('por_delivered', por_delivered);

  if drv_delay<>1 or drv_incident<>1 or drv_delivered<>1 then
    raise exception 'RLS DRIVER-OPS FAIL (driver): delay=% incident=% delivered=%', drv_delay, drv_incident, drv_delivered;
  end if;
  -- The core privacy assertion: portal sees the safe rows, NEVER the internal incident.
  if por_delay<>1 or por_delivered<>1 or por_incident<>0 then
    raise exception 'RLS DRIVER-OPS FAIL (portal): delay=% delivered=% incident(must be 0)=%', por_delay, por_delivered, por_incident;
  end if;
end $$;

select * from _r order by check_name;
rollback;
