# D-1 first production execution — crash diagnosis (read-only)

**2026-08-24. Nothing mutated, nothing repaired.** 00008 untouched since the
operator's single click; 00007 remains contaminated and unused.

## E. Conclusion first: **A — the mutation committed correctly; the request failed AFTER every write, in the promotion's audit attribution.**

## A. Live state after the single « Soumettre » (all read-only)

| Row | State | Detail |
| --- | --- | --- |
| `operations_intake` (step 2) | **COMPLETED** | `submitted_by` = ops.supervisor.demo, `submitted_at` = `completed_at` = 16:55:14.612Z — exactly one submission |
| `am_dossier_opening` (step 3) | **AVAILABLE** | **D-1 promoted it**, unassigned — precisely as designed |
| `coordinator_reception` (step 4) | AVAILABLE | untouched |
| handoffs | **1** | no duplicate, no new handoff |
| audit | `process.step.completed` @16:55:14.799 (actor set) | **and ZERO `process.step.activated` rows** — the promotion is real but unaudited |

No partial commit, no inconsistency: every DB write of the click is present and
correct. The only missing artifact is the promotion's audit row — which is also
the fingerprint of the exception.

## B/C. The exact failure, located in code (no log access needed)

Sequence inside the one request:

1. `submitStep` CAS: step 2 → COMPLETED ✔ *(16:55:14.612)*
2. `writeAudit(PROCESS_STEP_COMPLETED)` ✔ *(16:55:14.799)*
3. `promoteSuccessors` → CAS step 3 `PENDING → AVAILABLE` ✔ *(row proves it)*
4. `writeAudit(PROCESS_STEP_ACTIVATED, actorId: null, …)` → **THROW** —
   `validateAuditEvent` (`lib/audit/validate.ts:84`) fails closed:
   *“actorId, clientUserId, or platformActorId is required for non-system
   action”* — `process.step.activated` is not a system action, and **I passed
   `actorId: null`** in `promote.ts`.
5. The exception propagates out of the server action **after all writes** → the
   error boundary replaces `/queues/operations`: « Une erreur est survenue ».

So the failure is **category 3**: after successful commit, during the tail of the
action — not before the commit, not in the CAS, not in render logic per se.

**Two of my own defects compounded here, and both deserve naming:**

* **D-α — unattributed audit.** I wrote `actorId: null` for the promotion event.
  The platform's own doctrine (RATIFY-OPSSEC2-2A: a NULL actor carries no
  authority; audit is attributed or refused) is enforced by `validateAuditEvent`,
  and it did exactly its job. The promotion has a real, correct principal: **the
  actor whose completion caused it** — I simply failed to pass it through.
* **D-β — a promised contract I never implemented.** `promote.ts`'s header says
  « Best-effort by contract: promotion failures never fail the completion that
  triggered them. » There is **no try/catch in the function.** The comment made a
  promise the code does not keep — and my 18 tests did not catch it because they
  are text pins over the source; none *executes* `promoteSuccessors` against the
  real audit validator. A runtime unit test would have failed instantly.

## D. Safety confirmed

Nothing resubmitted, promoted, edited, special-cased, weakened or repaired. The
one permanent scar of this incident is that **step 3's promotion on 00008 has no
audit row** — recorded here as a known gap in that dossier's trail rather than
patched by hand.

## Smallest invariant-preserving fix (proposed — NOT implemented)

**F-α — attribute the promotion to its true principal.** `promoteSuccessors`
gains an `actorId` parameter; each caller passes the identity that performed the
completing act (`c.userId` / `ctx.userId`). No fake principal, no new system
action, and the fail-closed audit validator is satisfied because the attribution
is genuine: the promotion IS a consequence of that actor's completion.

**F-β — make the written contract true, without weakening audit doctrine.** Wrap
each successor's promotion in the loop with: on audit failure, **revert that
promotion's CAS** (`AVAILABLE → PENDING` — a legal transition) and continue. The
completion that triggered promotion is a committed fact and never fails; and no
*unaudited* promotion survives, so the audited-or-not-at-all rule holds. The next
completion (or a later retry) re-promotes idempotently.

**F-γ — a runtime regression, not a pin.** A unit test that CALLS
`validateAuditEvent` with the exact event shape `promoteSuccessors` emits — so an
unattributed audit in this path can never compile-and-pass again — plus mutation
coverage: `actorId: null` restored (must fail), the revert-on-audit-failure
removed (must fail).

**00008 recovery after the fix:** none needed for steps 2–3 — they are already
correct. The walk resumes at the Account Manager (step 3 is AVAILABLE and
visible). The error the operator saw will not recur because the next promotions
will be attributed.

**Tuesday remains RED. This UAT click is a production-defect finding, not a
passed D-1 proof — even though the state machine itself behaved perfectly.**

**STOP — awaiting approval for F-α + F-β + F-γ.**
