-- 20260716000004_shipping_line_platform.sql
-- Effitrans Operations Platform — PHASE 7.2A: Shipping Line Platform foundation.
--
-- DECISION (docs/shipping/phase-7.2a-architecture-decision.md): Option C (Hybrid). REUSE
-- operational_file + shipment (extend shipment additively for shipment-level ocean state);
-- ADD ocean satellite tables for the genuinely-missing relational domain (carrier, vessel,
-- voyage, port, container, route leg, port call) and a DEDICATED high-volume immutable
-- tracking-event store (NOT the audit log).
--
-- SCOPE GUARD: internal foundation only. NO live carrier API, NO AIS, NO OCR, NO AI. No new
-- permission — RLS reuses transport:read; writes are service-role + permission-gated. No
-- invented carrier codes, port coordinates, or vessel identifiers are seeded. The canonical
-- ocean milestone (shipment.ocean_milestone) is DISTINCT from the operational file/transport
-- status and from customs state; neither is modified.

-- ===========================================================================
-- 1. Shipment extension — shipment-level ocean state (additive, forward-only).
-- ===========================================================================
alter table public.shipment
  add column if not exists ocean_milestone text not null default 'BOOKING_CREATED'
    check (ocean_milestone in ('BOOKING_CREATED','BOOKING_CONFIRMED','EMPTY_RELEASED','GATE_IN','LOADED',
      'VESSEL_DEPARTED','IN_TRANSIT','TRANSSHIPMENT_ARRIVED','TRANSSHIPMENT_DEPARTED','VESSEL_ARRIVED',
      'DISCHARGED','CUSTOMS_PROCESSING','CUSTOMS_RELEASED','AVAILABLE_FOR_PICKUP','GATE_OUT','DELIVERED',
      'EMPTY_RETURNED','COMPLETED','CANCELLED','EXCEPTION')),
  add column if not exists provider_code text not null default 'manual'
    check (provider_code in ('manual','maersk','msc','cma-cgm','hapag-lloyd','cosco','one','evergreen','aggregator')),
  add column if not exists carrier_id uuid,
  add column if not exists booking_reference text,
  add column if not exists booking_status text
    check (booking_status is null or booking_status in ('DRAFT','REQUESTED','CONFIRMED','AMENDED','CANCELLED')),
  add column if not exists master_bl text,
  add column if not exists house_bl text,
  add column if not exists eta_source text
    check (eta_source is null or eta_source in ('CARRIER','PORT','AIS_DERIVED','MANUAL','SYSTEM_ESTIMATE')),
  add column if not exists eta_confidence text
    check (eta_confidence is null or eta_confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  add column if not exists eta_calculated_at timestamptz,
  add column if not exists eta_previous timestamptz,
  add column if not exists tracking_synced_at timestamptz,
  add column if not exists tracking_version integer not null default 0;

create index if not exists idx_shipment_ocean_milestone on public.shipment (tenant_id, ocean_milestone);
create index if not exists idx_shipment_ocean_provider on public.shipment (tenant_id, provider_code);
create index if not exists idx_shipment_ocean_eta on public.shipment (tenant_id, eta_calculated_at);

-- ===========================================================================
-- 2. Reference tables (tenant-scoped; UNSEEDED — no invented codes/coordinates).
-- ===========================================================================
create table public.ocean_carrier (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  code       text not null,
  name       text not null,
  scac       text,                          -- only when verified; never seeded
  website    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.ocean_port (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  unlocode   text,                          -- UN/LOCODE where verified
  name       text not null,
  country    text,
  latitude   double precision,              -- UNSEEDED — no invented coordinates
  longitude  double precision,
  timezone   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_ocean_port_unlocode on public.ocean_port (tenant_id, unlocode) where unlocode is not null;

create table public.ocean_vessel (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  name       text not null,
  imo        text,                          -- validated (ISO/IMO) at the service layer
  mmsi       text,                          -- distinct identifier type from IMO
  flag       text,
  carrier_id uuid references public.ocean_carrier (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ocean_vessel_tenant on public.ocean_vessel (tenant_id);

create table public.ocean_voyage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  carrier_voyage_ref text,
  vessel_id          uuid references public.ocean_vessel (id),
  origin_port_id     uuid references public.ocean_port (id),
  destination_port_id uuid references public.ocean_port (id),
  planned_departure  timestamptz,
  actual_departure   timestamptz,
  planned_arrival    timestamptz,
  actual_arrival     timestamptz,
  status             text not null default 'PLANNED' check (status in ('PLANNED','DEPARTED','ARRIVED','CANCELLED')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_ocean_voyage_tenant on public.ocean_voyage (tenant_id);

-- Now that ocean_carrier exists, point shipment.carrier_id at it (deferred FK).
alter table public.shipment
  add constraint shipment_carrier_fk foreign key (carrier_id) references public.ocean_carrier (id);

-- ===========================================================================
-- 3. Shipment-linked tables (child of the existing 1:1 shipment).
-- ===========================================================================
create table public.ocean_container (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  shipment_id      uuid not null references public.shipment (id) on delete cascade,
  container_number text not null,           -- ISO 6346 (validated at the service layer)
  iso_type         text,
  seal_number      text,
  gross_weight_kg  numeric,
  status           text not null default 'EMPTY'
                     check (status in ('EMPTY','GATE_IN','LOADED','ON_VESSEL','DISCHARGED','AVAILABLE','GATED_OUT','RETURNED')),
  vessel_id        uuid references public.ocean_vessel (id),
  voyage_id        uuid references public.ocean_voyage (id),
  last_event_at    timestamptz,
  position_confidence text check (position_confidence is null or position_confidence in ('CONFIRMED','INFERRED','MANUAL','ESTIMATED')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, shipment_id, container_number)
);
create index idx_ocean_container_shipment on public.ocean_container (tenant_id, shipment_id);

create table public.ocean_route_leg (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  shipment_id        uuid not null references public.shipment (id) on delete cascade,
  sequence           integer not null,
  origin_port_id     uuid references public.ocean_port (id),
  destination_port_id uuid references public.ocean_port (id),
  mode               text not null default 'SEA' check (mode in ('SEA','ROAD','RAIL','TRANSSHIPMENT')),
  vessel_id          uuid references public.ocean_vessel (id),
  voyage_id          uuid references public.ocean_voyage (id),
  planned_departure  timestamptz,
  actual_departure   timestamptz,
  planned_arrival    timestamptz,
  actual_arrival     timestamptz,
  status             text not null default 'PLANNED' check (status in ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
  source             text not null default 'MANUAL' check (source in ('CARRIER','AIS','PORT','TERMINAL','CUSTOMS','ROAD','MANUAL','SYSTEM')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, shipment_id, sequence)
);
create index idx_ocean_route_leg_shipment on public.ocean_route_leg (tenant_id, shipment_id);

create table public.ocean_port_call (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  shipment_id uuid not null references public.shipment (id) on delete cascade,
  voyage_id   uuid references public.ocean_voyage (id),
  port_id     uuid references public.ocean_port (id),
  arrival     timestamptz,
  berth       text,
  departure   timestamptz,
  terminal    text,
  source      text not null default 'MANUAL' check (source in ('CARRIER','AIS','PORT','TERMINAL','CUSTOMS','ROAD','MANUAL','SYSTEM')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_ocean_port_call_shipment on public.ocean_port_call (tenant_id, shipment_id);

-- ===========================================================================
-- 4. Immutable, high-volume tracking-event store (NOT the audit log).
-- ===========================================================================
create table public.ocean_tracking_event (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  shipment_id      uuid not null references public.shipment (id) on delete cascade,
  container_id     uuid references public.ocean_container (id) on delete set null,
  event_type       text not null
                     check (event_type in ('BOOKING_CREATED','BOOKING_CONFIRMED','EMPTY_RELEASED','GATE_IN','LOADED',
                       'VESSEL_DEPARTED','IN_TRANSIT','TRANSSHIPMENT_ARRIVED','TRANSSHIPMENT_DEPARTED','VESSEL_ARRIVED',
                       'DISCHARGED','CUSTOMS_PROCESSING','CUSTOMS_RELEASED','AVAILABLE_FOR_PICKUP','GATE_OUT','DELIVERED',
                       'EMPTY_RETURNED','COMPLETED','CANCELLED','EXCEPTION','POSITION_UPDATE','ETA_UPDATE')),
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  source           text not null check (source in ('CARRIER','AIS','PORT','TERMINAL','CUSTOMS','ROAD','MANUAL','SYSTEM')),
  provider_code    text not null default 'manual',
  confidence       text not null check (confidence in ('CONFIRMED','INFERRED','MANUAL','ESTIMATED')),
  location_name    text,
  location_unlocode text,
  latitude         double precision,
  longitude        double precision,
  vessel_imo       text,
  vessel_mmsi      text,
  vessel_name      text,
  voyage_reference text,
  description      text,
  fingerprint      text not null,           -- deterministic dedup key
  provider_event_id text,                    -- carrier's own id where available
  created_by       uuid references public.app_user (id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, shipment_id, fingerprint)   -- dedup: the same event stored once
);
create index idx_ocean_event_shipment_time on public.ocean_tracking_event (tenant_id, shipment_id, occurred_at desc);
create index idx_ocean_event_container on public.ocean_tracking_event (tenant_id, container_id);
create index idx_ocean_event_type on public.ocean_tracking_event (tenant_id, event_type);
create index idx_ocean_event_provider_id on public.ocean_tracking_event (provider_event_id) where provider_event_id is not null;

-- Append-only: block UPDATE (reuses the platform's prevent_mutation trigger fn).
create trigger trg_ocean_event_no_update before update on public.ocean_tracking_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 5. updated_at triggers + tenant-integrity (shipment-linked children must match
--    their shipment's tenant — mirrors the shipment/customs tenant guards).
-- ===========================================================================
create trigger trg_ocean_carrier_updated_at before update on public.ocean_carrier for each row execute function public.set_updated_at();
create trigger trg_ocean_port_updated_at before update on public.ocean_port for each row execute function public.set_updated_at();
create trigger trg_ocean_vessel_updated_at before update on public.ocean_vessel for each row execute function public.set_updated_at();
create trigger trg_ocean_voyage_updated_at before update on public.ocean_voyage for each row execute function public.set_updated_at();
create trigger trg_ocean_container_updated_at before update on public.ocean_container for each row execute function public.set_updated_at();
create trigger trg_ocean_route_leg_updated_at before update on public.ocean_route_leg for each row execute function public.set_updated_at();
create trigger trg_ocean_port_call_updated_at before update on public.ocean_port_call for each row execute function public.set_updated_at();

create or replace function public.enforce_ocean_shipment_tenant()
returns trigger language plpgsql as $$
declare
  s_tenant uuid;
begin
  select tenant_id into s_tenant from public.shipment where id = new.shipment_id;
  if new.tenant_id is distinct from s_tenant then
    raise exception 'ocean tenant mismatch (shipment_tenant=%, given=%)', s_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_ocean_container_tenant before insert or update on public.ocean_container for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_ocean_route_leg_tenant before insert or update on public.ocean_route_leg for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_ocean_port_call_tenant before insert or update on public.ocean_port_call for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_ocean_event_tenant before insert on public.ocean_tracking_event for each row execute function public.enforce_ocean_shipment_tenant();

-- ===========================================================================
-- 6. RLS — read: tenant + transport:read (ocean shipping is a transport concern; no new
--    permission). Writes go through the service-role admin client in server actions
--    (deny-by-default for authenticated). Grant SELECT only.
-- ===========================================================================
alter table public.ocean_carrier        enable row level security;
alter table public.ocean_port           enable row level security;
alter table public.ocean_vessel         enable row level security;
alter table public.ocean_voyage         enable row level security;
alter table public.ocean_container      enable row level security;
alter table public.ocean_route_leg      enable row level security;
alter table public.ocean_port_call      enable row level security;
alter table public.ocean_tracking_event enable row level security;

create policy ocean_carrier_select on public.ocean_carrier for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_port_select on public.ocean_port for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_vessel_select on public.ocean_vessel for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_voyage_select on public.ocean_voyage for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_container_select on public.ocean_container for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_route_leg_select on public.ocean_route_leg for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_port_call_select on public.ocean_port_call for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy ocean_tracking_event_select on public.ocean_tracking_event for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

grant select on public.ocean_carrier, public.ocean_port, public.ocean_vessel, public.ocean_voyage,
  public.ocean_container, public.ocean_route_leg, public.ocean_port_call, public.ocean_tracking_event
  to authenticated;
