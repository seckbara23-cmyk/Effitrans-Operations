-- ============================================================================
-- OPS-SEC-2C — trusted overloads for the two expense counters
-- ============================================================================
-- Extends the OPS-SEC-2A framework to:
--   next_expense_authorization_number(uuid)  ->  EFT-AUT-YYYY-#####
--   next_expense_voucher_number(uuid)        ->  EFT-BON-YYYY-#####
--
-- Both map to `finance:expense:submit`, which the audit confirmed is the SAME
-- permission at every call site: submitExpenseAuthorization and
-- submitExpenseVoucher each call guard('finance:expense:submit'), which is
-- assertPermission, so the actor and tenant are session-derived and neither
-- action can run without an authenticated human.
--
-- The audit also confirmed these counters have NO in-database caller, are
-- referenced by no RLS policy, are attached to no trigger, and that pg_cron is
-- not installed -- so there is no background or SYSTEM path into them.
--
-- WHAT THIS DOES NOT DO:
--   * does not change the numbering algorithm, the formats, or the counter
--     tables. The overloads delegate to the existing implementations, which
--     keep their per-tenant/year upsert and therefore their concurrency and
--     gap semantics exactly;
--   * does not switch any application caller. These are DARK, as the 2A pilots
--     were, and for the same reason: a caller that needs a not-yet-applied
--     function is an outage waiting for the gap between migration and deploy.
--     Activation is a separate, later step;
--   * touches nothing in migrations 90-93, emit_business_event, can_read_file,
--     user_readable_file_ids, or the SYSTEM lane.
--
-- WHY THE REFUSAL COSTS NOTHING: each counter allocates by INSERT ... ON
-- CONFLICT DO UPDATE ... RETURNING. The assertion runs BEFORE that statement is
-- reached, so a refused call performs no upsert and consumes no number. The
-- sequence is untouched by a rejection, which is the property the behavioural
-- suite proves rather than assumes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Expense authorization numbering — trusted overload.
-- ---------------------------------------------------------------------------
create or replace function public.next_expense_authorization_number(
  p_tenant uuid,
  p_actor  uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 'SERVICE' is hard-coded rather than accepted. That is safe only because the
  -- primitive validates the declaration against auth.uid(): reached from a
  -- session, this refuses instead of trusting the label.
  perform public.assert_actor_authority(p_actor, p_tenant, 'finance:expense:submit', 'SERVICE');
  -- One numbering implementation, not two. This adds authority in front of the
  -- existing counter; it does not reimplement it.
  return public.next_expense_authorization_number(p_tenant);
end
$$;

-- ---------------------------------------------------------------------------
-- Expense voucher numbering — trusted overload.
-- ---------------------------------------------------------------------------
create or replace function public.next_expense_voucher_number(
  p_tenant uuid,
  p_actor  uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_actor_authority(p_actor, p_tenant, 'finance:expense:submit', 'SERVICE');
  return public.next_expense_voucher_number(p_tenant);
end
$$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES — the EMP-3 / OPS-SEC-1 pattern. All three grantees are named
-- because hosted Supabase creates explicit anon/authenticated grants on top of
-- PostgreSQL's implicit PUBLIC one; revoking PUBLIC alone leaves them in force.
-- ---------------------------------------------------------------------------
do $privs$
declare v_sig text;
begin
  for v_sig in select unnest(array[
    'public.next_expense_authorization_number(uuid,uuid)',
    'public.next_expense_voucher_number(uuid,uuid)'
  ]) loop
    if to_regprocedure(v_sig) is null then
      raise exception 'OPS-SEC-2C: % did not resolve', v_sig;
    end if;
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('revoke execute on function %s from authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$privs$;

-- ---------------------------------------------------------------------------
-- ASSERTION 1 — privileges took, and the originals survived.
-- The originals must remain: the overloads delegate to them, and the deployed
-- application still calls them until activation.
-- ---------------------------------------------------------------------------
do $assert_privs$
declare v_sig text; v_oid oid; v_n int := 0;
begin
  for v_sig in select unnest(array[
    'public.next_expense_authorization_number(uuid,uuid)',
    'public.next_expense_voucher_number(uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2C: anon can execute %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2C: authenticated can execute %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2C: service_role lost %', v_sig;
    end if;
    if exists (select 1 from pg_proc p where p.oid = v_oid
                and (p.proacl is null
                     or exists (select 1 from aclexplode(p.proacl) a
                                 where a.grantee = 0 and a.privilege_type='EXECUTE'))) then
      raise exception 'OPS-SEC-2C: PUBLIC holds %', v_sig;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 2 then
    raise exception 'OPS-SEC-2C: asserted % of 2', v_n;
  end if;

  if to_regprocedure('public.next_expense_authorization_number(uuid)') is null
     or to_regprocedure('public.next_expense_voucher_number(uuid)') is null then
    raise exception 'OPS-SEC-2C: an original counter signature disappeared — the '
      'deployed application still calls it and the overloads delegate to it';
  end if;
end
$assert_privs$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 — the overloads really are guarded, and the permission is the one
-- the application gates on. A mapping drift would make the database assert a
-- DIFFERENT authority than the server action checked, which looks verified and
-- is not.
-- ---------------------------------------------------------------------------
do $assert_guarded$
declare v_sig text; v_src text;
begin
  for v_sig in select unnest(array[
    'public.next_expense_authorization_number(uuid,uuid)',
    'public.next_expense_voucher_number(uuid,uuid)'
  ]) loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_sig);
    if v_src !~ 'assert_actor_authority' then
      raise exception 'OPS-SEC-2C: % does not call the primitive', v_sig;
    end if;
    if v_src !~ 'finance:expense:submit' then
      raise exception 'OPS-SEC-2C: % does not assert finance:expense:submit', v_sig;
    end if;
    if v_src ~ 'SYSTEM' then
      raise exception 'OPS-SEC-2C: % references the unratified SYSTEM lane', v_sig;
    end if;
  end loop;
end
$assert_guarded$;

-- ---------------------------------------------------------------------------
-- ASSERTION 3 — FAIL-CLOSED, and DATA-INDEPENDENT on purpose.
--
-- CI's organization table is empty when migrations run, so every case here is
-- chosen to need no rows: a sentinel tenant cannot exist, and migration time
-- carries no JWT. The lanes that need real data are proven in
-- supabase/tests/ops_sec_2a_trusted_actor_test.sql, which runs after the seed.
-- A migration-time assertion that passes on an empty database proves nothing.
--
-- Each probe runs in a subtransaction. It cannot allocate a number even if the
-- assertion were absent, because the sentinel tenant would fail the counter's
-- own foreign key -- but the point is that it never reaches the counter at all.
-- ---------------------------------------------------------------------------
do $assert_closed$
declare
  v_state text;
  v_ok    boolean;
begin
  -- (a) unknown tenant is refused, before any allocation
  v_ok := false;
  begin
    perform public.next_expense_authorization_number(
      '00000000-0000-4000-8000-0000000000fe'::uuid,
      '00000000-0000-4000-8000-0000000000fd'::uuid);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA11');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2C: authorization counter did not fail closed (got %)',
      coalesce(v_state, 'no error');
  end if;

  -- (b) same for the voucher counter
  v_ok := false;
  begin
    perform public.next_expense_voucher_number(
      '00000000-0000-4000-8000-0000000000fe'::uuid,
      '00000000-0000-4000-8000-0000000000fd'::uuid);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA11');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2C: voucher counter did not fail closed (got %)',
      coalesce(v_state, 'no error');
  end if;

  raise notice 'OPS-SEC-2C: both expense counters fail closed before allocation';
end
$assert_closed$;

-- ---------------------------------------------------------------------------
-- Phase marker: this migration adds two trusted overloads, asserts its own
-- effect above, and asserts nothing about its position in the chain.
-- ---------------------------------------------------------------------------
