# WES-3 — Ownership, Assignment, Department Visibility & Assignment History

**Date:** 2026-07-27 · **Migration:** `20260727000002_assignment_history` (64th)
**Depends on:** WES-0/0A · WES-1 · WES-2 (projection) · WES-7 (policy) · WES-9/9A (event ledger)

Implements the frozen doctrine:

> **Departments own dossiers. People own tasks. Drivers own missions.**

---

## 1. The seven questions, answered

| Question | Answer |
|---|---|
| **Who owns the dossier?** | Two owners, deliberately distinct. **Commercial** — `operational_file.account_manager_id` (falling back to `coordinator_id`), the client relationship. **Operational** — `process_instance.owner_user_id`, accountable for coordination and closure. |
| **Who is responsible now?** | The **department** carrying the current stage, from the WES-2 canonical projection's `responsibleDepartment`. Never a person, never a stored column. |
| **Who is assigned the work?** | A **person**, on a `task` or a `process_step_execution`. Never the dossier. |
| **Who can see it?** | `resolveDossierAccess` — owners, the responsible department, the current assignees, bounded previous contributors, summary-only future departments, explicit governance permission. |
| **Who can complete it?** | The assignee. Anyone else is **intervening**, which requires supervisor or operational-owner authority **and a reason**. |
| **Who can reassign it?** | A department supervisor (from pinned policy), the operational owner, or platform governance. |
| **What survives the handoff?** | Department visibility, both ownerships, and the append-only assignment history. **Reassigning a task never moves a dossier.** |

---

## 2. Architecture discovered

| Slot | Verdict |
|---|---|
| `operational_file.account_manager_id` | **Commercial owner.** Kept. |
| `operational_file.coordinator_id` | Legacy second owner; used as commercial fallback only. |
| `operational_file.assigned_to_user_id` | **RETIRED as a semantic** (WES-3F). It was one of only two non-owner routes into `user_readable_file_ids` — which is exactly why reassigning made dossiers vanish. |
| `process_instance.owner_user_id` | **Canonical operational owner.** Kept, now assigned atomically. |
| `process_step_execution.assigned_user_id` | Step assignee. **Was entirely absent from visibility** — a step assignee could not see the dossier they were assigned. |
| `task.assigned_to` | Task assignee. |
| `transport_record` driver fields | Untouched — WES-6 territory. |

**Three department vocabularies already existed** and WES-3 adds no fourth:
lifecycle `Department` (WES-2, *where the dossier is*) · `CanonicalDepartmentCode` (9.0A, *which department a person is in*) · `ProcessDepartment` (5.0B, 15 workflow queues, *what policy binds*). `lib/workflow/access/departments.ts` states the bridge between the first two and reuses the existing `QUEUE_DEPARTMENT_TO_CANONICAL` for the third.

---

## 3. The 9.0A constraint, and how it is honoured

`lib/organization/departments.ts` ratified: *"THIS REGISTRY IS ORGANIZATIONAL METADATA, NEVER AUTHORIZATION … nothing here may be used to grant or deny anything."* WES-3C requires department-scoped visibility, which reads like a direct conflict.

It is not, because **department membership is derived from roles**. "Members of the responsible department may see the dossier" is precisely "holders of the roles that department is composed of may see it" — still role-based authorization, with department as the grouping notation. Two rules keep that honest, both enforced:

- **No department column** is added to any user or dossier table; membership stays derived, so there is no second source of truth. A test asserts the migration adds none.
- **Eligibility to ACT** comes from the pinned WES-7 policy's seat bindings, never from the department map. *This file decides who may look; policy decides who may act.*

**A real hazard this surfaced:** `DRIVER` maps to `TRANSIT`. Deriving visibility from department alone would have given every driver read access to every customs and transport dossier. `NON_DOSSIER_ROLES` excludes it explicitly, and a test pins it.

---

## 4. WES-3C visibility matrix

| Actor | Summary | Current detail | Historical detail | Documents | Act | Complete | Reassign | Intervene |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Responsible-department member | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| Department supervisor | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ (reason) |
| Previous department, **verified contribution** | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Previous department, no contribution | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Future department | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Commercial owner | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Operational owner | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ✅ (reason) |
| Task / step assignee | ✅ | ✅ | — | ✅ | ✅ | ✅ | ❌ | ❌ |
| Driver | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| System administrator | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | **❌** |
| Portal user | unchanged — customer-safe projection only |

Two rows carry the weight:

- **Previous department requires VERIFIED contribution**, read from the append-only ledger. Holding a role is not a claim of having worked on a dossier.
- **System administrator cannot intervene.** It inspects and reassigns under audit; it is a governance identity, not an operator, and does not silently complete someone's work.

---

## 5. Assignment history (WES-3A)

`assignment_event` — append-only, `prevent_mutation` on UPDATE and DELETE, SELECT-only RLS following `can_read_file`.

Subjects: `COMMERCIAL_OWNER` · `OPERATIONAL_OWNER` · `STEP` · `TASK`. **`MISSION` is deliberately absent** — WES-6.

Database-enforced rules the application cannot bypass: an owner may be reassigned but never vacated · a no-op is refused · cross-tenant assignee or actor is refused · `SUPERVISOR_INTERVENTION` and `GOVERNANCE` require a reason · `file_id` and `subject_id` are **plain uuids with no FK**, because every subject cascades from `operational_file` and a cascade would erase the record explaining what happened.

**Legacy data is not fabricated.** No backfill ships. `provenance` distinguishes `OBSERVED` from `LEGACY_IMPORT`; `assigned_to_user_id` is a migration *hint*, never copied into a canonical field, because the audit found no per-row evidence of what it was meant to mean.

---

## 6. Atomicity (WES-9A doctrine applied)

Assignment happens **only** through `assign_task`, `assign_process_step` and `assign_operational_owner` — security-definer RPCs that write the assignee column, append the history row and emit the business event **in one transaction**. The application never writes an assignee column for these subjects; that would be the dual write WES-9A prohibited.

**RPC, not trigger** — unlike WES-9's domain events. Assignment carries envelope data not derivable from the row: actor, reason, step key, policy version. WES-0A's mechanism 1 says exactly this. A trigger would have to invent them.

The split of responsibility, and why:

| Layer | Enforces |
|---|---|
| TypeScript | Authorization, and **policy eligibility** — the policy document lives here; expressing it in SQL would recreate the second source of truth WES-7 removed. |
| SQL | Tenancy, existence, activity, no-op rejection, reason-required, append-only history. |

Neither trusts the other to have done its half.

---

## 7. Policy consumption (WES-3J)

WES-3 is the **first consumer** of the WES-7 registry. Eligible assignee roles come from the pinned policy's `seats` bindings; supervisor authority from `supervisors` + the `supervisor` seat. **No role list is hardcoded** — a test asserts none appears in the eligibility module.

**Pinned, not active**: `resolvePolicy({ processInstanceId })`, so activating a new policy tomorrow cannot change who may be assigned work on a dossier opened today. Fail-closed on every axis: unresolved policy, unbound seat, identity-bound seat, and no role overlap all mean **no**. The module implements no fallback order of its own.

---

## 8. Visibility contract (WES-3E)

**Before:** `file:read:all` · `account_manager_id` · `coordinator_id` · `assigned_to_user_id` · `created_by` · an assigned task.
**After:** governance permission · commercial ownership · **canonical operational ownership** · task assignment · **step assignment** · **bounded assignment history** — and `assigned_to_user_id` is gone.

Department-responsibility visibility is applied in the **server resolver**, which is projection-aware; `user_readable_file_ids` is the coarse row filter, never the whole contract. Summary-versus-detail is a server projection, not broader raw table access.

---

## 9. Business events (WES-3I)

`TASK_ASSIGNED` · `TASK_REASSIGNED` · `TASK_UNASSIGNED` · `STEP_ASSIGNED` · `STEP_REASSIGNED` · `OPERATIONAL_OWNER_ASSIGNED` · `OPERATIONAL_OWNER_REASSIGNED`. Source `assignment_rpc` — its own value, not a borrowed one.

**Free text never reaches the immutable ledger** (WES-9A / DEC-B75). The event carries the structured `reason_code` and `assignment_event_id`, a safe reference into the protected ledger where the explanation lives. All are `clientSafe: false`.

---

## 10. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3701 passed / 166 files** (67 in `wes-3-assignment-visibility`, 49 in `wes-3a-assignment-queue`) |
| Production build | compiled |
| SQL/RLS suites | **51** wired in CI (was 50) |
| Seed idempotency | **unchanged** |
| Migration clean replay | ✅ green — CI `92dfffa` |
| CI, per job | `build` success (10 steps) · `rls-tests` success (59 steps, **51 `Run` steps, 0 skipped**) |

The tenant-scope leak guard caught one genuine unscoped read during implementation (`process_step_execution` in `currentStepKey`); it was **fixed, not exempted**.

### What the CI round-trips cost, and what was done about it

Four runs were needed. The record matters more than the outcome:

| Run | Result | Cause |
|---|---|---|
| `6a73b25` | ❌ | `rls_file_assignment_test.sql` (Phase 3.2A) asserted the very semantic WES-3F retires. **Legitimate failure** — the implementation audit grepped TypeScript callers of `assigned_to_user_id` but not the SQL suites. **29 later suites were skipped behind it.** |
| `d80c23c` | ❌ | 3.2A realigned, zero skipped, reached WES-3's own suite → `psql exit 3` with no readable message. |
| `7ec2fbc` | ❌ | **No fix — bought observability.** Workflow logs need repository *admin* rights through the API (403); annotations do not. The step now re-emits psql's output as a GitHub error annotation, and the suite prints every check value as a `NOTICE` before asserting — on failure `select * from _r` never runs, because `ON_ERROR_STOP` aborts the transaction. |
| `92dfffa` | ✅ | The annotation named the fault immediately: `invalid input syntax for type uuid: "…-00000000p001"`. `p` is not a hex digit. |

Two durable fixes came out of it: the WES-3 CI step keeps the annotation pattern, and a test now scans
every `.sql` under `supabase/tests` and `supabase/migrations` for UUID-shaped literals containing
non-hex characters. This repository had already made that mistake once, in WES-7 (`g1`, `wp01`, `w1`);
it is invisible to typecheck, unreachable without local Docker or psql, and its abort hides an entire
test job.

---

## 11. WES-3A — closing the two gaps (2026-07-27)

WES-3 shipped with two documented gaps. Both are now closed; this section records
what was done rather than deleting the admission.

### 11.1 Every production assignment uses the atomic path

**Caller map** (the whole of it — the audit found one production caller):

| Caller | Kind | Before |
|---|---|---|
| `components/tasks/task-row.tsx` | production UI | called `assignTask` — bypassed pinned-policy eligibility, active-user validation, the assignment ledger, the business event and the reason requirement |
| `lib/tasks/actions.ts::assignTask` | server action | wrote `task.assigned_to` directly, then audited separately (the dual write WES-9A prohibits) |
| `lib/workflow/access/actions.ts::assignTaskToUser` | server action | canonical, atomic — **no production caller** |
| `lib/messaging/actions.ts` | server action | `conversation.assigned_to` — a different table, out of scope |

`assignTask` is now a **delegating compatibility wrapper**. It is not deleted, because
deleting it would silently drop any unmigrated caller; it delegates, so there is exactly
one authoritative path and the old behaviour is unreachable. A test walks `app/`,
`components/` and `lib/` and fails if any caller remains, or if any production code
updates `task.assigned_to` outside the RPC.

The assignee **notification moved onto the canonical path** — leaving it in the wrapper
would have meant it never fired again. It is the one deliberately best-effort write here,
and correctly so: a notification is not a business fact, and the assignment has already
committed atomically with its ledger row and event.

**The UI** (`components/tasks/task-assignment.tsx`) distinguishes assign / reassign /
unassign, because the ledger distinguishes them. The reason field appears only for codes
that require one and the button stays disabled until it is filled — enforced again in the
server action and a third time by a database trigger. Errors are French and safe; raw
server codes are never rendered. It distinguishes *"nobody is eligible"* from *"policy
could not be resolved"*, because an empty picker and a broken picker look identical and
only one is safe to retry.

**Eligible assignees** come from the pinned policy (`listEligibleAssigneesForFile`),
filtered to ACTIVE members of the caller's tenant. The old picker listed every staff
member and the server had no eligibility check, so any name in it "worked". On the
cross-dossier `/tasks` list the set is resolved **per dossier**, since each pins its own
policy.

### 11.2 Department queue (WES-3H)

`/departments/queue`, six categories: **Non assigné · Assigné à moi · Assigné à un
collègue · Bloqué · En attente de réception · Terminé récemment**.

**Source of truth** — department ownership comes from the WES-2 projection's
`responsibleDepartment`, bridged to the organization's departments. Never from
`assigned_to_user_id` (retired), never from the presence of a task, never from a document
upload or a free-text role label. Tasks are work items, not workflow authority.

Every row passes through `resolveDossierAccess`: a dossier the user cannot see at summary
level is omitted, and detail fields (work title, assignee) are withheld when the matrix
withholds current detail. **The queue never widens raw dossier access.**

It is **not** `lib/process/queues/service.ts`: that queue is step-execution centric and
keyed on the 15 `ProcessDepartment` codes. This one is dossier-centric and keyed on the
user's canonical department. Different axis, different question; no new vocabulary.

Bounded (300 active dossiers), deterministically ordered, closed dossiers excluded, and
**no SLA value is invented** — the page says so.

**Entry point.** `Mon Travail` links to it and is otherwise unchanged: it remains the
user's own actionable work. Merging them would put a colleague's task in a personal list.
The **ratified five-section sidebar is untouched** — this phase's mandate says not to
redesign navigation, and that structure has its own pinned tests.

### 11.3 Remaining limitations

1. **Bounded historical contribution is coarse.** A user with any ledger entry on a
   dossier is credited with every *completed* stage of their department rather than the
   precise stage they worked. Precision needs the step key on every history row, which
   only newly-written rows carry.
2. **`resolveSupervisorRoles` depends on policy content.** With no published policy the
   built-in default supplies the bindings; if it names no `supervisor` seat for a
   department, nobody supervises it and intervention falls back to the operational owner.
3. **No `COMMERCIAL_OWNER` assignment action.** The subject type exists in the ledger for
   completeness; changing the account manager still goes through the ordinary file update
   and writes no history row.
4. **`assignFile` still writes the legacy column.** Marked `@deprecated` with removal
   criteria; the semantic is retired (no visibility, no ownership) but the write path
   survives the compatibility window.
5. **Step assignment has no UI.** `assignStepToUser` is atomic and tested, but no surface
   calls it — step assignment still happens through the existing process-engine actions.
6. **The queue computes projections per render.** Bounded and bulk-loaded, but it is not
   cached across requests; a tenant near the 300-dossier bound will feel it.
3. **`assignFile` still writes the legacy column.** It is marked `@deprecated` with removal criteria; the semantic is retired (no visibility, no ownership) but the write path survives the compatibility window.
4. **Bounded historical contribution is coarse.** A user with any ledger entry on a dossier is credited with every *completed* stage of their department, rather than the precise stage they worked. Precision needs the step key on every history row, which only newly-written rows carry.
5. **`resolveSupervisorRoles` depends on policy content.** With no published policy the built-in default supplies the bindings; if it names no `supervisor` seat for a department, nobody supervises it and intervention falls back to the operational owner only.
6. **No `COMMERCIAL_OWNER` assignment action.** The subject type exists in the ledger for completeness; changing the account manager still goes through the ordinary file update and writes no history row.
