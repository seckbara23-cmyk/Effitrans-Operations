# Phase 3.4 — Real-time Operations & Shipment Tracking

**Status:** 3.4A (foundation) + 3.4B (manual ops updates) **implemented**, dark by default.
Later increments (driver mobile, portal live map, Realtime, geofence worker, external
providers, retention cron) are scoped but **not** in this commit. Decision: **DEC-B26**.

Real-time tracking is an **additive evidence layer over the existing transport
lifecycle** — not a second transport system, not a second status source. The
operational dossier + `transport_record` stay authoritative (DEC-A02). A tracking
position/event is **evidence only**: it never auto-transitions a dossier and never
moves finance. Nothing here activates until `TRACKING_ENABLED=true`.

## Existing capabilities reused (no duplication)

| Need | Reused |
|---|---|
| Lifecycle / delivery / POD | `lib/transport/{status,gates,actions}.ts`; POD = APPROVED `DELIVERY_NOTE`; `onPodReceived` → Finance handoff (unchanged) |
| Map + GPS seam | `lib/portal/map-points.ts` (`buildMapPoints({…, livePosition})`), `components/portal/leaflet-map.tsx` (lazy `ssr:false`) — the live-map increment wires `livePosition`, no component change |
| ETA | `lib/portal/eta.ts` (`derivePortalEta`, pure) — extended, not replaced |
| Audit | `writeAudit` + `AuditActions` (`<entity>.<change>`) |
| Notifications / dedup | `notifyCustomer` + `dedupKey` + `client_notification` unique index; staff `createNotification` |
| Activity feeds | staff `ACTIVITY_META` (off `audit_log`); portal `buildTimeline` (off `client_notification`) |
| RLS / auth / flags / tests | `auth_tenant_id` / `has_permission` / `can_read_file` / `portal_can_read_file`; `process.env.X === "true"` flags; `supabase/tests/rls_*` + pure `lib` unit tests |

## What shipped (3.4A/B)

**Migration `20260710000002_create_tracking.sql`** (additive, forward-only — DEC-A12):
- **Driver identity:** `DRIVER` role on `app_user` (existing auth, DEC-B12) + additive
  `transport_record.driver_user_id`. `is_assigned_driver(uuid)` (SECURITY DEFINER)
  scopes a driver to their own transports without recursing into `transport_record` RLS.
- **Tables:** `tracking_session` (one tracking period), `tracking_position`
  (append-only positions), `tracking_event` (customer-safe / operational events).
  Each: `tenant_id` + FK to `operational_file` (+ optional `transport_id`),
  tenant-integrity trigger, tenant-leading indexes. `tracking_event.dedup_key` has a
  unique partial index (idempotent geofence / provider events).
- **Append-only:** enforced at the app layer (no delete action, no DELETE policy) — not
  a DB delete-block trigger, so the `on delete cascade` from a purged dossier still works
  (positions/events die with the file, like `transport_record`). `customer_visible` may
  be toggled by `tracking:manage`.
- **Permissions:** `tracking:read` (inherits dossier visibility), `tracking:read:all`
  (tier-1 fleet gate), `tracking:write` (manual/driver), `tracking:manage` (admin
  controls). Granted per role + **mirrored in `seed.sql`**.
- **RLS (SELECT only; writes via service role):** staff (`tenant + tracking:read +
  can_read_file`) **OR** assigned-driver (`is_assigned_driver` / own session) **OR**
  portal (`portal_can_read_file AND customer_visible`). CI-tested in
  `supabase/tests/rls_tracking_test.sql`.

**Feature flags** (`.env.example`, `lib/tracking/flags.ts` pure, `lib/tracking/config.ts`
server-only): `TRACKING_ENABLED` master + 4 sub-flags, **all `false`**. A sub-flag is
inert without the master.

**Pure engines** (`lib/tracking/*`, unit-tested in `tests/tracking.test.ts`, 25 cases):
- `geo.ts` — haversine, `withinRadius`, coarse straight-line progress (labeled approximate;
  real routing is a replaceable seam, no paid API).
- `position.ts` — coordinate/timestamp/accuracy validation, batching (`shouldRecordPosition`:
  ≥60 s **or** ≥250 m), latest-selection, freshness (`live`/`recent`/`stale`/`none`),
  offline-replay dedup (`filterNewByKey`).
- `geofence.ts` — idempotent arrival detection (dedup-keyed; a fence may suggest, never
  mutates workflow).
- `events.ts` — manual-update kinds (**excludes `DELIVERED`** — lifecycle stays
  authoritative) + customer-safe defaults.
- `eta.ts` (ETA v2, `deriveRealtimeEta`) — wraps ETA v1; a single GPS fix is capped at
  medium, a stale fix degrades confidence (`last_known_position`), a position alone never
  fabricates a date.

**Manual ops updates (3.4B):** `recordManualTrackingEvent` / `recordManualPosition`
(`lib/tracking/actions.ts`) — gate `tracking:write` + `TRACKING_ENABLED` + dossier
visibility → validate → service-role write → `writeAudit` → revalidate. Internal timeline
UI (`components/transport/tracking-timeline.tsx`) on the dossier page, labeled
**« Mise à jour manuelle par Effitrans »**, gated on `TRACKING_ENABLED` + `tracking:read`.
No customer notification here (customer-visible events surface via the portal tracking
timeline in a later increment — no duplicate feed).

## Audit events

`tracking.session.{started,paused,resumed,completed,cancelled}`,
`tracking.position.manual_recorded`, `tracking.event.created`, `tracking.delay.reported`,
`tracking.incident.reported`, `tracking.provider.webhook_received` (machine, reserved).
Session + material events are audited — **not** every GPS position (volume).

## Privacy (Senegal) — review before the driver pilot

Location is collected **only during an active assignment**, with **explicit driver
consent**; no background/idle tracking; no contacts/photos/device IDs beyond what is
operationally required. Consent copy (Deliverable 5): *« Le partage de position sera actif
uniquement pendant cette mission de transport. »* A **Senegal data-privacy + employment-
policy review is required** before `DRIVER_MOBILE_TRACKING_ENABLED` is turned on.

## Retention (proposal — for approval, no cron yet)

Raw positions **90 days**; simplified route/events retained with the dossier; POD per the
document-retention policy; audit per the audit-retention policy. **No destructive cleanup
cron** ships until retention is approved (cf. DEC-B19).

## Validation

`npm run typecheck` ✅ · `npm test` ✅ (473 tests, 25 new) · `npm run build` ✅.
The migration reset + `supabase/tests/rls_tracking_test.sql` must run where the Supabase
CLI is available (CI / dev with Docker) — the SQL follows the established RLS-test pattern.

## Rollout (spec stages)

1. **Dark** — apply the migration with all flags OFF; verify no regression.
2. **Internal manual** — `TRACKING_ENABLED=true`; ops staff record manual events.
3. **One-driver pilot** — `DRIVER_MOBILE_TRACKING_ENABLED=true` for one driver/transport
   (after the privacy review + the driver-mobile increment).
4. **Client visibility** — `PORTAL_LIVE_TRACKING_ENABLED=true` for one pilot customer
   (after privacy approval + the portal-live increment).
5. **Wider** — only after battery/network/consent/visibility/retention are approved.
