# Phase 3.4C — Driver Mobile & Operations Execution (3.4C-1 + 3.4C-2)

**Status:** foundation (3.4C-1) + driver mobile workspace (3.4C-2) **implemented**,
dark by default. Deferred to later increments: driver delay/incident/photo/POD/
delivery (3.4C-3) and the dispatcher live console/map/KPIs (3.4C-4, **polling-first**;
Realtime later behind `TRACKING_REALTIME_ENABLED`). Decision: **DEC-B28** (builds on
DEC-B26). Nothing here creates a second transport workflow, tracking model, or
notification system; tracking stays evidence (never mutates customs/invoice/payment/
lifecycle/delivery — DEC-A02).

## Reuse (Phase 3.4A/B — commit 7e53d62)
DRIVER role + `transport_record.driver_user_id` + `is_assigned_driver()`; tracking
session/position/event tables + RLS; pure `lib/tracking/*` (position validation,
batching, freshness, `filterNewByKey`); audit (`tracking.session.*`, etc.); documents/
storage; feature flags; the existing auth (app_user) + shell gating.

## What shipped

**Migration `20260711000001_driver_execution.sql`** (additive, forward-only):
- **Unique active session per transport** — partial unique index → idempotent
  "Start mission" (double-tap safe).
- **Driver reads their own transport** — additive `transport_record` SELECT policy
  (`driver_user_id = auth.uid() AND tenant_id = auth_tenant_id()`); staff/portal
  policies unchanged. RLS test: `supabase/tests/rls_driver_test.sql`.
- **`tracking_event.detail` (jsonb)** — structured delay/incident metadata (for 3.4C-3).
- **`tracking_position.idempotency_key`** + unique index — offline-replay dedup.
- New audit codes: `transport.driver.{assigned,unassigned}`, `tracking.batch.received`,
  `transport.pod.uploaded`.

**Dispatcher assignment** (`lib/transport/driver-actions.ts`, `drivers.ts`, dossier
`DriverAssign` UI): assign / change / unassign a DRIVER **app_user** (validated ACTIVE
same-tenant DRIVER — cross-tenant/inactive/non-driver rejected), audited, one in-app
notification (reuses `FILE_ASSIGNED`). Gated by `transport:assign` + `TRACKING_ENABLED`.

**Driver identity routing:** `postLoginPath` (pure, tested) → a DRIVER lands on
`/driver`; `requireUser` bounces drivers off staff pages; `requireDriver` guards the
`/driver` surface (staff→/dashboard, portal→/portal, none→/login — no loops); the OAuth
callback + app shell updated. Driver never sees staff nav/finance/customs/admin.

**Driver mobile workspace** (`/driver`, `/driver/missions/[transportId]`, its own mobile
shell): assignment-gated, customer-safe reads (`lib/driver/service.ts` — no finance/
customs). **Session lifecycle** (`lib/driver/actions.ts`): start (idempotent)/pause/
resume/stop — authorized by assignment, audited, **never** changes transport status.
**Consent-gated geolocation** (`MissionTracker`): `watchPosition` only after Start +
explicit consent + `DRIVER_MOBILE_TRACKING_ENABLED` (never on load); batched (≥60 s /
≥250 m); **bounded offline queue** (localStorage, idempotency keys, pending-sync count,
last-sync, never "sent" before server confirmation, no dossier data stored).

**Secure batch endpoint** `POST /api/driver/positions`: derives ALL trusted
associations (tenant/file/transport/driver) from the **session** — the client sends only
`{ trackingSessionId, positions[] }`. Rejects non-DRIVER/flag-off/not-owned/not-active/
oversized/invalid/replay; idempotent (key pre-filter + unique-index backstop); audits
**batch acceptance** (count), never per GPS point.

**Tracking health** `lib/tracking/health.ts` (pure): `not_started | live | stale |
paused | offline | completed` — derived on read, no stored field.

## Security / RLS
Driver sees only assigned transports (RLS + assignment-gated services); cannot read
finance/customs/admin (no perms, no policy); positions append-only (service-role writes
only, no client insert policy); portal still sees customer-visible only; no cross-tenant
assignment (action validation + tenant-scoped policy); the batch endpoint never trusts a
client-supplied tenant/file/transport/driver id.

## Flags (all dark)
`TRACKING_ENABLED`, `DRIVER_MOBILE_TRACKING_ENABLED` gate the surface: with the mobile
flag off, `/driver` shows missions read-only with a "disabled" banner and no geolocation.
The existing transport lifecycle + portal are unaffected.

## Privacy / retention (pending approval — cf. DEC-B26)
Consent shown before geolocation ("Le partage de votre position sera actif uniquement
pendant cette mission."). Location only during an active mission; stops on pause/stop.
Proposed retention: raw positions 90 days; material events with the dossier; POD/photos
per document policy. No automatic deletion until approved.

## Tests / validation
Unit (`tests/driver.test.ts`): health classification, batch validation (invalid/future/
too-old/missing-key/dedup/oversize), DRIVER redirect selection, bounded offline queue.
RLS (`rls_driver_test.sql`): own/other/tenant-B transport + no-finance. `npm run
typecheck` / `npm test` / `npm run build` green. Migration reset + RLS `.sql` run where
the Supabase CLI is available.

## Rollout (spec stages)
1. **Dark** — apply migration, flags off. 2. Assign one test driver, verify assignment +
mission screens. 3. `DRIVER_MOBILE_TRACKING_ENABLED=true` for one driver/transport →
consent, GPS accept/deny, start/pause/resume/stop, offline recovery. 4. (3.4C-4) dispatcher
live map. 5. Wider — after privacy/battery/retention approval.
