-- ============================================================================
-- OPS-SEC-1 — HOTFIX: restore a policy dependency that migration 90 revoked
-- ============================================================================
-- Migration 90 revoked EXECUTE on public.user_readable_file_ids(uuid,uuid) from
-- authenticated. That was wrong, and it broke production reads.
--
-- WHY IT BROKE. public.can_read_file(uuid) is referenced by 21 RLS policies
-- across 21 tables, and it is SECURITY INVOKER. An invoker function's inner
-- calls execute as the ORIGINAL CALLER, so can_read_file's call to
-- user_readable_file_ids required the caller — authenticated — to hold EXECUTE.
-- Once revoked, every policy calling can_read_file raised:
--
--   ERROR: 42501: permission denied for function user_readable_file_ids
--   CONTEXT: SQL function "can_read_file" statement 1
--
-- HOW IT WAS MISSED. The OPS-SEC-1 audit enumerated functions named directly in
-- policy EXPRESSIONS and preserved those 13. It did not follow the call graph
-- one level deeper, into functions those helpers themselves call.
-- user_readable_file_ids is, transitively, a 14th policy dependency.
--
-- public.can_read_task(uuid) also calls it but is SECURITY DEFINER, so its inner
-- call runs as the owner and was never affected. can_read_file was the only
-- broken caller — verified against the live catalog, not assumed.
--
-- WHAT THIS DOES NOT UNDO. anon and PUBLIC stay revoked. No RLS policy targets
-- anon (0 of 172), so anon never needed this function, and the anonymous
-- execution path that OPS-SEC-1 exists to close stays closed. Only the grant
-- that RLS evaluation actually requires is restored.
--
-- THE BETTER LONG-TERM FIX belongs to OPS-SEC-2, not here: make can_read_file
-- SECURITY DEFINER so the inner call runs as owner and the grant is unnecessary.
-- That is a function-body change and is deliberately out of scope for a
-- privilege-only release.
--
-- IDEMPOTENT. Re-running changes nothing.
-- ROLLBACK: revoke execute on function public.user_readable_file_ids(uuid,uuid)
--           from authenticated;  -- (which would re-break RLS; do not)
-- ============================================================================

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ASSERTION 1 — the grant is back for authenticated, and ONLY for authenticated.
-- anon and PUBLIC must remain revoked, or this hotfix would reopen the P0.
-- ---------------------------------------------------------------------------
do $assert_grant$
declare v_oid oid := to_regprocedure('public.user_readable_file_ids(uuid,uuid)');
begin
  if v_oid is null then
    raise exception 'OPS-SEC-1 hotfix: user_readable_file_ids(uuid,uuid) not found';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'OPS-SEC-1 hotfix: authenticated still cannot execute user_readable_file_ids';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'OPS-SEC-1 hotfix: anon regained EXECUTE — the P0 would be reopened';
  end if;
  if exists (select 1 from pg_proc p
              where p.oid = v_oid
                and (p.proacl is null
                     or exists (select 1 from aclexplode(p.proacl) a
                                 where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'OPS-SEC-1 hotfix: PUBLIC holds EXECUTE — the P0 would be reopened';
  end if;
end
$assert_grant$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 — BEHAVIOURAL. The policy helper actually evaluates again.
-- This is the assertion that would have caught the regression: metadata said
-- the 13 named helpers were fine, and they were. What broke was one level down.
-- Read-only: can_read_file only SELECTs, and the probe discards the result.
-- ---------------------------------------------------------------------------
do $probe$
declare
  v_state text;
  v_ok    boolean := false;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'OPS-SEC-1 hotfix: role authenticated absent, probe skipped';
    return;
  end if;

  set local role authenticated;
  begin
    perform public.can_read_file('00000000-0000-4000-8000-000000000001'::uuid);
    v_ok := true;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := false;
  end;
  reset role;

  -- Raised only AFTER the role reset.
  if not v_ok then
    raise exception
      'OPS-SEC-1 hotfix: can_read_file still fails for authenticated (sqlstate %) — RLS remains broken',
      coalesce(v_state, 'none');
  end if;
  raise notice 'OPS-SEC-1 hotfix: can_read_file evaluates for authenticated';
end
$probe$;

-- ---------------------------------------------------------------------------
-- ASSERTION 3 — no OTHER function is broken the same way.
-- Any SECURITY INVOKER function that authenticated can call, which itself calls
-- a function authenticated cannot execute, is broken exactly as can_read_file
-- was. A SECURITY DEFINER caller is safe: its inner call runs as the owner.
-- This generalises the mistake instead of fixing only the instance of it.
-- ---------------------------------------------------------------------------
do $assert_no_others$
declare v_bad text;
begin
  select string_agg(c.proname || ' -> ' || d.sig, ', ') into v_bad
  from (
    select p.oid, p.proname, p.prosrc, p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) c
  join (
    select p.proname,
           regexp_replace(p.oid::regprocedure::text, '^[^(]*', 'public.' || p.proname) as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) d on c.prosrc ~ ('\m' || d.proname || '\s*\(');

  if v_bad is not null then
    raise exception
      'OPS-SEC-1 hotfix: SECURITY INVOKER functions still call denied functions: %', v_bad;
  end if;
end
$assert_no_others$;

-- ---------------------------------------------------------------------------
-- Phase marker: this migration restores one grant and asserts its own effect
-- above, and asserts nothing about its position in the chain.
-- ---------------------------------------------------------------------------
