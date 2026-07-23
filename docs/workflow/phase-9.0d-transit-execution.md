# Phase 9.0D — Transit Execution Workflow

**Date:** 2026-07-23 · **Status:** shipped dark (no tenant sees anything until flags are on)

Phase 9.0D activates the Transit execution slice: from the Phase 9.0C handoff
into the Transit chain through BAE and field dispatch. It is an
**orchestration + read-model + UI layer** over the existing process engine —
**no new migration, no new table, no new permission.** Every T1–T10 business
event maps to an existing engine transition, an existing `customs_record` field,
or an existing blocker/decision contract. It does **not** build a second engine
and does **not** rename any frozen step key.

---

## 1. Architecture discovered

- The frozen 26-step registry (`lib/process/effitrans-process.ts`) already
  contains the entire Transit customs chain (steps 4–14) with prerequisites,
  the maker-checker pair (`customs_preparation` → `transit_validation`), and
  handoffs. The lifecycle map (`lib/process/lifecycle-map.ts`) already pins
  `TRANSIT_SOURCE_MAP` T1–T10 onto those real keys.
- The engine transition service (`lib/process/engine/actions.ts`) already
  exposes `receiveHandoff`, `activateStep`, `submitStep`, `completeStep`,
  `approveStep`, `rejectStep`, `sendHandoff` — all gated, CAS-guarded, audited.
- The 9.0B structures (`structures-actions.ts`) already expose `assignStepTeam`,
  `requestProcessDecision`, `finalizeProcessDecision`, `openProcessBlocker` —
  **all previously dark; 9.0D is their first consumer.**
- `customs_record` already stores `bae_reference`, `external_ref` (GAINDE/ORBUS,
  manual), `declaration_number`, `declaration_date`, `customs_office`, `regime`,
  `inspection_status`, `status`. `releaseCustoms(id, baeRef)` already writes the
  BAE and fires the `customs_cleared` customer milestone + customs→transport
  handoff.
- All 8 customer notification events already exist, including `customs_cleared`
  (« Marchandise dédouanée » = « Autorisation obtenue »), `documents_verified`,
  `transport_started`.

## 2. Existing contracts reused

`receiveHandoff` · `assignStepTeam` · `requestProcessDecision` /
`finalizeProcessDecision` (CONTINUE_BEFORE_PAYMENT) · `openProcessBlocker` /
`resolveProcessBlocker` · `releaseCustoms` · the maker-checker `approveStep` /
`rejectStep` · `assigned_user_id` / `assigned_team_code` columns ·
`notifyCustomer` events · `createNotification` (FILE_ASSIGNED) ·
`getTenantProcessFlags` · `roleCanonicalDepartment` / `TRANSIT_TEAMS` ·
`TRANSIT_SOURCE_MAP` / `lifecycle-map.ts`.

## 3. T1–T10 mapping (`lib/process/transit.ts`, validated against the registry)

| T | Stage | Registry step keys | Customer-safe stage |
|---|---|---|---|
| T1 | Réception, vérification sommaire, cotation | `coordinator_reception` | Documents en vérification |
| T2 | Analyse, conformité, ORBUS/GRED | `transit_declarant_assignment`, `customs_preparation` | Documents en vérification |
| T3 | Relation client en cas de manque | *(correction mechanism)* | Action client requise |
| T4 | Préparation & saisie (manifeste, note de détail, GAINDE) | `customs_preparation` | Déclaration en préparation |
| T5 | Contrôle, validation, signature (Chef) | `transit_validation` | Déclaration en préparation |
| T6 | Intervention Finance (enregistrement) | `coordinator_to_finance`, `gainde_registration` | Déclaration déposée |
| T7 | Vérification rattachement électronique | `coordinator_to_declarant` | Formalités douanières en cours |
| T8 | Dépôt, observations, BAE | `gainde_document_submission`, `customs_followup`, `customs_field_clearance` | Formalités douanières en cours |
| T9 | Dispatch terrain (Maritime/AIBD) | `transport_assignment` | Enlèvement en préparation |
| T10 | Exécution terrain, collecte des preuves | `pickup`, `transport_pod_handoff` | Enlèvement en préparation |

`deriveTransitStages()` rolls each stage up to `pending / active / blocked /
done` purely from the live step states (SKIPPED counts as done).

## 4. Role responsibilities

- **Chef de Transit** — receives/supervises, confirms summary verification,
  validates & signs the declaration (maker-checker `transit_validation`),
  manages Transit blockers, dispatches.
- **Déclarant en douane** — document analysis & conformity, ORBUS/GRED,
  manifest/note de détail, GAINDE preparation & submission, attachment
  verification, BAE tracking. Never validates their own work.
- **Account Manager / Operations** — contacts the customer for missing
  documents (T3 correction), retains the customer relationship, stays owner.
- **Coordinateur Transit** — coordinates dépôt/suivi/BAE, dispatches AIBD/Maritime.
- **Finance** — records the financial status; participates in the
  continue-before-payment decision (finalization is a supervisor act).
- **Operations** — remains the canonical owner throughout (no Transit action
  ever touches an owner column).

## 5. Transit reception

`receiveDossierAtTransit(fileId)` — finds the open handoff into
`coordinator_reception` (sent by 9.0C) and calls the engine's existing
`receiveHandoff`, which flips the step to AVAILABLE. Idempotent (no open handoff
→ `handoff_not_open`), audited (`PROCESS_TRANSIT_RECEIVED`), notifies the
Operations owner. Ownership unchanged. Gated `process:handoff:receive`.

## 6. Assignment model

`assignTransitStep(fileId, stepKey, userId)` — assigns a declarant/chef to a
Transit step by writing **only** `assigned_user_id` (the column already exists),
after validating the target is an **active, same-tenant, TRANSIT-mapped** staff
user (`roleCanonicalDepartment === "TRANSIT"`). CAS-guarded, audited
(`PROCESS_STEP_ASSIGNED`), notifies the assignee. Team dispatch (AIBD/Maritime)
is separate (`assignStepTeam`); membership grants nothing. The UI shows
names/roles, never a UUID. `listEligibleTransitAssignees("CUSTOMS_DECLARANT")`
serves the picker (gated `customs:assign`, bounded).

## 7. Document verification & correction loop

Document conformity is the engine's `customs_preparation` step — a document may
exist yet be non-conforming, so completion goes through the normal submit/review
path, never "present ⇒ valid". A missing/invalid document opens a
`MISSING_DOCUMENT` / `CUSTOMER_RESPONSE_REQUIRED` blocker (9.0B
`openProcessBlocker`, customer-visible only when a separate customer message is
written) and, for a preparation rejection, the maker-checker `rejectStep` creates
a new correction attempt (`correction_of_id`) — the original attempt stays
immutable. The customer sees only « Action client requise » + the approved
message; never internal notes.

## 8. ORBUS/GRED, manifest, note de détail & GAINDE

Represented through **existing** contracts: the GAINDE reference lives in
`customs_record.external_ref` / `declaration_number` (`updateCustoms`, honestly
labelled manual — there is no GAINDE API); GAINDE submission evidence and BON_A_ENLEVER
are catalogued document types; the preparation/submission steps
(`customs_preparation`, `gainde_document_submission`) carry the work. **Dedicated
typed columns for ORBUS-vs-GRED status, manifest ref, note-de-détail, liquidation
and inspection are deferred to Phase 9.0E** (see §22/§23) — in 9.0D these are
recorded honestly as typed blockers / existing customs fields rather than a
premature migration (the 9.0B migration is not even in production yet).
« Préparé dans Effitrans » vs « Saisi/Soumis dans GAINDE » vs « Accepté/retourné
par la Douane » remain distinct because they are distinct engine step states +
customs statuses, never a single flag.

## 9. Chef de Transit validation

Reuses the engine's existing maker-checker on `customs_preparation` →
`transit_validation`: `approveStep` / `rejectStep` enforce maker≠checker **on
identity** (a supervisor holding both permissions still cannot self-validate),
require a reason on rejection, preserve the prior attempt, and are audited.
Approval never marks payment complete. No new signature infrastructure.

## 10. Finance payment gate

`requestPaymentGateDecision(fileId, reason)` → reuses `requestProcessDecision`
(`CONTINUE_BEFORE_PAYMENT`, mandatory reason) and notifies deciders + Finance.
`finalizePaymentGateDecision(fileId, decisionId, outcome)` → reuses
`finalizeProcessDecision` (immutable once finalized, gated
`process:decision:approve` = SYSTEM_ADMIN/OPS_SUPERVISOR only); on
`BLOCK_UNTIL_PAYMENT` it opens a `PAYMENT_PENDING` blocker. **The decision never
marks payment paid — Finance (`invoice`/`payment`) stays the only financial
truth; this module writes no payment/invoice record.** Sensitive amounts never
enter notifications or the portal.

## 11. Electronic attachment verification (T7)

The `coordinator_to_declarant` step models the post-registration attachment/
linking check; it completes through the engine's normal action once its evidence
is present (actor + timestamp recorded on the step execution) — never a bare
checkbox.

## 12. Customs observations & follow-up

A Customs observation is an `openProcessBlocker` with category
`CUSTOMS_OBSERVATION` on `customs_followup` — internal by default, customer-safe
only when a separate message is written. Resolving it records the resolution and
**does not** auto-claim Customs acceptance (acceptance is the customs status /
step completion). Multiple observations are supported; the original stays
historically visible.

## 13. BAE

`recordBae(fileId, baeReference)` (mandatory reference) reuses the existing
`releaseCustoms`, which writes `bae_reference`, fires the customer
`customs_cleared` milestone (« Autorisation obtenue ») **and** the customs →
transport handoff. It notifies the Operations owner. The engine's
`customs_field_clearance` step then completes through its own action once the
BAE evidence is present. « Autorisation obtenue » is therefore published only
when a real BAE reference exists, and the milestone is dedup-guaranteed once-only
by the existing pipeline.

## 14. AIBD/Maritime dispatch

`dispatchToField(fileId, { teamCode?, reason? })` reuses `assignStepTeam` on
`transport_assignment`. Air → AIBD and sea → Maritime are **deterministic**
(`dispatchTeamForMode`); road/handling/multimodal are ambiguous and require an
explicit `teamCode` **and** a reason (authorized override). The target team's
**active members** are notified (the team, not every user); ownership unchanged;
cross-tenant/inactive members cannot receive. A `HND` dossier never dispatches.

## 15. Customer milestones

Reuses **existing** events only — no third mapping store, no new customer event:

| Transit position | Customer sees | Mechanism |
|---|---|---|
| T1–T4 | Documents en vérification / Dossier complet | `documents_verified` event + timeline |
| Missing customer document | Action client requise | customer-visible blocker |
| T5–T7 | Déclaration en préparation / Formalités en cours | portal timeline (step state) |
| BAE (T8) | Autorisation obtenue | `customs_cleared` (via `releaseCustoms`) |
| Dispatch (T9) | Enlèvement en préparation | portal timeline |

Milestones are idempotent (dedup key `event:entityId`); internal corrections,
decisions, notes, roles and amounts are never exposed; customer isolation is the
existing portal RLS.

## 16. UI and queues

A single `TransitPanel` on the flag-gated `/files/[id]/process` inspector
(no parallel app): reception card, T1–T10 progress with responsible party + the
customer-safe stage each maps to, declarant card/picker, finance-gate
request/finalize, BAE capture, dispatch, and Customs-observation blockers. French
labels throughout; no step keys or UUIDs in normal display. The existing 5.0C
department queues (`transit`, `customs_declaration`, `customs_field`,
`finance_customs`, `coordination`) already filter `process_step_execution` by
step-key + state and pick up this work unchanged — no new queue table.

## 17. Permissions, RLS and audit

**No new permission.** Reuses `process:read`, `process:handoff:receive`,
`customs:assign`, `process:decision:create`, `process:decision:approve`,
`customs:release`, `process:team:manage`, `process:blocker:manage`. Authorization
stays role/permission-driven; department/team membership grants nothing. Every
service-role read is tenant-scoped (tenant-scope guard green); every mutation is
audited (two additive audit actions: `PROCESS_STEP_ASSIGNED`,
`PROCESS_TRANSIT_RECEIVED`). RLS is the existing engine RLS (no new table).

## 18. Notifications

Staff notices reuse the existing `FILE_ASSIGNED` type (best-effort, dedup by the
notification pipeline, dossier number + link, no amounts/narrative): Operations
owner on reception & BAE; assignee on assignment; team on dispatch; deciders +
Finance on the payment-gate request. Customers only ever receive the existing
approved events.

## 19. Tests and build

`tests/transit-execution.test.ts` — **62 tests**: T1–T10 mapping validated
against the registry, stage-status derivation, dispatch-by-mode, customer-safe
vocabulary, quadruple-gated flag resolution, orchestration reuse (receiveHandoff
/ assignStepTeam / decisions / releaseCustoms / blockers), Operations-ownership
invariance, no-new-table / no-new-permission invariants, tenant scope, panel
(no UUID) + page wiring. Full suite: **2713 tests green**; `tsc` clean;
production build clean; production gate green.

## 20. Migration requirements

**None.** Justification: every T1–T10 event has an existing home (engine step /
`customs_record` field / blocker / decision), so additive columns are neither
necessary nor safe to add while the 9.0B migration is still absent from
production. No frozen step key is renamed; no customs/transit table is touched
destructively. Typed ORBUS/GRED/liquidation/inspection columns are deferred to
9.0E if the business confirms the need.

## 21. Rollout

```
EFFITRANS_TRANSIT_EXECUTION_ENABLED=false   # .env.example default
```

Resolution (pure): `transitExecution = ENGINE && STRUCTURES && INTAKE &&
TRANSIT_EXECUTION`, then ANDed with the tenant rollout. A **quadruple** env gate
because it continues the workflow intake opens. When disabled: existing Transit
behaviour and routes are unchanged, no T1–T10 activation, no new customer
milestone, no team dispatch, no payment-gate behaviour. **Migration-state
precondition:** do not enable until `/platform/operations` confirms the 9.0B
migration is applied — `getTransitState` catches the failure and hides the panel
when the structures/instance are absent, and the write actions fail closed.
**Do not enable for production tenants during this phase.**

## 22. Known limitations

- ORBUS vs GRED status, manifest ref, note-de-détail, liquidation and typed
  inspection are represented via existing customs fields + typed blockers, not
  dedicated columns (deferred to 9.0E).
- `customs_field_clearance` completes through the engine's own action after BAE
  evidence is present — `recordBae` records the BAE + milestone but does not
  itself advance the engine step (permission-honest separation).
- Field execution (T10 pickup/POD) is the existing pickup join gate — 9.0D wires
  dispatch, not the full field-agent mobile flow.

## 23. Phase 9.0E recommendations

- Finance execution workflow: full disbursement/customs-duty seam behind the
  payment gate, and the invoicing chain (steps 20–26).
- If the business confirms typed customs-detail tracking: ONE additive migration
  (ORBUS/GRED status, manifest, note-de-détail, liquidation, typed inspection)
  with RLS + verification SQL — after the 9.0B/9.0C migrations are confirmed in
  production.
- Field-agent mobile execution for T10 (pickup, port-exit evidence, POD).

## 24. Manual acceptance (after the 9.0B/9.0C migrations + flags in a safe env)

Prereqs: staging tenant; 9.0A/9.0B migrations applied; ENGINE + STRUCTURES +
INTAKE + TRANSIT_EXECUTION on for the tenant; a Chef de Transit, a Déclarant, a
Coordinator, an OPS supervisor, and a customer.

1. As Operations, open a dossier and hand it to Transit (9.0C).
2. As Chef de Transit, open `/files/{id}/process`: the Transit panel shows the
   reception card; « Réceptionner le dossier » → T1 done.
3. Assign a Déclarant from the picker (names/roles, no UUID).
4. As Déclarant, work `customs_preparation`; open a `MISSING_DOCUMENT` blocker
   (customer message) → the customer sees only « Action client requise ».
5. Resolve the blocker; submit the preparation; as a *different* Chef, validate
   (self-validation is refused).
6. Request the payment-gate decision (reason) → Finance notified; as OPS
   supervisor finalize `BLOCK_UNTIL_PAYMENT` → a PAYMENT_PENDING blocker appears;
   verify no payment/invoice was written.
7. Record the BAE → the customer sees « Autorisation obtenue » exactly once;
   re-record → no duplicate milestone.
8. Dispatch: an AIR dossier auto-targets AIBD, a SEA dossier Maritime, a ROAD
   dossier requires an explicit team + reason; the team's active members are
   notified.
9. Confirm Operations still owns every dossier; check My Work / the Transit
   queues; verify audit rows; repeat key flows in the Android PWA; attempt
   cross-tenant + portal access → denied.
