# TMS-6 — Subcontractors / External Transport: audit & implementation contract

**Date:** 2026-08-18, **rebased 2026-08-19** onto post-TMS-5B/5C HEAD
(`87b9904`, CI #518). Baseline: TMS-1..5C shipped and CI-green; migrations
115/116/117/118 applied in production. **Verdict: GO — one additive migration
(one table + one nullable FK + one exclusion invariant), no new permission, no
second execution machine.** No unresolved business decision: the authority is
resolved by the same ratified transport roles that govern every other transport
master-data entity.

## 0. Rebase — what changed under this contract, and what survived

This phase was drafted, parked mid-flight for TMS-5B/5C, and resumed. Every
finding below was re-verified against current HEAD rather than assumed:

| Post-5B/5C fact | Effect on this contract |
| --- | --- |
| **TRANSPORT is now a canonical Effitrans DEPARTMENT** and TRANSPORT_OFFICER / PICKUP_AGENT / DRIVER derive to it. | **None to the design, but it sharpens the vocabulary.** A subcontractor is the *opposite* of a department: an EXTERNAL company, never an Effitrans identity, never a role, never a canonical department. The registry therefore touches neither `lib/organization/departments.ts` nor any role mapping — asserted by test. |
| **Parc & Flotte is live and reachable** (`/transport/parc`, migration 117 applied). | The exclusion invariant becomes MORE load-bearing, not less: internal execution now has real vehicles that must never be confused with an external provider on the same transport. |
| Transport authorities were untouched by 5B/5C. | The authority finding stands exactly: `transport:manage` registers, `transport:assign` binds, `transport:read` reads. |
| Migration slot 118 was taken by TMS-5C (`20260910000001`, applied). | The draft is **renumbered to `20260911000001` (migration 119)**; 118 is never reused, and the new file sorts after every applied migration. |
| TMS-5C proved the canonical vocabulary IS stored in three CHECKs. | Irrelevant here — a provider is not a department, so nothing this phase writes enters that vocabulary. |

No pre-TMS-5C assumption survives silently: the registry is re-verified absent
at HEAD, `transport_company` is still free text, `TRANSPORT_ORDER` still
renders it, and `ocean_carrier` is still the maritime plane.

## 1. Verified at HEAD — what already exists

| Present | Reality |
| --- | --- |
| `transport_record.transport_company` | **Free text**, written by `updateTransport` (planning fields, `transport:update`). Rendered as « Transporteur » on the ORDRE DE TRANSPORT and in the copilot context. |
| `TRANSPORT_ORDER` | A built, Category-B **internal artifact** (« Ordre de transport »), produced under `transport:manage`, mandating `driverName` + `vehiclePlate` and printing `transportCompany`. It is the order **to** a subcontractor. |
| `transport_record` | THE execution machine (TMS-4), with driver/vehicle assignment under `transport:assign`, the customs interlock, and POD evidence. |
| `vehicle` + `vehicle_id` | TMS-5's internal fleet, with the availability interlock. |
| `ocean_carrier` | The **maritime shipping-line** plane (Maersk/MSC…), tied to `ocean_vessel`/`ocean_voyage`/`shipment`. |
| `provider_webhook_event` | **Payments** infrastructure — unrelated. |
| Driver identity | `driver_user_id` (authenticated Effitrans driver) *and* free-text `driver_name`/`vehicle_plate` for an external crew. |

**There is NO subcontractor / external-carrier registry at HEAD.** A repo-wide
DDL census for subcontract/provider/carrier/vendor/supplier/partner returns
only the two rows above.

**`ocean_carrier` must NOT be reused.** It models a shipping line on the
international carriage plane and is keyed to vessels and voyages; a road
subcontractor executes the final-mile `transport_record`. Sharing the table to
share a French label (« Transporteur ») is exactly the conflation the hard
boundary forbids — and it would put maritime master data under road
operations.

## 2. The gap

External execution is representable only as a **typed string**. Consequences:
nothing distinguishes « SENTRANS SARL » from « sentrans » from a typo; there is
no approved/suspended state, so an operator can dispatch a provider the company
has stopped working with; there is no contact information at the moment of
dispatch; provider usage cannot be answered at all; and — most importantly —
**nothing prevents a transport from being simultaneously an Effitrans-fleet
execution and an external one**, because `vehicle_id` and the company string
are independent fields.

## 3. Smallest structural addition (migration 118)

1. **`transport_provider`** — tenant-scoped registry mirroring the `client`
   idiom (name, `ninea`, contact_name, email, phone, address, notes), plus
   `status` ∈ APPROVED / SUSPENDED and `is_active`. Name unique per tenant,
   case- and space-insensitive.
2. **`transport_record.provider_id`** — nullable FK.
3. **THE execution-source invariant** — a CHECK making `vehicle_id` and
   `provider_id` **mutually exclusive**: a transport is executed by the fleet,
   or by a subcontractor, never both. Refused DB-side, so no path can record a
   contradiction.
4. **The availability interlock** (symmetric to TMS-5's) — only an APPROVED,
   active provider of the shipment's own tenant may be bound; a suspended or
   retired provider is refused by trigger.
5. **Historical identity — reuse, not a new column.** On assignment the action
   **snapshots the provider's name into the existing `transport_company`**.
   That column already means « Transporteur » on the printed order, so the
   artifact and the copilot keep working unchanged, and a later rename of the
   registry row never rewrites what a past order said. The FK carries the
   link; the text carries the history.

**Execution mode is DERIVED, never stored** — `provider_id` set ⇒ external,
`vehicle_id` set ⇒ internal, neither ⇒ not yet determined. Storing a third
column would be a second source of truth that can drift from the two FKs (the
same doctrine that keeps « En mission » derived in TMS-5).

**Provider usage history is DERIVED** from `transport_record` — no execution
log is invented (the TMS-5 precedent).

## 4. Authority — resolved by the repository, nothing invented

| Act | Authority | Precedent |
| --- | --- | --- |
| Register / edit / suspend a provider | `transport:manage` | The authority that already governs every transport master-data entity — ocean carriers, ports, vessels, airports, and TMS-5's vehicles. |
| Bind a provider to a transport | `transport:assign` | Choosing **who executes** is the same act class as binding a vehicle or a driver, and `provider_id` therefore joins the ASSIGNMENT fields, not the planning ones. |
| Read the registry | `transport:read` | Every transport reference-data read + the RLS idiom. |

`transport:manage` and `transport:assign` are held by exactly the same four
roles (SYSTEM_ADMIN, OPS_SUPERVISOR, COORDINATOR, TRANSPORT_OFFICER), so this
widens nothing. Noted honestly: `transport:update` additionally includes
PICKUP_AGENT, which is why the structured provider binding goes in the
assignment lane — a pickup agent can still type a free-text company (existing
behaviour, unchanged) but cannot bind an approved subcontractor.
**No new permission is created.**

## 5. Investigated and deliberately EXCLUDED

- **Transport modes / capabilities on the provider** — `transport_record` *is*
  the road/final-mile leg by construction (the international legs live in the
  ocean/air planes with their own carrier concepts), so a `modes` column would
  be a constant `ROAD`. Free-text `notes` carries any capability remark. One
  column can be added later if Effitrans genuinely subcontracts other legs.
- Procurement, supplier accounting, carrier billing/invoicing, tendering, rate
  cards or rate optimization, contracts, insurance/vendor documents, scoring,
  GPS/telematics, driver payroll, and any full vendor-management system: no
  repository evidence and no stated Effitrans requirement.
- No change to the TMS-4 state machine, the customs interlock, POD evidence,
  the TMS-5 Parc authority, or the portal.

## 6. Reachability (the TMS-5A lesson applied up front)

The registry is a **Transport department** responsibility (TMS-5B made
Transport a department in its own right): `/transport/sous-traitants`, presented
as a first-class responsibility CARD on `/departments/transport` beside
« Demandes & Exécution » and « Parc & Flotte » — the natural home now that
Transport owns ground execution. Nothing is added to the Transit hub, and no
new top-level navigation is created. The TMS-5A lesson applies: a card, not a
chip, and the card is pinned as such.

## 7. Tests & mutation gates

SQL suite `tms_6_subcontractor_test.sql` (appended last; runs-last pin moves):
name uniqueness normalized; a SUSPENDED or retired provider is refused;
cross-tenant refused; **vehicle_id + provider_id together refused**; swapping
from fleet to provider is allowed when the other side is cleared.
Vitest `tests/tms-6-subcontractors.test.ts`: authority pins (manage/assign/read,
no invented permission, no template change); exclusion + interlock pins; the
snapshot pin (assignment writes the provider name into `transport_company`);
derived-mode pin (no `execution_mode` column anywhere); `ocean_carrier`
untouched and unreferenced by the road module; usage history derived from
`transport_record`; reachability pins; scope-guard pins (no billing/rate/
contract/tender/procurement vocabulary). Mutations: M1 exclusion CHECK dropped;
M2 suspended provider accepted; M3 registry gated on `transport:read`;
M4 binding moved out of the assign lane; M5 snapshot dropped (history lost);
M6 picker offers suspended providers; M7 the hub link removed.

## 8. Production UAT criteria (deferred to TMS-7)

Register two providers; suspend one → it disappears from the picker and the
server refuses it; bind the approved one to a transport → the dossier shows
« Transport externe » with the provider name, and the ORDRE DE TRANSPORT prints
that carrier; attempt to also bind a fleet vehicle → refused; rename the
provider → the past transport still shows the name as it was; an internal
transport still shows « Flotte Effitrans »; a free-text company still works for
an ad-hoc carrier; a user without `transport:manage` sees the registry
read-only, and without `transport:read` cannot reach it at all.
