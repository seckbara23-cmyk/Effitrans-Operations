-- 20260727000001_business_event_atomicity.sql
-- Effitrans Operations Platform — PHASE WES-9A: mandatory-event atomicity.
-- ---------------------------------------------------------------------------
-- CORRECTS A DEFECT IN 20260726000004. No schema change; the seven emission
-- functions are replaced in place.
--
-- WHAT WAS WRONG. Migration 62 wrapped every emission in
--
--     exception when others then
--       raise warning '...'; return null;
--
-- so a failed ledger append was downgraded to a log line and the domain write
-- COMMITTED ANYWAY. That is Model B (best-effort timeline), and it contradicts
-- ADR-WES-014 / WES-0A, which ratified that a domain fact and its mandatory
-- business event succeed or fail TOGETHER. The prior migration's own header
-- called this "the one place the same-transaction guarantee is deliberately
-- relaxed" — but the guarantee was not the implementation's to relax.
--
-- WHY THIS IS A NEW MIGRATION rather than an edit to 62. Migration 62 has
-- already been replayed by CI, and this repository has a known history gap
-- between the CLI migration ledger and the deployed schema (Phase 9.0F), so no
-- environment's applied state can be asserted from here. Editing an applied
-- migration is unsafe; `create or replace function` is idempotent and correct
-- whether or not 62 ran. Migration 62 stays as the historical record of what
-- was shipped.
--
-- ===========================================================================
-- MODEL A — STRICT MANDATORY-EVENT ATOMICITY (ratified, DEC-B75)
-- ===========================================================================
-- Every event this platform emits is MANDATORY: each one records a committed
-- business fact that the operational history would be wrong without. There are
-- NO observational or telemetry events in this ledger, and none may be added —
-- if a signal is not worth aborting the business action for, it does not
-- belong here. Page views, downloads, notification delivery and UI interaction
-- are outside this ledger entirely and keep whatever best-effort mechanism
-- they already use.
--
-- Therefore: an emission failure ABORTS THE DOMAIN MUTATION. An AFTER trigger
-- that raises aborts the statement and its transaction, so the domain row and
-- the event are committed together or not at all.
--
-- THE HANDLER BELOW DOES NOT SWALLOW. It logs the underlying cause for
-- operators (which would otherwise be lost) and then RE-RAISES, so the
-- transaction still aborts. The re-raise carries a stable application error
-- code and a message safe to surface to a user — a raw constraint or plpgsql
-- error would otherwise reach the client through PostgREST. Removing the
-- handler entirely would also roll back correctly; it exists ONLY to sanitize
-- the message and preserve the diagnostic, never to permit the write.
--
-- SQLSTATE 'EF001' is in a user-defined class, so application code can
-- recognise a ledger failure without string-matching.

-- ===========================================================================
-- 1. operational_file
-- ===========================================================================
create or replace function public.emit_dossier_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'DOSSIER_OPENED', 'dossier', 'db_trigger',
      'operational_file', new.id, new.id, new.created_by,
      jsonb_build_object('file_number', new.file_number, 'file_type', new.type));

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'DOSSIER_STATUS_CHANGED', 'dossier', 'db_trigger',
      'operational_file', new.id, new.id, null,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'CLOSED' then
      perform public.emit_business_event(
        new.tenant_id, 'DOSSIER_CLOSED', 'dossier', 'db_trigger',
        'operational_file', new.id, new.id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on operational_file (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 2. document
-- ===========================================================================
create or replace function public.emit_document_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'DOCUMENT_UPLOADED', 'document', 'db_trigger',
      'document', new.id, new.file_id, new.uploaded_by,
      jsonb_build_object('type_code', new.type_code));

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'APPROVED' then
      perform public.emit_business_event(
        new.tenant_id, 'DOCUMENT_VERIFIED', 'document', 'db_trigger',
        'document', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('type_code', new.type_code,
                           'previous_status', old.status, 'new_status', new.status));
    elsif new.status = 'REJECTED' then
      -- review_note is deliberately NOT copied: free text about a person's
      -- work, unredactable here forever.
      perform public.emit_business_event(
        new.tenant_id, 'DOCUMENT_REJECTED', 'document', 'db_trigger',
        'document', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('type_code', new.type_code,
                           'previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on document (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 3. customs_record
-- ===========================================================================
create or replace function public.emit_customs_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_RECORD_CREATED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.created_by,
      jsonb_build_object('required', new.required));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_STATUS_CHANGED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'DECLARED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_DECLARED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.declaration_number));
    elsif new.status = 'RELEASED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_RELEASE_COMPLETED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.bae_reference));
    end if;
  end if;

  -- BAE is its own milestone and does not always coincide with a status move.
  if new.bae_reference is not null and old.bae_reference is null then
    perform public.emit_business_event(
      new.tenant_id, 'BAE_RECORDED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('reference', new.bae_reference));
  end if;

  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on customs_record (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 4. transport_record
-- ===========================================================================
create or replace function public.emit_transport_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_milestone text;
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'TRANSPORT_PLANNING_CREATED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.created_by, '{}'::jsonb);
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'TRANSPORT_STATUS_CHANGED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    v_milestone := case new.status
      when 'PLANNED'      then 'TRANSPORT_PLANNED'
      when 'PICKED_UP'    then 'PICKUP_CONFIRMED'
      when 'IN_TRANSIT'   then 'TRANSPORT_STARTED'
      when 'DELIVERED'    then 'DELIVERY_COMPLETED'
      when 'POD_RECEIVED' then 'POD_RECEIVED'
      else null
    end;

    if v_milestone is not null then
      perform public.emit_business_event(
        new.tenant_id, v_milestone, 'transport', 'db_trigger',
        'transport_record', new.id, new.file_id, new.assigned_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;

  if new.driver_name is not null and old.driver_name is null then
    perform public.emit_business_event(
      new.tenant_id, 'DRIVER_ASSIGNED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by, '{}'::jsonb);
  elsif new.driver_name is null and old.driver_name is not null then
    perform public.emit_business_event(
      new.tenant_id, 'DRIVER_UNASSIGNED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by, '{}'::jsonb);
  end if;

  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on transport_record (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 5. task
-- ===========================================================================
create or replace function public.emit_task_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'TASK_CREATED', 'task', 'db_trigger',
      'task', new.id, new.file_id, new.created_by,
      jsonb_build_object('priority', new.priority));

  elsif new.status is distinct from old.status then
    -- actor NULL: `task` records assigned_to and created_by, but not who marked
    -- it done. Naming the assignee would be an inference, not a fact.
    if new.status = 'DONE' then
      perform public.emit_business_event(
        new.tenant_id, 'TASK_COMPLETED', 'task', 'db_trigger',
        'task', new.id, new.file_id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    elsif new.status = 'CANCELLED' then
      perform public.emit_business_event(
        new.tenant_id, 'TASK_CANCELLED', 'task', 'db_trigger',
        'task', new.id, new.file_id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on task (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 6. invoice / payment
-- ===========================================================================
create or replace function public.emit_finance_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'invoice' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'ISSUED' then
      perform public.emit_business_event(
        new.tenant_id, 'INVOICE_ISSUED', 'finance', 'db_trigger',
        'invoice', new.id, new.file_id, new.issued_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;

  elsif tg_table_name = 'payment' and tg_op = 'INSERT' then
    -- The AMOUNT is not copied. `payment` stays the authority on money; an
    -- immutable second copy could drift from it and could never be corrected.
    perform public.emit_business_event(
      new.tenant_id, 'PAYMENT_RECORDED', 'finance', 'db_trigger',
      'payment', new.id,
      (select i.file_id from public.invoice i where i.id = new.invoice_id),
      new.recorded_by,
      jsonb_build_object('method', new.method));
  end if;
  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on % (%): %', tg_table_name, new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ===========================================================================
-- 7. emit_business_event — unchanged contract, corrected documentation.
--
--    Migration 62's header claimed an unknown event type was "unwritable —
--    enforced by emit_business_event()". It was not: the function never checked
--    the type. The claim is withdrawn rather than papered over with a SQL copy
--    of the TypeScript registry, which would be exactly the second source of
--    truth WES-7 spent a phase removing. The real enforcement is a build-time
--    test that extracts every event-type literal emitted by these migrations
--    and asserts each one exists in lib/workflow/events/types.ts and is not
--    reserved — see tests/business-events.test.ts.
--
--    The function is REPLACED here only to add the same sanitized failure
--    contract, so an envelope violation reaches the caller as EF001 rather than
--    as raw plpgsql text.
-- ===========================================================================
create or replace function public.emit_business_event(
  p_tenant_id      uuid,
  p_event_type     text,
  p_event_domain   text,
  p_source         text,
  p_subject_type   text,
  p_subject_id     uuid    default null,
  p_dossier_id     uuid    default null,
  p_actor_user_id  uuid    default null,
  p_metadata       jsonb   default '{}'::jsonb,
  p_causation_id   uuid    default null,
  p_event_version  int     default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id           uuid;
  v_policy_id    uuid;
  v_provenance   text;
begin
  -- Fail closed on a structurally invalid envelope. This RAISES; it is a
  -- programming error, and under Model A it must abort the domain write.
  if p_tenant_id is null or p_event_type is null or p_source is null
     or p_event_domain is null or p_subject_type is null then
    raise exception
      'Enregistrement impossible : journal opérationnel invalide. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
  end if;

  -- WES-9G: record which policy governed the dossier at the moment of the fact.
  -- Best-effort by design — a dossier with no process instance simply has no
  -- governing version, and that is recorded as NULL rather than guessed.
  if p_dossier_id is not null then
    select pi.policy_version_id, pi.policy_provenance
      into v_policy_id, v_provenance
      from public.process_instance pi
     where pi.file_id = p_dossier_id
     order by pi.created_at desc
     limit 1;
  end if;

  insert into public.business_event (
    tenant_id, event_type, event_domain, event_version, source,
    dossier_id, subject_type, subject_id, actor_user_id,
    correlation_id, causation_id, metadata,
    policy_version_id, policy_provenance
  ) values (
    p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
    p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
    -- The dossier IS the business thread (WES-9F).
    p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb),
    v_policy_id, v_provenance
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.emit_business_event(
  uuid, text, text, text, text, uuid, uuid, uuid, jsonb, uuid, int) from public;
