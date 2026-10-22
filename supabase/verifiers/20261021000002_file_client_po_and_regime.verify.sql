-- VERIFIER for 20261021000002_file_client_po_and_regime
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS.
--   * Both columns exist, are nullable and carry NO default — a default would
--     silently assert a PO or a regime on every existing dossier.
--   * Both shape CHECKs exist and are VALIDATED (not NOT VALID decoration).
--   * The governed customs regime is untouched: `customs_record.regime` is
--     still there and still free text, and no trigger copies between the two.
--   * No access path was widened: operational_file gained no policy and no
--     client write grant beyond what it had.
--
-- NOTE ON THE « NO BACKFILL » CLAIM. A row count of non-null values would be
-- true only until the first operator saves a PO, after which this verifier —
-- which must stay re-runnable forever — would start failing for the right
-- reason. So backfill is proved structurally instead: no default, and no
-- trigger on operational_file referencing either column.
-- ===========================================================================
with cols as (
  select a.attname, a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'operational_file'
     and a.attnum > 0 and not a.attisdropped
),
cons as (
  select c.conname, c.convalidated
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'operational_file' and c.contype = 'c'
),
checks(label, ok) as (
  values
    ('client_po_reference exists as nullable text with no default', (
      select count(*) = 1 from cols
       where attname = 'client_po_reference' and typ = 'text' and not attnotnull and not atthasdef
    )),
    ('customs_regime_declared exists as nullable text with no default', (
      select count(*) = 1 from cols
       where attname = 'customs_regime_declared' and typ = 'text' and not attnotnull and not atthasdef
    )),
    ('both shape CHECKs exist and are validated', (
      select count(*) = 2 from cons
       where conname in ('operational_file_client_po_reference_shape',
                         'operational_file_customs_regime_declared_shape')
         and convalidated
    )),
    ('the governed regime customs_record.regime is untouched (still present, still text)', (
      select count(*) = 1
        from pg_attribute a
        join pg_class t on t.oid = a.attrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and t.relname = 'customs_record'
         and a.attname = 'regime' and not a.attisdropped
         and format_type(a.atttypid, a.atttypmod) = 'text'
    )),
    ('no trigger function references either new column (nothing copies or backfills them)', (
      select count(*) = 0
        from pg_trigger tg
        join pg_proc p on p.oid = tg.tgfoid
       where not tg.tgisinternal
         and regexp_replace(p.prosrc, '--.*', '', 'gn')
             ~* '(client_po_reference|customs_regime_declared)'
    )),
    ('operational_file still has no INSERT/UPDATE/DELETE policy for authenticated', (
      select count(*) = 0 from pg_policies
       where schemaname = 'public' and tablename = 'operational_file'
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and 'authenticated' = any(roles)
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CEO-ALIGNMENT WP1-B1/C #158 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — two nullable, default-free, CHECK-bounded columns; governed customs regime untouched; no copying trigger; no new write path'
    else 'CEO-ALIGNMENT WP1-B1/C #158 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
