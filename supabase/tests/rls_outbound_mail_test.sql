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
-- 2B. EFFECTIVE IMMUTABILITY OF THE OUTBOUND TABLE
-- ===========================================================================
-- The property that actually protects sent evidence is that a browser session
-- cannot MUTATE a row — not that no DML grant exists. Those are different
-- things, and this platform relies on the first:
--
--   * every table has RLS enabled and SELECT policies only. There is no
--     INSERT/UPDATE/DELETE policy on ANY table in this repository;
--   * therefore every write by anon/authenticated is denied by RLS, whether or
--     not a grant exists;
--   * the DML grants that DO appear on a hosted project come from Supabase's
--     default privileges, not from this repository, which grants no DML to
--     browser roles anywhere.
--
-- TWO ENVIRONMENTS DENY IT BY DIFFERENT MECHANISMS, so this test accepts both
-- and asserts only the outcome:
--   * hosted (grant present, no policy)  -> UPDATE/DELETE match 0 rows;
--   * bare local (no grant at all)       -> 42501 insufficient_privilege.
-- Either way the row is unchanged, which is the whole claim.
do $$
declare
  v_tenant uuid;
  v_id     uuid;
  v_n      int;
  v_state  text;
begin
  select id into v_tenant from public.organization limit 1;
  if v_tenant is null then
    insert into _r values ('effective_immutability', 'skipped_no_tenant');
    return;
  end if;

  insert into public.communication_message
    (tenant_id, recipient_email, subject, body_html, body_text, kind, status, provider)
  values (v_tenant, 'immutable@test.local', 'before', 'h', 't', 'COMPOSE', 'SENT', 'resend')
  returning id into v_id;

  -- INSERT as authenticated: RLS with no INSERT policy raises 42501, and so
  -- does a missing grant. Either is a refusal.
  begin
    set local role authenticated;
    insert into public.communication_message
      (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
    values (v_tenant, 'evil@test.local', 's', 'h', 't', 'COMPOSE', 'DRAFT');
    reset role;
    raise exception 'EMP-3 RLS FAIL: authenticated inserted into communication_message';
  exception
    when insufficient_privilege then
      reset role;
      insert into _r values ('authenticated_cannot_insert', 'ok');
    when others then
      v_state := sqlstate;
      reset role;
      if v_state = 'P0001' then raise; end if;
      raise exception 'EMP-3 RLS FAIL: unexpected % on authenticated insert', v_state;
  end;

  -- UPDATE as authenticated: no UPDATE policy means no row is updatable, so
  -- this matches zero rows rather than erroring. A missing grant errors.
  begin
    set local role authenticated;
    update public.communication_message set subject = 'tampered' where id = v_id;
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 0 then
      raise exception 'EMP-3 RLS FAIL: authenticated updated % row(s)', v_n;
    end if;
    insert into _r values ('authenticated_cannot_update', 'ok');
  exception
    when insufficient_privilege then
      reset role;
      insert into _r values ('authenticated_cannot_update', 'ok');
    when others then
      v_state := sqlstate;
      reset role;
      if v_state = 'P0001' then raise; end if;
      raise exception 'EMP-3 RLS FAIL: unexpected % on authenticated update', v_state;
  end;

  begin
    set local role authenticated;
    delete from public.communication_message where id = v_id;
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 0 then
      raise exception 'EMP-3 RLS FAIL: authenticated deleted % row(s)', v_n;
    end if;
    insert into _r values ('authenticated_cannot_delete', 'ok');
  exception
    when insufficient_privilege then
      reset role;
      insert into _r values ('authenticated_cannot_delete', 'ok');
    when others then
      v_state := sqlstate;
      reset role;
      if v_state = 'P0001' then raise; end if;
      raise exception 'EMP-3 RLS FAIL: unexpected % on authenticated delete', v_state;
  end;

  -- The decisive check: the evidence is untouched, by whichever mechanism.
  if (select subject from public.communication_message where id = v_id) <> 'before' then
    raise exception 'EMP-3 RLS FAIL: sent evidence was mutated';
  end if;
  if not exists (select 1 from public.communication_message where id = v_id) then
    raise exception 'EMP-3 RLS FAIL: sent evidence was deleted';
  end if;
  insert into _r values ('sent_evidence_unchanged', 'ok');

  -- And RLS is what does it: enabled, with no write policy of any kind.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'communication_message' and c.relrowsecurity
  ) then
    raise exception 'EMP-3 RLS FAIL: RLS not enabled on communication_message';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'communication_message'
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'EMP-3 RLS FAIL: a write policy exists on communication_message';
  end if;
  insert into _r values ('rls_on_no_write_policy', 'ok');
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
