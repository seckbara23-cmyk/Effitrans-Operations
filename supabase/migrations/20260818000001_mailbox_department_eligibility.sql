-- ============================================================================
-- EMP-5D — separate department eligibility from mailbox business purpose (DARK)
-- ============================================================================
-- RATIFY-EMP5C-1, answered by audit: `ec_mailbox.purpose` is serving TWO
-- concepts at once, and that is why constraining it was impossible.
--
--   (1) MAILBOX BUSINESS PURPOSE -- free tenant vocabulary. EC-1 designed it
--       that way ("quotation, operations, finance, transit, ..."), defaulted it
--       to 'GENERAL', and its own suite stores 'QUOTATION'. It is displayed in
--       administration and carried on the mailbox summary.
--
--   (2) DEPARTMENT ELIGIBILITY -- lib/ec/mailboxes/bulk.ts compares that same
--       free-text column against EMP-4A's six-value set BY STRING EQUALITY, so
--       WHETHER A MAILBOX IS OFFERED TO A USER DEPENDS ON ITS SPELLING. A
--       mailbox typed 'Operations' or 'OPERATIONS ' is silently offered to
--       nobody, and looks perfectly healthy while being invisible.
--
-- One column cannot be both a free label and a controlled key. This adds the
-- controlled key alongside the label instead of constraining the label, so:
--
--   * 'GENERAL' stays valid and is NOT reinterpreted;
--   * 'QUOTATION' stays valid;
--   * the column default stays insertable -- the incoherence that made the
--     EMP-5C attempt impossible;
--   * no existing row changes, and aminata@effitrans.com is untouched;
--   * the canonical department registry is NOT duplicated. DEPARTMENT_MAILBOXES
--     in lib/ec/mailboxes/eligibility.ts remains the single source of which
--     department implies which eligibility; this column only records which
--     bucket a given mailbox belongs to, chosen from that same vocabulary.
--
-- DARK. Nothing reads this column yet. `bulk.ts` still keys on `purpose`
-- exactly as before, so eligibility behaviour is byte-identical today.
-- Switching the comparison is a BEHAVIOUR change and belongs to its own phase.
--
-- NULL means "not a departmental mailbox / not yet classified", which is
-- precisely the current effective state of every row: the one production
-- mailbox carries 'GENERAL' and is already offered to nobody. Defaulting it to
-- anything else would silently make a mailbox eligible that is not.
-- ============================================================================

alter table public.ec_mailbox
  add column if not exists department_eligibility text;

-- Constrained, and safe to constrain BECAUSE it is nullable and has no existing
-- non-null values -- the exact opposite of the `purpose` situation, where the
-- column was NOT NULL with a default that the proposed constraint outlawed.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox'::regclass
                    and conname = 'ec_mailbox_department_eligibility_check') then
    alter table public.ec_mailbox
      add constraint ec_mailbox_department_eligibility_check
      check (department_eligibility is null
             or department_eligibility in
                ('OPERATIONS','TRANSIT','CUSTOMS','FINANCE','COMMERCIAL','SUPPORT'));
  end if;
end $$;

comment on column public.ec_mailbox.department_eligibility is
  'EMP-5D. Which department-eligibility bucket this mailbox belongs to, drawn '
  'from EMP-4A''s canonical set. Separate from `purpose`, which stays free '
  'tenant vocabulary: one column cannot be both a display label and a '
  'controlled key. NULL = not a departmental mailbox / not yet classified. '
  'DARK -- nothing reads it yet; eligibility still keys on `purpose`.';

-- ---------------------------------------------------------------------------
-- ASSERTIONS — data-independent, so they cannot pass vacuously on CI's empty
-- database.
-- ---------------------------------------------------------------------------
do $assert_shape$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid='public.ec_mailbox'::regclass
                    and attname='department_eligibility' and not attisdropped) then
    raise exception 'EMP-5D: department_eligibility missing';
  end if;

  -- Nullable, or every existing row would need a value it has no basis for.
  if exists (select 1 from pg_attribute
              where attrelid='public.ec_mailbox'::regclass
                and attname='department_eligibility' and attnotnull) then
    raise exception 'EMP-5D: department_eligibility must be nullable';
  end if;

  -- No default: a default would silently classify every future mailbox.
  if (select column_default from information_schema.columns
       where table_schema='public' and table_name='ec_mailbox'
         and column_name='department_eligibility') is not null then
    raise exception 'EMP-5D: department_eligibility must have no default';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid='public.ec_mailbox'::regclass
                    and conname='ec_mailbox_department_eligibility_check') then
    raise exception 'EMP-5D: department_eligibility CHECK missing';
  end if;

  -- And `purpose` STILL has no constraint. EMP-5C asserted this; re-asserting
  -- it here keeps the separation honest: adding the eligibility column is what
  -- makes constraining `purpose` unnecessary, not a step towards doing it.
  if exists (select 1 from pg_constraint
              where conrelid='public.ec_mailbox'::regclass
                and conname='ec_mailbox_purpose_check') then
    raise exception 'EMP-5D: purpose must remain unconstrained free vocabulary';
  end if;

  raise notice 'EMP-5D: department_eligibility added (dark, additive)';
end
$assert_shape$;
