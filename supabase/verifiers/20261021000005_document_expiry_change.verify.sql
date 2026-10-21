-- VERIFIER for 20261021000005_document_expiry_change
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS — the four claims WP1-E makes, each as a property:
--   1. APPEND-ONLY. The history refuses UPDATE and DELETE through
--      `prevent_mutation()`, the function that protects audit_log. Asserted on
--      the trigger→function binding, not on a trigger name alone.
--   2. NO SIDE DOOR. RLS is on, there is exactly one policy and it is SELECT,
--      so the only writers are the definer RPCs.
--   3. COMPLETE BY CONSTRUCTION. `document` carries a BEFORE UPDATE OF
--      expiry_date trigger whose function consults the history — so a silent
--      rewrite of an expiry is refused at the database.
--   4. AUTHORITY AND MAKER ≠ CHECKER. Both RPCs are SECURITY DEFINER with a
--      pinned search_path, are executable by the service role only, re-prove
--      their actor through assert_actor_authority with the right permission,
--      and the decider refuses its own proposal.
--
-- Bodies are read with `--` comments stripped (`[^\n]*`, so a comment never
-- swallows the code after it), because a check that matched a comment would
-- pass a function that does not do what the comment says.
-- ===========================================================================
with tbl as (
  select c.oid, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'document_expiry_change'
),
doc as (
  select c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'document'
),
trg as (
  select t.tgname, t.tgrelid, t.tgtype, t.tgattr, p.proname,
         regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as body
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid in (select oid from tbl union all select oid from doc)
),
fn as (
  select p.proname, p.oid, p.prosecdef as secdef,
         coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('record_document_expiry_change', 'decide_document_expiry_change')
),
pol as (
  select policyname, cmd from pg_policies
   where schemaname = 'public' and tablename = 'document_expiry_change'
),
checks(label, ok) as (
  values
    -- ---- 1. append-only ----------------------------------------------------
    ('document_expiry_change exists with row level security enabled', (
      select count(*) = 1 from tbl where relrowsecurity
    )),
    ('UPDATE on the history is refused by prevent_mutation()', (
      select count(*) >= 1 from trg
       where tgrelid = (select oid from tbl) and proname = 'prevent_mutation'
         and (tgtype & 2) <> 0 and (tgtype & 16) <> 0
    )),
    ('DELETE on the history is refused by prevent_mutation()', (
      select count(*) >= 1 from trg
       where tgrelid = (select oid from tbl) and proname = 'prevent_mutation'
         and (tgtype & 2) <> 0 and (tgtype & 8) <> 0
    )),
    ('one decision per proposal is enforced by a partial UNIQUE index', (
      select count(*) = 1
        from pg_index i join pg_class ic on ic.oid = i.indexrelid
       where ic.relname = 'uq_document_expiry_change_decision'
         and i.indisunique
         and pg_get_expr(i.indpred, i.indrelid) ilike '%proposal_id IS NOT NULL%'
    )),
    -- ---- 2. no side door -----------------------------------------------------
    ('exactly one policy on the history, and it is SELECT', (
      select count(*) = 1 and bool_and(cmd = 'SELECT') from pol
    )),
    -- ---- 3. complete by construction ---------------------------------------
    ('document has a BEFORE UPDATE OF expiry_date trigger that consults the history', (
      select count(*) = 1 from trg
       where tgrelid = (select oid from doc)
         and tgname = 'trg_document_expiry_governed'
         and (tgtype & 2) <> 0 and (tgtype & 16) <> 0
         -- UPDATE OF <column>: the trigger names exactly one column…
         and array_length(tgattr::int2[], 1) = 1
         -- …and that column is expiry_date.
         and (select a.attname from pg_attribute a
               where a.attrelid = (select oid from doc) and a.attnum = tgattr[0]) = 'expiry_date'
         and body ~* 'document_expiry_change'
         and body ~* 'raise\s+exception'
    )),
    ('…and on a verified document only a CONFIRMED row licenses the change', (
      select count(*) = 1 from trg
       where tgname = 'trg_document_expiry_governed'
         and body ~* '''VERIFIED'''
         and body ~* '''CONFIRMED'''
         and body ~* 'occurred_at\s*=\s*now\(\)'
    )),
    -- ---- 4. authority and maker ≠ checker ------------------------------------
    ('both RPCs exist and are SECURITY DEFINER', (
      select count(*) = 2 from fn where secdef
    )),
    ('both RPCs pin search_path to public, pg_temp', (
      select count(*) = 2 from fn
       where cfg like '%search_path=%' and cfg like '%public%' and cfg like '%pg_temp%'
    )),
    ('both RPCs are executable by service_role only', (
      select coalesce(bool_and(
               (to_regrole('service_role') is null or has_function_privilege('service_role', oid, 'EXECUTE'))
           and (to_regrole('authenticated') is null or not has_function_privilege('authenticated', oid, 'EXECUTE'))
           and (to_regrole('anon') is null or not has_function_privilege('anon', oid, 'EXECUTE'))
             ), false)
        from fn
    )),
    ('record_… re-proves its actor with document:update (SERVICE lane)', (
      select count(*) = 1 from fn
       where proname = 'record_document_expiry_change'
         and body ~* 'assert_actor_authority\s*\(\s*p_actor\s*,\s*p_tenant\s*,\s*''document:update''\s*,\s*''SERVICE''\s*\)'
    )),
    ('decide_… re-proves its actor with document:approve (SERVICE lane)', (
      select count(*) = 1 from fn
       where proname = 'decide_document_expiry_change'
         and body ~* 'assert_actor_authority\s*\(\s*p_actor\s*,\s*p_tenant\s*,\s*''document:approve''\s*,\s*''SERVICE''\s*\)'
    )),
    ('decide_… refuses the proposer deciding their own proposal', (
      select count(*) = 1 from fn
       where proname = 'decide_document_expiry_change'
         and body ~* 'v_prop\.actor_id\s*=\s*p_actor'
         and body ~* 'self_approval_forbidden'
    )),
    ('neither RPC writes document.status', (
      select count(*) = 0 from fn
       where body ~* 'set\s+[^;]*\ystatus\y\s*='
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CEO-ALIGNMENT WP1-E #161 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — append-only history (prevent_mutation), SELECT-only access, expiry changes governed at the database, service-role definer RPCs re-proving document:update / document:approve, no self-approval, document status never written'
    else 'CEO-ALIGNMENT WP1-E #161 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
