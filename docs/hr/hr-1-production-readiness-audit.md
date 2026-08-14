# EFFITRANS-HR-1 — production readiness & completion audit

**Date:** 2026-08-14 · **Baseline:** `7080bea` (CI #466 GREEN) · **Ledger 106/106** · **Audit only — nothing implemented, nothing mutated.**

## The one-line answer

**Nothing in engineering blocks the first real employee.** The HR core is built,
migrated, granted and live. It is **empty and single-staffed**: the operator
configuration session has never been run, zero employees have ever been created,
and exactly one person holds HR_OFFICER — so every four-eyes control is
structurally incompletable. What remains before real use is **one configuration
session, data entry, and one staffing decision** — plus two deliberately parked
authority seats that need Effitrans to name their holders.

---

## 1. Production state, verified read-only today

| Probe | Result |
|---|---|
| HR tables | **35** (`employee*`, `hr_*`), all RLS-enabled with policies |
| Migration 99 (HR-A1 grant) | **APPLIED** — `hr:config:manage` → HR_OFFICER live in production |
| `hr_configuration` | **0 rows — the HR-A1 wizard session has never been run** |
| `hr_org_unit` / `hr_position` / `hr_work_location` | **0 / 0 / 0** |
| `employee` / `employee_assignment` | **0 / 0** |
| Every operational table (leave, attendance, equipment assignment, training, objectives, evaluations, onboarding, imports, documents, events) | **0** |
| Seeds only | 6 leave categories · 11 equipment types · 1 document type |
| `hr:read` / `hr:manage` / `hr:config:manage` | HR_OFFICER — **1 human holder** (the operator account) |
| `hr:leave:approve` / `hr:performance:finalize` / `hr:sensitive:read` | **granted to NOBODY** — the deliberate B1/HR-A3/A4/DEC-B63 pauses, intact |
| SYSTEM_ADMIN hr:* | none (DEC-B25 holds) |

« 0 Employés actifs » is an honest count of an empty table. The dashboard reads
`employee` rows with `status = 'ACTIVE'`; there have never been any.

## 2. Employee identity — the model is intentional, and it is not synchronization

```
auth.users ──(id)── app_user ──────────────┐  (application identity: login, roles, permissions)
                                           │
                              employee.linked_app_user_id
                                (nullable · UNIQUE · grants NOTHING)
                                           │
employee ──── employee_assignment ──── hr_org_unit / hr_position / hr_work_location
   (HR identity: matricule EMP-NNNN,       (append-only placement history)
    civil state, contract, lifecycle)
```

**An application user is deliberately not an employee.** The link is optional
metadata: linking an account changes no permission (proven live by the HR-A2 SQL
suite — `get_user_permissions` is byte-identical before and after a link), and
an employee can exist with no account (workers who never log in) as an account
can exist with no employee record.

**How an existing Effitrans user becomes visible in Employés:** an HR_OFFICER
**creates the employee** in the registry (matricule auto-assigned, EMP-0001
first), optionally links the account. **The missing piece is data activation** —
not configuration code, not synchronization, not implementation. There is
nothing to sync: HR-0R ratified that the registry is authored, never derived.

**Creation is not even blocked by the empty structure**: `orgUnitId` is optional
at creation, and the matricule prefix defaults to `'EMP'` when
`hr_configuration` has no row. The wizard session is the *right* first step (so
placements exist), not a hard precondition.

## 3. Feature completion matrix

| Domain | Class | Evidence |
|---|---|---|
| **Employés** (registre) | **A** — dark for lack of data | HR-A2: create/update/lifecycle/link/duplicate-guard/assignment validation, CI-proven |
| **Organisation** | **A** — awaiting the configuration session | units/positions/sites/hierarchy/effective-dated `employee_assignment`; targets tenant-validated (HR-A2) |
| **Configuration** | **A** — grant live since migration 99; session never run | numbering studio, department units, `CANONICAL_DEPARTMENTS` import |
| **Intégration** (onboarding) | **A** — dark; needs checklist templates configured | cases/items/templates + actions exist |
| **Équipements** | **A** — dark | 11 types seeded; assignment actions exist |
| **Congés & présence** | **C / E** | fully built **but `hr:leave:approve` is granted to NOBODY** — approvals cannot run until Effitrans names the seat (HR-A3) |
| **Formation** | **A** — dark | courses/plans/enrollments + actions; needs catalog data |
| **Performance** | **C / E** | cycles/objectives/evaluations/competencies built; **`hr:performance:finalize` NOBODY** (HR-A4 seat); competency catalog now configurable since the m99 grant |
| **Imports** | **C / E** | upload→staging→correspondence→validation→**visa à quatre yeux** built; **application deliberately inactive behind HRQ-A4**, and the four-eyes visa is incompletable with one officer |
| **Préparation de paie** | **F** (correctly) | no code, no compensation data anywhere; needs DEC-B63 + CSS/IPRES/IPM statutory values first |
| **Offboarding** | **D / F** | lifecycle already has `TERMINATED` + rehire-is-new-record (DEC-B26); the workflow around it (exit checklist, equipment return, account deactivation) is unbuilt |
| **Reporting RH** | **F** (correctly) | nothing to report on until data exists |

**No class B (defective) and no class G (stale gap) anywhere** — a first for
these audits. The 2026-07-13 metadata trap does not apply here because HR's
docs were re-audited in HR-0P/0R (August), and today's census matches them.

## 4. The lifecycle journey, and exactly where it stops

Create employee ✅ → org assignment ✅ (validated targets) → account link ✅
(grants nothing) → onboarding ✅ (needs templates) → equipment ✅ → leave ⚠
(request yes; **approval seat empty**) → training ✅ (needs catalog) →
performance ⚠ (**finalize seat empty**) → offboarding ❌ (status exists,
workflow unbuilt).

**The journey stops at step zero — nobody has run it.** After that, the first
hard walls are the two empty seats and F2.

## 5. Security findings

* RLS + policies on all 35 tables; `employee_counter` deliberately deny-all;
  private `hr-documents` bucket; all HR tables in `TENANT_SCOPED_TABLES`
  (F1, fixed in HR-A1 — which also caught and closed a fail-open sensitive-
  document gate).
* Four-eyes controls are real and DB-backed: contract verification requires
  verifier ≠ preparer (CHECK constraint), import batches require a second visa.
* **F2 persists: ONE active HR_OFFICER** (`countHrOfficers` reports it honestly
  in the Ops Center, fail-closed). This blocks: contract verification, import
  quatre-yeux, and any future leave/performance maker-checker. **The control is
  correct — do not weaken it. The fix is a person**, assigned HR_OFFICER via the
  existing Administration screen.
* `hr:sensitive:read` stays parked until DEC-B63 legal gates clear. Correct.

## 6. What remains, by category

**Configuration/data (operator, no code):**
1. Run the Configuration studio session — numbering prefix, department units
   (from `CANONICAL_DEPARTMENTS`), positions, work sites.
2. Create the real employees in the registre (or wait for HRQ-A4 to unblock
   bulk import application).
3. Assign a **second HR_OFFICER** via Administration.
4. Configure onboarding checklist templates, training catalog, competency
   catalog (all now reachable under the live grant).

**Effitrans business decisions (nothing buildable without them):**
1. **Who approves leave** → name the `hr:leave:approve` seat (HR-A3 is one
   grant migration).
2. **Who finalizes evaluations** → name the `hr:performance:finalize` seat (HR-A4).
3. **HRQ-A4** — authorize import *application* (writes to the real tables).
4. **DEC-B63** — legal/consent gates for `hr:sensitive:read` and any payroll data.
5. Who the second HR_OFFICER is.

**Engineering (all downstream of the above):**
1. HR-A3 / HR-A4 seat grant migrations — trivial, blocked on the names.
2. HRQ-A4 import-application phase — blocked on the authorization.
3. HR-8 offboarding workflow — small; correctly sequenced after the core is in use.
4. HR-7 payroll, HR-9 reporting — correctly deferred; payroll additionally
   blocked on statutory values and DEC-B63.

## 7. Roadmap in dependency order

**HR-B0 (operator UAT, no code)** → **HR-A3** (leave seat) → **HR-A4** (perf
seat) → **HRQ-A4 import application** → **HR-8 offboarding** → **HR-9
reporting** → **HR-7 payroll** (last: heaviest business dependency).

## 8. Production UAT plan (HR-B0) — the smallest next step, and it is not code

As the HR_OFFICER account:

1. **Configuration** → set numbering (or accept `EMP` default) → create the
   department units → add real positions and work sites.
2. **Registre** → create the first real employee → verify **EMP-0001** →
   DRAFT → ACTIVE → the dashboard reads « 1 Employé actif ».
3. Optionally link the employee to their `app_user` → verify their permissions
   are unchanged (the link grants nothing).
4. Create the remaining employees with placements.
5. **Administration** → assign HR_OFFICER to a second named person → the Ops
   Center banner clears → verify a contract verification can now be completed
   by the second officer.
6. Onboarding: configure one checklist template; open a case for a new employee.
7. Équipements: assign one seeded equipment type to an employee.

Everything in this plan uses screens that already exist.

## 9. Answer to the closing question

> *What exactly remains before Effitrans can use HR for real employees in production?*

**One configuration session, the employees themselves, one more HR_OFFICER, and
two named approval seats.** No migration, no defect fix, no missing screen
stands between Effitrans and a working HR registry today.
