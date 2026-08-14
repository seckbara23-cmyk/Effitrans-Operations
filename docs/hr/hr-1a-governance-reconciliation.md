# EFFITRANS-HR-1A — governance decisions reconciliation

**Date:** 2026-08-14 · **Baseline:** `199bf88` (CI #467 GREEN) · **Audit only — no grant, no activation, no RLS change, nothing mutated.**

## The verdict in one paragraph

The ratified answers **can** be expressed safely — but **not by grants alone**.
The flat `hr:leave:approve` / `hr:performance:finalize` permissions are
tenant-wide: granted to a "manager" role they would let any department manager
approve any department's leave, which is exactly the cross-department risk the
brief names. The scoped half of both answers needs **one narrow engineering
slice each**, because the model already knows every employee's manager
(`employee_assignment.manager_employee_id`) but nothing yet reads it as an
authorization scope. Bulk import is authorized but its final stage **does not
exist in code — deliberately** ("THE PIPELINE STOPS AT READY"), so activation is
engineering, not a flag. And one ratified answer meets a structural rule already
in the database: **the finalizer of an evaluation must differ from the manager
who reviewed it (HR616, enforced in the RPC)** — so a department manager can
finalize evaluations in their scope *except the ones they themselves reviewed*.

---

## 1. Business decision → technical authority mapping

| Effitrans said | Platform reality (verified today) | Class |
|---|---|---|
| CEO approves leave, org-wide | Role `CEO` exists — **6 members in production** (the multi-role admin accounts) | **D** (grant) — with a flag: 6 accounts inherit it |
| Direction approves/finalizes, org-wide | Roles `DGA` and `DAF` exist — **0 members each** | **D** (grant; inert until staffed) + **E** (who is Direction?) |
| Department Managers, scoped | **No role exists**, and none should: the HR-native concept is `employee_assignment.manager_employee_id` (per-employee, effective-dated). `hr_org_unit` has **no manager column** — there is no "manager of a department", only managers of employees | **C** — scope enforcement must be built |
| Bulk import: YES | Pipeline built through the four-eyes visa; **no apply action exists, by design** | **C** — build the application stage |
| Second HR Officer | Pending designation | **E** — unchanged |
| Payroll / sensitive | No new decision | **F** — DEC-B63 stands |

## 2. Role codes, verified — not guessed

* `CEO` — exists, 6 members. Every one is a broad multi-role account
  (`aminata@…` ×2, `it@…` ×2, …). **Granting `hr:leave:approve` to `CEO` today
  gives six accounts organization-wide leave approval.** Effitrans should
  confirm that is intended, or Direction should be the org-wide seat.
* `DGA`, `DAF` — exist, **0 members**. The natural "Direction" seats; a grant is
  inert until someone is assigned.
* Department Managers — **no role**, and `OPS_SUPERVISOR` is *not* it (that is
  operational supervision of dossiers, not HR authority over people). Inventing
  a `DEPARTMENT_MANAGER` role would duplicate what
  `manager_employee_id` already records, per placement, with history.

## 3. Does departmental manager scope already exist?

**As data, yes. As authorization, no.**

* `employee_assignment.manager_employee_id` — each placement names its manager.
* `hr_evaluation.manager_employee_id` — each evaluation names its manager.
* `decideLeaveRequest` checks **only** `assertPermission("hr:leave:approve")` +
  the DB maker-checker (you cannot decide your own request). **No scope check
  of any kind** — the permission is the entire boundary.
* Same shape for finalization: flat gate, then the RPC's actor-separation rules.

So the current model can say *who your manager is* but cannot yet say *only your
manager (or Direction) may approve you*.

## 4. HR-B1 — leave approval, exact design (class C + D)

**Two lanes, one act:**

1. **Org-wide seats (grant only).** `hr:leave:approve` → the Direction roles
   Effitrans confirms (`DGA`, `DAF`, and `CEO` if the 6-member finding is
   accepted). Three sources as always (migration + seed + role template).
2. **Manager lane (engineering).** In `hr_decide_leave_request` (the RPC — the
   database is the boundary, per INV-7 doctrine): resolve the actor's linked
   employee via `employee.linked_app_user_id`, and allow the decision when that
   employee **is the requester's current `manager_employee_id`** — else require
   the org-wide permission. The existing maker-checker (never your own request)
   is preserved on both lanes.

Consequences to state up front: a manager must have an **application account
linked to their employee record** to use the manager lane (the link that
deliberately grants nothing elsewhere becomes load-bearing here — by design,
since it proves identity, not authority); and an employee whose current
assignment has no manager can only be approved by an org-wide seat.

**Cross-department risk: closed by construction** — the manager lane compares
against the requester's own assignment row; a Finance manager simply *is not*
the `manager_employee_id` of a Transit employee.

## 5. HR-B2 — performance finalization, exact design (class C + D, with one structural fact)

Same two lanes on `hr_finalize_evaluation`. But the database already enforces
**HR616**: *« séparation des acteurs : le finalisateur doit différer de
l'évaluateur »* — the finalizer must not be the manager who submitted the
review. This is the four-actor separation the performance migration announces
(« Self-assessment, manager review, HR finalization and acknowledgment are four
recorded actors »), and it must **not** be weakened to fit the new answer.

The reconciliation is honest and workable: a department manager may finalize
evaluations in their scope **except those they reviewed themselves**; those go
to Direction (or any other authorized finalizer). With CEO + DGA + DAF + managers
as candidate finalizers, someone distinct always exists. If Effitrans intended
managers to finalize *their own* reviews, that is a request to repeal HR616 —
**a business decision (E), not a default**.

## 6. HR-B3 — bulk import activation, exact path (class C)

`organization-actions.ts` says it in its own header: *« THE PIPELINE STOPS AT
READY. There is deliberately NO apply/activate action »*. Activation is
therefore **application code** (plus likely one RPC — the apply must consume
matricules through the same `next_employee_number` engine and validate targets
through `validateAssignmentTargets`, never a parallel path). No flag exists; no
configuration unlocks it; no migration is required for authority (the pipeline
runs under `hr:manage`, already granted).

**Four-eyes is preserved and already enforced**: `approveHrImport` refuses
`submitted_by === approver` (`same_actor`). So with today's single officer:

* **CAN today**: upload → stage → validate → map → submit (maker half).
* **CANNOT until the 2nd officer exists**: approve (checker half) — hence
  nothing reaches READY.
* **CANNOT until HR-B3 is built**: apply — READY is the pipeline's last state.

Answer to §C's question: **yes, imports can be fully prepared before the second
HR Officer exists, and cannot be finally applied** — first for lack of the
second visa, then for lack of the apply stage.

## 7. Blocked on the second HR Officer (unchanged, now with exact edges)

While one officer exists: import approval (`same_actor`), contract verification
visa (verifier ≠ preparer CHECK). The moment the second officer is assigned via
the existing Administration screen: both complete immediately — no deploy, no
migration. The Ops Center banner clears itself (`countHrOfficers`).

## 8. HR-B0 reconfirmed — configuration/data only (class D)

Unchanged from HR-1: numbering → units → positions → sites → **one genuine
employee, manually** → optional account link → onboarding/equipment. Nothing in
today's findings adds a prerequisite. Creating one real employee first also
makes HR-B1's manager lane testable with real data instead of synthetic rows.

## 9. Migration / RBAC / RLS implications

* HR-B1/B2 grants: **one migration** (×3 sources) when the seats are confirmed.
* HR-B1/B2 scope checks: RPC changes (SECURITY DEFINER, INV-7 applies to any
  caller-declared actor) — **no RLS change**; the actions/RPCs are the boundary,
  as established by HR-A2.
* HR-B3: application code + one apply RPC; **no permission change** (`hr:manage`
  already covers the pipeline; the four-eyes rule supplies the control).
* Nothing here touches `hr:sensitive:read` or payroll. DEC-B63 undisturbed.

## 10. Roadmap (dependency-ordered, updated)

**HR-B0** operator session (nothing new required) →
**2nd HR_OFFICER** (name pending — unblocks visas instantly) →
**HR-B1** leave (grant + manager-lane RPC) →
**HR-B2** performance (same pattern + the HR616 explanation to Effitrans) →
**HR-B3** import apply stage →
HR-8 offboarding → HR-9 reporting → HR-7 payroll (F, last).

## 11. The single smallest next action

**Run HR-B0** — it requires no decision that is still pending, no code, and no
second officer; and every subsequent phase becomes testable against a real
employee the moment it exists. In parallel, put two one-line questions to
Effitrans: *(a)* confirm whether `CEO` (6 accounts today) or only `DGA`/`DAF`
should hold the org-wide seats; *(b)* confirm that a manager must not finalize
the evaluation they reviewed (HR616) — or explicitly ask to repeal it.
