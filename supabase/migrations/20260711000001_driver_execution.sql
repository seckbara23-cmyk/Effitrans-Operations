-- 20260711000001_driver_execution.sql
-- Effitrans Operations Platform — PHASE 3.4C-1: Driver mobile execution foundation.
-- ---------------------------------------------------------------------------
-- Additive, forward-only (DEC-A12). Small schema gaps for the driver mobile
-- workspace + dispatcher assignment, ON TOP of the 3.4A/B tracking foundation
-- (20260710000002). No second transport workflow, no second tracking model.
-- Tracking stays EVIDENCE: nothing here mutates customs/invoice/payment/lifecycle
-- or delivery state (DEC-A02). Dark by default behind the existing flags.
--
-- Four additive changes:
--   1. ONE active tracking session per transport — a partial UNIQUE index is the
--      race-proof idempotency backstop for "Start mission" (double-tap safe).
--   2. Driver reads their OWN assigned transport_record — an additive SELECT
--      policy (driver_user_id = auth.uid()). Staff/portal policies unchanged; the
--      driver holds no file:read/transport:read and cannot pass can_read_file, so
--      without this a driver could not read their mission row.
--   3. tracking_event.detail (jsonb) — structured delay/incident metadata
--      (category, severity, expected-delay minutes) without a second table.
--   4. tracking_position.idempotency_key — offline-replay dedup for batched driver
--      positions (unique per tenant); append-only positions otherwise unchanged.
--
-- SCOPE GUARD (3.4C-1): schema + RLS only. No client-facing live tracking, no
-- geofence auto-actions, no delivery/finance mutation, no realtime.
-- Decisions: DEC-A02, DEC-A12, DEC-B12, DEC-C01, DEC-B26.

-- 1. One ACTIVE tracking session per transport (idempotent Start mission).
create unique index if not exists uq_tracking_session_active_transport
  on public.tracking_session (transport_id)
  where status = 'ACTIVE' and transport_id is not null;

-- 2. Driver reads their own assigned transport (additive; OR'd with staff policy).
--    Tenant-scoped for defense-in-depth (auth_tenant_id() = the driver's app_user
--    tenant) so a mis-set cross-tenant assignment could never leak.
create policy transport_record_driver_select on public.transport_record
  for select to authenticated
  using (
    driver_user_id = auth.uid()
    and tenant_id = public.auth_tenant_id()
    and deleted_at is null
  );

-- 3. Structured delay/incident metadata on tracking events (customer-safe copy
--    stays in customer_message; internal detail in internal_note; this is the
--    typed extras: {category, severity, expectedDelayMinutes, ...}).
alter table public.tracking_event
  add column if not exists detail jsonb;

-- 4. Offline-replay idempotency for batched driver positions. The unique index is
--    the race-proof backstop; the endpoint also pre-filters by key.
alter table public.tracking_position
  add column if not exists idempotency_key text;

create unique index if not exists uq_tracking_position_idem
  on public.tracking_position (tenant_id, idempotency_key)
  where idempotency_key is not null;
