# HR-1 — Dashboard & Organization Foundation: Completion Report

**Date:** 2026-08-01 · **Architecture:** HR-0F (frozen; no decision revisited)
**Deployment posture:** dark-first — the configuration surface denies everyone until
HRQ-D2 grants its permission; org tables ship empty; the import pipeline is staging-only.

## Architecture reuse report

| Reused unchanged | How |
|---|---|
| `requireUser` + `getEffectivePermissions` + `hasPermission` | every page/action gate |
| `assertPermission` | every server action |
| `writeAudit` | every write audits (`hr.configuration_saved`, `hr.org_unit_created`, `hr.import_*`, …) |
| `getAdminSupabaseClient` service-role writes + SELECT-only RLS | uniform idiom, all 9 new tables |
| `set_updated_at`, `prevent_mutation` (WES-9) | triggers — nothing re-invented |
| `PageHeader`, `StatCard`, hub-tile pattern | the dashboard is composition |
| `employee`, `employee_counter`, `next_employee_number` (migr. 57) | untouched; numbering *configuration* added around the existing engine |
| FIN-AGING-2 staging shape | `hr_import_*` mirrors `legacy_import_*` incl. the structural maker-checker CHECK |
| Nav machinery | the ratified MANAGEMENT entry (`hr:read`) already existed — untouched |

**Built new:** the org spine (5 tables), the Timeline ledger foundation, the generalized
HR import staging (3 tables), the four HR-1 pages, two client studios, the pure
`org-tree` helper module.

**Deliberately NOT built:** employee CRUD, contracts, leave, attendance, payroll, assets,
performance, training, offboarding, reporting, drag-editing of the tree, any batch-apply
code path, any permission beyond the two ratified codes.

## Scope-vs-instruction notes (deviations stated, none silent)

1. **Navigation.** The instruction said « Departments → Human Resources ». The ratified
   sidebar contract fixes DÉPARTEMENTS at three entries, and the ratified HR entry lives
   under **MANAGEMENT** (HR is a support function, not an operational department; the
   route is `/departments/hr`, so the URL reads "departments" either way). The ratified
   placement stands; a structural test now pins **both** facts.
2. **Positions vs Job Titles.** One catalog (`hr_position`) by frozen design — a
   position *is* the job-title catalog entry; per-employee instantiation is
   `employee_assignment` (HR-2 wires it). No duplicate entity.
3. **The registry moved down one level** (`/departments/hr` → `/departments/hr/registre`)
   so the dashboard could take the hub, per the ratified « the HR Dashboard is HR-1's
   first page ». The employee-detail route (`/departments/hr/[id]`) is unchanged.

## Files created

| File | Purpose |
|---|---|
| `supabase/migrations/20260801000001_hr_organization_foundation.sql` | migration 73 (below) |
| `lib/hr/org-tree.ts` | pure tree helpers (unit-testable, client-safe) |
| `lib/hr/organization.ts` | server reads (units, positions, locations, config, batches, dashboard counts) |
| `lib/hr/organization-actions.ts` | server actions: config save/activate, org catalogs, import staging pipeline |
| `app/departments/hr/page.tsx` | the HR Dashboard — 8 cards, dark tiles named by phase |
| `app/departments/hr/organisation/page.tsx` | read-only tree (server-rendered, no drag) |
| `app/departments/hr/configuration/page.tsx` | permanent configuration workspace (gated `hr:config:manage`) |
| `app/departments/hr/imports/page.tsx` | staging workspace (gated `hr:manage`) |
| `components/hr/configuration-studio.tsx` | config client: numbering, vocabularies, units, positions, sites |
| `components/hr/import-studio.tsx` | import client: upload → … → READY, honest about the stop |
| `supabase/tests/rls_hr_organization_test.sql` | 12-check RLS/trigger/CHECK suite |
| `tests/hr-1-organization.test.ts` | 24 structural contracts |
| `docs/hr/hr-1-completion-report.md` | this report |

## Files modified

`app/departments/hr/page.tsx → registre/page.tsx` (git mv; content intact) ·
`app/departments/hr/[id]/page.tsx` (back-link) · `lib/db/types.ts` (9 table types) ·
`.github/workflows/ci.yml` (HR-1 suite appended LAST) · `lib/platform/ops/build-info.ts`
(LATEST_MIGRATION/COUNT → 73, the CI-pinned constants) · six test files (deliberate
latest-migration pin bumps; the runs-LAST pin moved to the new suite) ·
`docs/releases/STATUS.md`.

## Migration added — 73 (`20260801000001`)

Nine tables: `hr_configuration` · `hr_org_unit` · `hr_position` · `hr_work_location` ·
`employee_assignment` · `hr_employee_event` · `hr_import_batch` · `hr_import_staging_row`
· `hr_import_error`. Two **ungranted** permission rows (`hr:config:manage`,
`hr:sensitive:read`). Triggers: kind-order descent (+ same-tenant parent), one open
PRIMARY assignment (partial unique), ledger `prevent_mutation`, **`employee_number`
immutability** (the HR-0R hardening item), `set_updated_at` ×5. Structural maker-checker:
`approved_by <> submitted_by`; READY requires an approval. RLS on all nine (SELECT-only;
`hr:read` for structure, `hr:manage` for staging). Idempotent throughout; **no
role_permission row; no seed data; not applied to production** (operator step, per the
standing sequence).

## Tests added

- **`rls_hr_organization_test.sql`** (CI, live Postgres): tenant confinement ×3 seats,
  SYSTEM_ADMIN sees 0 (DEC-B25), portal-invisible by absence of policy, kind-order
  rejection, cross-tenant-parent rejection, ledger append-only, matricule immutability,
  self-approval rejection, and **the B1 pause provable** (2 catalog rows, 0 grants).
- **`tests/hr-1-organization.test.ts`** (24): B1 pause pins (no `role_permission`, no
  invented codes, no SYSTEM_ADMIN anywhere), the nine tables + RLS + policies, trigger and
  CHECK presence, **no apply path exists**, ratified nav placement (3-entry DÉPARTEMENTS +
  HR under MANAGEMENT), dashboard/registry split, dark cards name their phase,
  configuration page names HRQ-D2, tree read-only, CI suite appended last, `buildOrgTree`
  behaviour.

## Gate results

| Gate | Result |
|---|---|
| vitest | **190 files · 4618 tests · all green** (7 drift-pins bumped deliberately, each a named constant that exists to force this conversation) |
| `tsc --noEmit` | exit 0 |
| `npm run build` | ✓ Compiled successfully; all six `/departments/hr*` routes present |
| lint | part of `next build` (passed) |

## Risks

| Risk | Position |
|---|---|
| Migration 73 unapplied in production while code deploys | **By design** (expand-dark). Every read fails soft into empty states; the config surface is permission-dark regardless. Operator applies 73 per the standing sequence, then STATUS records it |
| `hr_position` unique(title) collides with tenant homonyms | acceptable at this scale; revisit at HR-2 if real data disagrees |
| CSV mapping is manual (field=header pairs) | staging-only UX; a mapping UI can improve in HR-2 without schema change |
| Staging `raw` retention | HRQ-A4 open — **activation-blocking, already the ratified position** |

## Remaining blockers (unchanged from HR-0F)

**B1** HRQ-D2 grant ratification (one INSERT migration once ratified — until then the
configuration center is visible-but-denied, stating the dependency) · **B2** structure
answers (seed content, entered through the wizard once B1 lands) · **B3** HRQ-A4 purge
window (blocks batch *application*, a later phase anyway) · B4–B6 unchanged, none blocks
HR-2.

## Readiness assessment

**Is HR-1 complete and ready for HR-2 (Employee Workspace)? Yes — with the stated
condition.** Everything in HR-1's frozen scope is built, tested and green; the surfaces
that must wait for ratification wait *visibly*, not by omission. HR-2 (directory + profile
as a workspace, Timeline UI over the ledger, EMPLOYEES import kind) depends on nothing
here that is still open: the ledger table exists, the assignment spine exists, the import
core exists. The practical sequence before HR-2 *activation* (not implementation):
operator applies migration 73 → B1 ratification grants the two codes → B2 answers seed
the structure. **Awaiting explicit approval to begin HR-2.**
