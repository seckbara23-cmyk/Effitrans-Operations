# Step 3 deadlock on EFT-IMP-2026-00008 — diagnosis (read-only)

**2026-08-24. Nothing implemented, nothing mutated.** 00008 untouched; 00007
remains contaminated evidence.

## A. Canonical expected sequence (registry, verbatim)

* **Step 2 `operations_intake`** — OPERATIONS_MANAGER→OPS_SUPERVISOR; the ENTRY
  step. « Ouvrir le dossier » (`openDossierWorkflow`) instantiates all 26
  executions (PENDING), skips cotation with a derived reason, and drives step 2
  `PENDING → AVAILABLE → ACTIVE` via `activateEntryStep`. **Deliberately leaves
  it ACTIVE** — the supervisor still performs the intake work and **Soumet** it.
* **Step 3 `am_dossier_opening`** — stepNumber 3, role ACCOUNT_MANAGER,
  `prerequisites: ["operations_intake"]`, clientStage `documentation_in_preparation`.
  The AM opens/prepares (transport request, BL, factures tierces, autorisations)
  then « Transmettre au Coordinateur » — i.e. the Transit handoff **follows**
  step 3.
* **Step 4 `coordinator_reception`** — `prerequisites: ["am_dossier_opening"]`;
  opened by explicit reception; its activation enforces prerequisites.

So canonically: **create → open (2 ACTIVE) → supervisor submits 2 → AM performs 3
→ transmit → Transit receives → Transit works 4.**

## B. Actual state of 00008 (live rows)

| Fact | Value |
| --- | --- |
| `operations_intake` | **ACTIVE**, assigned (the process owner) — never submitted |
| `am_dossier_opening` | **PENDING**, unassigned |
| `coordinator_reception` | AVAILABLE (promoted by reception), unassigned |
| `cotation` | SKIPPED |
| handoff | SENT→RECEIVED into `coordinator_reception` |
| Responsable client | designated to account.manager.demo (notification delivered) |

Transit's refusal is CORRECT: `activateStep(coordinator_reception)` enforces
`prerequisitesMet` and step 3 is not done. Invariant 5 is being honoured by the
engine; the defect is upstream of it.

## C. Root cause — a combination, precisely located

**RC-1 (architectural, primary): the state machine has no successor promotion.**
`PENDING → ACTIVE` is illegal (`ALLOWED_STEP_TRANSITIONS`); only `PENDING →
AVAILABLE` is legal, and exactly **two** writers of AVAILABLE exist in the entire
engine: `activateEntryStep` (entry steps only) and `receiveHandoff` (handoff
targets only). **Nothing promotes a completed step's `nextSteps`.** Therefore
every non-entry, non-handoff-target step — step 3 first among them — can never
leave PENDING through any legitimate path. And since queues/my-work list
OPEN_STATES ∪ handoff-targets (never bare PENDING), such a step is also
**invisible everywhere**. Step 3 was not filtered out of the queues; it was never
eligible to be in them. It exists in the database (instantiation is fine),
correctly attributed to ACCOUNT_MANAGER, with AM eligibility correct under A-1 —
it is simply unreachable. *(This also explains why notification succeeded while
routing failed: « Dossier confié » comes from the designation act, a different
subsystem that is working correctly — Invariants 2/3/4 are NOT violated anywhere;
creator, Responsable client, process owner and step assignee remain distinct and
nothing auto-completes anything.)*

**RC-2 (sequencing): transmission does not require its from-step.**
`handDossierToTransit` refuses only on intake blockers, then calls
`sendHandoff("am_dossier_opening" → "coordinator_reception")` without checking
that `am_dossier_opening` is COMPLETED. **Determination of the intended
invariant — B, from the canon, not the UI:** the handoff's own `from_step_key`
IS step 3; step 3's description ends « Transmettre au Coordinateur »; step 4's
prerequisite is step 3; and the lifecycle map places « Transmission au Transit »
after the preparation stage that contains step 3. Early transmission (option A)
is not an intended overlap — it is unguarded sequencing that manufactures
precisely this deadlock: Transit legitimately holds a dossier nobody can work.
*(Secondary observation, consistent with B: `receiveHandoff` promotes the target
step to AVAILABLE without checking the target's prerequisites — harmless once B
holds, because an early handoff can no longer exist.)*

**RC-3 (my runbook error): T2 claimed « Ouvrir le dossier » completes step 2.**
It only ACTIVATEs it — deliberately (§A). The walk therefore never submitted
step 2, which alone would have stalled step 3 even with RC-1 fixed. Corrected in
the runbook alongside this diagnosis.

*(Historical note: 00007's steps 2–3 show COMPLETED with `started_at` null —
driven by the operator under pre-A-1 permissions through a path that no longer
exists for ordinary actors. That dossier's early progress masked RC-1.)*

## D. Minimal architectural fix (proposed — NOT implemented)

**D-1 — successor promotion on completion (closes RC-1).** One helper in the
engine — `promoteSuccessors(instance, completedStepKey)` — called at the three
completion sites (`submitStep`'s COMPLETED branch, `approveStep`, `skipStep`):
for each `nextSteps` execution, CAS `PENDING → AVAILABLE` **only if
`prerequisitesMet`**. Uses the already-legal transition; parallel branches
converge naturally (a successor with another unmet prerequisite stays PENDING);
no permission, no gate, no queue logic changes. Steps become visible in
`/my-work` and their queue the moment they truly become someone's turn —
Invariant 6 by construction. *(Backfill for in-flight dossiers: none needed —
completing the currently-ACTIVE step after deploy promotes its successors; 00008
recovers through the UI: supervisor submits 2 → 3 becomes AVAILABLE → AM works
3 → Transit's Démarrer passes. No SQL, no special-casing.)*

**D-2 — transmission requires its from-step (closes RC-2, encodes invariant B).**
`handDossierToTransit` refuses unless `am_dossier_opening` is done
(`isDone(state)`), error `am_opening_incomplete`; and
`unmetTransitHandoffPrerequisites` (the existing UI resolver) adds the reason
« L'étape 3 — ouverture et préparation par l'Account Manager — n'est pas
terminée. » The button then tells the truth instead of arming a deadlock.

**Explicitly not done:** no auto-complete of step 3 on designation (Invariant 4),
no Transit-gate weakening, no 00008 special-case, no second AM workflow.

## E. Regression & mutation coverage (to ship with D)

* completing step 2 promotes step 3 to AVAILABLE; with a second unmet
  prerequisite the successor stays PENDING (parallel-branch safety);
* the chain: open + designate → step 3 visible in `/queues/account_management`
  and `/my-work` « À faire » → AM Démarrer (ACTIVE, started_at, assignee) →
  Soumettre → step 4 activation prerequisites satisfied;
* designation of Responsable client alone changes NO step state (Invariant 4);
* `handDossierToTransit` refuses `am_opening_incomplete` until step 3 is done;
  the UI resolver lists it; after step 3, transmission succeeds;
* skip path: a SKIPPED prerequisite (cotation) still counts as done for
  promotion — the entry chain keeps working;
* mutations: remove the promotion call (must fail); promote without the
  prerequisite check (must fail); restore transmission-without-step-3 (must
  fail); auto-complete step 3 on designation (must fail); promote to ACTIVE
  instead of AVAILABLE (illegal transition — must fail).

---

**STOP — awaiting approval before implementing D-1 + D-2.** 00008 recovery path
is UI-only and needs no repair of any kind once D-1 ships.
