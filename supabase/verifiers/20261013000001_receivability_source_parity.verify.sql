-- VERIFIER for 20261013000001_receivability_source_parity
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- THIS IS THE CHECK WHOSE ABSENCE HID THE BUG. The repository was correct all
-- along; production's live function was not, and nothing in the toolchain ever
-- compared the two. Every assertion below therefore reads the LIVE body out of
-- pg_get_functiondef — never a file, never the migration ledger. A verifier
-- that re-read the repository here would pass on the day production broke.
--
-- UNCONDITIONAL, UNLIKE A DOSSIER RECOVERY'S VERIFIER. There is no subject to
-- be absent: every database that has run 20260824000001 has this function, so
-- the verdict is the same shape in CI and in production and a missing function
-- is a failure rather than a "not applicable".
--
-- COMMENTS ARE STRIPPED BEFORE EVERY MATCH. pg_get_functiondef returns the
-- body's `--` comments, and the authoritative body carries a comment that
-- names the legal lanes in prose. Matching unstripped text would let a comment
-- satisfy a pin — the MIGRATION-GATE lesson that `prosrc` assertions must run
-- on code, not on commentary.
--
-- AND THE QUOTING IS LOAD-BEARING. 'policy_rpc' CONTAINS the substring `rpc`,
-- so the negative assertion is anchored on the QUOTED literal ''rpc'' through
-- a regex. A plain `like '%rpc%'` would fire on the correct value and report a
-- healthy database as broken — the same substring trap as `ur0.tenant_id`
-- matching inside `r0.tenant_id`.
--
-- IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file
-- down with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with fn as (
  select p.oid                                        as oid,
         pg_get_functiondef(p.oid)                    as def,
         p.prosecdef                                  as secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'record_customs_receivability'
     -- regprocedure, NOT pg_get_function_identity_arguments: on this server the
     -- identity form includes PARAMETER NAMES ("p_customs_id uuid, …"), so a
     -- types-only comparison against it matches nothing and every check below
     -- collapses to false — a healthy database reported as entirely broken.
     and p.oid::regprocedure::text = 'record_customs_receivability(uuid,text,text,uuid)'
),
code as (
  select oid, secdef, regexp_replace(def, '--[^\n]*', '', 'g') as c from fn
),
con as (
  select pg_get_constraintdef(k.oid) as def
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
   where c.relname = 'business_event'
     and k.conname = 'business_event_source_check'
),
lanes as (
  select array(
           select m[1] from con, regexp_matches(con.def, '''([a-z_]+)''', 'g') m order by 1
         ) as got
),
checks(label, ok) as (
  values
    -- ---- 1. the function is there, with the signature the app calls --------
    ('record_customs_receivability(uuid,text,text,uuid) exists', (
      select count(*) = 1 from fn
    )),

    -- ---- 2. THE CORRECTION: the source it emits is a lane the ledger admits
    ('it emits source ''policy_rpc''', (
      select coalesce((select c ~ 'p_source\s*=>\s*''policy_rpc''' from code), false)
    )),

    -- The defect itself, stated as its own check so a failure names it.
    ('it does NOT emit the illegal bare source ''rpc''', (
      select coalesce((select c !~ 'p_source\s*=>\s*''rpc''' from code), false)
    )),

    -- ---- 3. the OPS-SEC-2A trust contract production was missing ----------
    -- Production's body had no actor assertion at all, so it trusted the
    -- caller's word about who was acting. Parity restores it; this notices if
    -- it is ever lost again.
    ('it asserts actor authority (customs:update, SERVICE lane)', (
      select coalesce((
        select c ~ 'assert_actor_authority\s*\(\s*p_actor\s*,\s*v_tenant\s*,\s*''customs:update''\s*,\s*''SERVICE''\s*\)'
          from code), false)
    )),

    -- ---- 4. the rest of the body is the repository's, not a rewrite --------
    ('it still refuses an outcome outside the three ratified values', (
      select coalesce((
        select c like '%''RECEVABLE''%' and c like '%''NON_RECEVABLE''%'
           and c like '%''SOUS_RESERVE''%' from code), false)
    )),

    ('it still appends CUSTOMS_RECEIVABILITY_DECIDED in the customs domain', (
      select coalesce((
        select c like '%CUSTOMS_RECEIVABILITY_DECIDED%'
           and c ~ 'p_event_domain\s*=>\s*''customs''' from code), false)
    )),

    ('it still keeps the reason TEXT out of the ledger metadata', (
      select coalesce((
        select c like '%''has_reason''%' and c not like '%''note'', v_note%' from code), false)
    )),

    ('it still locks the row it decides on (FOR UPDATE)', (
      select coalesce((select c ilike '%for update%' from code), false)
    )),

    -- ---- 5. privilege shape unchanged -------------------------------------
    -- Each role is probed only where it exists: a bare Postgres has no `anon`,
    -- and a verifier that errored on a missing role would report a healthy
    -- database as failed.
    ('it is SECURITY DEFINER', (
      select coalesce((select secdef from code), false)
    )),

    ('service_role may execute it', (
      select coalesce((
        select to_regrole('service_role') is null
            or has_function_privilege('service_role', oid, 'EXECUTE') from code), false)
    )),

    ('anon and authenticated may NOT execute it', (
      select coalesce((
        select (to_regrole('anon') is null
                or not has_function_privilege('anon', oid, 'EXECUTE'))
           and (to_regrole('authenticated') is null
                or not has_function_privilege('authenticated', oid, 'EXECUTE'))
          from code), false)
    )),

    -- ---- 6. the constraint was NOT widened to accommodate the bug ---------
    -- The whole point of fixing the function instead of the constraint. The
    -- admitted set is compared as a SET rather than as formatted text, so a
    -- Postgres version that prints the CHECK differently cannot fail this.
    ('business_event_source_check admits exactly the seven known lanes', (
      select coalesce((
        select got = array['app_action', 'assignment_rpc', 'comms_rpc', 'db_trigger',
                           'document_rpc', 'policy_rpc', 'reconcile_rpc']::text[]
          from lanes), false)
    )),

    ('… and therefore still refuses a bare ''rpc'' source', (
      select coalesce((select not ('rpc' = any (got)) from lanes), false)
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'UAT-RECEVABILITE-01 #151 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — the live record_customs_receivability emits policy_rpc, asserts actor authority, keeps its definer/service_role shape, and the source constraint was not widened'
    else 'UAT-RECEVABILITE-01 #151 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
