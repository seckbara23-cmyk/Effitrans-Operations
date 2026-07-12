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

---

# Phase 3.4C-3 — Operational events, delay/incident, photos, POD & delivery

**Status:** implemented, dark by default (same `DRIVER_MOBILE_TRACKING_ENABLED` gate).
Builds on 3.4C-1/2 (commit 6f924d7). No new transport workflow, no second POD table, no
new notification system — everything reuses the shipped foundation. Tracking stays
**evidence** (DEC-A02): a driver event never mutates lifecycle; only the **explicit**
delivery confirmation invokes the existing transport transition.

## Architecture reused
- **tracking_event** (+ `detail` jsonb from 3.4C-1) for events / delay / incident /
  delivered; `customer_visible` + `dedup_key` already present.
- **Document workflow** (Phase 1.8): private `documents` bucket, `lib/documents/storage`
  (server-built path, signed URLs), the `document` table + `document_type` catalog — for
  all photos, the signature, and the POD (`DELIVERY_NOTE`).
- **Transport state machine** `lib/transport/status.ts` (`canTransition`) + the existing
  `transport.delivered` audit + `custDelivered` notification — via a shared helper.
- **Notifications**: `createNotification` (`FILE_ASSIGNED`) to the dossier's dispatch owners.
- **Assignment authority** (`driver_user_id === caller`) + `DRIVER_MOBILE_TRACKING_ENABLED`.

## Files changed
- **New (server):** `lib/driver/mission-auth.ts` (driver ctx, assignment/session loaders,
  `notifyDispatchers`), `lib/driver/ops.ts` (`recordDriverEvent`, `reportDelay`,
  `reportIncident`), `lib/driver/upload.ts` (`uploadDriverEvidence`),
  `lib/driver/delivery.ts` (`confirmDelivery`), `lib/transport/transition.ts`
  (`deliverTransport` — shared DELIVERED path).
- **New (pure):** `lib/driver/event-kinds.ts` (event/delay/incident/severity/evidence sets
  + guards, MIME allow-list, `delayDedupKey`/`deliveredDedupKey`).
- **New (UI):** `components/driver/mission-actions.tsx` (events, delay, incident, photos,
  delivery forms) wired into `app/driver/missions/[transportId]/page.tsx`.
- **Extended:** `lib/driver/service.ts` (mission detail now returns the driver's captured
  `evidence`); `lib/i18n.ts` (`driver.ops.*` + error codes); `app/globals.css` (`.input`).
- **Migration:** `20260712000001_driver_evidence_types.sql` — additive `document_type`
  rows: `PICKUP_PHOTO`, `CARGO_PHOTO`, `SEAL_PHOTO`, `INCIDENT_PHOTO`, `DELIVERY_PHOTO`,
  `DRIVER_SIGNATURE` (`on conflict do nothing`). No table/RLS/workflow change.

## Event model
`recordDriverEvent` inserts a `tracking_event` (source `driver_mobile`) for the allowed
kinds only — `PICKUP_CONFIRMED, DEPARTED, CHECKPOINT_REACHED, BORDER_REACHED,
WAREHOUSE_REACHED, ARRIVED_NEAR_DESTINATION, DELIVERY_ATTEMPTED`. Guards: flag →
assignment → **live session required** → allowed kind → valid timestamp/coordinate.
`customer_visible` defaults from `isCustomerSafeByDefault(type)`. Evidence only — no
status change.

## Delay / incident privacy
- **Delay** (`reportDelay`): category (traffic, breakdown, road_closure, checkpoint,
  customs_delay, weather, incorrect_address, client_unavailable, other) + a **required
  customer-safe message** (`customer_visible=true`), optional internal note, optional
  expected-minutes, optional location. Metadata in `detail` jsonb. **Dedup** via
  `delayDedupKey` (one per transport+category per 10-min bucket) enforced by the
  `tracking_event` unique `dedup_key` index — a repeat submit returns `{ok:true}` without a
  new row. Notifies dispatchers.
- **Incident** (`reportIncident`): category (accident, cargo_damage, security, breakdown,
  delivery_refusal, missing_cargo, other) + severity + a **required internal description**
  (`internal_note`). `customer_visible` is `false` unless a customer-safe message is
  explicitly supplied — internal detail is **never** portal-visible. The portal never
  queries `tracking_event` at all (customer tracking is derived from lifecycle), and RLS
  restricts any such read to `customer_visible=true`. Both layers proven by
  `rls_driver_ops_privacy_test.sql`.

## Photo / POD reuse
`uploadDriverEvidence` (assignment-gated; drivers hold no `document:create`): validates
MIME per kind (`isAllowedEvidenceMime` — jpeg/png; POD also pdf), size ≤ 25 MB
(`validateDocumentInput`), an ACTIVE `document_type`; server-builds the storage path;
uploads to the **private** bucket; inserts a `document` row (`shared_with_client=false` —
internal until staff approve + share); audits `document.uploaded`. POD scans land
`PENDING_REVIEW` (staff review queue → the eventual POD_RECEIVED + Finance handoff); other
evidence `UPLOADED`. No public-bucket exposure.

## Delivery transition path & handoffs
`confirmDelivery`: flag → assignment → live session → **recipient name required** (required
evidence) → validate timestamp/coords → validate any referenced signature/photo docs
belong to this dossier+driver. Then, in order: (1) `deliverTransport` — the **shared**
DELIVERED path (`canTransition` guard = duplicate protection; `transport.delivered` audit;
idempotent `custDelivered` customer notification); (2) a customer-visible `DELIVERED`
event (recipient/POD detail kept **internal** in `detail`; `deliveredDedupKey`); (3) the
session is completed (`COMPLETED` + `ended_at`, `tracking.session.completed` audit,
`TRACKING_STOPPED` event) **only after** step 1 succeeds — a failed transition leaves the
session live. **Finance handoff is not fired here** — it stays the staff POD_RECEIVED
approval step. Geolocation/geofence alone never delivers (explicit call + recipient).

## Tests / validation
- Unit (`tests/driver-ops.test.ts`): allowed vs forbidden driver events, delay/incident
  category + severity guards, evidence→type mapping, MIME allow-list (photos reject
  pdf/gif/svg; POD accepts pdf), delay/delivered dedup-key behaviour, delivery transition
  guard (duplicate/late blocked).
- RLS (`rls_driver_ops_privacy_test.sql`): portal sees the customer-safe delay + delivered,
  **never** the internal incident; assigned driver sees all three. Existing
  `rls_tracking_test.sql` already proves `customer_visible=false` is portal-invisible.
- `npm run typecheck` / `npm test` / `npm run build` green. Reset + `.sql` where the
  Supabase CLI is available.

## Migration instructions
Additive & forward-only. Apply `20260712000001_driver_evidence_types.sql` (via `supabase db
reset` in dev, or the migration runner in CI/prod). No backfill, no RLS change. The six new
`document_type` rows are dark-safe (unused until the driver captures evidence).

## Remaining for 3.4C-4
Dispatcher live console, map, and KPIs; Realtime (polling-first, behind
`TRACKING_REALTIME_ENABLED`); optional live sync of the mission-actions session state
(today the actions read `sessionActive` from the server render and re-validate every write
server-side). Retention automation still pending approval (DEC-B26).
