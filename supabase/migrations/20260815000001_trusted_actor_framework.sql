-- ============================================================================
-- OPS-SEC-2A — Trusted Actor Framework (primitive + minimal pilot)
-- ============================================================================
-- OPS-SEC-2 found that 50 non-trigger functions accept an actor/tenant and that
-- NONE of them verify the nomination: 0 reference auth.uid(), 0 call
-- has_permission(), 3 check the actor against app_user, 0 check the tenant.
-- The database accepts the application's word about who is acting.
--
-- This migration adds the one primitive that will fix that, and proves it on
-- two deliberately boring functions. It converts NOTHING else.
--
-- WHAT THIS DOES NOT DO, per the phase's scope exclusions:
--   * does not touch emit_business_event, can_read_file, user_readable_file_ids,
--     the seven anonymous helpers, or migrations 90-92;
--   * does not convert the domain RPC surface;
--   * does not change any existing function body or signature. The two pilot
--     functions gain an OVERLOAD; the originals are untouched and still work.
--
-- SYSTEM PRINCIPALS ARE DELIBERATELY ABSENT. See the SYSTEM lane below: the
-- identity model cannot host them safely today, so the lane fails closed rather
-- than being implemented on an unsafe assumption.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE CANONICAL ASSERTION PRIMITIVE
--
-- One primitive, three lanes, and the rule that makes it trustworthy: THE
-- CALLER DECLARES ITS LANE, AND THE PRIMITIVE VERIFIES THE DECLARATION AGAINST
-- WHAT IT CAN OBSERVE. A declaration that disagrees with the observed session
-- state is refused, so a browser caller cannot claim to be a service, and a
-- service cannot claim to be a browser.
--
-- The observable is auth.uid(): present for an interactive JWT, NULL for the
-- service-role key, which carries no subject.
--
--   INTERACTIVE  auth.uid() IS NOT NULL.
--                The nominated actor MUST equal auth.uid() — a browser caller
--                can never nominate anyone else. Tenant is derived from the
--                user's own membership, not accepted from the caller. The
--                permission is enforced through the session.
--
--   SERVICE      auth.uid() IS NULL. The service role is trusted TRANSPORT, not
--                automatic authorization: the nominated actor must exist, be
--                active, belong to the named tenant, and actually hold the
--                required permission. That is the difference between "the app
--                says this is fine" and "the database checked".
--
--   SYSTEM       Fails closed. Not implemented — see the note at the bottom.
--
-- Anything else, including NULL, is refused. Unknown context is never a pass.
--
-- SECURITY DEFINER because the SERVICE lane must resolve a nominated actor's
-- tenant and permissions, and those tables are RLS-protected. The owner is
-- postgres and none of them use FORCE ROW LEVEL SECURITY, so the lookup
-- succeeds; search_path is pinned so it cannot be redirected.
-- ---------------------------------------------------------------------------
create or replace function public.assert_actor_authority(
  p_actor      uuid,
  p_tenant     uuid,
  p_permission text,
  p_context    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := auth.uid();
  v_tenant  uuid;
  v_status  text;
begin
  if p_permission is null or btrim(p_permission) = '' then
    raise exception 'OPS-SEC-2A: a required permission must be named'
      using errcode = 'EFA01';
  end if;

  -- ---------------- INTERACTIVE ------------------------------------------
  if p_context = 'INTERACTIVE' then
    if v_session is null then
      raise exception
        'OPS-SEC-2A: INTERACTIVE declared but there is no authenticated session'
        using errcode = 'EFA02';
    end if;
    if p_actor is null or p_actor <> v_session then
      -- The whole point of the lane: nomination is forbidden here.
      raise exception
        'OPS-SEC-2A: an interactive caller may act only as itself'
        using errcode = 'EFA03';
    end if;
    select u.tenant_id, u.status into v_tenant, v_status
      from public.app_user u where u.id = v_session;
    if v_tenant is null then
      raise exception 'OPS-SEC-2A: session identity resolves to no tenant'
        using errcode = 'EFA04';
    end if;
    if p_tenant is null or p_tenant <> v_tenant then
      -- Tenant is DERIVED, never accepted. A mismatch means the caller tried
      -- to act outside its own tenant.
      raise exception 'OPS-SEC-2A: tenant does not match the session identity'
        using errcode = 'EFA05';
    end if;
    if v_status <> 'active' then
      raise exception 'OPS-SEC-2A: actor is not active' using errcode = 'EFA06';
    end if;
    if not public.has_permission(p_permission) then
      raise exception 'OPS-SEC-2A: permission % not held', p_permission
        using errcode = 'EFA07';
    end if;
    return;
  end if;

  -- ---------------- SERVICE ----------------------------------------------
  if p_context = 'SERVICE' then
    if v_session is not null then
      -- A session-bearing caller may not claim to be a service. Without this,
      -- declaring SERVICE would be a way for a browser to nominate any actor.
      raise exception
        'OPS-SEC-2A: SERVICE declared from an authenticated session'
        using errcode = 'EFA08';
    end if;
    if p_actor is null then
      raise exception 'OPS-SEC-2A: SERVICE requires a nominated actor'
        using errcode = 'EFA09';
    end if;
    if p_tenant is null then
      raise exception 'OPS-SEC-2A: SERVICE requires a target tenant'
        using errcode = 'EFA10';
    end if;
    if not exists (select 1 from public.organization o where o.id = p_tenant) then
      raise exception 'OPS-SEC-2A: unknown tenant' using errcode = 'EFA11';
    end if;

    select u.tenant_id, u.status into v_tenant, v_status
      from public.app_user u where u.id = p_actor;
    if v_tenant is null then
      raise exception 'OPS-SEC-2A: nominated actor does not exist'
        using errcode = 'EFA12';
    end if;
    if v_tenant <> p_tenant then
      -- A forged pairing: a real user, but not of that tenant.
      raise exception 'OPS-SEC-2A: nominated actor does not belong to that tenant'
        using errcode = 'EFA13';
    end if;
    if v_status <> 'active' then
      raise exception 'OPS-SEC-2A: nominated actor is not active'
        using errcode = 'EFA14';
    end if;
    -- The assertion that makes the service role transport rather than authority.
    if not exists (
      select 1 from public.get_user_permissions(p_actor) gp
       where gp.code = p_permission
    ) then
      raise exception 'OPS-SEC-2A: nominated actor does not hold %', p_permission
        using errcode = 'EFA15';
    end if;
    return;
  end if;

  -- ---------------- SYSTEM ------------------------------------------------
  if p_context = 'SYSTEM' then
    -- DELIBERATELY UNIMPLEMENTED, and failing closed is the correct state.
    --
    -- A system principal would need a row in public.app_user, whose primary key
    -- is a FOREIGN KEY to auth.users(id). Creating one therefore creates a real
    -- authentication identity, and "it can never log in" would be an assumption
    -- about GoTrue configuration -- magic links, OTP, an admin-set password --
    -- that no database constraint here can enforce. Asserting a security
    -- property the schema cannot hold is exactly the kind of claim this whole
    -- programme exists to stop making.
    --
    -- The alternative that IS safe -- a NULL actor plus an explicit execution
    -- context, which audit_log.actor_id and business_event.actor_user_id
    -- already permit by being nullable -- is a governance decision, not an
    -- engineering one. Until it is ratified, system work has no lane.
    raise exception
      'OPS-SEC-2A: the SYSTEM lane is not implemented; system principals are unratified'
      using errcode = 'EFA16';
  end if;

  -- ---------------- anything else ----------------------------------------
  raise exception 'OPS-SEC-2A: unknown execution context %',
    coalesce(p_context, '<null>') using errcode = 'EFA17';
end
$$;

comment on function public.assert_actor_authority(uuid, uuid, text, text) is
  'OPS-SEC-2A canonical authority assertion. Lanes: INTERACTIVE (actor must be '
  'auth.uid(), tenant derived), SERVICE (nomination verified against app_user + '
  'get_user_permissions), SYSTEM (fails closed, unratified). Unknown context fails closed.';

-- ---------------------------------------------------------------------------
-- PILOT 1 — file numbering.
-- Chosen because it is boring: one call site (createFile), service-role only,
-- no business_event, no trigger, no RLS dependency, and an unambiguous gate.
-- createFile asserts `file:create`, so the database asserts the same thing.
--
-- An OVERLOAD, not a replacement. The existing two-argument function is
-- untouched and still serves the deployed application, so applying this
-- migration cannot break a running deploy. Switching the call site is
-- OPS-SEC-2B, once this is confirmed applied in production.
-- ---------------------------------------------------------------------------
create or replace function public.next_file_number(
  p_tenant uuid,
  p_type   text,
  p_actor  uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 'SERVICE' is hard-coded rather than accepted, and that is safe BECAUSE the
  -- primitive validates the declaration: if this were ever reached from an
  -- authenticated session, the lane check refuses it.
  perform public.assert_actor_authority(p_actor, p_tenant, 'file:create', 'SERVICE');
  -- Delegates to the existing implementation. The numbering logic has exactly
  -- one definition; this adds authority in front of it, not a second counter.
  return public.next_file_number(p_tenant, p_type);
end
$$;

-- ---------------------------------------------------------------------------
-- PILOT 2 — employee numbering.
-- createEmployee gates on `hr:manage` via its module guard(); the database
-- asserts the same permission.
-- ---------------------------------------------------------------------------
create or replace function public.next_employee_number(
  p_tenant uuid,
  p_actor  uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');
  return public.next_employee_number(p_tenant);
end
$$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES — the EMP-3 / OPS-SEC-1 pattern, applied to what this adds.
-- All three grantees are named because hosted Supabase creates explicit
-- anon/authenticated grants on top of PostgreSQL's implicit PUBLIC one.
-- ---------------------------------------------------------------------------
do $privs$
declare v_sig text;
begin
  for v_sig in select unnest(array[
    'public.assert_actor_authority(uuid,uuid,text,text)',
    'public.next_file_number(uuid,text,uuid)',
    'public.next_employee_number(uuid,uuid)'
  ]) loop
    if to_regprocedure(v_sig) is null then
      raise exception 'OPS-SEC-2A: % did not resolve', v_sig;
    end if;
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('revoke execute on function %s from authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$privs$;

-- ---------------------------------------------------------------------------
-- ASSERTION 1 — privileges took, on all three.
-- ---------------------------------------------------------------------------
do $assert_privs$
declare v_sig text; v_oid oid; v_n int := 0;
begin
  for v_sig in select unnest(array[
    'public.assert_actor_authority(uuid,uuid,text,text)',
    'public.next_file_number(uuid,text,uuid)',
    'public.next_employee_number(uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2A: anon can execute %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2A: authenticated can execute %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-2A: service_role lost %', v_sig;
    end if;
    if exists (select 1 from pg_proc p where p.oid = v_oid
                and (p.proacl is null
                     or exists (select 1 from aclexplode(p.proacl) a
                                 where a.grantee = 0 and a.privilege_type='EXECUTE'))) then
      raise exception 'OPS-SEC-2A: PUBLIC holds %', v_sig;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 3 then
    raise exception 'OPS-SEC-2A: asserted % of 3', v_n;
  end if;
end
$assert_privs$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 — FAIL-CLOSED BEHAVIOUR, proven here because it needs NO DATA.
--
-- This runs at migration time, where CI's organization table is empty. Every
-- case below is therefore chosen to be data-independent; the lanes that need
-- real rows are proven in supabase/tests/ops_sec_2a_trusted_actor_test.sql,
-- which runs after the seed. A migration-time assertion that quietly passes on
-- an empty database is not verification, and this phase does not rely on one.
--
-- Each probe runs in its own subtransaction and persists nothing.
-- ---------------------------------------------------------------------------
do $assert_closed$
declare
  v_state text;
  v_ok    boolean;
begin
  -- (a) unknown context is refused
  v_ok := false;
  begin
    perform public.assert_actor_authority(null, null, 'file:create', 'BOGUS_LANE');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA17');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2A: unknown context did not fail closed (got %)',
      coalesce(v_state,'no error');
  end if;

  -- (b) NULL context is refused
  v_ok := false;
  begin
    perform public.assert_actor_authority(null, null, 'file:create', null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA17');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2A: null context did not fail closed (got %)',
      coalesce(v_state,'no error');
  end if;

  -- (c) the SYSTEM lane is closed
  v_ok := false;
  begin
    perform public.assert_actor_authority(null, null, 'file:create', 'SYSTEM');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA16');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2A: SYSTEM lane is not closed (got %)',
      coalesce(v_state,'no error');
  end if;

  -- (d) INTERACTIVE without a session is refused. Migration time has no JWT,
  --     so auth.uid() is NULL here and this is data-independent.
  v_ok := false;
  begin
    perform public.assert_actor_authority(
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000002'::uuid,
      'file:create', 'INTERACTIVE');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA02');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2A: INTERACTIVE without a session did not fail closed (got %)',
      coalesce(v_state,'no error');
  end if;

  -- (e) SERVICE with a nonexistent tenant is refused BEFORE any actor lookup.
  --     Data-independent: the sentinel tenant cannot exist.
  v_ok := false;
  begin
    perform public.assert_actor_authority(
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-0000000000ff'::uuid,
      'file:create', 'SERVICE');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_ok := (v_state = 'EFA11');
  end;
  if not v_ok then
    raise exception 'OPS-SEC-2A: SERVICE with an unknown tenant did not fail closed (got %)',
      coalesce(v_state,'no error');
  end if;

  raise notice 'OPS-SEC-2A: fail-closed behaviour verified (5 data-independent cases)';
end
$assert_closed$;

-- ---------------------------------------------------------------------------
-- Phase marker: this migration adds one primitive and two pilot overloads,
-- asserts its own effect above, and asserts nothing about its position in the
-- chain.
-- ---------------------------------------------------------------------------
