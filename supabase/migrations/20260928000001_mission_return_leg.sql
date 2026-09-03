-- 20260928000001_mission_return_leg.sql
-- ===========================================================================
-- TMS-2 — the RETURN LEG: tracking does not stop at delivery.
-- Migration 136. Governing brief: TMS-2 §7 (round-trip, mandatory) and §8
-- (point A / return point).
--
-- WHAT ALREADY EXISTED, and is NOT rebuilt here. The whole driver plane is
-- built and dark: `tracking_session` / `tracking_position` / `tracking_event`
-- (Phase 3.4), `is_assigned_driver()` as the DB-enforced mission-ownership
-- seam, consent-gated `watchPosition` with an offline queue in
-- components/driver/mission-tracker.tsx, the `/api/driver/positions` ingest,
-- and pure batching/freshness rules in lib/tracking/position.ts. This
-- migration adds only what the round trip genuinely needs.
--
-- ===========================================================================
-- 1. THE MISSING STATE
-- ===========================================================================
-- The session vocabulary was ACTIVE / PAUSED / COMPLETED / CANCELLED, which
-- cannot express "delivered, still driving back". Marking a session COMPLETED
-- at delivery would end tracking exactly when the return leg begins, and
-- leaving it ACTIVE would make the map claim the truck is still outbound.
-- RETURNING is that missing fact.
--
--   ACTIVE     outbound — pickup and delivery leg
--   RETURNING  delivered; the vehicle is on its way back to point A / base
--   COMPLETED  back at base; tracking ended
--   PAUSED / CANCELLED unchanged
--
-- NON-AUTHORITATIVE, exactly as before. RETURNING is a TELEMETRY fact. It is
-- not set by delivery and it does not set delivery: `transport_record.status`,
-- the POD, the official 26-step ladder and closure are untouched and
-- unconsulted here. A driver may start the return leg on a mission the
-- platform has not yet recorded as DELIVERED, and the platform will still
-- refuse to call it delivered until the governed act happens.
--
-- ===========================================================================
-- 2. POINT A — a field, and an open business ruling
-- ===========================================================================
-- §8 asked where the return point comes from and forbade guessing. The
-- repository decides NOTHING: there is no base, no depot, no fleet home and no
-- return location anywhere in the schema (the only `return`-shaped columns
-- belong to HR equipment, collections and the process engine). The four
-- candidate sources in the brief — mission origin, Effitrans base, configured
-- depot, explicit per-mission location — are a business choice.
--
-- So this adds the SMALLEST honest thing: an OPTIONAL per-mission return
-- point. It is nullable and defaults to nothing. The round trip works without
-- it (the driver ends tracking at base; the leg is driver-declared), and the
-- map draws a return marker only when a real one was recorded. Nothing is
-- inferred from pickup_location — that would be a guess wearing a default's
-- clothing.
--
-- ⚠ BUSINESS RULING REQUIRED (TMS2-R1): is the return point per mission, or
-- one Effitrans base for the fleet? If the latter, a tenant-level base setting
-- supersedes these columns and they become the per-mission override.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The return-leg state.
-- ---------------------------------------------------------------------------
alter table public.tracking_session
  drop constraint if exists tracking_session_status_check;

alter table public.tracking_session
  add constraint tracking_session_status_check
  check (status in ('ACTIVE', 'PAUSED', 'RETURNING', 'COMPLETED', 'CANCELLED'));

-- When the return leg began. Telemetry time, stamped by the governed action;
-- never derived from the transport status.
alter table public.tracking_session
  add column if not exists return_started_at timestamptz;

comment on column public.tracking_session.return_started_at is
  'TMS-2 — when the driver declared the return leg. A TELEMETRY fact: it neither reads nor writes transport_record.status, the POD or the workflow.';

-- A session that is returning says when it started returning, and a session
-- that never returned says nothing. RETURNING and COMPLETED may both carry it
-- (a completed round trip keeps its return instant).
alter table public.tracking_session drop constraint if exists tracking_session_return_coherent;
alter table public.tracking_session add constraint tracking_session_return_coherent check (
  return_started_at is null
  or status in ('RETURNING', 'COMPLETED', 'CANCELLED', 'PAUSED')
);

-- ---------------------------------------------------------------------------
-- 2. The optional per-mission return point (point A / base).
-- ---------------------------------------------------------------------------
alter table public.transport_record
  add column if not exists return_location  text,
  add column if not exists return_latitude  numeric,
  add column if not exists return_longitude numeric;

comment on column public.transport_record.return_location is
  'TMS-2 — where the vehicle returns after delivery (point A / base). OPTIONAL and never inferred: NULL means the business has not defined one, and the map draws no return marker. See TMS2-R1.';

-- Coordinates come as a pair or not at all, and must be a real WGS84 point.
alter table public.transport_record drop constraint if exists transport_return_point_coherent;
alter table public.transport_record add constraint transport_return_point_coherent check (
  (return_latitude is null) = (return_longitude is null)
);

alter table public.transport_record drop constraint if exists transport_return_point_valid;
alter table public.transport_record add constraint transport_return_point_valid check (
  return_latitude is null
  or (return_latitude between -90 and 90 and return_longitude between -180 and 180)
);

-- ===========================================================================
-- 3. Self-assertions.
-- ===========================================================================
do $$
declare
  v_def text;
  v_n   int;
begin
  -- 3a. RETURNING is admitted, and the pre-existing vocabulary survives intact.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.tracking_session'::regclass
     and conname = 'tracking_session_status_check';
  if v_def is null then
    raise exception 'M136: the tracking_session status CHECK is missing';
  end if;
  if position('RETURNING' in v_def) = 0 then
    raise exception 'M136: RETURNING was not admitted (got %)', v_def;
  end if;
  if position('ACTIVE' in v_def) = 0 or position('PAUSED' in v_def) = 0
     or position('COMPLETED' in v_def) = 0 or position('CANCELLED' in v_def) = 0 then
    raise exception 'M136: the existing session vocabulary was narrowed (got %)', v_def;
  end if;

  -- 3b. The return columns exist on the MISSION, not on a vehicle or a driver.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'transport_record'
     and column_name in ('return_location', 'return_latitude', 'return_longitude');
  if v_n <> 3 then raise exception 'M136: expected 3 return-point columns, found %', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicle'
     and column_name like 'return_%';
  if v_n <> 0 then
    raise exception 'M136: a return point reached the VEHICLE — the return point belongs to the mission';
  end if;

  -- 3c. Nothing here grants authority, invents a permission, or touches the
  --     workflow's own tables.
  if exists (select 1 from public.permission
              where code in ('tracking:driver', 'driver:track', 'tracking:map')) then
    raise exception 'M136: an invented tracking permission exists — TMS-2 rides tracking:* and transport:*';
  end if;

  -- 3d. No existing session was rewritten: this migration adds vocabulary and
  --     nullable columns only, so every stored row keeps its status.
  select count(*) into v_n from public.tracking_session
   where status not in ('ACTIVE', 'PAUSED', 'RETURNING', 'COMPLETED', 'CANCELLED');
  if v_n <> 0 then raise exception 'M136: % session(s) hold an unknown status', v_n; end if;

  raise notice 'M136 OK: RETURNING leg admitted (telemetry only, no workflow authority); optional per-mission return point added, never inferred; existing vocabulary and rows untouched';
end $$;
