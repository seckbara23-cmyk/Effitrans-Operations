-- VERIFIER for 20261019000001_customs_reference_regime_axis
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT DEFENDS, AND WHY HALF OF IT IS ABOUT OTHER MIGRATIONS. This
-- migration adds a search axis. The risk it carries is not that the axis is
-- missing — a missing column fails loudly the first time anything selects it.
-- The risk is that adding a column to the table the publication gate lives on
-- quietly changed that gate: a new write policy, a definer trigger, a relaxed
-- scan guard. So the second half of this verifier re-asserts the 152–154
-- boundary and would fail if this migration had widened it.
--
-- THE TRIGGER MUST BE `security invoker`. A BEFORE trigger that normalises a
-- column has no business running as its owner; a definer trigger on this table
-- would execute with the table owner's rights on every write, which is a
-- privilege escalation route bolted to a search feature. `prosecdef = false`
-- is asserted, not assumed.
--
-- STRUCTURAL CATALOGUES, NOT RENDERED DDL. `pg_indexes.indexdef` and
-- `pg_get_constraintdef` RE-RENDER and upper-case what they print, so a
-- lower-case `like` against them reports a healthy database as broken — and,
-- worse, a negative `like` passes vacuously. The index's access method is read
-- from `pg_am`, and the trigger's timing from `tgtype`, so nothing here depends
-- on how Postgres chooses to print.
-- ===========================================================================
with tbl as (
  select c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customs_reference_document'
),
col as (
  select a.attname, a.attnotnull, format_type(a.atttypid, a.atttypmod) as typ,
         pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a
    join tbl on tbl.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped and a.attname = 'customs_regimes'
),
shape as (
  select pg_get_constraintdef(c.oid) as src
    from pg_constraint c join tbl on tbl.oid = c.conrelid
   where c.conname = 'customs_reference_regimes_shape' and c.contype = 'c'
),
fn as (
  select p.oid, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'normalize_customs_reference_regimes'
),
trg as (
  -- tgtype bit 0 = BEFORE(row-level ROW is bit 0; see below), bit 2 = INSERT,
  -- bit 4 = UPDATE. Read structurally so the assertion does not depend on how
  -- `pg_get_triggerdef` chooses to print the clause.
  -- `tgattr` is an int2vector: it needs the int2[] step before int[], and it
  -- subscripts from ZERO, not one.
  select t.tgtype, t.tgenabled,
         array_length(t.tgattr::int2[]::int[], 1) as nattr,
         (select a.attname from pg_attribute a
           where a.attrelid = t.tgrelid and a.attnum = t.tgattr[0]) as watched
    from pg_trigger t join tbl on tbl.oid = t.tgrelid
   where t.tgname = 'trg_customs_reference_regimes' and not t.tgisinternal
),
gin_idx as (
  select am.amname
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_am am on am.oid = ic.relam
    join tbl on tbl.oid = i.indrelid
   where ic.relname = 'idx_customs_reference_regimes'
),
-- ---- the 152–154 boundary, re-asserted ------------------------------------
pol as (
  select p.polname, p.polcmd
    from pg_policy p join tbl on tbl.oid = p.polrelid
),
scan_guard as (
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_customs_reference_scan_status'
),
recorder as (
  select p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_customs_reference_scan'
),
checks(label, ok) as (
  values
    -- ---- the column -------------------------------------------------------
    ('column_exists',
      (select count(*) = 1 from col)),
    ('column_is_text_array',
      (select typ = 'text[]' from col)),
    ('column_not_null',
      (select attnotnull from col)),
    ('column_defaults_empty_array',
      (select def ilike '%{}%' from col)),

    -- ---- what a CHECK can say ---------------------------------------------
    ('shape_constraint_exists',
      (select count(*) = 1 from shape)),
    ('shape_bounds_cardinality',
      (select src ilike '%cardinality%' and src ilike '%24%' from shape)),
    -- NULL elements are the TRIGGER's job, not the CHECK's: `array_position`
    -- is STABLE for a collatable element type, so a CHECK using it cannot be
    -- created. This asserts the normaliser is what removes them — and it reads
    -- `prosrc` with comments stripped, because a claim that matched a comment
    -- would pass on a function whose code had been gutted.
    ('normaliser_drops_null_elements',
      (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') like '%coalesce(t.raw%'
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'normalize_customs_reference_regimes')),

    -- ---- the normaliser ---------------------------------------------------
    ('normaliser_exists',
      (select count(*) = 1 from fn)),
    ('normaliser_is_security_invoker',
      (select prosecdef = false from fn)),
    ('normaliser_pins_search_path',
      (select proconfig is not null
          and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')
         from fn)),

    -- ---- the trigger ------------------------------------------------------
    ('trigger_exists',
      (select count(*) = 1 from trg)),
    ('trigger_is_enabled',
      (select tgenabled <> 'D' from trg)),
    -- tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE.
    ('trigger_is_before_row',
      (select (tgtype & 1) = 1 and (tgtype & 2) = 2 from trg)),
    ('trigger_fires_on_insert_and_update',
      (select (tgtype & 4) = 4 and (tgtype & 16) = 16 from trg)),
    ('trigger_watches_customs_regimes_only',
      (select nattr = 1 and watched = 'customs_regimes' from trg)),

    -- ---- the index --------------------------------------------------------
    ('regime_index_exists',
      (select count(*) = 1 from gin_idx)),
    ('regime_index_is_gin',
      (select amname = 'gin' from gin_idx)),

    -- ---- the 152–154 boundary is UNCHANGED --------------------------------
    ('still_select_only_no_write_policy',
      (select count(*) = 0 from pol where polcmd <> 'r')),
    ('select_policy_still_present',
      (select count(*) >= 1 from pol where polcmd = 'r')),
    ('scan_guard_still_exists',
      (select count(*) = 1 from scan_guard)),
    ('recorder_still_takes_the_nonce',
      (select count(*) = 1 and min(pronargs) = 10 from recorder)),
    ('this_migration_added_no_permission',
      (select count(*) = 0 from public.permission
        where code ilike '%regime%' or code ilike '%reference:search%'))
)
-- `bool_and` IGNORES NULLs, so a check whose subquery returned no rows would be
-- skipped and the verifier would pass vacuously. Every `ok` is coalesced to
-- false first: a check that could not evaluate is a FAILED check.
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CUSTOMS-REF-01A / REF-2 #155 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — the regime axis is a normalised, GIN-indexed, cardinality-bounded text[] maintained by a security-invoker BEFORE trigger watching only that column, and the 152-154 publication gate is intact (policies still select-only, scan guard present, recorder still takes the nonce, no new permission)'
    else 'CUSTOMS-REF-01A / REF-2 #155 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
