-- 20260801000002_hr_employee_workspace.sql
-- Effitrans HR Platform — HR-2: Employee Workspace (frozen HR-0F; ratified §11).
-- ---------------------------------------------------------------------------
-- ADDITIVE + MINIMAL. Two changes only, both proven necessary by HR-2's scope:
--   1. the import-kind CHECK widens to accept 'EMPLOYEES' (staging-only, like
--      the org kinds — application stays gated behind HRQ-A4);
--   2. a partial index for the profile's current-assignment read.
-- No new table, no new permission, no grant, no seed. B1 pause untouched.

alter table public.hr_import_batch drop constraint if exists hr_import_batch_import_kind_check;
alter table public.hr_import_batch add constraint hr_import_batch_import_kind_check
  check (import_kind in ('ORG_UNITS', 'POSITIONS', 'WORK_LOCATIONS', 'EMPLOYEES'));

create index if not exists idx_assignment_open_by_employee
  on public.employee_assignment (tenant_id, employee_id)
  where effective_to is null;
