-- rls_outbound_mail_test.sql
-- EMP-3 — outbound mail: function privileges and dispatch invariants.
--
-- The privilege half of this suite exists because the FIRST attempt at
-- migration 87 shipped a revoke that only covered PUBLIC, leaving Supabase's
-- explicit default-privilege grants to anon and authenticated intact. That is
-- exactly the kind of defect no application test can see, so it is proven here
-- against a real database.
--
-- What a PostgREST RPC call actually does is check EXECUTE privilege for the
-- request's role and return 42501 (insufficient_privilege) when it is absent.
-- This suite asserts that privilege state directly, and additionally proves the
-- 42501 by attempting the call AS those roles.

begin;

create temp table _r (check_name text, value text) on commit drop;

-- ===========================================================================
-- 1. PRIVILEGE MATRIX
-- ===========================================================================
do $$
declare
  v_sigs text[] := array[
    'public.comm_acquire_send(uuid, uuid)',
    'public.comm_record_send_accepted(uuid, uuid, text, text, uuid)',
    'public.comm_record_send_failed(uuid, uuid, text)',
    'public.comm_reconcile_stuck_send(uuid, uuid, text, text)'
  ];
  v_sig text;
  v_bad text;
begin
  -- DENIED: PUBLIC. Only the ACL can see this grantee — has_function_privilege
  -- takes a role, and PUBLIC is not one.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
   where n.nspname = 'public'
     and p.proname like 'comm\_%'
     and a.grantee = 0
     and a.privilege_type = 'EXECUTE';
  if v_bad is not null then
    raise exception 'EMP-3 RLS FAIL: PUBLIC holds EXECUTE on %', v_bad;
  end if;
  insert into _r values ('public_no_execute', 'ok');

  -- DENIED: no grant ROW for the browser roles.
  select string_agg(routine_name || '/' || grantee, ', ') into v_bad
    from information_schema.routine_privileges
   where specific_schema = 'public'
     and routine_name in ('comm_acquire_send', 'comm_record_send_accepted',
                          'comm_record_send_failed', 'comm_reconcile_stuck_send')
     and grantee in ('anon', 'authenticated', 'PUBLIC')
     and privilege_type = 'EXECUTE';
  if v_bad is not null then
    raise exception 'EMP-3 RLS FAIL: grant rows exist for %', v_bad;
  end if;
  insert into _r values ('no_grant_rows_for_browser_roles', 'ok');

  -- DENIED: EFFECTIVE privilege, which is what actually governs the RPC.
  foreach v_sig in array v_sigs loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 RLS FAIL: anon can EXECUTE %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 RLS FAIL: authenticated can EXECUTE %', v_sig;
    end if;
  end loop;
  insert into _r values ('anon_authenticated_no_execute', 'ok');

  -- ALLOWED: the sanctioned dispatch identity. Without this the matrix would
  -- be "secure" by being unusable.
  foreach v_sig in array v_sigs loop
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 RLS FAIL: service_role cannot EXECUTE %', v_sig;
    end if;
  end loop;
  insert into _r values ('service_role_can_execute', 'ok');
end $$;

-- ===========================================================================
-- 2. THE 42501 ITSELF — attempt the call as the browser roles.
-- ===========================================================================
-- Asserting the privilege is the rule; this proves the consequence. A PostgREST
-- RPC from a browser session runs as one of these roles, so a refusal here is a
-- refusal there.
do $$
declare
  v_sqlstate text;
begin
  begin
    set local role anon;
    perform public.comm_acquire_send(
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid);
    reset role;
    raise exception 'EMP-3 RLS FAIL: anon executed comm_acquire_send';
  exception
    when insufficient_privilege then
      reset role;
      insert into _r values ('anon_rpc_42501', 'ok');
    when others then
      v_sqlstate := sqlstate;
      reset role;
      if v_sqlstate = 'P0001' then raise; end if;
      raise exception 'EMP-3 RLS FAIL: anon got % instead of 42501', v_sqlstate;
  end;

  begin
    set local role authenticated;
    perform public.comm_record_send_failed(
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid, 'x');
    reset role;
    raise exception 'EMP-3 RLS FAIL: authenticated executed comm_record_send_failed';
  exception
    when insufficient_privilege then
      reset role;
      insert into _r values ('authenticated_rpc_42501', 'ok');
    when others then
      v_sqlstate := sqlstate;
      reset role;
      if v_sqlstate = 'P0001' then raise; end if;
      raise exception 'EMP-3 RLS FAIL: authenticated got % instead of 42501', v_sqlstate;
  end;
end $$;

-- ===========================================================================
-- 3. DISPATCH INVARIANTS
-- ===========================================================================
do $$
declare
  v_tenant uuid;
  v_id     uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.organization limit 1;
  if v_tenant is null then
    insert into _r values ('dispatch_invariants', 'skipped_no_tenant');
    return;
  end if;

  insert into public.communication_message
    (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
  values (v_tenant, 'cas@test.local', 's', 'h', 't', 'COMPOSE', 'QUEUED')
  returning id into v_id;

  -- Exactly one winner: the CAS is the whole duplicate-send defence.
  if not public.comm_acquire_send(v_id, v_tenant) then
    raise exception 'EMP-3 RLS FAIL: first acquire lost';
  end if;
  if public.comm_acquire_send(v_id, v_tenant) then
    raise exception 'EMP-3 RLS FAIL: second acquire also won';
  end if;
  insert into _r values ('cas_single_winner', 'ok');

  -- A stub provider is refused at the database boundary, so a no-op acceptance
  -- can never produce SENT or a ledger event.
  begin
    perform public.comm_record_send_accepted(v_id, v_tenant, 'noop', null, null);
    raise exception 'EMP-3 RLS FAIL: stub provider acceptance recorded';
  exception
    when others then
      if sqlerrm like 'EMP-3 RLS FAIL%' then raise; end if;
      insert into _r values ('stub_provider_refused', 'ok');
  end;

  -- A real acceptance transitions the row AND emits exactly one event.
  v_ok := public.comm_record_send_accepted(v_id, v_tenant, 'resend', 'prov-1', null);
  if not v_ok then
    raise exception 'EMP-3 RLS FAIL: real acceptance was not recorded';
  end if;
  if (select count(*) from public.business_event
       where event_type = 'CORRESPONDENCE_SENT' and subject_id = v_id) <> 1 then
    raise exception 'EMP-3 RLS FAIL: CORRESPONDENCE_SENT not emitted exactly once';
  end if;
  insert into _r values ('accepted_emits_once', 'ok');

  -- A second acceptance is a no-op and emits nothing more: the row is no longer
  -- SENDING, which is what makes the event exactly-once.
  if public.comm_record_send_accepted(v_id, v_tenant, 'resend', 'prov-1', null) then
    raise exception 'EMP-3 RLS FAIL: second acceptance succeeded';
  end if;
  if (select count(*) from public.business_event
       where event_type = 'CORRESPONDENCE_SENT' and subject_id = v_id) <> 1 then
    raise exception 'EMP-3 RLS FAIL: duplicate CORRESPONDENCE_SENT emitted';
  end if;
  insert into _r values ('second_acceptance_emits_nothing', 'ok');

  -- A failed send emits nothing at all.
  insert into public.communication_message
    (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
  values (v_tenant, 'fail@test.local', 's', 'h', 't', 'COMPOSE', 'QUEUED')
  returning id into v_id;
  perform public.comm_acquire_send(v_id, v_tenant);
  perform public.comm_record_send_failed(v_id, v_tenant, 'refused');
  if (select count(*) from public.business_event
       where event_type = 'CORRESPONDENCE_SENT' and subject_id = v_id) <> 0 then
    raise exception 'EMP-3 RLS FAIL: failed send emitted CORRESPONDENCE_SENT';
  end if;
  if (select status from public.communication_message where id = v_id) <> 'FAILED' then
    raise exception 'EMP-3 RLS FAIL: failed send did not land on FAILED';
  end if;
  insert into _r values ('failed_send_emits_nothing', 'ok');
end $$;

select * from _r order by check_name;
rollback;
