-- RLS regression test — process reconciliation (WES-5). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
--   ATOMICITY & IDEMPOTENCY
--   * reconcile completes the step + consumes evidence + emits event, atomically -> 1/1/1
--   * provenance is RECONCILED with the fact code, never HUMAN                   -> 1
--   * a SECOND run is a no-op: already=true, no new event, no new consumption    -> equal
--   * a FAILED event rolls back the transition AND the consumption               -> unchanged
--
--   REFUSALS
--   * SUBMITTED (maker-checker pending) is refused                               -> raises
--   * REJECTED (human decision) is refused                                       -> raises
--   * an empty fact code is refused                                              -> raises
--
--   EVIDENCE (WES-5D)
--   * the EXACT document version and hash are recorded                           -> 1
--   * the consumed document moves VERIFIED -> CONSUMED_AS_EVIDENCE               -> 1
--   * the consumption row is immutable (UPDATE/DELETE raise)                     -> raises
--
--   ISOLATION
--   * tenant B cannot read tenant A's consumptions                               -> 0
--   * a portal user cannot read any consumption                                  -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000e5', 'Test Tenant W5', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'w5-f1@test.local'),
  ('00000000-0000-0000-0000-00000000f002', 'w5-f2@test.local'),
  ('00000000-0000-0000-0000-00000000f003', 'w5-f3@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000001', 'w5-f1@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000e5', 'w5-f2@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-000000000001', 'W5 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000cd', 'w5-f3@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  v_file uuid := '00000000-0000-0000-0000-00000000f510';
  v_inst uuid := '00000000-0000-0000-0000-00000000f520';
  v_exec uuid := '00000000-0000-0000-0000-00000000f530';
  v_exec2 uuid := '00000000-0000-0000-0000-00000000f531';
  v_exec3 uuid := '00000000-0000-0000-0000-00000000f532';
  v_exec4 uuid := '00000000-0000-0000-0000-00000000f533';
  v_doc  uuid := '00000000-0000-0000-0000-00000000f540';
  completed int; consumed int; event_written int; provenance_ok int;
  again jsonb; events_after int; consumptions_after int;
  submitted_refused int := 0; rejected_refused int := 0; no_fact_refused int := 0;
  version_recorded int; doc_consumed int;
  cons_update_refused int := 0; cons_delete_refused int := 0;
  rb_state text; rb_consumptions int;
  b_sees int; portal_sees int;
  v_cons uuid;
begin
  perform set_config('role', 'postgres', true);

  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
  values (v_file, '00000000-0000-0000-0000-000000000001', 'W5-TEST-0001', 'IMP',
          '00000000-0000-0000-0000-0000000000cd', 'IN_PROGRESS');
  insert into public.process_instance (id, tenant_id, file_id)
  values (v_inst, '00000000-0000-0000-0000-000000000001', v_file);
  insert into public.process_step_execution (id, tenant_id, process_instance_id, step_key, state) values
    (v_exec,  '00000000-0000-0000-0000-000000000001', v_inst, 'transport_pod_handoff', 'ACTIVE'),
    (v_exec2, '00000000-0000-0000-0000-000000000001', v_inst, 'transit_validation', 'SUBMITTED'),
    (v_exec3, '00000000-0000-0000-0000-000000000001', v_inst, 'customs_preparation', 'REJECTED'),
    (v_exec4, '00000000-0000-0000-0000-000000000001', v_inst, 'pickup', 'AVAILABLE');

  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by,
                               status, version, content_sha256)
  values (v_doc, '00000000-0000-0000-0000-000000000001', v_file, 'DELIVERY_NOTE',
          'w5/pod.pdf', '00000000-0000-0000-0000-00000000f001', 'VERIFIED', 3, 'hash-pod-v3');

  -- ---------------------------------------------------- atomic completion
  perform public.reconcile_step_completion(
    v_exec, '00000000-0000-0000-0000-000000000001', 'POD_RECEIVED',
    '00000000-0000-0000-0000-00000000f001', v_doc, null, false);

  select count(*) into completed from public.process_step_execution
   where id = v_exec and state = 'COMPLETED';
  select count(*) into consumed from public.evidence_consumption
   where step_execution_id = v_exec and document_id = v_doc;
  select count(*) into event_written from public.business_event
   where subject_id = v_exec and event_type = 'PROCESS_STEP_COMPLETED';
  select count(*) into provenance_ok from public.process_step_execution
   where id = v_exec and completion_provenance = 'RECONCILED'
     and reconciled_fact = 'POD_RECEIVED';

  -- WES-5D: the EXACT version and hash.
  select count(*) into version_recorded from public.evidence_consumption
   where step_execution_id = v_exec and document_version = 3
     and content_sha256 = 'hash-pod-v3';
  select count(*) into doc_consumed from public.document
   where id = v_doc and status = 'CONSUMED_AS_EVIDENCE';

  -- ---------------------------------------------------------- idempotency
  select public.reconcile_step_completion(
    v_exec, '00000000-0000-0000-0000-000000000001', 'POD_RECEIVED',
    '00000000-0000-0000-0000-00000000f001', v_doc, null, false) into again;
  select count(*) into events_after from public.business_event
   where subject_id = v_exec and event_type = 'PROCESS_STEP_COMPLETED';
  select count(*) into consumptions_after from public.evidence_consumption
   where step_execution_id = v_exec;

  -- -------------------------------------------------------------- refusals
  begin
    perform public.reconcile_step_completion(
      v_exec2, '00000000-0000-0000-0000-000000000001', 'ANY_FACT', null, null, null, false);
  exception when others then submitted_refused := 1;
  end;
  begin
    perform public.reconcile_step_completion(
      v_exec3, '00000000-0000-0000-0000-000000000001', 'ANY_FACT', null, null, null, false);
  exception when others then rejected_refused := 1;
  end;
  begin
    perform public.reconcile_step_completion(
      v_exec4, '00000000-0000-0000-0000-000000000001', '  ', null, null, null, false);
  exception when others then no_fact_refused := 1;
  end;

  -- ----------------------------------------------------- consumption frozen
  select id into v_cons from public.evidence_consumption where step_execution_id = v_exec;
  begin
    update public.evidence_consumption set content_sha256 = 'tampered' where id = v_cons;
  exception when others then cons_update_refused := 1;
  end;
  begin
    delete from public.evidence_consumption where id = v_cons;
  exception when others then cons_delete_refused := 1;
  end;

  -- ------------------------------------------- failed event rolls back ALL
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$ begin raise exception 'ledger unavailable'; end; $body$;
  $fn$;

  begin
    perform public.reconcile_step_completion(
      v_exec4, '00000000-0000-0000-0000-000000000001', 'TRANSPORT_PICKED_UP',
      '00000000-0000-0000-0000-00000000f001', v_doc, null, false);
  exception when others then null;
  end;

  select state into rb_state from public.process_step_execution where id = v_exec4;
  select count(*) into rb_consumptions from public.evidence_consumption
   where step_execution_id = v_exec4;

  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$
    declare v_id uuid;
    begin
      insert into public.business_event (
        tenant_id, event_type, event_domain, event_version, source,
        dossier_id, subject_type, subject_id, actor_user_id,
        correlation_id, causation_id, metadata)
      values (
        p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
        p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
        p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb))
      returning id into v_id;
      return v_id;
    end; $body$;
  $fn$;

  -- ---------------------------------------------------------------- isolation
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000f002','role','authenticated')::text, true);
  select count(*) into b_sees from public.evidence_consumption where file_id = v_file;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000f003','role','authenticated')::text, true);
  select count(*) into portal_sees from public.evidence_consumption;
  perform set_config('role', 'postgres', true);

  raise notice 'WES-5: done=% cons=% event=% prov=% again=% ev_after=% cons_after=% sub=% rej=% nofact=% ver=% docCons=% updRef=% delRef=% rb=% rbcons=% b=% p=%',
    completed, consumed, event_written, provenance_ok, again->>'already', events_after,
    consumptions_after, submitted_refused, rejected_refused, no_fact_refused,
    version_recorded, doc_consumed, cons_update_refused, cons_delete_refused,
    rb_state, rb_consumptions, b_sees, portal_sees;

  insert into _r values
    ('step_completed_atomically', completed),
    ('evidence_consumed', consumed),
    ('event_emitted', event_written),
    ('provenance_reconciled', provenance_ok),
    ('rerun_no_new_event', events_after),
    ('rerun_no_new_consumption', consumptions_after),
    ('submitted_refused', submitted_refused),
    ('rejected_refused', rejected_refused),
    ('empty_fact_refused', no_fact_refused),
    ('exact_version_recorded', version_recorded),
    ('document_marked_consumed', doc_consumed),
    ('consumption_update_refused', cons_update_refused),
    ('consumption_delete_refused', cons_delete_refused),
    ('failed_event_rolls_back_consumption', rb_consumptions),
    ('cross_tenant_sees', b_sees),
    ('portal_sees', portal_sees);

  if completed <> 1 or consumed <> 1 or event_written <> 1 or provenance_ok <> 1
     or (again->>'already') is distinct from 'true'
     or events_after <> 1 or consumptions_after <> 1
     or submitted_refused <> 1 or rejected_refused <> 1 or no_fact_refused <> 1
     or version_recorded <> 1 or doc_consumed <> 1
     or cons_update_refused <> 1 or cons_delete_refused <> 1
     or rb_state <> 'AVAILABLE' or rb_consumptions <> 0
     or b_sees <> 0 or portal_sees <> 0
  then
    raise exception 'RLS WES-5 FAIL — see the NOTICE line above for every value';
  end if;
end $$;

select * from _r order by check_name;
rollback;
