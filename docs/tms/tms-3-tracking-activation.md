# TMS-3 — Tracking Activation: audit & implementation contract

**Date:** 2026-08-18 · Baseline: TMS-1 (`4f8c638`) + QO-1 (`9a6e70f`) + TMS-2
(`b4615a2`/`7ef8caa`), migrations 115 & 116 applied in production, parity
confirmed. **Verdict: GO — the tracking layer is overwhelmingly BUILT AND
LIVE; what TMS-3 genuinely adds is two small reuse gaps (code, no migration)
plus an operator env-flag activation and an operational runbook.** No new
business ratification is required: every decision this phase relies on is
already ratified (Q7 manual-first, customer view withholds internal notes,
paid providers stay dark) or already shipped as production behavior.

## 1. Classification — evidence from source and production

### ALREADY BUILT AND LIVE (permission-gated, reachable, truthful)

- **Ocean studio** `/shipping` (7 surfaces): shipments list + detail with
  **Studio de suivi manuel** (`components/shipping/tracking-studio.tsx` →
  `addManualTrackingEvent`, gate `transport:update`), ops panel (route legs,
  port calls, booking, vessels/voyages — gate `transport:manage` for CRUD),
  Leaflet map (`shipment-map.tsx`), journey, alerts, ETA-with-provenance.
- **Air studio** `/air`: airports/airlines/flights/ULDs + shipment detail with
  **AirConsole** manual events (`addManualAirEvent`, gate `transport:update`).
- **Road execution**: `/transport` queue + `transport_record` milestone chain
  (NOT_STARTED→…→POD_RECEIVED, customs gate, POD evidence) — live, not
  flag-gated. Driver missions (`app/driver/missions/[transportId]`).
- **Reach**: the Transport department hub (`/departments/transport`) links all
  three planes; the dossier's Acheminement panel links `/shipping`.
- **Truthfulness model (complete, rendered)**:
  - Source enum + ONE French label map (`SOURCE_LABEL_FR`): « Saisie
    manuelle », « Transporteur », « Signal AIS », « GPS routier »… used by the
    staff map, journey and portal — never a raw enum, never liveness language.
  - Confidence labels (« Confirmée / Déduite / Saisie manuelle / Estimée »).
  - **Freshness**: per-source thresholds (`freshness.ts` — a ROAD fix ages in
    minutes, a MANUAL milestone in days), age-language labels « À jour /
    Récent / Ancien / Très ancien / Inconnu » with the documented 8.4 rule
    that « En direct » is FORBIDDEN until a real-time provider contract
    exists. Stale data stays visible with its age — the resolver keeps the
    last known position and the projection raises a warning instead of
    deleting it. UNKNOWN ≠ stale: no-timestamp classifies separately.
  - Manual events: stored `source='MANUAL'`, `confidence='MANUAL'`, fingerprint
    dedup (23505 → « déjà enregistré »), milestone regression demands an
    explicit « Je confirme cette correction » + audited before/after, CAS
    versioning refuses stale writes, every entry audited
    (`SHIPPING_TRACKING_MANUAL_EVENT` / `AIR_TRACKING_MANUAL_EVENT` /
    milestone-changed twins).
  - **Corrections are append-only**: there is NO update or delete path for
    `ocean_tracking_event` / `air_tracking_event` / `tracking_event` in any
    action; a correction is a NEW event (with confirmation); history persists.
  - ETA carries provenance (`ETA_SOURCES` incl. MANUAL vs SYSTEM_ESTIMATE;
    `isCarrierEta` guards the UI from labelling estimates as confirmed).
- **Customer portal (live)**: `getPortalCarriage` on the portal dossier —
  vessel/flight, units, safe references, milestone label, map. The projection
  boundary is already enforced twice: (a) the portal ocean-event select **omits
  `description`** (internal notes never travel), staff identity and provider
  internals are not projected; (b) road GPS fixes reach the portal ONLY through
  RLS `tracking_position_portal_select` = `portal_can_read_file AND
  customer_visible = true` — per-row operator opt-in. Portal timeline uses its
  own `CUSTOMER_SOURCE_LABEL_FR` vocabulary.
- **RLS**: ocean/air events select via `transport:read`; road via
  `tracking:read` + `can_read_file`; driver via `is_assigned_driver`; portal as
  above. Writes go through definer/admin actions with explicit permission
  gates. TMS-2 anchors feed staff maps (SEA anchors→legs; AIR flight→anchors).

### BUILT BUT DARK (env flags off — activation is operational, not code)

- **Road tracking layer** (staff dossier TrackingTimeline +
  `recordManualTrackingEvent` / `recordManualPosition`, gate `tracking:write`,
  labels « Mise à jour manuelle par Effitrans », per-event
  `customer_visible`): behind **`TRACKING_ENABLED`** (env, dark by default).
- **Driver mobile location sharing**: behind `DRIVER_MOBILE_TRACKING_ENABLED`
  (requires master).

### PARTIALLY FUNCTIONAL / honest notes

- `PORTAL_LIVE_TRACKING_ENABLED`, `TRACKING_REALTIME_ENABLED`,
  `TRACKING_GEOFENCE_ENABLED` are **defined but currently gate nothing** (no
  consumer outside the flag reader). The portal carriage view ships regardless
  — that is existing production behavior, unchanged by TMS-3. Recorded, not
  "fixed": wiring them is meaningless until the capabilities they describe
  (provider realtime, geofence generation) exist.
- `components/shipping/manual-event-form.tsx` is an **unmounted orphan** (the
  live form is inside TrackingStudio). Left in place; noted.
- **Providers — classification** (audited, none touched):
  - Ocean `manual` provider + carrier STUBS + AIS boundary: *structurally
    ready, unconfigured* — every op honestly returns `not_configured`; no
    fabricated response is possible by construction.
  - Air `manual` + `airline` stub: same.
  - Road GPS: real driver-device source exists (driver mobile actions) but is
    flag-dark; no telematics provider, none invented.
  - **Paid/external provider selection = deferred product decision** (recorded;
    does not block manual tracking; nothing hard-wired in TMS-3).
- **Production data**: 3 shipments (all `BOOKING_CREATED`), **0 events in all
  three planes**, referential = 2 ports + 2 airports. Built, empty.

### GENUINELY MISSING (the TMS-3 engineering — code only, no migration)

- **G1 — the referential is unreachable from the manual forms.** TrackingStudio
  and AirConsole require hand-typed location names, codes and raw coordinates,
  while TMS-2's `ocean_port`/`air_airport` referential holds exactly those,
  curated. Smallest change: an optional « Lieu depuis le référentiel » picker
  that PREFILLS the existing fields (name, UN/LOCODE or IATA, coordinates)
  from the referential — copied, never invented; the event remains
  source=MANUAL confidence=MANUAL (a port's known position is where the event
  happened, not vessel telemetry, and the label keeps saying « Saisie
  manuelle »). Fields stay editable; nothing becomes mandatory.
- **G2 — the dossier cannot reach ITS OWN shipment's studio.** The Acheminement
  panel links to `/shipping` generically. Smallest change: deep links
  « Ouvrir le suivi maritime/aérien » to
  `/shipping/shipments/[id]` / `/air/shipments/[id]` (the shipment id is
  already on FileDetail). Same MAYA-P0.6 doctrine: the surface exists, reach
  was missing.
- **G3 — activation runbook (operational, no code).** Road manual tracking is
  ratified manual-first (Q7) and fully built; turning it on is an env change,
  documented for the operator below.

## 2. Staff workflow (as built — reused, not invented)

View tracking: `transport:read` (ocean/air surfaces + studio), `tracking:read`
(road timeline on the dossier). Enter manual updates: `transport:update`
(ocean/air events + ETA), `tracking:write` (road events/positions),
`transport:update`+`transport:manage` for execution milestones/ops data.
Correct: a NEW event via the same gates — regressions demand explicit
confirmation and are audited with before/after; historical events are
immutable (no update/delete path); deletion is not offered. Stale: rendered
with age labels, never hidden. No position: `position.available=false` renders
an honest empty state, never an invented marker. No new role, no new
permission, no widening.

## 3. Customer projection boundary (as built — confirmed, unchanged)

Customer-visible: milestone (customer vocabulary), unit list, safe references
(BL/AWB/booking), map built from customer-visible located events, source/
confidence/freshness of those markers, last-update timestamps. NOT visible:
internal notes (`description` never selected), staff identity, provider
internals, road positions unless `customer_visible=true` row-by-row, internal
alert/exception reasons. TMS-3 changes NOTHING here.

## 4. Migration verdict

**No migration is genuinely required.** The audit explicitly rejects
manufacturing one. No new table, column, permission, policy or flag.

## 5. Implementation (G1 + G2)

Files touched: `lib/shipping/intelligence/manage-service.ts` (+
`listPortLocationOptions` — id/name/unlocode/lat/lng, gate `transport:read`),
`lib/air/intelligence/manage-service.ts` (+ `listAirportLocationOptions`),
`components/shipping/tracking-studio.tsx` (controlled location fields +
picker), `components/air/air-console.tsx` (same),
`app/shipping/shipments/[shipmentId]/page.tsx` +
`app/air/shipments/[shipmentId]/page.tsx` (load + pass options),
`components/files/carriage-panel.tsx` + `app/files/[id]/page.tsx` (deep link).
Actions, schema, RLS, portal: untouched.

## 6. Tests & mutation gates

Vitest `tests/tms-3-tracking-activation.test.ts`: activation-state pins (road
gates = flag + `tracking:write`; ocean/air = `transport:update`; MANUAL
source+confidence stamps; regression confirmation; append-only — no
`.update(`/`.delete(` on event tables in actions); truthfulness pins (« Saisie
manuelle » label; freshness labels contain no « En direct »; portal event
select omits `description`; road portal RLS pins `customer_visible = true`);
G1 pins (picker prefills FROM the referential row, no numeric fallback, fields
remain editable, options gated `transport:read`); G2 pins (deep links); scope
guard (no vehicle/fleet/fuel/maintenance/telematics vocabulary added; no new
permission; no migration file for TMS-3). Mutations: M1 ocean event stamped
CONFIRMED instead of MANUAL; M2 regression confirmation dropped; M3 portal
select gains `description`; M4 picker invents 0,0 coordinates on a
coordinate-less port; M5 road action loses the flag gate; M6 freshness LIVE
label becomes « En direct ». All must be CAUGHT.

## 7. Operator activation (G3) + production UAT plan

**Env (Vercel, production):** set `TRACKING_ENABLED=true` to light the road
manual layer (staff dossier timeline + manual updates). Optionally
`DRIVER_MOBILE_TRACKING_ENABLED=true` when driver phones should share GPS.
Leave `PORTAL_LIVE_TRACKING_ENABLED`/`REALTIME`/`GEOFENCE` unset (currently
inert). No migration to apply for TMS-3.

**UAT (focused; folds into TMS-7 E2E):**
1. `/departments/transport` → the three plane cards open.
2. SEA dossier → Acheminement → « Ouvrir le suivi maritime » lands on ITS
   shipment detail.
3. Studio: record « Départ du navire » choosing a referential port → event
   shows the port name/code, marker at the port's coordinates, labelled
   « Saisie manuelle », freshness « À jour »; the map's endpoint markers
   (TMS-2 anchors) are visibly distinct from the current-position marker.
4. Record an earlier milestone → correction confirmation demanded; both events
   remain in the journal (append-only).
5. AIR dossier: same via AirConsole with an airport pick.
6. After `TRACKING_ENABLED=true`: road dossier shows « Suivi routier »;
   record a manual position WITHOUT customer_visible → absent from the portal;
   repeat WITH it → visible, labelled as a manual update.
7. Portal dossier: map/milestone visible, NO internal note text anywhere.
8. Let a manual event age past its threshold in a later session → label
   « Ancien », position still shown with its timestamp.

## 8. Scope guard

NOT built (later phases or excluded): vehicle registry / fleet dashboard /
maintenance / fuel / insurance / telematics management / route optimization /
driver payroll / carrier billing / subcontractor anything / transport-request
redesign / dispatch optimization / provider purchase. TMS-5 Parc & Flotte is
NOT pre-built here. MAYA parity demands nothing: MAYA had no GPS, no vehicle
table, no tracking planes — everything here is a deliberate new capability of
the web platform, not parity.
