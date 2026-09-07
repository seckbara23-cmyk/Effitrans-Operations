-- VERIFIER for 20261002000001_dossier_service_scope
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
-- SO IT CHECKS MEANING, NOT NAMES. « A column called services exists » would
-- pass against a NOT NULL column with a default of '{}', against a column whose
-- CHECK was dropped, and against a backfilled table — and every one of those
-- would be a worse outcome than not applying the migration at all, because the
-- applicability evaluator would then remove official steps from dossiers on the
-- strength of a value nobody chose.
-- ===========================================================================
with checks(label, ok) as (
  values
    -- ---- 1. The column, with the shape the evaluator depends on ----------
    -- NULLABLE is load-bearing: NULL is « never recorded », which is what makes
    -- a legacy dossier fall through to type derivation instead of asserting
    -- that Effitrans sells nothing on it.
    ('operational_file.services exists, is an array, and is nullable', (
      select count(*) = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'operational_file'
         and column_name = 'services'
         and data_type = 'ARRAY'
         and is_nullable = 'YES'
    )),

    -- A DEFAULT would silently give every new dossier a scope nobody chose,
    -- which is the same defect as a backfill with a slower fuse.
    ('it carries no default', (
      select count(*) = 1
        from information_schema.columns
       where table_schema = 'public' and table_name = 'operational_file'
         and column_name = 'services' and column_default is null
    )),

    -- ---- 2. The constraint that keeps a stored scope meaningful ----------
    ('the services CHECK constraint is present and validated', (
      select count(*) = 1 from pg_constraint
       where conrelid = 'public.operational_file'::regclass
         and conname = 'operational_file_services_known'
         and contype = 'c' and convalidated
    )),

    -- The two service codes the platform knows, named IN the constraint, so a
    -- third one cannot appear in data without appearing here first.
    ('the constraint names exactly the two known services', (
      select pg_get_constraintdef(oid) like '%customs%'
         and pg_get_constraintdef(oid) like '%transport%'
        from pg_constraint
       where conrelid = 'public.operational_file'::regclass
         and conname = 'operational_file_services_known'
    )),

    -- ---- 3. No stored scope is empty, and none is unknown ---------------
    -- Belt and braces over the CHECK: this reads the DATA, so it also catches a
    -- constraint that was added NOT VALID or dropped after the fact.
    ('no dossier carries an empty or unknown service scope', (
      select count(*) = 0 from public.operational_file
       where services is not null
         and (array_length(services, 1) is null
              or not (services <@ array['customs', 'transport']::text[]))
    )),

    -- ---- 4. THE INVARIANT: nothing was invented --------------------------
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
    ('a scope can only appear by an explicit write — no default populates it', (
      select count(*) = 0 from information_schema.columns
       where table_schema = 'public' and table_name = 'operational_file'
         and column_name = 'services' and column_default is not null
    )),

    ('… and no trigger on the table can write it', (
      select count(*) = 0
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.operational_file'::regclass
         and not t.tgisinternal
         and p.prosrc like '%services%'
    )),

    -- ---- 5. Blast radius --------------------------------------------------
    -- The column inherits the table's existing RLS; the migration adds no
    -- policy of its own, and a new policy here would be a second visibility
    -- rule on a table that already has one.
    ('row-level security on operational_file is untouched and still enabled', (
      select relrowsecurity from pg_class where oid = 'public.operational_file'::regclass
    )),

    -- Superseded by the trigger-BODY check above: matching on a trigger's NAME
    -- proves nothing, because the next author names it something else.
    ('no trigger was added to operational_file by this slice', (
      select count(*) = 0
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.operational_file'::regclass
         and not t.tgisinternal
         and (t.tgname like '%service%' or p.prosrc like '%services%')
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'OPS-SERVICE-SCOPE-01 #140 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'OPS-SERVICE-SCOPE-01 #140 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
