-- ============================================================================
-- OPS-SEC-1 — P0 addendum (DECISION 2)
-- ============================================================================
-- Migration 90 locked down 43 functions and IS ALREADY APPLIED IN PRODUCTION.
-- Applied migrations are never edited, so the two ratified additions land here
-- as a separate forward-only migration instead.
--
-- WHY THESE TWO. They are the same exposure class as the 43 — SECURITY DEFINER,
-- RLS-bypassing, mutating, executable by anon — and sat outside the original set
-- only because that set keyed on "has a TypeScript caller", which is a
-- classification artifact and not a security distinction.
--
--   public.next_quotation_number(uuid)
--     LIVE, but called only from INSIDE public.quotation_send, which is itself
--     SECURITY DEFINER owned by postgres. An inner call executes as the owner
--     and never consults the caller's grants, so revoking cannot break it.
--     Post-90 production probe: an anonymous call ENTERED THE BODY and attempted
--     an INSERT, stopped only by a foreign-key violation on a nonexistent
--     tenant. With a real tenant id this is an anonymous write.
--
--   public.supersede_document(uuid,uuid,uuid,uuid)
--     No caller anywhere — not TypeScript, not SQL, not a policy expression.
--     Mutating and emits a business event. Exposed with nothing calling it.
--
-- PRIVILEGE-ONLY, exactly as migration 90: no function body, table, policy,
-- trigger, index or row is touched. Scope is these two signatures and nothing
-- else; the 13 RLS-policy helpers and get_user_permissions remain untouched and
-- are re-asserted below because this migration must not narrow them either.
--
-- IDEMPOTENT: REVOKE and GRANT both are. Re-running changes nothing.
--
-- ROLLBACK, only if a legitimate caller is ever found to have been broken:
--   grant execute on function public.next_quotation_number(uuid) to authenticated;
--   grant execute on function public.supersede_document(uuid,uuid,uuid,uuid) to authenticated;
-- No data, body or policy is altered here, so restoring a grant fully reverses it.
-- ============================================================================

do $ops_sec_1_addendum$
declare
  v_sig  text;
  v_oid  oid;
  v_done int := 0;
begin
  for v_sig in select unnest(array[
    'public.next_quotation_number(uuid)',
    'public.supersede_document(uuid,uuid,uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    -- ABORT, never skip. A signature that fails to resolve would otherwise
    -- revoke nothing while every assertion below passed vacuously. Signatures
    -- are the oid::regprocedure form (types only); the identity-arguments form
    -- includes parameter names, which to_regprocedure rejects.
    if v_oid is null then
      raise exception 'OPS-SEC-1 addendum: signature did not resolve: % — refusing to continue', v_sig;
    end if;
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('revoke execute on function %s from authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then
    raise exception 'OPS-SEC-1 addendum: expected 2 functions, processed %', v_done;
  end if;
  raise notice 'OPS-SEC-1 addendum: % functions locked down', v_done;
end
$ops_sec_1_addendum$;

-- ---------------------------------------------------------------------------
-- ASSERTION 1 — PUBLIC holds no EXECUTE on either function.
-- has_function_privilege CANNOT answer this: PUBLIC is not a login role. Only
-- direct ACL inspection sees grantee 0, and a NULL acl means the implicit
-- PUBLIC grant is still in force. Both conditions are checked.
-- ---------------------------------------------------------------------------
do $assert_public$
declare v_bad text;
begin
  select string_agg(s.sig, ', ') into v_bad
  from unnest(array[
    'public.next_quotation_number(uuid)',
    'public.supersede_document(uuid,uuid,uuid,uuid)'
  ]) as s(sig)
  join pg_proc p on p.oid = to_regprocedure(s.sig)
  where p.proacl is null
     or exists (select 1 from aclexplode(p.proacl) a
                 where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_bad is not null then
    raise exception 'OPS-SEC-1 addendum: PUBLIC still holds EXECUTE on: %', v_bad;
  end if;
end
$assert_public$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 — effective privilege per role.
-- ---------------------------------------------------------------------------
do $assert_roles$
declare v_sig text; v_oid oid; v_n int := 0;
begin
  for v_sig in select unnest(array[
    'public.next_quotation_number(uuid)',
    'public.supersede_document(uuid,uuid,uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'OPS-SEC-1 addendum: signature vanished mid-migration: %', v_sig;
    end if;
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1 addendum: anon can still execute %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1 addendum: authenticated can still execute %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1 addendum: service_role LOST execute on % — server paths would break', v_sig;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 2 then
    raise exception 'OPS-SEC-1 addendum: asserted % of 2 functions', v_n;
  end if;
end
$assert_roles$;

-- ---------------------------------------------------------------------------
-- ASSERTION 3 — this migration narrowed nothing else.
-- quotation_send must still be callable by service_role (it is the only caller
-- of next_quotation_number), and the RLS-policy helpers must still be callable
-- by authenticated. Policies are evaluated AS THE CALLING ROLE, so losing these
-- would break every policy that calls them rather than harden anything.
-- ---------------------------------------------------------------------------
do $assert_untouched$
declare v_sig text; v_oid oid;
begin
  if not has_function_privilege('service_role',
       to_regprocedure('public.quotation_send(uuid,uuid,uuid)'), 'EXECUTE') then
    raise exception 'OPS-SEC-1 addendum: service_role lost quotation_send — the only caller of next_quotation_number';
  end if;

  for v_sig in select unnest(array[
    'public.auth_tenant_id()',
    'public.has_permission(text)',
    'public.can_read_file(uuid)',
    'public.portal_can_read_file(uuid)',
    'public.portal_can_read_shipment(uuid)',
    'public.user_can_read_mailbox(uuid)',
    'public.auth_portal_client_id()',
    'public.messaging_staff_can_access_conversation(uuid)',
    'public.auth_portal_tenant_id()',
    'public.portal_can_read_invoice(uuid)',
    'public.messaging_portal_can_access_conversation(uuid)',
    'public.is_assigned_driver(uuid)',
    'public.can_read_task(uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'OPS-SEC-1 addendum: RLS helper % not found', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1 addendum: OVER-REVOKED — authenticated lost EXECUTE on RLS helper %', v_sig;
    end if;
  end loop;

  if not has_function_privilege('authenticated',
       to_regprocedure('public.get_user_permissions(uuid)'), 'EXECUTE') then
    raise exception 'OPS-SEC-1 addendum: authenticated lost get_user_permissions — the browser calls it';
  end if;
end
$assert_untouched$;

-- ---------------------------------------------------------------------------
-- ASSERTION 4 — BEHAVIOURAL PROBE.
--
-- A NOTE ON INERTNESS, because it differs from migration 90. There, the probe
-- was inert by construction: quotation_validate raises on an unknown decision
-- before touching anything. next_quotation_number has no such early guard — it
-- WRITES. So inertness here rests on two different guarantees:
--
--   1. the tenant id is a sentinel that exists in no organization row, so the
--      counter insert cannot satisfy its foreign key;
--   2. more importantly, if the call is NOT refused this migration RAISES, which
--      aborts the whole transaction — so anything the call managed to write is
--      rolled back with it. A failed lockdown cannot leave a row behind.
--
-- 42501 insufficient_privilege means refused BEFORE the body ran. Any other
-- outcome means the body executed, which is a failed lockdown, never a pass.
-- ---------------------------------------------------------------------------
do $probe$
declare
  v_state  text;
  v_denied boolean;
  v_role   text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      raise notice 'OPS-SEC-1 addendum probe: role % absent, skipped', v_role;
      continue;
    end if;

    v_denied := false;
    v_state  := null;

    execute format('set local role %I', v_role);
    begin
      perform public.next_quotation_number('00000000-0000-4000-8000-000000000001'::uuid);
    exception
      when insufficient_privilege then
        v_denied := true;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        v_denied := false;
    end;
    reset role;

    -- Raised only AFTER the role reset. Raising while still wearing a
    -- restricted role is how migration 89 failed in production.
    if not v_denied then
      raise exception
        'OPS-SEC-1 addendum: lockdown FAILED — role % reached the function body (sqlstate %)',
        v_role, coalesce(v_state, 'none');
    end if;
    raise notice 'OPS-SEC-1 addendum probe: % denied before body execution', v_role;
  end loop;
end
$probe$;

-- ---------------------------------------------------------------------------
-- Phase marker: this migration locks down 2 functions and asserts its own
-- effect above, and asserts nothing about its position in the chain.
-- ---------------------------------------------------------------------------
