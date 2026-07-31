# HR Governance Addendum — Ratification of HR-0R/HR-0A + Eleven Additions

**Date:** 2026-07-31 · **Status:** HR-0R and HR-0A **approved**; the additions below are
incorporated into the architecture. Documentation only — implementation begins with HR-1
on explicit go.

The guiding sentence, adopted verbatim as the module's charter:
**this is not "Effitrans HR"; it is the Effitrans HR *Platform*.** Everything
company-specific is configuration; everything operational is engine. Every future HR phase
is measured against that split before it is measured against anything else.

---

## 1–2. Setup Wizard as the permanent configuration center · Configuration Registry

**Ratified, with an upgrade to the wizard's role**: it is not a one-shot populate-tables
flow but the tenant's **HR configuration center** — the same screens serve first-run setup
(stepper mode, restartable while `hr_configuration.status = 'DRAFT'`) and post-activation
administration (per-catalog pages over the same forms). One implementation, two entry modes;
no second admin surface to drift from the wizard.

The step list is expanded to fifteen: **organization profile** (legal name, address,
employer identifiers — the profile fields the platform's `organization`/branding rows do
not already carry) · **business units** (§5) · departments · positions · reporting
hierarchy · work locations · employee numbering · leave policies · contract types ·
document requirements · onboarding checklist · offboarding checklist · payroll-preparation
configuration · equipment catalog · HR notification preferences.

The registry separation is confirmed as three strata — engine (never tenant-specific),
`hr_*` configuration tables, operational employee data — and the engine/config test from
the addendum becomes doctrine: *if two tenants could legitimately differ on it, it is
configuration; if changing it safely needs a code review, it is engine.*

## 3. One import framework, everywhere

**Ratified.** The Finance Aging pipeline shape (upload → staging → column mapping →
validation → duplicate detection → preview → maker-checker approval → production, with
provenance marking and structurally-impossible rejected-row leakage) is now the platform's
**single import philosophy**. HR implements it as one pipeline with per-kind
mapping/validation modules — never a per-domain importer — and **no HR data ever bypasses
staging**, including the very first employee load.

## 4. Templates as versioned business assets

**Ratified and expanded.** `hr_template_version` kinds now include **transfer letters** and
**warning letters** alongside contracts, amendments, onboarding/offboarding checklists,
promotion letters, leave forms and equipment-assignment forms. The immutability rule is
unchanged and mechanical: a version becomes immutable the moment anything references it
(pinned-template trigger, the `aging_template_version` proof), so no template change can
rewrite a historical document.

## 5. HR organization — five levels, distinct from navigation

**Ratified, and it reshapes `hr_org_unit`.** Two hierarchies now exist by design and must
never be conflated:

| Platform navigation (FIXED) | HR organization (TENANT-CONFIGURABLE) |
|---|---|
| The frozen sidebar + the canonical department registry (4 codes) — operational routing and WES-3 dossier ownership | `Company → Business Unit → Department → Section → Team` — the employer's real structure |

Design resolution (supersedes the earlier single-kind `hr_org_unit`):

- `hr_org_unit.unit_kind` ∈ `BUSINESS_UNIT · DEPARTMENT · SECTION · TEAM`; **Company is the
  `organization` row itself**, not a unit. Parent chains must descend the kind order
  (enforced by trigger); depth beyond four levels is rejected rather than silently allowed.
- `hr_org_unit.canonical_department` becomes **nullable**: an HR unit *may* map to one of
  the four platform codes for interop (so an employee's platform-facing department can be
  derived), but cross-cutting units (e.g. « Direction Générale », « QHSE ») need no forced
  mapping. `employee.department` (canonical, CHECK-constrained) remains the platform-facing
  value and is **derived from the assignment's unit mapping when one exists**, hand-set
  otherwise — the registry itself is untouched.
- The navigation hierarchy is never read by HR, and the HR hierarchy is never read by
  navigation — a test pins both directions once HR-1 lands.

## 6. Employment states — engine; presentation configurable

**HRQ-A1 is ratified as recommended**: the state machine is engine and immutable. Tenant
configuration owns the presentation ring around it: per-state **labels** and **colors**,
**reason-code vocabularies** per transition, **transition note requirements**, and
**required documents per transition** (e.g. « TERMINATED requires the signed solde de tout
compte » once HR-3 documents exist). Stored in configuration (`hr_status_presentation`,
`hr_transition_requirement`), consumed by the engine's gate at transition time — the
machine checks *that* the configured requirements are met; it never lets configuration add
or remove states or transitions.

## 7. The Employee Timeline — a ratified NEW requirement

One chronological history per employee, spanning every domain. Architectural resolution:

- **An append-only `hr_employee_event` ledger, following the WES-9 business-event idiom**
  (the platform's proven pattern for exactly this): domain actions write their event in the
  same operation as the domain write; mandatory-event failure aborts the write; rows are
  `prevent_mutation`-protected. The Timeline UI is a projection of this ledger.
- This **supersedes the ERD's rejection of `employee_status_history`** — the rejection
  targeted a *status-only duplicate of audit*; the ratified requirement is a *cross-domain
  employment ledger* (created · contract signed · onboarding started · account created ·
  department/manager changed · promotion · salary **revision event without the amount** ·
  leave approved · training completed · equipment assigned/returned · performance review ·
  transfer · offboarding · archive). Audit log and ledger serve different readers: audit is
  the security trail (who did what, forensically); the ledger is the employment narrative
  (what happened to this person's employment, presentably).
- Redaction discipline carries over unchanged: C3 values never appear — a salary revision
  is an event whose payload is the *kind and date*, never the amount; the amount lives in
  the compensation domain behind its own permission.

## 8. Equipment — promoted into the core roadmap

**Ratified.** Equipment (categories in configuration; `hr_equipment` +
`hr_equipment_assignment` operational) ships with onboarding in **HR-4**, integrated both
ways: assignment as an onboarding checklist item, return as an offboarding gate
(unreturned equipment blocks checklist completion, never the termination itself).

## 9. Future integrations — extension points only

Documented as **interfaces, not implementations**, each behind the engine/config boundary:

| Integration | Extension point (design stance) |
|---|---|
| Biometric attendance | HR-5 ingests attendance *records* through a provider-neutral input contract (the tracking-provider and AI-provider abstractions are the precedents); devices post to an adapter, never to tables |
| Payroll provider | HR-7's Finance interface exports approved payroll-preparation data as a versioned, hashed snapshot (aging-artifact idiom); provider adapters consume the export |
| Microsoft 365 / Google Workspace | account provisioning stays in `/users`; an identity adapter can *propose* account creation from onboarding checklists — it never bypasses `admin:users:create` |
| Centralized communications assignment | offboarding reassignment items link to the existing messaging/dossier reassignment actions; an adapter can automate the proposal, the action stays the platform's |
| Document signing | `hr_document` gains a `signature_status` + provider-reference column pair when a provider is chosen; the hash-at-upload discipline already anticipates signed-copy verification |
| Learning management | HR-6 training records accept an external-course reference; completion events land in the Timeline ledger |
| Asset management | `hr_equipment` is deliberately minimal; a future asset system would *own* assets and HR would hold assignment references — the boundary is the assignment, not the asset |

## 10. The HR Dashboard is HR-1's first page

**Ratified.** `/departments/hr` becomes the **HR Dashboard**; the employee directory
becomes one workspace tile of it (the Finance-hub composition pattern). Widgets and their
honest phasing — each card appears when its domain exists and **degrades by absence, never
by fabrication** (the cockpit's `allSettled` discipline):

| Widget | Lives from |
|---|---|
| Headcount (by status, unit) | HR-1 (registry is live) |
| Onboarding in progress / Probation ending | HR-1 (derived from dates) / HR-4 (checklists) |
| Contracts expiring | HR-3 |
| Leave today | HR-5 |
| **Birthdays** | **optional AND legally gated** — requires DOB, which is absent-by-test until the legal review admits it (C2/C3 decision). The card ships only if that gate opens; the dashboard never becomes the reason to collect a field. |
| Pending approvals (imports, documents, leave) | with each domain |
| Document expirations / missing required documents | HR-3 |
| Equipment pending return | HR-4 |

## 11. Roadmap — renumbered as ratified

| Phase | Scope | Notes |
|---|---|---|
| HR-0R / HR-0A | re-audit + setup/migration architecture | ✅ done, approved |
| **HR-1** | **HR Dashboard + Organization Foundation**: dashboard shell + headcount cards · `hr_configuration` · five-level `hr_org_unit` · `hr_position` · `hr_work_location` · `employee_assignment` · setup wizard (config-center mode) · import framework core + org-kind imports · employee-number immutability trigger · `hr_employee_event` ledger foundation | the former HR-1B+1C, plus the dashboard and ledger |
| **HR-2** | **Employee Workspace**: directory + profile become a dashboard workspace; Timeline UI over the ledger; `EMPLOYEES` import kind | the shipped registry folds in here |
| **HR-3** | Documents & Contracts: `hr_document(_type)`, `employment_contract`, `employee_identifier` (legal-gated), templates incl. transfer/warning letters, private bucket | |
| **HR-4** | Onboarding & Equipment: checklists, equipment catalog + assignments, account-step integration | equipment promoted per §8 |
| **HR-5** | Leave & Attendance: categories/entitlements from config; ON_LEAVE derived; attendance input contract (§9) | |
| **HR-6** | Performance & Training | restricted records |
| **HR-7** | Payroll Preparation: compensation domain (C3) + versioned Finance export | |
| **HR-8** | Offboarding: full flow over checklists + reassignment + clearance gates | |
| **HR-9** | Reporting & Analytics: aggregates, k-anonymity, exports | |

## Remaining open items (unchanged by this ratification)

- **HRQ-D2** — the permission ceiling 9 → 11. Now *effectively required*: the ratified
  configuration center needs its gate (`hr:config:manage`), and identity documents need
  `hr:sensitive:read`. Still listed for explicit ratification because the ceiling itself
  was explicitly ratified.
- **HRQ-A4** — staging `raw` purge window (legal input).
- **HRQ-D1** — termination-reason vocabulary (now a *configuration* seed list per §6).
- The HR-management structure questions (units, positions, numbering keep/change, wizard
  operator, approval seats).
- All DEC-B63 Senegal legal gates.

HR-1 starts on explicit go, behind the standing operator sequence (68 → 72).
