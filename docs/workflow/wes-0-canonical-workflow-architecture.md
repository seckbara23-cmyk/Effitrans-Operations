# WES-0 — Canonical Workflow Architecture (Ratified)

**Date:** 2026-07-26 · **Status:** RATIFIED — frozen, amended only by WES-0A
**Baseline:** Workflow Engine Stabilization Audit at commit `11b7400` (post-11.0D, CI green)
**Type:** architecture ratification — no code, no schema, no permissions changed by this document

> **Amendment notice.** This document is amended by
> [`wes-0a-ratification-addendum.md`](wes-0a-ratification-addendum.md), which adds ADR-WES-012
> (policy as configuration), ADR-WES-013 (SLA & time), ADR-WES-014 (business event ledger) and
> refines ADR-WES-004 and ADR-WES-005. Read both before implementing.

---

## 1. Why this document exists

The WES Audit found **six engines, five progress computations, seven assignment slots and no
arbiter**. Manual end-to-end testing surfaced lifecycle regression, duplicate tasks, dossiers
disappearing on reassignment, chauffeurs receiving no mission, BAE approved by the wrong service,
transport planning silently erased and inconsistent progress percentages.

The audit identified the technical causes. This document decides the architecture so that no
implementer has to.

**Governing rule for every decision below:** each concept has exactly one definition, one owner and
one source of truth.

---

## 2. Canonical workflow authority

**RATIFIED.** The authority chain is permanent. The arrow from module records to the engine is
**evidence consumption**, never command: modules never order the engine, the engine reads evidence
and advances itself.

```
External evidence (uploads, references, signatures, GPS, payments)
      │ captured as
      ▼
MODULE RECORDS — the EVIDENCE LAYER
customs_record · document · transport_record · invoice/payment
own: facts and their own evidence lifecycles (forward-only machines)
      │ consumed by (automatic, evidence-driven)
      ▼
PROCESS ENGINE — the SEQUENCING AUTHORITY
process_instance · process_step_execution · process_handoff
owns: order, gates, maker-checker, corrections, closure
      │ projected by (pure, exactly one)
      ▼
CANONICAL LIFECYCLE PROJECTION — the STATE OF RECORD for display
canonical 20 stages + monotonic ratchet + blocker overlays
owns: current stage, progress, responsible department, blockers
      │ rendered by
      ▼
ALL UI — dossier, cockpit, control tower, queues, portal, driver, copilot, reports
```

### Sources of truth — final

| Concern | Single source of truth | Repository anchor |
|---|---|---|
| Evidence | Module records + `document` | existing tables, ownership unchanged |
| Sequencing | Process engine step executions | `lib/process/engine/*` — CAS core ratified as-is |
| Lifecycle | Canonical projection over the 20-stage map | `CANONICAL_LIFECYCLE`, `lib/process/lifecycle-map.ts` |
| Progress | The projection's single formula (§8) | new in WES-2 |
| Ownership | The ownership model (§4) | `process_instance.owner_user_id` + `lib/process/ownership.ts` |

**Demoted to renderings** (their independent computations retire in WES-2):
`lib/files/lifecycle.ts` (15-step tracker), `lib/navigation/journey.ts` (x/26),
`lib/portal/progress-map.ts` (7-stage), `lib/driver/service.ts` (0/50/100),
`lib/process/journeys/milestones.ts`.

---

## 3. Workflow monotonicity

**RATIFIED.** A dossier may be blocked, may require correction, may reopen work — it shall **never
silently move backwards**.

- **Stage ordering** = the canonical 20 stages exactly as declared in `CANONICAL_LIFECYCLE`
  (CI-validated since 9.0B; `validateLifecycleMap()` fails the build on drift).
- **Ratchet:** a persisted per-dossier high-water stage, advanced by the projection, never silently
  decreased.
- **Blockers are overlays, not regressions.** Required rendering:

  ```
  Current stage:          Transport
  Status:                 Blocked
  Waiting for:            Corrected Commercial Invoice
  Responsible department: Documentation
  ```

- **Corrections** open work at the earlier department via the engine's existing
  correction-as-new-attempt mechanism (`correction_of_id`); the stage holds.
- **Reversal policy:** explicit action only — supervisor seat, mandatory reason, audit entry,
  visible reversal marker. This is the **only** path that decrements the ratchet. Soft-delete/revive
  status resets and handoff-trigger re-fires are defects, not reversals (fixed in WES-1).

---

## 4. Canonical ownership model

**RATIFIED.** Six permanently distinct concepts. Ownership ≠ assignment ≠ visibility ≠ responsibility.

| Concept | Purpose | Storage | Lifecycle | History |
|---|---|---|---|---|
| **Commercial owner** | client relationship, billing accountability | `operational_file.account_manager_id` | set at opening; transferable by audited action | assignment ledger |
| **Operational owner** | end-to-end coordination, closure accountability | `process_instance.owner_user_id` (canonical; `lib/process/ownership.ts` precedence during migration) | set at intake; transferable | assignment ledger |
| **Responsible department** | which department must act now | **derived** from the canonical frontier stage — never a column | moves with the projection | implicit in stage history |
| **Current workflow step** | the precise official step(s) open | `process_step_execution` | engine-managed | append-only attempts |
| **Current step assignee** | the person working the step | `process_step_execution.assigned_user_id` | task-based assignment (§6) | assignment ledger |
| **Current task** | the concrete work item | `task`, gaining a step-execution link | opened/closed by engine + humans | existing audit |

**Deprecated in meaning (not yet physically):** `operational_file.assigned_to_user_id` loses its role
as "the owner" and its role in visibility; it survives until WES-3 completes.
`transport_record.driver_name` loses all assignment meaning (§7).

**Authority:** the operational owner may reassign tasks and request reversals; department supervisors
hold intervention authority inside their department; **only the engine may move steps**.

---

## 5. Canonical visibility model

**RATIFIED**, with one amendment: "previous departments retain read-only history" is bounded to their
own contributions plus the dossier summary — not the whole dossier's later operational detail.

| Actor | Dossier summary | Operational detail | Act on step | Complete task | Reassign | Override |
|---|---|---|---|---|---|---|
| SYSTEM_ADMIN | ✅ | ✅ | ❌ (admin ≠ operator) | ❌ | ✅ | ✅ reasoned + audited |
| Responsible-dept member | ✅ | ✅ current dept scope | ✅ if assignee | ✅ if assignee | ❌ | ❌ |
| Dept supervisor | ✅ | ✅ dept scope | ✅ intervention | ✅ intervention (reasoned) | ✅ within dept | ❌ |
| Commercial / operational owner | ✅ | ✅ | per role | per role | ✅ | ❌ |
| Previous-dept member | ✅ | own-dept history only | ❌ | ❌ | ❌ | ❌ |
| Future-dept member | ✅ existence only | ❌ until responsibility arrives | ❌ | ❌ | ❌ | ❌ |
| DRIVER | ❌ | ❌ | ❌ | ❌ | ❌ | **missions only** |
| Portal client | customer-safe projection only | ❌ | ❌ | ❌ | ❌ | ❌ |

`file:read:all` holders (governance/analytics seats) are unchanged.
`user_readable_file_ids` is re-derived from this matrix in WES-3; task-anchored accidental visibility
and the single-slot column both retire.

---

## 6. Canonical assignment model

**RATIFIED.** People are assigned **tasks**; departments own **dossiers**; drivers own **missions**.

- **Reassignment** replaces the assignee on the task/step/mission and writes an assignment event.
  Department responsibility and dossier visibility are unchanged by reassignment.
- **Assignment ledger** (new in WES-3), append-only with `prevent_mutation` triggers — the
  `expense_visa` / `invoice_deposit_event` discipline reused:
  `(id, tenant_id, file_id, subject_type[COMMERCIAL_OWNER|OPERATIONAL_OWNER|STEP|TASK|MISSION],
  subject_id, previous_user_id, new_user_id, actor_id, actor_role_at_time, reason, step_key,
  policy_version, created_at)`.
- **Notifications:** new assignee always; previous assignee on removal; owner on any assignment
  inside their dossier. Reuses `createNotification` — no new notification engine.
- **Completion authority:** only the current assignee, or a supervisor recorded as a reasoned
  intervention. Engine maker-checker rules untouched.
- Assignments are **historical records, never overwrites**. The single-slot overwrite in
  `assignFile` retires.

---

## 7. Canonical transport architecture

**RATIFIED.** Dossier ≠ Mission, permanently.

- **Dossier** owns client, customs, finance, documents, commercial history.
- **Mission** owns driver (a **user link**, never free text), vehicle, route, ETA, GPS/tracking,
  pickup, delivery, POD capture.
- **Creation:** at **dispatch** — planning complete and the pickup gate satisfied
  (`evaluatePickupGate` remains the arbiter). Never implicitly by editing a form.
- **Cardinality:** one dossier → one **or more** missions (multi-leg, re-delivery, partial), with
  **at most one ACTIVE mission** as the ratified default.
- **Reassignment:** missions survive driver reassignment — the mission persists, the driver link
  changes via the assignment ledger. Missions are never deleted by reassignment.
- **Chauffeur portal** = mission list, mission detail, evidence capture, status milestones.
  **The chauffeur never works on a dossier.**
- **Dispatch responsibility:** the Transport department creates and assigns missions; field-team
  routing (`dispatchToField`, T9) is unchanged.
- **Mission availability is unconditional on tracking flags.** `TRACKING_ENABLED` gates GPS only,
  never the existence of a mission.

> Physical persistence of the Mission concept is **reuse-first** — see the refined ADR-WES-004 in
> the WES-0A addendum.

---

## 8. Canonical lifecycle & progress

**Progress — one formula, computed only inside the canonical projection:**

```
progress = completed applicable canonical stages ÷ applicable canonical stages
```

- Applicability comes from the existing registry (`customsLegOnly`, `lib/process/applicability.ts`).
- A stage is complete when its mapped step keys are done or deliberately skipped.
- **Blocked never subtracts.**
- Legacy dossiers carrying `UNVERIFIED_HISTORICAL` steps render the existing "inferred" disclosure
  rather than a fabricated number.

Every surface renders this value: dossier page, operations cockpit, control tower, chauffeur portal,
client portal, reports, copilot. The chauffeur's map position is **mission execution state, not
dossier progress**, and is renamed accordingly.

---

## 9. Canonical document architecture

**Three categories, permanently:**

- **Category A — external evidence** (Commercial Invoice, Packing List, BL, **BAE**, Customs
  Declaration, Supplier Invoice, signed POD): uploaded, versioned, **verified** internally, then
  consumed by rules.
- **Category B — internal operational documents** (Demande/Ordre de Transport, Mission Sheet,
  Dispatch Order, Internal Manifest): **generated, never uploaded** — see the refined ADR-WES-005 in
  the addendum for the full immutability contract.
- **Category C — operational structured data** (driver, vehicle, ETA, pickup, delivery, GPS, notes):
  structured columns only. **PDFs are views.** No workflow rule may ever read a PDF.

**Document workflow principle:**

```
Upload → Evidence available → Verification → Business rules evaluate → Workflow advances
```

An upload by itself advances nothing. The handoff triggers stop acting on "a document was approved";
the engine's evidence evaluator becomes the only consumer (WES-5).

**Vocabulary:** for Category A the internal act is **verification** (authenticity + completeness),
stored in the existing `APPROVED` state but labelled « Vérifié ».
*Effitrans never approves Customs; it verifies Customs evidence.*
**Supersession:** a newer verified version supersedes; rules always evaluate the latest verified
version; consumed versions are never deleted.

---

## 10. Canonical BAE governance

| Act | Seat | Anchor |
|---|---|---|
| Obtains + records BAE (reference + document) | **CUSTOMS_FIELD_AGENT** | step 13 `customs_field_clearance` — the registry already names it "the BAE authority" |
| **Verifies** BAE (authenticity + completeness; uploader ≠ verifier) | **CHIEF_OF_TRANSIT** | step-7 checker role extended to field evidence; maker-checker identity rule reused |
| Releases cargo operationally | **nobody by hand** — the pickup gate consumes verified BAE + transport readiness | `evaluatePickupGate` |
| Override | **SYSTEM_ADMIN only**: mandatory reason + audit row + explicit override marker | existing `customs_override` + engine override discipline |

**Consequence (WES-4):** `customs:release` narrows from six seats to the recorded chain.
OPS_SUPERVISOR, COORDINATOR and CUSTOMS_DECLARANT lose it. The Chef de Transit role description is
corrected from "validates … and releases" to "validates declarations; verifies release evidence".

---

## 11. Architecture Decision Records (WES-0 set)

**ADR-WES-001 — Department-Based Visibility.**
*Context:* visibility hangs off one overwritable column plus accidental task anchors; dossiers vanish
on reassignment. *Decision:* visibility derives from the §5 matrix — responsible department, owners,
supervisors, bounded history for previous departments; assignment changes never remove visibility.
*Consequences:* `user_readable_file_ids` re-derived; RLS suites re-pinned; queues stop shrinking on
reassignment. *Rejected:* per-user grant lists (unmanageable); everyone-sees-everything (violates the
finance/HR visibility precedents). *Future:* department dashboards become authorization-true rather
than cosmetic.

**ADR-WES-002 — Task-Based Assignment.**
*Context:* seven assignment slots; reassignment is an overwrite. *Decision:* people are assigned
tasks, steps and missions — never dossiers; department ownership is not a person.
*Consequences:* the dossier-level slot retires; absence is handled by supervisor task reassignment.
*Rejected:* keeping a "current holder" column as shorthand — it is the root cause of the
disappearing-dossier defect. *Future:* workload balancing and absence management become queries over
tasks.

**ADR-WES-003 — Canonical Ownership Model.**
*Context:* the 9.0A "three-headed ownership" grew a fourth head. *Decision:* the six-concept model of
§4, with the existing 9.0B precedence resolver as the migration bridge. *Consequences:* every reader
names which concept it displays; a fallback value is never written back. *Rejected:* collapsing
owners into one field — commercial and operational accountability genuinely differ. *Future:* a clean
seam for org-chart-driven routing.

**ADR-WES-004 — Mission-Based Transport.**
*Context:* one `transport_record` mixes planning, execution and two competing driver identities;
full-overwrite updates destroyed planning data. *Decision:* §7 — mission concept, user-linked driver,
dispatch-time creation, at most one active mission, missions survive reassignment.
*Consequences:* the chauffeur portal and tracking bind to missions; planning fields stop sharing a
write path with assignment. *Rejected:* patching `transport_record` in place with no separation
(leaves dossier and mission conflated); multiple concurrent active missions (no ratified business
case). *Future:* fleet/TMS features attach to missions without touching dossiers.
**→ Refined by WES-0A: the concept is mandatory, the physical table is reuse-first.**

**ADR-WES-005 — External vs Internal Documents.**
*Context:* BAE exists twice (document + customs field) with no link; internal sheets are hand-made.
*Decision:* Category A uploaded + verified; Category B generated only; a Category-A upload satisfies
the evidence slot referenced by the module record (BAE document ↔ `bae_reference`).
*Consequences:* generation reuses the existing report engine; uploading a Category-B type becomes
invalid. *Rejected:* treating all documents uniformly — that is how upload came to *mean* workflow.
*Future:* document intelligence plugs into verification, not into workflow.
**→ Refined by WES-0A: full immutability and regeneration contract.**

**ADR-WES-006 — Operational Data as Structured Records.**
*Context:* driver held as free text; PDFs at risk of becoming records. *Decision:* Category C data is
columns; every printable is a regenerable view; no rule reads an artifact.
*Consequences:* `driver_name` demoted to a display cache; mission sheets always reprintable.
*Rejected:* PDF-as-record — unauditable and unqueryable. *Future:* analytics and copilot read one
substrate.

**ADR-WES-007 — Single Lifecycle Projection.**
*Context:* five projections, four disagreements observed in testing. *Decision:* one pure projection
over the canonical 20 stages plus engine state plus blockers; all other projections become
renderings. *Consequences:* `getDossierLifecycle` inputs change from raw module rows to canonical
state; control tower, portal and copilot re-point. *Rejected:* reconciling five computations pairwise
— combinatorial drift forever. *Future:* the 11.0D pattern (one evaluator, many renderers) becomes
platform law.

**ADR-WES-008 — Single Progress Calculation.**
*Context:* five formulas. *Decision:* §8's formula, computed only inside the canonical projection.
*Consequences:* every percentage in the UI traces to one function; the mission display is renamed.
*Rejected:* per-surface "appropriate" percentages — that is the defect. *Future:* SLA and KPI engines
consume the same stage facts.

**ADR-WES-009 — Department Handoffs.**
*Context:* two handoff systems — advisory `task` rows (with the re-fire defect) and engine
`process_handoff` (explicit reception). *Decision:* the engine handoff with explicit reception is the
**only** handoff of record; handoff tasks become auto-closing notifications during migration and
retire in WES-5; a satisfied handoff can never re-open by side effect.
*Consequences:* trigger guards in WES-1; queue reception semantics unchanged.
*Rejected:* keeping both (proven divergence); silent auto-progression without reception (violates the
existing "nothing progresses silently" doctrine). *Future:* SLA timers hang off reception timestamps.

**ADR-WES-010 — Monotonic Workflow.**
*Context:* memoryless frontier scans regress on any evidence flutter; revive paths reset statuses.
*Decision:* §3 — ratchet, blocker overlays, and reasoned explicit reversal as the only decrement.
*Consequences:* high-water persistence; the projection reads it; a reversal action is added;
revive-resets are forbidden. *Rejected:* clamping the display only (a lie over an unstable
substrate); full event sourcing of all modules now (correct but disproportionate — the ratchet gives
the guarantee at a fraction of the cost). *Future:* event sourcing can still arrive under the same
contract.

**ADR-WES-011 — Documents as Workflow Evidence.**
*Context:* `onDocumentApproved` advances workflow directly, and late approvals re-fire it.
*Decision:* documents produce **evidence facts**; only rule evaluation advances workflow;
verification vocabulary per §9; BAE per §10. *Consequences:* triggers become idempotent evidence
notifications; `evaluateStepEvidence` is the sole consumer. *Rejected:* upload-driven advancement.
*Future:* OCR/docintel suggestions feed verification queues safely.

---

## 12. Implementation contract (WES-0 baseline)

> Superseded by the revised contract in the WES-0A addendum. Retained here as the ratification record.

| Phase | Scope | ADRs |
|---|---|---|
| WES-1 | Integrity hotfixes: partial-patch transport writes; forbid soft-delete of terminal records; revive keeps status; handoff re-fire guards; driver assignment decoupled from `TRACKING_ENABLED` | 004, 009, 010, 011 |
| WES-2 | Canonical projection + ratchet + one progress formula; reversal action | 007, 008, 010 |
| WES-3 | Assignment ledger; task/step/mission assignment; visibility matrix into `user_readable_file_ids` | 001, 002, 003 |
| WES-4 | Category A/B/C enforcement; verification vocabulary; BAE seat chain + grant narrowing; admin override marker | 005, 006, 011 |
| WES-5 | Evidence-driven engine/module reconciliation; handoff tasks retired | 009, 011, 007 |
| WES-6 | Mission entity + chauffeur portal rebind + task hygiene | 004, 002, 009 |

Each phase ships with the platform's standing gates: typecheck, full test suite, production build,
and CI RLS verified on GitHub.

---

## 13. Frozen bindings

Three decisions are **data-level bindings** frozen here. Management may re-ratify any of them later
through the decision register **without reopening this architecture** — exactly as the finance signer
map is data, not schema:

1. **BAE seats** — record: CUSTOMS_FIELD_AGENT · verify: CHIEF_OF_TRANSIT · release: the gate ·
   override: SYSTEM_ADMIN reasoned.
2. **Mission cardinality** — one or more per dossier, at most one ACTIVE.
3. **Future-department visibility** — summary only until responsibility arrives.

Two standing items sit outside WES scope and block nothing here: BLK-FIN-1/2 (finance visa signers)
and the 11.0C master template scan.

**Registered as:** DEC-B64 (decision register).
