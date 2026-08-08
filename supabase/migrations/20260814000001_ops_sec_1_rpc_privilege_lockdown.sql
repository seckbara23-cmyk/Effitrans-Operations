-- ============================================================================
-- OPS-SEC-1 — P0 privilege-only remediation (RATIFY-OPSSEC-1)
-- ============================================================================
-- Closes the anonymous execution path on the privileged RPC surface: revokes
-- EXECUTE from PUBLIC, anon and authenticated on 43 SECURITY DEFINER functions,
-- and grants EXECUTE to service_role.
--
-- WHAT THIS DOES NOT DO, deliberately, per the ratification:
--   * no function body is modified. The caller-declared p_actor/p_tenant design
--     is the subject of OPS-SEC-2, not of this release;
--   * no table, RLS policy, business rule, trigger or index is touched;
--   * the 13 functions referenced by RLS policy EXPRESSIONS are NOT revoked.
--     Policies are evaluated AS THE CALLING ROLE, so revoking `authenticated`
--     from them would break every policy that calls them rather than harden it.
--     `auth_tenant_id` alone backs 135 policies across 130 tables. Assertion 3
--     proves we did not over-revoke;
--   * `get_user_permissions` is NOT revoked — the browser calls it, and it is
--     SECURITY INVOKER constrained by RLS on user_role (classified P2).
--
-- WHY ALL THREE GRANTEES ARE NAMED: hosted Supabase creates EXPLICIT grants to
-- anon and authenticated in addition to PostgreSQL's implicit PUBLIC privilege.
-- Revoking PUBLIC alone leaves the explicit grants in force, and a local
-- PostgreSQL does not reproduce them. This is the EMP-3 pattern, applied to the
-- whole privileged surface.
--
-- WHY INNER CALLS DO NOT BREAK: every one of the 32 in-database callers of
-- emit_business_event — including all 12 trigger emitters — is SECURITY DEFINER
-- owned by postgres, so inner calls execute as the owner and never consult the
-- caller's grants. Verified before writing this migration.
--
-- IDEMPOTENT: REVOKE and GRANT are both idempotent. Re-running changes nothing.
--
-- ROLLBACK, if a legitimate caller is ever found to have been broken:
--   grant execute on function <exact signature> to authenticated;
-- Nothing else needs undoing — no body, no data, no policy is altered here — so
-- restoring one grant fully reverses this migration for that one function.
-- ============================================================================

do $ops_sec_1$
declare
  v_sig  text;
  v_oid  oid;
  v_done int := 0;
begin
  for v_sig in select unnest(array[
    'public.activate_workflow_policy(uuid,uuid,text,integer)',
    'public.assign_operational_owner(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_process_step(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_task(uuid,uuid,uuid,text,text,text,uuid)',
    'public.ec_assign_triage(uuid,uuid,uuid,uuid)',
    'public.ec_resolve_triage(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'public.ec_review_triage(uuid,uuid,uuid)',
    'public.emit_business_event(uuid,text,text,text,text,uuid,uuid,uuid,jsonb,uuid,integer)',
    'public.finalize_generated_artifact(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,text,uuid,bigint,uuid)',
    'public.finalize_official_invoice(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid,bigint)',
    'public.hr_acknowledge_evaluation(uuid,uuid,uuid,text)',
    'public.hr_assign_equipment(uuid,uuid,uuid,uuid,date,text,text)',
    'public.hr_assign_objective(uuid,uuid,uuid,uuid,text,integer,text,text,text,date,uuid)',
    'public.hr_assign_training(uuid,uuid,uuid,uuid,date,date,uuid)',
    'public.hr_cancel_leave_request(uuid,uuid,uuid,text)',
    'public.hr_close_training_enrollment(uuid,uuid,uuid,text,text)',
    'public.hr_complete_onboarding(uuid,uuid,uuid)',
    'public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text)',
    'public.hr_complete_training(uuid,uuid,uuid,text,date,uuid,text)',
    'public.hr_decide_leave_request(uuid,uuid,uuid,text,text)',
    'public.hr_finalize_evaluation(uuid,uuid,uuid,text,text)',
    'public.hr_open_performance_cycle(uuid,uuid,uuid)',
    'public.hr_return_equipment(uuid,uuid,uuid,text,text,text)',
    'public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text)',
    'public.hr_submit_self_assessment(uuid,uuid,uuid,text)',
    'public.next_employee_number(uuid)',
    'public.next_expense_authorization_number(uuid)',
    'public.next_expense_voucher_number(uuid)',
    'public.next_file_number(uuid,text)',
    'public.next_invoice_number(uuid)',
    'public.quotation_cancel(uuid,uuid,uuid,text)',
    'public.quotation_create(uuid,uuid,uuid)',
    'public.quotation_record_conversion(uuid,uuid,uuid,uuid)',
    'public.quotation_record_decision(uuid,uuid,uuid,text,text,date,uuid,uuid,text)',
    'public.quotation_revise(uuid,uuid,uuid)',
    'public.quotation_send(uuid,uuid,uuid)',
    'public.quotation_submit(uuid,uuid,uuid)',
    'public.quotation_validate(uuid,uuid,uuid,text,text)',
    'public.reconcile_step_completion(uuid,uuid,text,uuid,uuid,uuid,boolean)',
    'public.record_bae_reference(uuid,text,uuid)',
    'public.record_customs_release(uuid,text,uuid,date,uuid)',
    'public.review_document(uuid,text,uuid,text,text,boolean,boolean,uuid)',
    'public.user_readable_file_ids(uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    -- ABORT, never skip. A signature that fails to resolve would otherwise
    -- revoke nothing while every assertion below passed vacuously.
    if v_oid is null then
      raise exception 'OPS-SEC-1: signature did not resolve: % — refusing to continue', v_sig;
    end if;
    execute format('revoke execute on function %s from public', v_sig);
    execute format('revoke execute on function %s from anon', v_sig);
    execute format('revoke execute on function %s from authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
    v_done := v_done + 1;
  end loop;
  if v_done <> 43 then
    raise exception 'OPS-SEC-1: expected 43 functions, processed %', v_done;
  end if;
  raise notice 'OPS-SEC-1: % functions locked down', v_done;
end
$ops_sec_1$;

-- ---------------------------------------------------------------------------
-- ASSERTION 1 — PUBLIC holds no EXECUTE on the P0 set.
-- has_function_privilege CANNOT answer this: PUBLIC is not a login role. Only
-- direct ACL inspection sees grantee 0, and a NULL acl means the implicit
-- PUBLIC grant is still in force. Both conditions are checked.
-- ---------------------------------------------------------------------------
do $assert_public$
declare v_bad text;
begin
  select string_agg(s.sig, ', ') into v_bad
  from unnest(array[
    'public.activate_workflow_policy(uuid,uuid,text,integer)',
    'public.assign_operational_owner(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_process_step(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_task(uuid,uuid,uuid,text,text,text,uuid)',
    'public.ec_assign_triage(uuid,uuid,uuid,uuid)',
    'public.ec_resolve_triage(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'public.ec_review_triage(uuid,uuid,uuid)',
    'public.emit_business_event(uuid,text,text,text,text,uuid,uuid,uuid,jsonb,uuid,integer)',
    'public.finalize_generated_artifact(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,text,uuid,bigint,uuid)',
    'public.finalize_official_invoice(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid,bigint)',
    'public.hr_acknowledge_evaluation(uuid,uuid,uuid,text)',
    'public.hr_assign_equipment(uuid,uuid,uuid,uuid,date,text,text)',
    'public.hr_assign_objective(uuid,uuid,uuid,uuid,text,integer,text,text,text,date,uuid)',
    'public.hr_assign_training(uuid,uuid,uuid,uuid,date,date,uuid)',
    'public.hr_cancel_leave_request(uuid,uuid,uuid,text)',
    'public.hr_close_training_enrollment(uuid,uuid,uuid,text,text)',
    'public.hr_complete_onboarding(uuid,uuid,uuid)',
    'public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text)',
    'public.hr_complete_training(uuid,uuid,uuid,text,date,uuid,text)',
    'public.hr_decide_leave_request(uuid,uuid,uuid,text,text)',
    'public.hr_finalize_evaluation(uuid,uuid,uuid,text,text)',
    'public.hr_open_performance_cycle(uuid,uuid,uuid)',
    'public.hr_return_equipment(uuid,uuid,uuid,text,text,text)',
    'public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text)',
    'public.hr_submit_self_assessment(uuid,uuid,uuid,text)',
    'public.next_employee_number(uuid)',
    'public.next_expense_authorization_number(uuid)',
    'public.next_expense_voucher_number(uuid)',
    'public.next_file_number(uuid,text)',
    'public.next_invoice_number(uuid)',
    'public.quotation_cancel(uuid,uuid,uuid,text)',
    'public.quotation_create(uuid,uuid,uuid)',
    'public.quotation_record_conversion(uuid,uuid,uuid,uuid)',
    'public.quotation_record_decision(uuid,uuid,uuid,text,text,date,uuid,uuid,text)',
    'public.quotation_revise(uuid,uuid,uuid)',
    'public.quotation_send(uuid,uuid,uuid)',
    'public.quotation_submit(uuid,uuid,uuid)',
    'public.quotation_validate(uuid,uuid,uuid,text,text)',
    'public.reconcile_step_completion(uuid,uuid,text,uuid,uuid,uuid,boolean)',
    'public.record_bae_reference(uuid,text,uuid)',
    'public.record_customs_release(uuid,text,uuid,date,uuid)',
    'public.review_document(uuid,text,uuid,text,text,boolean,boolean,uuid)',
    'public.user_readable_file_ids(uuid,uuid)'
  ]) as s(sig)
  join pg_proc p on p.oid = to_regprocedure(s.sig)
  where p.proacl is null
     or exists (select 1 from aclexplode(p.proacl) a
                 where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_bad is not null then
    raise exception 'OPS-SEC-1: PUBLIC still holds EXECUTE on: %', v_bad;
  end if;
end
$assert_public$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 — effective privilege per role.
-- anon and authenticated must be denied; service_role must RETAIN execute, or
-- every server-side call site breaks (23 of 24 RPC-calling modules use it).
-- ---------------------------------------------------------------------------
do $assert_roles$
declare v_sig text; v_oid oid; v_n int := 0;
begin
  for v_sig in select unnest(array[
    'public.activate_workflow_policy(uuid,uuid,text,integer)',
    'public.assign_operational_owner(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_process_step(uuid,uuid,uuid,text,text,uuid)',
    'public.assign_task(uuid,uuid,uuid,text,text,text,uuid)',
    'public.ec_assign_triage(uuid,uuid,uuid,uuid)',
    'public.ec_resolve_triage(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'public.ec_review_triage(uuid,uuid,uuid)',
    'public.emit_business_event(uuid,text,text,text,text,uuid,uuid,uuid,jsonb,uuid,integer)',
    'public.finalize_generated_artifact(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,text,uuid,bigint,uuid)',
    'public.finalize_official_invoice(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid,bigint)',
    'public.hr_acknowledge_evaluation(uuid,uuid,uuid,text)',
    'public.hr_assign_equipment(uuid,uuid,uuid,uuid,date,text,text)',
    'public.hr_assign_objective(uuid,uuid,uuid,uuid,text,integer,text,text,text,date,uuid)',
    'public.hr_assign_training(uuid,uuid,uuid,uuid,date,date,uuid)',
    'public.hr_cancel_leave_request(uuid,uuid,uuid,text)',
    'public.hr_close_training_enrollment(uuid,uuid,uuid,text,text)',
    'public.hr_complete_onboarding(uuid,uuid,uuid)',
    'public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text)',
    'public.hr_complete_training(uuid,uuid,uuid,text,date,uuid,text)',
    'public.hr_decide_leave_request(uuid,uuid,uuid,text,text)',
    'public.hr_finalize_evaluation(uuid,uuid,uuid,text,text)',
    'public.hr_open_performance_cycle(uuid,uuid,uuid)',
    'public.hr_return_equipment(uuid,uuid,uuid,text,text,text)',
    'public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text)',
    'public.hr_submit_self_assessment(uuid,uuid,uuid,text)',
    'public.next_employee_number(uuid)',
    'public.next_expense_authorization_number(uuid)',
    'public.next_expense_voucher_number(uuid)',
    'public.next_file_number(uuid,text)',
    'public.next_invoice_number(uuid)',
    'public.quotation_cancel(uuid,uuid,uuid,text)',
    'public.quotation_create(uuid,uuid,uuid)',
    'public.quotation_record_conversion(uuid,uuid,uuid,uuid)',
    'public.quotation_record_decision(uuid,uuid,uuid,text,text,date,uuid,uuid,text)',
    'public.quotation_revise(uuid,uuid,uuid)',
    'public.quotation_send(uuid,uuid,uuid)',
    'public.quotation_submit(uuid,uuid,uuid)',
    'public.quotation_validate(uuid,uuid,uuid,text,text)',
    'public.reconcile_step_completion(uuid,uuid,text,uuid,uuid,uuid,boolean)',
    'public.record_bae_reference(uuid,text,uuid)',
    'public.record_customs_release(uuid,text,uuid,date,uuid)',
    'public.review_document(uuid,text,uuid,text,text,boolean,boolean,uuid)',
    'public.user_readable_file_ids(uuid,uuid)'
  ]) loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'OPS-SEC-1: signature vanished mid-migration: %', v_sig;
    end if;
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1: anon can still execute %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1: authenticated can still execute %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1: service_role LOST execute on % — server paths would break', v_sig;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 43 then
    raise exception 'OPS-SEC-1: asserted % of 43 functions', v_n;
  end if;
end
$assert_roles$;

-- ---------------------------------------------------------------------------
-- ASSERTION 3 — RLS policy evaluation remains operational.
-- The inverse risk, and the one that actually threatened this release. Policy
-- expressions are evaluated as the CALLING role, so `authenticated` must KEEP
-- execute on every function a policy calls. This proves we did not over-revoke.
-- ---------------------------------------------------------------------------
do $assert_rls$
declare v_sig text; v_oid oid;
begin
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
      raise exception 'OPS-SEC-1: RLS helper % not found — the exclusion list is wrong', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'OPS-SEC-1: OVER-REVOKED — authenticated lost EXECUTE on RLS helper %; every policy calling it would fail', v_sig;
    end if;
  end loop;
end
$assert_rls$;

-- ---------------------------------------------------------------------------
-- ASSERTION 4 — ZERO-EFFECT BEHAVIOURAL PROBE.
-- Privilege metadata says the door is shut. This proves it by knocking.
--
-- Zero-effect by two independent guarantees:
--   1. the probe passes an INVALID decision, so even a fully-privileged call
--      raises at quotation_validate's FIRST statement — before any SELECT, any
--      UPDATE, and any emit_business_event;
--   2. it runs inside a subtransaction that unwinds either way.
-- The UUIDs are fixed sentinels matching no row.
--
-- The distinction that matters: 42501 insufficient_privilege means the call was
-- refused BEFORE the body ran. ANY other outcome means the body executed, which
-- is a failed lockdown — never a pass.
-- ---------------------------------------------------------------------------
do $probe$
declare
  v_state  text;
  v_denied boolean;
  v_role   text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      raise notice 'OPS-SEC-1 probe: role % absent, skipped', v_role;
      continue;
    end if;

    v_denied := false;
    v_state  := null;

    execute format('set local role %I', v_role);
    begin
      perform public.quotation_validate(
        '00000000-0000-4000-8000-000000000001'::uuid,
        '00000000-0000-4000-8000-000000000002'::uuid,
        '00000000-0000-4000-8000-000000000003'::uuid,
        '__ops_sec_1_probe__', null);
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
        'OPS-SEC-1: lockdown FAILED — role % reached the function body (sqlstate %)',
        v_role, coalesce(v_state, 'none');
    end if;
    raise notice 'OPS-SEC-1 probe: % denied before body execution', v_role;
  end loop;
end
$probe$;

-- ---------------------------------------------------------------------------
-- Phase marker: this migration locks down 43 functions and asserts its own
-- effect above, and asserts nothing about its position in the chain.
-- ---------------------------------------------------------------------------
