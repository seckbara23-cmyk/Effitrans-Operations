# HR-2 — Employee Workspace: Completion Report

**Date:** 2026-08-02 · **Status:** ✅ **CLOSED — deployed to production (operator PASS)**
**Commit:** `49b54d1` · CI: build 10/10 · rls-tests **67/67, zero skipped** (clean 1→74 chain from empty)

## Production deployment record (operator)

| Step | Result |
|---|---|
| Migration `20260801000002` (two statements) | **applied** |
| `hr_import_batch_import_kind_check` | includes `EMPLOYEES` ✔ |
| `idx_assignment_open_by_employee` | present ✔ |
| Ledger | `migration repair --status applied 20260801000002` → `migration list` **74/74**, Local = Remote |

**No further operator work remains for HR-2.** Code was continuously deployed (Vercel READY);
schema is live; everything rides existing `hr:read`/`hr:manage`; the B1 pause is untouched.

## What shipped

Assignment engine (append-and-close; one-open-PRIMARY as a DB invariant; history
structurally untouchable — the module's only updates set `effective_to`, its only delete is
compensation, both test-pinned) · Timeline ledger live with **mandatory emission in all five
write paths** (create, status transition, link, unlink, assignment) · profile as workspace
(Affectation + Chronologie + dark HR-3 tiles) · `EMPLOYEES` import kind, staging-only ·
18 new structural contracts; 4634 tests green.

## ADR-HR2-01 — Compensation-based mandatory emission

**Decision.** HR-2's mandatory ledger emission (WES-9A discipline: no domain write without
its event) is implemented by **explicit compensation**, not a database transaction: the
domain write executes, the event is appended, and an emission failure *undoes the domain
write* (delete the fresh row / revert the status / restore the link / reopen the closed
assignment) before the action returns `event_failed`.

**Why.** WES-9 proper achieves atomicity inside SQL functions. HR-2's writes go through
PostgREST, which has no cross-call transaction, and HR-2 was scoped to avoid new SQL
beyond the two-statement migration 74. Compensation preserves the invariant («the change
never happened») at the cost of a narrow crash window between write and undo.

**Consequences & future option.** Each action documents its compensation; tests pin
emission presence and the `event_failed` abort. **When HR-3 next writes SQL, the hot paths
may be hardened into single RPCs** (write + emit in one transaction) without changing any
caller contract — reserved, not required.

**Minor decision recorded with it:** the business meaning of an assignment change
(PROMOTION / TRANSFER / CHANGE) is the **actor's declaration**, carried in the ledger
payload — never inferred from the field diff.

## Gates after HR-2 (unchanged — none new)

B1 HRQ-D2 grant ratification (config center) · B2 structure seeds (assignment pickers are
empty until seeded) · B3 HRQ-A4 purge window (blocks batch *application* only — no such
code exists yet). **HR-3 (Documents & Contracts) awaits explicit approval.**
