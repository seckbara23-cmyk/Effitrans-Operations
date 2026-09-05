-- VERIFIER for 20260930000001_customs_release_approval  (TRANSIT-CUSTODY-05)
-- ===========================================================================
-- The worked example of the companion-verifier convention.
--
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT A VERIFIER IS FOR. The migration's own `do $$ … raise exception` blocks
-- protect the moment of application and can never run again. This file is the
-- durable postcondition: it is what the integrity guard runs, months later, to
-- answer the one question a ledger comparison cannot — is this migration
-- actually applied, or merely unrecorded?
--
-- SO IT CHECKS MEANING, NOT NAMES. "A column called release_approval_status
-- exists" would pass against a column of the wrong type, nullable the wrong
-- way, with the CHECK dropped and the RPC executable by `anon`. Each assertion
-- below names a property the slice would be BROKEN without.
-- ===========================================================================
with checks(label, ok) as (
  values
    -- The six fields, all nullable: a NOT NULL would have rejected every
    -- dossier predating the slice.
    ('six approval columns, all nullable', (
      select count(*) = 6 and bool_and(is_nullable = 'YES')
        from information_schema.columns
       where table_schema = 'public' and table_name = 'customs_record'
         and column_name in ('bae_recorded_by','bae_recorded_at','release_approval_status',
                             'release_approval_by','release_approval_at','release_approval_note')
    )),

    -- The verdict vocabulary is closed. Without this CHECK any string could be
    -- written and the release precondition would read a value it never expects.
    ('release_approval_status vocabulary is closed', (
      select count(*) = 1 from pg_constraint
       where conrelid = 'public.customs_record'::regclass
         and pg_get_constraintdef(oid) ilike '%release_approval_status%'
         and pg_get_constraintdef(oid) ilike '%PENDING%'
         and pg_get_constraintdef(oid) ilike '%APPROVED%'
         and pg_get_constraintdef(oid) ilike '%REJECTED%'
    )),

    -- A decision cannot exist half-recorded, and a refusal cannot be
    -- unaccountable. These three constraints ARE the audit guarantee.
    ('three consistency constraints present', (
      select count(*) = 3 from pg_constraint
       where conrelid = 'public.customs_record'::regclass
         and conname in ('customs_bae_recording_complete',
                         'customs_release_decision_complete',
                         'customs_release_rejection_reasoned')
    )),

    -- Both RPCs exist AND are SECURITY DEFINER — without which they cannot
    -- write past RLS and the whole path is dead.
    ('both RPCs present and SECURITY DEFINER', (
      select count(*) = 2 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and p.proname in ('record_customs_bae','record_customs_release_approval')
    )),

    -- OPS-SEC-1: neither RPC may be reachable by a browser session. This is the
    -- assertion that would catch a later migration re-granting execute.
    ('RPCs not executable by anon or authenticated', (
      select not bool_or(has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'),('authenticated')) as r(rolname)
       where n.nspname = 'public'
         and p.proname in ('record_customs_bae','record_customs_release_approval')
    )),

    -- Maker/checker lives in the database, on the RECORDED author. If this
    -- comparison were removed the function would still exist and still run —
    -- which is exactly why presence alone proves nothing.
    ('maker/checker compares the recorded author to the actor', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_customs_release_approval'
         and p.prosrc ~ 'v_recorder\s*=\s*p_actor'
         and p.prosrc like '%self_approval_forbidden%'
    )),

    -- Recording opens the Chef's verification. Without this the field act would
    -- leave nothing for anyone to verify.
    ('recording the mainlevée opens a PENDING verification', (
      select count(*) = 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_customs_bae'
         and p.prosrc like '%''PENDING''%'
    )),

    -- Both RPCs assert the ACTOR's authority in the database (INV-7), each
    -- naming its own distinct permission: the field act and the verification
    -- are different authorities and must not collapse into one.
    ('each RPC asserts its own actor authority', (
      select bool_and(found) from (
        select p.prosrc like '%assert_actor_authority%'
           and p.prosrc like '%' || perm || '%' as found
          from (values ('record_customs_bae','customs:release'),
                       ('record_customs_release_approval','customs:validate')) as w(fname, perm)
          join pg_proc p on p.proname = w.fname
          join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      ) s
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'TC-05 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'TC-05 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
