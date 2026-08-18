# TMS-5 — Parc & Flotte: audit & implementation contract

**Date:** 2026-08-18 · Baseline: TMS-1..4 shipped and CI-green (#514);
migrations 115/116 applied in production. **Verdict: GO — one additive
migration is genuinely required (three small tables + one nullable FK), no new
permission, no second dispatch workflow.** No unresolved business decision: the
authority model is fully determined by the already-ratified Transport roles.

## 1. Verified at HEAD (not trusted from TMS-0)

**There is still NO vehicle table.** Repo-wide DDL census at HEAD: zero
`create table` matching vehicle/fleet/parc/maintenance/odometer. `vehicle_plate`
is free text on `transport_record` (and denormalized on `tracking_session`).
The transport migration declares its own scope guard « no vehicle catalog ».
**Production**: 3 transport records (1 with a free-text plate), 4 active DRIVER
accounts, 0 vessels, 1 HR equipment row of which **0 are vehicles**.

## 2. Already built / reusable (used unchanged)

| Substrate | Reused as |
| --- | --- |
| `transport_record` + `canTransition` + WES-1A/B/C + customs gate + POD gate | THE execution machine. TMS-5 adds **no state**, no transition, no dispatch flow. |
| `transport:assign` (already writes `vehicle_plate` via `TRANSPORT_ASSIGNMENT_FIELDS`) | The authority that binds a vehicle to a mission. |
| `transport:manage` (already governs `ocean_carrier/port/vessel`, `air_airport/airline/flight` master data) | The fleet-steward authority: register/edit vehicles, declare maintenance. |
| `transport:read` + the `ocean_port_select` RLS idiom | Fleet visibility. |
| `driver_user_id` + `assignDriverUser` + driver missions | Driver side of « véhicule + chauffeur ». Untouched. |
| `classifyExpiry` (pure, `expired/expiring/valid/none`) | Compliance expiry classification — no second classifier. |
| `audit_log` (append-only) | Immutable history of material changes. |
| `transport_record.vehicle_id` back-reference | **Usage history** — which missions used a vehicle is a query, not a new table. |

## 3. Why an existing substrate cannot represent the vehicle

- **`hr_equipment` (has an equipment type `VEHICLE`)** — the closest candidate,
  and HR-4 explicitly left a note that a future Fleet module must be reconciled
  with it. **Reconciliation: they are different facts, under different
  authorities, owned by different departments.** `hr_equipment_assignment`
  binds an asset to an **employee** as personal custody (onboarding/offboarding,
  return outcome, and the HR-8 offboarding gate depends on it) under
  `hr:manage`/`hr:read`. TMS-5 needs a vehicle bound to a **transport mission**
  under `transport:*`. Reusing it would force Transport officers to hold HR
  authority (a cross-department widening the platform's doctrine forbids) and
  would make HR's offboarding gate answer dispatch questions. Production
  conflict today is **nil** (0 vehicles in HR equipment). The boundary is
  documented; an optional `vehicle.hr_equipment_id` link is **deferred** until
  Effitrans actually entrusts a fleet vehicle to an employee as HR custody.
- **`ocean_vessel` / `ocean_carrier`** — the maritime carriage plane
  (« Transporteurs » maritimes). A different concept that must not be reused for
  a similar French label, per the hard boundary.
- **`document`** — `file_id` is **NOT NULL** with a tenant trigger against
  `operational_file`: the dossier document store structurally cannot hold a
  vehicle's insurance certificate.
- **`transport_record.vehicle_plate`** — per-mission free text; it cannot carry
  status, compliance or maintenance, and it must **stay** as the representation
  for external/hired vehicles (the TMS-6 boundary).
- **`business_event`** — the ledger is dossier-scoped (`emit_business_event`
  resolves a `file_id`). Vehicle master-data changes are not dossier facts, so
  they belong in `audit_log`, not the ledger. **No new event type.**

## 4. Authority model — resolved by the repository, nothing invented

| Act | Authority | Why (existing precedent) |
| --- | --- | --- |
| Register / edit a vehicle | `transport:manage` | The same authority already manages every transport master-data entity (vessels, ports, airports, airlines). |
| Declare maintenance / out of service / return to service | `transport:manage` | Fleet stewardship = master-data state, not per-dossier execution. |
| Assign a vehicle to a transport | `transport:assign` | Already the gate that writes `vehicle_plate` on the record. |
| Read fleet state | `transport:read` | Matches every transport reference-data read + the RLS idiom. |

Holders (unchanged): `transport:manage` = SYSTEM_ADMIN, OPS_SUPERVISOR,
COORDINATOR, TRANSPORT_OFFICER; `transport:assign` adds no one new; the
ACCOUNT_MANAGER holds neither — consistent with TMS-1/TMS-4. **No new
permission is created; no template changes.**

## 5. Required new capability (migration 117 — additive)

1. **`vehicle`** — `registration` (immatriculation, unique per tenant),
   `internal_code`, `vehicle_type` (CHECK vocabulary), `make`, `model`, `year`,
   `capacity_kg`, `capacity_m3`, `odometer_km`, `status`, `is_active`, `notes`.
2. **`vehicle_compliance`** — one row per (vehicle, `type_code`) —
   ASSURANCE / VISITE_TECHNIQUE / CARTE_GRISE / LICENCE_TRANSPORT / VIGNETTE /
   AUTRE — with `reference`, `issued_on`, `expires_on`. **Dates and references
   only, no file store**: the dossier document store cannot hold them and
   building a second one is refused; attaching scans is deferred until proven
   necessary (the right future move is making the existing store
   entity-agnostic, not duplicating it).
3. **`vehicle_maintenance`** — `kind` PLANNED/UNPLANNED, `status` OPEN/CLOSED,
   `immobilizing`, `opened_on`/`description`/`opened_by`,
   `closed_on`/`resolution`/`closed_by`. Intervention history + return to
   service. A partial unique index allows **one open immobilizing intervention**
   per vehicle.
4. **`transport_record.vehicle_id`** — nullable FK. `vehicle_plate` is
   preserved untouched for external/hired vehicles.
5. **Tenant triggers** (TMS-2 idiom) + RLS select policies on `transport:read`;
   writes go through permission-gated server actions on the admin client.
6. **The one new invariant**: a vehicle that is not AVAILABLE/active cannot be
   bound to a transport — enforced app-side (French refusal) **and** DB-side by
   trigger. No override hatch is invented (the steward returns it to service
   first).

**Status model — deliberately three, not four.** `vehicle.status` ∈
{`AVAILABLE`, `MAINTENANCE`, `OUT_OF_SERVICE`} is steward-declared;
**« Affecté / En mission » is DERIVED** from live `transport_record` rows
referencing the vehicle. Storing it would create a second source of truth that
drifts from the execution machine — exactly the "alternative state machine" the
directive forbids.

## 6. Explicitly excluded / deferred

Fuel cards & fuel management, spare-parts inventory, workshop ERP, maintenance
costing/scheduling optimization, depreciation/accounting, procurement,
telematics management, route optimization, driver payroll, carrier billing,
per-trip mileage logs (usage history is the `transport_record` back-reference),
vehicle document **file storage** (dates only in v1), reservation/planning
calendars, and **all of TMS-6** (subcontractors/external transport — the free
text `transport_company` + `TRANSPORT_ORDER` boundary stays exactly as TMS-4
left it).

## 7. Tests & mutation gates

SQL suite `tms_5_fleet_test.sql` (appended last; runs-last pin moves): tenant
triggers refuse cross-tenant vehicle/compliance/maintenance; the availability
interlock refuses binding a MAINTENANCE vehicle to a transport; one-open-
immobilization index holds; registration is unique per tenant.
Vitest `tests/tms-5-fleet.test.ts`: authority pins (manage/assign/read, and NO
new permission in migration or templates); derived-status pin (no ASSIGNED
value in the status CHECK, no vehicle status write inside transport actions);
interlock pins; `classifyExpiry` reuse (no second classifier); scope-guard pins
(no fuel/telematics/route/payroll vocabulary; `vehicle_plate` preserved;
`hr_equipment` untouched); tenant-tables registry contains the three new
tables; build-info stable pair. **Three prior scope-guard pins (TMS-2/3/4) that
forbade any `vehicle|fleet` file or directory are moved deliberately with dated
notes and narrowed to keep guarding what is still excluded.**
Mutations: M1 interlock dropped app-side; M2 tenant trigger weakened; M3 status
CHECK gains ASSIGNED (drift); M4 register/edit downgraded to `transport:read`;
M5 assignment gate swapped to `transport:manage`; M6 a new permission inserted.

## 8. Production UAT criteria (deferred to TMS-7)

Register two vehicles → fleet overview counts; record an insurance expiring in
20 days → « Expire bientôt »; declare one in maintenance → it disappears from
the assignable picker and the server refuses binding it; close the intervention
→ it returns to AVAILABLE and becomes assignable; assign the other to a
transport → « En mission » derives from the record, no vehicle status write;
an external vehicle still records via free-text plate; an ACCOUNT_MANAGER sees
no fleet management controls.
