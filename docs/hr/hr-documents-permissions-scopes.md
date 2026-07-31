# HR — Documents Model, Permission Catalog, Access Scopes, Audit Events

Part of [HR-0R](hr-0r-reaudit-2026-07-31.md) · documentation only.

## 1. Employee documents (HR-2 target; direction ratified in DEC-B63)

**Not `public.document`.** Re-confirmed this week: it is dossier-bound (`file_id NOT NULL`)
and its visibility inherits the operational file — FIN-AGING-2 refused it for report
artifacts for the same structural reason. HR gets `hr_document` + a dedicated **private
`hr-documents` bucket** with HR-only storage policies, reusing the proven *patterns*:
server-mediated short-TTL signed URLs, soft delete, the expiry idiom, and WES-4G's
content-hash discipline.

| `hr_document` field | Notes |
|---|---|
| `employee_id`, `tenant_id` | tenant trigger like every child table |
| `doc_type_id → hr_document_type` | tenant-owned catalog (wizard-managed, HR-0A): CONTRAT, AVENANT, FICHE_POSTE, PIECE_IDENTITE, DIPLOME, CERTIFICAT, MEDICAL, DISCIPLINAIRE, COURRIER_PROMOTION, POLITIQUE_SIGNEE, DOCUMENT_DEPART, … each with `sensitivity ('CONFIDENTIAL'\|'RESTRICTED')`, `has_validity`, `required_for_activation` |
| `version`, `supersedes_id` | replacement history; superseding never deletes |
| `issue_date`, `expiry_date` | expiry alerts reuse the catalog validity idiom |
| `status` | `UPLOADED → VERIFIED` (verifier ≠ uploader — maker-checker CHECK, the FIN-AGING-2 shape) or `REJECTED` |
| `uploaded_by`, `verified_by`, `verified_at` | both `app_user` refs |
| `storage_path`, `content_sha256`, `size_bytes` | hash at upload (WES-4G idiom) |

RLS: SELECT requires tenant + `hr:documents:read` for CONFIDENTIAL types; RESTRICTED types
(MEDICAL, DISCIPLINAIRE, and any compensation paper) additionally require the domain's own
permission — a document row's effective gate is `max(type.sensitivity)`, never plain
`hr:read`. Downloads are served by an action that re-checks and audits
(`employee.document_downloaded`), mirroring the invoice-artifact route.

## 2. Permission catalog

Convention: `module:action[:scope]`, `[a-z_]` segments (the enforced repo rule — the
ratified-name→underscore correction is now routine: `admin:users:reset_password`,
`finance:aging:draft_create`).

**Existing (implemented):** `hr:read` · `hr:manage`.
**Ratified ceiling (HR-0 §10, DEC-B61/B63):** + `hr:documents:read` · `hr:documents:manage`
· `hr:leave:read` · `hr:leave:manage` · `hr:compensation:read` · `hr:compensation:manage`
· `hr:reports:read` — nine total, "do not add more".

**This re-audit's mapping of the requested capabilities onto that ceiling:**

| Requested capability | Code | Status |
|---|---|---|
| Directory read / profile read | `hr:read` | exists |
| Employee create/update/lifecycle/link | `hr:manage` | exists |
| Contract management, document upload | `hr:documents:manage` | ceiling |
| Document verification | `hr:documents:manage` **+ verifier≠uploader CHECK** (separation by constraint, not by a 10th code) | ceiling |
| Compensation read / update | `hr:compensation:read` / `manage` | ceiling |
| HR reporting | `hr:reports:read` | ceiling |
| Onboarding / offboarding management | `hr:manage` (checklists) **+ the actor's own `admin:users:*` for account steps** — composition, not new codes | ceiling |
| Organization management (units/positions) | fold into `hr:manage` for HR-1B; revisit if a config-admin seat separates from the officer seat | ceiling |
| **Sensitive identity read** (identifiers, ID docs) | **no home in the ceiling** → either fold under `hr:documents:read`+RESTRICTED types (weaker) or add `hr:sensitive:read` (**breaches the ratified ceiling — explicit re-ratification item HRQ-D2**) |
| HR template management (HR-0A) | proposal: `hr:config:manage` for wizard + templates + catalogs — **second ceiling-breach candidate, same decision item** |

**SYSTEM_ADMIN receives no `hr:*`** — ratified (DEC-B61), implemented, RLS-proven (0 rows in
CI), and unchanged here. Technical recovery uses the audited override mechanism, exactly as
the finance approval authorities do.

### 2.1 Role–permission matrix (proposal; grants are a ratification item)

| Role | read | manage | documents:read | documents:manage | leave:read | leave:manage | compensation:* | reports:read | config:manage* |
|---|---|---|---|---|---|---|---|---|---|
| HR_OFFICER (exists) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ until a second seat exists | ✅ | ✅ |
| HR_MANAGER (deferred) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CEO | ✅ | ❌ | ❌ | ❌ | read | ❌ | ❌ (explicit decision) | ✅ | ❌ |
| DAF | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | payroll-interface outputs only (HR-7), never raw | ❌ | ❌ |
| SYSTEM_ADMIN | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Managers / employees | via scopes (§3), not via role grants | | | | | | | | |

\* if ratified (HRQ-D2).

## 3. Access scopes — design over the existing engine

The permission engine answers "may this role do X"; scopes answer "over WHICH rows". Design:

| Scope | Mechanism | Phase |
|---|---|---|
| `HR_ALL` | what exists: tenant + `hr:*` permission in RLS | live |
| `SELF` | new SQL helper `hr_self_employee_id()` := employee where `linked_app_user_id = auth.uid()`; self-service policies read `id = hr_self_employee_id()` over a **C1/C2-limited view**, never the base table | HR-8 |
| `DIRECT_REPORTS` | helper over **current** `employee_assignment` rows (`manager_employee_id = hr_self_employee_id() ∧ effective_to IS NULL`); non-recursive by default — recursive org access is a separate decision | HR-3+ (leave approval first) |
| `DEPARTMENT` | assignment-derived unit filter for department heads; **not built until a real consumer exists** — scope creep risk exceeds present value | deferred |
| `EXECUTIVE_SUMMARY` | no row access at all: `hr:reports:read` exposes **aggregates** (headcount, turnover, leave load) with a k-anonymity floor (suppress groups < 5) so summaries cannot re-identify | HR-9 |

Worked examples, per the mandate: an employee sees their own C1/C2 profile and documents,
never another's; a manager sees direct reports' C1 + leave requests, no C3 ever; Finance
sees the payroll-interface output (approved comp references), never medical/disciplinary;
the CEO sees aggregates + C1 directory, and any confidential access is an explicit grant;
IT (SYSTEM_ADMIN) executes account tasks from checklists without reading HR rows at all —
the checklist item carries what they need (name, start date, role to grant), which is C1.

## 4. Audit-event catalog (`AuditActions` additions; redaction per DEC-B63)

Existing (HR-1): `hr.employee.created/updated/activated/suspended/terminated/archived`,
`hr.employee.account_linked/account_unlinked` (payloads: ids, statuses, dates — pinned).

Proposed additions as their phases land — the request's names, normalized to the module
prefix: `hr.employee.department_changed` · `position_changed` · `manager_changed` (all
via `assignment_created`, with kind) · `hr.contract.added/verified` ·
`hr.document.uploaded/verified/downloaded/superseded` · `hr.employee.departure_initiated`
· `hr.employee.offboarded` · `hr.import.batch_staged/approved/rejected` ·
`hr.config.updated` · `hr.template.version_created`. Sensitive before/after values are
**never** carried; events name the field kind, not the value (e.g.
`{ identifier_kind: "CNI" }`).
