# WES-5 — Module / Process-Engine Reconciliation

**Date:** 2026-07-27 · **Migration:** `20260727000005_process_reconciliation` (67th)
**Depends on:** WES-2 (projection) · WES-4/4G (evidence doctrine) · WES-7 (policy) · WES-9/9A (atomic events)

The doctrine, now implemented:

> module facts → evidence evaluation → deterministic reconciliation
> → process-step state → canonical projection → tasks and handoffs

---

## 1. The questions, answered

| Question | Answer |
|---|---|
| **What completes each process step?** | For the five fact-provable steps: the authoritative module fact, applied through one atomic RPC. For every other step: a human, through the engine's submit/approve flow — unchanged. |
| **What cannot complete it?** | A task being ticked. A document being uploaded. A reconciliation over a pending maker-checker review. Anything at all over a human REJECTED/CANCELLED decision. |
| **When is evidence required?** | At its doctrine stage, and never earlier. A POD is transport-stage evidence; a BAE is customs-stage evidence. `missingDocumentationEvidence` is the one answer every assembler uses. |
| **What moves the dossier to the next department?** | The canonical projection over reconciled facts — same WES-2 ratchet, same single formula. Handoffs remain the existing engine/trigger paths (see §6). |
| **When module and process states disagree?** | `CONFLICT` — returned by the service, never silently resolved. A step marked done whose fact is absent stays visible as a contradiction until a person with authority acts. |
| **What happens to old dossiers?** | Nothing is fabricated. A dossier without a process instance reconciles nothing (`unmatched` reports the satisfied-but-unrepresented steps). Legacy runs mark `LEGACY_RECONCILED` with today's timestamp — no historical business time is claimed. |
| **What remains manual?** | Every review, validation, reception and maker-checker decision; conflict resolution; process-instance initialization; handoff governance. |

---

## 2. The fact matrix

Fact-provable steps — the complete set, deliberately short. Every entry survived the
question *"could this step mean anything other than this fact?"*:

| Step | Authoritative source | Completion condition | Fact code |
|---|---|---|---|
| `am_dossier_opening` | `operational_file.status` | left DRAFT (not CANCELLED) | `FILE_OPENED` |
| `gainde_registration` | `customs_record` | status ≥ DECLARED **and** declaration number recorded | `CUSTOMS_DECLARED` |
| `customs_field_clearance` | `customs_record.status` | `RELEASED` (recorded via the WES-4 split, with a BAE reference) | `CUSTOMS_RELEASED` |
| `pickup` | `transport_record.status` | ≥ `PICKED_UP` (the ladder is monotonic) | `TRANSPORT_PICKED_UP` |
| `transport_pod_handoff` | POD document / transport | verified current POD **or** `POD_RECEIVED` | `POD_RECEIVED` |

**Human-only, and why** (a sample; absence from the matrix is the default):

| Step | Why no fact can prove it |
|---|---|
| `transit_validation`, `finance_invoice_validation` | Maker-checker reviews — a person's judgement **is** the deliverable. |
| `coordinator_reception`, `coordinator_to_*` | Explicit receptions; policy may require them to be explicit. |
| `billing_draft`, `courier_deposit`, `collections` | **Already engine-integrated** — their module actions call `submitStep` themselves (Phase 5.0D). A second completion path here would recreate the dual authority WES-5 removes. |
| `transport_assignment` | A driver *name* on a row is not an assignment decision; WES-3's atomic path records assignments. |

---

## 3. The POD defect — fixed

**Before:** every assembler computed `missingRequired = required_for(type) − approved`.
A POD (`DELIVERY_NOTE`, due at the transport stage) counted as missing from day one;
`docsVerified = missing === 0` kept Documentation incomplete until delivery.

**After:** one canonical helper, `missingDocumentationEvidence`, answers *"what blocks
documentation?"* through the WES-4C stage-aware resolver with the stage fixed at
`documentation`. That set is static per document type, so there is no circularity with
the current stage.

Consequences, stated because they change behaviour for existing dossiers (ratified —
WES-4 deferred exactly this wiring to WES-5):

- a missing POD no longer blocks Documentation;
- `CUSTOMS_DECLARATION` (customs stage) no longer gates documentation — customs steps are
  gated by `customs_record.status`, the module fact;
- `TRANSPORT_ORDER` (internal artifact) gates nothing — generated artifacts are not
  external evidence;
- rejected/superseded versions never satisfy; verified, legacy-`APPROVED` and
  `CONSUMED_AS_EVIDENCE` versions do;
- `docsVerified` can flip true earlier, which advances `responsibleDepartment`, which
  changes WES-3 visibility and the department queue for affected dossiers.

**Wired everywhere** — one resolver, one answer, test-pinned across all six assemblers:
`documents/service` (dossier page + copilot), `control-tower`, `portal/shipments`,
`portal/tracking`, `workflow/access/service`, `workflow/access/queue`.

---

## 4. The transactionality model

Module facts are already atomic (WES-9/9A: fact + event in one transaction).
Reconciliation is **convergent**:

- it runs *after* the fact (wired into customs release, transport transitions and
  document verification), is **idempotent**, and never throws into the module action;
- every write **it** makes is atomic: step transition + evidence consumption + business
  event in one RPC (`reconcile_step_completion`);
- a failed run changes **nothing** — partial workflow history cannot exist;
- a crash between fact and reconciliation leaves the fact recorded and the step briefly
  stale; the next run converges. That bounded lag is the accepted cost of not welding
  every module to the engine schema.

The RPC's refusals, enforced in SQL where no caller can forget them:
`SUBMITTED` (maker-checker pending) raises · `REJECTED`/`CANCELLED` (human decision)
raises · `COMPLETED` returns `already=true` and writes nothing · the execution row is
locked (`FOR UPDATE`) against concurrent runs · an empty fact code raises.

---

## 5. Evidence consumption (WES-5D)

`evidence_consumption` — append-only, `prevent_mutation`, no FK to cascading tables —
records the **exact document version** (id, version, content hash) a step relied on,
under which pinned policy, deduplicated at the database
(`UNIQUE (step_execution_id, document_id)`).

The consumed document moves `VERIFIED → CONSUMED_AS_EVIDENCE` (forward-only; any other
status is left alone). Later supersession never erases the consumption record — history
does not un-happen. Automatic correction on supersession is **not** implemented: it is a
conflict for a person, not a silent regression (§8).

---

## 6. Handoffs and tasks — what was deliberately left alone

Handoff creation stays with the existing engine paths (`sendHandoff` with WES-1
idempotency) and the Phase 2.1 triggers (`onCustomsReleased`, `onPodReceived`,
`onDocumentApproved`), which already create their tasks idempotently. Reconciliation
completes *steps*; it does not open a second handoff-creation authority. Task
auto-closure was likewise not built: a task manually completed before the fact exists
still completes **no** step (nothing in the satisfaction model reads tasks — test-pinned),
and closing tasks under a reconciliation actor would invent who did the work.

---

## 7. Events (WES-5L)

New domain `process`, new source `reconcile_rpc`, two RPC-backed types:

- `PROCESS_STEP_COMPLETED` — metadata: `workflow_step_key`, `reason_code` (the fact
  code), `is_override` (legacy reconciliation);
- `EVIDENCE_CONSUMED` — metadata: `workflow_step_key`, `artifact_version`.

**Not added, and why:** `PROCESS_STEP_CONFLICT_DETECTED` / `RECONCILIATION_*` — conflicts
are returned by the service; emitting them on every idempotent re-run would duplicate
without a dedup key, and an unreliable event is worse than none. WES-9's rule stands: no
event without an authoritative, atomic action behind it.

---

## 8. Conflicts (WES-5I)

`evaluateStep` reports `CONFLICT` when the engine says COMPLETED/APPROVED and the fact is
absent. The service returns them (`result.conflicts`) and touches nothing. No broad
reversal UI is built (not ratified); resolution remains a governed human action through
existing engine paths. Conflict *persistence* (a durable review queue) is deferred — the
result is recomputable on every run, so nothing is lost, but nothing pages anyone either.
That is a known limitation, not a claim.

---

## 9. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3912 passed / 171 files** (41 new) |
| Production build | compiled |
| SQL/RLS suites | **54** wired in CI (was 53), parser-verified one-to-one |
| Migrations | 67 · clean replay in CI |
| Seed | unchanged |

The RLS suite proves, on live Postgres: atomic completion (step + consumption + event),
idempotent re-run (no new event, no new consumption), SUBMITTED and REJECTED refusals,
exact-version consumption, consumption immutability, event-failure rollback of the whole
unit, tenant and portal isolation.

---

## 10. Known limitations

1. **Five steps are fact-provable; the rest stay manual.** Deliberate — the model can
   under-automate, never over-automate. Widening the set is a per-step ratification.
2. **Conflicts are reported, not persisted.** No durable review queue, no conflict event
   (§7, §8).
3. **No reconciliation UI.** The dossier page already shows the projection, blockers and
   the event timeline (which now carries `process` events); a dedicated
   satisfied/conflict panel was not built this session.
4. **Legacy dossiers without a process instance reconcile nothing.** `unmatched` reports
   what the facts would prove; no instance is fabricated. A governed backfill (engine
   initialization for legacy dossiers) remains a separate operator decision.
5. **Reconciliation is wired into three module paths** (customs release, transport
   transitions, document verification). Other fact sources (e.g. dossier opening) reach
   the engine on their next reconciliation via any of those triggers or a future manual
   action — `am_dossier_opening` mostly matters for legacy runs.
6. **Evidence supersession after consumption** surfaces as a conflict candidate only via
   recomputation; no automatic correction/blocker record is created.
