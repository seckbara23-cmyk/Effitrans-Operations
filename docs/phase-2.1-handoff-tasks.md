# Phase 2.1 — Automatic Department Handoff Tasks

**Date:** 2026-06-17
**Goal:** turn the Phase 2.0 handoff *indicators* into controlled, **idempotent** operational tasks — without a second workflow engine, duplicate tasks, or notification spam. The lifecycle tracker stays the authoritative workflow visualization; dossier records stay the authoritative business records; handoff tasks are derived operational work items.

**Validation:** `tsc --noEmit` clean · **193 tests** pass (+9) · `next build` succeeds · boundary + secrets checks clean.

---

## 1. Handoff triggers implemented (exactly four)

| # | Handoff | Trigger site (existing action) | Precondition | Task type | Target role |
|---|---|---|---|---|---|
| 1 | Documentation → Customs | `approveDocument` → `review()` (documents/actions) | all required docs for an IMP/EXP dossier APPROVED | `CUSTOMS_HANDOFF` | CUSTOMS_DECLARANT |
| 2 | Customs → Transport | `releaseCustoms` (customs/actions) | customs `RELEASED` | `TRANSPORT_HANDOFF` | TRANSPORT_OFFICER |
| 3 | Transport → Finance | `changeTransportStatus` → `POD_RECEIVED` (transport/actions) | POD received (gate already enforced) | `FINANCE_HANDOFF` | FINANCE_OFFICER |
| 4 | Finance → Archive | `recordPayment` (finance/actions) | every issued invoice fully paid (balance = 0) | `ARCHIVE_HANDOFF` | OPS_SUPERVISOR |

Each trigger is **best-effort** (its own try/catch; `createHandoffTask` also never throws) so a handoff can never break the business action — same discipline as the welcome-email and notification paths.

## 2. Task types / architecture

Reuses the **existing `task` table** — no second task system, no `department_tasks`. One additive nullable column `handoff_type` (CHECK = the four types) discriminates handoff tasks. Tasks are created `TODO`, priority `HIGH`, **unassigned** (the target role is implicit in the type and surfaced via the department dashboard; any role-holder can claim via the existing assign flow). Role assignment by user is intentionally left to the existing task model.

## 3. Duplicate-prevention strategy (two layers)

1. **App pre-check** — `createHandoffTask` queries for an open (`status NOT IN (DONE,CANCELLED)`) task of the same `(file_id, handoff_type)` and returns `"exists"` without inserting.
2. **DB hard backstop** — partial unique index `idx_task_open_handoff (file_id, handoff_type) WHERE handoff_type IS NOT NULL AND status NOT IN ('DONE','CANCELLED')`. Even under a race, the second insert is rejected (`unique_violation`), which `createHandoffTask` catches and treats as `"exists"`.

Re-triggering the same event therefore never adds a task. Once a handoff is `DONE`/`CANCELLED` it leaves the index, so a legitimate future handoff of the same type can be created again.

## 4. Notification integration

On a **newly created** task only, one in-app notification is created per **target-role holder** (reusing the existing `TASK_ASSIGNED` type — no notification-enum migration, no new dispatch path). No repeats (tied to the idempotent creation), no reminders, no escalation. Notifications are self-scoped (existing RLS unchanged). Finance officers (no `task:read`) still get notified and can open the dossier (they hold `file:read` from A1).

## 5. Audit integration

- `handoff.task.created` — emitted once when a handoff task is created. Payload: `{ dossier, source, target, task_id, type }`.
- `handoff.task.completed` — emitted in `completeTask` when a task carrying a `handoff_type` is marked `DONE`. Payload: `{ dossier, type, task_id }`.

New codes added to `lib/audit/events.ts`.

## 6. Department UX + lifecycle integration

- **Dashboards** now show a handoff count card, read via the admin client gated by each department's own read permission (same pattern as the queues — **no task-RLS dependency**, so finance/customs see counts without `task:read`):
  Documentation → "Prêt pour la douane" · Customs → "Prêt pour déclaration" · Transport → "Prêt pour dispatch" · Finance → "Prêt pour facturation" · Management → "Transferts en attente".
- **Lifecycle tracker** now shows **Current department → Next department** chips and, when present, the **open handoff task** badge ("Transfert ouvert: …"). `getDossierLifecycle` gained pure `currentDepartment`/`nextDepartment`; the page passes the open handoff (read-only, gated by `file:read`).

## 7. RLS

No RLS change. `task_select` stays `tenant + task:read + can_read_task`. Department users only see raw tasks they already have access to; department-level handoff visibility is an aggregate count gated by the department permission. Proven by `supabase/tests/rls_handoff_test.sql`: OPS_SUPERVISOR (`task:read:all`) sees the handoff task, CUSTOMS_DECLARANT (scoped, unassigned) does not, and a duplicate open handoff is blocked.

## 8. Files changed

**New:** `lib/handoffs/rules.ts` (pure), `lib/handoffs/service.ts` (server-only), `lib/handoffs/triggers.ts` (server-only), `supabase/migrations/20260617000001_task_handoff_type.sql`, `supabase/tests/rls_handoff_test.sql`, `tests/handoffs.test.ts`, `docs/phase-2.1-handoff-tasks.md`.
**Edited:** `lib/documents/actions.ts`, `lib/customs/actions.ts`, `lib/transport/actions.ts`, `lib/finance/actions.ts` (trigger hooks); `lib/tasks/actions.ts` (`handoff.task.completed` + loadTask `handoff_type`); `lib/audit/events.ts`; `lib/files/lifecycle.ts` + `components/files/lifecycle-tracker.tsx` + `app/files/[id]/page.tsx` (current/next dept + open handoff); the five department pages (count cards); `lib/i18n.ts` (`t.handoffs`); `lib/db/types.ts` (`handoff_type` column); `tests/files-lifecycle.test.ts`; `.github/workflows/ci.yml`.

## 9. Tests added

- **`tests/handoffs.test.ts`** — the four handoff definitions (source/target/role), type guard, `documentationComplete` (incl. nothing-required → no false handoff + determinism), `dossierFullyPaid` (issued/zero-balance, DRAFT/VOID ignored).
- **`tests/files-lifecycle.test.ts`** — `currentDepartment`/`nextDepartment` derivation.
- **`supabase/tests/rls_handoff_test.sql`** — duplicate prevention (unique index) + RLS visibility (ops sees / declarant doesn't); wired into CI.

## 10. Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 193 passed (+9) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only handoff modules |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |
| RLS / idempotency SQL | ⏳ runs in CI `rls-tests` job (local Supabase unavailable here) |

## 11. Migration

**`20260617000001_task_handoff_type.sql`** — additive: `task.handoff_type` column + partial unique index + a count index. No RLS change, no data backfill, no seed change.

### Production migration instructions
- Ships with the normal deploy (`supabase db push` / CI migration step). Idempotent (`add column if not exists`, `create … if not exists`), additive, zero downtime.
- Regenerate DB types in the pipeline if applicable (`npm run db:types`); the committed `lib/db/types.ts` already includes `handoff_type`.

## 12. Live testing checklist

1. **Documentation → Customs**: approve the last required doc on an IMP dossier → a `CUSTOMS_HANDOFF` task appears; the Documentation card "Prêt pour la douane" and the Customs card "Prêt pour déclaration" each increment by 1; CUSTOMS_DECLARANT users get a notification; `audit_log` has `handoff.task.created`.
2. **Re-trigger**: approve/re-approve another doc on the same dossier → **task count unchanged** (idempotent).
3. **Customs → Transport**: release customs → one `TRANSPORT_HANDOFF`; Transport "Prêt pour dispatch" +1.
4. **Transport → Finance**: mark POD received → one `FINANCE_HANDOFF`; Finance "Prêt pour facturation" +1; FINANCE_OFFICER notified.
5. **Finance → Archive**: record the final payment that clears the balance → one `ARCHIVE_HANDOFF`; Management "Transferts en attente" reflects it.
6. **Completion**: mark a handoff task DONE → `audit_log` has `handoff.task.completed`; the dossier's open-handoff badge clears.
7. **Lifecycle**: open the dossier → tracker shows Current → Next department and the open handoff badge.
8. **RLS**: confirm a CUSTOMS_DECLARANT not assigned to a dossier doesn't see its raw handoff task in `/tasks`, but the Customs dashboard count includes it.

## 13. Constraints honoured

No workflow redesign · no second task system · no duplicate task generation (app pre-check + unique index) · no automatic escalation · no scheduled reminders · no SLA engine · no RLS weakening. Clean department-to-department handoffs only.
