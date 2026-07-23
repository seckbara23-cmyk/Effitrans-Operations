# HR-0 — Human Resources Architecture Audit

**Date:** 2026-07-24 · **Type:** audit/design only — **no implementation, no migration, no permission/role/RLS/navigation change**
**Repo state audited:** commit `6e18816` (post-9.3C, CI green)

---

## 1. Executive summary

The platform has **no HR module and no employee record of any kind** — verified by exhaustive schema and code search (zero occurrences of hire/termination/salary/compensation/emergency-contact/national-ID/leave/attendance/payroll fields anywhere in migrations, seed, or code). `HUMAN_RESOURCES` exists solely as canonical-registry metadata. Crucially, **the current architecture cleanly supports the four-concept separation** the mission requires (auth identity ≠ app user ≠ employee ≠ org metadata), because the platform already practices it in three of the four positions: authentication (`auth.users`), tenant membership/authorization (`app_user` + `user_role`), and org metadata (the departments registry, deliberately derived-from-roles and never authorization). The missing concept — the **employee record** — can be added as a new bounded context (`lib/hr`, an `employee` table) that references `app_user` optionally, without touching any existing lifecycle.

The two most important audit findings:

1. **Nothing existing can be repurposed as the employee record.** The closest candidates both fail structurally: `app_user` requires a login (`id` = `auth.users.id` PK) so it cannot represent employees without accounts; `workforce_profile` (Brand Center) also keys on `app_user` and is brand-identity data (email-signature/business-card), visible tenant-wide — the wrong privacy class for HR. The personnel-document need also cannot reuse `public.document` as-is: it is **dossier-bound** (`file_id NOT NULL`, visibility inherits the operational file).
2. **All the surrounding infrastructure is reusable:** tenant-scoped RLS helpers (`auth_tenant_id()`, `has_permission()`), the permission/role parity machinery, the archive-not-delete lifecycle + auth-ban session revocation, the private-bucket + server-mediated signed-URL storage pattern, the document-expiry pattern, the append-only audit log with safe-metadata conventions, and the `/users` UI/action patterns.

**Recommended HR-1:** a minimal Employee Registry at **`/departments/hr`** (sidebar entry "Ressources humaines" under MANAGEMENT — the exact pattern Direction already uses), gated by two new permissions (`hr:read`, `hr:manage`) held by one new role (`HR_OFFICER`; `HR_MANAGER` deferred until a second HR seat exists), one additive migration (the `employee` table + RLS + permissions/role), with compensation, personnel documents, leave and self-service all deferred.

---

## 2. Architecture discovered — current identity model

Four identity stacks exist, deliberately separate (Phase 4.0B; verified in code):

| Concept | Table | Key facts (verified) |
|---|---|---|
| Authentication identity | `auth.users` (GoTrue) | Email/password + OAuth; bans via `banned_until` |
| Tenant staff membership | `public.app_user` | **`id` = `auth.users.id` (PK, FK)** → one login = at most ONE tenant membership. Columns: `tenant_id, email, name, status ('active'\|'inactive'\|'archived'), is_system_admin`, presence (`last_login_at, last_seen_at, login_count, …`). Unique `(tenant_id, email)`; single `is_system_admin` per tenant. **No phone, no title, no department, no employment field.** |
| Portal customer identity | `public.client_user` | Same auth id may hold a portal identity; `classifySession()` resolves by **table membership** and (since 8.6) requires `app_user.status='active'` — an archived staff row cannot shadow a portal identity |
| Platform operator | `public.platform_admin` | Separate stack; no tenant RLS access |

- **Roles/permissions:** `role` (tenant-scoped, 24 codes incl. CASHIER), `user_role` (a user **can hold multiple roles** — production shows up to 151 user_role rows over 40 users), `role_permission`, effective permissions via `get_user_permissions` / `getEffectivePermissions`. Authorization is **roles/permissions only** — the codebase repeatedly enforces "department/team/title grants nothing" (departments registry header; `organization_team_member` comment; 9.3A).
- **Invitations:** there is **no invitation entity** — an invite *is* an `app_user` row plus GoTrue state; `lib/users/invitation-state.ts` derives `invited / setup_completed / cancelled` from facts (`last_login_at`, ban state). Resend/regenerate/cancel are actions over that derivation (Phase 6.0E).
- **Deactivation / revocation:** suspend = `status='inactive'`; archive = `status='archived'` (Phase 8.1A: archive-not-delete because `audit_log.actor_id` FKs `app_user`; structural admin-lockout protection); session revocation = auth ban (`setUserAuthBan`, extracted 8.1A). Termination-vs-access-revocation as *separate actions* is therefore **already the platform's idiom**.
- **Conflict check for account-less employees:** nothing in the identity stack breaks — but every current "person" surface (`/users`, staff directory, workforce_profile, messaging directory) iterates `app_user` and would simply **not see** account-less employees. That is correct behavior: those surfaces are account surfaces. The employee directory must be a new HR surface, not a widening of `app_user`.

**Verdict on the core rule:** ✅ supported. An `employee` table with `linked_app_user_id uuid NULL` satisfies all six principles without modifying any existing table or lifecycle.

## 3. Current organizational model

- `lib/organization/departments.ts` (Phase 9.0A): canonical departments **OPERATIONS, TRANSIT (parent OPERATIONS), FINANCE, HUMAN_RESOURCES** (`processesDossiers:false`). **Globally fixed in code, not tenant-configurable.** Department is **derived from roles** (`ROLE_CANONICAL_DEPARTMENT`, total over 24 codes; no user column exists) — a user's department is a display derivation from their primary role, so today a user effectively has **one displayed department** (multi-role users resolve via `ROLE_DISPLAY_PRIORITY`).
- **Teams:** `TRANSIT_TEAMS` (AIBD, MARITIME) + `organization_team_member` (9.0B: per-person Transit team membership, `active` flag, grants nothing). No branches/work-locations model.
- **Manager relationship: none anywhere.** The nearest analogues are dossier-scoped (`process_instance.owner_user_id`, `account_manager_id`) — ownership of *work*, not of *people*.
- **Job title:** free text in `workforce_profile.job_title` (Brand Center: `user_id PK → app_user`, phones, WhatsApp, photo, signature variant, public-card token). Brand display data, editable by the brand admin, and **account-required** — not an employment record.
- **Coupling check:** ✅ no department/title field is coupled to authorization anywhere (test-enforced: `organization.test.ts`, registry doctrine).
- **AIBD/Maritime/drivers/office staff:** modeled cleanly *for users with accounts* (roles + Transit teams). Field staff without logins are **unrepresentable today** — precisely the HR gap.

## 4. The `/users` boundary

`/users` (`lib/users/*`, gated `admin:users:manage`) is an **account administration** surface: create staff account (temp password), invitation lifecycle, role assignment, suspend/reactivate, archive (8.1A), session revocation, dual-identity guards (`email_is_staff` / `email_is_portal`, 8.6). It is **not suitable as the HR foundation** because its subject is the *login*, its lifecycle is *access* (invited→active→inactive→archived), its gate (`admin:users:manage`) is an IT/config power, and it cannot represent people without accounts. **Reusable patterns** (patterns, not the module): the table+filter+row-action UI idiom, the pure lifecycle state machine (`lib/users/lifecycle.ts`) as the template for an employment state machine, the derived-state approach (`invitation-state.ts`), server-action conventions (assertPermission → tenant check → CAS-ish guarded update → audit), and the email-conflict guard idiom for HR's "link account" flow.

## 5. Existing workforce-related assets — classification

| Asset | Finding | Classification |
|---|---|---|
| `app_user` (+ status lifecycle, presence) | account/membership; no employment data | **Must remain separate** — becomes the optional link target |
| `user_role` / role registry / parity machinery | authorization + the exact pattern for adding HR roles/perms | **Reusable as-is** (pattern) |
| `workforce_profile` (brand) | job_title/phones/photo, account-keyed, tenant-visible | **Must remain separate**; *read* as a convenience source when linking an employee to a user (pre-fill), never the record of truth. Risky if extended: wrong privacy class |
| `organization_team_member` | Transit team membership, grants-nothing idiom | **Reusable with extension** (pattern for HR org metadata; possibly reused for team display) |
| Departments registry | canonical codes incl. HUMAN_RESOURCES | **Reusable as-is** (employee.department = canonical code) |
| `document` / `document_type` / `documents` bucket | dossier-bound (`file_id NOT NULL`), validity/expiry columns (`expiry_date` + index; `has_validity`, `default_validity_days`), private bucket + short-TTL signed URLs, server-mediated | **Conflicting for direct reuse** (dossier-bound + visibility inherits the file) — but the *expiry pattern* and the *private-bucket/signed-URL/RLS pattern* are **reusable with extension** in a dedicated HR store |
| `audit_log` | append-only; actor/platform/client attribution; safe-metadata convention | **Reusable as-is** |
| Archive lifecycle + `setUserAuthBan` | archive-not-delete; ban = revocation | **Reusable as-is** for "terminate ≠ revoke" |
| RLS helpers `auth_tenant_id()`, `has_permission()` | support any `hr:*` code today | **Reusable as-is**; self-service/manager scoping will need one new helper later |
| Employee-domain fields (hire date, salary, national ID, leave, …) | zero occurrences anywhere | **Missing** (to be created in the HR bounded context) |

## 6. Proposed HR bounded context

New module `lib/hr/*` + `app/departments/hr/*`, owning employment. Nothing in Operations/Transit/Finance/messaging reads HR tables; HR reads `app_user` only to resolve/validate the optional link.

### 6.1 Entities (HR-1 core + HR-2/3 extensions)

**`employee`** (HR-1) — the employment relationship:
`id · tenant_id · employee_number (unique per tenant; generated like next_file_number) · status · first_name · last_name · preferred_name · professional_email · personal_email · professional_phone · personal_phone · department (canonical code CHECK) · job_title (text, HR-owned — distinct from brand's) · manager_employee_id (self-FK, null; cycle-guarded) · work_location · employment_type (CDI/CDD/STAGE/JOURNALIER/PRESTATAIRE — CHECK, finalized after legal review) · hire_date · probation_end_date · termination_date · termination_reason · linked_app_user_id (uuid NULL → app_user) · created_at/updated_at`.
**Normalization stance for MVP:** one table is acceptable for HR-1 *except* sensitive domains — **no salary, no national ID, no medical fields on `employee`** (they get their own, tighter-RLS tables in later phases). `emergency_contact` may be two nullable columns in HR-1 (name/phone) — low structure, moderate sensitivity, needed operationally.

**`employee_assignment`** (recommended **HR-2**, not HR-1): historized `department/job_title/manager/work_location` with `effective_from/effective_to`. Trade-off: full history from day one vs. MVP simplicity. **Recommendation:** mutable columns on `employee` in HR-1 **plus audited before/after on every change** (the audit log *is* the history until HR-2 materializes it). This keeps HR-1 one table without losing the trail.

**`employment_contract`** (HR-2): `contract_type, start/end, probation_end, status, document ref`. **HR-1 does not need it** — key dates live on `employee`; structured contracts arrive with personnel documents.

**`hr_document`** (HR-2): dedicated table (NOT `public.document`) + dedicated **private bucket `hr-documents`**, reusing the documents-bucket idioms (server-mediated, short-TTL signed URLs, soft delete, `expiry_date` + index for licenses/certifications) with **hr-specific storage policies** (see §9).

### 6.2 Employment status model

`DRAFT → ACTIVE → (SUSPENDED ⇄ ACTIVE) → TERMINATED → ARCHIVED`, pure transition table à la `lib/users/lifecycle.ts`.
- **ON_LEAVE: derived, not a status** — leave is a dated record (HR-3); making it a status forces daily mutation and corrupts history. (Matches the platform's derivation idiom: invitation state, document expiry, overdue invoices are all derived.)
- **SUSPENDED = employment suspension only.** Platform-access suspension remains `/users`' `status='inactive'` + auth ban — related but separate, per the core rule. HR termination may *offer* revocation (see decisions).
- **Terminated employees stay queryable** (archive-not-delete, like 8.1A).
- **Rehire = a new employment record** (immutable history preferred): HR-1 can defer by disallowing rehire onto a TERMINATED record; HR-2's assignment/contract history makes "new employment period" natural. Do not reactivate a terminated record.

### 6.3 Employee ↔ app-user link

`employee.linked_app_user_id uuid NULL references app_user(id)` with: a **partial unique index** on `linked_app_user_id` (one employee per user; since one auth id = one tenant membership, per-tenant uniqueness follows), a **tenant-match trigger** (the platform's standard `enforce_*_tenant` idiom), link/unlink as explicit audited actions that **never** touch `user_role` (linking grants nothing), and unlink/termination never deleting either record. The `app_user.id = auth.users.id` design **helps**: the link lands on the tenant-membership row, not the raw auth identity, so cross-tenant links are structurally impossible once tenant-matched. ✅ All eight expected constraints are satisfiable with existing idioms.

## 7. Personnel-document architecture (design only)

**Recommendation: hybrid — dedicated HR classification + dedicated private bucket, reusing the existing *patterns*.**
- Not the general `document` system: it is dossier-bound and its RLS inherits dossier visibility (`can_read_file`) — Operations/Transit staff with dossier access must never thereby read contracts or medical files.
- New `hr-documents` **private** bucket + `hr_document` table with its own RLS (`has_permission('hr:documents:read')` + tenant), server-mediated signed URLs only (existing idiom), soft delete, `expiry_date` for licenses/certifications (reusing the catalog's validity idiom), and category-level sensitivity (e.g. `CONTRACT, ID, DIPLOMA, LICENSE, MEDICAL, DISCIPLINARY, SALARY` — the last three readable only under stricter permissions).
- **Current storage policies cannot protect HR files** in the shared bucket paths — a dedicated bucket with hr-only storage policies is the only honest isolation. (No bucket is created in HR-0.)

## 8. Audit & lifecycle infrastructure

`audit_log` supports every listed HR event today (new `hr.*` action constants are additive, like `finance.*` in 9.0E). **Redaction rule to adopt:** payloads carry *safe metadata only* — entity ids, status before/after, category, dates. **Never in audit payloads:** salary amounts, medical details, national-ID/passport numbers, emergency-contact details, contract bodies, personal addresses. Precedent exists both ways (9.0B blockers deliberately exclude description bodies; 9.0E audits amounts) — HR must follow the stricter 9.0B convention, and HR-1 tests should pin it (the 9.0E test-47 pattern: assert no sensitive field name appears in `writeAudit` blocks).

## 9. Future RLS principles (no policies written)

Tenant-scope every HR row (`tenant_id = auth_tenant_id()`); gate reads on `has_permission('hr:read')` etc. — both helpers already exist and suffice for HR-1. Employees are **not** authorization principals; only the link to `app_user` ever connects them to a session. Self-service (later) needs one new helper (`hr_self_employee_id()`: resolve `auth.uid()` → linked employee) and manager access (later) a recursive/direct-report helper — **new HR-specific helpers, HR-3+**. Compensation/disciplinary/medical tables get their own stricter policies (separate permissions), never piggyback on `hr:read`. Writes go through service-role server actions (platform idiom), so RLS is SELECT-only like 9.0B/9.0E tables; service-role reads must carry explicit tenant filters (tenant-scope guard test covers `lib/` automatically once the tables are registered in `lib/db/tenant-tables.ts`). Cross-tenant impossibility via the standard tenant triggers.

## 10. Proposed permissions, roles, access matrix

**Permissions (HR-1 needs only the first two):**
- `hr:read` — employee directory + employment data (no documents, no compensation)
- `hr:manage` — create/update employees, lifecycle, account-link
- Later: `hr:documents:read` / `hr:documents:manage` (HR-2), `hr:leave:read` / `hr:leave:manage` (HR-3), `hr:compensation:read` / `hr:compensation:manage` (HR-7 boundary; **yes — compensation needs its own permission pair**, stricter than `hr:manage`), `hr:reports:read` (HR-9). Nine candidates ratified as the ceiling; do not add more.

**Roles:** start with **`HR_OFFICER`** (holds `hr:read` + `hr:manage`; maps `ROLE_CANONICAL_DEPARTMENT.HR_OFFICER = "HUMAN_RESOURCES"` — giving the registry its first mapped role). Add `HR_MANAGER` only when a real approval split (e.g. compensation vs. operation) exists — one seat needs one role; premature manager/officer splits are permission proliferation.

**Access matrix (proposed — final grants are an approval item):**

| Actor (existing role) | Directory | Personal contact | Employment data | Contracts/ID docs | Compensation | Leave | Disciplinary | Account-link / termination | Reports |
|---|---|---|---|---|---|---|---|---|---|
| HR_OFFICER (new) | ✅ | ✅ | ✅ | ✅ (HR-2) | ❌ until compensation perm exists | ✅ (HR-3) | ✅ (HR-6) | ✅ | ✅ |
| HR_MANAGER (later) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CEO (« Direction générale ») | ✅ | ❌ | ✅ (read) | ❌ | ❌ (until explicitly approved) | read | ❌ | ❌ | ✅ |
| FINANCE_OFFICER (nearest "Finance Manager") | ❌ | ❌ | ❌ | ❌ | payroll *inputs* only via the HR→Finance interface (HR-7), never raw HR | ❌ | ❌ | ❌ | ❌ |
| SYSTEM_ADMIN | ❌ by default (see below) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (accounts side stays theirs: `/users`) | ❌ |
| OPS_SUPERVISOR / dept managers | ❌ HR-1; direct-reports read = HR-3+ decision | ❌ | ❌ | ❌ | ❌ | approve own team (HR-3) | ❌ | ❌ | ❌ |
| Employee (self, linked) | self only (HR-8) | self | self | self (own docs) | own payslips (HR-7/8) | own | ❌ | ❌ | ❌ |
| Platform admin | ❌ — platform stack has no tenant-data access by construction; keep it that way | | | | | | | | |

**On SYSTEM_ADMIN:** the platform's *general* convention grants SYSTEM_ADMIN every module permission (9.3A followed it for `caisse:manage`), **but** the doctrine already supports withholding: `process:override` is granted to *no* role, `process:decision:approve` and `executive:dashboard:read` are deliberately narrow. HR data is the strongest case yet for narrowness: **recommend SYSTEM_ADMIN receives no `hr:*` permission by default** (they administer *accounts*, not *people*), surfaced below as an explicit approval item since it breaks the usual convention.

## 11. Payroll boundary

HR owns: employee identity, employment status, contract metadata, department/title, leave/attendance inputs, and an **approved compensation reference** (grade/amount) once the compensation domain exists. Finance owns: payroll calculation/import, payable approval, payment execution (the 9.0E `finance_request` + Caisse rails are the natural disbursement seam), accounting, reconciliation. **Salary amounts should live in a separately-restricted compensation domain inside HR** (`hr:compensation:*`), never on `employee`, never readable via `hr:read`, and cross the boundary to Finance only as approved payroll inputs. No payroll engine before HR-7, and even then favor "import/interface" over "engine".

## 12. Privacy & threat model (summary)

Top risks and mitigations: **cross-tenant leakage** (standard triggers + tenant-scope guard test + RLS suite in CI — same rails as 9.0B/9.0E); **overpowered tenant admin** (withhold `hr:*` from SYSTEM_ADMIN — see decisions); **Finance overreach** (no `hr:*` to finance roles; payroll interface only); **document URL leakage** (dedicated private bucket, short-TTL signed URLs, no public paths, no predictable names); **sensitive values in logs/audit** (redaction rule §8, pinned by tests; never log request bodies in HR actions); **exports/enumeration** (no bulk export in HR-1; directory paginated + permission-gated; employee_number non-sequential or padded is acceptable — ids never exposed); **manager-graph abuse** (defer manager *access* until a verified model exists; `manager_employee_id` is display-only in HR-1); **broken account linking** (constraints §6.3 + audited link/unlink); **terminated-but-active access** (termination surfaces a *prompt* to run the existing 8.1A archive/ban flow — never silent, never automatic without approval); **orphaned documents** (hr_document FKs employee, soft-delete, retention decision flagged); **excessive collection** (HR-1 collects the registry minimum; no DOB/marital/national-ID until the legal review justifies them); **platform-support exposure** (platform stack has no tenant-table access — preserve; no HR data in any platform copilot context).

## 13. Senegal-localization flags (no legal assumptions encoded)

- **Repository findings:** nothing Senegal-HR-specific exists; currency/locale are XOF/fr-FR; contract-type vocabulary and leave rules are absent.
- **Likely localization needs (flag, not fact):** contract types (CDI/CDD/stage/journalier), probation limits per contract type, annual-leave accrual, sick/maternity/paternity leave, working hours & overtime, disciplinary procedure formalities, termination documentation, payslip retention duration, personnel-file privacy & data-retention duties, social-security (IPRES/CSS) and tax (NINEA) identifiers, driver/medical certifications for transport staff.
- **Require legal verification before implementation:** every item above — especially which identifiers may be stored, retention periods, and mandatory contract/termination records. HR-1 deliberately needs none of them (registry fields only).

## 14. HR-1 MVP recommendation

**Scope (accepted with trims):** HR dashboard + employee directory + employee profile; employee_number, names, department (canonical code), job_title, manager (display-only), work_location, employment_type, hire_date, status lifecycle, contact details, emergency contact (2 fields), optional app-user link, full audit trail. **Trimmed from the proposal:** personnel documents → HR-2 (they need the bucket + stricter permissions; shipping them in HR-1 doubles the security surface of the MVP).
**Route:** **`/departments/hr`** — *not* `/management/hr`: no `/management/*` route tree exists; the MANAGEMENT sidebar section already points at `/departments/management` (Direction), so an HR page under `/departments/` with a MANAGEMENT sidebar entry is the established pattern.
**Sidebar:** MANAGEMENT → `Direction · Ressources humaines · Rapports · Tableau exécutif`, item gated `hr:read` — this finally unblocks the 9.3C Scope-F item honestly. Frozen-sidebar tests to update: `journeys.test.ts` (management labels + route map), `finance-hub.test.ts` (the HR-blocker guard asserting MANAGEMENT has no HR item — flips to asserting it does).
**Migration (one, additive):** `employee` table (+ indexes, tenant trigger, SELECT-only RLS on `hr:read`) + permissions `hr:read`/`hr:manage` + role `HR_OFFICER` + grants — the standard parity trio + registries + pins (§17).

## 15. Roadmap

| Phase | Goal | Principal entities | Routes | Permissions | Migration | Key risks |
|---|---|---|---|---|---|---|
| HR-0 | this audit | — | — | — | none | — |
| HR-1 | Employee Registry | `employee` | `/departments/hr` | `hr:read`, `hr:manage`; role `HR_OFFICER` | 1 additive | scope creep into docs/pay |
| HR-2 | Personnel documents & contracts | `hr_document`, `employment_contract`, (opt.) `employee_assignment` history | +`/departments/hr/[id]/documents` | `hr:documents:*` | 1 additive + private bucket | storage-policy correctness |
| HR-3 | Leave management | `leave_request`, balances (derived first) | +leave tab | `hr:leave:*`; manager-approve decision | 1 additive | legal accrual rules |
| HR-4 | Attendance & scheduling | attendance records | — | reuse leave perms or add | 1 | device integrations (defer) |
| HR-5 | Training & certifications | certification records (expiry idiom) | — | reuse `hr:documents:*` | small | — |
| HR-6 | Performance & disciplinary | restricted records | — | tighter than `hr:manage` | 1 | privacy |
| HR-7 | Payroll integration | compensation domain + Finance interface (feeds `finance_request`/Caisse rails) | — | `hr:compensation:*` | 1 | the strictest data on the platform |
| HR-8 | Employee self-service | self-scope RLS helper | portal-like surface | self-scoped | policies | identity-link correctness |
| HR-9 | Reporting & compliance | aggregates | — | `hr:reports:read` | none | re-identification via aggregates |

Each later phase must state acceptance criteria at kickoff following the platform's per-phase report convention; sequence may swap HR-3/HR-2 if leave proves more urgent than contracts — no repository evidence forces either order.

## 16. Decisions requiring approval (recommendation · trade-off · evidence)

1. **Support employees without platform accounts?** **Recommend YES** — it is the core reason `app_user` can't be the record; drivers/couriers/field staff exist as roles that are deliberately narrow or absent. Trade-off: two person-lists (accounts vs. employees) — mitigated by the link + `/users` staying authoritative for access.
2. **Route `/departments/hr` (recommended) vs `/management/hr`** — evidence: Direction (a MANAGEMENT item) lives at `/departments/management`; no `/management/*` tree exists.
3. **Salary location:** **restricted compensation domain inside HR** (`hr:compensation:*`), interfaced to Finance for payroll (HR-7). Never on `employee`, never under plain `hr:read`.
4. **Personnel documents in a dedicated private HR bucket:** **YES** (HR-2) — the general document system is dossier-bound and its visibility inherits dossiers.
5. **Manager access to direct reports:** **later (HR-3+)** — `manager_employee_id` ships in HR-1 as display metadata only; access requires a verified relationship model + new RLS helper.
6. **Employee self-view:** **later (HR-8)** — needs the self-scope helper + link hardening; HR-1 is HR-staff-only.
7. **Termination → account revocation:** **optional, prompted, never automatic** — reuse the 8.1A archive/ban flow as an explicit follow-up action with its own audit.
8. **Historize department/manager from release one?** **No — HR-2** (`employee_assignment`); HR-1 relies on audited before/after (the platform's existing history-until-materialized idiom).
9. **Initial roles:** **HR_OFFICER only**; HR_MANAGER when a split materializes.
10. **SYSTEM_ADMIN receives `hr:*`?** **Recommend NO** (breaks the usual full-admin convention; precedent for narrowness exists: `process:override` = nobody, `process:decision:approve` narrow). Needs explicit ratification because 9.3A followed the opposite convention for Caisse.
11. **Senegal legal items** (§13) — all require legal confirmation before any of HR-2+ encodes them.

## 17. Exact files likely to change in HR-1

Migration `supabase/migrations/<ts>_hr_employee_registry.sql` · `supabase/seed.sql` · `lib/platform/role-templates.ts` (HR_OFFICER; role count 24→25) · `lib/organization/departments.ts` (`ROLE_CANONICAL_DEPARTMENT.HR_OFFICER="HUMAN_RESOURCES"`) · `lib/navigation/roles.ts` (label + priority) · `lib/nav.ts` (MANAGEMENT item, gated `hr:read`) · `lib/db/types.ts` + `lib/db/tenant-tables.ts` (`employee`) · `lib/platform/ops/build-info.ts` (+ the 4 migration-pin tests: `tracking-8-4`, `operations-intake`, `transit-execution`, `finance-execution`) · role-count tests (`role-templates.test.ts` ALL_ROLES + title, `process-engine-schema.test.ts` 24→25, `caisse-foundation.test.ts` test 1) · nav tests (`journeys.test.ts` MANAGEMENT labels + route map, `finance-hub.test.ts` HR-blocker guard flips) · new `lib/hr/{lifecycle,validate}.ts`, `lib/hr/actions.ts`, `app/departments/hr/page.tsx` (+ `[id]`) · new `tests/hr-foundation.test.ts` + `supabase/tests/rls_hr_employee_test.sql` + a CI step.

## 18. Explicit non-goals (all phases until stated)

Payroll engine, attendance devices, shift scheduling, recruitment/ATS, performance scoring, benefits administration, disciplinary workflows, self-service, leave accrual engine (HR-1); repurposing `/users`; storing salary/national-ID/medical data before their restricted domains and legal review exist; any change to the canonical department registry.

## 19. Proposed HR-1 acceptance criteria

Employee CRUD + lifecycle (DRAFT/ACTIVE/SUSPENDED/TERMINATED/ARCHIVED, pure transition table, terminated stays queryable) behind `hr:manage`; directory/profile behind `hr:read`; employees without accounts fully supported; account link tenant-matched, unique, grants nothing, audited both ways; termination never deletes/revokes silently (prompt only); no salary/national-ID/medical fields exist; audit payloads carry no sensitive values (test-pinned); RLS SQL test proves tenant isolation + permission gating + no portal access; sidebar shows "Ressources humaines" under MANAGEMENT only to `hr:read` holders; five-section contract intact; SYSTEM_ADMIN holds no `hr:*` (if decision 10 ratified); parity trio + registries + pins all green; tsc/tests/build/CI green.

---
*HR-0 changed documentation only. Decision outcomes, once ratified, should be recorded in `docs/decision-register.md` per its change-control process (this audit deliberately adds no `Proposed` rows on management's behalf, matching the phase-decision-doc pattern of 6.0G/7.1B/7.4C-0).*
