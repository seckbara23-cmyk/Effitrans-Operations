# HR-5 — Leave & Attendance: Completion Report

**Date:** 2026-08-02 · **Status:** CLOSED — deployed to production (operator PASS)
**Commit:** `7dc8f33` · CI: build 10/10 · rls-tests **70/70, zero skipped** (clean 1->77 chain)

## Production deployment record

| Step | Result |
|---|---|
| Project ref | `xtpppzhkiagdpmnghdlc` — confirmed before the repair (INC-HR3-01 discipline) |
| Migration `20260802000003` | applied |
| `hr_leave_category` / `hr_leave_entitlement` / `hr_leave_request` / `hr_attendance_day` | present (independently probed) |
| Ledger | repaired; **77/77**, last `20260802000003` (independently re-verified) |

**No operator work remains for HR-5.**

## What shipped

**ON_LEAVE is derived, never stored.** No column, no status value, no transition, no writer.
`employee.status` keeps its ratified five values and the CHECK refuses `ON_LEAVE` outright —
proven on live Postgres, not merely asserted. Presence is a pure projection over
(status, APPROVED window, date); employment state wins, so a terminated person is never
reported "on leave".

**Approval is a separate authority.** `hr:leave:approve` is catalogued and granted to no
role; the decide action gates on it, never `hr:manage`. Requesting and approving are now
different authorities in the permission model, not only in a constraint.

**No legal value invented.** Seeded categories are vocabulary only — `is_paid` NULL
(unknown, not assumed), `is_provisional` true. No accrual formula, entitlement quantity,
public holiday or retention period exists anywhere. `spanTenths` counts *calendar* days by
construction, because working days need a holiday calendar and work pattern this phase must
not invent.

**Integer day-tenths.** 10 = a day, 5 = a half: the aging engine's minor-unit discipline
applied to days, so no float decides how much leave someone has. Overdraw is surfaced,
never clamped.

**Transactional decisions.** `hr_decide_leave_request` / `hr_cancel_leave_request` commit
the decision, the entitlement movement and the ledger event together (ADR-HR2-01 as
exercised since HR-4). A decided request is immutable with one governed exit to CANCELLED,
which returns the entitlement.

**Attendance is the input contract only** — bounded minutes, typed source, no device
integration, no inference. Deliberately **not** emitted to the employee timeline: a daily
row per person would drown the employment narrative. Audited normally instead. (A stated
refinement of the HR-5 brief, which had listed an `attendance_recorded` ledger kind.)

## Open gates after HR-5 (bounded — none blocks other work)

| Gate | Blocks | Owner |
|---|---|---|
| `hr:leave:approve` holder ratification | leave **approval** only; requests still flow | management — `hr-5-permission-ratification.md` |
| Senegal counsel: confirm categories, supply statutory values | the *numbers*, not the schema | counsel |
| B1 HRQ-D2 · B2 seeds · B3 purge · DEC-B63 | unchanged | management / legal |

Every one of these is an **activation** gate, which is the subject of HR-5A.
