# HR-0R — Human Resources Architecture Re-Audit

**Date:** 2026-07-31 · **Type:** documentation only — no migration, no table, no UI, no route,
no role grant, no production change.
**Repo state audited:** working tree at `2c80a8c` (post-FIN-AGING-3B, CI green).
**Predecessor:** [hr-0-architecture-audit.md](hr-0-architecture-audit.md) (2026-07-24),
ratified as **DEC-B59–B63** and *implemented* the same day.

---

## 0. The material finding this audit must open with

**The Effitrans HR system has already begun.** The request frames this as the start of HR;
the repository says otherwise, and an audit that pretended to a blank slate would design a
duplicate of a system that is live in `main`:

| Already shipped (HR-1, 2026-07-24, migration 57 `20260724000002_hr_employee_registry`) |
|---|
| `public.employee` — tenant-scoped registry: identity, contacts, emergency contact, canonical department, job title, display-only manager, work location, employment type, hire/probation/termination dates, lifecycle status |
| Employee numbering: `EMP-{YEAR}-{4-digit}` via locked `employee_counter` + `next_employee_number` RPC (concurrency-safe, gaps allowed, security definer, service-role only) |
| Optional account link `linked_app_user_id` — tenant-matched by trigger, at most 1:1 (partial unique index), **grants nothing**, unlink deletes nothing |
| Lifecycle `DRAFT → ACTIVE → (SUSPENDED ⇄ ACTIVE) → TERMINATED → ARCHIVED` as a pure transition table (`lib/hr/lifecycle.ts`); **rehire = new record** |
| Permissions `hr:read` / `hr:manage`; role `HR_OFFICER` (the 25th); **SYSTEM_ADMIN holds no `hr:*`** — proven by the CI RLS suite (`rls_hr_employee_test.sql`: SYSTEM_ADMIN sees **0** employee rows) |
| Route `/departments/hr` (+ `[id]`), « Ressources humaines » under MANAGEMENT, gated `hr:read` |
| Audit redaction pinned by test: HR payloads carry safe metadata only — no contact values |
| No salary, national-ID, DOB, gender, marital or medical column exists — **test-enforced** (`FORBIDDEN_COLUMNS` in `tests/hr-foundation.test.ts`) |

Consequently the mission's "first implementation priority — the Employee Foundation" is
**roughly half-shipped**: directory ✅ · profile ✅ · employment identity ✅ · department ✅
(canonical code) · manager ✅ (display-only) · linkage ✅ · HR permissions ✅ · lifecycle ✅ ·
**position — free text only, no catalog** · **contract metadata — dates/type on the row, no
contract entity** · **organization structure — no positions/units/reporting-history model**.
The genuinely-next build is the **organization half**, not the employee half.

All five HR ratifications hold and are treated as binding throughout this pack:
**DEC-B59** (bounded context; account-less employees; link grants nothing) ·
**DEC-B60** (route/navigation) · **DEC-B61** (permissions; SYSTEM_ADMIN excluded) ·
**DEC-B62** (lifecycle; ON_LEAVE derived; termination ≠ revocation) ·
**DEC-B63** (deferrals; compensation as a separately-restricted domain; Senegal items need
legal review; audit redaction).

## 0.1 What changed since 2026-07-24 — and improves this design

The prior audit could not have used these; this one does:

1. **Granular user administration + staff password lifecycle (2026-07-29, migration 71).**
   `admin:users:read/create/update/disable/reset_password/temp_password/unlock`, plus
   `app_user.must_change_password` / `temp_password_expires_at` / `password_changed_at`, a
   forced-change gate, and audited temp-password issuance with mandatory reason + IP.
   **This is the exact account rail §10/§11 onboarding/offboarding needs** — it did not
   exist when HR-0 was written.
2. **The Department → Role display taxonomy (`lib/users/departments.ts`, 2026-07-29).**
   Presentation-only grouping of the 29 roles for the user-creation UI. Relevant here
   because the prompt explicitly asks whether it can be the HR org model: **no** — it is a
   UI filter over *roles*, documented as granting and representing nothing (§4 of the org
   doc).
3. **FIN-AGING-2 idioms (migration 72, dark).** Maker-checker as CHECK constraints
   (`approved_by <> prepared_by`), a staged **import pipeline** (batch → staging rows →
   validation errors → approval by a different actor → provenance-marked canonical rows),
   immutable snapshots with pinned versions, hashed artifacts, and token-hash share links.
   Directly reusable shapes for: the **initial employee data load** (the same
   staging/approval discipline before ~N real employee records enter `employee`), payroll
   snapshots (HR-7), and confidential document delivery.
4. **`invoice.file_id` provenance pattern** — a CHECK tied to a `provenance` column proved
   out as the way to relax a constraint for imported history without weakening it for
   platform-native rows. The same pattern fits legacy employee imports if needed.

## 1. Repository audit — classification of every requested structure

| Structure | Where | Finding | Class |
|---|---|---|---|
| `app_user` | foundation migration + 71 | Account/membership only; no employment data; now carries the password lifecycle | **REUSE** (as the optional link target; never the employee record) |
| User administration | `lib/users/*`, `/users` | Full account surface: create (3 credential modes), roles, suspend/archive/restore, welcome pipeline, temp password, unlock | **REUSE** (onboarding/offboarding account steps) |
| User lifecycle & archival | 8.1A archive-not-delete + `setUserAuthBan` | Termination ≠ revocation is already the idiom | **REUSE** |
| Password lifecycle | migration 71 + `lib/users/password-*` | Temp password, forced change, expiry, reset email — audited w/ reason + IP | **REUSE** |
| Roles & permissions | `role`/`permission`/`user_role` + parity machinery | `hr:read`/`hr:manage` + HR_OFFICER already registered in it | **REUSE / EXTEND** (add codes via the established trio) |
| Department registry | `lib/organization/departments.ts` | Canonical 4 codes incl. HUMAN_RESOURCES; fixed in code; derived-from-roles for users | **REUSE as vocabulary — INCOMPLETE as an HR org model** (no positions, units, history) |
| Department→Role display taxonomy | `lib/users/departments.ts` | Presentation-only; grants nothing | **NOT APPLICABLE** as HR truth (explicitly rejected as authoritative) |
| Organization / tenant identity | `organization` + RLS helpers | `auth_tenant_id()`, `has_permission()` | **REUSE** |
| Staff invitations & onboarding | `lib/users/welcome-send.ts`, invitation-state | One shared secure-link pipeline; honest outcomes | **REUSE** |
| Audit events | `audit_log` append-only + `writeAudit` | HR redaction convention already pinned | **REUSE / EXTEND** (add `hr.*`, later `employee.*` constants) |
| Document storage | `public.document` + buckets | Dossier-bound (`file_id NOT NULL`), visibility inherits the dossier — re-confirmed during FIN-AGING-2, which also refused it | **CONFLICTING** for HR files → dedicated `hr_document` + private bucket (DEC-B63) |
| Document expiry | `document_type.has_validity`, `expiry_date` idiom | Pattern for certificates/permits | **REUSE (pattern)** |
| File upload infra | private buckets + short-TTL signed URLs, server-mediated | | **REUSE (pattern)** with HR-only storage policies |
| Workflow engine | 26-step process engine | Dossier-shaped; wrong domain for HR flows | **NOT APPLICABLE** (HR on/offboarding = checklists + actions, not process instances) |
| Maker-checker | payment verification; FIN-AGING-2 CHECKs; expense visas | Structural `X <> Y` constraints proven | **REUSE (pattern)** for contract verification, comp approval, import approval |
| Tasks & checklists | `task` table + queues | Generic, dossier-linked but file_id nullable? (task requires file_id — dossier-bound) | **EXTEND or new** `hr_checklist_item` (decision: §on/offboarding doc) |
| Notifications | staff notification + customer-notify | Staff notification rail exists | **REUSE** |
| Email delivery | comms queue + provider, honest outcomes | | **REUSE** |
| Equipment / assets | — | zero occurrences | **MISSING** (new `hr_equipment*` in the onboarding phase) |
| Calendar / scheduling | — | zero occurrences | **MISSING** (defer; leave/attendance phases) |
| Finance employee-linked records | expense visas, caisse, finance_request | Reference `app_user` seats, not employees | **REUSE as boundary** (payroll stays an interface, DEC-B63) |
| Secure personal-data access | HR RLS + redaction + SYSTEM_ADMIN exclusion | Implemented for the registry | **REUSE / EXTEND** (stricter classes per domain) |
| RLS & tenant isolation | uniform SELECT-only + service-role writes + tenant triggers + CI suites | HR suite runs in CI | **REUSE** |
| Recruitment / candidates | — | zero occurrences | **MISSING** (late phase; see roadmap) |
| Leave / attendance / payroll / performance | — | zero occurrences | **MISSING** (phased) |

## 2. Identity separation — verdict

The eight requested separations are **implemented fact**, not proposal: employee ≠ platform
user (DEC-B59, account-less employees supported, `/users` never repurposed); role/permission
remain the only authorization (link grants nothing — trigger + tests); department is
metadata (canonical code CHECK; registry doctrine "grants nothing" test-enforced); position
is free text with no access effect; manager is display-only (`manager_employee_id`,
self-reference disallowed, access deferred by DEC-B63); archived employees retain
attribution (archive-not-delete; audit FKs); offboarding revokes access without deleting
history (termination *prompts* the 8.1A archive/ban flow, never silently — DEC-B62).

**`app_user` must not be overloaded with HR data** — decided, ratified, and shipped; the
2026-07-29 password-lifecycle work added *account* columns to `app_user` and *no* HR data,
demonstrating the boundary holds under change.

## 3. Where the remaining documents take this

| Deliverable | Document |
|---|---|
| Employee master record, field dictionary, Senegal localization, sensitivity classes | [hr-employee-master-field-dictionary.md](hr-employee-master-field-dictionary.md) |
| Organization model, lifecycle mapping, numbering | [hr-organization-and-lifecycle.md](hr-organization-and-lifecycle.md) |
| Documents model, permission catalog, access scopes, audit events | [hr-documents-permissions-scopes.md](hr-documents-permissions-scopes.md) |
| Onboarding & offboarding architectures | [hr-onboarding-offboarding.md](hr-onboarding-offboarding.md) |
| **HR-0A addendum**: setup wizard, tenant configuration model, legacy migration pipeline, template versioning, engine/config boundary, activation checklist, rollout | [hr-setup-configuration-migration.md](hr-setup-configuration-migration.md) |
| ERD, roadmap, decision register, HR-management questions, recommendation | [hr-erd-roadmap-decisions.md](hr-erd-roadmap-decisions.md) |
