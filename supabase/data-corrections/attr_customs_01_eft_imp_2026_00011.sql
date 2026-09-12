-- ATTR-CUSTOMS-01 — PRODUCTION DATA CORRECTION for EFT-IMP-2026-00011.
-- ===========================================================================
-- NOT A MIGRATION. It lives outside supabase/migrations on purpose: a schema
-- migration replays in CI and on every fresh database, where this dossier does
-- not exist. This is a one-time, operator-run act, applied only on explicit
-- approval:
--
--   npx supabase db query --linked -f supabase/data-corrections/attr_customs_01_eft_imp_2026_00011.sql
--
-- Read-only rehearsal first:
--   npx supabase db query --linked -f supabase/data-corrections/attr_customs_01_eft_imp_2026_00011.preflight.sql
--
-- WHAT IT REPAIRS. `record_customs_release` (pre-ATTR-CUSTOMS-01) wrote
-- `reviewed_by = <the field agent who finalised the release>` over the Chef de
-- Transit who validated step 7. This restores that one column to the step 7
-- validator. Nothing else on the record changes — not `reviewed_at`, the BAE,
-- the Chef's release approval, RELEASED, the release date, step 13, the process
-- or dossier ownership, or transport.
--
-- HOW IT FAILS CLOSED. ONE statement, so the executor runs it as one atomic
-- transaction: any `raise` below rolls back everything, including the trigger
-- toggle. Before writing, the validator is RE-DERIVED from two immutable
-- sources (business_event and audit_log are both mutation-blocked by trigger)
-- and must agree with the identity pinned from the preflight. The defect must
-- still be present exactly as diagnosed. The UPDATE must hit exactly one row.
-- Afterwards every other column must be byte-identical, and the ledger must
-- not have grown by a single event.
--
-- WHY NO FALSE EVENT CAN BE MANUFACTURED. `emit_customs_events` — in BOTH the
-- live pre-ATTR version and the ATTR-CUSTOMS-01 version — emits on UPDATE only
-- when `status` changes, or when `bae_reference` goes from NULL to a value. This
-- UPDATE changes neither, so the trigger runs and emits nothing. That is not
-- merely argued: postcondition 3 counts the ledger and aborts on any growth,
-- and supabase/tests/attr_customs_01_attribution_test.sql runs this very file
-- under both trigger versions.
--
-- WHY `trg_customs_updated_at` IS SUSPENDED FOR THIS ONE UPDATE. `updated_at`
-- is not a bookkeeping column here: lib/sla/stage-duration.ts reads it as the
-- customs stage timestamp. Letting it jump to the correction time would move
-- 00011's customs stage end to today — rewriting an SLA measurement to repair an
-- attribution. The suspension is inside the same transaction (DDL is
-- transactional in PostgreSQL), holds a lock that blocks concurrent writers to
-- customs_record for its few milliseconds, and is proven re-enabled before
-- commit. The event trigger and the tenant trigger stay ACTIVE throughout.
--
-- THE TRACE. One audit_log row, actor NULL (an operator correction is not a
-- platform user's act, and no identity is borrowed for it), naming both
-- provenance rows it relied on.
-- ===========================================================================
do $attr$
declare
  -- The target, as read from production by the preflight. Every identity is
  -- re-derived below; a pinned value that provenance does not confirm aborts.
  c_tenant     constant uuid := '00000000-0000-0000-0000-000000000001';
  c_file       constant uuid := '7f8e6fb8-aafd-4932-b87a-b34cdca177f3';
  c_file_no    constant text := 'EFT-IMP-2026-00011';
  c_customs    constant uuid := '91d80919-8aaa-43cb-a5d3-24002b72850b';
  -- The step 7 validator (Chef de Transit), per CUSTOMS_VALIDATED + audit_log.
  c_validator  constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167';
  -- The identity record_customs_release wrote over it (the release finaliser).
  c_overwriter constant uuid := '38ff054a-2a14-4f65-bb5a-1902050bc48f';

  v_rec           public.customs_record%rowtype;
  v_before        jsonb;
  v_after         jsonb;
  v_n             bigint;
  v_event_id      uuid;
  v_event_actor   uuid;
  v_event_at      timestamptz;
  v_audit_id      uuid;
  v_release_actor uuid;
  v_events_before bigint;
  v_events_after  bigint;
  v_audit_before  bigint;
begin
  -- ---- PRECONDITION 1. The dossier is the one named. -----------------------
  select count(*) into v_n from public.operational_file
   where id = c_file and tenant_id = c_tenant and file_number = c_file_no;
  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: dossier % is not % in tenant %', c_file, c_file_no, c_tenant;
  end if;

  -- ---- PRECONDITION 2. The customs record, locked. -------------------------
  select * into v_rec from public.customs_record
   where id = c_customs and tenant_id = c_tenant and file_id = c_file and deleted_at is null
     for update;
  if not found then
    raise exception 'ATTR-CUSTOMS-01 refused: customs record % is not the live record of %', c_customs, c_file_no;
  end if;
  v_before := to_jsonb(v_rec);

  -- ---- PROVENANCE A. The ledger names exactly one step 7 validation. -------
  select count(*) into v_n from public.business_event
   where tenant_id = c_tenant and subject_type = 'customs_record' and subject_id = c_customs
     and event_type = 'CUSTOMS_VALIDATED';
  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: expected exactly one CUSTOMS_VALIDATED event, found %', v_n;
  end if;
  select id, actor_user_id, occurred_at into v_event_id, v_event_actor, v_event_at
    from public.business_event
   where tenant_id = c_tenant and subject_type = 'customs_record' and subject_id = c_customs
     and event_type = 'CUSTOMS_VALIDATED';
  if v_event_actor is distinct from c_validator then
    raise exception 'ATTR-CUSTOMS-01 refused: the ledger names % as validator, the preflight named %', v_event_actor, c_validator;
  end if;
  -- The record's own validation instant is that event's instant (same
  -- transaction in record_customs_validation) — the event IS this validation.
  if v_event_at is distinct from v_rec.reviewed_at then
    raise exception 'ATTR-CUSTOMS-01 refused: reviewed_at % is not the CUSTOMS_VALIDATED instant %', v_rec.reviewed_at, v_event_at;
  end if;

  -- Nothing LEGITIMATELY replaced that validator since: a governed correction
  -- clears it and a recertification rewrites it, and either would make the
  -- current value a question for a human, not for this script.
  select count(*) into v_n from public.business_event
   where tenant_id = c_tenant and subject_type = 'customs_record' and subject_id = c_customs
     and event_type in ('CUSTOMS_CORRECTED', 'CUSTOMS_REVALIDATED');
  if v_n <> 0 then
    raise exception 'ATTR-CUSTOMS-01 refused: % correction/revalidation events exist on this record', v_n;
  end if;
  select count(*) into v_n from public.customs_correction where customs_id = c_customs;
  if v_n <> 0 then
    raise exception 'ATTR-CUSTOMS-01 refused: % governed corrections exist on this record', v_n;
  end if;

  -- ---- PROVENANCE B. The validating action's own audit row agrees. ---------
  select count(*) into v_n from public.audit_log
   where tenant_id = c_tenant and entity = 'customs_record' and entity_id = c_customs
     and action = 'customs.updated' and actor_id = c_validator
     and after ->> 'reviewed_by' = c_validator::text;
  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: expected one validation audit row by %, found %', c_validator, v_n;
  end if;
  select id into v_audit_id from public.audit_log
   where tenant_id = c_tenant and entity = 'customs_record' and entity_id = c_customs
     and action = 'customs.updated' and actor_id = c_validator
     and after ->> 'reviewed_by' = c_validator::text;

  select count(*) into v_n from public.app_user where id = c_validator and tenant_id = c_tenant;
  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: validator % is not a user of tenant %', c_validator, c_tenant;
  end if;

  -- ---- PRECONDITION 3. The defect is present, exactly as diagnosed. --------
  if v_rec.reviewed_by is distinct from c_overwriter then
    raise exception 'ATTR-CUSTOMS-01 refused: reviewed_by is %, not the overwrite % — nothing to correct', v_rec.reviewed_by, c_overwriter;
  end if;
  if c_overwriter = c_validator then
    raise exception 'ATTR-CUSTOMS-01 refused: validator and overwriter are the same identity';
  end if;
  if v_rec.status is distinct from 'RELEASED' then
    raise exception 'ATTR-CUSTOMS-01 refused: status is %, the overwrite happens only on release', v_rec.status;
  end if;
  if v_rec.release_approval_status is distinct from 'APPROVED' or v_rec.release_approval_by is distinct from c_validator then
    raise exception 'ATTR-CUSTOMS-01 refused: release approval is % by %', v_rec.release_approval_status, v_rec.release_approval_by;
  end if;
  if v_rec.bae_reference is null or v_rec.bae_recorded_by is distinct from c_overwriter then
    raise exception 'ATTR-CUSTOMS-01 refused: BAE % recorded by % does not match the diagnosis', v_rec.bae_reference, v_rec.bae_recorded_by;
  end if;
  -- The overwrite's fingerprint: the one release event carries the identity
  -- that record_customs_release wrote into reviewed_by in the same UPDATE.
  select count(*) into v_n from public.business_event
   where tenant_id = c_tenant and subject_type = 'customs_record' and subject_id = c_customs
     and event_type = 'CUSTOMS_RELEASE_COMPLETED';
  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: expected one CUSTOMS_RELEASE_COMPLETED event, found %', v_n;
  end if;
  select actor_user_id into v_release_actor from public.business_event
   where tenant_id = c_tenant and subject_type = 'customs_record' and subject_id = c_customs
     and event_type = 'CUSTOMS_RELEASE_COMPLETED';
  if v_release_actor is distinct from c_overwriter then
    raise exception 'ATTR-CUSTOMS-01 refused: the release event names %, not the overwrite %', v_release_actor, c_overwriter;
  end if;

  -- ---- BASELINES ----------------------------------------------------------
  select count(*) into v_events_before from public.business_event;
  select count(*) into v_audit_before  from public.audit_log;

  -- ---- THE CORRECTION: one column, one row. ---------------------------------
  alter table public.customs_record disable trigger trg_customs_updated_at;

  update public.customs_record
     set reviewed_by = c_validator
   where id          = c_customs
     and tenant_id   = c_tenant
     and file_id     = c_file
     and deleted_at is null
     and reviewed_by = c_overwriter
     and reviewed_at = v_event_at
     and status      = 'RELEASED';
  get diagnostics v_n = row_count;

  alter table public.customs_record enable trigger trg_customs_updated_at;

  if v_n <> 1 then
    raise exception 'ATTR-CUSTOMS-01 refused: the correction matched % rows, expected exactly 1', v_n;
  end if;

  -- ---- POSTCONDITION 1. The validator is restored. ------------------------
  select * into v_rec from public.customs_record where id = c_customs;
  v_after := to_jsonb(v_rec);
  if v_rec.reviewed_by is distinct from c_validator then
    raise exception 'ATTR-CUSTOMS-01 aborted: reviewed_by is % after the correction', v_rec.reviewed_by;
  end if;

  -- ---- POSTCONDITION 2. Nothing else on the record moved — updated_at included.
  if (v_after - 'reviewed_by') is distinct from (v_before - 'reviewed_by') then
    raise exception 'ATTR-CUSTOMS-01 aborted: a column other than reviewed_by changed';
  end if;

  -- ---- POSTCONDITION 3. No business event was manufactured. ---------------
  select count(*) into v_events_after from public.business_event;
  if v_events_after <> v_events_before then
    raise exception 'ATTR-CUSTOMS-01 aborted: the correction appended % business events', v_events_after - v_events_before;
  end if;

  -- ---- POSTCONDITION 4. Every customs trigger is live again. --------------
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.customs_record'::regclass and not tgisinternal and tgenabled <> 'O';
  if v_n <> 0 then
    raise exception 'ATTR-CUSTOMS-01 aborted: % customs_record triggers are not enabled', v_n;
  end if;

  -- ---- THE TRACE ----------------------------------------------------------
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, before, after, override_reason)
  values (
    c_tenant, null, 'customs.attribution_corrected', 'customs_record', c_customs,
    jsonb_build_object('reviewed_by', c_overwriter),
    jsonb_build_object(
      'reviewed_by',                   c_validator,
      'reviewed_at',                   v_event_at,
      'provenance_business_event_id',  v_event_id,
      'provenance_audit_log_id',       v_audit_id,
      'correction',                    'ATTR-CUSTOMS-01'),
    'ATTR-CUSTOMS-01: restore the step 7 validator overwritten by record_customs_release');

  select count(*) into v_n from public.audit_log;
  if v_n <> v_audit_before + 1 then
    raise exception 'ATTR-CUSTOMS-01 aborted: expected exactly one trace row, audit_log grew by %', v_n - v_audit_before;
  end if;
  select count(*) into v_events_after from public.business_event;
  if v_events_after <> v_events_before then
    raise exception 'ATTR-CUSTOMS-01 aborted: the ledger grew by % events', v_events_after - v_events_before;
  end if;

  raise notice 'ATTR-CUSTOMS-01 OK: % reviewed_by % -> %; 1 row; 0 business events; 1 audit trace',
    c_file_no, c_overwriter, c_validator;
end
$attr$;
