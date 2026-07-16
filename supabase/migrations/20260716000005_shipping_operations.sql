-- 20260716000005_shipping_operations.sql
-- Effitrans Operations Platform — PHASE 7.2B: Shipping operations (management surfaces).
--
-- Additive only: an `active` flag on the ocean reference tables (retire-not-delete +
-- active/inactive filters) and internal `notes` on carriers. No new table, no new
-- permission, no RLS policy change — the 7.2A `transport:read` policies + service-role
-- writes still govern these tables. No live carrier/AIS. No invented data seeded.

alter table public.ocean_carrier
  add column if not exists active boolean not null default true,
  add column if not exists notes text;

alter table public.ocean_port
  add column if not exists active boolean not null default true;

alter table public.ocean_vessel
  add column if not exists active boolean not null default true;

create index if not exists idx_ocean_carrier_active on public.ocean_carrier (tenant_id, active);
create index if not exists idx_ocean_port_active on public.ocean_port (tenant_id, active);
create index if not exists idx_ocean_vessel_active on public.ocean_vessel (tenant_id, active);
