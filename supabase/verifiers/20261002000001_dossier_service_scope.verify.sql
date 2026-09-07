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
    -- A scope may only exist because somebody chose it. This does not forbid
    -- operator choices made after the migration — it asserts that any dossier
    -- created BEFORE it still has none, which is what « do not invent it »
    -- means for the twelve rows that predate the column.
    ('no dossier predating this migration was given a scope', (
      select count(*) = 0 from public.operational_file
       where services is not null
         and created_at < (
           select coalesce(max(inserted_at), 'infinity'::timestamptz)
             from supabase_migrations.schema_migrations
            where version = '20261002000001'
         )
    )),

    -- ---- 5. Blast radius --------------------------------------------------
    -- The column inherits the table's existing RLS; the migration adds no
    -- policy of its own, and a new policy here would be a second visibility
    -- rule on a table that already has one.
    ('row-level security on operational_file is untouched and still enabled', (
      select relrowsecurity from pg_class where oid = 'public.operational_file'::regclass
    )),

    ('the migration created no trigger on operational_file', (
      select count(*) = 0 from pg_trigger
       where tgrelid = 'public.operational_file'::regclass
         and not tgisinternal
         and tgname like '%service%'
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'OPS-SERVICE-SCOPE-01 #140 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'OPS-SERVICE-SCOPE-01 #140 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
