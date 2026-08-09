# HR-A1 — HR Foundation Activation

**Nature:** ACTIVATION (HR-0P roadmap phase 1) — not a build. HRQ-D2 ratified as
**Option A** (2026-08-09). One grant migration, the ratified matricule scheme,
the F1 registry correction, wizard preparation. No organizational data is
seeded; configuration is an operator UI session.

Binding context: [hr-0p-production-readiness-audit.md](hr-0p-production-readiness-audit.md)
(A–I + gap matrix), HR-0/HR-0R/HR-0F ratifications.

---

## A. Preflight findings (verified read-only against production, 2026-08-09)

| Question | Finding |
|---|---|
| HR_OFFICER holders | **Exactly one, active — the platform administrator account (the ratified initial HR configuration operator).** No role assignment is needed: the grant alone opens the wizard through the normal permission model. |
| Grant mechanism | `role_permission` insert for the per-tenant HR_OFFICER role — the identical mechanism migration 57 used for `hr:read`/`hr:manage`. Three sources must agree (EC-3B lesson, applied to granting): migration (production), seed.sql (CI), role template (provisioning parity). |
| Does the grant exceed HR-A1? | `hr:config:manage` gates: the configuration center (structure, positions, work locations, numbering, vocabularies) **and the performance competency catalog** (`lib/hr/performance-actions.ts` — deliberately the same gate since HR-6). All configuration-class; no employee data write (that is `hr:manage`, already held), no approval, no finalization, no sensitive class. Reported, judged in scope. |
| Narrower mechanism? | None exists. Authorization is role→role_permission only (no per-user grants); the only narrower option would be a new role — HRQ-D2 Option C, ratified REJECTED. **No STOP condition met.** |
| Tables for the guard | The 8 HR migrations create **36 tables** (HR-0P's "33" was an undercount); **every one** carries `tenant_id uuid not null references public.organization`. Registered: 2. Missing: 34. |
| Legitimate exclusions | **None.** `hr_document_type` is per-tenant (unlike the global `document_type`) and belongs in the scoped registry. |
| `employee_counter` behavior | `(tenant_id, year)` buckets; concurrency-safe `ON CONFLICT … RETURNING` upsert (the returning lock serializes concurrent callers; gaps allowed, numbers never reused); RLS-on/zero-policy (deny-all); definer-only function; trusted overload `(uuid, uuid)` asserts `hr:manage` before delegating (OPS-SEC-2A/2B). **Zero rows in production — no matricule ever allocated.** |
| Wizard prerequisites | Page gate `hr:read` + `hr:config:manage`; `saveHrConfiguration` requires ≥ 1 employment kind (default `EMPLOYEE` satisfies it); `activateHrConfiguration` requires only a saved row. |
| Positions mandatory? | **No** — neither in actions nor UI. Positions are added progressively (HR-A2), exactly as ratified. |
| Canonical registry | `lib/organization/departments.ts` (Phase 9.0A) — THE four departments with French labels; `employee.department` CHECK and `hr_org_unit.canonical_department` CHECK use the same four codes. The studio previously hardcoded a copy of the codes — replaced with the registry import. |
| Production data | `employee` 0 · `hr_configuration` 0 · `hr_org_unit` 0 · `hr_position` 0 · `hr_work_location` 0 · `employee_counter` 0 rows. One tenant. |

## B. Authorization decision

**Grant `hr:config:manage` to HR_OFFICER** (migration 99 + seed.sql + role
template). The operator's account already holds HR_OFFICER, so it acquires the
wizard through the role — the minimum legitimate mechanism, no per-account
special case, no new role.

**Unchanged, asserted at apply time by the migration itself:**
- `hr:sensitive:read`, `hr:leave:approve`, `hr:performance:finalize` → NOBODY
  (the migration raises if any acquired a grant);
- SYSTEM_ADMIN holds NO `hr:*` (DEC-B25 — platform administration ≠ HR
  authority; the migration raises otherwise);
- no RLS change; no SYSTEM_ADMIN bypass anywhere in HR permissions or RLS.

## C. F1 correction — tenant-scope guard registry

All 34 missing HR tables registered in `TENANT_SCOPED_TABLES` (tests/registry
change only — RLS untouched, exactly as the audit prescribed). The moment they
were registered, the guard **found one real hidden read**:

> `lib/hr/employee-file-actions.ts` — `getEmployeeDocumentUrl` read
> `hr_document_type` by FK without a tenant filter, and treated a missing type
> row as "not C3" — **fail-open on the sensitive-class gate**.

Fixed closed: the read is tenant-scoped and a missing type row now refuses
(`document_type_id` is a NOT NULL FK, so absence under the tenant filter can
only mean a cross-tenant anomaly). This is F1's argument made concrete: the
defect existed for one week and was invisible precisely because the table was
unregistered.

## D. Organizational configuration architecture

Nothing new was built — the wizard (HR-1's permanent configuration center) is
the write path. Preparation only:

- the platform-correspondence select now renders **the canonical registry**
  (`CANONICAL_DEPARTMENTS`, French labels) instead of a hardcoded copy of the
  four codes — one vocabulary, one source;
- a starting-structure hint tells the operator to create one « Département »
  unit per real department and link its correspondence, and states in the UI
  that the correspondence **grants no access** (metadata, never authorization);
- authority boundaries unchanged: roles grant permissions;
  `employee.department` is metadata; `employee_assignment` → `hr_org_unit` is
  authoritative placement; `hr_org_unit.canonical_department` is interop.
  The SQL suite proves at the database layer that the RBAC resolution
  functions never read employee/org-unit/assignment tables.

## E. Matricule scheme — ratified EMP-0001

`next_employee_number(uuid)` replaced (migration 99), **same engine**:

| Property | Before | After |
|---|---|---|
| Format | `EMP-2026-0001` (year bucket) | **`EMP-0001`** continuous, no year |
| Counter | `employee_counter (tenant_id, year)` | same table — continuous bucket `year = 0` (not a calendar year; can never collide with a historical bucket) |
| Prefix | hardcoded `EMP` | `hr_configuration.employee_number_prefix` (the column the wizard always saved and nothing consumed) — default `EMP` when absent/blank |
| Concurrency | `ON CONFLICT … RETURNING` row lock | identical |
| Privileges | definer-only, service_role | identical, re-asserted |
| Authority | trusted overload asserts `hr:manage` | untouched, delegates unchanged |

A prefix change **never resets the sequence** (uniqueness safety), and existing
matricules are immutable by trigger regardless. Production had zero allocations,
so there is no mixed-format history.

## F. Files / migrations changed

| File | Change |
|---|---|
| `supabase/migrations/20260821000001_hr_a1_foundation_activation.sql` | **NEW (migration 99)** — grant + numbering + self-assertions |
| `supabase/seed.sql` | HR_OFFICER block + `hr:config:manage` (CI mirror) |
| `lib/platform/role-templates.ts` | HR_OFFICER template + `hr:config:manage` (provisioning mirror) |
| `lib/db/tenant-tables.ts` | +34 HR tables (F1) |
| `lib/hr/employee-file-actions.ts` | C3 class read: tenant-scoped + fail-closed |
| `components/hr/configuration-studio.tsx` | canonical registry import; EMP-0001 copy; starting-structure hint |
| `lib/platform/ops/build-info.ts` | `LATEST_MIGRATION` = migration 99, `MIGRATION_COUNT` = 99 |
| `supabase/tests/hr_a1_foundation_activation_test.sql` | **NEW** DB suite |
| `.github/workflows/ci.yml` | suite wired, last |
| `tests/hr-a1-foundation-activation.test.ts` | **NEW** TS suite |
| `tests/fin-aging-schema.test.ts` | runs-LAST pin → HR-A1 suite |
| `tests/hr-foundation.test.ts` | test 42: `not.toContain("hr")` proxy replaced by the real property (newest ≠ HR-1's migration) |

## G. Tests

- **DB suite** (rollback-only, throwaway tenants): grant exactly as ratified
  (including the exact 7-permission HR_OFFICER set); parked = NOBODY;
  SYSTEM_ADMIN = no `hr:*`; `EMP-0001` → `EMP-0002`; tenant isolation; prefix
  honored (`ETS-0003`) and blank-prefix fallback without sequence reset;
  forged-actor refusal burns no number; immutability trigger; deny-all counter;
  RBAC functions never read HR tables.
- **TS suite** (21 tests): three-source grant agreement (on data, not word
  blacklists); parked-stays-parked; 36/36 tables registered; C3 fail-closed;
  no seed data in the migration; canonical registry reuse; placement grants
  nothing (app layer); CI wiring.
- Guard suite now covers all 36 HR tables (F1 closed).

## H. Production impact

**On push (app deploy):** none visible — the configuration page still refuses
until the migration is applied (the permission row is granted to nobody until
then; every action re-checks server-side).
**On migration apply:** HR_OFFICER holders (today: the one operator account)
gain the configuration center and the competency catalog. Nothing else changes:
no data written, no RLS change, no employee records, no counters move.
**Not changed:** the three parked authorities, SYSTEM_ADMIN, any non-HR module,
Enterprise Mail (paused), aminata@effitrans.com.

## I. Deployment (operator runbook)

Order is the standing rule: **CI green on the exact SHA before any operator SQL.**

1. **Apply migration 99** in the production SQL editor: paste
   `supabase/migrations/20260821000001_hr_a1_foundation_activation.sql`
   verbatim. It asserts its own outcome (raises on any deviation).
2. **Physical verification** (read-only) — expected values in comments:

   ```sql
   select
     (select count(*) from public.role r
       join public.role_permission rp on rp.role_id = r.id
       join public.permission p on p.id = rp.permission_id
      where r.code = 'HR_OFFICER' and p.code = 'hr:config:manage') as officer_grant, -- 1
     (select count(*) from public.role_permission rp
       join public.permission p on p.id = rp.permission_id
      where p.code in ('hr:sensitive:read','hr:leave:approve','hr:performance:finalize')) as parked_grants, -- 0
     (select count(*) from public.role_permission rp
       join public.role r on r.id = rp.role_id
       join public.permission p on p.id = rp.permission_id
      where r.code = 'SYSTEM_ADMIN' and p.code like 'hr:%') as sysadmin_hr, -- 0
     (select prosrc like '%employee_number_prefix%' and prosrc not like '%extract(year%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'next_employee_number'
         and p.pronargs = 1) as fn_replaced, -- true
     (select count(*) from public.employee_counter) as counter_rows; -- 0 (nothing allocated)
   ```
3. **Ledger reconciliation** (only after step 2 confirms):
   `npx supabase migration repair --status applied 20260821000001`
   then `npx supabase migration list --linked` → 99/99.
4. **App deployment:** the pushed SHA (Vercel auto-deploy); `/api/version`
   must return it.
5. **Smoke (UI, operator):** `/departments/hr/configuration` renders the
   studio (no refusal panel) → save numbering (prefix `EMP` or blank) →
   activate → create the department units per section D → dashboard banner
   gone, structure counters non-zero.

## J. HR-A1 UAT checklist

- [ ] Configuration center reachable by the HR_OFFICER account — through the
      role, no special-casing (verify: any account WITHOUT HR_OFFICER still
      sees refusal/404).
- [ ] Configuration saved and activated (DRAFT → ACTIVE) via the UI; audit rows
      `hr.configuration_saved` / `hr.configuration_activated` exist.
- [ ] Org units created for the real Effitrans structure, each DEPARTMENT unit
      linked to its canonical correspondence; hierarchy order enforced
      (a TEAM cannot parent a DEPARTMENT — trigger refusal visible).
- [ ] Numbering: matricule preview/first allocation will be `EMP-0001`
      (verify via DB suite in CI; production allocation belongs to HR-A2's
      first employee — **do not create an employee to test it**).
- [ ] Dashboard recognizes the configuration (banner gone; counters live,
      honest zeros for employees).
- [ ] No employee record fabricated; `employee` still 0 rows.
- [ ] **Placement grants nothing:** the operator's permissions are identical
      before/after creating org units (`get_user_permissions` output unchanged);
      an account linked to a future employee row gains nothing (test-pinned +
      SQL-suite-proven).

## K. Remaining blockers before HR-A2

1. **Second HR_OFFICER** (F2) — a role assignment through the existing user
   admin, required before contract maker-checker or import quatre-yeux visas
   can complete. Named by the business, not invented here.
2. **HRQ-A4** — import *application* stays pinned at READY until the
   staging-purge legal answer; manual registry entry is unaffected.
3. The organizational structure itself must be configured (the UI session
   above) before assignments can reference it.
4. Parked seats (`hr:leave:approve`, `hr:performance:finalize`) remain for
   HR-A3/HR-A4 — each needs a named person.
