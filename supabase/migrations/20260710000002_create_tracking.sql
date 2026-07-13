-- 20260710000002_create_tracking.sql
-- Effitrans Operations Platform — PHASE 3.4A/B: Real-time operations tracking foundation.
-- ---------------------------------------------------------------------------
-- Additive, forward-only (DEC-A12). Adds a provider-neutral tracking EVIDENCE
-- layer OVER the existing transport lifecycle — it never replaces it. The
-- operational dossier + transport_record remain the single authoritative source
-- of workflow state (DEC-A02). A tracking position/event is EVIDENCE only: it
-- must never auto-transition a dossier (no DELIVERED-from-geofence, no finance
-- move from GPS). Everything here is DARK BY DEFAULT behind TRACKING_ENABLED
-- (feature flags, lib/tracking/config.ts) — with the flag off nothing reads or
-- writes these tables and the lifecycle portal is unchanged.
--
-- Driver identity: no DRIVER role or driver-user link existed (driver was
-- free-text on transport_record). Phase 3.4 introduces a narrowly-scoped DRIVER
-- role on the EXISTING app_user identity (DEC-B12, one auth system) plus an
-- additive transport_record.driver_user_id FK. RLS scopes a driver to their own
-- assigned transports only (is_assigned_driver, SECURITY DEFINER to avoid
-- recursion into transport_record's own can_read_file policy). Free-text
-- driver_name is kept for non-app drivers (backward compatible).
--
-- Tables (all tenant_id + RLS + tenant-integrity trigger, per docs/s2-security-
-- patterns.md): tracking_session (one tracking period), tracking_position
-- (append-only positions), tracking_event (customer-safe / operational events).
-- APPEND-ONLY is enforced at the application layer (no delete action, no DELETE
-- policy) — NOT a DB delete-block trigger, so the on-delete cascade from a purged
-- dossier still works (positions/events die with their file, like transport_record).
--
-- SCOPE GUARD (3.4A/B): schema + RLS + perms + driver identity + manual ops
-- updates only. NO Supabase Realtime, NO driver mobile UI, NO portal live map,
-- NO external carrier/vessel/flight provider, NO geofence worker, NO retention
-- cron — those arrive in later 3.4 increments, each still dark by default.
-- Decisions: DEC-A02 (dossier authoritative), DEC-A12 (forward-only), DEC-B12
-- (single admin/auth), DEC-B13 (union perms), DEC-C01 (tenant_id + RLS).

-- ===========================================================================
-- 1. Driver identity — DRIVER role (existing auth) + transport link.
-- ===========================================================================
-- BACKFILL, not a seed. role.tenant_id references organization(id), and on a
-- CLEAN database (CI, a fresh environment) `organization` is still empty here:
-- the Effitrans org row is created by supabase/seed.sql, which runs AFTER every
-- migration. A bare `values (...)` insert therefore violated role_tenant_id_fkey
-- and aborted the whole migration replay. Guarded with `where exists`, matching
-- 20260712110000_company_metadata_branding.sql, so it:
--   * no-ops on a clean DB   -> seed.sql supplies DRIVER + its tracking grants,
--   * backfills on a live DB -> the org row exists, so DRIVER is added as before.
-- Same idiom as the role_permission grants below, which already no-op on clean.
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', 'DRIVER', 'Chauffeur', 'Driver', true
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- Additive link from a transport to its driver's app_user (nullable — free-text
-- driver_name stays for non-app drivers). Assignment is set by dispatchers.
alter table public.transport_record
  add column if not exists driver_user_id uuid references public.app_user (id);

create index if not exists idx_transport_driver_user
  on public.transport_record (driver_user_id) where driver_user_id is not null;

-- ===========================================================================
-- 2. Permissions (catalog + role grants, mirrored in seed.sql). tracking:read
--    inherits dossier visibility (can_read_file); tracking:read:all is the
--    tier-1 fleet-wide gate (mirrors file:read:all). Driver scoping is by
--    assignment (is_assigned_driver), not by a tenant-wide permission.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('tracking:read',     'tracking', 'read',   'assigned', 'View transport tracking (sessions, positions, events)'),
  ('tracking:read:all', 'tracking', 'read',   'all',      'View tenant-wide / fleet tracking'),
  ('tracking:write',    'tracking', 'write',  'assigned', 'Record manual updates / driver positions'),
  ('tracking:manage',   'tracking', 'manage', 'all',      'Admin tracking controls (end session, hide position, visibility defaults)')
on conflict (code) do nothing;

-- read: everyone who already reads transport dossiers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'DOCUMENTATION_OFFICER', 'DRIVER')
on conflict do nothing;

-- read:all (fleet map): management + transport supervision.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:read:all'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR')
on conflict do nothing;

-- write (manual updates + driver positions): transport operators + drivers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:write'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER', 'DRIVER')
on conflict do nothing;

-- manage (admin controls): admin + ops supervisor.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- DRIVER baseline: read/update own profile (parity with the seed baseline that
-- other roles get; explicit here because this role is created in a migration
-- that runs against existing databases where the baseline grant already ran).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('profile:read:self', 'profile:update:self')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DRIVER'
on conflict do nothing;

-- ===========================================================================
-- 3. Driver-assignment predicate (SECURITY DEFINER — bypasses transport_record
--    RLS so a driver, who cannot pass can_read_file, can still be recognised as
--    the assigned driver of a transport without recursion). Used by the driver
--    RLS policies on positions/events.
-- ===========================================================================
create or replace function public.is_assigned_driver(p_transport uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.transport_record tr
    where tr.id = p_transport
      and tr.driver_user_id = auth.uid()
      and tr.deleted_at is null
  );
$$;
grant execute on function public.is_assigned_driver(uuid) to authenticated, service_role;

-- Integrity: a tracking row's tenant must match its dossier's tenant (mirrors
-- enforce_transport_tenant). One function for all three tracking tables (each
-- carries file_id).
create or replace function public.enforce_tracking_tenant()
returns trigger language plpgsql as $$
declare f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'tracking tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4. tracking_session — one active tracking period for a transport movement.
-- ===========================================================================
create table public.tracking_session (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  file_id          uuid not null references public.operational_file (id) on delete cascade,
  transport_id     uuid references public.transport_record (id) on delete set null,
  driver_id        uuid references public.app_user (id),          -- the driver (app_user), when driver_mobile
  vehicle_plate    text,                                          -- denormalized free-text (optional)
  source           text not null default 'manual'
                     check (source in ('manual', 'driver_mobile', 'vehicle_gps', 'carrier_api', 'vessel_api', 'flight_api')),
  status           text not null default 'ACTIVE'
                     check (status in ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  last_position_at timestamptz,
  created_by       uuid references public.app_user (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_tracking_session_active on public.tracking_session (tenant_id, status) where status = 'ACTIVE';
create index idx_tracking_session_file on public.tracking_session (file_id);
create index idx_tracking_session_transport on public.tracking_session (transport_id);
create index idx_tracking_session_driver on public.tracking_session (driver_id) where driver_id is not null;

create trigger trg_tracking_session_updated_at before update on public.tracking_session
  for each row execute function public.set_updated_at();
create trigger trg_tracking_session_tenant before insert or update on public.tracking_session
  for each row execute function public.enforce_tracking_tenant();

-- ===========================================================================
-- 5. tracking_position — APPEND-ONLY position records (evidence only). No
--    updated_at (immutable); customer_visible may be toggled by tracking:manage
--    via the service role. tracking_session_id is nullable so a manual last-known
--    position can attach directly to a dossier without an active GPS session.
-- ===========================================================================
create table public.tracking_position (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  tracking_session_id uuid references public.tracking_session (id) on delete cascade,
  file_id             uuid not null references public.operational_file (id) on delete cascade,
  transport_id        uuid references public.transport_record (id) on delete set null,
  latitude            double precision not null,
  longitude           double precision not null,
  accuracy_meters     double precision,
  heading_degrees     double precision,
  speed_kph           double precision,
  source              text not null
                        check (source in ('manual', 'driver_mobile', 'vehicle_gps', 'carrier_api', 'vessel_api', 'flight_api')),
  customer_visible    boolean not null default false,
  recorded_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  recorded_by         uuid references public.app_user (id),      -- staff (manual) or driver; null for provider
  created_at          timestamptz not null default now()
);

-- Latest-position-for-a-file (list views fetch only the newest) + session route.
create index idx_tracking_position_file on public.tracking_position (tenant_id, file_id, recorded_at desc);
create index idx_tracking_position_session on public.tracking_position (tracking_session_id, recorded_at desc);
create index idx_tracking_position_transport on public.tracking_position (transport_id) where transport_id is not null;

create trigger trg_tracking_position_tenant before insert or update on public.tracking_position
  for each row execute function public.enforce_tracking_tenant();

-- ===========================================================================
-- 6. tracking_event — customer-safe or operational tracking events (the
--    internal + customer timelines). Manual ops updates land here labeled
--    source='manual'. dedup_key makes geofence / provider events idempotent.
-- ===========================================================================
create table public.tracking_event (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  tracking_session_id uuid references public.tracking_session (id) on delete set null,
  file_id             uuid not null references public.operational_file (id) on delete cascade,
  transport_id        uuid references public.transport_record (id) on delete set null,
  type                text not null
                        check (type in ('TRACKING_STARTED', 'PICKUP_CONFIRMED', 'DEPARTED', 'CHECKPOINT_REACHED',
                                        'BORDER_REACHED', 'WAREHOUSE_REACHED', 'CUSTOMS_STOP', 'DELAY_REPORTED',
                                        'INCIDENT_REPORTED', 'ARRIVED_NEAR_PICKUP', 'ARRIVED_NEAR_CHECKPOINT',
                                        'ARRIVED_NEAR_DESTINATION', 'DELIVERY_ATTEMPTED', 'DELIVERED', 'TRACKING_STOPPED')),
  source              text not null default 'manual'
                        check (source in ('manual', 'driver_mobile', 'vehicle_gps', 'carrier_api', 'vessel_api', 'flight_api')),
  customer_visible    boolean not null default false,
  customer_message    text,      -- customer-safe explanation (shown in the portal)
  internal_note       text,      -- staff-only detail (NEVER shown to clients)
  latitude            double precision,
  longitude           double precision,
  dedup_key           text,      -- idempotency for geofence / provider events (nullable)
  occurred_at         timestamptz not null default now(),
  created_by          uuid references public.app_user (id),
  created_at          timestamptz not null default now()
);

create index idx_tracking_event_file on public.tracking_event (tenant_id, file_id, occurred_at desc);
create index idx_tracking_event_session on public.tracking_event (tracking_session_id);
-- Idempotent geofence / provider events: at most one per (tenant, dedup_key).
create unique index uq_tracking_event_dedup on public.tracking_event (tenant_id, dedup_key) where dedup_key is not null;

create trigger trg_tracking_event_tenant before insert or update on public.tracking_event
  for each row execute function public.enforce_tracking_tenant();

-- ===========================================================================
-- 7. RLS — reads only (writes via the service-role admin client in server
--    actions, deny-by-default). Three read audiences, OR'd (additive):
--      * staff  : tenant + tracking:read + can_read_file (inherits dossier vis.)
--      * driver : own assigned transport (is_assigned_driver) / own session
--      * portal : own client's CUSTOMER-VISIBLE positions/events only
--    No cross-tenant rows ever (tenant predicate + DEFINER helpers are scoped).
-- ===========================================================================
alter table public.tracking_session enable row level security;
alter table public.tracking_position enable row level security;
alter table public.tracking_event enable row level security;

-- tracking_session — staff + own-driver (no portal: portal reads derived
-- positions/events, not raw sessions).
create policy tracking_session_staff_select on public.tracking_session
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('tracking:read')
    and public.can_read_file(file_id)
  );
create policy tracking_session_driver_select on public.tracking_session
  for select to authenticated
  using (driver_id = auth.uid());

-- tracking_position — staff + assigned-driver + portal (customer-visible only).
create policy tracking_position_staff_select on public.tracking_position
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('tracking:read')
    and public.can_read_file(file_id)
  );
create policy tracking_position_driver_select on public.tracking_position
  for select to authenticated
  using (public.is_assigned_driver(transport_id));
create policy tracking_position_portal_select on public.tracking_position
  for select to authenticated
  using (public.portal_can_read_file(file_id) and customer_visible = true);

-- tracking_event — staff + assigned-driver + portal (customer-visible only).
create policy tracking_event_staff_select on public.tracking_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('tracking:read')
    and public.can_read_file(file_id)
  );
create policy tracking_event_driver_select on public.tracking_event
  for select to authenticated
  using (public.is_assigned_driver(transport_id));
create policy tracking_event_portal_select on public.tracking_event
  for select to authenticated
  using (public.portal_can_read_file(file_id) and customer_visible = true);

grant select on public.tracking_session to authenticated;
grant select on public.tracking_position to authenticated;
grant select on public.tracking_event to authenticated;
