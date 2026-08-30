-- 20260924000001_vehicle_retirement.sql
-- Effitrans Operations Platform — TMS-1A: vehicle retirement hardening.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 132. Governing audit:
-- docs/transport/tms-1-preimplementation-audit.md (62c0abf) §4.
--
-- THE LIFECYCLE ALREADY EXISTED — this migration FINISHES it. `is_active`
-- (migration 117) is the retirement flag; `trg_transport_vehicle` already
-- refuses dispatching a retired vehicle. What was missing, and lands here:
--
--   1. WHY, WHO, WHEN. A retirement without a reason is indistinguishable from
--      a mistake. Three nullable columns; the WHEN is stamped by the DATABASE,
--      because an application clock has no business dating a governed act.
--   2. THE MID-MISSION HOLE. `setVehicleActive(false)` would happily retire a
--      truck that is on the road right now: the dispatch interlock guards NEW
--      bindings only. Now the flip itself is refused while a live mission
--      holds the vehicle.
--   3. THE RACE. Retire and bind could interleave: the bind trigger read the
--      vehicle without any lock, so a retirement committing concurrently was
--      invisible to it (and vice versa). The bind-side read becomes FOR SHARE,
--      which orders the two transactions against the vehicle row — whichever
--      commits second now SEES the other.
--
-- WHAT « MISSION EN COURS » MEANS — not redefined here. The repository already
-- answers it: lib/fleet/service.ts ENGAGED_TRANSPORT_STATUSES = PLANNED,
-- DRIVER_ASSIGNED, PICKED_UP, IN_TRANSIT (deleted_at null). The same four
-- statuses, verbatim; a vitest pins the two lists to each other so they cannot
-- drift apart. NOT_STARTED holds no vehicle in practice, and a DELIVERED /
-- POD_RECEIVED / CANCELLED mission has released the truck.
--
-- NO new permission (retirement is transport:manage — ratified TMS-1A), no new
-- table, no event type: vehicle master data audits through audit_log
-- (vehicle.retired / vehicle.reactivated, added app-side).

-- ===========================================================================
-- 1. The retirement record on the vehicle itself — so the parc can SAY
--    « Retiré le … — motif » without an audit_log read the parc's own users
--    are not authorized to make (audit:read:all).
-- ===========================================================================
alter table public.vehicle
  add column if not exists retired_at     timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_by     uuid references public.app_user (id);

comment on column public.vehicle.retired_at is
  'TMS-1A — stamped by the retirement guard trigger with now(): database time, never an application clock.';

-- ---------------------------------------------------------------------------
-- Backfill BEFORE the CHECK: any pre-existing retired row (is_active = false)
-- gets an honest marker rather than a fabricated actor. A NULL retired_by on a
-- legacy row is the truth — inventing a principal would be worse (the
-- RATIFY-OPSSEC2-2A doctrine). Production census 2026-08-30: 4 vehicles, all
-- is_active = true, so this touches nothing there — but a local reset or a
-- future environment must not be able to violate the constraint either.
-- ---------------------------------------------------------------------------
update public.vehicle
   set retired_at     = coalesce(retired_at, now()),
       retired_reason = coalesce(nullif(btrim(coalesce(retired_reason, '')), ''),
                                 'Retrait antérieur à la migration 132 (motif non enregistré)')
 where is_active = false;

-- A retired vehicle carries its reason and instant; an active one carries
-- neither. retired_by is deliberately NOT required by the CHECK: legacy rows
-- have no actor and a fabricated one would be a lie — the trigger requires it
-- for every NEW retirement instead.
alter table public.vehicle drop constraint if exists vehicle_retirement_coherent;
alter table public.vehicle add constraint vehicle_retirement_coherent check (
  (is_active and retired_at is null and retired_reason is null and retired_by is null)
  or
  (not is_active and retired_at is not null
                 and length(btrim(coalesce(retired_reason, ''))) > 0)
);

-- ===========================================================================
-- 2. The retirement guard — the flip itself is governed, whatever path takes
--    it. UPDATE-only: INSERT starts active (is_active default true) and the
--    CHECK refuses an inserted-retired row without its metadata.
-- ===========================================================================
create or replace function public.vehicle_retirement_guard()
returns trigger language plpgsql as $$
declare
  v_file text;
begin
  -- RETIRE: active -> inactive.
  if old.is_active and not new.is_active then
    -- A live mission holds this vehicle: refuse. Plain read is sufficient on
    -- this side — the bind trigger's FOR SHARE (below) orders the two
    -- transactions against the vehicle row this UPDATE already locks.
    select f.file_number into v_file
      from public.transport_record tr
      join public.operational_file f on f.id = tr.file_id
     where tr.vehicle_id = new.id
       and tr.deleted_at is null
       and tr.status in ('PLANNED', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')
     limit 1;
    if v_file is not null then
      raise exception 'retrait refusé : le véhicule est affecté à une mission en cours (dossier %)', v_file;
    end if;
    if length(btrim(coalesce(new.retired_reason, ''))) = 0 then
      raise exception 'retrait refusé : un motif est obligatoire';
    end if;
    if new.retired_by is null then
      raise exception 'retrait refusé : l''acteur du retrait doit être identifié';
    end if;
    new.retired_at := now();          -- DATABASE time, always
  end if;

  -- REACTIVATE: inactive -> active. The record moves to the audit trail; the
  -- row returns to a clean active state (the CHECK requires it). Status is
  -- deliberately untouched: a vehicle retired in MAINTENANCE comes back in
  -- MAINTENANCE, and every existing rule (open-immobilization, AVAILABLE-only
  -- binding) keeps governing it — reactivation bypasses nothing.
  if (not old.is_active) and new.is_active then
    new.retired_at     := null;
    new.retired_reason := null;
    new.retired_by     := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vehicle_retirement_guard on public.vehicle;
create trigger trg_vehicle_retirement_guard before update on public.vehicle
  for each row execute function public.vehicle_retirement_guard();

-- ===========================================================================
-- 3. Close the retire/bind race: the bind-side vehicle read takes FOR SHARE.
--    Same function as migration 117 otherwise — behavior unchanged for every
--    already-passing case.
--
--    Why this closes it: the retiring transaction holds the vehicle row's
--    UPDATE lock; FOR SHARE conflicts with it, so a concurrent bind WAITS,
--    then re-reads the committed row (is_active = false) and refuses. In the
--    other order the bind's FOR SHARE blocks the retirement UPDATE until the
--    binding commits, and the guard above then SEES the live mission.
-- ===========================================================================
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
    from public.vehicle where id = new.vehicle_id
    for share;                       -- TMS-1A: orders bind against retire
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

-- (trg_transport_vehicle from migration 117 keeps pointing at this function.)

-- ===========================================================================
-- 4. Self-assertions.
-- ===========================================================================
do $$
declare
  v_n   int;
  v_src text;
begin
  -- 4a. Columns exist; no row violates the coherence rule.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicle'
     and column_name in ('retired_at', 'retired_reason', 'retired_by');
  if v_n <> 3 then raise exception 'M132: expected 3 retirement columns, found %', v_n; end if;

  select count(*) into v_n from public.vehicle
   where (is_active and (retired_at is not null or retired_reason is not null or retired_by is not null))
      or (not is_active and (retired_at is null or length(btrim(coalesce(retired_reason,''))) = 0));
  if v_n <> 0 then raise exception 'M132: % vehicle row(s) violate retirement coherence', v_n; end if;

  -- 4b. Both triggers present.
  select count(*) into v_n from pg_trigger
   where tgname in ('trg_vehicle_retirement_guard', 'trg_transport_vehicle')
     and not tgisinternal;
  if v_n <> 2 then raise exception 'M132: expected the retirement guard and the bind interlock, found %', v_n; end if;

  -- 4c. The bind-side read is now lock-ordered (comments stripped first — the
  --     MAYA-P1.1 prosrc lesson).
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc where proname = 'enforce_transport_vehicle';
  if v_src is null or position('for share' in lower(v_src)) = 0 then
    raise exception 'M132: enforce_transport_vehicle does not take FOR SHARE — the retire/bind race is open';
  end if;

  -- 4d. The guard names the SAME engaged vocabulary the fleet read derives
  --     « En mission » from (ENGAGED_TRANSPORT_STATUSES — pinned to this list
  --     by vitest as well).
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc where proname = 'vehicle_retirement_guard';
  if v_src not like '%''PLANNED'', ''DRIVER_ASSIGNED'', ''PICKED_UP'', ''IN_TRANSIT''%' then
    raise exception 'M132: the retirement guard does not use the engaged-transport vocabulary';
  end if;

  -- 4e. Still no invented fleet permission (the 117 doctrine survives).
  if exists (select 1 from public.permission
              where code in ('fleet:manage', 'fleet:read', 'vehicle:manage', 'vehicle:read', 'vehicle:retire')) then
    raise exception 'M132: an invented fleet/vehicle permission exists — retirement is transport:manage';
  end if;

  raise notice 'M132 OK: retirement metadata + guard + race-closed bind interlock; reason mandatory, database-timed, transport:manage only';
end $$;
