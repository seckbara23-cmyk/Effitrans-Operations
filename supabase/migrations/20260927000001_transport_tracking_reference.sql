-- 20260927000001_transport_tracking_reference.sql
-- ===========================================================================
-- TMS-1C — the external live-tracking reference for a transport mission.
-- Migration 135. Governing audit: docs/transport/tms-1-preimplementation-audit.md
-- §9–§11 (Option A, external link), APPROVED.
--
-- EFFITRANS OPERATIONS IS THE SYSTEM OF RECORD; the existing provider platform
-- stays the live telemetry authority. This table stores WHERE to look, never
-- what was seen. It holds no coordinates, no credentials, no tokens of our own.
--
-- ===========================================================================
-- WHY A SEPARATE TABLE AND NOT THE TWO OBVIOUS OWNERS
-- ===========================================================================
-- The choice was made from the RLS surface, not convenience:
--
--   * `transport_record` — the mission object, and the tempting home. It
--     carries `transport_record_portal_select`: THE CUSTOMER PORTAL CAN READ
--     ITS ROWS. A provider tracking URL there would be reachable by clients,
--     which the brief forbids outright ("no customer access in v1", "no public
--     tracking link exposure on customer portal"). Refused on that ground
--     alone.
--
--   * `tracking_session` — mission-scoped (transport_id) and the right owner
--     of FUTURE telemetry. But it carries `tracking_session_driver_select`
--     (`driver_id = auth.uid()`, no capability required), so the tracked
--     driver would read the provider link — and a fleet-wide provider view
--     would show them every other vehicle. Sessions are also the plane that
--     owns POSITIONS; a pointer to someone else's map is not a position.
--
-- So: sessions record what WE observed, this table records where the PROVIDER
-- shows it. Different facts, no duplicate source of truth, and when the
-- provider API arrives (Phase 2) positions land in tracking_position against a
-- tracking_session for the same transport_id while this row keeps being the
-- pointer. The design is a strict prefix, not a detour.
--
-- ONE REFERENCE PER MISSION (unique transport_id). Tracking belongs to the
-- MISSION: the same vehicle runs many missions and drivers change, so the
-- reference is keyed to neither. Edit history lives in audit_log, which is
-- where this platform keeps before/after for governed edits.
--
-- NO `status` COLUMN, DELIBERATELY. The brief allows NOT_CONFIGURED /
-- AVAILABLE / ACTIVE / ENDED. Without a provider API this platform cannot know
-- whether a session is ACTIVE — claiming it would fabricate knowledge. State is
-- DERIVED: no row => NOT_CONFIGURED, row with ended_at null => AVAILABLE,
-- ended_at set => ENDED. Phase 2 may add ACTIVE when something can actually
-- observe it.
--
-- NOT AUTHORITATIVE FOR WORKFLOW. Nothing here is read by the step engine, the
-- pickup gate, the transport state machine or the closure guard. Tracking
-- ended is not delivered; a verified POD remains the only proof of delivery.
-- ===========================================================================

create table if not exists public.transport_tracking_reference (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  -- THE MISSION. Unique: one live-tracking reference per transport mission.
  transport_id       uuid not null unique references public.transport_record (id) on delete cascade,
  -- Carried so RLS can reuse the existing can_read_file() visibility rule
  -- without a join; the guard trigger keeps it equal to the mission's dossier.
  file_id            uuid not null references public.operational_file (id),

  -- PROVIDER-NEUTRAL. No vendor is named in any column name or constraint.
  provider           text not null check (length(btrim(provider)) > 0),
  external_reference text,
  -- https only: the link may carry signed parameters, and a cleartext scheme
  -- would leak them. Re-validated in the server action; this is the backstop.
  tracking_url       text not null check (tracking_url ~ '^https://[^ ]+$'),

  attached_by        uuid not null references public.app_user (id),
  attached_at        timestamptz not null default now(),
  updated_by         uuid references public.app_user (id),
  updated_at         timestamptz,
  ended_by           uuid references public.app_user (id),
  ended_at           timestamptz,
  end_reason         text,

  -- An ended reference says who ended it and when; neither half alone.
  constraint tracking_reference_end_is_complete
    check ((ended_at is null) = (ended_by is null))
);

create index if not exists idx_transport_tracking_reference_file
  on public.transport_tracking_reference (tenant_id, file_id);

-- ---------------------------------------------------------------------------
-- Tenant + dossier integrity: the reference must point at a mission of its own
-- tenant, and carry that mission's dossier. A FK cannot express either.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_tracking_reference_mission()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
  v_file   uuid;
begin
  select tenant_id, file_id into v_tenant, v_file
    from public.transport_record where id = new.transport_id;
  if v_tenant is null then
    raise exception 'tracking reference points at an unknown mission';
  end if;
  if v_tenant <> new.tenant_id then
    raise exception 'tracking reference tenant mismatch';
  end if;
  if v_file is distinct from new.file_id then
    raise exception 'tracking reference dossier mismatch';
  end if;
  return new;
end $$;

drop trigger if exists trg_tracking_reference_mission on public.transport_tracking_reference;
create trigger trg_tracking_reference_mission
  before insert or update on public.transport_tracking_reference
  for each row execute function public.enforce_tracking_reference_mission();

-- ---------------------------------------------------------------------------
-- RLS — internal staff only.
--
-- `transport:read` and NOT `tracking:read`: the latter is held by DRIVER (the
-- tracked party), and a provider link can expose a whole fleet. Same gate as
-- the mission panel this renders inside. NO portal policy and NO driver policy
-- exist here, and their absence is the control the brief asks for.
--
-- No write policy: the governed actions are the boundary (the HR-A2 /
-- fleet-registry idiom used throughout this platform).
-- ---------------------------------------------------------------------------
alter table public.transport_tracking_reference enable row level security;

drop policy if exists transport_tracking_reference_select on public.transport_tracking_reference;
create policy transport_tracking_reference_select on public.transport_tracking_reference
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('transport:read')
    and public.can_read_file(file_id)
  );

grant select on public.transport_tracking_reference to authenticated;

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare
  v_n    int;
  v_qual text;
begin
  -- 1. Exactly one policy, and it is a SELECT: no write policy may appear.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'transport_tracking_reference';
  if v_n <> 1 then
    raise exception 'M135: expected exactly 1 policy on transport_tracking_reference, found %', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'transport_tracking_reference'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if v_n <> 0 then
    raise exception 'M135: the reference table must have NO write policy — the actions are the boundary, found %', v_n;
  end if;

  -- 2. The read gate is transport:read, tenant-scoped and dossier-scoped, and
  --    carries NEITHER a portal nor a driver clause.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'transport_tracking_reference'
     and policyname = 'transport_tracking_reference_select';
  if v_qual not like '%transport:read%' then
    raise exception 'M135: the read policy does not require transport:read (got %)', v_qual;
  end if;
  if v_qual not like '%auth_tenant_id%' or v_qual not like '%can_read_file%' then
    raise exception 'M135: the read policy lost its tenant/dossier scoping (got %)', v_qual;
  end if;
  if v_qual like '%portal_can_read_file%' or v_qual like '%is_assigned_driver%' or v_qual like '%driver_id%' then
    raise exception 'M135: a customer/driver clause reached the tracking reference policy (got %)', v_qual;
  end if;

  -- 3. One reference per mission, and the mission guard is installed.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transport_tracking_reference'::regclass
       and contype = 'u') then
    raise exception 'M135: transport_id must be UNIQUE — tracking belongs to ONE mission';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_tracking_reference_mission' and not tgisinternal) then
    raise exception 'M135: the tenant/dossier guard trigger is missing';
  end if;

  -- 4. No credential-shaped column was invented here.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'transport_tracking_reference'
     and (column_name like '%secret%' or column_name like '%token%'
       or column_name like '%api_key%' or column_name like '%password%'
       or column_name like '%credential%');
  if v_n <> 0 then
    raise exception 'M135: % credential-shaped column(s) — secrets never live in operational tables', v_n;
  end if;

  -- 5. No new permission was invented: TMS-1C rides the ratified transport
  --    authorities (view transport:read, manage transport:assign).
  if exists (select 1 from public.permission
              where code in ('tracking:attach', 'transport:tracking', 'tracking:link')) then
    raise exception 'M135: an invented tracking permission exists — TMS-1C uses transport:read/assign';
  end if;

  raise notice 'M135 OK: mission-scoped external tracking reference; staff-only read (transport:read), no portal/driver clause, no write policy, no secrets, provider-neutral';
end $$;
