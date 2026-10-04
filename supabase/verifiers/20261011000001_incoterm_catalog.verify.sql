-- VERIFIER for 20261011000001_incoterm_catalog
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly against
-- production. Mutates no schema, no data, no permission, no session role, no
-- configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is one governed column and one new nullable
-- column, so the postconditions are: the constraint exists, admits exactly the
-- eleven codes and null, governs the code and not the place, and the place
-- column exists as optional text.
--
-- UNCONDITIONAL THROUGHOUT. The evidence is the SCHEMA, which exists in every
-- database the migration has been applied to, so there is no subject that can be
-- absent and no branch that can pass vacuously on a fresh stack.
--
-- IT ASSERTS THE ABSENCE OF A TWELFTH CODE, not merely the presence of eleven.
-- A later edit that widened the vocabulary — or narrowed it — would otherwise
-- satisfy a presence-only check. The count of quoted literals is pinned.
--
-- IT ALSO ASSERTS WHAT THE SLICE PROMISED NOT TO DO. Recording a commercial fact
-- must not have become a workflow input, so the verifier checks that the column
-- is still absent from the workflow vocabulary: no step-registry row, no gate and
-- no process table references it. That is the half a reviewer cannot see by
-- reading the ALTER.
--
-- IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file down
-- with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with con as (
  select coalesce(
    (select pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'shipment'
        and c.conname = 'shipment_incoterm_check'
      limit 1),
    '') as def,
  coalesce(
    (select c.convalidated
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'shipment'
        and c.conname = 'shipment_incoterm_check'
      limit 1),
    false) as validated
),
cols as (
  select
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'shipment'
        and column_name = 'incoterm_place') as place_nullable,
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'shipment'
        and column_name = 'incoterm_place') as place_type,
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'shipment'
        and column_name = 'incoterm') as incoterm_nullable
),
codes(code) as (
  values ('EXW'),('FCA'),('FAS'),('FOB'),('CFR'),('CIF'),
         ('CPT'),('CIP'),('DPU'),('DAP'),('DDP')
),
checks(label, ok) as (
  values
    -- ---- 1. the governed column ------------------------------------------
    ('shipment_incoterm_check exists', (select def <> '' from con)),
    ('… and is VALIDATED against the existing rows', (select validated from con)),
    ('… and admits a null incoterm, so the field stays optional', (
      select def like '%IS NULL%' from con
    )),
    ('… and admits all eleven Incoterms 2020 codes', (
      select not exists (
        select 1 from codes c where (select def from con) not like '%''' || c.code || '''%')
    )),
    -- Presence of eleven does not exclude a twelfth. Count the quoted literals.
    ('… and exactly eleven, so the vocabulary was neither widened nor narrowed', (
      select (length(def) - length(replace(def, '''', ''))) / 2 = 11 from con
    )),
    ('… and governs the CODE, never the free-text place', (
      select def not like '%incoterm_place%' from con
    )),

    -- ---- 2. the named place ----------------------------------------------
    ('shipment.incoterm_place exists', (select place_nullable is not null from cols)),
    ('… as text', (select place_type = 'text' from cols)),
    ('… and optional', (select place_nullable = 'YES' from cols)),
    ('shipment.incoterm is still optional too', (
      select incoterm_nullable = 'YES' from cols
    )),

    -- ---- 3. THE INVARIANT: no row disagrees with the vocabulary ----------
    ('no shipment holds a non-canonical incoterm', (
      select count(*) = 0 from public.shipment
       where incoterm is not null
         and incoterm not in (select code from codes)
    )),
    -- A place without a code is not Incoterm data. Not an error in the database
    -- — the UI simply never renders it — but worth noticing if it appears.
    --
    -- READ THROUGH to_jsonb SO THIS FILE STAYS PLANABLE. A verifier is ONE
    -- statement, so a bare reference to a column that does not exist yet makes
    -- Postgres reject the WHOLE file with 42703 and take every other check down
    -- with it — which is how the #140/#141 verifiers failed silently
    -- (MIGRATION-GATE-139-141-REPAIR). Against a database that lacks the column
    -- the key is simply absent, this check is vacuously true, and the
    -- column-existence check above is what correctly reports FAILED. Against one
    -- that has it, the two read the same rows.
    ('no shipment carries a place with no code', (
      select count(*) = 0 from public.shipment s
       where s.incoterm is null
         and coalesce(trim(to_jsonb(s) ->> 'incoterm_place'), '') <> ''
    )),

    -- ---- 4. SEE: a fact, not a workflow input ----------------------------
    -- The slice promised the Incoterm activates nothing. If a later edit wired
    -- it into the engine, these stop holding.
    ('no process step is keyed on the incoterm', (
      select count(*) = 0 from public.process_step_owning_role
       where step_key like '%incoterm%'
    )),
    ('the incoterm columns live ONLY on shipment', (
      select count(*) = 0 from information_schema.columns
       where table_schema = 'public'
         and column_name in ('incoterm', 'incoterm_place')
         and table_name <> 'shipment'
    )),

    -- ---- 5. blast radius: the neighbouring governed columns are untouched --
    ('transport_mode is still governed by its own check', (
      select count(*) = 1 from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and t.relname = 'shipment'
         and c.conname = 'shipment_transport_mode_check'
    )),
    ('cargo_form is still governed by its own check', (
      select count(*) = 1 from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and t.relname = 'shipment'
         and c.conname = 'shipment_cargo_form_check'
    )),
    -- The route columns keep their own meaning: this slice must not have
    -- repurposed or constrained either of them.
    ('origin and destination remain free text', (
      select count(*) = 2 from information_schema.columns
       where table_schema = 'public' and table_name = 'shipment'
         and column_name in ('origin', 'destination') and data_type = 'text'
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when not bool_and(coalesce(c.ok, false))
      then 'INCOTERM-CATALOG-01 #149 FAILED: '
           || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
    else 'INCOTERM-CATALOG-01 #149 verified: the incoterm vocabulary is closed at eleven codes plus null, '
         || 'incoterm_place is optional text, and no workflow is keyed on either ('
         || count(*) || '/' || count(*) || ' postconditions)'
  end as detail
from checks c;
