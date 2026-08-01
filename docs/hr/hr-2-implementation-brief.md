# HR-2 — Employee Workspace: Implementation Brief

**Status:** BRIEF ONLY — implementation awaits explicit approval.
**Architecture:** HR-0F (frozen) · ratified roadmap §11: *« Employee Workspace: directory +
profile become a dashboard workspace; Timeline UI over the ledger; `EMPLOYEES` import
kind — the shipped registry folds in here. »*

## Scope

1. **Employee directory as a workspace** — `/departments/hr/registre` matures: richer
   filters (org unit, position, location — joins over `employee_assignment`), presence of
   assignment data on the row, export-free (reporting is HR-9).
2. **Employee profile** — `/departments/hr/[id]` grows three panels:
   - **Affectation** (the open PRIMARY `employee_assignment`: unit, position, manager,
     location) with the append-and-close change action (`hr:manage`), writing the
     assignment row **and** the ledger event in one operation;
   - **Timeline** — the `hr_employee_event` projection, newest first, French labels per
     event kind; C3-free by construction (payloads already carry kind + date only);
   - the existing identity/status/account panels unchanged.
3. **Ledger emission begins** — every HR-2 domain write emits its `hr_employee_event` in
   the same operation (WES-9A Model-A: mandatory-event failure aborts the write). Kinds
   introduced: `created` (backfill on new creates), `assignment_changed`,
   `status_changed`, `account_linked`/`account_unlinked`.
4. **`EMPLOYEES` import kind** — extends the existing staging pipeline (batch kind +
   `KIND_FIELDS` entry + validation: employee_number format/uniqueness, department code,
   status vocabulary). **Still staging-only** — application remains gated (B3/HRQ-A4),
   exactly like the org kinds.
5. **Dashboard deepening** — the Employés card gains per-unit headcount once assignments
   exist; the Contrats/Congés/Performance/Documents cards stay dark.

## Explicitly NOT in HR-2

Contracts, documents, identifiers (HR-3) · onboarding checklists, equipment (HR-4) ·
leave/attendance (HR-5) · any batch **application** · any new permission (the family
lands with HRQ-D2 ratification; HR-2 rides `hr:read`/`hr:manage`) · org-tree editing
beyond the existing configuration center · dotted-line reporting (HRQ-OD2).

## Dependencies and their state

| Dependency | State |
|---|---|
| Migration 73 in production | ✅ applied, ledger 73/73 |
| `employee_assignment` / `hr_employee_event` tables | ✅ live, empty |
| Import staging core | ✅ live |
| B1 (HRQ-D2 grants) | ⏳ open — **does not block HR-2** (config center concerns B2 seeds, not the workspace) |
| B2 (structure seeds) | ⏳ open — HR-2 *functions* without it (assignment pickers render empty states); *usefulness* arrives with the seeds |
| B3 (HRQ-A4 purge window) | ⏳ open — blocks batch application only, which HR-2 does not contain |

## Likely schema need (decide at implementation, additively)

None mandatory. Candidate: a partial index on `employee_assignment (tenant_id, employee_id)
where effective_to is null` for profile reads — micro; can ride the next migration.
**No migration is planned for HR-2 unless implementation proves one necessary.**

## Test obligations

Extend `rls_hr_organization_test.sql` or add a sibling: assignment append-and-close
atomicity with ledger emission (abort-on-failure proof, WES-9A style) · directory joins
respect `hr:read` · vitest: emission is mandatory in every write path (structural),
Timeline projection is C3-free (no amount-like keys in any emitted payload), EMPLOYEES
import validation rules, and the standing drift pins (build-info stays at 73 if no
migration ships).

## Acceptance shape

An HR_OFFICER can: see the directory with assignment columns → open a profile → set the
employee's unit/position/manager/location → see the Timeline grow with each act → stage an
EMPLOYEES CSV to READY. Nobody else sees anything new; SYSTEM_ADMIN still sees zero rows.
