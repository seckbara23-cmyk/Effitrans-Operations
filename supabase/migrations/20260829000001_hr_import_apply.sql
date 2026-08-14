-- ===========================================================================
-- EFFITRANS-HR-B3 — the import pipeline learns to APPLY (mass employee
-- registration, ratified by HRQ-A4 = YES).
-- ---------------------------------------------------------------------------
-- HR-1 built the pipeline and deliberately stopped it at READY: staging,
-- mapping, validation, maker submit, four-eyes visa — and no application
-- stage, because HRQ-A4 was unanswered. Effitrans has now answered YES, so the
-- pipeline gains its last two states and the durable evidence of what an
-- application did.
--
-- WHAT THIS MIGRATION DOES NOT DO. It creates no insertion path: employees are
-- created by the APPLICATION CODE calling the exact same createEmployee action
-- an individual registration uses — same matricule engine
-- (next_employee_number), same target validation, same ledger event, same
-- audit. The database here only records the batch lifecycle and which staging
-- row became which employee.
--
-- STATE MACHINE (additive):
--   STAGED → VALIDATED → SUBMITTED → READY → APPLYING → APPLIED
--                                                      ↘ APPLIED_WITH_ERRORS
-- APPLYING exists so a second concurrent apply finds the CAS already taken —
-- double submission is refused by state, not by hope.
--
-- RE-RUN SAFE: add column if not exists, guarded constraint swaps.
-- ===========================================================================

alter table public.hr_import_batch
  add column if not exists applied_by    uuid references public.app_user (id),
  add column if not exists applied_at    timestamptz,
  add column if not exists applied_count int not null default 0,
  add column if not exists failed_count  int not null default 0;

-- Which employee a spreadsheet row became, and how each row ended.
alter table public.hr_import_staging_row
  add column if not exists employee_id    uuid references public.employee (id),
  add column if not exists outcome        text
    check (outcome is null or outcome in ('CREATED', 'FAILED', 'SKIPPED')),
  add column if not exists outcome_reason text;

-- Widen the batch lifecycle. The old CHECK is replaced by the superset; the
-- READY-requires-visa invariant is preserved and extended: an APPLIED batch
-- must name who applied it.
do $$
begin
  alter table public.hr_import_batch drop constraint if exists hr_import_batch_status_check;
  alter table public.hr_import_batch add constraint hr_import_batch_status_check
    check (status in ('STAGED', 'VALIDATED', 'SUBMITTED', 'READY', 'REJECTED', 'CANCELLED',
                      'APPLYING', 'APPLIED', 'APPLIED_WITH_ERRORS'));

  if not exists (select 1 from pg_constraint where conname = 'hr_import_batch_applied_visa') then
    alter table public.hr_import_batch add constraint hr_import_batch_applied_visa
      check (status not in ('APPLYING', 'APPLIED', 'APPLIED_WITH_ERRORS') or applied_by is not null);
  end if;
end $$;

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare n int; v_def text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'hr_import_batch'
     and column_name in ('applied_by', 'applied_at', 'applied_count', 'failed_count');
  if n <> 4 then raise exception 'HR-B3: the four apply-evidence columns must exist on the batch'; end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'hr_import_staging_row'
     and column_name in ('employee_id', 'outcome', 'outcome_reason');
  if n <> 3 then raise exception 'HR-B3: the three row-outcome columns must exist'; end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.hr_import_batch'::regclass
     and conname = 'hr_import_batch_status_check';
  if v_def !~ 'APPLYING' or v_def !~ 'APPLIED_WITH_ERRORS' then
    raise exception 'HR-B3: the batch lifecycle must include the apply states';
  end if;
  -- The four-eyes invariant survived the widening.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.hr_import_batch'::regclass
     and pg_get_constraintdef(oid) like '%approved_by%';
  if v_def is null then
    raise exception 'HR-B3: READY must still require a visa (approved_by)';
  end if;
end $$;
