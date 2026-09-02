# EFFITRANS — Conditional dossier service scope
## Pre-implementation audit

**Date:** 2026-09-02 · **AUDIT ONLY** — no code, no migration, no data change,
no process change. All production access read-only.

---

## 1. Executive verdict — **CONDITIONAL GO**

The architecture is unusually ready: **the platform already contains most of
the target machinery, built in Phase 9.0B and lying dormant.** A step
applicability registry exists (`lib/process/applicability.ts`), a governed
definition-skip action exists, the pickup join gate is already service-aware,
closure is already service-aware, and ICTD structurally cannot penalize a
dossier without a customs leg. What is missing is: the *scope facts* (the
current `type` conflates direction with service), the *automatic application*
of the registry at creation (nobody calls it — proven live by the TRP dossier
carrying nine PENDING customs steps), the *distinct N/A representation*, the
transport-side applicability rules, and roughly **eight business rulings**
without which the partial routes cannot be drawn. Conditional on those
rulings, implementation is a set of small slices, not a rebuild.

## 2. Current architecture — creation and initialization (exact path)

```
createFile (lib/files/actions.ts:121)        guard: file:create
  → operational_file row (type ∈ IMP|EXP|TRP|HND) + shipment row
  [SEPARATE ACT — EC-3D: creation does not open the workflow]
openDossierWorkflow (intake-actions.ts:348)  guard: process:manage
  → validateIntake (client, type, mode, origin/destination, ref, eta, owner)
  → initializeProcessForFile: process_instance (idempotent; policy version
      PINNED or LEGACY_DEFAULT — provenance never fabricated)
  → insert buildInitialExecutions = 29 rows (26 steps + 3 AM activities),
      ALL types alike — no applicability consulted        ← THE GAP
  → assignProcessOwner (audited)
  → cotation skip (QO-1 derived reason) unless kept
  → activateEntryStep("operations_intake")
```

Not atomic (instance insert then executions insert; instance creation is
idempotent and race-tolerant). **Scope could be frozen at `createFile`** — the
dossier exists before the workflow opens, so a scope chosen at creation is
available when `buildInitialExecutions` runs. A dossier *can* exist without an
open workflow (DRAFT), so scope must live on `operational_file`, not on the
process instance.

**Reusable service concept found:** `operational_file.type` already includes
`TRP` (transport-only) and `HND` (handling) — service scope half-exists, but
**conflated with direction** (§7 below).

## 3. Current assumptions that would break under conditional routing

| assumption | where | breaks? |
|---|---|---|
| all 29 rows instantiated for every type | `buildInitialExecutions` | yes — TRP dossier live in prod with 9 customs steps PENDING (fake pending work, today) |
| progress = "X/26 étapes officielles" | process screen counter | yes — denominator must become *applicable* steps |
| handoff 3→4 always has a live destination | `handDossierToTransit` | yes for transport-only if step 4 is ruled N/A |
| `step_number between 1 and 26` CHECK | migration 105 (engine) | no — numbering untouched |
| promotion via prerequisite graph | `isDone` ∈ {COMPLETED, APPROVED, SKIPPED} | **no — flows through terminal-done states already**; an N/A state added to that set promotes correctly |
| strict adjacency | — | **not assumed anywhere** — promotion is graph-based, proven in the reconciliation |
| reception assumes every step executes | `outstandingHandoffTo` | no — reception is enforced only where a handoff row exists |

## 4. Proposed service-scope domain model (smallest safe)

Persist the **facts**, derive the label — on `operational_file`:

```
requires_customs    boolean   -- nullable: NULL = legacy/undeclared (historical)
requires_transport  boolean
CHECK (both NULL, or at least one TRUE)   -- Finance is NOT a column: it is unconditional
```

Derived (never stored): both → `DOSSIER COMPLET`; customs only →
`DÉDOUANEMENT UNIQUEMENT`; transport only → `TRANSPORT UNIQUEMENT`.
Finance appears nowhere as a fact because it is not optional — exactly the
brief's rule. Import/Export separation preserved: `type` keeps direction;
scope is orthogonal (§7). **Ruling R8 needed on TRP/HND's future** (§18).

## 5. Proposed applicability model

The platform's existing three-layer pattern, completed:

1. **Registry** — `STEP_APPLICABILITY` (exists; today customs steps 5–13 →
   IMP/EXP). Extend keying to the scope facts instead of raw type, and add the
   transport-side entries the rulings produce.
2. **State** — a distinct `NOT_APPLICABLE` execution state (migration: widen
   the state CHECK; add to `TERMINAL_DONE_STATES` so joins/promotion flow
   through; **excluded from `OPEN_STATES`** so it never occupies a queue;
   transitions `PENDING|AVAILABLE → NOT_APPLICABLE` and
   `NOT_APPLICABLE → PENDING` for governed amendment — mirroring SKIPPED's
   shape). Carries `reason` derived from scope (« Non applicable — Dossier
   Transport uniquement »), actor = the creation/amendment act, DB timestamp.
   *Alternative considered and rejected*: reusing SKIPPED with
   `skip_source='DEFINITION'` (the current dormant representation) — honest in
   storage but the brief is explicit that N/A must not read as SKIPPED, and
   SKIPPED already has a ratified narrower meaning (cotation). Distinct state,
   distinct truth.
3. **Application** — at `openDossierWorkflow`, after instantiation: mark the
   inapplicable set N/A **in the same governed path** (the dormant
   `definitionSkippableSteps` shape, retargeted). Never later, never by UI.

`SKIPPED` remains only where ratified today: cotation (QO-1).

## 6–8. The three routes

**A — COMPLET** (`requires_customs ∧ requires_transport`): all 26 steps
REQUIRED, byte-identical to today. **Zero behavioural change** — this is the
regression invariant, and the C-4 journey remains its proof.

**B — DÉDOUANEMENT UNIQUEMENT**: steps 1–13 REQUIRED (the whole customs
chain, both its handoffs, both maker/checker pairs). Step 14 N/A. **Steps
15–17 are RULING territory** (§9 matrix): the platform must not invent what
"operational completion" means when Effitrans clears customs but does not
move the goods. Steps 18–26 REQUIRED (completeness, billing-ready, the whole
Finance chain, collections). ⚠ closure note: today a `transport_record` exists
per dossier (00009 proves it) and its presence triggers the
`delivery_incomplete` closure blocker — a customs-only dossier must either not
create the transport leg or the closure rule must consult scope (§13).

**C — TRANSPORT UNIQUEMENT**: steps 1–3 REQUIRED (universal opening). Steps
5–13 N/A (nine already in the registry). **Step 4 is a RULING** — the registry
v1 deliberately says generic Transit reception "applies to every type", but
the 3→4 handoff would then target a department with no work; if 4 is ruled N/A
for transport-only, the Operations exit needs a defined successor (3 → 14/16
promotion, and `handDossierToTransit` becomes inapplicable — no silent
bypass; the transmit act itself is N/A). Steps 14–19 REQUIRED (with the §10
join note). Steps 20–26 REQUIRED.

## 9. Step applicability matrix (1–26 × three scopes)

| # | step | COMPLET | DÉDOUANEMENT | TRANSPORT |
|---|---|---|---|---|
| 1 | cotation | REQUIRED* | REQUIRED* | REQUIRED* |
| 2 | operations_intake | REQUIRED | REQUIRED | REQUIRED |
| 3 | am_dossier_opening | REQUIRED | REQUIRED | REQUIRED† |
| 4 | coordinator_reception | REQUIRED | REQUIRED | **RULING_REQUIRED (R2)** |
| 5 | transit_declarant_assignment | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 6 | customs_preparation | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 7 | transit_validation | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 8 | coordinator_to_finance | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 9 | gainde_registration | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 10 | coordinator_to_declarant | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 11 | gainde_document_submission | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 12 | customs_followup | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 13 | customs_field_clearance | REQUIRED | REQUIRED | NOT_APPLICABLE |
| 14 | transport_assignment | REQUIRED | NOT_APPLICABLE | REQUIRED |
| 15 | pickup | REQUIRED | **RULING_REQUIRED (R1a)** | REQUIRED — prerequisite evidence **RULING (R3)** |
| 16 | am_delivery_followup | REQUIRED | **RULING_REQUIRED (R1b)** | REQUIRED |
| 17 | transport_pod_handoff | REQUIRED | **RULING_REQUIRED (R1c)** | REQUIRED |
| 18 | coordinator_completeness | REQUIRED | REQUIRED — evidence set **RULING (R1d)** | REQUIRED |
| 19 | am_completeness | REQUIRED | REQUIRED | REQUIRED |
| 20–26 | billing → collections | REQUIRED | REQUIRED | REQUIRED |

\* cotation keeps its existing QO-1 governed-skip semantics in every scope.
† step 3's four required documents include TRANSPORT_REQUEST /
BORDEREAU_LIVRAISON — on a customs-only dossier the transport-shaped evidence
is part of **R1d**; on transport-only, VENDOR_INVOICE/SPENDING_AUTHORIZATION
stay C-3-declarable as today.

**Not guessed:** every RULING row is a genuine business decision about what
Effitrans is contracted to do, not an engineering unknown.

## 10. Parallel activity applicability matrix

| activity | COMPLET | DÉDOUANEMENT | TRANSPORT |
|---|---|---|---|
| bon_a_delivrer (carrier delivery order) | applicable | **RULING (R4)** | **RULING (R4)** |
| pre_gate (terminal authorization) | applicable | **RULING (R4)** | **RULING (R4)** |
| transport_docs_transmission (⇐ both above) | applicable | follows R4 | follows R4 |

Repository evidence does not decide these: all three exist to ready the
*pickup*, which is itself partly unruled. They gate nothing on the ladder
(proven), so wrong applicability here misleads but never blocks — still, not
guessed.

## 11. Join-gate analysis (13+14→15)

Two independent layers, and **both are already service-aware or ready**:

- `PICKUP_READINESS` gate: `customs_released` carries
  `appliesToFileTypes: ["IMP","EXP"]` — **the exemption for a dossier without
  a customs leg is already built** and mirrors the pre-existing `canPickup()`
  rule. The five transport-side requirements apply to every type.
- `pickup.prerequisites = [customs_field_clearance, transport_assignment]`:
  promotion flows through terminal-done states, so an N/A step 13 (in
  `TERMINAL_DONE_STATES`) promotes step 15 with **no weakening of the COMPLET
  path** — on a complete dossier, step 13 is REQUIRED and nothing changes.
- **What is deliberately NOT designed here (R3):** what evidence authorizes a
  transport-only pickup in place of an Effitrans BAE — a client-furnished
  release document? recorded reference? nothing? That is the business's
  replacement evidence, not the platform's to invent.

## 12. Handoff analysis (the four edges under scope)

| edge | COMPLET | DÉDOUANEMENT | TRANSPORT |
|---|---|---|---|
| 3→4 `handDossierToTransit` | unchanged | unchanged | **follows R2** — if 4 is N/A the act is N/A (surface hidden AND server refuses `not_applicable`; never a silent bypass) |
| 9→10 | unchanged | unchanged | N/A wholesale (both ends inside the N/A chain — no orphan possible) |
| 22→23 | unchanged | unchanged | unchanged |
| 25→26 | unchanged | unchanged | unchanged |

Engine facts (from the reconciliation, re-verified): reception is enforced
only where a handoff row is outstanding — no assumption that every canonical
step executes; promotion is graph-based, not adjacency-based. A handoff
targeting an N/A step must be refused at `sendHandoff` (one guard to add at
implementation: destination must be applicable) — today nothing prevents it
because nothing is ever N/A.

## 13. Closure analysis

Already largely scope-correct: `closureBlockers` requires customs release
**only** for IMP/EXP with a `required` customs record (`required=false` is a
documented escape hatch), delivery **only when a transport leg exists**, and
the three financial blockers unconditionally. Under the target model:

- Corporate Finance controls (invoice exists, balance 0, payments verified)
  remain **unconditional for all three scopes** — untouched, exactly as the
  brief demands.
- Customs-only: the transport leg must not exist or the delivery blocker must
  consult `requires_transport` (decide at implementation — smallest is to not
  create the leg; today `transport_record` is created per dossier).
- Transport-only: `customs_record` absent or `required=false` — the escape
  hatch already models it.
- Process-plane closure (`process:close`, OPS_SUPERVISOR+SYSTEM_ADMIN only)
  reads "all applicable work done" once N/A ∈ terminal-done — no change to
  authority, nothing automatic anywhere (re-verified).

## 14. Performance / ICTD / ICAM / IPAM impact

- **ICTD**: population is derived from `customs_record` rows — a dossier with
  no customs leg **never enters the ICTD population**; no penalty is possible
  structurally. `delaiJoursOuvres` is null-safe on missing dates. **No change
  needed**; a pin test should freeze this property.
- **ICAM**: act-count based (documents verified, visas, deposits, incidents,
  online payments) over dossiers *closed* in the period — a partial-service
  dossier simply contributes the acts it truly had. No lateness, no zero
  fabrication. NINC/NPAY unaffected. **No change needed**; pin it.
- **Worked days / calendar**: person-scoped, dossier-independent — unaffected.
- **Consumers that DO need adaptation** (display, not calculation): the
  « X/26 étapes officielles » progress counters (denominator → applicable
  steps), the pilot checklist, milestone/journey groupings, department
  dashboards' next-action derivation (N/A must stay outside `OPEN_STATES` —
  it does, by design in §5), SLA/overdue surfaces (an N/A step has no SLA).
- `lib/process/reconcile/satisfaction.ts` **already consults
  `stepAppliesToFileType`** — reconciliation is applicability-aware today.

## 15. Department workload / dashboards

Queues derive from step state (OPEN_STATES) and document/doc-review facts.
With N/A excluded from `OPEN_STATES`: a transport-only dossier never appears
in Transit's queue (its customs steps are N/A, not PENDING), a customs-only
dossier never appears in Transport's. **Today's live counter-example:**
EFT-TRP-2026-00001 sits with nine PENDING customs steps — visible to Transit
as work that will never come. The fix is the §5 application at creation, not
query surgery.

## 16. Historical dossiers / backfill (production census, read-only)

10 dossiers: 9 IMP (1 CLOSED, 3 DELIVERED, 1 IN_PROGRESS, 1 OPENED, 2 DRAFT,
1 CANCELLED) + 1 TRP (OPENED). **Recommendation: do not backfill facts.**
`requires_customs/requires_transport` stay NULL for existing rows (the CHECK
permits it); NULL renders and behaves exactly as today (all steps stand).
Inference would fabricate: an IMP dossier's transport_record proves a leg was
*recorded*, not that transport was *contracted*. The one TRP dossier is
inferable (transport-only) but even it is better ruled than inferred (R7).
New dossiers require explicit scope. No fabricated business facts, no
retroactive N/A on executed ladders.

## 17. RBAC / security

- **Creation + scope choice**: `file:create` (existing holders incl.
  ACCOUNT_MANAGER, OPS_SUPERVISOR) — scope is a fact of the client request,
  chosen by whoever lawfully creates the dossier. No new permission needed.
- **Amendment**: recommend **B — governed amendment** (authorized actor,
  mandatory reason, old→new, actor, DB-stamped, immutable audit event;
  widening reactivates N/A→PENDING through the state machine; narrowing
  refused whenever the branch holds executed work — history never rewritten).
  Recommended authority: `process:manage` holders (OPS_SUPERVISOR — the same
  seat that opens workflows), **not** the AM alone; ruled in R5, not assumed.
- **SYSTEM_ADMIN**: holds `process:manage` today via template; no *bypass*
  exists and none is added — an amendment by SYSTEM_ADMIN follows the same
  guarded action, same reason, same audit.
- **Tenant/RLS**: scope columns live on `operational_file` under its existing
  RLS; no new policy surface. All amendment writes through server actions.

## 18. Business rulings required before implementation

| # | ruling |
|---|---|
| **R1** | Dédouanement-only operational completion: (a) does Effitrans perform the port pickup? (b) does the AM run delivery follow-up? (c) is a POD collected? (d) what evidence set does step 18's completeness review require in place of transport evidence? |
| **R2** | Transport-only: does the dossier pass through Transit reception (step 4) at all — and if not, what is Operations' exit act into the transport lane? |
| **R3** | Transport-only pickup: what replaces the Effitrans BAE as the authorizing evidence for exit/pickup? |
| **R4** | Applicability of Bon à Délivrer / Pre-Gate per scope (and per mode — they are port/terminal concepts). |
| **R5** | Who may amend service scope, and until when (recommended: `process:manage`, governed, refused once the affected branch has executed work). |
| **R6** | Treatment of step 3's transport-shaped required documents on customs-only dossiers (fold into R1d). |
| **R7** | Historical dossiers: confirm "no backfill, NULL = legacy behaves as today", and rule the one live TRP dossier's scope. |
| **R8** | The `TRP`/`HND` type vocabulary once scope exists: are new TRP dossiers still creatable, or do new dossiers become IMP/EXP + scope (with TRP/HND preserved historically)? Note file numbering (`EFT-TRP-…`) depends on type. |

## 19. Minimum safe implementation slices (after rulings)

1. **SCOPE-1 — facts + creation**: two columns + CHECK (migration), creation
   UI (« Services demandés », auto-derived label, Finance shown as
   automatic), scope frozen at `createFile`. No routing change; everything
   behaves as today. Reversible.
2. **SCOPE-2 — N/A state + application**: state CHECK widening + engine sets
   (TERMINAL_DONE/OPEN) + apply registry at `openDossierWorkflow` + UI « —
   Non applicable » rendering + `sendHandoff` destination-applicability guard.
   COMPLET path proven byte-identical (C-4 journey re-run is the regression
   gate).
3. **SCOPE-3 — routes**: registry entries + evidence sets per R1–R4/R6
   (customs-only completion lane; transport-only entry and pickup evidence).
4. **SCOPE-4 — amendment**: governed amendment action per R5 + reactivation.
5. **SCOPE-5 — surfaces**: progress denominators, dashboards, header
   (« Services : Dédouanement · Transport · Finance — automatique »), pins on
   ICTD/ICAM invariance.

## 20. UAT matrix (designed, not executed)

**UAT-SCOPE-COMPLETE** — create with both services → verify all 26 REQUIRED,
zero N/A, C-4-identical journey to closure; Finance chain runs; closure
refuses until settlement.
**UAT-SCOPE-CUSTOMS** — create customs-only → steps 5–13 run with both
maker/checker pairs; step 14 shows « Non applicable — Dossier Dédouanement
uniquement » and **cannot be executed** (server refusal, not hidden button);
no Transport queue entry; R1-ruled completion lane runs; Finance runs; closure
refuses on unpaid invoice, then closes.
**UAT-SCOPE-TRANSPORT** — create transport-only → customs chain N/A and
inert (attempt `submitStep("customs_preparation")` → refused); pickup promotes
from step 14 + R3 evidence without any Effitrans BAE; Transit queue empty; no
ICTD row for the dossier; ICAM unaffected; Finance runs; closure verified.
**UAT-SCOPE-AMEND** — create customs-only, execute through step 6, amend →
COMPLET (reason mandatory, audit shows old/new/actor/DB-time); step 14
reactivates N/A→PENDING; executed customs work untouched; then attempt the
reverse narrowing → refused (executed branch).
**Cross-cutting proofs in all four**: applicable steps cannot be silently
skipped (SKIPPED stays cotation-only), N/A never counted in queues/overdue,
no performance penalty (ICTD population + ICAM counts pinned), Finance always
present, every refusal in French.

---

*The final constraint restated as the design's own invariant: a COMPLET
dossier is untouched at every layer — same 26 REQUIRED steps, same gates, same
joins, same handoffs, same closure. Partial scopes add truth (« non
applicable »), never subtract strictness.*
