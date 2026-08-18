# EFFITRANS-TMS-0 — Transport Management: lightweight architecture & workflow audit

**Date:** 2026-08-18 · **Status: AUDIT ONLY — nothing implemented, no migration, no
permission, no route.** · **Baseline:** `149ddb9` (CI #505); HR-1…10 and the Brand Center
guide closed. Standing sources of record: `docs/tracking/*` (the UT series and the
2026-08-14 tracking-activation audit), `docs/maya/*` (the P0.5–P1.11 convergence chain),
`lib/process/effitrans-process.ts` (the ratified process registry), and the shipped code.

**Verdict: CONDITIONAL GO.** The striking finding is how much TMS already exists. The
dossier spine, the road-execution lifecycle with its customs and POD gates, the driver
mission surface, and a complete three-plane tracking architecture are all built. What is
missing is narrow and nameable: one mis-wired authority (Account-Manager assignment), one
structural break (shipments are not connected to geography), one activation decision
(tracking is dark and empty), and a short list of business definitions Effitrans has never
answered. No proposed phase below exists because "a TMS normally has it".

---

## 1. Architecture discovered

**One dossier, three planes, one execution record.**

```
operational_file (dossier; account_manager_id, coordinator_id, status machine)
  ├── shipment (1:1) — mode SEA/AIR/ROAD/MULTIMODAL, incoterm, origin/destination (TEXT),
  │     ETD/ATD/ETA/ATA, pickup/delivery planned+actual, bl_awb_ref, container_ref,
  │     carrier_name, vessel_or_flight  ← international carriage facts
  ├── transport_record (1:1) — final-mile execution: NOT_STARTED → PLANNED →
  │     DRIVER_ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED → POD_RECEIVED,
  │     + BLOCKED/CANCELLED; customs gate on PICKED_UP; POD gate on an APPROVED
  │     DELIVERY_NOTE; driver/vehicle/company as text fields; pod_document_id
  └── tracking planes (DEC-B88, provider-neutral)
        SEA : ocean_carrier/vessel/voyage/container/port/port_call/route_leg/tracking_event
        AIR : air_airline/airport/awb/flight/flight_leg/cargo_piece/uld/tracking_event
        ROAD: tracking_session/tracking_position (GPS: lat/lon/accuracy/heading/speed/
              source/customer_visible/idempotency)/tracking_event + provider_webhook_event
```

Above them: `lib/shipping/intelligence/*` and `lib/air/intelligence/*` (milestones,
positions, ETAs, alerts, studios), `lib/tracking/*` (position, geo, geofence, ETA, events,
health, flags, config), a **provider-neutral map projection** whose own contract says every
marker carries *source, confidence, freshness* and that stale positions are never rendered
as live, Leaflet components (staff + portal), the driver mission stack (`lib/driver/*`,
`app/driver/missions/[transportId]`), the transport queue (`/transport`), the Coordinator's
process map (`/journeys` — « Parcours des dossiers »), the Control Tower, and the process
engine (`process_instance` / `process_step_execution` / handoffs / SLA policies).

## 2. Capability census — functional vs represented

| Capability | State | Evidence |
|---|---|---|
| Transport dossiers / shipments | **Functional, in use** | `operational_file` + `shipment`, numbering, state machine, RLS |
| Road execution (final-mile) | **Functional, in use** | `transport_record` (3 rows in prod), queue UI, transitions, gates |
| Driver missions | **Functional** | mission auth keys on the dossier's AM/coordinator/creator; delivery + upload + POD actions |
| POD | **Functional, gated** | `POD_RECEIVED` requires an APPROVED `DELIVERY_NOTE`; `pod_document_id` |
| Customs interlock | **Functional** | `PICKED_UP` blocked until customs RELEASED unless not required / `customs_override` |
| Vehicles | **Text fields only — no table** | `vehicle_plate`, `transport_company` on transport_record; the migration's scope guard *deliberately* excluded a vehicle catalog |
| Drivers | **Role + text** | `DRIVER` role with mobile flow; `driver_name/phone` text for external drivers; no driver registry table |
| Containers | **Schema complete, 0 rows** | `ocean_container` empty; `shipment.container_ref` is a string |
| Ports / airports | **Schema complete, 4 seeded rows** | CNSHA, SNDKR, CDG, DSS — reference geography, not tracking |
| Shipment legs | **Schema complete, 0 rows** | `ocean_route_leg`, `air_flight_leg` |
| Tracking events / positions | **Schema + code complete, 0 rows** | all three planes empty; flags dark (`TRACKING_ENABLED` master + sub-flags) |
| Manual position entry | **Built, dark** | genuine GPS table + driver write path; `provider_code='manual'` |
| Providers | **Honest stubs** | adapters return `unsupported`/`not_configured`, never fabricate |
| Maps | **Functional renderer, reference-only markers** | the 4 visible markers are the seeded ports/airports, pushed with null source/confidence/freshness |
| Documents | **Functional** | document engine + review/approval; BAD/BAE/BL types from the MAYA chain |
| Reporting | **Functional** | Control Tower, BI, operations KPIs, fleet-map reader (refuses without `transport:read`, in French) |

**The one-line truth carried over from the activation audit: the tracking system is built —
all of it — and it has no data.** The single structural break is that `shipment.origin` /
`destination` are free text (« Shanghai », « FRANCE ») with **no FK** to `ocean_port` /
`air_airport`, and `ocean_container` / `air_flight` have no rows, so no shipment reaches a
coordinate. Everything else in the tracking stack is downstream of that.

## 3. Workflow discovered — and the discrepancy the brief predicted

The registry (26 steps, QC1–QC6 complete per MAYA-P0.7-G1/P1.0) traces, in transport
scope:

```
Demande client → cotation (COTATION_OFFICER) → client approval
→ ② ASSIGNMENT (OPERATIONS_MANAGER): « Recevoir le dossier accepté et l'affecter à
   l'Account Manager responsable du client » — evidence: account_manager_id,
   assignment_actor, assignment_date; permission file:assign
→ ③ AM opens & prepares the dossier — COLLECTS the transport request as an inbound
   document (document:create), plus BL slip, vendor invoice, spending authorization
→ transit/customs chain (CHIEF_TRANSIT validation → declaration → GAINDE → BAE/BAD)
→ transport execution (TRANSPORT_OFFICER/PICKUP_AGENT): plan → assign driver →
   customs-gated pickup → in transit → delivered → POD (APPROVED delivery note)
→ AM delivery follow-up → billing readiness → billing (Finance) → archive/closure
```

**Discrepancy 1 — the one the brief warned about, and the registry itself records.** Step ②
makes the **Operations Manager** (platform role `OPS_SUPERVISOR`, noted in the registry as
"semantically equivalent to OPERATIONS_MANAGER") the authority who assigns the Account
Manager. The code does something else: `createFile` hard-wires
`account_manager_id: admin.id` — **the creator becomes the AM** — and the registry's own
gap note states it verbatim: *"account_manager_id is auto-set to the CREATOR at createFile
and no action ever changes it."* `assignFile()` exists under `file:assign` but writes
`assigned_to_user_id`; nothing ever writes `account_manager_id` after creation. The
registry marks the step's implementation **partial**. This is the workflow's one genuine
authority defect.

**Discrepancy 2 — the sequence in the TMS brief is broadly confirmed, with one insertion.**
« Transport requirement → planning → assignment → execution → tracking → delivery/POD →
closure » matches the shipped lifecycle, except that Effitrans' real chain inserts the
**customs interlock between assignment and execution** (PICKED_UP is customs-gated), and
« tracking » is today satisfied by **status transitions**, not positions — the GPS layer
being dark. The registry also runs AM follow-up and billing-readiness *after* POD, before
closure.

**Discrepancy 3 — `transport:request` is an unanchored permission** (MAYA-P1.10,
classification F): catalogued, granted to four roles, consumed by nothing, declared by no
step. The transport request at step ③ is an inbound *document* the AM collects, not an act.
Keep-or-retire is a decision, not a gap.

## 4. Authority / RBAC map (as granted today)

| Role | Transport/tracking authority | Workflow position |
|---|---|---|
| `OPS_SUPERVISOR` (≙ Operations Manager) | full `transport:*` incl. delete; `tracking:manage/read:all/write` | assignment authority (step ②) — **the act is not implemented** |
| `TRANSPORT_OFFICER` | create/assign/update/complete/manage + `tracking:write` | plans and runs execution |
| `COORDINATOR` | create/assign/update/manage + `tracking:write` | cross-dossier coordination; owns `/journeys` |
| `ACCOUNT_MANAGER` | `transport:read`, `transport:request`(unconsumed), `tracking:read` | client-facing owner of the dossier; collects the transport request; delivery follow-up |
| `PICKUP_AGENT` | `transport:read/update` | field pickup |
| `DRIVER` | `tracking:read/write` only | mission execution; sees a mission only via the dossier's AM/coordinator/creator link |
| `CHIEF_OF_TRANSIT`, `CUSTOMS_*` | read | the customs interlock upstream of pickup |
| `CEO` / `COMPLIANCE_HSSE` / `DOCUMENTATION_OFFICER` / `WAREHOUSE_COORDINATOR` | read (CEO: `tracking:read:all`) | oversight |

RLS: transport visibility **inherits the dossier** (deliberately no `transport:read:all`);
tracking tables all carry policies; `tracking_position.customer_visible` gates driver
location from the portal. Nothing needs loosening.

## 5. MAYA-used parity assessment

Effitrans used ~40% of MAYA; Finance parity is out of scope. Against the MAYA
transport/operations capabilities actually used (P0.5-A convergence, P0.7-E QC5, P1.0 CEO
reconciliation, P1.4/P1.9 chain):

| Classification | Items |
|---|---|
| **Existing and sufficient** | dossier + parent (DOSSIERMERE converged in migration 100); cargo/refs; QC1–QC6 chain incl. quotation → validation → customs → GAINDE → BAD/BAE; transport execution record + POD; document doctrine; closure/archive; Control Tower |
| **Existing but incomplete** | AM assignment act (§3); shipment→geography link (§2); tracking data population; `transport:request` disposition |
| **MAYA-used capability requiring parity** | **None found.** MAYA had *no vehicle table, no GPS, no workflow engine* (P0.7-E, Q125 forensics); its transport output was the executed delivery + BL. That parity was reached at P1.9; the remaining MAYA-adjacent items are business definitions, not capabilities |
| **New Effitrans capability (supersedes MAYA)** | provider-neutral live tracking (three planes), driver mobile missions, portal tracking, geofencing/ETA/confidence model, process engine + SLA |
| **Not required** (challenged, no evidence of need) | vehicle/fleet catalog & maintenance, fuel management, telematics hardware, route optimization, driver payroll (HR boundary), carrier billing (Finance boundary) — the transport migration's own scope guard already excludes most of these |
| **Requires Effitrans business decision** | see §7 |

## 6. Duplicates / overlaps to reuse — not rebuild

1. **The tracking stack.** The activation audit's imperative stands: *do not build a second
   tracking system*. Any TMS phase consumes `lib/tracking/*`, the intelligence layers and
   the map projection as-is.
2. **`assignFile()`** already exists under `file:assign` with audit + notification — the AM
   assignment fix extends *it* (or sits beside it writing `account_manager_id`), it does
   not invent a new assignment machinery.
3. **Reference geography** (`ocean_port`, `air_airport`) exists with the right columns —
   population and an entry surface, not new tables.
4. **The process registry** is the workflow of record. But its `implementation` metadata is
   a **frozen 5.0A snapshot that has already misdirected two phases** — every TMS phase
   verifies against source, never against that field.
5. **`transport_record.trailer_or_container` / `transport_company` / driver text fields**
   are the deliberate lightweight model; a subcontractor registry only if Effitrans decides
   it needs one (§7).

## 7. Business decisions required (none invented here; five are pre-existing)

| # | Question | Origin |
|---|---|---|
| TMS-Q1 | Who may (re)assign the Account Manager — OPS_SUPERVISOR only, or also COORDINATOR? Can the AM change mid-dossier, and does history matter beyond the audit log? | registry step ② vs code (§3) |
| TMS-Q2 | « Sortie du port » — a distinct recorded instant from pickup? *(R-15)* | P1.0/P1.9 |
| TMS-Q3 | What proves a **signed** BL? *(R-16)* | P1.9 |
| TMS-Q4 | Vehicle conformity criteria — does Effitrans need any vehicle data beyond the plate? *(Q5.1)* | P1.9 |
| TMS-Q5 | `transport:request` — retire the unanchored permission, or ratify a real request act with an owner and evidence? | P1.10 |
| TMS-Q6 | External transport providers: is `transport_company` free text enough, or does Effitrans want a subcontractor registry (names, contacts, agreed lanes)? | this audit |
| TMS-Q7 | Tracking activation: who enters positions (drivers via mobile? dispatch manually?), which shipments are customer-visible, and is any paid provider (vessel/flight data) wanted — or manual milestones only? | activation audit §5 + flags |
| TMS-Q8 | Who owns port/airport reference data entry (an operations vocabulary, like HR's)? | this audit |

## 8. Risks

* **Generic-TMS drift** — the strongest risk. The scope guard in the transport migration
  is the right instinct; every phase below names the gap it closes and nothing else.
* **A second tracking system** — forbidden; the first one is complete and empty.
* **Stale registry metadata** — `implementation.verdict` has misdirected phases twice;
  trust source only.
* **Empty-data UAT** — the HR lesson: with 3 dossiers and 0 tracking rows, several flows
  can only be validated after data exists; UAT plans must create their own fixtures the
  operational way, not via SQL.
* **Production flags uninspected** — `TRACKING_ENABLED` state in prod was not read;
  activation is an explicit decision, not a side effect.
* **Provider cost/contract** — vessel/air data feeds are commercial; nothing assumes them
  (manual milestones are the zero-cost path).

## 9. Proposed lightweight phases — each names the gap it closes

* **TMS-1 — Assignment authority (closes §3 discrepancy 1).** Implement registry step ②
  for real: an Ops-Supervisor act that assigns/reassigns `account_manager_id` (and
  coordinator), audited, notified, historised via the existing assignment machinery;
  `createFile` stops silently crowning the creator (or records it as an explicit default
  pending assignment — per TMS-Q1). No new tables. *Gated on TMS-Q1.*
* **TMS-2 — Shipment→geography link (closes the structural break).** FK origin/destination
  (nullable, additive) from `shipment` to `ocean_port`/`air_airport`, a reference-data
  entry surface (per TMS-Q8), and backfill of the 3 production dossiers by hand. One
  additive migration. *Gated on TMS-Q8.*
* **TMS-3 — Tracking activation, manual-first (closes "built but dark/empty").** Link
  dossier facts to tracking objects (container/voyage, AWB/flight), enable manual
  milestone + position entry through the existing dark paths, flags on per ratified scope,
  portal visibility per `customer_visible`. No new architecture. *Gated on TMS-Q7.*
* **TMS-4 — `transport:request` disposition + (only if TMS-Q6 says yes) a minimal
  subcontractor registry.** *Gated on TMS-Q5/Q6.*
* **TMS-5 — Operator UAT & closure**, per the house pattern.

Explicitly **not proposed**: vehicle catalog, maintenance, fuel, telematics, route
optimization, driver payroll, carrier billing — no evidence Effitrans needs them (§5).

## 10. Recommendation

**CONDITIONAL GO.** TMS-1 is small, precisely evidenced by the registry's own gap note, and
blocked only by TMS-Q1's one-line answer. TMS-2/3 unlock the entire already-built tracking
investment for the cost of one FK migration, data entry, and a ratified activation scope.
Everything else waits on the eight questions above — all of which are business definitions,
not engineering.

**HOLD after TMS-0. TMS-1 does not begin without explicit ratification.**
