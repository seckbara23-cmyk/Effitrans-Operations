# HR-5 — Leave & Attendance: Implementation Brief

**Status:** BRIEF ONLY — implementation awaits explicit approval.
**Ratified scope (§11):** *"Leave & Attendance: categories/entitlements from config;
ON_LEAVE derived; attendance input contract."*

## Scope

1. **Leave configuration** — `hr_leave_category` (code, label, paid/unpaid, requires
   evidence, max consecutive days) and `hr_leave_entitlement` (per employee per period:
   opening balance, accrued, taken, remaining). **Statutory values are seeds, not
   constants** — the Senegal defaults (annual leave accrual, maternity, sick) enter as
   configuration rows a tenant can correct, per the HR-0F compliance posture. **Counsel
   confirmation is required for the seed values themselves** (DEC-B63 family) — the schema
   does not wait on it, the *seeded numbers* do.
2. **Leave requests** — `hr_leave_request` with a closed lifecycle
   `DRAFT → SUBMITTED → APPROVED | REFUSED | CANCELLED`, and **maker-checker as a CHECK**:
   `approved_by <> requested_by`, the idiom already proven three times.
3. **`ON_LEAVE` is DERIVED, never hand-set** (ratified). The employee status machine gains
   no new state: an approved, currently-active leave *projects* as ON_LEAVE in reads. This
   is the single most important rule of the phase — a hand-set ON_LEAVE would silently
   diverge from the approved leave that justifies it.
4. **Balance arithmetic** — a pure module (`lib/hr/leave/balance.ts`) with **integer
   day-tenths**, mirroring the aging engine's integer-minor-unit discipline: no floats for
   half-days, no `toFixed`. Injected reporting date, no clock inside the engine.
5. **Attendance input contract** — the ratified §9 extension point: a typed shape
   (`employee_id`, date, worked minutes, source) that a future device/import can satisfy.
   **HR-5 defines and validates the contract; it does not build a device integration.**
6. **Ledger + audit** — new kinds `leave_requested`, `leave_approved`, `leave_refused`,
   `leave_cancelled`, `attendance_recorded`. **Transactional RPCs from the outset**
   (ADR-HR2-01 as exercised in HR-4): approve-leave writes the decision, adjusts the
   balance and emits, in one transaction.
7. **Surfaces** — the dashboard's dark « Congés » tile goes live; a leave workspace
   (requests queue + balances); a profile panel showing entitlement, taken, remaining and
   current leave.

## Explicitly NOT in HR-5

Performance/training (HR-6) · payroll or leave *payment* (HR-7) · offboarding (HR-8) ·
reporting/analytics (HR-9) · device integrations, biometric or GPS attendance · public
holiday calendars beyond a configurable list · `employee_identifier` (DEC-B63).

## Gate sensitivity

| Gate | Effect |
|---|---|
| **Statutory seed values** (counsel) | blocks the *seeded numbers*, not the schema or the engine — ship with tenant-editable defaults marked provisional |
| B1 (HRQ-D2) | a `hr:leave:approve` code is the likely genuine gap; **do not invent it** — bring it to ratification with the HRQ-D2 family |
| B2 seeds | leave categories are configuration; empty until seeded |

## Test obligations

RLS suite (appended last): tenant confinement, SYSTEM_ADMIN zero, portal zero,
maker-checker CHECK, one-approval-per-request, balance never negative without an explicit
override flag · vitest: the pure balance engine (integer arithmetic, boundary dates,
half-days), ON_LEAVE derivation is read-only and never written to `employee.status`,
transactional emission, the attendance contract's validation.

## Acceptance shape

An employee's leave is requested, approved by a *different* `hr:manage` holder, the balance
decrements by the exact day-tenths, the Timeline shows both events, the profile reads
ON_LEAVE **only while the approved leave is active** — and nothing anywhere writes
`ON_LEAVE` into `employee.status`.
