# « Démarrer » rejection on EFT-IMP-2026-00007 — read-only diagnosis

**2026-08-23. Nothing mutated**; 00007 preserved as evidence. No permission
granted, no implementation.

## Verdict: an AUTHORIZATION defect, not a state-machine defect

The state machine is behaving exactly as designed. The engine authorizes step
execution by **one hard-coded permission** while the registry assigns
responsibility **per step with its own permission** — so the actor the registry
names as owner is categorically rejected.

## 1. Production truth for 00007

| Fact | Value |
| --- | --- |
| `coordinator_reception` execution | **AVAILABLE**, unassigned |
| `am_dossier_opening`, `operations_intake` | COMPLETED |
| handoff | RECEIVED (unchanged since 19:01:37) |
| chef.transit.demo · `process:manage` | **false** |
| chef.transit.demo · `process:handoff:receive` | true |
| chef.transit.demo · `customs:assign` | true |

F-1 is confirmed working: discovery and readability are fine. The failure is the
next click, not the visibility.

## 2. The exact rejecting guard

`Démarrer` → `queueStartStep` → **`activateStep(fileId, stepKey)`**
(`lib/process/engine/actions.ts:272`), whose first line is:

```ts
const c = await guard("process:manage", fileId);   // ← rejects here
```

`process:manage` is held by exactly **ACCOUNT_MANAGER, COORDINATOR,
OPS_SUPERVISOR, SYSTEM_ADMIN**. CHIEF_OF_TRANSIT does not hold it, so `guard`
returns `forbidden`, which the queue renders as « Action non autorisée. »

Step 4's own registry declaration is `permissions: ["process:handoff:receive",
"process:handoff:send"]` — **and the actor holds the first one.** The engine
never consults it.

**The engine is internally inconsistent about this.** `approveStep` already does
the right thing:

```ts
const permission = getNode(validatorStepKey)?.permissions[0] ?? "process:manage";
```

`activateStep` and `submitStep` do not — they hard-code `process:manage`.

## 3. Scope — far beyond step 4

Cross-referencing the registry's owning role against `process:manage` holders:

**17 of 26 official steps cannot be started or submitted by their own owning
role**, across **12 roles**:

```
 1 cotation                     QUOTATION_MANAGER        registry perm: quotation:create
 4 coordinator_reception        CHIEF_OF_TRANSIT         process:handoff:receive
 5 transit_declarant_assignment CHIEF_OF_TRANSIT         customs:assign
 6 customs_preparation          CUSTOMS_DECLARANT        customs:create
 7 transit_validation           CHIEF_OF_TRANSIT         customs:validate
 9 gainde_registration          CUSTOMS_FINANCE_OFFICER  customs:register
11 gainde_document_submission   CUSTOMS_DECLARANT        customs:update
13 customs_field_clearance      CUSTOMS_FIELD_AGENT      customs:release
14 transport_assignment         TRANSPORT_OFFICER        transport:assign
15 pickup                       PICKUP_AGENT             transport:update
20 billing_draft                BILLING_OFFICER          finance:create
21 finance_invoice_validation   FINANCE_OFFICER          finance:validate
22 billing_dispatch             BILLING_OFFICER          finance:issue
23 administration_deposit_prep  ADMINISTRATIVE_OFFICER   admin_service:manage
24 courier_deposit              COURIER                  courier:deposit
25 administration_proof_handoff ADMINISTRATIVE_OFFICER   admin_service:manage
26 collections                  COLLECTIONS_OFFICER      collections:manage
```

In every case the owning role **holds the registry's declared permission** for
that step and lacks only the generic `process:manage`. The Finance lane is fully
inside this set (20, 21, 22, 23, 24, 25, 26), so **the governed billing lane
would fail at the same wall** — this blocks Tuesday just as FD-1 did.

## 4. UI ⇄ server authority asymmetry (confirmed)

`components/process/queue-row-actions.tsx:65`:

```ts
const can = (a: string) => queue.actions.includes(a as never);
```

The button is offered on the basis of **which queue definition this is** — never
on the caller's permissions. So every viewer of the Transit queue is offered
« Démarrer » on an AVAILABLE row, and the server then categorically refuses most
of them. A surface promising an action its destination will always reject: the
same class as `/departments/queue` advertising unopenable dossiers.

## 5. Intended Step-4 semantics — reconciled, not inferred from labels

| Source | Says |
| --- | --- |
| `receiveHandoff` (engine comment) | « EXPLICIT RECEPTION. Nothing progresses silently: the receiving department must confirm it has the dossier, **and only then does the target step open**. » |
| `receiveHandoff` (code) | sets handoff → RECEIVED; target step PENDING → **AVAILABLE**. Never COMPLETED. |
| `receiveDossierAtTransit` | `receiveHandoff` + audit + notify Operations owner. Adds no completion. |
| Registry step 4 | `completionRule: handoff_received_and_forwarded`, `nextSteps: [transit_declarant_assignment]`, `requiredDocuments: []` |
| Lifecycle map | step 4 sits in « Réception Transit » and in T1 alongside step 5 |
| Queue classifier | `receptionRequired && !received` → « À réceptionner »; afterwards it is ordinary AVAILABLE work |

**Conclusion: reception OPENS step 4; it does not complete it.** That is the
designed, tested and documented behaviour, and a separate Démarrer/Soumettre is
therefore correct. **This defect is not a state-machine defect and no
state-machine change is proposed.**

One observation recorded, deliberately **not** acted on: since Transit now both
sends-to and receives step 4, the step's original second half (« puis transmettre
au Chef de Transit ») no longer has a distinct actor, so completing step 4 is
close to a second confirmation of the same act. That is a **process-design
question for Effitrans**, not a defect — the state machine is coherent either
way, and collapsing it would change ratified step semantics.

## 6. Smallest authoritative fix (proposed, not implemented)

**A-1 — authorize step execution by the step's own registry permission**, which
is what `approveStep` already does. In `activateStep` and `submitStep`:

```ts
const permission = getNode(stepKey)?.permissions[0] ?? "process:manage";
const c = await guard(permission, fileId);
```

`process:manage` remains the fallback for nodes that declare none, so managerial
roles lose nothing and no permission is granted to anyone. It aligns three
authorities that already agree — registry ownership, F-1 visibility, and the
queue that shows the work — with the guard that was the odd one out.

**A-2 — make the UI predicate honest.** `queue.actions.includes(...)` must be
ANDed with the caller's effective permission for that step, so a button is never
offered to someone the server will reject. Requires passing the caller's
permissions (or a precomputed per-row capability) into the row component.

**Regression coverage to ship with it:** owning role can start/submit its own
step (parameterised over all 17 affected steps); a role without the step's
permission is refused; `process:manage` holders keep working; the fallback
applies where a node declares no permission; maker-checker on identity is
untouched; the UI predicate hides what the server would refuse.

**Mutations:** revert to hard-coded `process:manage` (must fail); drop the
fallback (must fail); use `permissions[1]` instead of `[0]`; drop the UI
permission conjunct; grant-by-role instead of by-permission.

**Not proposed:** granting `process:manage` to operational roles. That would give
twelve roles blanket process-management authority over every step — precisely the
blunt-permission pattern F-1 was built to stop.

---

**Awaiting approval. Nothing implemented. 00007 untouched.**
