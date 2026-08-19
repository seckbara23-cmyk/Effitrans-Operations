-- 20260910000001_canonical_transport_department.sql
-- Effitrans Operations Platform — TMS-5C: canonical TRANSPORT department.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 118.
--
-- WHY A MIGRATION IS GENUINELY REQUIRED. The 9.0A registry states that a
-- department is DERIVED from roles and "never stored". The TMS-5C audit found
-- that claim is not absolute: the canonical vocabulary is written into THREE
-- CHECK constraints, each enumerating the four pre-TMS-5C codes. Adding a fifth
-- department without widening them would leave the schema contradicting the
-- registry — and two of the three are actively used:
--
--   * employee.department                   NOT NULL, HR-1 employee registry.
--                                           The HR wizard and import template
--                                           build their picker from
--                                           CANONICAL_DEPARTMENTS, so the moment
--                                           an operator files someone under
--                                           « Transport » the insert would be
--                                           REJECTED by the database.
--   * hr_org_unit.canonical_department      same, for the organizational tree.
--   * process_blocker.source_department_code  latent: no application writer and
--                                           zero rows in production today, but
--                                           it would reject a blocker raised by
--                                           the Transport department.
--
-- This is a pure WIDENING: every pre-existing value stays valid, no row is
-- rewritten and nothing is backfilled — no production data holds 'TRANSPORT'
-- yet, because until now it could not.
--
-- NOT here: no data change, no new table, no new permission, no RLS change.

-- 1. The HR employee registry (LIVE — NOT NULL, populated).
alter table public.employee
  drop constraint if exists employee_department_check;
alter table public.employee
  add constraint employee_department_check
  check (department in
         ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES'));

-- 2. The HR organizational tree (LIVE — nullable).
alter table public.hr_org_unit
  drop constraint if exists hr_org_unit_canonical_department_check;
alter table public.hr_org_unit
  add constraint hr_org_unit_canonical_department_check
  check (canonical_department is null or canonical_department in
         ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES'));

-- 3. Workflow blockers (latent — no writer, zero rows).
alter table public.process_blocker
  drop constraint if exists process_blocker_source_department_code_check;
alter table public.process_blocker
  add constraint process_blocker_source_department_code_check
  check (source_department_code is null or source_department_code in
         ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES'));

-- ---------------------------------------------------------------------------
-- SELF-ASSERTIONS
-- ---------------------------------------------------------------------------

-- 1. ALL THREE constraints accept TRANSPORT, and none lost an existing code.
do $$
declare
  v_def text;
  v_target record;
begin
  for v_target in
    select * from (values
      ('employee', 'employee_department_check'),
      ('hr_org_unit', 'hr_org_unit_canonical_department_check'),
      ('process_blocker', 'process_blocker_source_department_code_check')
    ) as t(rel, con)
  loop
    select pg_get_constraintdef(c.oid) into v_def
      from pg_constraint c
      join pg_class k on k.oid = c.conrelid
     where k.relname = v_target.rel and c.conname = v_target.con;
    if v_def is null then
      raise exception 'TMS-5C assertion 1 failed: % is missing on %', v_target.con, v_target.rel;
    end if;
    if v_def not like '%TRANSPORT%' then
      raise exception 'TMS-5C assertion 1 failed: % does not accept TRANSPORT (%)', v_target.rel, v_def;
    end if;
    if v_def not like '%OPERATIONS%' or v_def not like '%TRANSIT%'
       or v_def not like '%FINANCE%' or v_def not like '%HUMAN_RESOURCES%' then
      raise exception 'TMS-5C assertion 1 failed: % lost an existing code (%)', v_target.rel, v_def;
    end if;
  end loop;
end $$;

-- 2. Nothing was rewritten: every stored department is still a known code.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.employee
   where department not in ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES');
  if v_bad > 0 then
    raise exception 'TMS-5C assertion 2 failed: % employee(s) hold an unknown department', v_bad;
  end if;

  select count(*) into v_bad from public.hr_org_unit
   where canonical_department is not null
     and canonical_department not in ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES');
  if v_bad > 0 then
    raise exception 'TMS-5C assertion 2 failed: % org unit(s) hold an unknown department', v_bad;
  end if;

  select count(*) into v_bad from public.process_blocker
   where source_department_code is not null
     and source_department_code not in ('OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES');
  if v_bad > 0 then
    raise exception 'TMS-5C assertion 2 failed: % blocker(s) hold an unknown department', v_bad;
  end if;
end $$;
