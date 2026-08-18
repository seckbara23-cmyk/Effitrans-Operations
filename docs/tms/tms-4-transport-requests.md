# TMS-4 — Transport Requests & Execution: audit & implementation contract

**Date:** 2026-08-18 · Baseline: TMS-1..3 shipped and CI-green; migrations
115/116 applied in production. **Verdict: GO — the execution machine is
COMPLETE and reused unchanged; the single genuine gap is that the REQUEST act
has no anchor: `transport:request` is granted to four roles and consumed by
zero actions, so the Account Manager (registry step 3's designated requester)
cannot initiate transport in-platform.** Code only, **no migration**. No new
business decision is required — the disposition of `transport:request` was
ratified in TMS-Q5 ("trace; retire only if nothing real needs it") and the
audit proves something real needs it.

## 1. What already exists (reused unchanged)

- **The state machine** — `transport_record` 1:1 with the dossier:
  NOT_STARTED → PLANNED → DRIVER_ASSIGNED → PICKED_UP → IN_TRANSIT →
  DELIVERED → POD_RECEIVED (+ BLOCKED, CANCELLED), `canTransition` validated,
  WES-1A partial-patch planning, WES-1B compare-and-set, WES-1C soft-delete
  revival that never rewrites history. **No competing state machine is built.**
- **Authority (as built)** — `transport:create` (start execution),
  `transport:update` (ordinary transitions), `transport:assign`
  (driver/vehicle/company planning + driver-user linkage),
  `transport:complete` (DELIVERED / POD_RECEIVED), `transport:delete`;
  visibility inherits the dossier (`can_read_file`), no transport:read:all.
  TRANSPORT_OFFICER, OPS_SUPERVISOR, SYSTEM_ADMIN hold the execution set; the
  ACCOUNT_MANAGER holds `transport:read` + `transport:request` **only**.
- **Customs interlock** — `canPickup`: IMP/EXP refuse PICKED_UP until customs
  RELEASED unless not-required or the audited `customs_override`; TRP/HND
  never gated. **Preserved untouched and pinned.**
- **Evidence** — pickup side: `BORDEREAU_LIVRAISON` (unsigned, AM-prepared)
  exists as its own document type; POD side: `canReceivePod` requires an
  APPROVED `DELIVERY_NOTE` (the signed POD), plus
  `recordPodReceiptFromVerifiedEvidence`. `TRANSPORT_REQUEST` document type
  exists (conditional) for the AM's demande. **No second document store.**
- **Driver missions** — `driver_user_id` FK + `assignDriverUser` /
  `unassignDriverUser`, driver RLS (`is_assigned_driver`), mission surface
  `app/driver/missions/[transportId]`; DRIVER role listed via the `user_role`
  join idiom (`listAssignableDrivers`).
- **Queue & maps** — `/transport` queue (`getTransportQueue`), `/journeys`,
  the department hub; TMS-3 tracking sits alongside (road layer env-gated).
- **Events & audit** — business events are TRIGGER-emitted on the table
  (`TRANSPORT_PLANNING_CREATED` on insert, `TRANSPORT_STATUS_CHANGED`,
  `TRANSPORT_PLANNED`, `TRANSPORT_STARTED`…); audit actions
  `TRANSPORT_CREATED/ASSIGNED/PICKED_UP/DELIVERED/POD_RECEIVED/...` exist.
- **External transport boundary** — `transport_company` free text +
  `TRANSPORT_ORDER` document type (the subcontractor order). **Preserved
  as-is**: TMS-4 functions without a structural change, so none is made; the
  registry belongs to TMS-6.

## 2. The one genuine gap

`transport:request` was catalogued for registry step 3 (« Préparer la demande
de transport ») and granted to SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER,
TRANSPORT_OFFICER — and **no action, page or RPC consumes it** (MAYA-P1.10
classed it F/unanchored). The AM cannot raise a transport need in-platform:
today the transport team must notice the dossier by other means.

**Disposition: ANCHOR, not retire — and the evidence trail matters.** The
P1.10 audit had recorded this as an open business question (§6): the
first-party workflow says the AM *collects* the demande as an inbound document
under `document:create` (nothing was blocked), the `DEMANDE_TRANSPORT` artifact
generator is gated `transport:manage`, and deliberate guards pinned the
permission as unconsumed "until the business answer arrives". **The TMS-4
directive IS that answer**: it names « Transport need → Request → Operational
validation/assignment → Execution » as a required, auditable workflow stage —
an in-platform request act, not only a collected paper. Anchoring the EXISTING
permission expresses exactly that with no widening: the AM gains no execution
authority (still no `transport:create`/`manage`), the collect-as-document path
remains valid alongside, and the artifact generator's authority is untouched.
Retirement would erase the only permission that can express the mandated
stage; `transport:create` in its place would hand the AM execution authority.
The P1.10 guards are moved with a dated note, not deleted — this is a
deliberate improvement of the web platform over the paper flow, recorded as
such, not MAYA parity.

## 3. Smallest change (code only, NO migration)

**`requestTransport(fileId, note?)`** in `lib/transport/actions.ts`, gated
`transport:request` + dossier visibility:

- A live transport record exists → refuse (`already_exists` — the existing
  French sentence « Un transport existe déjà pour ce dossier. »).
- A soft-deleted record exists → WES-1C revival (identical to
  `createTransport`'s: clear `deleted_at`, planning history preserved).
- Otherwise insert `NOT_STARTED` with `created_by` = the requester and the
  optional précision recorded in `notes` (prefixed « Demande de transport »,
  trimmed/capped) — the request marker IS `created_by` + the audit row.
- Audit `TRANSPORT_REQUESTED` (`transport.requested`, new constant, existing
  audit framework).
- Notify active TRANSPORT_OFFICER holders (the `user_role` join idiom, skip
  self) with the existing `FILE_ASSIGNED` notification type (TMS-1 precedent —
  the CHECK constraint stays untouched, hence no migration), title « Demande
  de transport », dossier-linked.
- **Deliberately NO app-emitted business event**: the table trigger already
  emits `TRANSPORT_PLANNING_CREATED` on the insert — emitting a second event
  for the same row is the WES-4 double-emission trap. The requester identity
  lives in `created_by` and the audit row.

**UI**: `TransportPanel` gains `canRequest`; when the dossier has no transport
record and the viewer holds `transport:request` but NOT `transport:create`, a
« Demander le transport » button (plus an optional one-line précision) appears
in place of today's silence. Execution buttons are unchanged. The files page
passes `canRequest`.

**Explicitly NOT built** (scope guard): vehicle master data / documents /
availability / maintenance / fuel / mileage / inspections / fleet dashboards
(TMS-5); subcontractor registry or contracting (TMS-6); route optimization,
telematics, driver payroll, carrier billing, dispatch optimization; no new
permission, table, column, flag, RPC, notification type, or event type; no
change to the state machine, gates, evidence model, driver flow, queue,
tracking, or portal.

## 4. Relationships

- **TMS-3 tracking**: untouched — execution milestones remain the road
  plane's spine; the request precedes them.
- **TMS-5 fleet**: `vehicle_plate`/`trailer_or_container` stay free text; the
  panel keeps them; nothing pre-built.
- **TMS-6 subcontractors**: `transport_company` free text + `TRANSPORT_ORDER`
  doc type stay the external boundary; nothing pre-built.

## 5. Tests & mutation gates

`tests/tms-4-transport-request.test.ts`: anchoring pins (the action asserts
`transport:request`; the permission is no longer unconsumed — a repo-wide
census finds ≥1 assertion); refusal pins (live record refuses; revival clears
only `deleted_at`); truthfulness pins (audit constant; notify skips self;
FILE_ASSIGNED reused — no new notification type in types.ts; NO app-side
`publishBusinessEvent`/insert into business_event in the action — the trigger
owns it); customs-interlock pins (canPickup body byte-stable: IMP/EXP +
RELEASED + override); evidence pins (canReceivePod still requires
DELIVERY_NOTE); scope-guard pins (no TMS-4 migration file; no vehicle/fleet
vocabulary; AM template still lacks transport:create). Mutations: M1 gate
swapped to transport:create (AM lockout); M2 live-record refusal dropped;
M3 revival starts resetting status (WES-1C violation); M4 customs gate relaxed
(override ignored); M5 notification stops skipping self / targets everyone;
M6 a business event is emitted app-side (double emission). All must be CAUGHT.

## 6. Production UAT criteria (deferred to TMS-7 with the rest)

1. As an ACCOUNT_MANAGER on a dossier with no transport: « Demander le
   transport » (+ précision) → record appears NOT_STARTED, notes carry the
   demande, TRANSPORT_OFFICER receives « Demande de transport ».
2. The same button refuses on a dossier whose transport exists.
3. As TRANSPORT_OFFICER: plan → assign driver → PICKED_UP on an IMP dossier
   without BAE → refused (« dédouanement non libéré ») until RELEASED or an
   audited override.
4. DELIVERED → POD_RECEIVED refused until an APPROVED Bon de livraison signé.
5. An AM still cannot plan/assign/complete (buttons absent, server refuses).
6. Business-event journal shows ONE planning-created event for the request.
