-- 20260907000001_shipment_geography.sql
-- Effitrans Operations Platform — TMS-2: the shipment ↔ geography foundation.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 116. Governing specification:
-- docs/tms/tms-2-geography-contract.md (frozen TMS-0 roadmap, ratified Q8).
--
-- THE STRUCTURAL BREAK THIS CLOSES: shipment.origin/destination are free text
-- with no reference to ocean_port / air_airport — even though both reference
-- tables exist with codes, coordinates, RLS, audited CRUD and studio UI.
-- Geography could only attach through later, optional tracking artifacts
-- (route legs, flights), so the spine itself could never identify the
-- geographic endpoints the tracking planes are keyed on.
--
-- WHAT THIS MIGRATION ADDS — and deliberately nothing else:
--   1. FOUR nullable FK columns on shipment (ports for SEA, airports for AIR).
--      The free-text origin/destination stay untouched: they remain the human
--      label and the intake requirement. Nothing becomes mandatory.
--   2. ONE tenant-boundary trigger, the same idiom as enforce_shipment_tenant:
--      a geo reference must belong to the shipment's own tenant.
--
-- NOT here, by ratified scope: no location table (no competing model), no
-- seed rows (UNSEEDED doctrine — no invented coordinates), no backfill (free
-- text cannot be honestly resolved to entities), no permission, no RLS change,
-- no vehicle/fleet/fuel/maintenance/telematics/route-optimization anything.

-- ===========================================================================
-- 1. THE COLUMNS — nullable anchors, label text preserved.
-- ===========================================================================
alter table public.shipment
  add column if not exists origin_port_id         uuid references public.ocean_port (id),
  add column if not exists destination_port_id    uuid references public.ocean_port (id),
  add column if not exists origin_airport_id      uuid references public.air_airport (id),
  add column if not exists destination_airport_id uuid references public.air_airport (id);

comment on column public.shipment.origin_port_id is
  'TMS-2 — geographic anchor (ocean_port) for the origin. Nullable: the free-text origin remains the label; the anchor is linked when tracking needs it.';
comment on column public.shipment.destination_port_id is
  'TMS-2 — geographic anchor (ocean_port) for the destination.';
comment on column public.shipment.origin_airport_id is
  'TMS-2 — geographic anchor (air_airport) for the origin.';
comment on column public.shipment.destination_airport_id is
  'TMS-2 — geographic anchor (air_airport) for the destination.';

create index if not exists idx_shipment_origin_port
  on public.shipment (tenant_id, origin_port_id) where origin_port_id is not null;
create index if not exists idx_shipment_destination_port
  on public.shipment (tenant_id, destination_port_id) where destination_port_id is not null;
create index if not exists idx_shipment_origin_airport
  on public.shipment (tenant_id, origin_airport_id) where origin_airport_id is not null;
create index if not exists idx_shipment_destination_airport
  on public.shipment (tenant_id, destination_airport_id) where destination_airport_id is not null;

-- ===========================================================================
-- 2. THE TENANT BOUNDARY — the FK alone cannot express it.
-- ===========================================================================
create or replace function public.enforce_shipment_geo_tenant()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
begin
  if new.origin_port_id is not null then
    select tenant_id into v_tenant from public.ocean_port where id = new.origin_port_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'shipment geo tenant mismatch (origin_port)';
    end if;
  end if;
  if new.destination_port_id is not null then
    select tenant_id into v_tenant from public.ocean_port where id = new.destination_port_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'shipment geo tenant mismatch (destination_port)';
    end if;
  end if;
  if new.origin_airport_id is not null then
    select tenant_id into v_tenant from public.air_airport where id = new.origin_airport_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'shipment geo tenant mismatch (origin_airport)';
    end if;
  end if;
  if new.destination_airport_id is not null then
    select tenant_id into v_tenant from public.air_airport where id = new.destination_airport_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'shipment geo tenant mismatch (destination_airport)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shipment_geo_tenant on public.shipment;
create trigger trg_shipment_geo_tenant before insert or update on public.shipment
  for each row execute function public.enforce_shipment_geo_tenant();

-- ===========================================================================
-- 3. SELF-ASSERTIONS — refuse to report success on a wrong state.
-- ===========================================================================

-- 3a. The four columns exist, and every one is nullable (nothing became
--     mandatory — a dossier without geography stays fully legal).
do $$
declare v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public' and table_name = 'shipment'
     and column_name in ('origin_port_id', 'destination_port_id',
                         'origin_airport_id', 'destination_airport_id')
     and is_nullable = 'YES';
  if v_count <> 4 then
    raise exception 'TMS-2 assertion 3a failed: expected 4 nullable geo columns, found %', v_count;
  end if;
end $$;

-- 3b. The tenant-boundary trigger is armed.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_shipment_geo_tenant'
       and tgrelid = 'public.shipment'::regclass) then
    raise exception 'TMS-2 assertion 3b failed: trg_shipment_geo_tenant is missing';
  end if;
end $$;

-- 3c. No row violates the boundary (trivially true on fresh columns; also
--     revalidates any re-run).
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from public.shipment s
   where (s.origin_port_id is not null and exists (
            select 1 from public.ocean_port p where p.id = s.origin_port_id and p.tenant_id <> s.tenant_id))
      or (s.destination_port_id is not null and exists (
            select 1 from public.ocean_port p where p.id = s.destination_port_id and p.tenant_id <> s.tenant_id))
      or (s.origin_airport_id is not null and exists (
            select 1 from public.air_airport a where a.id = s.origin_airport_id and a.tenant_id <> s.tenant_id))
      or (s.destination_airport_id is not null and exists (
            select 1 from public.air_airport a where a.id = s.destination_airport_id and a.tenant_id <> s.tenant_id));
  if v_bad > 0 then
    raise exception 'TMS-2 assertion 3c failed: % shipment(s) reference cross-tenant geography', v_bad;
  end if;
end $$;

-- 3d. This migration granted nothing: file:*/transport:* permission counts are
--     whatever migrations 1–115 left them — it created no permission and no
--     policy of its own (structural check: the permission it could have been
--     tempted to invent does not exist).
do $$
begin
  if exists (select 1 from public.permission where code in ('geography:manage', 'port:manage', 'airport:manage')) then
    raise exception 'TMS-2 assertion 3d failed: an invented geography permission exists — Q8 ratified reuse of transport:manage';
  end if;
end $$;
