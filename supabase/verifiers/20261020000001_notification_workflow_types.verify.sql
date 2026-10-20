-- VERIFIER for 20261020000001_notification_workflow_types
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT DEFENDS. The migration only widens a CHECK, so the obvious risk —
-- "is the new value allowed?" — is the least interesting one; a missing value
-- fails loudly the first time a producer emits it. The real risks are the
-- quiet ones:
--   * a value that USED to be legal was dropped, which would make existing
--     rows unrepresentable and silently lose future notifications of that kind;
--   * the constraint was added NOT VALID, so existing rows were never checked
--     and the constraint is decoration;
--   * widening a label set was used as cover for widening ACCESS — a new
--     policy, an insert path, a definer trigger on the same table.
-- So this verifier asserts the old values, the new values, validation, and the
-- access boundary around them.
--
-- STRING LITERALS, NOT IDENTIFIERS. `pg_get_constraintdef` re-renders DDL and
-- upper-cases keywords and identifiers, which is why a `like` against it is
-- normally unsafe. The values here are string LITERALS, whose contents are
-- reproduced verbatim, so matching on quoted literals is sound. The count of
-- literals is asserted too, so a value added outside this migration's list
-- fails rather than passing unnoticed.
--
-- BEHAVIOUR, NOT ONLY SHAPE. The backward-compatibility claim is checked
-- against real rows: any row whose type is outside the permitted set would
-- mean the migration invalidated live data. A read-only count is the only
-- honest way to assert that, and it needs no write.
-- ===========================================================================
with con as (
  select c.oid,
         c.conrelid,
         c.conkey,
         c.convalidated,
         pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'notification'
     and c.conname = 'notification_type_check'
     and c.contype = 'c'
),
permitted(v) as (
  values ('TASK_ASSIGNED'), ('TASK_DUE_SOON'), ('TASK_OVERDUE'), ('FILE_ASSIGNED'),
         ('MESSAGE_RECEIVED'), ('CONVERSATION_ASSIGNED'),
         ('HANDOFF_RECEIVED'), ('MISSION_STARTED'), ('MISSION_COMPLETED')
),
preexisting(v) as (
  values ('TASK_ASSIGNED'), ('TASK_DUE_SOON'), ('TASK_OVERDUE'), ('FILE_ASSIGNED'),
         ('MESSAGE_RECEIVED'), ('CONVERSATION_ASSIGNED')
),
checks(label, ok) as (
  values
    ('exactly ONE constraint named notification_type_check exists on public.notification', (
      select count(*) = 1 from con
    )),
    ('…and it is VALIDATED, so existing rows were actually checked', (
      select bool_and(convalidated) from con
    )),
    ('…and it constrains exactly the `type` column, read from the catalog', (
      -- `def like '%type%'` would also pass for a constraint that merely
      -- MENTIONS the word in a value, so the column set is read from
      -- pg_constraint.conkey instead. A constraint that grew to cover a second
      -- column — or moved to a different one — fails here.
      select bool_and(
               (select array_agg(a.attname order by a.attname)
                  from unnest(con.conkey) as k
                  join pg_attribute a
                    on a.attrelid = con.conrelid and a.attnum = k)
               = array['type']::name[]
             )
        from con
    )),
    ('every PRE-EXISTING value is still legal — nothing was dropped', (
      select count(*) = 6
        from preexisting p
       where exists (select 1 from con where con.def like '%''' || p.v || '''%')
    )),
    ('every NEW workflow value is legal', (
      select count(*) = 3
        from permitted p
       where p.v not in (select v from preexisting)
         and exists (select 1 from con where con.def like '%''' || p.v || '''%')
    )),
    ('the constraint permits EXACTLY these 9 values and no others', (
      -- Counts quoted literals in the rendered definition. A tenth value added
      -- by some other migration fails here instead of passing unseen.
      select bool_and(
               (length(def) - length(replace(def, '''', ''))) / 2 = 9
             ) from con
    )),
    ('no live row holds a type outside the permitted set', (
      select count(*) = 0
        from public.notification n
       where n.type not in (select v from permitted)
    )),
    ('notification RLS is still enabled', (
      select bool_and(c.relrowsecurity)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'notification'
    )),
    ('…and SELECT is its ONLY policy — one policy on the table, for SELECT', (
      -- Counting SELECT policies alone would still pass with an extra INSERT
      -- policy beside it, so the total is asserted in the same breath.
      select count(*) = 1 and bool_and(cmd = 'SELECT')
        from pg_policies
       where schemaname = 'public' and tablename = 'notification'
    )),
    ('…and still NO insert, update, delete or ALL policy', (
      select count(*) = 0
        from pg_policies
       where schemaname = 'public' and tablename = 'notification'
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    )),
    ('the tenant-integrity trigger enforce_notification_tenant is still attached', (
      -- Counting non-internal triggers would be satisfied by ANY trigger, so
      -- the backing function is named. This is the trigger that refuses a
      -- notification whose tenant does not match its recipient's.
      select count(*) >= 1
        from pg_trigger tg
        join pg_class t on t.oid = tg.tgrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_proc f on f.oid = tg.tgfoid
       where n.nspname = 'public' and t.relname = 'notification'
         and not tg.tgisinternal
         and f.proname = 'enforce_notification_tenant'
    )),
    ('notification still has exactly its 11 columns — none added', (
      -- The columns the table had before 01B. A new one would mean the
      -- migration did more than relabel.
      select count(*) = 11
        from information_schema.columns
       where table_schema = 'public' and table_name = 'notification'
    )),
    -- ⚠ DELIBERATELY NOT A GRANT CHECK. On Supabase, `authenticated` carries
    -- blanket table grants from the platform bootstrap — this table really does
    -- grant it INSERT, UPDATE, DELETE and TRUNCATE — and those grants are INERT
    -- because RLS exposes no permissive policy for those commands. Asserting
    -- `role_table_grants` here would fail on a healthy database and tempt
    -- somebody to "fix" the grant instead of the policy. The policy checks
    -- above are the real boundary; this one states what the writer must be.
    ('no SECURITY DEFINER function in `public` holds a literal INSERT into notification', (
      -- A plain `like` here is three ways fragile: it is case-sensitive, it
      -- misses an unqualified `insert into notification`, and it matches text
      -- sitting in a COMMENT. So comments are stripped first ('n' keeps `.`
      -- off newlines) and the match is a case-insensitive regex. Note `\y`,
      -- not `\b` — in POSIX regex `\b` is a BACKSPACE, not a word boundary,
      -- and `notification\y` is what keeps client_notification out.
      --
      -- Honest about its reach: this finds a LITERAL insert. A write assembled
      -- in EXECUTE is beyond a source scan, which is why the policy checks
      -- above, not this one, are the boundary.
      select count(*) = 0
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and regexp_replace(p.prosrc, '--.*', '', 'gn')
             ~* 'insert\s+into\s+(public\s*\.\s*)?notification\y'
    ))
)
-- `bool_and` IGNORES NULLs, so a check whose subquery returned no rows would be
-- skipped and the verifier would pass vacuously. Every `ok` is coalesced to
-- false first: a check that could not evaluate is a FAILED check.
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'INTERNAL-COMMS-PUSH-01B / B3 #156 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — the type CHECK is validated and permits exactly the 6 pre-existing values plus 3 workflow values, no live row falls outside it, and the access boundary is untouched (RLS on, one SELECT-only policy, no write policy, tenant trigger present, no new column, no SECURITY DEFINER function writing the table)'
    else 'INTERNAL-COMMS-PUSH-01B / B3 #156 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
