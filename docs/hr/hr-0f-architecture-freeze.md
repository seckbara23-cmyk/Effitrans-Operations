# HR-0F — Architecture Freeze: the Effitrans HR Platform

**Date:** 2026-08-01 · **Type:** architecture & governance only — no code, no migration,
no database or production change. · **Supersedes nothing:** this document **consolidates
and freezes**; where a question was already ratified (DEC-B59–B63, the 2026-07-31
governance addendum, the eleven additions) the ratified answer is restated with its
source, never re-opened.

**The corpus this freeze sits on** (all in `docs/hr/`): `hr-0-architecture-audit` ·
`hr-0r-reaudit-2026-07-31` · `hr-governance-addendum-2026-07-31` (**ratified**, incl. the
renumbered roadmap §11) · `hr-organization-and-lifecycle` · `hr-employee-master-field-dictionary`
· `hr-erd-roadmap-decisions` (ERD) · `hr-documents-permissions-scopes` ·
`hr-onboarding-offboarding` · `hr-setup-configuration-migration` · `hr-1-implementation-plan`.

**Standing context:** R1.1 (Finance Aging) acceptance is formally deferred at D2; its
remaining work is acceptance-only and independent of HR. The Employee Registry
(migration 57) is **already live in production** — HR-2 folds it into the workspace; no HR
phase re-creates it.

---

## Audit 1 — Existing platform reuse (classification of record)

The full per-structure table is `hr-0r-reaudit` §1; classifications below are the frozen
verdicts. Nothing here is new — this is the reuse contract.

| Component | Verdict | Why |
|---|---|---|
| Authentication (GoTrue + session classes) | **REUSE unchanged** | one login system; employee ≠ login (DEC-B59) |
| RBAC (`role`/`permission`/`user_role` + parity machinery) | **EXTEND** | add `hr:*` codes through the established trio + parity tests; never a second engine |
| Permission engine (`get_user_permissions`, `has_permission`) | **REUSE unchanged** | proven, RLS-integrated |
| Audit framework (`audit_log` + `writeAudit`) | **EXTEND** | add `hr.*` action constants; HR redaction convention already pinned (C3 values never in payloads) |
| Notification framework (staff rail + comms queue) | **REUSE unchanged** | honest-outcome delivery already the idiom |
| Document engine (`public.document`) | **DO NOT USE for HR files** | dossier-bound by design (`file_id NOT NULL`, dossier-inherited visibility); FIN-AGING-2 reached the same refusal. HR gets `hr_document` + a **private** bucket (HR-3) |
| Document expiry idiom (`has_validity`/`expiry_date`) | **REUSE (pattern)** | certificates, permits, CNI/passport expiry |
| Attachment/upload infra (private buckets, short-TTL signed URLs, server-mediated) | **REUSE (pattern)** | with HR-only storage policies |
| Workflow engine (26-step process engine) | **DO NOT USE** | dossier-shaped; HR flows are checklists + audited actions (Audit 7) |
| Maker-checker (structural `X <> Y` CHECKs) | **REUSE (pattern)** | contract verification, comp approval, import approval |
| Approval engine (expense visa chain) | **REUSE (pattern only)** | the visa *shape* (append-only attempts, step unique) informs HR approvals; the tables stay finance-owned |
| AI framework (`runCopilot(Detailed)`) | **REUSE (sibling pattern)** | HR Copilot as a SIBLING like Logistics/Platform Copilot; own gate; §Audit 10 |
| Dashboard framework (StatCard/PageHeader/hub tiles) | **REUSE unchanged** | HR-1's dashboard is composition, not invention |
| Import framework | **BUILD ONCE in HR-1, generalized** | ratified addendum §3: FIN-AGING-2's staging shape becomes the one pipeline (`hr_import_batch/_staging_row/_error`) |
| Search | **REUSE (pattern)** | directory search follows the staff-directory reader idiom (8.6A) |
| Digital signatures | **DO NOT BUILD** | no e-signature engine exists; HR-3 stores *signed scans* as documents; e-signature is a future platform capability, not an HR fork |
| User administration (`/users`, 3 credential modes, temp password, ban) | **REUSE unchanged** | the account steps of on/offboarding call it; never duplicated |
| Existing employee tables (`employee`, `employee_counter`, migration 57) | **REUSE — live** | the registry is shipped; HR-1 adds the org spine around it |
| Existing organization tables (`organization`) | **REUSE** | Company **is** the `organization` row (addendum §5) |
| Department structures (canonical 4-code registry, WES-3) | **REUSE as vocabulary — never as the HR org model** | navigation/dossier routing stays frozen; HR hierarchy is a separate, tenant-configurable tree |

## Audit 2 — Organization Designer (frozen specification)

**The ratified model (addendum §5) stands.** Two hierarchies exist by design and are never
conflated: platform navigation (fixed, 4 canonical codes, WES-3 dossier ownership) and the
HR organization (tenant-configurable). The requested example hierarchy maps onto the
ratified structures **without a sixth level**:

| Requested level | Frozen resolution |
|---|---|
| Company | the `organization` row itself — never a unit |
| Branch | **two meanings, two homes**: a *physical* branch/agence = `hr_work_location`; an *organizational* branch = `hr_org_unit(kind=BUSINESS_UNIT)` |
| Division | `BUSINESS_UNIT` (naming is tenant vocabulary; the kind is the level) |
| Department | `hr_org_unit(kind=DEPARTMENT)` — `canonical_department` **nullable** mapping to the 4 platform codes for interop |
| Section | `hr_org_unit(kind=SECTION)` |
| Team | `hr_org_unit(kind=TEAM)` |
| Position | `hr_position` (catalog), instantiated per employee via `employee_assignment` |
| Employee | `employee` (live) placed by **dated `employee_assignment`** (unit, position, manager, location, kind; one open row; append-and-close) |

Kind order descends `BUSINESS_UNIT → DEPARTMENT → SECTION → TEAM`, trigger-enforced; extra
depth is **rejected, not silently allowed** (ratified). Executive offices and shared
services (« Direction Générale », QHSE) are units with `canonical_department = null` —
exactly why the mapping was ratified nullable.

**Hierarchy semantics, frozen:**
- **Reporting hierarchy** = `employee_assignment.manager_employee_id` (person-to-person,
  dated, historized by append-and-close). Manager remains **display/organizational** —
  it grants no data access (DEC-B63 defers manager-scoped access).
- **Management vs operational hierarchy**: the *management* line is the assignment's
  manager chain; the *operational* line is the platform's department/role machinery
  (WES-3), untouched. A test pins that neither reads the other (ratified).
- **Dotted-line reporting**: **not in the ratified model** → decision item **HRQ-OD2**
  (proposed: `hr_reporting_line(kind=DOTTED)` additive table, HR-2+; rejected as a second
  column on the assignment — it would make "the manager" ambiguous).
- **Cost centers**: **absent from the corpus** → decision item **HRQ-OD1** (proposed:
  nullable `cost_center_code` on `hr_org_unit`, inherited downward, surfaced to Finance
  only through the HR-7 payroll-preparation export; Finance ratification required since
  the vocabulary is theirs).

## Audit 3 — Identity architecture (no shared lifecycles)

Frozen verdicts; the first three are implemented fact (`hr-0r-reaudit` §2):

| Identity | Record | Lifecycle owner | Frozen rule |
|---|---|---|---|
| Platform User | `app_user` | account lifecycle (8.1A archive/ban; migration 71 password) | never carries HR data; optional link target |
| Employee | `employee` | HR state machine (DEC-B62) | account-less is normal; the link **grants nothing** (trigger + tests) |
| Portal User | `client_user` | portal invite/lifecycle | never an `app_user`; dual-identity guard both directions |
| Driver | `app_user` with driver-only identity (`isDriverOnly`) | account lifecycle | an *employed* driver is additionally an `employee`; the two records link, never merge |
| Contractor | `employee` with `engagement_kind = CONTRACTOR` | HR machine (subset: no retirement path) | **HRQ-ID1** to ratify the kind vocabulary (EMPLOYEE · CONTRACTOR · INTERN · APPRENTICE) — one registry, one directory, distinct contract kinds (HR-3), not a parallel table |
| Vendor | operational registries (carriers/airlines idiom: retire-not-delete) | owning module | **not an HR identity**; procurement registry is future platform scope |
| External Contact | none today | — | Communications-era concern (R3.0); explicitly out of HR |
| Customer Contact | `client` attributes (non-login) / `client_user` (login) | CRM/portal | out of HR |

No identity inherits another's lifecycle; every link is a nullable foreign key whose
deletion semantics are "unlink", never cascade into the other identity.

## Audit 4 — Employee lifecycle (frozen machine)

The ratified machine (DEC-B62; mapped in `hr-organization-and-lifecycle` §2) is the
engine; **states are immutable, presentation is configuration** (addendum §6). The
requested 13-stage example resolves as:

- **Recruitment · Candidate · Offer** — *not employee states.* Pre-employment belongs to
  an ATS (HR-10 candidate, no repository trace; ratified as post-operational-HR). An
  employee record begins at **hiring**.
- **Hiring → Probation → Active** — `employee.status` begins ACTIVE; **probation is a
  contract attribute** (`employment_contract.probation_end`, HR-3), not a machine state —
  a probationary employee is legally active.
- **Promotion · Transfer** — *events, not states*: a new `employee_assignment` row
  (append-and-close) + `hr_employee_event` entries; status unchanged.
- **Leave** — `ON_LEAVE` is **derived** from approved leave (ratified §11/HR-5), never
  hand-set.
- **Suspension** — machine state, reason-coded (configured vocabulary).
- **Termination · Retirement** — terminal employment states; **rehire = new record**
  (ratified, HR-0); retirement is termination with kind RETIREMENT and its own
  document requirements (configurable per addendum §6).
- **Archive** — post-employment record state (archive-not-delete; attribution retained).

**Transition contract:** allowed transitions per the DEC-B62 table; forbidden = everything
else, enforced in the engine; every transition writes `audit_log` **and**
`hr_employee_event` in the same operation (WES-9 Model-A: mandatory-event failure aborts
the write); approval requirements are **configured gates** (`hr_transition_requirement`)
that can demand a reason code, a note, or a document — never new states.

## Audit 5 — HR domain breakdown → ratified phases

| Module | Phase (ratified §11) | Notes |
|---|---|---|
| Organization Management | **HR-1** | org spine + configuration center + wizard + import core |
| Employee Registry | **live** (migr. 57) → folds into **HR-2** workspace | |
| HR Dashboard | **HR-1 first page** (ratified §10) | composition over StatCard |
| Employee Timeline | ledger foundation **HR-1**, UI **HR-2** | `hr_employee_event`, WES-9 idiom |
| Contracts · Documents | **HR-3** | incl. `employee_identifier` (legal-gated), templates, private bucket |
| Onboarding · Assets/Equipment | **HR-4** | checklists + equipment (promoted, §8) |
| Leave · Attendance | **HR-5** | ON_LEAVE derived; attendance input contract |
| Performance · Training · Certifications | **HR-6** | restricted records; certifications reuse expiry idiom |
| Payroll Preparation | **HR-7** | compensation domain (C3) + versioned Finance export — an interface, never a payroll engine (DEC-B63) |
| Offboarding | **HR-8** | clearance gates; equipment return blocks completion |
| Reporting | **HR-9** | aggregates, k-anonymity, exports |
| HR AI Copilot | post-HR-2, sibling pattern | context from aggregates + C1/C2 only; **C3 never enters a prompt** |

## Audit 6 — Data architecture (conceptual model of record)

The ERD is `hr-erd-roadmap-decisions` (entity inventory + phase column, already aligned to
the ratified roadmap). Frozen summary:

- **Aggregate roots:** `employee` (everything personal hangs off it) · the `hr_org_unit`
  tree (structure) · `employment_contract` (verified legal fact) · `hr_import_batch`
  (staged truth) · `hr_employee_event` (the narrative ledger).
- **Reused entities:** `organization`, `app_user` (link only), `role/permission/user_role`,
  `audit_log`, notification/comms, storage buckets (pattern).
- **New entities:** as inventoried — `hr_configuration`, `hr_org_unit`, `hr_position`,
  `hr_work_location`, `employee_assignment`, `employment_contract`,
  `hr_document_type/hr_document`, `employee_identifier`, `hr_template_version`,
  `hr_checklist_template/_instance/_item`, `hr_equipment_category/_equipment/_equipment_assignment`,
  `hr_import_batch/_staging_row/_error`, `hr_leave_*`, `hr_employee_event`,
  `hr_status_presentation`, `hr_transition_requirement`.
- **Ownership boundaries:** HR owns employment; Finance owns money (HR-7 exports, Finance
  imports); operations own dossiers/tasks (an employee's platform work arrives via their
  *account*, never via the employee row); documents for HR live in `hr_document` only.
- **Tenant isolation:** every `hr_*` table tenant-scoped under the uniform RLS idiom
  (SELECT-only policies + service-role writes + tenant triggers), with the HR CI suite
  appended last in `ci.yml` per the standing rule.
- **Audit ownership:** `audit_log` = security trail; `hr_employee_event` = employment
  narrative (ratified distinction, addendum §7); C3 values appear in **neither**.
- **Data classes:** C1 org/structure · C2 personal · C3 sensitive (identifiers,
  compensation, medical) — C3 always behind its own permission, values never audited,
  never in AI context, never in exports by default (`hr-documents-permissions-scopes`).

## Audit 7 — Workflow architecture

**Frozen: HR does not use the 26-step process engine** (dossier-shaped; NOT APPLICABLE
verdict of record). HR workflows are **checklists + audited state transitions + structural
maker-checker**, the platform's other proven idiom:

| Workflow | Mechanism |
|---|---|
| Hiring | HR-4 onboarding checklist instance (pins its template version); account step calls `/users` machinery; completion gates |
| Promotion / Transfer | `employee_assignment` append-and-close + ledger event; approval gate = configured transition requirement |
| Leave approval | request → approve as a maker-checker pair (`requested_by <> approved_by` CHECK); approval derives ON_LEAVE |
| Contract renewal | new `employment_contract` version + maker-checker verification (preparer ≠ verifier); expiry surfaced by the dashboard from the expiry idiom |
| Performance review | HR-6 restricted record; reviewer ≠ subject structural check |
| Separation | HR-8 offboarding checklist; clearance gates (equipment returned, documents signed) block completion; prompts — never silently performs — the 8.1A account archive/ban |
| Asset assignment / recovery | `hr_equipment_assignment` open-row idiom; unreturned equipment blocks the offboarding checklist |

## Audit 8 — Permission architecture

Model of record: `hr-documents-permissions-scopes`. Frozen highlights:

- **Existing:** `hr:read`, `hr:manage` (live), held by HR_OFFICER (role 25). Colon-only
  codes (no hyphens — the 2fec38b lesson).
- **Ceiling 9 → 11 (HRQ-D2, pending ratification — the one permission blocker):** adds
  `hr:config:manage` (the ratified configuration center's gate) and `hr:sensitive:read`
  (identity documents / C3 reads). Later phases add their own families
  (`hr:leave:approve`, `hr:comp:*`) through the same parity machinery, each with the
  new-role/permission checklist from Phase 11.0B.
- **SYSTEM_ADMIN receives NO `hr:*`** — ratified at HR-0 and consistent with D-11:
  administering the platform is not employment authority. Recovery uses the audited
  override, never a grant.
- **Separation of duties:** import stage ≠ import approve; contract prepare ≠ verify;
  leave request ≠ approve; comp propose ≠ approve — all as structural CHECKs, not UI
  conventions.
- **No duplication:** HR adds codes to the one catalog; no HR-local role system, no
  second permission engine, and the deprecated `admin:users:manage`-style umbrella
  pattern is **not** repeated (HR starts granular).

## Audit 9 — Senegal compliance register

One correction to the requested list: Senegal's bodies are **CSS** (Caisse de Sécurité
Sociale — famille/accidents du travail), **IPRES** (retraite) and **IPM** (maladie);
"CNSS" is the naming used in several *other* jurisdictions and appears nowhere in the
ratified identifier set (`employee_identifier`: CNI/passport/IPRES/CSS/IPM — HR-3,
legal-gated). Register, with gaps:

| Area | Architecture answer | Gap / gate |
|---|---|---|
| Labour Code (Code du Travail) contract kinds | CDI/CDD (+stage/apprentissage per HRQ-ID1) as `employment_contract.kind`; CDD renewal limits as engine warnings, not silent blocks | statutory limits to be confirmed by counsel (DEC-B63) |
| CSS / IPRES / IPM numbers | `employee_identifier`, C3, own permission, values never audited | storage/retention legality per DEC-B63 legal gates |
| Employer identifiers (NINEA/RC) | already tenant metadata (invoice/branding path) | none |
| Leave regulation | HR-5 entitlement engine is **configuration-seeded** (statutory accrual as the default seed), never hard-coded | seed values confirmed by counsel |
| Retirement | termination kind RETIREMENT; age as configuration with statutory default | counsel confirmation |
| Required employee documents | `hr_document_type` required-set per contract kind; transition requirements can demand documents (addendum §6, e.g. solde de tout compte on termination) | list finalized with counsel |
| French localization | platform is French-first already; HR labels follow the tenant vocabulary system (ratified §5/§6) | none |
| Retention / purge | staging `raw` purge window = **HRQ-A4** (legal input); document retention classes per type in HR-3 | legal input required |
| Medical data | **out of scope by design** — no medical records in v1; IPM *number* only (C3) | future phase behind its own gate |

**Compliance posture:** the architecture stores nothing it cannot legally hold, makes
statutory values *configuration with counsel-confirmed seeds*, and gates every C3 surface.
Gaps are inputs, not design changes.

## Audit 10 — Cross-module integration (boundaries of record)

| Module | Integration | Boundary |
|---|---|---|
| Finance | HR-7 exports versioned payroll-preparation data; expense/caisse seats keep referencing `app_user` | HR never writes Finance tables; Finance never reads C3 directly |
| Operations / Transit / Customs | none direct — staffing analytics later via HR-9 aggregates | work assignment stays account-based (WES-3) |
| Fleet / Drivers | employed driver = `employee` ⟷ driver `app_user` link | link grants nothing; fleet module (future) reads the link, not the employee |
| Communications | notify rail reused for HR events (contract expiry, checklist due) | R3.0 owns channels; HR only emits |
| Brand Center | signatures/cards remain `app_user`-keyed | extension point: prefer employee display fields when a link exists (post-HR-2, additive) |
| Document Intelligence | OCR *suggestions* for HR documents (post-HR-3) | suggestions-only doctrine (7.4A) unchanged; writes stay human |
| Platform AI | HR Copilot = sibling of the three existing copilots, own permission, aggregates + C1/C2 context only | **C3 never enters a prompt**; k-anonymity floor from HR-9 applies to answers |

## Deliverable map (the 14 required outputs)

| Required output | Where it lives |
|---|---|
| HR Architecture Document | **this document** + `hr-0-architecture-audit` + `hr-0r-reaudit` |
| HR Domain Model / ERD | `hr-erd-roadmap-decisions` (conceptual ERD + inventory) |
| Organization Designer Specification | Audit 2 above + addendum §5 + `hr-organization-and-lifecycle` §1 |
| Employee Lifecycle State Machine | Audit 4 above + DEC-B62 + `hr-organization-and-lifecycle` §2 |
| HR RBAC Matrix / Permission Catalog | `hr-documents-permissions-scopes` + Audit 8 |
| Workflow Catalog | Audit 7 + `hr-onboarding-offboarding` |
| Integration Architecture | Audit 10 + addendum §9 (extension points) |
| Import Architecture | `hr-setup-configuration-migration` + addendum §3 |
| HR Phase Roadmap | addendum §11 (**ratified**), restated in Audit 5 |
| Risk Register | below |
| Decision Register | DEC-B59–B63 + addendum ratifications; **new items opened here: HRQ-ID1, HRQ-OD1, HRQ-OD2** |
| Architecture Ratification Report | the Final Decision section below |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Org tree misused for authorization | ratified wall: hierarchy grants nothing; pinned by tests both directions |
| R2 | C3 leakage via ledger/audit/AI/export | redaction discipline (kind+date, never amount) already ratified; every C3 surface behind its own permission; freeze forbids C3 in prompts |
| R3 | Import staging holds personal data indefinitely | HRQ-A4 purge window (legal gate) blocks HR-1's import activation |
| R4 | Statutory values hard-coded then wrong | all statutory numbers are configuration with counsel-confirmed seeds |
| R5 | Checklist engine drifts toward a second workflow engine | frozen NOT-APPLICABLE verdict on the 26-step engine; checklists stay flat template/instance/item |
| R6 | The live registry diverges from HR-1's org spine | HR-2 folds the registry into the workspace; `employee_number` immutability trigger ships in HR-1 (the known hardening gap) |
| R7 | Payroll scope creep | DEC-B63: preparation + export only; a payroll engine is out of scope permanently until separately ratified |

---

## Final Decision (Architecture Ratification Report)

### 1. Is the HR architecture frozen and implementation-ready?

**Yes — frozen.** Every structural decision an implementer would need is either ratified
(DEC-B59–B63, the addendum's eleven additions, the renumbered roadmap) or resolved in this
freeze (hierarchy mapping, identity types, workflow mechanisms, compliance posture,
integration boundaries). The items below are **ratification/legal inputs, not design
questions** — none changes a table shape; they change seed values, vocabularies and gates.
Implementation of HR-1 may be *prepared* immediately and may *start* once B1–B3 are
answered; B4–B5 gate later phases, not HR-1.

### 2. Blockers to resolve before implementation begins

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| B1 | **HRQ-D2** — permission ceiling 9 → 11 (`hr:config:manage`, `hr:sensitive:read`) | HR-1 (config center gate) | management ratification |
| B2 | **HR structure answers** — actual units/positions/locations, numbering keep-or-change, wizard operator, approval seats | HR-1 seed content | management |
| B3 | **HRQ-A4** — staging `raw` purge window | HR-1 import activation (schema unaffected) | legal |
| B4 | **HRQ-D1** — termination-reason vocabulary (configuration seed) | HR-1 config seed (defaultable, revisable) | management |
| B5 | **DEC-B63 legal gates** — identifier storage, retention classes, required-document sets, statutory seeds | HR-3 / HR-5 / HR-7 | counsel |
| B6 | **New, opened by this freeze:** HRQ-ID1 (engagement-kind vocabulary), HRQ-OD1 (cost centers — Finance vocabulary), HRQ-OD2 (dotted-line reporting) | HR-3 / HR-7 / HR-2+ respectively — **none blocks HR-1** | management (+ Finance for OD1) |

### 3. Recommended implementation sequence

**The ratified §11 roadmap, unchanged** — HR-1 (Dashboard + Organization Foundation:
dashboard shell, `hr_configuration`, org tree, positions, locations, `employee_assignment`,
setup wizard, import core + org imports, employee-number immutability trigger,
`hr_employee_event` foundation) → HR-2 (Employee Workspace + Timeline UI + EMPLOYEES
import) → HR-3 (Documents & Contracts) → HR-4 (Onboarding & Equipment) → HR-5 (Leave &
Attendance) → HR-6 (Performance & Training) → HR-7 (Payroll Preparation) → HR-8
(Offboarding) → HR-9 (Reporting & Analytics). Dark-first throughout; each phase behind the
standing rollout idiom; RLS suites appended last in CI; HR-1 starts on explicit go.
