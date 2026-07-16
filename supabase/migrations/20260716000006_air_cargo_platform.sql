-- 20260716000006_air_cargo_platform.sql
-- Effitrans Operations Platform — PHASE 7.3A: Air Cargo Platform foundation (sibling of
-- Ocean Shipping). REUSE the shipment root (air shipment = shipment with transport_mode
-- 'AIR'); ADD air-specific relational tables + a dedicated append-only air event store.
--
-- SCOPE GUARD: internal foundation only. NO live airline API, NO IATA, NO FlightRadar/ADS-B,
-- NO OCR/AI/notifications/billing. No new permission (RLS reuses transport:read; writes are
-- service-role + permission-gated). No invented airports/airlines/coordinates seeded. The
-- canonical air_milestone is DISTINCT from the operational/ocean/customs states.

-- ===========================================================================
-- 1. Shipment extension — air-level state (additive, forward-only).
-- ===========================================================================
alter table public.shipment
  add column if not exists air_milestone text not null default 'BOOKED'
    check (air_milestone in ('BOOKED','ACCEPTED','SECURITY','READY_FOR_FLIGHT','LOADED','DEPARTED',
      'ARRIVED','TRANSFER','CUSTOMS','RELEASED','DELIVERED','EXCEPTION','CANCELLED')),
  add column if not exists air_provider_code text not null default 'manual'
    check (air_provider_code in ('manual','airline')),
  add column if not exists airline_id uuid,
  add column if not exists air_tracking_version integer not null default 0;

create index if not exists idx_shipment_air_milestone on public.shipment (tenant_id, air_milestone);

-- ===========================================================================
-- 2. Reference tables (tenant-scoped; UNSEEDED — no invented airports/airlines).
-- ===========================================================================
create table public.air_airline (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  name text not null,
  iata text,          -- 2-char (validated at the service layer)
  icao text,          -- 3-char
  website text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_air_airline_tenant on public.air_airline (tenant_id, active);

create table public.air_airport (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  iata text,          -- 3-char
  icao text,          -- 4-char
  name text not null,
  city text,
  country text,
  latitude double precision,   -- UNSEEDED — no invented coordinates
  longitude double precision,
  timezone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_air_airport_iata on public.air_airport (tenant_id, iata) where iata is not null;
create index idx_air_airport_tenant on public.air_airport (tenant_id, active);

alter table public.shipment
  add constraint shipment_airline_fk foreign key (airline_id) references public.air_airline (id);

create table public.air_flight (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  flight_number text,
  airline_id uuid references public.air_airline (id),
  origin_airport_id uuid references public.air_airport (id),
  destination_airport_id uuid references public.air_airport (id),
  scheduled_departure timestamptz,
  scheduled_arrival timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','DEPARTED','ARRIVED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_air_flight_tenant on public.air_flight (tenant_id, status);

create table public.air_flight_leg (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  flight_id uuid not null references public.air_flight (id) on delete cascade,
  sequence integer not null,
  origin_airport_id uuid references public.air_airport (id),
  destination_airport_id uuid references public.air_airport (id),
  connection_airport_id uuid references public.air_airport (id),
  std timestamptz, sta timestamptz, atd timestamptz, ata timestamptz,
  status text not null default 'PLANNED' check (status in ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, flight_id, sequence)
);
create index idx_air_flight_leg_flight on public.air_flight_leg (tenant_id, flight_id);

-- ===========================================================================
-- 3. Shipment-linked tables (child of the existing 1:1 shipment).
-- ===========================================================================
create table public.air_awb (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  shipment_id uuid not null references public.shipment (id) on delete cascade,
  flight_id uuid references public.air_flight (id),
  mawb text, hawb text,
  status text not null default 'DRAFT' check (status in ('DRAFT','ISSUED','CONFIRMED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, shipment_id)
);
create index idx_air_awb_shipment on public.air_awb (tenant_id, shipment_id);

create table public.air_uld (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  shipment_id uuid not null references public.shipment (id) on delete cascade,
  flight_id uuid references public.air_flight (id),
  uld_number text not null,
  uld_type text,
  owner text,
  status text not null default 'BUILT' check (status in ('EMPTY','BUILT','LOADED','IN_TRANSIT','ARRIVED','BROKEN_DOWN','RETURNED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, shipment_id, uld_number)
);
create index idx_air_uld_shipment on public.air_uld (tenant_id, shipment_id);

create table public.air_cargo_piece (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  shipment_id uuid not null references public.shipment (id) on delete cascade,
  uld_id uuid references public.air_uld (id) on delete set null,
  piece_count integer not null default 1,
  weight_kg numeric,
  volume_m3 numeric,
  dimensions text,
  special_handling text,
  dangerous_goods boolean not null default false,
  temperature_controlled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_air_cargo_piece_shipment on public.air_cargo_piece (tenant_id, shipment_id);

create table public.air_tracking_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organization (id),
  shipment_id uuid not null references public.shipment (id) on delete cascade,
  uld_id uuid references public.air_uld (id) on delete set null,
  event_type text not null
    check (event_type in ('BOOKED','ACCEPTED','SECURITY','READY_FOR_FLIGHT','LOADED','DEPARTED','ARRIVED',
      'TRANSFER','CUSTOMS','RELEASED','DELIVERED','EXCEPTION','CANCELLED','POSITION_UPDATE','ETA_UPDATE')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('CARRIER','AIS','PORT','TERMINAL','CUSTOMS','ROAD','MANUAL','SYSTEM')),
  provider_code text not null default 'manual',
  confidence text not null check (confidence in ('CONFIRMED','INFERRED','MANUAL','ESTIMATED')),
  location_name text,
  location_iata text,
  latitude double precision,
  longitude double precision,
  flight_number text,
  description text,
  fingerprint text not null,
  provider_event_id text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, shipment_id, fingerprint)
);
create index idx_air_event_shipment_time on public.air_tracking_event (tenant_id, shipment_id, occurred_at desc);
create index idx_air_event_uld on public.air_tracking_event (tenant_id, uld_id);
create index idx_air_event_type on public.air_tracking_event (tenant_id, event_type);

create trigger trg_air_event_no_update before update on public.air_tracking_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 4. updated_at triggers + tenant-integrity for shipment-linked children.
-- ===========================================================================
create trigger trg_air_airline_updated_at before update on public.air_airline for each row execute function public.set_updated_at();
create trigger trg_air_airport_updated_at before update on public.air_airport for each row execute function public.set_updated_at();
create trigger trg_air_flight_updated_at before update on public.air_flight for each row execute function public.set_updated_at();
create trigger trg_air_flight_leg_updated_at before update on public.air_flight_leg for each row execute function public.set_updated_at();
create trigger trg_air_awb_updated_at before update on public.air_awb for each row execute function public.set_updated_at();
create trigger trg_air_uld_updated_at before update on public.air_uld for each row execute function public.set_updated_at();
create trigger trg_air_cargo_piece_updated_at before update on public.air_cargo_piece for each row execute function public.set_updated_at();

-- Reuse the ocean tenant-integrity function (checks new.tenant_id = shipment.tenant_id).
create trigger trg_air_awb_tenant before insert or update on public.air_awb for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_air_uld_tenant before insert or update on public.air_uld for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_air_cargo_piece_tenant before insert or update on public.air_cargo_piece for each row execute function public.enforce_ocean_shipment_tenant();
create trigger trg_air_event_tenant before insert on public.air_tracking_event for each row execute function public.enforce_ocean_shipment_tenant();

-- ===========================================================================
-- 5. RLS — read: tenant + transport:read (no new permission). Writes service-role only.
-- ===========================================================================
alter table public.air_airline        enable row level security;
alter table public.air_airport        enable row level security;
alter table public.air_flight         enable row level security;
alter table public.air_flight_leg     enable row level security;
alter table public.air_awb            enable row level security;
alter table public.air_uld            enable row level security;
alter table public.air_cargo_piece    enable row level security;
alter table public.air_tracking_event enable row level security;

create policy air_airline_select on public.air_airline for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_airport_select on public.air_airport for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_flight_select on public.air_flight for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_flight_leg_select on public.air_flight_leg for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_awb_select on public.air_awb for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_uld_select on public.air_uld for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_cargo_piece_select on public.air_cargo_piece for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));
create policy air_tracking_event_select on public.air_tracking_event for select to authenticated using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

grant select on public.air_airline, public.air_airport, public.air_flight, public.air_flight_leg,
  public.air_awb, public.air_uld, public.air_cargo_piece, public.air_tracking_event to authenticated;
