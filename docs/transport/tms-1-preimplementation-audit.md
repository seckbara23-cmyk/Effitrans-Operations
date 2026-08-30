# TMS-1 — Vehicle lifecycle, controlled deletion, live-tracking integration
## Pre-implementation audit

**Date:** 2026-08-30 · **Status:** AUDIT ONLY. No code, no migration, no
production mutation, no vehicle deleted, no GPS integration, no map.
**Production access:** read-only probes via `supabase db query --linked`.
**Naming note:** an earlier slice register already uses "TMS-1" for commercial
ownership (`tms_1_commercial_owner_test.sql`). This document is the *vehicle
lifecycle / tracking* TMS-1; implementation slices proposed here are named
TMS-1A/B/C to avoid colliding with that register.

**Ledger correction found en route:** `transport_provider` and
`transport_record.provider_id` are **present in production**, so migration 119
(`20260911000001_transport_subcontractors`) is APPLIED — the earlier "119
PENDING" note was the same ledger false-negative as 103/104 (operator applies
write no ledger row). All fleet objects (117) are live: 4 vehicles exist.

---

## 1. Current vehicle schema (migration 117, verified live)

```
vehicle
  id · tenant_id → organization · registration (unique per tenant on
  upper(btrim(·))) · internal_code · vehicle_type ∈ {CAMION, CAMIONNETTE,
  VOITURE, TRACTEUR, REMORQUE, AUTRE} · make · model · year · capacity_kg ·
  capacity_m3 · odometer_km
  status ∈ {AVAILABLE, MAINTENANCE, OUT_OF_SERVICE}   ← steward-declared ONLY
  is_active boolean default true                      ← RETIREMENT FLAG, EXISTS
  notes · created_by · created_at · updated_at
```

Two deliberate absences, both asserted by the migration itself:
- **No EN_MISSION status.** « En mission » is *derived* from `transport_record`
  — assertion 7b refuses an ASSIGNED/MISSION value in the CHECK. There is one
  state machine, not two.
- **No fleet permission.** Assertion 7a refuses `fleet:*`/`vehicle:*` codes;
  the parc rides `transport:manage` (write) / `transport:read` (read) /
  `transport:assign` (mission binding).

## 2. Dependency graph

| TABLE | FK | DELETE BEHAVIOR | BUSINESS MEANING | HISTORY-SENSITIVE? |
|---|---|---|---|---|
| `transport_record` | `vehicle_id` (nullable) | **NO ACTION** (`confdeltype='a'`) — DB refuses deleting a referenced vehicle | operational evidence a mission used this vehicle | **YES** |
| `vehicle_maintenance` | `vehicle_id` | **CASCADE** | intervention history: work done, immobilization, return to service — audited acts | **YES** (cascade is reachable only because `deleteVehicle` refuses when any row exists) |
| `vehicle_compliance` | `vehicle_id` | **CASCADE** | descriptive master data (insurance/inspection dates) — records nothing that *happened* | NO (deliberate: documented in `deleteVehicle`) |
| `audit_log` | `entity='vehicle', entity_id` (no FK) | rows survive deletion | who did what to the vehicle | **YES** — survives by design |
| `tracking_session` | `vehicle_plate` free text (no FK to `vehicle`) | n/a | tracking references the *plate string*, not the row | NO |
| `organization` | `tenant_id` | parent | tenant boundary + `enforce_vehicle_child_tenant()` trigger on both children | — |

Not linked anywhere: documents (the dossier store's `file_id NOT NULL`
structurally cannot hold a vehicle's papers — documented in 117), finance/cost
(explicitly out of TMS-5 scope), `hr_equipment` (boundary documented: personal
custody ≠ fleet; link deferred).

## 3. Current vehicle state machine (from code, not UI labels)

```
            createVehicle (transport:manage)
                     │  audit VEHICLE_CREATED
                     ▼
              AVAILABLE ──setVehicleStatus──▶ OUT_OF_SERVICE
                 ▲  │            ◀──setVehicleStatus──┘
                 │  │ openVehicleMaintenance(immobilizing)
                 │  ▼
              MAINTENANCE ──closeVehicleMaintenance──▶ AVAILABLE
                                (only from MAINTENANCE — a deliberate
                                 OUT_OF_SERVICE stays until the steward acts)

  ORTHOGONAL AXES, all already enforced:
  • en mission   = derived: transport_record.vehicle_id references it
  • is_active    = retirement: setVehicleActive(id, bool) EXISTS in actions
  • deleted      = deleteVehicle EXISTS, guarded (see §5)
```

Enforcement points, all DB-side or server-side:
- `trg_transport_vehicle` refuses binding a vehicle that is inactive
  (« ce véhicule est retiré du parc ») or not AVAILABLE — no path can dispatch
  an immobilized or retired vehicle.
- `uq_vehicle_single_open_immobilization` — one open immobilizing intervention
  per vehicle, as a DB invariant.
- Return to AVAILABLE is refused while an immobilizing intervention is open
  (`maintenance_open`).
- Every act audited: `VEHICLE_CREATED / UPDATED / STATUS_CHANGED /
  MAINTENANCE_OPENED / MAINTENANCE_CLOSED / DELETED`.

**The one genuine gap:** `setVehicleActive` is implemented, audited (as generic
`VEHICLE_UPDATED`), enforced by the dispatch interlock — **and no UI calls
it.** Retirement exists at every layer except the screen, and it captures no
reason, no effective date, no dedicated audit event.

## 4. Vehicle retirement — recommendation (« Retirer du parc »)

The right production action for sold / returned / scrapped / permanently
retired vehicles **already half-exists**. Recommend completing it, not
inventing it:

1. Extend `setVehicleActive(false)` → `retireVehicle(id, {reason, effectiveOn?,
   reference?})`: reason **mandatory**, effective date defaulting to today,
   optional note/reference.
2. Two dedicated audit events: `VEHICLE_RETIRED` / `VEHICLE_REACTIVATED`
   (today's generic `VEHICLE_UPDATED` cannot be told apart from an odometer
   edit).
3. Persist `retired_at · retired_reason · retired_by` as three nullable columns
   on `vehicle` (small additive migration — forecast §16) so the parc list can
   say « Retiré le 12/08 — vendu » without querying `audit_log` (whose read is
   `audit:read:all`, an authority parc users don't hold). *Alternative: audit-
   only, zero migration — rejected because the fact would be invisible to the
   people who need it.*
4. Refuse retiring a vehicle currently bound to an **open** mission
   (transport_record not in a terminal status) — today `setVehicleActive` would
   happily retire a truck mid-mission; the interlock only guards *new*
   bindings.
5. History untouched: missions, interventions, compliance, audit all remain
   readable. Retired vehicles stay queryable behind a « Voir les véhicules
   retirés » filter.

## 5. Permanent deletion — recommendation (« Supprimer définitivement »)

**Keep the existing `deleteVehicle` exactly as strict as it is.** Verified
behavior:

- identity confirmation: typed registration re-checked **server-side**;
- refuses if ANY `transport_record` references the vehicle (`vehicle_in_use`) —
  and the FK (`NO ACTION`) is the DB backstop against races;
- refuses if ANY `vehicle_maintenance` row exists (`vehicle_has_history`);
- `vehicle_compliance` cascades — documented as deliberate (descriptive data,
  cannot outlive its vehicle);
- audited `VEHICLE_DELETED` with the registration in `before`;
- **no force flag exists, and none should be added.**

Two hardenings recommended (neither weakens anything):
- add a **reason** field to the confirmation (the brief's requirement; today
  none is captured);
- also count `tracking_session.vehicle_plate` matches in the eligibility check
  once tracking goes live (today: 0 sessions, no-op).

Verdict: **permanent delete = demo/typo cleanup only**, which is precisely what
the current guards already enforce. A vehicle that ever served cannot be
destroyed by this code path, and the audit confirms no other deletion path
exists (`from("vehicle").delete()` appears once in the repository).

## 6. Demo vehicle cleanup matrix (read-only census, production)

| registration | id | missions | interventions | compliance | audit | verdict |
|---|---|---|---|---|---|---|
| `UAT-TMS7-01` | `2fa5a9fe-…88170` | **1** — dossier `EFT-IMP-2026-00004`, status POD_RECEIVED, not deleted | 1 | 2 | 10 | **BLOCKED** — operational evidence on a completed mission; FK + app check both refuse. **RETIRE ONLY.** |
| `UAT-TMS7-99` | `1524dbb5-…4e43c` | 0 | **1** | 0 | 5 | **RETIRE ONLY** — intervention history refuses deletion (`vehicle_has_history`). Do not delete the history to enable the delete. |
| `aa-605-mw` | `da2ddf56-…f3bf5` | 0 | 0 | 0 | 2 | **SAFE TO DELETE** via the existing guarded action — but see the duplicate note. |
| `AA605MW` | `23db7f54-…d422c` | 0 | 0 | 0 | 1 | **SAFE TO DELETE** — same note. |

All four: tenant `…0001` (the production tenant), created by
`seckbara23@gmail.com` (2026-08-19 for the UAT pair, 2026-08-27 for the plate
pair) — all clearly operator-created UAT/demo rows.

⚠ **The plate pair is one physical vehicle typed twice.** `aa-605-mw` and
`AA605MW` differ only by hyphens/case — the uniqueness index
(`upper(btrim(registration))`) treats hyphens as significant, so both were
accepted. AA-605-MW is a plausible real Senegalese plate: one of these two rows
is presumably the company's actual truck, mis-entered the other time. **Which
row is canonical is Effitrans's call (Q1)** — delete the other, then correct
the survivor's registration format if needed. Do not delete both.

No vehicle was deleted, retired, or modified by this audit.

## 7. Proposed UI actions (smallest change to the existing page)

Today the parc page (`app/transport/parc` → `FleetConsole`) is a single console
under the list: register form, compliance form, intervention open/close,
availability buttons, and a delete block. Missing entirely: retirement.

Recommend a per-row **Actions** menu (the direction requested), mapped strictly
to what exists or is specified above:

| menu item | backing action | state |
|---|---|---|
| Voir | row expand / detail | exists (list) |
| Modifier | `updateVehicle` | exists, not surfaced in UI — wire it |
| Mettre hors service | `setVehicleStatus(OUT_OF_SERVICE)` | exists |
| Réactiver / Déclarer disponible | `setVehicleStatus(AVAILABLE)` | exists (guarded by open-maintenance check) |
| **Retirer du parc** | `retireVehicle` (§4) | **build — TMS-1A** |
| Réintégrer au parc | `reactivateVehicle` | build with §4 |
| Supprimer définitivement | `deleteVehicle` | exists — add reason field |

Keep the existing modal/inline confirmation for deletion (identity typed +
server re-check + server-side dependency refusal). Retirement gets: reason
(required), effective date (default today), note/reference (optional), actor
and audit implicit. Do **not** redesign the page.

## 8. Current mission / tracking support — classification: **PARTIAL**

What already exists (built Phase 3.4, migration `20260710000002`, **dark and
empty** — 0 sessions, 0 positions, 1 event in production):

| brief item | platform reality |
|---|---|
| external tracking provider | **ABSENT** — no field anywhere |
| tracking URL | **ABSENT** |
| provider mission ID | **ABSENT** |
| GPS device / tracker ID | **ABSENT** |
| route | shipment origin/destination + pickup/delivery locations (free text); no route object |
| departure / arrival | `transport_record.pickup_actual / delivery_actual`, statuses PICKED_UP → IN_TRANSIT → DELIVERED |
| live status | `tracking_session.status ∈ {ACTIVE, PAUSED, COMPLETED, CANCELLED}` |
| last known location | `tracking_session.last_position_at` + `tracking_position` (lat/lng/speed/heading, idempotency key) |
| timestamps | `started_at / ended_at / recorded_at / received_at` |
| completion state | transport `DELIVERED → POD_RECEIVED`; session `COMPLETED` is separate |

The `source` vocabulary **already anticipates external feeds**:
`('manual', 'driver_mobile', 'vehicle_gps', 'carrier_api', 'vessel_api',
'flight_api')`. Feature flags exist and are dark: `TRACKING_ENABLED` master +
`DRIVER_MOBILE / PORTAL_LIVE / REALTIME / GEOFENCE` sub-flags. Four
permissions are catalogued: `tracking:read / read:all / write / manage`.
`tracking_position.customer_visible` + `PORTAL_LIVE_TRACKING_ENABLED` already
model the client-exposure question per row.

**No GPS/map/provider integration code exists anywhere in the repository** —
verified by search. The existing spine is the platform's *own* capture plane
(driver PWA), not a provider integration.

## 9. Integration options for the existing tracking platform

| | **A — external link** | **B — embed** | **C — API integration** |
|---|---|---|---|
| complexity | 3 nullable columns + one button | A + iframe plumbing | provider client, sync jobs, mapping into `tracking_position` |
| security | lowest: no credentials in Effitrans; URL is opaque | provider cookies/CSP/X-Frame-Options — often blocked or requires provider-side allow-listing; a session leak risk inside our page | credentials to store/rotate; API scope; token handling |
| credentials | none | maybe (signed embed) | **yes** — env/secret store, never operational tables |
| vendor dependency | name + URL only | high (embed contract) | highest (API contract) |
| availability | theirs; failure = dead link, harmless | their uptime inside our page | sync jobs to monitor; staleness handling |
| real-time fidelity | full (their native UI) | full | bounded by poll/webhook cadence |
| UX | one click, new tab | seamless but fragile | seamless, ours |
| auditability | we audit that a link was attached/opened | same | full position history in our tables |
| data retention | none of theirs held | none | we hold positions → retention policy needed |
| risk of disrupting the current platform | **zero** — read-only reference | low | non-zero (API quota, account changes) |

**Recommendation: OPTION A first.** It is reversible, credential-free, cannot
disrupt the Transport team's working tool, and its schema (§11) is exactly the
prefix of what B and C need later — nothing is thrown away when C arrives. C is
the eventual destination *if* Effitrans wants positions inside the platform
(the `tracking_position` plane is already built for it, `source='vehicle_gps'`
/ `'carrier_api'` already in the vocabulary); it needs the provider's name and
API capability first (Q2).

## 10. Recommended first tracking architecture

Mission page (dossier → transport panel) gains, for `transport:manage` /
`transport:assign` holders, an « Associer le suivi » form (provider label +
URL + optional external ref), and for `tracking:read` holders a button:

> **Suivre la mission en direct ↗** — opens the provider URL in a new tab
> (`rel="noopener noreferrer"`), only while the reference is attached and the
> mission is not terminal.

Attach/detach audited. No iframe, no map, no provider code, no secret.

## 11. Provider-neutral contract (smallest that serves Option A)

On **`transport_record`** (see §12 for why), all nullable, additive:

```
tracking_provider      text     -- human label / code: 'GEOTRAB', 'WHERE-IS-MY-TRUCK', …
tracking_external_ref  text     -- the provider's mission/trip id (optional)
tracking_url           text     -- the deep link the button opens
tracking_started_at    timestamptz  -- when the reference was attached / trip started
tracking_ended_at      timestamptz  -- when it ended / was detached
```

Deliberately **not** included: `last_sync_at` (Option C only — add when a sync
exists, else it is a lie), device/tracker IDs (vehicle-plane, unknown provider
model), credentials/API keys (**never** in operational tables — env/secret
store when C arrives), coordinates (that is `tracking_position`'s job, already
built).

## 12. Mission ownership — the principle holds, and the schema supports it

The requested principle — *a live tracking session belongs to a MISSION, not
the vehicle* — is already structurally true here, with one platform-specific
fact: **`transport_record.file_id` is UNIQUE — one transport mission per
dossier.** The mission object *is* `transport_record`.

- `tracking_session` already carries `transport_id` + `file_id` + `driver_id` —
  mission-scoped, many sessions per vehicle over time, zero vehicle FK.
- For Option A the reference goes on `transport_record` (1:1 with the mission)
  rather than spawning empty `tracking_session` rows that will never hold
  positions. When Option C starts feeding positions, sessions become the right
  container and the vocabulary already admits it.
- The vehicle owns nothing tracking-related; `tracking_session.vehicle_plate`
  is a free-text snapshot, correctly so (external vehicles have no row).

## 13. Driver / chauffeur relationship

Chauffeurs are **not** free text, not transport-specific resources, and not
(necessarily) employees:

- `transport_record.driver_user_id → app_user` — an internal driver is a
  platform identity holding the **DRIVER** role (role-templates: "a narrow
  mobile identity with no dossier access"; RLS scopes a driver to their own
  missions — `rls_driver_test` / `rls_driver_ops_privacy_test` cover it).
  4 DRIVER holders exist in production.
- `driver_name / driver_phone` free text — the external/hired chauffeur
  representation (TMS-6 boundary), kept deliberately.
- HR link: `hr_equipment` VEHICLE custody is a documented separate plane; an
  employee↔driver link is deferred, not missing.

The full chain the brief asks for is expressible today with zero redesign:

```
DOSSIER (operational_file)
  → TRANSPORT MISSION (transport_record, unique per dossier)
      → VEHICLE   (vehicle_id FK | vehicle_plate free text)
      → CHAUFFEUR (driver_user_id FK | driver_name/phone free text)
      → ROUTE     (pickup/delivery locations + shipment origin/destination)
      → TRACKING  (tracking_session.transport_id — built; Option A ref on the mission)
```

## 14. Mission completion authority

**Completion is proven by the POD, not by tracking — this is already the
business model, keep it.**

- The state machine ends `DELIVERED → POD_RECEIVED`.
- `POD_RECEIVED` is set **only** by `pod-receipt.ts` when a delivery-note
  document is **verified** (the operator decision) — the platform "does not
  invent a delivery that has not" (its own comment). `pod_document_id` links
  the evidence.
- `tracking_session.status='COMPLETED'` is a *telemetry* fact and is nowhere
  wired to transport status. Correct — a chauffeur switching the tracker off at
  the gate proves nothing about delivery.
- Recommendation: when a mission reaches a terminal status (`DELIVERED`,
  `POD_RECEIVED`, `CANCELLED`), the UI stops offering the live link and
  `tracking_ended_at` is stamped. Tracking end must **never** transition the
  mission.

## 15. RBAC / security recommendations (grounded in the existing catalog)

| act | authority | basis |
|---|---|---|
| view live-tracking link | `tracking:read` (own/assigned scope), `tracking:read:all` (supervision) | existing catalog; OPS_SUPERVISOR/CEO already hold `read:all` |
| attach/modify provider reference | `transport:manage` (master data act) or `transport:assign` (dispatch act) — **one** of them, ratify which (Q4) | the parc precedent: no new permission |
| end/detach tracking | same as attach | symmetric |
| client visibility | **NO in v1.** The provider URL exposes the provider's own auth surface; `PORTAL_LIVE_TRACKING_ENABLED` + `customer_visible` already model client exposure for our *own* positions — route any future client view through that, never through the raw provider link | existing flag doctrine |
| tenant isolation | columns live on `transport_record` (RLS-covered, `rls_transport_test` in CI); no cross-tenant surface added | existing |
| audit | attach/detach/open audited via `writeAudit` (`TRACKING_LINK_ATTACHED` / `DETACHED` new audit actions) | existing idiom |
| fleet-location privacy | the link renders only for `tracking:read` holders on that mission's dossier; never on list pages | RLS + per-page gate |

## 16. Migration forecast

| slice | migration | content |
|---|---|---|
| TMS-1A retirement | **132** (small, additive) | `vehicle.retired_at/retired_reason/retired_by`; nothing else — `is_active` stays the interlock flag |
| TMS-1B demo cleanup | **none** — operator session using existing guarded actions | delete the non-canonical plate row (after Q1), retire the two UAT vehicles |
| TMS-1C tracking link | **133** (small, additive) | the five §11 columns on `transport_record` |
| Option C (later, own audit) | not forecast here | provider client + sessions/positions activation |

Zero destructive DDL anywhere in the forecast.

## 17. UAT plan

**TMS-1A (retirement):**
1. Retire a clean vehicle with reason → disappears from the default parc list,
   appears under « retirés » with date+reason; dispatch refuses it
   (« ce véhicule est retiré du parc » — DB-side, already live).
2. Attempt to retire the vehicle bound to the open mission → refused with a
   French sentence naming the mission.
3. Reactivate → bindable again.
4. Audit shows `VEHICLE_RETIRED` with reason, actor, timestamp.

**TMS-1B (cleanup):** delete duplicate plate row (typed confirmation; verify
refusal on wrong registration first); verify `UAT-TMS7-01` and `UAT-TMS7-99`
deletion is **refused** with the existing French messages; retire both instead.

**TMS-1C (tracking link):** attach provider URL to an active mission → button
appears for `tracking:read` holder, opens new tab; not visible to a role
without `tracking:read`; not visible on the portal; detach → button gone,
`tracking_ended_at` stamped; mission reaching POD_RECEIVED → link no longer
offered; audit rows for attach/detach.

## 18. Blockers / questions requiring Effitrans input

- **Q1 — canonical plate row:** `aa-605-mw` or `AA605MW` — which survives?
  (Both are deletable; only one should be.)
- **Q2 — tracking provider identity:** name, whether it offers per-mission deep
  links, embed support, API. Option A needs only the deep-link answer.
- **Q3 — retirement authority:** `transport:manage` (same as today's delete)?
  Or narrower? Recommend `transport:manage`, matching the parc doctrine.
- **Q4 — attach-tracking authority:** `transport:manage` or `transport:assign`?
  Recommend `transport:assign` (it is a dispatch-time act).
- **Q5 — client visibility of the provider link:** recommend NO in v1 (§15).
  If Effitrans wants client tracking later, it goes through the built
  `customer_visible` plane, not the provider URL.
- **Q6 — UAT vehicles:** retire both, or keep `UAT-TMS7-01` active for future
  TMS-7 UAT rounds? (TMS-7 E2E UAT is registered and not begun.)

None of Q2–Q6 blocks TMS-1A. Q1 blocks only the second half of TMS-1B.

## 19. Recommended implementation sequence

1. **TMS-1A** — retirement: migration 132, `retireVehicle`/`reactivateVehicle`,
   dedicated audit events, open-mission refusal, per-row Actions menu, reason
   field on delete. *No dependency on any answer.*
2. **TMS-1B** — demo cleanup: operator session, existing actions only. After Q1.
3. **TMS-1C** — tracking link (Option A): migration 133, attach/detach actions,
   mission-page button, terminal-status gating. After Q2 (deep-link semantics)
   and Q4.
4. **Later, separate audit** — Option C if ratified: provider API into the
   existing `tracking_session`/`tracking_position` plane, flags on.

## 20. Verdict

**CONDITIONAL GO.**

- TMS-1A: **GO** — every mechanism exists or is a small additive step; no
  business ambiguity.
- TMS-1B: **GO after Q1** — the guarded delete already refuses everything that
  must be refused; verified against live data.
- TMS-1C: **GO after Q2/Q4** — Option A is safe, reversible, and vendor-free;
  building it before knowing the provider's deep-link model risks a dead
  button, nothing worse.
- Option B (embed): **NO-GO** as a first step — fragile, provider-dependent,
  and strictly dominated by A for effort/risk.
- Option C (API): **deferred** — needs its own audit once the provider is
  named; the platform's own tracking plane is already shaped for it.
