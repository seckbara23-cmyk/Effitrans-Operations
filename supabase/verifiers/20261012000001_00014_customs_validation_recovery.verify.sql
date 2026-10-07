-- VERIFIER for 20261012000001_00014_customs_validation_recovery
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is a corrected WORKFLOW POSITION on two rows
-- of one dossier, so those are the postconditions — plus the two invariants the
-- correction exists to protect:
--
--   1. NO CERTIFICATION WAS FABRICATED. `customs_record.reviewed_at` and
--      `reviewed_by` must still be NULL. If a future edit "finished the job" by
--      writing them, the two step states would look right and the dossier would
--      be asserting that the Chef de Transit certified a declaration they never
--      saw. That is the precise lie the single-door fix exists to prevent, and
--      this file is what runs months later to notice.
--
--   2. THE GENUINE WORK SURVIVED. Steps 8-11, the quittance, the GAINDE
--      registration and the GAINDE/ORBUS attachment were real acts performed
--      after the false approval. A correction that quietly un-wound them would
--      have "fixed" the sequence by destroying the business facts.
--
-- NO `updated_at` FENCE ANYWHERE. `trg_pse_updated_at` bumps that column on
-- every write, so pinning it would make this verifier fail the moment any
-- legitimate later action touched the rows — reporting a successful migration
-- as unapplied. The migration fences on it (to prove nothing moved BEFORE the
-- apply); the verifier deliberately does not.
--
-- IT ANSWERS FOR A SUBJECT THAT EXISTS IN ONE DATABASE. `verify-migrations.mjs`
-- runs every APPLIED migration's verifier, and in CI `db reset` applies them all
-- — against a database that has never held EFT-IMP-2026-00014. Asserting a
-- corrected dossier there would fail a migration that ran perfectly. So the
-- verdict is conditional on the SUBJECT, exactly as the migration's own gate is.
-- What is NOT conditional is COHERENCE: the dossier and its customs record must
-- either both exist or both not.
--
-- THE STEP STATES ARE DELIBERATELY TRANSIENT, AND THAT IS STATED HERE. Once the
-- Chef presses « Valider — Chef de Transit », step 6 becomes COMPLETED again and
-- step 7 COMPLETED with a REAL reviewer — and these two checks will then report
-- FAILED. That is not a regression; it is this verifier's subject having moved
-- on, exactly as 20261008000001's verifier did after 00013 was re-issued. Read a
-- failure here as "look at the dossier", never as "the migration did not run" —
-- the two audit rows below are the durable proof that it did.
--
-- AND IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file down
-- with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with subject as (
  select
    exists (select 1 from public.operational_file
             where id = '3021c009-fefc-4054-b680-d331a0792125') as dossier_present,
    exists (select 1 from public.customs_record
             where id = '13106965-5e3d-48af-950b-5e8b401dc37c') as customs_present
),
checks(label, ok) as (
  values
    -- ---- 1. step 6 is reopened, with the genuine submission intact ---------
    ('step 6 customs_preparation is SUBMITTED again', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c'
         and step_key = 'customs_preparation'
         and state = 'SUBMITTED'
    )),

    ('… with the review it never earned cleared', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c'
         and reviewed_at is null and reviewed_by is null and completed_at is null
    )),

    -- The Déclarant really did finish the preparation. Reopening the review does
    -- not unhappen their submission, and losing it would make the step look
    -- never-worked.
    ('… while the Déclarant''s submission and claim are preserved', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c'
         and submitted_by = '91ff703d-9d7f-4bec-a7f5-63856ab310dc'
         and submitted_at = '2026-10-05 14:40:27.081+00'
         and assigned_user_id = '91ff703d-9d7f-4bec-a7f5-63856ab310dc'
         and assigned_role_code = 'CUSTOMS_DECLARANT'
    )),

    -- Unlike 00013, this summary asserts nothing false: the evidence genuinely
    -- was satisfied. Clearing it would have destroyed a true record.
    ('… and the evidence summary it genuinely earned is still there', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c'
         and evidence_summary is not null
         and evidence_summary::jsonb -> 'satisfied' ? 'CUSTOMS_DOSSIER'
    )),

    -- ---- 2. step 7 is un-promoted -----------------------------------------
    ('step 7 transit_validation is PENDING', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c6d6495c-aeb0-45ad-a393-56d382a970e2'
         and step_key = 'transit_validation'
         and state = 'PENDING'
    )),

    ('… unreviewed and unclaimed, as a waiting validator must be', (
      select count(*) = 1 from public.process_step_execution
       where id = 'c6d6495c-aeb0-45ad-a393-56d382a970e2'
         and reviewed_at is null and reviewed_by is null
         and completed_at is null and assigned_user_id is null
    )),

    -- ---- 3. THE INVARIANT: no certification was fabricated -----------------
    ('the customs record is still UNCERTIFIED — reviewed_at and reviewed_by NULL', (
      select count(*) = 1 from public.customs_record
       where id = '13106965-5e3d-48af-950b-5e8b401dc37c'
         and reviewed_at is null
         and reviewed_by is null
    )),

    ('… and its declaration facts are untouched', (
      select count(*) = 1 from public.customs_record
       where id = '13106965-5e3d-48af-950b-5e8b401dc37c'
         and status = 'DECLARATION_PREPARED'
         and intel_status = 'DRAFT'
         and declaration_number = 'UAT-GAINDE-2026-001'
         and created_by = '91ff703d-9d7f-4bec-a7f5-63856ab310dc'
    )),

    ('… including the governed customs elements', (
      select count(*) = 1 from public.customs_record
       where id = '13106965-5e3d-48af-950b-5e8b401dc37c'
         and sh_position_count = 1
         and declaration_type = 'SIMPLE'
         and dpi_regime = 'EFFITRANS'
         and exemption_title_origin = 'EFFITRANS'
         and tariff_classification_origin = 'CLIENT'
    )),

    -- ---- 4. THE INVARIANT: the genuine downstream work survived ------------
    ('steps 8-11 are still COMPLETED', (
      select count(*) = 4 from public.process_step_execution
       where process_instance_id = 'cf17acb4-e56d-41cc-ae14-e7ddb7a77f58'
         and step_key in ('coordinator_to_finance', 'gainde_registration',
                          'coordinator_to_declarant', 'gainde_document_submission')
         and state = 'COMPLETED'
    )),

    ('the customs payment UAT-QUIT-2026-001 is intact and not voided', (
      select count(*) = 1 from public.gainde_tax_payment
       where file_id = '3021c009-fefc-4054-b680-d331a0792125'
         and quittance_reference = 'UAT-QUIT-2026-001'
         and total_paid_minor = 1520000
         and voided_at is null
    )),

    ('the GAINDE registration and the GAINDE/ORBUS attachment are intact', (
      select count(*) = 1 from public.customs_record
       where id = '13106965-5e3d-48af-950b-5e8b401dc37c'
         and gainde_registered_at is not null
         and gainde_registered_by is not null
         and attachment_completed_at is not null
         and attachment_systems @> array['GAINDE', 'ORBUS']::text[]
    )),

    ('step 12 customs_followup is still ACTIVE and claimed', (
      select count(*) = 1 from public.process_step_execution
       where process_instance_id = 'cf17acb4-e56d-41cc-ae14-e7ddb7a77f58'
         and step_key = 'customs_followup'
         and state = 'ACTIVE'
         and assigned_user_id is not null
    )),

    ('step 13 keeps its field-agent assignment, step 14 its availability', (
      select count(*) = 2 from public.process_step_execution
       where process_instance_id = 'cf17acb4-e56d-41cc-ae14-e7ddb7a77f58'
         and ((step_key = 'customs_field_clearance' and state = 'PENDING'
               and assigned_user_id is not null)
           or (step_key = 'transport_assignment' and state = 'AVAILABLE'))
    )),

    -- ---- 5. history was added to, never rewritten --------------------------
    ('both corrective audit entries were written', (
      select count(*) = 2 from public.audit_log
       where action = 'process.step.correction_applied'
         and entity_id in ('c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c',
                           'c6d6495c-aeb0-45ad-a393-56d382a970e2')
    )),

    -- The act that caused the damage stays on the record. Reopening the steps
    -- does not unhappen the click, and an auditor must still be able to see it.
    ('the historical generic approval is still in the audit trail', (
      select count(*) >= 1 from public.audit_log
       where action = 'process.step.approved'
         and entity_id = 'c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c'
         and actor_id = 'f12f6fdf-9f05-4768-b5cd-224ce2a06167'
    )),

    -- ---- 6. blast radius: two rows, one dossier ---------------------------
    ('no correction was applied to any step outside these two', (
      select count(*) = 0 from public.audit_log a
       where a.action = 'process.step.correction_applied'
         and a.after ->> 'correction' = 'UAT-CUSTOMS-SINGLE-DOOR-01'
         and a.entity_id not in ('c55fe9ff-5fea-4eed-83fe-7ebf33a4e71c',
                                 'c6d6495c-aeb0-45ad-a393-56d382a970e2')
    ))
)
select
  -- COHERENCE always; the postconditions only where there is a subject.
  (select dossier_present = customs_present from subject)
  and case when (select dossier_present from subject) then bool_and(coalesce(c.ok, false)) else true end as ok,
  case
    when (select dossier_present <> customs_present from subject)
      then 'UAT-CUSTOMS-SINGLE-DOOR-01 #150 INCOHERENT: the dossier and its customs record disagree about existing — one is present without the other'
    when not (select dossier_present from subject)
      then 'UAT-CUSTOMS-SINGLE-DOOR-01 #150 NOT APPLICABLE: EFT-IMP-2026-00014 is absent from this database, so this one-off correction has no subject to verify here'
    when bool_and(coalesce(c.ok, false))
      then 'UAT-CUSTOMS-SINGLE-DOOR-01 #150 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — step 6 reopened with its submission intact, step 7 pending, certification still NULL, downstream work preserved'
    else 'UAT-CUSTOMS-SINGLE-DOOR-01 #150 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
