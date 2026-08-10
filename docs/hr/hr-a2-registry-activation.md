# HR-A2 — Employee Registry Activation & First Real Employee Workflow

**Nature:** activation + narrow hardening — no rebuild, no migration, no employee
created, no number consumed. Audit first (repo + read-only production).

## A. Architecture discovered (one registry — no STOP)

`public.employee` is the only person registry (`user_profiles`/`employee_profile`/
`staff_profile`/`personnel` do not exist — test-pinned). The full path existed
since HR-1/HR-2: `EmployeeCreateForm` → `createEmployee` (hr:manage guard →
pure validation → trusted `next_employee_number(p_tenant, p_actor)` → DRAFT
insert → mandatory `created` ledger event with compensation → audit) ·
`updateEmployee` (field-name-only audit) · `transitionEmployee` (pure lifecycle
table, CAS, termination requires reason + « solde de tout compte », never
touches the account, `promptRevocation` signal) · `linkEmployeeAccount` /
`unlinkEmployeeAccount` (active same-tenant target, grants nothing) ·
`setEmployeeAssignment` (append-and-close, one-open-PRIMARY DB invariant,
mandatory ledger with full compensation) · documents/contracts (C3 fail-closed
since HR-A1) · imports pinned at READY · profile page composing every module
with honest empty states.

**DB backstops (migration 57/73/74):** `uq_employee_number(tenant, number)` ·
`uq_employee_linked_user` partial unique (one account → one employee; the
reverse is impossible by shape — one nullable column) ·
`enforce_employee_tenant` trigger (cross-tenant link/manager/creator raise) ·
`trg_employee_number_immutable` · `hr_employee_event` append-only ·
`uq_employee_open_primary_assignment`.

## B. Production state at audit (read-only)

Employees 0 · counter empty (no number ever consumed) · `hr_configuration`
**empty** · org units **0** · positions 0 · locations 0 · assignments 0 ·
HR_OFFICER holders **1** (active). **The HR-A1 wizard session has not been run
— an operator dependency, deliberately NOT fabricated here** (no seed, no
migration; the creation form states it honestly when no unit exists).

## C. Gaps found and closed (the narrow implementation)

1. **Assignment-target validation** — `setEmployeeAssignment` passed
   browser-supplied `orgUnitId/positionId/workLocationId/managerEmployeeId`
   straight to plain FKs: a cross-tenant or deactivated target was accepted.
   New `lib/hr/assignment-core.ts` validates every provided target
   (tenant-scoped read; exists + active; manager exists) and BOTH writers call
   it before any insert. App-side by design: `employee_assignment` has **no RLS
   write policy**, so these two actions are the only write paths — a DB trigger
   would need a migration for a path no browser can reach (§16: none needed).
2. **Initial placement at creation** — `createEmployee` accepts optional
   `orgUnitId` (validated BEFORE allocation → a refusal consumes no number);
   the assignment row is inserted BEFORE the `created` event so every failure
   compensates cleanly (append-only ledger rows can never be unwound, so
   nothing may fail after one is written); placement travels in the `created`
   payload + audit. The form offers ACTIVE units only, or an honest
   "no structure configured yet" hint.
3. **Duplicate guard (warning-first)** — exact case-insensitive name match on
   non-terminal statuses refuses once with `duplicate_name`; the operator
   confirms via `allowDuplicateName` (« Créer quand même ») — homonyms are
   people, not errors. Runs before allocation; also absorbs double-submits.
   No uniqueness constraint on names.
4. **Registry list** — now shows the authoritative placement (open PRIMARY →
   unit name, two batched tenant-scoped reads) and the hire date.
5. **Second-officer fact (F2)** — `countHrOfficers` (DISTINCT active holders,
   fail-closed to 0) surfaces on the Operations Center when < 2, naming the
   Administration action; four-eyes flows stay fail-closed, nothing softened.

## D. Tests

TS `tests/hr-a2-registry-activation.test.ts` (24): trusted numbering path only,
every refusal before allocation, both writers validate targets, compensable
placement, duplicate guard + escape hatch + no name constraint, no `user_role`
write anywhere in HR, one-registry proof, import still READY-pinned, no HR-A2
migration, C3 fail-closed intact, CI wiring. SQL
`hr_a2_registry_activation_test.sql` (runs LAST): **placement + link grant ZERO
permissions** (live `get_user_permissions` before/after on a FINANCE-mapped
unit), cross-tenant link refused, one-account-two-employees refused, second
open PRIMARY refused.

## E. Production impact

Deploy changes behavior only for hr:manage/hr:read holders (today: the one
HR_OFFICER). Newly usable: creation with initial placement, duplicate warning,
placement/hire-date columns, officer-count fact. Consumed by deploy: nothing —
no employee, no number, no role, no grant, no import application, no Enterprise
Mail change.

## F. First-real-employee UAT (operator)

Prerequisite (HR-A1 leftover): run the configuration session —
`/departments/hr/configuration` → save numbering (prefix EMP or blank) →
Activer → create the department units (canonical correspondences).

1. RH → Employés (`/departments/hr/registre`) → « + Nouvel employé ».
2. Enter the real identity; select the organizational unit; leave position/site
   blank (not yet configured — legitimately optional).
3. Submit ONCE → profile opens → matricule **EMP-0001** (DB-allocated).
4. Registry lists the employee with unit + hire date; « Actifs » stays 0 until
   the DRAFT → ACTIVE transition (statuses are honest, not decorative).
5. Profile → Chronologie shows « Employé créé »; audit holds
   `hr.employee.created` with number/department/unit only.
6. Verify permissions unchanged: the operator's own permission set is
   identical before/after (placement grants nothing — also CI-proven).
7. Optional, separate act: link an existing account (« Compte de connexion ») —
   the pickers exclude taken accounts; linking grants nothing.

## G. Second HR Officer (operator action — NOT done by code)

Administration → Utilisateurs → assign role « Chargé RH (HR_OFFICER) » to the
designated person (existing audited flow). Two distinct active holders unlock
contract verification and import approval visas. If the first employee entered
is meant to BE that person: create the employee, link their account, then
assign the role — three separate audited acts.

## H. Blockers before HR-A3

1. HR-A1 operator session (structure + numbering activation) — prerequisite to
   meaningful placement;
2. second HR_OFFICER (above);
3. HRQ-A4 still pins import application (manual entry unaffected);
4. `hr:leave:approve` seat (named person) + its one-grant migration = HR-A3.

**Proposed next phase: HR-A3 — Leave activation** (seat ratification + grant
migration + first decided request), after the first real employees exist.
