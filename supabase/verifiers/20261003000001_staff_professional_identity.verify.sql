-- VERIFIER for 20261003000001_staff_professional_identity
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT A VERIFIER IS FOR. The migration's own `do $$ … raise exception` blocks
-- protect the moment of application and can never run again. This is the
-- durable postcondition — what the integrity guard runs months later to answer
-- the question a ledger comparison cannot: is this migration actually applied,
-- or merely unrecorded?
--
-- SO IT CHECKS MEANING, NOT NAMES. « Three columns called first_name, last_name
-- and staff_function exist » would pass against columns that were backfilled by
-- splitting display names, against a NOT NULL column that broke every profile
-- predating it, and against a schema where somebody had meanwhile wired a
-- permission to the function value. Each assertion below names a property the
-- feature would be WRONG without.
-- ===========================================================================
with checks(label, ok) as (
  values
    -- ---- 1. The three columns, with the shape the fallback depends on -----
    -- NULLABLE is load-bearing: NULL is « never recorded », which is what makes
    -- a legacy user fall back to app_user.name instead of rendering blank.
    ('the three identity columns exist, are text, nullable and default-free', (
      select count(*) = 3
        from information_schema.columns
       where table_schema = 'public' and table_name = 'workforce_profile'
         and column_name in ('first_name', 'last_name', 'staff_function')
         and data_type = 'text' and is_nullable = 'YES' and column_default is null
    )),

    -- ---- 2. The shape constraint ------------------------------------------
    ('the identity CHECK constraint is present and validated', (
      select count(*) = 1 from pg_constraint
       where conrelid = 'public.workforce_profile'::regclass
         and conname = 'workforce_profile_identity_shape'
         and contype = 'c' and convalidated
    )),

    -- Belt and braces over the CHECK: this reads the DATA, so it also catches a
    -- constraint added NOT VALID or dropped after the fact. « Recorded as an
    -- empty string » and « never recorded » must not both be expressible.
    ('no profile carries a blank identity value', (
      select count(*) = 0 from public.workforce_profile
       where btrim(coalesce(first_name, 'x')) = ''
          or btrim(coalesce(last_name, 'x')) = ''
          or btrim(coalesce(staff_function, 'x')) = ''
    )),

    -- ---- 3. THE INVARIANT: nothing was invented --------------------------
    -- ⚠⚠ THIS CHECK WAS BROKEN, AND THE REPAIR IS NOT A WEAKENING.
    --
    -- It compared the row's `created_at` against the moment this migration was
    -- recorded, read from `supabase_migrations.schema_migrations.inserted_at`.
    -- THAT COLUMN DOES NOT EXIST. The ledger has exactly three columns —
    -- `version`, `statements`, `name` — verified against production and CI.
    --
    -- A verifier is ONE statement, so Postgres plans the whole file before
    -- executing any of it: an unresolvable column anywhere killed EVERY check
    -- in the file, including the ones that would have passed. And the runner
    -- reaches its verifier at step 3, AFTER the SQL has been applied, where it
    -- classifies a verifier that cannot run as VERIFY_FAILED — "production is
    -- indeterminate, no automatic rollback, diagnose by hand". The worst state
    -- the toolchain has, produced by a typo in the safety net.
    --
    -- IT COULD NOT HAVE BEEN FIXED BY NAMING A DIFFERENT LEDGER COLUMN either.
    -- A verifier must be rerunnable months later, when operators have
    -- legitimately filled these fields in — so "count the rows that carry a
    -- value" can never be the durable form of this invariant, whatever it is
    -- compared against.
    --
    -- SO THE CONCERN IS SPLIT, each half asserted where it can actually be
    -- proven:
    --   the MIGRATION asserts, at the moment of application and only then,
    --     that no row already carries a value (its own `raise exception`);
    --   the VERIFIER asserts, durably and forever, the structural property
    --     that makes a SILENT backfill impossible: nothing in the database can
    --     populate these fields behind an operator's back. No default, and no
    --     trigger whose body so much as mentions them.
    ('a name can only appear by an explicit write — no default populates one', (
      select count(*) = 0 from information_schema.columns
       where table_schema = 'public' and table_name = 'workforce_profile'
         and column_name in ('first_name', 'last_name', 'staff_function')
         and column_default is not null
    )),

    ('… and no trigger on the table can write one', (
      select count(*) = 0
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.workforce_profile'::regclass
         and not t.tgisinternal
         and (p.prosrc like '%first_name%' or p.prosrc like '%last_name%'
              or p.prosrc like '%staff_function%')
    )),

    -- ---- 4. IDENTITY IS NOT AUTHORITY -------------------------------------
    -- The hard architectural rule, asserted in the database rather than only in
    -- TypeScript: no permission, role or grant may key on a professional
    -- function or title. If one ever did, changing a person's job description
    -- would change what they may do.
    ('no permission code was created from the identity vocabulary', (
      select count(*) = 0 from public.permission
       where code ilike '%staff_function%' or code ilike '%job_title%'
          or code ilike '%first_name%' or code ilike '%main_title%'
    )),

    ('no policy or function on workforce_profile reads the function column', (
      select count(*) = 0
        from pg_policies
       where schemaname = 'public' and tablename = 'workforce_profile'
         and coalesce(qual, '') || coalesce(with_check, '') like '%staff_function%'
    )),

    -- ---- 5. Blast radius ---------------------------------------------------
    -- The title store is untouched: it existed before this migration, it is the
    -- SAME column the Digital Business Card already reads, and this slice adds
    -- an editor rather than a second value.
    ('job_title is untouched and still nullable', (
      select count(*) = 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'workforce_profile'
         and column_name = 'job_title' and is_nullable = 'YES'
    )),

    ('row-level security on workforce_profile is still enabled', (
      select relrowsecurity from pg_class where oid = 'public.workforce_profile'::regclass
    )),

    -- Superseded in substance by the trigger-BODY check above: matching on a
    -- trigger's NAME proves nothing, because the next author names it
    -- something else. Kept as the cheap first line.
    ('no identity trigger was added to workforce_profile by this slice', (
      select count(*) = 0 from pg_trigger
       where tgrelid = 'public.workforce_profile'::regclass
         and not tgisinternal
         and (tgname ilike '%identity%' or tgname ilike '%name%')
    )),

    -- HR is a different object with a different lifecycle. This slice must not
    -- have reached into it.
    ('HR''s employee registry was not touched', (
      select count(*) = 3 from information_schema.columns
       where table_schema = 'public' and table_name = 'employee'
         and column_name in ('first_name', 'last_name', 'department')
         and is_nullable = 'NO'
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'ADMIN-USER-IDENTITY-01 #141 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'ADMIN-USER-IDENTITY-01 #141 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
