# HR-0P — Full HR Architecture & Production Readiness Audit

**Mode:** AUDIT ONLY — nothing implemented, no migration, no production data changed.
**Date:** 2026-08-09. Production read via `supabase db query --linked` (read-only).
**Relationship to prior docs:** HR-0 (ratified 2026-07-24), HR-0R/HR-0A (2026-07-31),
HR-0F freeze (2026-08-01) remain binding. This audit re-bases them against what is
**actually in production today** and does not reopen any ratified decision.

---

## A. Architecture discovered

### The headline

**HR-1 through HR-6 are built, shipped, migrated and live in production — dark.**
The dashboard's "planned" tiles are only HR-7/8/9. What production is missing is not
software; it is **authority and data**: four permissions are catalogued but granted to
nobody, and every operational table holds zero rows because the only doors that write
them are behind those grants.

### Routes (11)

`/departments/hr` (Operations Center, gate `hr:read`) · `/registre` · `/[id]` (employee
file) · `/organisation` · `/onboarding` · `/equipement` · `/conges` · `/performance` ·
`/formation` · `/configuration` (gate `hr:config:manage`) · `/imports` (gate `hr:manage`).

### Server modules (24 under `lib/hr/`)

`actions` (registry+lifecycle), `assignment-actions` (HR-2 engine), `employee-file[-actions]`,
`onboarding[-actions]`, `leave[-actions]` + `leave/balance` + `leave/presence`,
`organization[-actions]`, `org-tree`, `performance[-actions]` + `performance/scoring`,
`training[-actions]` + `training/catalog`, `ledger` (timeline), `lifecycle` (pure status
machine), `read`, `validate`, `workspace` (HR-5A composition). 11 components under
`components/hr/`.

### Database (8 migrations, all applied; ledger clean)

| Migration | Phase | Creates |
|---|---|---|
| 57 `hr_employee_registry` | HR-1 (July) | `employee`, `employee_counter` |
| 73 `hr_organization_foundation` | HR-1B | `hr_configuration`, `hr_org_unit`, `hr_position`, `hr_work_location`, `employee_assignment`, `hr_employee_event`, `hr_import_batch/_staging_row/_error` + **2 ungranted permissions** + matricule-immutability trigger |
| 74 `hr_employee_workspace` | HR-2 | assignment engine invariants (append-and-close, one-open) |
| 75 `hr_documents_contracts` | HR-3 | `hr_document`, `hr_document_type`, `employment_contract`, `hr_template_version` + private `hr-documents` bucket |
| 76 `hr_onboarding_equipment` | HR-4 | checklist templates, `hr_onboarding_case/_item`, `hr_provisioning_request`, `hr_equipment/_type/_assignment` + 4 transactional RPCs |
| 77 `hr_leave_attendance` | HR-5 | `hr_leave_category/_entitlement/_request`, `hr_attendance_day` + decide RPC |
| 78 `hr_performance` | HR-6 | cycles, competencies, expectations, evaluations, objectives, assessments + finalize/guard RPCs |
| 79 `hr_training` | HR-6 | courses, plans, enrollments + RPCs |

**33 tables** total; **22 `hr_*` RPCs** live in production (assign/return equipment,
complete onboarding, decide leave, finalize evaluation, transition guards, immutability
guards, org-parent hierarchy check…).

### The authoritative identity model — no duplicate exists

* **`public.employee` is the person registry.** `user_profiles` **does not exist** (the
  brief's mention is answered: there is no such table to reconcile).
* Link to a platform account is **`employee.linked_app_user_id`** — nullable (account-less
  employees are first-class, DEC-B23), unique where not null (one employee per account),
  tenant-match enforced, and **linking grants no role or permission** in either direction.
* Roles/permissions stay entirely on `app_user`/`user_role`/`role_permission`. No HR code
  path feeds authorization.

### Department: metadata, not authorization — confirmed

Three representations exist **by design**, with clear authority:
1. `employee.department` — canonical code (`OPERATIONS/TRANSIT/FINANCE/HUMAN_RESOURCES`),
   a CHECK-constrained **metadata** column from HR-1, used for registry filters;
2. `employee_assignment` → `hr_org_unit`/`hr_position` — the **authoritative** placement
   history since HR-2 (append-and-close, one open assignment);
3. `hr_org_unit.canonical_department` — **nullable interop mapping** to the canonical
   registry; the 4-kind hierarchy (`BUSINESS_UNIT→DEPARTMENT→SECTION→TEAM`) is
   trigger-enforced descending.

Nothing reads any of the three for access control. The 29-role architecture interacts with
HR exactly as frozen: nav department ≠ HR org tree, and neither reads the other.

## B. Production state (verified read-only)

| Fact | Value |
|---|---|
| HR permission catalog | 6 rows: `hr:read`, `hr:manage`, `hr:config:manage`, `hr:sensitive:read`, `hr:leave:approve`, `hr:performance:finalize` |
| Granted | `hr:read` + `hr:manage` → **HR_OFFICER only**. The other **4 → NOBODY** |
| SYSTEM_ADMIN hr:* | **none** (DEC-B25 holds in production) |
| HR_OFFICER holders | **1** (the platform administrator), active |
| Seeded reference data | `hr_leave_category` 6 · `hr_equipment_type` 11 · `hr_document_type` 1 |
| Everything else | **0 rows** — employees, org units, positions, locations, configuration, assignments, contracts, documents, events, cases, equipment, requests, cycles, courses, imports |
| `hr-documents` bucket | exists, private |
| RLS | enabled with policies on every HR table; `employee_counter` is RLS-on/zero-policy (deliberate deny-all; numbering goes through the definer path) |

**Why every dashboard counter is zero:** they are honest reads of empty tables. No stub
returns zero; `Promise.allSettled` degrades unreadable figures to « indisponible », which
is rendered differently from 0. The "structure not configured" banner appears because
`hr_configuration` has no row, and it names its own cure: the wizard is behind
`hr:config:manage`, granted to nobody pending HRQ-D2.

## C. What already works (code-complete, awaiting authority/data)

Registry + lifecycle (rehire = new record; matricule immutable by trigger) · assignment
engine · employee file with documents/contracts (maker-checker, « solde de tout compte »
termination gate) · onboarding cases with config-driven checklists and equipment custody
(transactional RPCs — ADR-HR2-01 exercised) · leave (ON_LEAVE **derived**, never stored;
the status CHECK refuses it) · attendance input · performance cycles with
immutability-once-finalized · training catalog/enrollments/certificates · import pipeline
**stopping at READY by pinned design** · timeline ledger (`hr_employee_event`, WES-9 idiom)
· HR Operations Center composition.

## D. What is dark / gated (built, unreachable)

| Capability | Dark because |
|---|---|
| Configuration wizard (15 steps) | `hr:config:manage` granted to NOBODY (HRQ-D2 = B1 pause, structural and deliberate) |
| Sensitive document class (C3) | `hr:sensitive:read` granted to NOBODY (DEC-B63 legal gates open) |
| Leave **approval** | `hr:leave:approve` granted to NOBODY (HR-5 refused to fold it into `hr:manage` — that would make maker-checker decorative) |
| Evaluation **finalization** | `hr:performance:finalize` granted to NOBODY |
| Import **application** | pipeline pinned to stop at READY (HRQ-A4 staging-purge legal answer open) |

## E. What is missing (never built — matches the dashboard's own claims)

* **HR-7 Préparation de paie** — no tables, no code. Note: no compensation amount is
  stored anywhere (C3 discipline), so payroll prep is gated on DEC-B63 legal gates +
  `hr:sensitive:read` before it can even be designed honestly. Senegal bodies are
  CSS/IPRES/IPM; statutory values enter as counsel-confirmed configuration, never code.
* **HR-8 Offboarding** — no workspace; but its parts exist (termination gate,
  equipment return RPC, `admin:users:*` account disable). Smallest future build.
* **HR-9 Reporting RH** — nothing.
* **Employee self-service** — nothing (no route an ordinary employee can reach; all
  surfaces gate on `hr:read`, held only by HR_OFFICER). Correct separation today; a
  future decision, not a defect.

**No fake/demo UI, no dead action, no disconnected table, no competing source of truth
was found.** Two intentional tensions to keep visible: `employee.department` (metadata)
vs `employee_assignment` (authoritative placement) — reconcile at data-entry time; and
`hr_provisioning_request`/`hr_template_version` are legitimately dark until their flows run.

## F. Security / RLS findings

* **F1 — REGISTRY GAP (the one real defect):** only `employee` and `employee_counter`
  are in `TENANT_SCOPED_TABLES`. **All 31 other HR tables are absent**, which makes them
  *invisible* to the tenant-scope guard test — the guard cannot flag an unscoped
  service-role read it does not know about. Every current `lib/hr` read was spot-checked
  and does filter `tenant_id`, and RLS is the backstop, so this is defence-in-depth decay,
  not a live leak. **Fix in the next phase: test/registry change only, no migration.**
* **F2 — Four-eyes cannot complete with one officer.** Contracts maker-checker and the
  imports quatre-yeux visa need two distinct qualified people; production has **one**
  HR_OFFICER. Same lesson EMP-5H just taught for mail: verify the holder count before
  declaring a control operational.
* F3 — the four NOBODY grants are fail-closed pauses working as ratified, not gaps.
* F4 — SYSTEM_ADMIN exclusion, C3 column absence (test-pinned `FORBIDDEN_COLUMNS`),
  matricule immutability trigger, append-only ledger: all verified present.
* F5 — auditability: HR writes audit + emit `hr_employee_event`; no C3 in payloads.

## G. HRQ-D2 — the decision you actually need to make, in plain language

**The question:** *"Who may set up the HR structure, and do we also unlock the other
three parked authorities now?"* The permission **rows already exist** in production —
migration 73 created them deliberately ungranted, so ratification is **one grant
migration**, not a build.

There are four parked authorities, and they do **not** have to move together:

| Authority | Unlocks | Ready to grant? |
|---|---|---|
| `hr:config:manage` | The 15-step wizard → org units, positions, locations, numbering → **everything downstream** | **Yes** — pure structure, no sensitive data |
| `hr:sensitive:read` | C3 document class | **No** — DEC-B63 legal gates still open; granting now would outrun counsel |
| `hr:leave:approve` | Leave decisions | Needs a **named seat** (HR-5's options doc exists; deliberately no recommendation on *who* — organisational) |
| `hr:performance:finalize` | Locking evaluations | Same — needs a named seat |

**Options:**
* **A — Grant `hr:config:manage` to HR_OFFICER now; leave the other three parked.**
  One migration; unblocks the entire foundation; nothing sensitive moves.
* **B — A + name seats for `leave:approve` and `performance:finalize` in the same
  migration.** One ratification event instead of two; requires you to answer *who* today.
* **C — Create a new HR_ADMIN role above HR_OFFICER.** Rejected as scope creep: one
  person currently holds HR at all, and a second role with one holder adds a boundary
  with nobody on either side.

**Recommendation: A**, with B available if you can already name the approval seats.
Either way, `hr:sensitive:read` stays parked until DEC-B63 clears — that is a legal gate,
not an organisational one. **Separately (F2): appoint a second HR_OFFICER**, or contracts
and import visas can never complete — that is a role assignment through the existing user
admin, not a migration.

## H. Recommended roadmap (derived from what exists — not the assumed HR-1…HR-9)

The assumed sequence is wrong for this repo: its HR-1..HR-6 are **done**. What remains is
three activations, then three builds:

| Phase | Nature | Reused | New | Migration | Perms | Depends on | UAT gate | STOP |
|---|---|---|---|---|---|---|---|---|
| **HR-A1 Foundation activation** | ACTIVATION | wizard, org engine, dashboard | F1 registry fix (tests only) | **One grant migration** (HRQ-D2 outcome) | `hr:config:manage` | HRQ-D2 + B2 structure answers (units/positions/numbering) | wizard completes; `hr_configuration` row exists; banner gone; counters live | any seed **migration** for org data (must be a UI session — audit trail) |
| **HR-A2 Registry population** | ACTIVATION | registry, assignment engine, imports-to-READY | none | none (manual entry) — import **application** needs HRQ-A4 first | existing | HR-A1; **second HR_OFFICER** for visas | N employees ACTIVE with assignments; ledger events flowing | applying an import batch while HRQ-A4 is open; touching C3 |
| **HR-A3 Leave & ops activation** | ACTIVATION | leave engine, entitlements, onboarding, equipment | none | one grant migration (`hr:leave:approve` seat) | `hr:leave:approve` | HR-A2 + named seat | first request decided by a non-requesting approver | granting approve to `hr:manage` holders wholesale |
| **HR-A4 Performance & training activation** | ACTIVATION | HR-6 engines | none | one grant migration (`finalize` seat) | `hr:performance:finalize` | HR-A2 + named seat | one cycle opened→finalized | self-finalization |
| **HR-7 Payroll preparation** | BUILD | attendance, leave, contracts | new tables + C3 handling | yes, dark/additive | `hr:sensitive:read` + likely new `hr:payroll:*` (ceiling ratification) | DEC-B63 legal gates; CSS/IPRES/IPM counsel values | prep sheet matches a hand-computed month | inventing any statutory value |
| **HR-8 Offboarding** | BUILD (small) | termination gate, equipment return, `admin:users:*` | one workspace composing them | likely none | existing | HR-A2 | full offboard leaves correct terminal states | deleting anything |
| **HR-9 Reporting** | BUILD | ledger + all reads | read-only composition | none | `hr:read` (+ sensitive split honored) | HR-A2+ | figures reconcile with registry | C3 in any export |

## I. First implementation phase after approval

**HR-A1 — Foundation activation.** Contents, precisely:
1. the HRQ-D2 grant migration (option A or B as you ratify), CI-green **before** any
   operator SQL (the standing rule from the 42703 incident);
2. `TENANT_SCOPED_TABLES` registration of all 31 missing HR tables (F1 — tests only);
3. the second-HR_OFFICER role assignment (user admin, no migration);
4. a **UI configuration session** — the wizard, as the audited write path; never a seed
   migration;
5. smoke: banner cleared, structure counters non-zero, timeline emitting.

Blocked until: **your HRQ-D2 decision** and the B2 structure answers (unit list,
positions, matricule numbering scheme, who operates the wizard).

---

## Gap matrix

Legend: ✅ present · ◐ partial · ⬛ dark (built, unreachable) · ✖ absent

| Capability | UI | DB | Actions | Permission | RLS | Prod data | **Status** | Gap |
|---|---|---|---|---|---|---|---|---|
| HR dashboard | ✅ | ✅ | ✅ reads | `hr:read` granted | ✅ | 0 | **COMPLETE** | data only |
| Employee registry | ✅ | ✅ 57 | ✅ | `hr:read/manage` granted | ✅ | 0 | **COMPLETE** | data only |
| Organisation (read) | ✅ | ✅ 73 | ✅ | granted | ✅ | 0 | **COMPLETE** | upstream config |
| Configuration wizard | ✅ | ✅ 73 | ✅ | **NOBODY** | ✅ | 0 | **BLOCKED** | HRQ-D2 grant |
| Assignments (HR-2) | ✅ | ✅ 74 | ✅ | granted | ✅ | 0 | **DARK** | needs org+employees |
| Documents/contracts | ✅ | ✅ 75 | ✅ | ◐ sensitive=NOBODY | ✅ | 0 | **PARTIAL** | C3 legally gated; 2nd officer for visa |
| Onboarding | ✅ | ✅ 76 | ✅ +RPCs | granted | ✅ | 0 templates | **COMPLETE** | template seeding session |
| Equipment | ✅ | ✅ 76 | ✅ +RPCs | granted | ✅ | 11 types | **COMPLETE** | data only |
| Leave requests | ✅ | ✅ 77 | ✅ | granted | ✅ | 6 categories | **COMPLETE** | entitlements to enter |
| Leave approval | ✅ | ✅ 77 | ✅ RPC | **NOBODY** | ✅ | 0 | **BLOCKED** | seat + grant |
| Attendance | ✅ | ✅ 77 | ✅ | granted | ✅ | 0 | **COMPLETE** | data only |
| Performance | ✅ | ✅ 78 | ✅ +RPCs | ◐ finalize=NOBODY | ✅ | 0 | **PARTIAL** | seat + grant |
| Training | ✅ | ✅ 79 | ✅ +RPCs | granted | ✅ | 0 | **COMPLETE** | data only |
| Imports → READY | ✅ | ✅ 73 | ✅ | granted | ✅ | 0 | **COMPLETE** | by design |
| Import application | ✖ | ✅ | ✖ pinned | — | ✅ | 0 | **BLOCKED** | HRQ-A4 legal |
| Payroll prep (HR-7) | ✖ tile | ✖ | ✖ | ✖ | — | — | **MISSING** | build + legal gates |
| Offboarding (HR-8) | ✖ tile | ◐ parts | ◐ parts | existing | ✅ | — | **MISSING** | small build |
| Reporting (HR-9) | ✖ tile | — | ✖ | — | — | — | **MISSING** | build |
| Self-service | ✖ | — | ✖ | ✖ | — | — | **MISSING** | future decision |
| Tenant-guard registry | — | — | — | — | **◐ F1** | — | **PARTIAL** | register 31 tables |
