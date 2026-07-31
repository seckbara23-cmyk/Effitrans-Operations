# HR — Organization Model, Employment Lifecycle, Numbering

Part of [HR-0R](hr-0r-reaudit-2026-07-31.md) · documentation only.

## 1. Organization model — what exists, what is authoritative, what is missing

Three department-shaped things exist today, with strictly different jobs:

| Thing | Job | HR verdict |
|---|---|---|
| Canonical registry (`lib/organization/departments.ts`) — 4 fixed codes | The platform's operational vocabulary; WES-3 dossier ownership derives from it | **Stays the top-level vocabulary.** `employee.department` already CHECKs against it. It is code-fixed and must not become tenant-editable. |
| Department→Role display taxonomy (`lib/users/departments.ts`) | UI grouping for the account-creation role picker | **Rejected as an HR model** — it groups *roles*, is presentation-only by its own contract, and several headings (IT, Recovery, Executive) are not departments an employee belongs to in the HR sense |
| `employee.department` column | The employee's org placement | Correct anchor, but **flat**: no sub-units, no positions, no history |

**What HR needs that nothing provides (the real HR-1 remainder):** a tenant-scoped
organizational structure *under* the canonical vocabulary — sub-departments/units,
a position catalog, dated reporting lines, and transfer/promotion history.

### 1.1 Proposed structure (entities detailed in the ERD)

```
canonical department (code, fixed)             ← platform vocabulary, unchanged
      └── hr_org_unit (tenant-scoped, NEW)     ← « Transit — Équipe AIBD », « Finance — Caisse »
              └── hr_position (tenant-scoped, NEW)   ← catalog: title, unit, grade ref, active flag
                      └── employee_assignment (NEW)  ← employee × position × manager × location,
                                                        effective_from / effective_to
```

- `hr_org_unit`: `parent_unit_id` for sub-units; `canonical_department` CHECK ties every
  unit to the fixed vocabulary, so HR structure can never contradict the platform's
  department model. Inactive units are flagged, never deleted.
- `hr_position`: replaces free-text `job_title` as the *catalog*; the free-text column
  remains as display fallback until positions are configured (setup wizard, HR-0A).
  Positions grant **nothing** — same doctrine as departments, test-pinned the same way.
- `employee_assignment`: the historization DEC-B63 deferred to HR-2, now concrete.
  One current assignment per employee (partial unique on `effective_to IS NULL`);
  transfer/promotion = close the current row, open a new one, both in one action, audited.
  `assignment_kind` (`HIRE/TRANSFER/PROMOTION/ACTING/CORRECTION`) captures why.
  **Acting manager** = an assignment row with `acting = true` and an end date;
  **dotted-line** is *not modeled* until a real consumer exists (decision register).
- Org chart: derived by walking current assignments' `manager_employee_id` — a read
  projection, never a stored tree. Cycle prevention at the action layer (walk-up check)
  plus a periodic integrity assertion in tests.
- Cost center and work location: `hr_position.cost_center` / `employee_assignment.
  work_location_id → hr_work_location` (simple tenant catalog, wizard-managed).

Reporting-line **access** (manager reads direct reports) remains deferred (DEC-B63) and is
designed in the scopes document — the *model* above is what makes it eventually enforceable.

## 2. Employment lifecycle — mapping the 11 requested states onto the ratified machine

DEC-B62 ratified five stored states with derived phases, matching the platform's doctrine
(invitation state, document expiry and overdue invoices are all derived). The request's
richer list maps cleanly — **no new stored state is needed**:

| Requested | Disposition |
|---|---|
| DRAFT | **Stored** — exists |
| PRE_HIRE | = DRAFT with a future `hire_date` (derived label « Pré-embauche ») |
| PROBATION | **Derived**: ACTIVE ∧ `probation_end_date ≥ today` — a status would demand a mutation the day probation ends, on every employee, forever |
| ACTIVE | **Stored** — exists |
| SUSPENDED | **Stored** — exists (employment suspension only; account access is `/users`) |
| ON_LEAVE | **Derived from leave records** (ratified, DEC-B62) |
| NOTICE_PERIOD | **Derived**: ACTIVE ∧ `termination_date` set ∧ in the future (label « Préavis ») |
| TERMINATED | **Stored** — exists |
| RESIGNED / RETIRED | **Reason codes on TERMINATED**, not states (vocabulary in the field dictionary §4) |
| ARCHIVED | **Stored** — exists |

### 2.1 Transition contract (per DEC-B62; actor = `hr:manage` unless noted)

| Transition | Reason req. | Effective date | Documents | Account implication | Payroll implication | Audit | Reversible |
|---|---|---|---|---|---|---|---|
| DRAFT → ACTIVE | no | hire_date | contract verified (HR-2 gate, wizard-configurable) | none automatic; onboarding MAY create one | enters payroll population (HR-7) | `employee.activated` | via SUSPENDED only |
| ACTIVE → SUSPENDED | **yes** | stated | optional | **prompt** (never auto) to suspend account | flagged to payroll prep | `employee.suspended` | yes → ACTIVE |
| SUSPENDED → ACTIVE | no | stated | — | prompt to reactivate | resumes | `employee.activated` | — |
| ACTIVE/SUSPENDED → TERMINATED | **yes (code + note)** | termination_date | departure docs (HR-2, configurable) | **prompt** to archive/ban via 8.1A rails | leaves population at date | `employee.departure_initiated` → `employee.offboarded` | **no** — rehire = new record |
| TERMINATED → ARCHIVED | no | — | — | — | — | `employee.archived` | no |
| DRAFT → ARCHIVED | no | — | — | — | — | `employee.archived` | no (abandoned hire) |

Employment status and account status stay **separate but coordinated**: Employee ACTIVE +
no account is normal (field staff); Employee TERMINATED + account active is an **alert
condition** the offboarding checklist surfaces (never an automatic ban).

## 3. Employee numbering — EXISTS; one hardening item

Implemented: `EMP-{YEAR}-{NNNN}`, per-tenant `employee_counter`, atomic upsert-returning,
security definer, service-role only, gaps allowed, never reused — the `invoice_counter`
pattern, as required. Separate from the UUID PK. Auditable via `employee.created`.

**Gap found by this re-audit:** immutability after activation is convention, not mechanism —
no trigger blocks an UPDATE of `employee_number`. Writes go only through service-role
actions today, so exposure is low, but the ratified requirement says *immutable*:
**HR-1B adds a trigger** (reject `employee_number` change once status ≠ DRAFT) and a test.

**Format configurability (HR-0A):** the wizard may set prefix/pattern **before activation
only** (`hr_configuration.numbering_pattern`, default `EMP-{YEAR}-{SEQ4}`); after the first
non-draft employee exists the pattern locks — renumbering live staff is an integrity
hazard with no business upside. Existing numbers never change.
