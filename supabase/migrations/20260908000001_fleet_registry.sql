-- 20260908000001_fleet_registry.sql
-- Effitrans Operations Platform — TMS-5: Parc & Flotte (lightweight fleet).
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 117. Governing specification:
-- docs/tms/tms-5-parc-flotte.md (frozen TMS-0 roadmap).
--
-- WHY NEW TABLES (verified at HEAD — no vehicle catalog exists anywhere):
--   * hr_equipment has a VEHICLE type but binds an asset to an EMPLOYEE as
--     personal custody under hr:manage/hr:read. A fleet vehicle is bound to a
--     transport MISSION under transport:*. Reusing it would force Transport to
--     hold HR authority and make HR's offboarding gate answer dispatch
--     questions. Boundary documented; an optional link is DEFERRED.
--   * ocean_vessel / ocean_carrier are the maritime carriage plane — a
--     different concept that must not be reused for a similar French label.
--   * document.file_id is NOT NULL against operational_file: the dossier
--     document store structurally cannot hold a vehicle's insurance.
--   * transport_record.vehicle_plate is per-mission free text and STAYS —
--     it is how an external/hired vehicle is recorded (the TMS-6 boundary).
--   * business_event is dossier-scoped (emit_business_event resolves a
--     file_id), so vehicle master-data changes belong in audit_log.
--
-- WHAT THIS ADDS — and deliberately nothing else: three small tables, one
-- nullable FK on transport_record, tenant triggers, RLS reads on the EXISTING
-- transport:read, and ONE new invariant (a non-available vehicle cannot be
-- bound to a transport). NO new permission, NO new event type, NO new status
-- machine: « Affecté / En mission » is DERIVED from transport_record.
--
-- NOT here: fuel, spare parts, workshop, costing, depreciation, procurement,
-- telematics, route optimization, driver payroll, carrier billing, document
-- file storage, subcontractors (TMS-6).

-- ===========================================================================
-- 1. THE VEHICLE — transport-owned master data.
-- ===========================================================================
create table if not exists public.vehicle (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  registration   text not null,                       -- immatriculation
  internal_code  text,                                -- identifiant interne (parc)
  vehicle_type   text not null default 'CAMION'
                   check (vehicle_type in ('CAMION', 'CAMIONNETTE', 'VOITURE',
                                           'TRACTEUR', 'REMORQUE', 'AUTRE')),
  make           text,
  model          text,
  year           int check (year is null or (year between 1950 and 2100)),
  capacity_kg    numeric check (capacity_kg is null or capacity_kg >= 0),
  capacity_m3    numeric check (capacity_m3 is null or capacity_m3 >= 0),
  odometer_km    numeric check (odometer_km is null or odometer_km >= 0),
  -- Steward-declared availability ONLY. There is deliberately no ASSIGNED /
  -- EN_MISSION value: that fact is DERIVED from transport_record, so the
  -- execution machine stays the single source of truth (no second state
  -- machine, no drift).
  status         text not null default 'AVAILABLE'
                   check (status in ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE')),
  is_active      boolean not null default true,
  notes          text,
  created_by     uuid references public.app_user (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists uq_vehicle_registration
  on public.vehicle (tenant_id, upper(btrim(registration)));
create index if not exists idx_vehicle_tenant_status
  on public.vehicle (tenant_id, status) where is_active;

drop trigger if exists trg_vehicle_updated_at on public.vehicle;
create trigger trg_vehicle_updated_at before update on public.vehicle
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. COMPLIANCE — dates and references only. NOT a second document store:
--    the dossier store cannot hold these (file_id NOT NULL), and duplicating
--    it is refused. Attaching scans is deferred.
-- ===========================================================================
create table if not exists public.vehicle_compliance (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  vehicle_id  uuid not null references public.vehicle (id) on delete cascade,
  type_code   text not null
                check (type_code in ('ASSURANCE', 'VISITE_TECHNIQUE', 'CARTE_GRISE',
                                     'LICENCE_TRANSPORT', 'VIGNETTE', 'AUTRE')),
  reference   text,
  issued_on   date,
  expires_on  date,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vehicle_id, type_code),
  constraint compliance_dates_ordered
    check (issued_on is null or expires_on is null or expires_on >= issued_on)
);
create index if not exists idx_vehicle_compliance_expiry
  on public.vehicle_compliance (tenant_id, expires_on) where expires_on is not null;

drop trigger if exists trg_vehicle_compliance_updated_at on public.vehicle_compliance;
create trigger trg_vehicle_compliance_updated_at before update on public.vehicle_compliance
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. MAINTENANCE — planned/unplanned interventions, immobilization and return
--    to service. Lightweight by construction: no cost, no parts, no workshop.
-- ===========================================================================
create table if not exists public.vehicle_maintenance (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  vehicle_id    uuid not null references public.vehicle (id) on delete cascade,
  kind          text not null check (kind in ('PLANNED', 'UNPLANNED')),
  status        text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  immobilizing  boolean not null default true,
  description   text not null,
  opened_on     date not null default current_date,
  opened_by     uuid references public.app_user (id),
  closed_on     date,
  resolution    text,
  closed_by     uuid references public.app_user (id),
  odometer_km   numeric check (odometer_km is null or odometer_km >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint maintenance_closure_is_complete
    check ((status = 'OPEN' and closed_on is null)
        or (status = 'CLOSED' and closed_on is not null)),
  constraint maintenance_dates_ordered
    check (closed_on is null or closed_on >= opened_on)
);
-- One open IMMOBILIZING intervention per vehicle (the hr_equipment custody
-- idiom: a database invariant, not an application convention).
create unique index if not exists uq_vehicle_single_open_immobilization
  on public.vehicle_maintenance (vehicle_id)
  where status = 'OPEN' and immobilizing;
create index if not exists idx_vehicle_maintenance_vehicle
  on public.vehicle_maintenance (tenant_id, vehicle_id);

drop trigger if exists trg_vehicle_maintenance_updated_at on public.vehicle_maintenance;
create trigger trg_vehicle_maintenance_updated_at before update on public.vehicle_maintenance
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. THE LINK TO EXECUTION — one nullable FK. vehicle_plate is NOT touched:
--    it remains how an external/hired vehicle is recorded (TMS-6 boundary).
-- ===========================================================================
alter table public.transport_record
  add column if not exists vehicle_id uuid references public.vehicle (id);

comment on column public.transport_record.vehicle_id is
  'TMS-5 — the INTERNAL fleet vehicle executing this transport. Nullable: an external/hired vehicle is still recorded through vehicle_plate (free text).';

create index if not exists idx_transport_record_vehicle
  on public.transport_record (tenant_id, vehicle_id) where vehicle_id is not null;

-- ===========================================================================
-- 5. TENANT BOUNDARIES — the FK alone cannot express them (TMS-2 idiom).
-- ===========================================================================
create or replace function public.enforce_vehicle_child_tenant()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.vehicle where id = new.vehicle_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'vehicle child tenant mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vehicle_compliance_tenant on public.vehicle_compliance;
create trigger trg_vehicle_compliance_tenant before insert or update on public.vehicle_compliance
  for each row execute function public.enforce_vehicle_child_tenant();

drop trigger if exists trg_vehicle_maintenance_tenant on public.vehicle_maintenance;
create trigger trg_vehicle_maintenance_tenant before insert or update on public.vehicle_maintenance
  for each row execute function public.enforce_vehicle_child_tenant();

-- THE ONE NEW INVARIANT: a transport may only be bound to a vehicle of its own
-- tenant that is ACTIVE and AVAILABLE. Refused DB-side so no path — action,
-- import or console — can dispatch an immobilized vehicle.
create or replace function public.enforce_transport_vehicle()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
  v_status text;
  v_active boolean;
begin
  if new.vehicle_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id then
    return new;                      -- unchanged binding: never re-litigated
  end if;
  select tenant_id, status, is_active into v_tenant, v_status, v_active
    from public.vehicle where id = new.vehicle_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'transport vehicle tenant mismatch';
  end if;
  if v_active is not true then
    raise exception 'ce véhicule est retiré du parc';
  end if;
  if v_status <> 'AVAILABLE' then
    raise exception 'ce véhicule n''est pas disponible (%)' , v_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transport_vehicle on public.transport_record;
create trigger trg_transport_vehicle before insert or update on public.transport_record
  for each row execute function public.enforce_transport_vehicle();

-- ===========================================================================
-- 6. RLS — reads on the EXISTING transport:read (the ocean_port idiom).
--    Writes have NO policy: they go through permission-gated server actions on
--    the service-role client, like every other transport master-data table.
-- ===========================================================================
alter table public.vehicle             enable row level security;
alter table public.vehicle_compliance  enable row level security;
alter table public.vehicle_maintenance enable row level security;

drop policy if exists vehicle_select on public.vehicle;
create policy vehicle_select on public.vehicle for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

drop policy if exists vehicle_compliance_select on public.vehicle_compliance;
create policy vehicle_compliance_select on public.vehicle_compliance for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

drop policy if exists vehicle_maintenance_select on public.vehicle_maintenance;
create policy vehicle_maintenance_select on public.vehicle_maintenance for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

grant select on public.vehicle             to authenticated;
grant select on public.vehicle_compliance  to authenticated;
grant select on public.vehicle_maintenance to authenticated;

-- ===========================================================================
-- 7. SELF-ASSERTIONS — refuse to report success on a wrong state.
-- ===========================================================================

-- 7a. No new permission was invented: TMS-5 rides transport:manage/assign/read.
do $$
begin
  if exists (select 1 from public.permission
              where code in ('fleet:manage', 'fleet:read', 'vehicle:manage', 'vehicle:read')) then
    raise exception 'TMS-5 assertion 7a failed: an invented fleet permission exists — the ratified transport authorities govern the parc';
  end if;
  if (select count(*) from public.permission where code in ('transport:manage', 'transport:assign', 'transport:read')) <> 3 then
    raise exception 'TMS-5 assertion 7a failed: the governing transport permissions are not all present';
  end if;
end $$;

-- 7b. The status vocabulary carries NO assignment value — « En mission » stays
--     derived from transport_record.
do $$
declare v_src text;
begin
  select pg_get_constraintdef(c.oid) into v_src
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'vehicle' and c.conname like '%status%';
  if v_src is null then
    raise exception 'TMS-5 assertion 7b failed: the vehicle status CHECK is missing';
  end if;
  if v_src like '%ASSIGNED%' or v_src like '%MISSION%' then
    raise exception 'TMS-5 assertion 7b failed: the status vocabulary duplicates execution state (%)', v_src;
  end if;
end $$;

-- 7c. The three tables are RLS-enabled and readable only with transport:read.
do $$
declare v_missing text;
begin
  select string_agg(t.relname, ', ') into v_missing
    from pg_class t join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname in ('vehicle', 'vehicle_compliance', 'vehicle_maintenance')
     and t.relrowsecurity = false;
  if v_missing is not null then
    raise exception 'TMS-5 assertion 7c failed: RLS not enabled on %', v_missing;
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('vehicle', 'vehicle_compliance', 'vehicle_maintenance')
         and qual like '%transport:read%') <> 3 then
    raise exception 'TMS-5 assertion 7c failed: the three read policies must all require transport:read';
  end if;
end $$;

-- 7d. The execution link exists, is nullable, and vehicle_plate SURVIVES
--     (the external/hired representation is not replaced).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name = 'vehicle_id' and is_nullable = 'YES') then
    raise exception 'TMS-5 assertion 7d failed: transport_record.vehicle_id must exist and stay nullable';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name = 'vehicle_plate') then
    raise exception 'TMS-5 assertion 7d failed: vehicle_plate was removed — external vehicles would become unrecordable';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_transport_vehicle'
       and tgrelid = 'public.transport_record'::regclass) then
    raise exception 'TMS-5 assertion 7d failed: the availability interlock trigger is missing';
  end if;
end $$;
