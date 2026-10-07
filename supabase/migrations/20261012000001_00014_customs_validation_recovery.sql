-- UAT-CUSTOMS-SINGLE-DOOR-01 — reopen ONE false step-7 approval on EFT-IMP-2026-00014.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- ⚠⚠ NOT APPLIED BY PUSHING THIS FILE. Production migrations are dispatched by
-- a human against the `production-db` environment, one version per approved
-- action (docs/migration-policy.md).
--
-- ===========================================================================
-- WHAT HAPPENED, AND WHY ONLY A MIGRATION CAN FIX IT
-- ===========================================================================
-- On 2026-10-06 at 13:52:37 the Chef de Transit closed the customs maker-checker
-- pair with the GENERIC « Valider ». That control completed step 6 AND step 7 and
-- promoted step 8 — without ever calling `recordCustomsValidation`, which is the
-- act that certifies the customs record. So production records that Transit
-- validated a declaration it never certified:
--
--     process_step_execution  step 6 + step 7   COMPLETED, reviewed_by = the Chef
--     customs_record          reviewed_at = NULL, reviewed_by = NULL
--
-- THE DAMAGE IS NOT ONLY THE MISSING CERTIFICATION. `customs.update`,
-- `customs.status` and `customs.receivability` are all owned by step 6
-- (CONTROL_OWNING_STEP), and a control is refused once its owning step is no
-- longer actionable. Closing step 6 therefore made the certification permanently
-- unreachable AND froze `customs_record.status` at DECLARATION_PREPARED — from
-- which RELEASED is not a legal transition, so steps 15-26 were unreachable too.
--
-- PR #27 (UAT-CUSTOMS-SINGLE-DOOR-01) closed that door for every future dossier:
-- `transit_validation` joined DOMAIN_OWNED_STEPS withdrawing the generic
-- `approve`, and `genericTransitionAllowed` now requires the customs
-- certification fact (`reviewed_at` AND `reviewed_by`) before `approveStep` may
-- complete the pair. It does not reach backwards: 00014's rows were written
-- before it, and `ALLOWED_STEP_TRANSITIONS` declares `COMPLETED: []`. A completed
-- step is terminal, the only reopen action in the engine is `reopenSkippedStep`
-- (SKIPPED → PENDING), and NO permanent "reopen a completed step" capability is
-- created here or anywhere else. That is the whole reason this is a one-off,
-- dossier-specific, data-only correction.
--
-- ===========================================================================
-- WHAT IS CORRECTED, AND WHAT IS DELIBERATELY LEFT ALONE
-- ===========================================================================
-- TWO ROWS. Nothing else.
--
-- Step 6 `customs_preparation`: COMPLETED → SUBMITTED, clearing the three fields
-- that record a review which did not happen (`reviewed_at`, `reviewed_by`,
-- `completed_at`). The SUBMISSION is preserved — `submitted_by` and
-- `submitted_at` describe the Déclarant genuinely finishing the preparation on
-- 2026-10-05 at 14:40:27, which really did happen and remains true. So are the
-- assignment and `evidence_summary`: the evidence was genuinely satisfied, and
-- unlike 00013 this summary asserts nothing false.
--
-- Step 7 `transit_validation`: COMPLETED → PENDING, clearing the same three
-- fields. PENDING, not AVAILABLE: a validator row is PENDING for the whole
-- review by construction, and `evaluateControlGate`'s `reviewPending` branch
-- exists precisely for the shape this restores — preparer SUBMITTED, validator
-- PENDING — which is what reopens `customs.validation` for the Chef.
--
-- NO CERTIFICATION IS FABRICATED. `customs_record.reviewed_at` and
-- `reviewed_by` are NOT written by this migration and are fenced to be NULL
-- before it runs. Writing them would manufacture a certification nobody
-- performed, which is the exact lie the single-door fix exists to prevent. The
-- Chef de Transit must afterwards press « Valider — Chef de Transit », and only
-- that act may create them.
--
-- NOTHING DOWNSTREAM IS UN-PROMOTED. Steps 8-11 completed AFTER the false
-- approval, but the work they record is genuine: the Coordinator's handoffs, the
-- GAINDE registration with its quittance UAT-QUIT-2026-001 (1 520 000 XOF), and
-- the GAINDE/ORBUS attachment. Un-promoting them would destroy real business
-- facts to tidy a sequence. They stay, and the fences below REQUIRE them to be
-- intact — if any of them had been rolled back since the snapshot, this
-- correction is no longer the right one and must abort.
--
-- That is safe because of how the engine promotes: `promoteSuccessors` moves a
-- successor only `if (!exec || exec.state !== "PENDING") continue;` with a
-- compare-and-set on PENDING. Steps 8-11 are COMPLETED, so when the Chef's
-- genuine validation later completes the pair, they are skipped — no
-- re-promotion, no duplicate handoff, no duplicate GAINDE registration and no
-- duplicate payment.
--
-- Also untouched: step 12 (ACTIVE, claimed), step 13 (PENDING, assigned), step
-- 14 (AVAILABLE), the three completed parallel activities, the declaration facts
-- (UAT-GAINDE-2026-001), the governed customs elements, `status`,
-- `intel_status`, and every transport row (there are none).
--
-- ===========================================================================
-- APPLY ONCE, OR NOT AT ALL
-- ===========================================================================
-- Re-running is a NO-OP once the corrected shape and both audit rows are
-- present. A HALF-applied shape raises: that is not idempotency, it is damage,
-- and it must be looked at by a human rather than silently completed.
-- ===========================================================================

do $recovery$
declare
  k_tenant     constant uuid := '00000000-0000-0000-0000-000000000001';
  k_file       constant uuid := '3021c009-fefc-4054-b680-d331a0792125';
  k_instance   constant uuid := 'cf17acb4-e56d-41cc-ae14-e7ddb7a77f58';
  k_step6      constant uuid := 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c';
  k_step7      constant uuid := 'c6d6495c-aeb0-45ad-a393-56d382a970e2';
  k_customs    constant uuid := '13106965-5e3d-48af-950b-5e8b401dc37c';
  k_chef       constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167';
  k_declarant  constant uuid := '91ff703d-9d7f-4bec-a7f5-63856ab310dc';
  k_false_at   constant timestamptz := '2026-10-06 13:52:37.107+00';
  k_submitted  constant timestamptz := '2026-10-05 14:40:27.081+00';
  k_upd6       constant timestamptz := '2026-10-06 13:52:37.124497+00';
  k_upd7       constant timestamptz := '2026-10-06 13:52:37.191151+00';
  k_action     constant text := 'process.step.correction_applied';
  done6        boolean;
  done7        boolean;
  done_audit   int;
  n            int;
begin
  -- ---- 0. ALREADY APPLIED? ------------------------------------------------
  select exists (select 1 from public.process_step_execution
                  where id = k_step6 and state = 'SUBMITTED'
                    and reviewed_at is null and reviewed_by is null and completed_at is null)
    into done6;
  select exists (select 1 from public.process_step_execution
                  where id = k_step7 and state = 'PENDING'
                    and reviewed_at is null and reviewed_by is null and completed_at is null)
    into done7;
  select count(*) into done_audit
    from public.audit_log
   where action = k_action and entity_id in (k_step6, k_step7);

  if done6 and done7 and done_audit = 2 then
    raise notice 'UAT-CUSTOMS-SINGLE-DOOR-01: already applied — step 6 SUBMITTED, step 7 PENDING, 2 corrective audit rows. No-op.';
    return;
  end if;

  if done6 or done7 or done_audit <> 0 then
    raise exception
      'UAT-CUSTOMS-SINGLE-DOOR-01: HALF-APPLIED (step6_done=%, step7_done=%, audit_rows=%). Refusing to complete a partial correction — a human must inspect it.',
      done6, done7, done_audit;
  end if;

  -- ---- 1. THE SUBJECT, OR PROVEN ABSENCE ----------------------------------
  -- CI and any fresh stack have never held this dossier. Absence is a legitimate
  -- answer, but it is PROVEN COMPLETE rather than assumed: if the dossier were
  -- gone while anything it owns survived, that is a half-deleted database and
  -- this correction must not run against it.
  if not exists (select 1 from public.operational_file where id = k_file) then
    if exists (select 1 from public.process_instance where id = k_instance)
       or exists (select 1 from public.process_step_execution where id in (k_step6, k_step7))
       or exists (select 1 from public.customs_record where id = k_customs) then
      raise exception
        'UAT-CUSTOMS-SINGLE-DOOR-01: dossier % is absent but rows it owns survive — refusing to act on an incoherent database', k_file;
    end if;
    raise notice 'UAT-CUSTOMS-SINGLE-DOOR-01: dossier EFT-IMP-2026-00014 (%) is not present in this database, and neither is any row it owns. This correction has no subject here — no-op.', k_file;
    return;
  end if;

  -- ---- 2. IDENTITY ---------------------------------------------------------
  if not exists (select 1 from public.operational_file
                  where id = k_file and file_number = 'EFT-IMP-2026-00014' and tenant_id = k_tenant) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: % exists but is not EFT-IMP-2026-00014 in tenant % — refusing', k_file, k_tenant;
  end if;

  select count(*) into n from public.process_instance where file_id = k_file;
  if n <> 1 then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: expected exactly 1 process instance for the dossier, found %', n;
  end if;

  if not exists (select 1 from public.process_instance
                  where id = k_instance and file_id = k_file and tenant_id = k_tenant and status = 'ACTIVE') then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: process instance % is not the ACTIVE instance of this dossier', k_instance;
  end if;

  -- ---- 3. THE TWO ROWS STILL MATCH THE OBSERVED FALSE APPROVAL -------------
  -- Every field of the snapshot, including `updated_at`: if anything has touched
  -- these rows since the verification, the correction is no longer the one that
  -- was reviewed and must not run.
  if not exists (
    select 1 from public.process_step_execution
     where id = k_step6
       and process_instance_id = k_instance
       and tenant_id = k_tenant
       and step_key = 'customs_preparation'
       and state = 'COMPLETED'
       and reviewed_by = k_chef
       and reviewed_at = k_false_at
       and completed_at = k_false_at
       and submitted_by = k_declarant
       and submitted_at = k_submitted
       and assigned_user_id = k_declarant
       and assigned_role_code = 'CUSTOMS_DECLARANT'
       and correction_of_id is null
       and updated_at = k_upd6
  ) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: step 6 (%) no longer matches the verified snapshot', k_step6;
  end if;

  if not exists (
    select 1 from public.process_step_execution
     where id = k_step7
       and process_instance_id = k_instance
       and tenant_id = k_tenant
       and step_key = 'transit_validation'
       and state = 'COMPLETED'
       and reviewed_by = k_chef
       and reviewed_at = k_false_at
       and completed_at = k_false_at
       and submitted_by is null
       and assigned_user_id is null
       and correction_of_id is null
       and updated_at = k_upd7
  ) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: step 7 (%) no longer matches the verified snapshot', k_step7;
  end if;

  -- ---- 4. THE CERTIFICATION IS STILL ABSENT --------------------------------
  -- If the Chef has since validated through the proper door, there is nothing to
  -- reopen and reopening would DESTROY a genuine certification.
  if not exists (
    select 1 from public.customs_record
     where id = k_customs and file_id = k_file and tenant_id = k_tenant
       and deleted_at is null
       and reviewed_at is null and reviewed_by is null
       and status = 'DECLARATION_PREPARED'
       and intel_status = 'DRAFT'
       and declaration_number = 'UAT-GAINDE-2026-001'
  ) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: the customs record % is not in the verified uncertified state — refusing', k_customs;
  end if;

  -- ---- 5. THE DOWNSTREAM WORK THIS CORRECTION PRESERVES --------------------
  -- Fenced precisely BECAUSE it is untouched: if any of it had been rolled back,
  -- the sequence this correction assumes is no longer the one in the database.
  select count(*) into n
    from public.process_step_execution
   where process_instance_id = k_instance
     and step_key in ('coordinator_to_finance', 'gainde_registration',
                      'coordinator_to_declarant', 'gainde_document_submission')
     and state = 'COMPLETED';
  if n <> 4 then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: expected steps 8-11 COMPLETED, found % — refusing', n;
  end if;

  if not exists (select 1 from public.process_step_execution
                  where process_instance_id = k_instance and step_key = 'customs_followup' and state = 'ACTIVE') then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: step 12 customs_followup is no longer ACTIVE — refusing';
  end if;

  -- The genuine Finance act. Its absence (or voiding) would mean the dossier has
  -- been unwound by somebody else and this correction is not the right one.
  select count(*) into n
    from public.gainde_tax_payment
   where file_id = k_file and tenant_id = k_tenant
     and quittance_reference = 'UAT-QUIT-2026-001' and voided_at is null;
  if n <> 1 then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: the customs payment UAT-QUIT-2026-001 is missing or voided (found %) — refusing', n;
  end if;

  if not exists (
    select 1 from public.customs_record
     where id = k_customs
       and gainde_registered_at is not null and gainde_registered_by is not null
       and attachment_completed_at is not null
       and attachment_systems @> array['GAINDE', 'ORBUS']::text[]
  ) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: the GAINDE registration or the GAINDE/ORBUS attachment is missing — refusing';
  end if;

  -- The false approval must still be in the ledger. This correction explains an
  -- event; if the event were gone, it would be explaining nothing.
  if not exists (
    select 1 from public.audit_log
     where action = 'process.step.approved' and entity_id = k_step6 and actor_id = k_chef
  ) then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: the historical approval event is absent from the audit trail — refusing';
  end if;

  -- ---- 6. THE CORRECTION ---------------------------------------------------
  update public.process_step_execution
     set state = 'SUBMITTED',
         reviewed_at = null,
         reviewed_by = null,
         completed_at = null
   where id = k_step6
     and tenant_id = k_tenant
     and state = 'COMPLETED';
  if not found then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: step 6 update matched no row — aborting';
  end if;

  update public.process_step_execution
     set state = 'PENDING',
         reviewed_at = null,
         reviewed_by = null,
         completed_at = null
   where id = k_step7
     and tenant_id = k_tenant
     and state = 'COMPLETED';
  if not found then
    raise exception 'UAT-CUSTOMS-SINGLE-DOOR-01: step 7 update matched no row — aborting';
  end if;

  -- ---- 7. HISTORY IS ADDED TO, NEVER REWRITTEN -----------------------------
  -- `actor_id` is NULL on purpose: no operator performed these writes. A human
  -- authorised the correction; nobody clicked it. The historical
  -- `process.step.approved` row stays exactly where it is — the click happened,
  -- and an auditor must still be able to see it.
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, after)
  values
    (k_tenant, null, k_action, 'process_step_execution', k_step6, jsonb_build_object(
      'correction', 'UAT-CUSTOMS-SINGLE-DOOR-01',
      'step_key', 'customs_preparation',
      'from_state', 'COMPLETED',
      'to_state', 'SUBMITTED',
      'cleared', jsonb_build_array('reviewed_at', 'reviewed_by', 'completed_at'),
      'preserved', jsonb_build_array('submitted_by', 'submitted_at', 'assigned_user_id',
                                     'assigned_role_code', 'evidence_summary'),
      'reason', 'Step 7 was completed through the GENERIC approval, which closed this step without the customs certification. Closing it also withdrew the customs.update / customs.status / customs.receivability controls it owns. Reopened to SUBMITTED so the Declarant may finish the governed customs data and the Chef de Transit may certify through "Valider — Chef de Transit".',
      'superseded_event', jsonb_build_object(
        'action', 'process.step.approved', 'occurred_at', k_false_at, 'actor_id', k_chef),
      'certification_fabricated', false)),
    (k_tenant, null, k_action, 'process_step_execution', k_step7, jsonb_build_object(
      'correction', 'UAT-CUSTOMS-SINGLE-DOOR-01',
      'step_key', 'transit_validation',
      'from_state', 'COMPLETED',
      'to_state', 'PENDING',
      'cleared', jsonb_build_array('reviewed_at', 'reviewed_by', 'completed_at'),
      'reason', 'The validator half of the customs maker-checker pair was completed by the generic control without customs_record certification. Returned to PENDING so the pair presents as preparer SUBMITTED + validator PENDING, which is the shape evaluateControlGate reopens customs.validation for.',
      'superseded_event', jsonb_build_object(
        'action', 'process.step.approved', 'occurred_at', k_false_at, 'actor_id', k_chef),
      'certification_fabricated', false));

  raise notice 'UAT-CUSTOMS-SINGLE-DOOR-01 applied: step 6 SUBMITTED (submission preserved), step 7 PENDING, customs_record certification untouched and still NULL.';
end
$recovery$;
