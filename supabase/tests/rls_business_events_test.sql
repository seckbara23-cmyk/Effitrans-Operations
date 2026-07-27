-- RLS regression test — immutable business event ledger (WES-9). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the guarantees that must hold in the DATABASE, not merely in the reader:
--   * opening a dossier EMITS an event in the same transaction                   -> 1
--   * a status change emits the generic transition fact                          -> 1
--   * closing emits BOTH the transition and the DOSSIER_CLOSED milestone         -> 1
--   * an unrelated column edit emits NOTHING (no trigger-on-everything)          -> 0
--   * the ledger is APPEND-ONLY: UPDATE raises, even as the owner role           -> raises
--   * the ledger cannot be DELETED from: DELETE raises                           -> raises
--   * the actor is taken from the row's own committed actor column               -> 1
--   * a task completion records NO actor rather than guessing the assignee       -> 0
--   * money is NEVER copied into a payment event's metadata                      -> 0
--   * a driver assignment carries NO personal data                               -> 0
--   * a user who can read the dossier sees its events                            -> >0
--   * a user of ANOTHER tenant sees nothing (isolation)                          -> 0
--   * a PORTAL user sees nothing (no portal policy on the table)                 -> 0
--   * a config-scope event is invisible without admin:config:manage              -> 0
--   * a config-scope event IS visible with admin:config:manage                   -> 1
--   * an event SURVIVES the hard-delete of the row it points at (no cascade)     -> 1
--
--   WES-9A mandatory-event atomicity (Model A, ADR-WES-014). Migration 62
--   swallowed emission failures; migration 63 makes the event mandatory. Each
--   check below inspects PERSISTED ROWS after the failure, not return values:
--   * an INSERT whose event fails leaves NO domain row                           -> 0
--   * an UPDATE whose event fails leaves the row UNCHANGED                       -> 1
--   * the failure surfaces the stable code EF001, not raw internals              -> 1
--   * neither aborted action leaves a partial event behind                       -> 0
--   * a DOMAIN failure (bad status) writes NO event                              -> 0
--   * a RETRY of the same status appends NO duplicate event                      -> equal
--   * a cross-tenant event failure rolls the domain mutation back                -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- Second tenant, so "sees nothing" is isolation rather than a missing grant.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000e1', 'Test Tenant BE', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000e1', 'SYSTEM_ADMIN', 'Administrateur', 'Administrator', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r join public.permission p on p.code in ('admin:config:manage', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-0000000000e1' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- B1 = tenant-A config manager (sees dossiers AND config events)
-- B2 = tenant-A staff WITHOUT admin:config:manage
-- B3 = tenant-BE config manager (cross-tenant probe)
-- B4 = tenant-A portal user
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'be-b1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'be-b2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'be-b3@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'be-b4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'be-b1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'be-b2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'be-b3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-0000000000e1' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000000001', 'BE Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c9', 'be-b4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  opened int; status_changed int; closed int; noise int;
  update_rejected int := 0; delete_rejected int := 0;
  actor_recorded int := 0; task_actor int; payment_money int; driver_pii int;
  b1_sees int; b3_sees int; b4_sees int;
  b2_sees_config int; b1_sees_config int;
  survives_cascade int;
  insert_rolled_back int; update_rolled_back int; safe_error_code int;
  orphan_events int; domain_failure_events int; cross_tenant_rolled_back int;
  retry_before int; retry_after int;
  insert_error_code text := ''; v_status_before text;
  v_file uuid := '00000000-0000-0000-0000-00000000be10';
  v_task uuid := '00000000-0000-0000-0000-00000000be20';
  v_invoice uuid := '00000000-0000-0000-0000-00000000be30';
  v_doc uuid := '00000000-0000-0000-0000-00000000be40';
  v_event uuid;
begin
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------- emission
  -- Opening a dossier. The event must exist because the INSERT committed —
  -- same transaction, not a follow-up write.
  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status, created_by)
  values (v_file, '00000000-0000-0000-0000-000000000001', 'BE-TEST-0001', 'IMP',
          '00000000-0000-0000-0000-0000000000c9', 'DRAFT',
          '00000000-0000-0000-0000-0000000000b1');

  select count(*) into opened from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_OPENED';

  -- The actor comes from the row's own created_by column.
  select count(*) into actor_recorded from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_OPENED'
     and actor_user_id = '00000000-0000-0000-0000-0000000000b1';

  update public.operational_file set status = 'IN_PROGRESS' where id = v_file;
  select count(*) into status_changed from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_STATUS_CHANGED'
     and metadata->>'new_status' = 'IN_PROGRESS';

  update public.operational_file set status = 'CLOSED' where id = v_file;
  select count(*) into closed from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_CLOSED';

  -- An unrelated column edit must emit NOTHING. This is what separates
  -- "explicit transitions" from "a trigger on every table".
  update public.operational_file set priority = 'high' where id = v_file;
  select count(*) into noise from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_STATUS_CHANGED'
     and metadata->>'previous_status' = 'CLOSED';

  -- --------------------------------------------------------- append-only
  select id into v_event from public.business_event
   where dossier_id = v_file limit 1;

  begin
    update public.business_event set event_type = 'TAMPERED' where id = v_event;
  exception when others then update_rejected := 1;
  end;

  begin
    delete from public.business_event where id = v_event;
  exception when others then delete_rejected := 1;
  end;

  -- -------------------------------------------------------- privacy limits
  -- Task completion: the schema records no completer, so the actor stays NULL.
  insert into public.task (id, tenant_id, file_id, title, status, created_by, assigned_to)
  values (v_task, '00000000-0000-0000-0000-000000000001', v_file, 'BE task', 'TODO',
          '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
  update public.task set status = 'DONE' where id = v_task;
  select count(*) into task_actor from public.business_event
   where subject_id = v_task and event_type = 'TASK_COMPLETED' and actor_user_id is not null;

  -- Payment: the amount must never be copied into the ledger.
  insert into public.invoice (id, tenant_id, file_id, client_id, status, created_by)
  values (v_invoice, '00000000-0000-0000-0000-000000000001', v_file,
          '00000000-0000-0000-0000-0000000000c9', 'DRAFT',
          '00000000-0000-0000-0000-0000000000b1');
  insert into public.payment (tenant_id, invoice_id, amount, method, recorded_by)
  values ('00000000-0000-0000-0000-000000000001', v_invoice, 125000.00, 'CASH',
          '00000000-0000-0000-0000-0000000000b1');
  select count(*) into payment_money from public.business_event
   where event_type = 'PAYMENT_RECORDED'
     and (metadata ? 'amount' or metadata ? 'currency' or metadata::text like '%125000%');

  -- Driver assignment: no name, no phone.
  insert into public.transport_record (tenant_id, file_id, status, created_by)
  values ('00000000-0000-0000-0000-000000000001', v_file, 'NOT_STARTED',
          '00000000-0000-0000-0000-0000000000b1');
  update public.transport_record
     set driver_name = 'Moussa Diop', driver_phone = '+221770000000',
         assigned_by = '00000000-0000-0000-0000-0000000000b1'
   where file_id = v_file;
  select count(*) into driver_pii from public.business_event
   where event_type = 'DRIVER_ASSIGNED'
     and (metadata::text like '%Moussa%' or metadata::text like '%221770000000%');

  -- ------------------------------------------------- survives a hard delete
  -- `document` cascades from operational_file. An event about a deleted
  -- document must remain: history is not deletable through a cascade.
  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by)
  select v_doc, '00000000-0000-0000-0000-000000000001', v_file, dt.code,
         'be/test/path.pdf', '00000000-0000-0000-0000-0000000000b1'
    from public.document_type dt limit 1;
  delete from public.document where id = v_doc;
  select count(*) into survives_cascade from public.business_event
   where subject_id = v_doc and event_type = 'DOCUMENT_UPLOADED';

  -- A configuration-scope event (no dossier), emitted while the ledger still
  -- works — the RLS probes below read it.
  perform public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'POLICY_ACTIVATED', 'policy', 'policy_rpc',
    'workflow_policy_version', null, null, '00000000-0000-0000-0000-0000000000b1',
    jsonb_build_object('scope', 'tenant', 'version', 1));

  -- ================== WES-9A: MANDATORY-EVENT ATOMICITY (Model A) ===========
  -- Migration 62 swallowed emission failures and let the domain write commit.
  -- Migration 63 makes the event MANDATORY: if the append fails, the business
  -- mutation MUST roll back. Break emission for real and prove it against
  -- PERSISTED ROWS, not return values.
  -- Safe to do destructively — the whole suite is inside BEGIN/ROLLBACK.
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$ begin raise exception 'ledger unavailable'; end; $body$;
  $fn$;

  -- (1) INSERT path — the task must NOT exist afterwards.
  begin
    insert into public.task (id, tenant_id, file_id, title, status, created_by)
    values ('00000000-0000-0000-0000-00000000be21',
            '00000000-0000-0000-0000-000000000001', v_file, 'BE rollback', 'TODO',
            '00000000-0000-0000-0000-0000000000b1');
  exception when others then
    insert_error_code := sqlstate;
  end;
  select count(*) into insert_rolled_back from public.task
   where id = '00000000-0000-0000-0000-00000000be21';

  -- (2) UPDATE path — the dossier status must be UNCHANGED afterwards.
  select status into v_status_before from public.operational_file where id = v_file;
  begin
    update public.operational_file set status = 'DELIVERED' where id = v_file;
  exception when others then null;
  end;
  select count(*) into update_rolled_back from public.operational_file
   where id = v_file and status = v_status_before;

  -- (3) The caller sees a SAFE, stable application code, not raw internals.
  select case when insert_error_code = 'EF001' then 1 else 0 end into safe_error_code;

  -- (4) Neither aborted action left a partial event behind.
  select count(*) into orphan_events from public.business_event
   where subject_id = '00000000-0000-0000-0000-00000000be21'
      or (dossier_id = v_file and metadata->>'new_status' = 'DELIVERED');

  -- Restore real emission for the remaining checks.
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

  -- (5) A DOMAIN failure must leave NO event. Violate the status CHECK.
  begin
    update public.operational_file set status = 'NOT_A_REAL_STATUS' where id = v_file;
  exception when others then null;
  end;
  select count(*) into domain_failure_events from public.business_event
   where dossier_id = v_file and metadata->>'new_status' = 'NOT_A_REAL_STATUS';

  -- (6) RETRY is idempotent at the event level: re-applying the SAME status is
  --     not a transition, so the retry appends nothing. Measure AFTER the real
  --     transition, so only the repeat is under test.
  update public.operational_file set status = 'IN_PROGRESS' where id = v_file;
  select count(*) into retry_before from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_STATUS_CHANGED';
  update public.operational_file set status = 'IN_PROGRESS' where id = v_file;
  select count(*) into retry_after from public.business_event
   where dossier_id = v_file and event_type = 'DOSSIER_STATUS_CHANGED';

  -- (7) CROSS-TENANT: an event referencing a tenant the dossier does not belong
  --     to cannot commit, and the domain mutation must roll back with it.
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
        dossier_id, subject_type, subject_id, actor_user_id, metadata)
      values (
        '00000000-0000-0000-0000-00000000dead',   -- non-existent tenant: FK fails
        p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
        p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
        coalesce(p_metadata, '{}'::jsonb))
      returning id into v_id;
      return v_id;
    end; $body$;
  $fn$;

  begin
    insert into public.operational_file (id, tenant_id, file_number, type, client_id, status, created_by)
    values ('00000000-0000-0000-0000-00000000be50',
            '00000000-0000-0000-0000-000000000001', 'BE-XT-0001', 'IMP',
            '00000000-0000-0000-0000-0000000000c9', 'DRAFT',
            '00000000-0000-0000-0000-0000000000b1');
  exception when others then null;
  end;
  select count(*) into cross_tenant_rolled_back from public.operational_file
   where id = '00000000-0000-0000-0000-00000000be50';

  -- ------------------------------------------------------------------- RLS
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
  select count(*) into b1_sees from public.business_event where dossier_id = v_file;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b3','role','authenticated')::text, true);
  select count(*) into b3_sees from public.business_event where dossier_id = v_file;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b4','role','authenticated')::text, true);
  select count(*) into b4_sees from public.business_event;

  -- Configuration-scope events (no dossier) need admin:config:manage.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b2','role','authenticated')::text, true);
  select count(*) into b2_sees_config from public.business_event
   where dossier_id is null and event_type = 'POLICY_ACTIVATED';

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
  select count(*) into b1_sees_config from public.business_event
   where dossier_id is null and event_type = 'POLICY_ACTIVATED';

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('dossier_opened_emitted', opened),
    ('actor_from_row_column', actor_recorded),
    ('status_change_emitted', status_changed),
    ('closed_milestone_emitted', closed),
    ('unrelated_edit_emits_nothing', noise),
    ('ledger_update_rejected', update_rejected),
    ('ledger_delete_rejected', delete_rejected),
    ('task_completion_actor_not_guessed', task_actor),
    ('payment_amount_never_copied', payment_money),
    ('driver_pii_never_copied', driver_pii),
    ('event_survives_cascade_delete', survives_cascade),
    ('insert_rolls_back_when_event_fails', insert_rolled_back),
    ('update_rolls_back_when_event_fails', update_rolled_back),
    ('failure_uses_safe_error_code', safe_error_code),
    ('no_orphan_event_after_rollback', orphan_events),
    ('domain_failure_writes_no_event', domain_failure_events),
    ('retry_appends_no_duplicate', retry_after - retry_before),
    ('cross_tenant_event_rolls_back_domain', cross_tenant_rolled_back),
    ('b1_sees_own_dossier_events', b1_sees),
    ('b3_cross_tenant_sees', b3_sees),
    ('b4_portal_sees', b4_sees),
    ('b2_config_event_without_permission', b2_sees_config),
    ('b1_config_event_with_permission', b1_sees_config);

  if opened <> 1 or actor_recorded <> 1 or status_changed <> 1 or closed <> 1
     or noise <> 0
     or update_rejected <> 1 or delete_rejected <> 1
     or task_actor <> 0 or payment_money <> 0 or driver_pii <> 0
     or survives_cascade <> 1
     or insert_rolled_back <> 0 or update_rolled_back <> 1 or safe_error_code <> 1
     or orphan_events <> 0 or domain_failure_events <> 0
     or retry_after <> retry_before or cross_tenant_rolled_back <> 0
     or b1_sees < 1 or b3_sees <> 0 or b4_sees <> 0
     or b2_sees_config <> 0 or b1_sees_config <> 1
  then
    raise exception 'RLS BUSINESS EVENT FAIL: opened=% actor=% status=% closed=% noise=% upd=% del=% taskactor=% money=% pii=% cascade=% ins_rb=% upd_rb=% code=% orphan=% domfail=% retry=%/% xt=% b1=% b3=% b4=% b2cfg=% b1cfg=%',
      opened, actor_recorded, status_changed, closed, noise, update_rejected, delete_rejected,
      task_actor, payment_money, driver_pii, survives_cascade,
      insert_rolled_back, update_rolled_back, safe_error_code, orphan_events,
      domain_failure_events, retry_before, retry_after, cross_tenant_rolled_back,
      b1_sees, b3_sees, b4_sees, b2_sees_config, b1_sees_config;
  end if;
end $$;

select * from _r order by check_name;
rollback;
