# EFFITRANS-TMS-1 — Account-Manager assignment authority: implementation contract

**Date:** 2026-08-18 · **Status: CONTRACT ONLY — nothing implemented.** ·
**Baseline:** TMS-0 accepted at `544a2de` (CI #506); TMS-Q1 ratified: *the Operations
Manager (OPS_SUPERVISOR) assigns the Account Manager; creation must not crown the creator;
reassignment while operationally open, with reason, timestamp, actor and immutable
history; historical dossiers are not silently rewritten.*

**Verdict: CONDITIONAL GO — one decision (TMS-1-D1) selects the authority mechanism;
everything else is fully specified below.**

---

## 1. The exact defect and affected code paths

| Path | Fact |
|---|---|
| `lib/files/actions.ts:111` (`createFile`) | inserts `account_manager_id: admin.id` — **the creator is silently crowned AM** |
| Everywhere else | **no code path ever writes `account_manager_id` again** — no action, no RPC, no import |
| `lib/files/actions.ts:370` (`assignFile`) | the only assignment act; gate `file:assign`; writes **`assigned_to_user_id`** (the *working assignee*, a different concept, retired as a visibility source by WES-3F) |
| `lib/process/effitrans-process.ts` step ② `account_manager_assigned` | role OPERATIONS_MANAGER (≙ `OPS_SUPERVISOR`), permission `file:assign`, evidence `account_manager_id` + `assignment_actor` + `assignment_date`; its own gap note names the defect; verdict *partial* |
| `components/files/file-assignment.tsx` → `app/files/[id]/page.tsx` | the existing picker UI — for the working assignee, not the AM |
| Also observed | **`coordinator_id` has no writer either** (§10, observation O-1) |

## 2. The substrate that already exists — TMS-1 reuses, it does not invent

**`assignment_event` (WES-3A, migration 20260727000002) is purpose-built for exactly
this.** Append-only (immutability triggers bind every role including service),
`subject_type` already reserves **`COMMERCIAL_OWNER`**, columns carry
`previous_user_id / new_user_id / actor_user_id / reason (free text, quarantined here) /
reason_code` (CHECK: INITIAL, REASSIGNMENT, SUPERVISOR_INTERVENTION, WORKLOAD_BALANCING,
ABSENCE, ESCALATION, CORRECTION, UNASSIGNMENT, GOVERNANCE) `/ workflow_step_key /
policy_version_id / provenance (OBSERVED | LEGACY_IMPORT)`. A CHECK already **forbids
unassignment rows for owner subjects**. The sibling RPC `assign_operational_owner` is the
exact idiom to mirror: `FOR UPDATE`, tenant + active-member checks, owner-unchanged
refusal, owner-never-vacated rule, and the history row written **in the same
transaction**.

Also reused as-is: `validateAssignee`, `createNotification`, `writeAudit`,
`TERMINAL_FILE_STATUSES` (`CLOSED`, `CANCELLED`), and `can_read_file` (whose visibility
sources are `file:read:all` · `account_manager_id` · `coordinator_id` · `created_by` · an
open assigned task).

## 3. Authoritative role / permission — the one open decision (TMS-1-D1)

The ratified authority is the Operations Manager. The registry's declared permission for
step ② is `file:assign` — but `file:assign` is held today by **`OPS_SUPERVISOR`,
`ACCOUNT_MANAGER` and `SYSTEM_ADMIN`**, because it also gates the *working-assignee*
picker that Account Managers legitimately use on their own dossiers. One permission
currently covers two different acts, and the ratification splits their authority.

* **Option A (recommended): catalogue `file:assign:commercial`**, granted to
  `OPS_SUPERVISOR` (and `SYSTEM_ADMIN` per its standing operational profile), asserted in
  the RPC via `assert_actor_authority` (INV-7 — mandatory for any new definer RPC, which
  the older WES-3A RPCs predate). This is the case TMS-0's "no new permission unless the
  audit proves one is required" clause anticipated: the ratified authority **cannot be
  expressed with existing permissions without breaking the AM's working-assignee lane**.
* **Option B: reuse `file:assign` and strip it from `ACCOUNT_MANAGER`** — no new
  permission, but it removes the AM's existing ability to set the working assignee
  (`components/files/file-assignment.tsx` on their own dossiers), a behavioural
  regression the ratification did not ask for.

**TMS-1-D1: choose A or B.** The contract below is written for A; B changes only the gate
and the grant diff.

## 4. Creation behaviour after correction

`createFile` **stops writing `account_manager_id`** (the insert simply omits it; the
column is already nullable; no constraint is added). The dossier is created **« À
affecter »**. Nothing else about creation changes — numbering, facts, status `DRAFT`,
`created_by` all stay. **The creator keeps visibility** through the `created_by` source in
`can_read_file`, so an unassigned dossier is never orphaned.

## 5. Assignment and reassignment behaviour

One new definer RPC, `assign_commercial_owner(p_file, p_new_user, p_actor, p_reason_code,
p_reason, p_policy)`, mirroring `assign_operational_owner` line for line, plus the INV-7
authority assert:

* actor integrity + `assert_actor_authority(p_actor, tenant, <gate>, 'SERVICE')`;
* target must be an **active member of the tenant** (`validateAssignee` semantics in SQL);
* **owner never vacated**: `p_new_user` null is refused (the history CHECK already forbids
  the row);
* owner-unchanged refusal (no silent no-op history);
* **refused when the dossier is terminal** (`CLOSED`/`CANCELLED`) — "while the dossier
  remains operationally open", ratified;
* writes `operational_file.account_manager_id` **and** the `assignment_event`
  (`subject_type='COMMERCIAL_OWNER'`, `subject_id=file_id`) **in one transaction**;
* app action wraps it: audit entry + notification to the new AM (the `assignFile` idiom).

**Self-assignment by the Operations Manager is permitted** (they may take a dossier as
its AM); flagged as D-2 below only so the default is explicit.

## 6. Required reason / evidence

* **First assignment**: `reason_code='INITIAL'`; free-text reason optional.
* **Every reassignment**: `reason_code` from the existing vocabulary (REASSIGNMENT,
  SUPERVISOR_INTERVENTION, WORKLOAD_BALANCING, ABSENCE, ESCALATION, CORRECTION,
  GOVERNANCE) **and a non-blank free-text reason — refused otherwise** (ratified:
  "reassignment requires a reason").
* Evidence fields demanded by registry step ② map exactly: `account_manager_id` →
  `new_user_id`, `assignment_actor` → `actor_user_id`, `assignment_date` → `created_at`.

## 7. Audit / history behaviour

Three layers, all existing idioms: the **immutable `assignment_event` row** (same
transaction — the record of truth); a **`writeAudit`** entry
(`file.commercial_owner_assigned`, before/after user ids — never the free text);
**notification** to the incoming AM. Free text stays in `assignment_event.reason` only
(the WES-9A quarantine). Nothing is ever updated or deleted; corrections are new rows
(`reason_code='CORRECTION'`).

## 8. RLS / tenant-isolation implications

No policy changes. Consequences to state honestly:

* `account_manager_id` **is a visibility source** — reassignment moves visibility: the
  incoming AM gains it; the outgoing AM retains it only via `file:read:all`, an open
  task, `coordinator_id`, or `created_by`. This is correct behaviour, not a leak, and the
  UAT verifies it in both directions.
* Driver mission auth keys on AM/coordinator/creator — reassignment shifts which staff
  the driver lane recognises; also correct.
* The RPC is service-role transport with in-body tenant checks, like its siblings.

## 9. UI changes (minimal)

* `app/files/[id]`: a **« Responsable client »** block showing the current AM (or « À
  affecter »), its assignment history, and — only for holders of the gate — a picker +
  mandatory reason field on reassignment. Sibling of `file-assignment.tsx`, not a rework
  of it.
* Files list (`lib/files/service.ts` already selects the AM's email): render « À
  affecter » when null.
* No new route; `/journeys` untouched.

## 10. Backward compatibility / migration

* **One additive migration**: the RPC (+ the permission row and grant if D1=A). **No new
  table, no column, no constraint.**
* **Historical dossiers (3 in production) are not rewritten**: `account_manager_id`
  values remain exactly as auto-set. Recommended (optional): one `assignment_event` row
  per existing dossier with **`provenance='LEGACY_IMPORT'`, `reason_code='INITIAL'`** —
  the table's own documented idiom for "derived from a pre-existing column rather than
  observed"; never `OBSERVED`, never back-dated.
* `account_manager_id` stays nullable forever; no `NOT NULL` is added (**a DATA census
  before any future CHECK**, per standing rule).
* **O-1 (observation, out of scope)**: `coordinator_id` also has no writer; it is a
  visibility source too. Same mechanism could serve it later; not built now.

## 11. Test & mutation gates

**SQL suite** (appended last; EFA08 jwt-clear; fixture roles hold real grants):
INITIAL assignment writes both the column and the history row in one transaction ·
reassignment without free-text reason → refused · unassignment (null) → refused ·
owner-unchanged → refused · terminal dossier → refused · cross-tenant actor → HR630-class
refusal · unauthorized actor → EFA15 · `assignment_event` immutability (update/delete
refused) · LEGACY_IMPORT rows (if adopted) carry the right provenance.

**Vitest structural pins**: the `createFile` function slice **no longer contains**
`account_manager_id` (the defect pin, slice-bounded — the recurring lesson) · the RPC
slice contains the INV-7 assert, the terminal-status refusal and the reason requirement
(slice bounded at `revoke execute`, per the thrice-learned rule) · grant census: exactly
the ratified holders (pinned to the GRANT statement, not the file) · UI: the picker
renders only under the gate; « À affecter » rendered for null; no SQLSTATE on screen.

**Mutations (inverse-patch, all must go red)**: M1 restore `account_manager_id: admin.id`
in `createFile` · M2 drop the reassignment-reason requirement · M3 allow unassignment ·
M4 widen the grant to an unratified role · M5 skip the same-transaction history row ·
M6 allow reassignment on a CLOSED dossier.

## 12. UAT acceptance criteria (production, after deploy + migration apply)

1. Create a dossier as an Account Manager → it shows **« À affecter »**, and the creator
   still sees it in their list.
2. As Operations Manager, assign an AM (reason INITIAL) → dossier shows the AM; the AM
   receives the notification; the history shows actor + date.
3. Reassign to another AM **with** a reason → history shows both rows; the outgoing AM
   (holding no `file:read:all`, no task, not creator/coordinator) **no longer sees** the
   dossier; the incoming AM does.
4. Attempt reassignment **without** a reason → refused in French.
5. Attempt the act as an Account Manager (D1=A) → the picker is absent and the server
   refuses.
6. Close a dossier → reassignment refused.
7. The three historical dossiers are byte-identical (AM unchanged), with LEGACY_IMPORT
   history rows if adopted.

## 13. Remaining decisions

| # | Question | Default in this contract |
|---|---|---|
| **TMS-1-D1** | Authority mechanism: **A** new `file:assign:commercial` (OPS_SUPERVISOR + SYSTEM_ADMIN) or **B** reuse `file:assign` and strip ACCOUNT_MANAGER | **A** — B breaks the AM's working-assignee lane |
| TMS-1-D2 | May the Operations Manager self-assign as AM? | Yes (explicit default; refusing would need a new rule with no ratified basis) |
| TMS-1-D3 | Backfill LEGACY_IMPORT INITIAL rows for the 3 historical dossiers? | Yes (the table's own honest idiom); skipping is also compliant |

**HOLD.** Implementation begins on TMS-1-D1's one-line answer.
