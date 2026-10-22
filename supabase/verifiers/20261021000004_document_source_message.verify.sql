-- VERIFIER for 20261021000004_document_source_message
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS.
--   * The provenance column exists, is nullable, and points at the captured
--     message — not at anything mutable.
--   * Idempotency is enforced by the DATABASE: a UNIQUE index that is PARTIAL
--     on `source_message_id is not null`. A non-unique index would let two
--     operators file the same message twice; a non-partial one would collapse
--     every ordinary upload onto one NULL key.
--   * The captured evidence is still append-only: ec_inbound_message keeps its
--     update/delete-blocking trigger, so « filing a message » cannot have been
--     implemented by editing it.
--   * No access path widened: `document` still has SELECT-only policies.
-- ===========================================================================
with col as (
  select a.attnotnull, format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'document'
     and a.attname = 'source_message_id' and not a.attisdropped
),
fk as (
  select c.confrelid::regclass::text as target
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where n.nspname = 'public' and t.relname = 'document'
     and c.contype = 'f' and a.attname = 'source_message_id'
),
uq as (
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid) as pred
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
   where ic.relname = 'uq_document_source_message'
),
checks(label, ok) as (
  values
    ('document.source_message_id exists as a nullable uuid', (
      select count(*) = 1 from col where typ = 'uuid' and not attnotnull
    )),
    ('it references the captured inbound message (ec_inbound_message)', (
      select count(*) = 1 from fk where target in ('ec_inbound_message', 'public.ec_inbound_message')
    )),
    ('one document per message is enforced by a UNIQUE index', (
      select count(*) = 1 from uq where indisunique
    )),
    ('…and that index is PARTIAL on source_message_id IS NOT NULL', (
      select count(*) = 1 from uq where pred ilike '%source_message_id IS NOT NULL%'
    )),
    ('the captured message is still append-only (update/delete-blocking trigger present)', (
      select count(*) >= 1
        from pg_trigger tg
        join pg_class t on t.oid = tg.tgrelid
        join pg_proc p on p.oid = tg.tgfoid
       where t.relname = 'ec_inbound_message' and not tg.tgisinternal
         and (tg.tgtype & 8) <> 0 and (tg.tgtype & 16) <> 0
    )),
    ('document still has no INSERT/UPDATE/DELETE policy for authenticated', (
      select count(*) = 0 from pg_policies
       where schemaname = 'public' and tablename = 'document'
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and 'authenticated' = any(roles)
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CEO-ALIGNMENT WP1-D #160 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — message provenance column, FK to the captured message, partial UNIQUE idempotency, captured evidence still append-only, no new write path'
    else 'CEO-ALIGNMENT WP1-D #160 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
