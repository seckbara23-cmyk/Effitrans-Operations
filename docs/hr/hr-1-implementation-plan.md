# HR-1 — Employee Registry: Implementation Plan

**Status:** plan approved-pending-execution · **Basis:** HR-0 audit (`docs/hr/hr-0-architecture-audit.md`, commit `a93033f`) with all §16 decisions **ratified 2026-07-24** (decision register DEC-B23…B27)
**Type of change:** ONE additive migration + one new bounded context (`lib/hr`) + one route + one sidebar item + tests. No existing table, role, permission, RLS policy, route or lifecycle is modified.

## 0. Ratified constraints this plan implements

Account-less employees supported · route `/departments/hr` · permissions `hr:read` + `hr:manage` only · role `HR_OFFICER` only · **SYSTEM_ADMIN gets NO `hr:*`** · lifecycle `DRAFT/ACTIVE/SUSPENDED/TERMINATED/ARCHIVED` · ON_LEAVE derived later · termination ≠ revocation (prompt only) · rehire = new record · deferred: assignment history, personnel documents, manager access, self-service, compensation, Senegal legal rules.

---

## 1. Migration — `supabase/migrations/<ts>_hr_employee_registry.sql` (57th)

Clean-replay-safe per the established pattern (guarded tenant backfill + `on conflict do nothing`; catalog rows global).

1. **Permission catalog:** `hr:read` («Consulter le registre du personnel»), `hr:manage` («Gérer le personnel : création, modification, cycle de vie, liaison de compte») — module `hr`.
2. **Role:** `HR_OFFICER` («Chargé RH» / "HR Officer"), `is_provisional true`, guarded insert for tenant `…0001`.
3. **Grants:** HR_OFFICER ← `profile:read:self, profile:update:self, hr:read, hr:manage` (+ `messaging:read, messaging:send` for parity with every operational role — **decision inside the PR**: include, matching platform convention that all staff roles can message; excludes any department inbox). **No grant to SYSTEM_ADMIN or any other role** (DEC-B25).
4. **`employee_counter`** + `next_employee_number(tenant)` RPC → `EMP-2026-0001` style, per-tenant×year, modeled on `next_file_number` (service-role execute only).
5. **`employee` table:**
   - identity/links: `id uuid pk`, `tenant_id → organization`, `employee_number text` (unique per tenant), `linked_app_user_id uuid null → app_user`
   - person: `first_name text not null`, `last_name text not null`, `preferred_name`, `professional_email`, `personal_email`, `professional_phone`, `personal_phone`, `emergency_contact_name`, `emergency_contact_phone`
   - employment: `department text not null check in ('OPERATIONS','TRANSIT','FINANCE','HUMAN_RESOURCES')`, `job_title text`, `manager_employee_id uuid null → employee` (display-only; simple self-FK; **no self-reference check `id <> manager_employee_id`** enforced by CHECK), `work_location text`, `employment_type text check in ('CDI','CDD','STAGE','JOURNALIER','PRESTATAIRE','AUTRE')` (vocabulary explicitly provisional pending legal review — CHECK is widenable additively), `hire_date date`, `probation_end_date date`, `termination_date date`, `termination_reason text`
   - lifecycle: `status text not null default 'DRAFT' check in ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','ARCHIVED')`
   - meta: `created_by → app_user`, `created_at/updated_at` (+ trigger)
   - **explicitly absent forever (DEC-B27):** salary/compensation, national ID/passport, DOB/gender/marital, medical
6. **Indexes:** `(tenant_id, status)`, `(tenant_id, department)`, unique `(tenant_id, employee_number)`, **partial unique on `linked_app_user_id` where not null** (one employee per account), partial index manager.
7. **Tenant-integrity trigger** (`enforce_employee_tenant`): `linked_app_user_id`, `manager_employee_id`, `created_by` must share `tenant_id` (standard idiom).
8. **RLS:** enable; **one SELECT policy** to `authenticated`: `tenant_id = auth_tenant_id() and has_permission('hr:read')`. No portal policy. All writes via service-role actions.
9. **No FORCE RLS, no storage, no other table.**

## 2. Parity surfaces & registries

- `supabase/seed.sql` — mirror block (permissions + role + grants). ⚠ grant `hr:read`/`hr:manage` by explicit `p.code in (…)` (the parity test's module-expansion quirk applies only to `finance`).
- `lib/platform/role-templates.ts` — `HR_OFFICER` template (24→**25** roles; permissions exactly the seed set; no `businessProfile` → provisioned to every tenant).
- `lib/organization/departments.ts` — `ROLE_CANONICAL_DEPARTMENT.HR_OFFICER = "HUMAN_RESOURCES"` (registry's first HR-mapped role; update the "TOTAL over N" comment 24→25).
- `lib/navigation/roles.ts` — label `HR_OFFICER: "Chargé RH"` + `DISPLAY_PRIORITY` slot (near ADMINISTRATIVE_OFFICER).
- `lib/db/types.ts` — hand-authored `employee` Row/Insert/Update; `lib/db/tenant-tables.ts` — add `"employee"` (tenant-scope guard coverage).
- `lib/platform/ops/build-info.ts` — LATEST_MIGRATION/`MIGRATION_COUNT=57` (probe unchanged: the new permission rows ARE probeable — optionally advance `MIGRATION_PROBE` to `hr:read`; decide in-PR, default: advance it, since the comment's rule is "newest data-probeable migration").

## 3. Domain module — `lib/hr/`

- **`lifecycle.ts` (pure):** `EMPLOYEE_STATUSES`, transition table `{DRAFT:[ACTIVE,ARCHIVED], ACTIVE:[SUSPENDED,TERMINATED], SUSPENDED:[ACTIVE,TERMINATED], TERMINATED:[ARCHIVED], ARCHIVED:[]}` (rehire = new record, so TERMINATED→ACTIVE deliberately absent), `canTransitionEmployee`, French status labels.
- **`validate.ts` (pure):** required first/last name + department; email shape; hire ≤ probation; termination requires reason + date; employment_type in vocabulary.
- **`actions.ts` ("use server"):** guard = `assertPermission` (`hr:manage` writes / `hr:read` reads) + tenant + `getEffectivePermissions` — **no engine flag** (HR is not a process-engine sub-feature; follows the plain `/finance` gate convention). Actions: `createEmployee` (number via RPC; status DRAFT), `updateEmployee` (CAS-style guarded update; audited before/after per changed employment field), `transitionEmployee(status, reason?)` (pure table + CAS on status; TERMINATED requires reason; **on TERMINATED with a linked account, return `{promptRevocation:true}` — never call the ban/archive flow itself**), `linkEmployeeAccount` / `unlinkEmployeeAccount` (target must be active same-tenant `app_user`; enforce one-per-account via the partial unique + friendly error; audited both ways; never touches `user_role`), `listEmployees`/`getEmployee` (read-side, bounded, tenant-filtered).
- **Audit actions (additive, `lib/audit/events.ts`):** `HR_EMPLOYEE_CREATED / UPDATED / STATUS_CHANGED / ACCOUNT_LINKED / ACCOUNT_UNLINKED`. **Payload redaction rule (test-pinned):** ids, status before/after, changed field *names*, department, dates — never phone/email values, never emergency-contact values, and the excluded-forever fields don't exist.

## 4. UI — `app/departments/hr/`

- **`page.tsx`** — registry: `requireUser` + `hr:read` else `notFound()`; PageHeader meta "Management", title **« Ressources humaines »**; stat cards (Actifs / Suspendus / Sans compte / Nouveaux ce mois — all real counts); directory table (matricule, nom, département, fonction, statut, compte lié ✓/—) with status/department filters; « Nouvel employé » (visible on `hr:manage`).
- **`[id]/page.tsx`** — profile: identity/contact/employment/lifecycle panels; lifecycle buttons per the pure table; link-account picker (active users without an employee link — reuse the eligible-directory pattern from 9.0C/9.0D); on termination of a linked employee show the **prompt** linking to the existing `/users` archive flow. French labels; **no UUIDs rendered**; no fake data.
- Components under `components/hr/` (client form/actions following intake-panel conventions).

## 5. Navigation

`lib/nav.ts` MANAGEMENT items → `Direction · Ressources humaines (/departments/hr, permission "hr:read") · Rapports · Tableau exécutif` (single-permission gate — no `permissionsAnyOf` needed). Five sections and all other labels untouched.

## 6. Tests

- **New `tests/hr-foundation.test.ts` (~45):** pure lifecycle (incl. no TERMINATED→ACTIVE), validation, structural action guarantees (guards, CAS, link constraints, prompt-not-auto revocation, no `user_role` writes, audit-redaction pin), migration shape (no salary/ID/medical column names; exactly one new table; no FORCE; no portal policy), grant matrix (`hr:*` holders == {HR_OFFICER} — **pins the SYSTEM_ADMIN exception**), registry parity, nav item + gating, page authorization.
- **New `supabase/tests/rls_hr_employee_test.sql`** + CI step (after finance requests): tenant isolation, `hr:read` gate (SYSTEM_ADMIN sees **0** — the decisive DEC-B25 proof), portal-blind, cross-tenant trigger rejection, duplicate-link rejection.
- **Updated pins/counts:** `role-templates.test.ts` (ALL_ROLES + title "24"→"25"), `process-engine-schema.test.ts` (`toHaveLength(25)`), `caisse-foundation.test.ts` test 1 (24→25), the **4 latest-migration pins** (`tracking-8-4`, `operations-intake` #59, `transit-execution` #49, `finance-execution` #51 incl. build-info string), `journeys.test.ts` (MANAGEMENT labels + route map + role-example additions if needed), `finance-hub.test.ts` (**the HR-blocker guard flips**: MANAGEMENT now contains « Ressources humaines »; the "no HR permission exists" assertion is replaced by "hr:* exists and is held only by HR_OFFICER"), `organization.test.ts` (totality auto-adjusts; add explicit HR_OFFICER→HUMAN_RESOURCES case).

## 7. Implementation sequence

1. Migration + build-info + db types + tenant-tables → 2. seed + role-templates + departments + navigation/roles registries → 3. `lib/hr` (lifecycle/validate pure first, then actions + audit constants) → 4. routes + components → 5. `lib/nav.ts` item → 6. new tests + all pin/count updates → 7. `tsc`, full suite, build → 8. RLS SQL test + CI step → 9. diff review (no unrelated change) → 10. commit/push → 11. **verify CI conclusion** (standing rule) → 12. post-deploy: `supabase migration repair --status applied <version>` once the out-of-band apply lands (ledger currently reconciled at 56).

## 8. Acceptance criteria (from HR-0 §19, now binding)

All of: employee CRUD + lifecycle behind `hr:manage`; directory/profile behind `hr:read`; account-less employees fully supported; link tenant-matched/unique/grants-nothing/audited; termination never deletes or revokes silently; no salary/national-ID/medical field exists; audit payloads redacted (test-pinned); RLS SQL proof incl. SYSTEM_ADMIN=0 rows; « Ressources humaines » under MANAGEMENT for `hr:read` holders only; five-section contract intact; parity trio + registries + pins green; tsc/tests/build/CI green.

## 9. Risks & mitigations

Role-count/pin cascade (checklist in §6 — the 9.3A checklist proved complete); seed-parity quirk (explicit `p.code` grants); `employment_type` vocabulary is provisional (CHECK widenable; flagged per DEC-B27); scope-creep guard: any request for documents/leave/compensation during HR-1 is redirected to its phase.
