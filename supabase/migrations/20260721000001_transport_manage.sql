-- 20260721000001_transport_manage.sql
-- Effitrans Operations Platform — PHASE 8.4: catalog the missing `transport:manage` permission.
--
-- ROOT-CAUSE FIX. The Phase 7.2B/7.3B reference-data actions (port/airport/carrier/vessel/
-- voyage create+edit, provider refresh) gate on assertPermission("transport:manage") — but the
-- permission was NEVER added to the catalog and is granted to no role. hasPermission is a
-- strict membership check, so every one of those actions returns `forbidden` for every user.
-- This is why no port coordinates could ever be entered, and therefore why the production
-- shipment map honestly reports « Carte indisponible : aucune coordonnée cartographiable » —
-- the UI and readers were complete; the write path was unreachable.
--
-- Granted to the transport reference-data tier: SYSTEM_ADMIN, OPS_SUPERVISOR, COORDINATOR,
-- TRANSPORT_OFFICER (the transport:update holders minus field-level PICKUP_AGENT — managing
-- the port/vessel catalog is a coordination responsibility, not a field task).
--
-- Clean-replay safe: global idempotent catalog insert + select-driven tenant-guarded grant
-- (matches 20260718000001/20260719000001). seed.sql + lib/platform/role-templates.ts mirror
-- this (parity machine-enforced by tests/role-templates.test.ts).

insert into public.permission (code, module, action, data_scope, description) values
  ('transport:manage', 'transport', 'manage', 'all', 'Manage transport reference data (ports, airports, carriers, vessels, voyages) and tracking providers')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Phase 8.4 (section B) — DEFENCE-IN-DEPTH coordinate range constraints. The app already
-- rejects out-of-range coordinates (isValidCoordinate: lat ∈ [-90,90], lon ∈ [-180,180]);
-- these DB CHECK constraints make an invalid coordinate impossible to persist even if a
-- future writer bypasses the app validator. Additive + safe: coordinate columns were
-- UNSEEDED upstream ("no invented coordinates") and the 8.4 seed uses valid values, so no
-- existing row violates. NOT VALID would defer validation; these are small tables so a full
-- validating add is fine. Applied where mappable coordinates live.
alter table public.ocean_port
  add constraint ocean_port_coord_range check (
    (latitude is null or (latitude >= -90 and latitude <= 90)) and
    (longitude is null or (longitude >= -180 and longitude <= 180))
  );

alter table public.air_airport
  add constraint air_airport_coord_range check (
    (latitude is null or (latitude >= -90 and latitude <= 90)) and
    (longitude is null or (longitude >= -180 and longitude <= 180))
  );

alter table public.ocean_tracking_event
  add constraint ocean_tracking_event_coord_range check (
    (latitude is null or (latitude >= -90 and latitude <= 90)) and
    (longitude is null or (longitude >= -180 and longitude <= 180))
  );

alter table public.air_tracking_event
  add constraint air_tracking_event_coord_range check (
    (latitude is null or (latitude >= -90 and latitude <= 90)) and
    (longitude is null or (longitude >= -180 and longitude <= 180))
  );

alter table public.tracking_position
  add constraint tracking_position_coord_range check (
    latitude >= -90 and latitude <= 90 and longitude >= -180 and longitude <= 180
  );
