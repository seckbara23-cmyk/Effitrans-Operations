# HR — Onboarding & Offboarding Architecture

Part of [HR-0R](hr-0r-reaudit-2026-07-31.md) · documentation only · nothing implemented here.

The decisive fact of this re-audit: **the account rails these workflows need were built on
2026-07-29** (granular `admin:users:*`, temp-password lifecycle, forced change, expiry,
audited issuance with reason + IP). The 07-24 audit had to hand-wave these steps; this one
maps each step to a shipped mechanism.

## 1. Onboarding

```
Employee approved for hire            hr:manage — employee row leaves DRAFT
        ↓
Employee number generated             EXISTS: next_employee_number (at creation)
        ↓
Employee record activated             EXISTS: lifecycle DRAFT→ACTIVE (gate: required
        ↓                             documents verified — wizard-configurable, HR-2)
Contract and documents verified       HR-2: hr_document VERIFIED w/ verifier≠uploader
        ↓
Department, position, manager set     HR-1B: employee_assignment (kind=HIRE)
        ↓
Platform user created WHEN required   EXISTS: createUser (admin:users:create) — three
        ↓                             credential modes; secure setup email recommended;
                                      temp-password lifecycle if generated. Account-less
                                      employees simply skip this step (DEC-B59)
Employee ↔ user linked                EXISTS: audited link action; grants nothing
        ↓
Role assignment                       EXISTS: assignRole (validated, audited) — driven by
        ↓                             the checklist, never by position/department
IT & Administration tasks             HR-3: hr_checklist_item rows from the tenant's
        ↓                             onboarding template (HR-0A); assignee = a role seat;
                                      each completion audited. (public.task is dossier-
                                      bound — file_id NOT NULL — so HR gets its own
                                      lightweight checklist rows, not a fork of tasks.)
Equipment assignment                  HR-3: hr_equipment + hr_equipment_assignment (NEW —
        ↓                             nothing exists; categories wizard-managed)
Manager onboarding checklist          HR-3: same checklist machinery, manager-assigned items
        ↓
Probation objectives                  HR-6 (performance domain); until then a checklist item
```

Reused wholesale: the welcome/setup-email pipeline (one pipeline, honest outcomes), the
comms queue for notifications, `writeAudit`, and the role-parity machinery. The email
signature / digital identity step reuses the Brand Center's existing per-user flow once an
account exists — HR triggers it as a checklist item, never writes brand tables.

## 2. Offboarding

```
Departure initiated                   EXISTS: lifecycle → TERMINATED (reason code + note,
        ↓                             effective date) — employee.departure_initiated
Manager and HR review                 HR-3: offboarding checklist instance (template per
        ↓                             tenant); review items assigned to manager + HR
Open responsibilities reassigned      EXISTS: WES-3 assignment rails — dossiers are owned
        ↓                             by departments, tasks by people; the checklist links
                                      to the existing reassignment actions (atomic RPCs)
Customer emails & dossiers reassigned EXISTS: account_manager/coordinator reassignment +
        ↓                             messaging ownership; surfaced as checklist items
Equipment returned                    HR-3: close hr_equipment_assignment rows; unreturned
        ↓                             items block checklist completion, not termination
Finance clearance                     HR-7 boundary: a checklist gate answered by Finance
        ↓                             (advances/loans settled) — HR never reads finance rows
Platform access revoked               EXISTS: the 8.1A archive + auth-ban flow, via
        ↓                             admin:users:disable — PROMPTED, never automatic
                                      (DEC-B62); sessions die by ban (proven limits noted)
Employee archived                     EXISTS: TERMINATED→ARCHIVED; record queryable forever
```

Guarantees preserved by construction: historical attribution survives (archive-not-delete
on both `employee` and `app_user`; audit FKs); HR documents stay protected after departure
(bucket policies key on permissions, not on the subject's status); nothing is hard-deleted;
the TERMINATED-with-active-account condition is surfaced as an alert until the account step
is done.

## 3. The checklist model (HR-3, shared by both flows)

`hr_checklist_template` (tenant-owned, versioned — HR-0A wizard) → `hr_checklist_instance`
(per employee, per flow) → `hr_checklist_item` (label, assignee role-seat, done_by/done_at,
`blocking` flag). Template versioning follows the pinned-version idiom: an instance pins the
template version it was created from; editing a template never rewrites open instances
(`aging_template_version` precedent).
