-- VERIFIER for 20261005000001_customs_actor_attribution
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT IT CHECKS, AND WHY IT CHECKS MEANING. « The function exists » passes
-- against the version that produced the defect — neither signature changed.
-- So every assertion is about WHICH COLUMN each act writes and WHICH COLUMN the
-- ledger reads each actor from, on function bodies with their comments
-- stripped (the comments name `reviewed_by` deliberately; prose must not be
-- able to satisfy or fail a check). The last block proves the controls this
-- slice promised not to weaken are each still standing.
-- ===========================================================================
with src as (
  select
    (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
      where p.oid = to_regprocedure('public.record_customs_release(uuid,text,uuid,date,uuid)'))  as release_fn,
    (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'emit_customs_events')                        as trigger_fn,
    (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
      where p.oid = to_regprocedure('public.record_customs_validation(uuid,uuid)'))             as validation_fn,
    (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
      where p.oid = to_regprocedure('public.record_customs_bae(uuid,text,uuid)'))               as bae_fn,
    (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
      where p.oid = to_regprocedure('public.record_customs_release_approval(uuid,text,text,uuid)')) as approval_fn
),
checks(label, ok) as (
  select * from (values
    -- ---- 1. The release finaliser is its own column ------------------------
    ('customs_record.released_by exists, nullable, with no default', (
      select count(*) = 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'customs_record'
         and column_name = 'released_by' and is_nullable = 'YES' and column_default is null
    )),
    ('released_by references app_user', (
      select count(*) = 1
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = 'public.customs_record'::regclass
         and c.contype = 'f' and c.confrelid = 'public.app_user'::regclass
         and a.attname = 'released_by'
    )),

    -- ---- 2. THE FIX. The release no longer writes the validator ------------
    ('record_customs_release exists with its five-argument signature', (
      select release_fn is not null from src
    )),
    ('record_customs_release does NOT touch reviewed_by', (
      select release_fn !~ 'reviewed_by' from src
    )),
    ('record_customs_release attributes the release to its actor', (
      select release_fn ~ 'released_by\s*=\s*p_actor' from src
    )),
    ('record_customs_release refuses an unattributed release', (
      select release_fn ~ 'p_actor\s+is\s+null' from src
    )),

    -- ---- 3. THE FIX. The ledger reads each actor from its own act ----------
    ('the customs trigger derives NO actor from reviewed_by', (
      select trigger_fn is not null and trigger_fn !~ 'reviewed_by' from src
    )),
    ('the release events are attributed from released_by, only when this update released', (
      select trigger_fn ~ 'old\.released_by\s+is\s+null\s+then\s+new\.released_by' from src
    )),
    ('BAE_RECORDED is attributed from bae_recorded_by, only when this update stamped it', (
      select trigger_fn ~ 'new\.bae_recorded_at\s+is\s+distinct\s+from\s+old\.bae_recorded_at\s+then\s+new\.bae_recorded_by'
        from src
    )),
    ('the trigger still emits every customs milestone it emitted before', (
      select trigger_fn ~ 'CUSTOMS_RECORD_CREATED' and trigger_fn ~ 'CUSTOMS_STATUS_CHANGED'
         and trigger_fn ~ 'CUSTOMS_DECLARED' and trigger_fn ~ 'CUSTOMS_RELEASE_COMPLETED'
         and trigger_fn ~ 'BAE_RECORDED'
        from src
    )),
    ('the trigger still fires AFTER INSERT OR UPDATE on customs_record', (
      select count(*) = 1
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.customs_record'::regclass and not t.tgisinternal
         and p.proname = 'emit_customs_events' and t.tgenabled = 'O'
         and pg_get_triggerdef(t.oid) ~* 'AFTER INSERT OR UPDATE ON public\.customs_record'
    )),
    ('the trigger still re-raises: a failed event rolls the customs write back (WES-9A)', (
      select trigger_fn ~ 'when\s+sqlstate\s+''EF001''\s+then\s+raise\s*;'
         and trigger_fn ~ 'using\s+errcode\s*=\s*''EF001'''
        from src
    )),

    -- ---- 4. THE INVARIANT, schema-wide ------------------------------------
    -- Only the validation door, its post-correction recertification and the
    -- correction that clears it may write customs reviewed_by.
    ('customs reviewed_by has no writer outside validation / revalidation / correction', (
      select count(*) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
             ~* 'update\s+public\.customs_record\s+set[^;]*reviewed_by\s*='
         and p.proname not in ('record_customs_validation', 'record_customs_revalidation', 'record_customs_correction')
    )),
    ('customs released_by has exactly one writer: record_customs_release', (
      select count(*) = 1 and bool_and(p.proname = 'record_customs_release')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
             ~* 'update\s+public\.customs_record\s+set[^;]*released_by\s*='
    )),

    -- ---- 5. NOT WEAKENED: security of the release RPC ---------------------
    ('record_customs_release is still SECURITY DEFINER with a pinned search_path', (
      select count(*) = 1 from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_release(uuid,text,uuid,date,uuid)')
         and p.prosecdef
         and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%'
    )),
    ('EXECUTE on record_customs_release is service_role only', (
      select count(*) = 1 from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_release(uuid,text,uuid,date,uuid)')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')
    )),
    ('the release still sets RELEASED and still refuses a second release', (
      select release_fn ~ 'status\s*=\s*''RELEASED''' and release_fn ~ 'already recorded' from src
    )),

    -- ---- 6. NOT WEAKENED: the other three facts and their controls --------
    ('the step 7 validation still writes reviewed_by, under customs:validate', (
      select validation_fn ~ 'reviewed_by\s*=\s*p_actor'
         and validation_fn ~ 'assert_actor_authority' and validation_fn ~ 'customs:validate'
        from src
    )),
    ('the BAE recording still names its recorder', (
      select bae_fn ~ 'bae_recorded_by\s*=\s*p_actor' from src
    )),
    ('the release approval still names its approver and refuses the recorder', (
      select approval_fn ~ 'release_approval_by\s*=\s*p_actor'
         and approval_fn ~ 'self_approval_forbidden'
        from src
    ))
  ) as t(label, ok)
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'ATTR-CUSTOMS-01 #143 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'ATTR-CUSTOMS-01 #143 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
