-- VERIFIER for 20261008000001_step22_00013_recovery
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is a corrected WORKFLOW POSITION on one
-- dossier, so those are the postconditions — and a verifier asserts the
-- postconditions ITS OWN migration establishes, no more. It does not assert
-- that the invoice was subsequently issued, that a number was allocated, that
-- an artifact exists or that the client can see anything: all of that is the
-- operator's work AFTER this migration, and demanding it here would make a
-- correctly-applied recovery read as VERIFY_FAILED until somebody happened to
-- press a button.
--
-- WHAT IT DOES ASSERT BEYOND THE TWO STATES is the pair of invariants the
-- correction exists to protect: that the invoice was NOT quietly issued to make
-- the workflow look consistent, and that the historical audit trail — both the
-- false completion and Administration's genuine claim — is still there. A future
-- edit that "tidied" either would leave the two states technically correct and
-- the meaning destroyed, and this file is what runs months later to notice.
--
-- NO `updated_at` FENCE ANYWHERE. `trg_pse_updated_at` bumps that column on
-- every write, so pinning it would make this verifier fail the moment any
-- legitimate later action touched the rows — reporting a successful migration as
-- unapplied. The migration fences on it (to prove nothing moved BEFORE the
-- apply); the verifier deliberately does not.
--
-- AND IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file down
-- with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with checks(label, ok) as (
  values
    -- ---- 1. Step 22 is reopened, and the false completion is gone ---------
    ('step 22 billing_dispatch is ACTIVE again', (
      select count(*) = 1 from public.process_step_execution
       where id = 'f7ec53a8-68c4-4766-86c2-602e8731de1a'
         and step_key = 'billing_dispatch'
         and state = 'ACTIVE'
    )),

    ('… with the completion it never earned cleared', (
      select count(*) = 1 from public.process_step_execution
       where id = 'f7ec53a8-68c4-4766-86c2-602e8731de1a'
         and completed_at is null
         and submitted_at is null
         and submitted_by is null
    )),

    -- The row asserted `{"satisfied":["FINAL_INVOICE"]}` on an invoice that was
    -- never issued. A reopened step carrying that claim would still be lying.
    ('… and the evidence summary that asserted FINAL_INVOICE is cleared', (
      select count(*) = 1 from public.process_step_execution
       where id = 'f7ec53a8-68c4-4766-86c2-602e8731de1a'
         and evidence_summary is null
    )),

    -- The claim was genuine and is NOT part of what went wrong. Preserving it
    -- keeps the step with the Finance seat that will perform the real issuance.
    ('… while Finance Demo''s genuine claim and start are preserved', (
      select count(*) = 1 from public.process_step_execution
       where id = 'f7ec53a8-68c4-4766-86c2-602e8731de1a'
         and assigned_user_id = 'd321e925-d835-469c-ad5a-b1eac2432c74'
         and assigned_role_code = 'BILLING_OFFICER'
         and started_at = '2026-09-29 21:26:55.336+00'
    )),

    -- ---- 2. Step 23 is un-promoted ---------------------------------------
    ('step 23 administration_deposit_prep is PENDING', (
      select count(*) = 1 from public.process_step_execution
       where id = 'af378d19-d7c4-4983-8e60-dabea5499770'
         and step_key = 'administration_deposit_prep'
         and state = 'PENDING'
    )),

    ('… unassigned and unstarted, as an unreachable step must be', (
      select count(*) = 1 from public.process_step_execution
       where id = 'af378d19-d7c4-4983-8e60-dabea5499770'
         and assigned_user_id is null
         and started_at is null
         and submitted_at is null
         and completed_at is null
    )),

    ('… keeping the owning role it was seeded with', (
      select count(*) = 1 from public.process_step_execution
       where id = 'af378d19-d7c4-4983-8e60-dabea5499770'
         and assigned_role_code = 'ADMINISTRATIVE_OFFICER'
    )),

    -- ---- 3. THE INVARIANT: no issuance was fabricated ---------------------
    -- The entire point of the correction is that the platform stops claiming an
    -- invoice was issued when it was not. If this migration — or anything since
    -- — had "fixed" the inconsistency by marking the invoice ISSUED instead, the
    -- two states above would look right and the dossier would be lying harder.
    ('the invoice is still VALIDATED, unnumbered and unissued', (
      select count(*) = 1 from public.invoice
       where id = '845690b7-9490-4587-8ca5-3338b1cacfe7'
         and status = 'VALIDATED'
         and invoice_number is null
         and issue_date is null
         and issued_by is null
         and revision = 1
    )),

    ('… with its maker-checker history intact', (
      select count(*) = 1 from public.invoice
       where id = '845690b7-9490-4587-8ca5-3338b1cacfe7'
         and submitted_by = 'd321e925-d835-469c-ad5a-b1eac2432c74'
         and validated_by = '9d9b8314-17cd-4273-a38b-3f1cd6bf245a'
         and validated_by <> submitted_by
    )),

    ('no official invoice document was created by the correction', (
      select count(*) = 0 from public.document
       where invoice_id = '845690b7-9490-4587-8ca5-3338b1cacfe7'
          or (file_id = '3567914c-7afe-41fb-be24-adcd779d1e3a'
              and artifact_code = 'OFFICIAL_INVOICE')
    )),

    -- EFT-INV-2026-00002 was burned by the failed send and must never be
    -- reused; the next genuine issuance draws 00003.
    ('the invoice counter is untouched — the next number is still 00003', (
      select count(*) = 1 from public.invoice_counter
       where tenant_id = '00000000-0000-0000-0000-000000000001'
         and year = 2026 and next_seq = 2
    )),

    ('no invoice in the tenant carries the burned EFT-INV-2026-00002', (
      select count(*) = 0 from public.invoice
       where tenant_id = '00000000-0000-0000-0000-000000000001'
         and invoice_number = 'EFT-INV-2026-00002'
    )),

    -- ---- 4. THE INVARIANT: history was added to, never rewritten ----------
    ('both corrective audit entries were written', (
      select count(*) = 2 from public.audit_log
       where action = 'process.step.correction_applied'
         and entity_id in ('f7ec53a8-68c4-4766-86c2-602e8731de1a',
                           'af378d19-d7c4-4983-8e60-dabea5499770')
    )),

    -- The act that caused the damage stays on the record. Reopening the step
    -- does not unhappen the click, and an auditor must still be able to see it.
    ('the false step-22 completion is still in the audit trail', (
      select count(*) >= 1 from public.audit_log
       where action = 'process.step.completed'
         and entity_id = 'f7ec53a8-68c4-4766-86c2-602e8731de1a'
    )),

    -- Administration's claim was legitimate. It was removed from STATE because
    -- the step became unreachable, never from history.
    ('administration.demo''s genuine claim of step 23 is still in the audit trail', (
      select count(*) >= 1 from public.audit_log
       where action = 'process.step.activated'
         and entity_id = 'af378d19-d7c4-4983-8e60-dabea5499770'
         and actor_id = 'aa588fdb-85b6-4322-a492-6612d3bc6248'
    )),

    -- ---- 5. Blast radius: one dossier, two rows --------------------------
    ('the dossier is still the single ACTIVE instance of EFT-IMP-2026-00013', (
      select count(*) = 1 from public.process_instance pi
       join public.operational_file f on f.id = pi.file_id
       where pi.id = '9c9dab1b-0b5d-4258-b9e2-5e00a0c9c2fb'
         and f.file_number = 'EFT-IMP-2026-00013'
         and pi.status = 'ACTIVE'
    )),

    ('step 24 courier_deposit was not disturbed', (
      select count(*) = 1 from public.process_step_execution
       where process_instance_id = '9c9dab1b-0b5d-4258-b9e2-5e00a0c9c2fb'
         and step_key = 'courier_deposit'
         and state = 'PENDING' and started_at is null and assigned_user_id is null
    )),

    -- Steps 20 and 21 were correct and are not part of this correction.
    ('steps 20 and 21 remain COMPLETED and untouched', (
      select count(*) = 2 from public.process_step_execution
       where process_instance_id = '9c9dab1b-0b5d-4258-b9e2-5e00a0c9c2fb'
         and step_key in ('billing_draft', 'finance_invoice_validation')
         and state = 'COMPLETED'
    )),

    ('no correction was applied to any step outside this dossier', (
      select count(*) = 0 from public.audit_log a
       where a.action = 'process.step.correction_applied'
         and a.entity_id not in ('f7ec53a8-68c4-4766-86c2-602e8731de1a',
                                 'af378d19-d7c4-4983-8e60-dabea5499770')
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'STEP22-00013-RECOVERY-01 #146 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'STEP22-00013-RECOVERY-01 #146 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
