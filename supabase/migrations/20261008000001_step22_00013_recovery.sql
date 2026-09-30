-- STEP22-00013-RECOVERY-01 — undo ONE false step-22 completion on EFT-IMP-2026-00013.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- ⚠⚠ NOT APPLIED BY PUSHING THIS FILE. Production migrations are dispatched by
-- a human against the `production-db` environment, one version per approved
-- action (docs/migration-policy.md).
--
-- ===========================================================================
-- WHAT HAPPENED, AND WHY ONLY A MIGRATION CAN FIX IT
-- ===========================================================================
-- On 2026-09-29 at 21:27:08 the governed issuance action refused: the mail
-- provider was not configured, so `emailValidatedInvoice` returned
-- `email_send_failed` BEFORE it wrote ISSUED. Eight seconds later, at 21:27:16,
-- the operator closed official step 22 with the GENERIC « Terminer ».
--
-- It worked because step 22's `FINAL_INVOICE` HARD_GATE accepted any invoice
-- that was not a DRAFT, and the invoice was VALIDATED. So the dossier now
-- records that Facturation issued and dispatched an invoice which has no
-- official number, no issue date, no official document, and which no customer
-- has ever been able to see. The execution row even carries
-- `evidence_summary = {"satisfied":["FINAL_INVOICE"]}` — a stored falsehood.
--
-- PR #21 (STEP22-ISSUANCE-INTEGRITY-01) closed that door for every future
-- dossier: `FINAL_INVOICE` now requires a genuinely ISSUED invoice, and
-- `billing_dispatch` joined DOMAIN_OWNED_STEPS so the generic control cannot
-- substitute for issuance at all. PR #22 (STEP22-PORTAL-DELIVERY-01) then made
-- the Client Space the delivery channel, so an unconfigured mail provider no
-- longer blocks issuance. Neither of them reaches backwards: 00013's row was
-- written before both, and `ALLOWED_STEP_TRANSITIONS` declares `COMPLETED: []`.
-- A completed step is terminal, the only reopen action in the engine is
-- `reopenSkippedStep` (SKIPPED → PENDING), and NO permanent "reopen a completed
-- step" capability is being created here or anywhere else. That is the whole
-- reason this is a one-off, dossier-specific, data-only correction.
--
-- ===========================================================================
-- WHAT IS CORRECTED, AND WHAT IS DELIBERATELY LEFT ALONE
-- ===========================================================================
-- TWO ROWS. Nothing else.
--
-- Step 22 `billing_dispatch`: COMPLETED → ACTIVE, clearing the three fields
-- that record the completion that never happened plus the evidence summary that
-- asserts the gate was met. The CLAIM is preserved — `assigned_user_id` and
-- `started_at` describe Finance Demo genuinely picking the work up at 21:26:55,
-- which really did happen and remains true.
--
-- Step 23 `administration_deposit_prep`: ACTIVE → PENDING, clearing the claim.
-- This is the part that removes a real human act from STATE, so it is argued
-- rather than asserted. Its registered prerequisite is `["billing_dispatch"]`.
-- Once step 22 is ACTIVE that prerequisite is unmet, so neither ACTIVE nor
-- AVAILABLE is a truthful state for it. Leaving it ACTIVE is merely TOLERATED by
-- the engine — `promoteSuccessors` skips any successor that is not PENDING — and
-- that tolerance is precisely the damage: the genuine completion would silently
-- promote nothing, no `promoted_from` audit would ever exist, and the row would
-- go on asserting that Administration began work before Facturation issued
-- anything. The act is not erased: `process.step.activated` at
-- 2026-09-30 19:06:31.987 STAYS in `audit_log`, this migration cites it, and
-- `audit_log` is append-only at the database (`trg_audit_log_no_delete`,
-- `trg_audit_log_no_update`) so it could not be removed even by accident.
-- administration.demo re-claims the step after issuance — one click.
--
-- THE INVOICE IS NOT TOUCHED. `845690b7…` is VALIDATED with no number, no issue
-- date and no issuer, which is a CORRECT and internally consistent record of an
-- invoice that was never issued. Marking it ISSUED here would fabricate the very
-- fact this migration exists to stop the platform asserting. Issuance is an
-- operator act performed afterwards through the governed lane, by a Finance seat
-- holding `finance:issue`.
--
-- NOTHING ELSE MOVES: no official artifact is created, no number is allocated,
-- `invoice_counter` is untouched (so the next genuine issuance draws
-- EFT-INV-2026-00003 and the burned EFT-INV-2026-00002 is never reused), no
-- communication row is added or retried, no handoff, no ledger event.
--
-- ===========================================================================
-- FENCED TO ONE OBSERVED STATE
-- ===========================================================================
-- Every identifier and timestamp below was read from production on 2026-09-30
-- under the deployed SHA c773579. If ANY of them has moved, the dossier is not
-- the one this correction was designed against and the migration aborts — a
-- RAISE inside a `db-query` migration rolls the whole thing back, so a refusal
-- leaves production exactly as it found it.
-- ===========================================================================

do $$
declare
  -- ---- the dossier, pinned by id AND by the facts that identify it --------
  k_tenant   constant uuid := '00000000-0000-0000-0000-000000000001';
  k_file     constant uuid := '3567914c-7afe-41fb-be24-adcd779d1e3a';
  k_instance constant uuid := '9c9dab1b-0b5d-4258-b9e2-5e00a0c9c2fb';
  k_invoice  constant uuid := '845690b7-9490-4587-8ca5-3338b1cacfe7';
  k_step22   constant uuid := 'f7ec53a8-68c4-4766-86c2-602e8731de1a';
  k_step23   constant uuid := 'af378d19-d7c4-4983-8e60-dabea5499770';

  -- ---- the actors, so the fences name people and not just rows -----------
  k_finance  constant uuid := 'd321e925-d835-469c-ad5a-b1eac2432c74'; -- Finance Demo
  k_checker  constant uuid := '9d9b8314-17cd-4273-a38b-3f1cd6bf245a'; -- validated the invoice
  k_admin    constant uuid := 'aa588fdb-85b6-4322-a492-6612d3bc6248'; -- administration.demo

  -- ---- the observed baseline ---------------------------------------------
  k_s22_started   constant timestamptz := '2026-09-29 21:26:55.336+00';
  k_s22_completed constant timestamptz := '2026-09-29 21:27:16.367+00';
  k_s23_started   constant timestamptz := '2026-09-30 19:06:31.948+00';
  k_false_completion constant text := '2026-09-29 21:27:16.400952+00';
  k_preserved_claim  constant text := '2026-09-30 19:06:31.987547+00';

  k_action constant text := 'process.step.correction_applied';

  done22 boolean;
  done23 boolean;
  done_audit int;
  n int;
begin
  -- =========================================================================
  -- 0. IDEMPOTENCY — all three, or none. A PARTIAL state is never "fine".
  -- =========================================================================
  select exists (
    select 1 from public.process_step_execution
     where id = k_step22 and tenant_id = k_tenant
       and state = 'ACTIVE'
       and submitted_by is null and submitted_at is null and completed_at is null
       and evidence_summary is null
       and assigned_user_id = k_finance and started_at = k_s22_started
  ) into done22;

  select exists (
    select 1 from public.process_step_execution
     where id = k_step23 and tenant_id = k_tenant
       and state = 'PENDING'
       and assigned_user_id is null and started_at is null
  ) into done23;

  select count(*) into done_audit
    from public.audit_log
   where action = k_action and entity_id in (k_step22, k_step23);

  if done22 and done23 and done_audit = 2 then
    raise notice 'STEP22-00013-RECOVERY-01: already applied — step 22 ACTIVE, step 23 PENDING, 2 corrective audit rows. No-op.';
    return;
  end if;

  if done22 or done23 or done_audit <> 0 then
    raise exception
      'STEP22-00013-RECOVERY-01: PARTIAL correction found (step22_done=%, step23_done=%, corrective_audit_rows=%). Refusing to act on a half-corrected dossier — diagnose by hand.',
      done22, done23, done_audit;
  end if;

  -- =========================================================================
  -- 1. FENCES — the exact production state this correction was designed for
  -- =========================================================================

  -- ---- 1a. the dossier itself --------------------------------------------
  if not exists (
    select 1 from public.operational_file
     where id = k_file and tenant_id = k_tenant and file_number = 'EFT-IMP-2026-00013'
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: dossier EFT-IMP-2026-00013 (%) not found in tenant %', k_file, k_tenant;
  end if;

  select count(*) into n from public.process_instance where file_id = k_file;
  if n <> 1 then
    raise exception 'STEP22-00013-RECOVERY-01: expected exactly 1 process instance for the dossier, found %', n;
  end if;

  if not exists (
    select 1 from public.process_instance
     where id = k_instance and file_id = k_file and tenant_id = k_tenant and status = 'ACTIVE'
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: process instance % is not the ACTIVE instance of this dossier', k_instance;
  end if;

  -- ---- 1b. the invoice, which this migration must NOT change -------------
  -- Fenced precisely because it is untouched: if it has moved, somebody has
  -- acted on the dossier since the baseline and the correction is stale.
  if not exists (
    select 1 from public.invoice
     where id = k_invoice and tenant_id = k_tenant and file_id = k_file
       and status = 'VALIDATED'
       and invoice_number is null and issue_date is null and issued_by is null
       and revision = 1
       and submitted_by = k_finance and validated_by = k_checker
       and updated_at = '2026-09-29 21:23:31.995138+00'
  ) then
    raise exception
      'STEP22-00013-RECOVERY-01: invoice % is no longer the VALIDATED, unnumbered, unissued row this correction was designed against', k_invoice;
  end if;

  -- ---- 1c. step 22, carrying the false completion -------------------------
  if not exists (
    select 1 from public.process_step_execution
     where id = k_step22 and tenant_id = k_tenant
       and process_instance_id = k_instance and step_key = 'billing_dispatch'
       and state = 'COMPLETED'
       and completed_at = k_s22_completed
       and submitted_at = k_s22_completed
       and submitted_by = k_finance
       and assigned_user_id = k_finance
       and started_at = k_s22_started
       and updated_at = '2026-09-29 21:27:16.380614+00'
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: step 22 (%) no longer matches the observed false completion', k_step22;
  end if;

  -- ---- 1d. step 23, claimed by Administration ----------------------------
  if not exists (
    select 1 from public.process_step_execution
     where id = k_step23 and tenant_id = k_tenant
       and process_instance_id = k_instance and step_key = 'administration_deposit_prep'
       and state = 'ACTIVE'
       and assigned_user_id = k_admin
       and started_at = k_s23_started
       and submitted_at is null and completed_at is null
       and updated_at = '2026-09-30 19:06:31.964827+00'
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: step 23 (%) no longer matches the observed Administration claim', k_step23;
  end if;

  -- ---- 1e. step 24 has not begun -----------------------------------------
  if not exists (
    select 1 from public.process_step_execution
     where process_instance_id = k_instance and step_key = 'courier_deposit'
       and state = 'PENDING' and started_at is null and assigned_user_id is null
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: step 24 courier_deposit has moved — the correction is no longer safe';
  end if;

  -- ---- 1f. ABSENCE. Step 23 was started and nothing more -----------------
  -- If Administration had produced real work — a deposit, a courier, a document,
  -- a handoff — un-promoting the step would destroy it. It produced none, and
  -- this is where that is proven rather than assumed.
  select count(*) into n from public.document
   where invoice_id = k_invoice
      or (file_id = k_file and artifact_code = 'OFFICIAL_INVOICE');
  if n <> 0 then
    raise exception 'STEP22-00013-RECOVERY-01: % official-invoice document(s) exist; the dossier has been issued since the baseline', n;
  end if;

  select count(*) into n from public.invoice_deposit where invoice_id = k_invoice;
  if n <> 0 then
    raise exception 'STEP22-00013-RECOVERY-01: % deposit row(s) exist — step 23 produced real work and must not be un-promoted', n;
  end if;

  select count(*) into n from public.business_event
   where dossier_id = k_file and occurred_at > k_s22_completed;
  if n <> 0 then
    raise exception 'STEP22-00013-RECOVERY-01: % business event(s) recorded after the false completion', n;
  end if;

  select count(*) into n from public.process_handoff
   where process_instance_id = k_instance and sent_at > '2026-09-29 00:00:00+00';
  if n <> 0 then
    raise exception 'STEP22-00013-RECOVERY-01: % handoff(s) sent since the baseline', n;
  end if;

  -- ---- 1g. numbering is untouched, and stays untouched -------------------
  if not exists (
    select 1 from public.invoice_counter
     where tenant_id = k_tenant and year = 2026 and next_seq = 2
  ) then
    raise exception 'STEP22-00013-RECOVERY-01: invoice_counter has moved; the next number is no longer EFT-INV-2026-00003';
  end if;

  -- =========================================================================
  -- 2. THE CORRECTION — two rows, one each
  -- =========================================================================

  -- Step 22: unmake the completion, keep the claim.
  update public.process_step_execution
     set state = 'ACTIVE',
         submitted_by = null,
         submitted_at = null,
         completed_at = null,
         evidence_summary = null
   where id = k_step22 and tenant_id = k_tenant and state = 'COMPLETED';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'STEP22-00013-RECOVERY-01: step 22 update affected % rows, expected exactly 1', n;
  end if;

  -- Step 23: back to PENDING, because its prerequisite is no longer met.
  update public.process_step_execution
     set state = 'PENDING',
         assigned_user_id = null,
         started_at = null
   where id = k_step23 and tenant_id = k_tenant and state = 'ACTIVE';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'STEP22-00013-RECOVERY-01: step 23 update affected % rows, expected exactly 1', n;
  end if;

  -- =========================================================================
  -- 3. CORRECTIVE AUDIT — added, never substituted
  -- =========================================================================
  -- `actor_id` is NULL on purpose: no operator performed these writes. A human
  -- dispatched the migration through the governed production gate, and that
  -- approval is the authority — recording a person here would attribute to them
  -- an act they did not perform in the application.
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, after)
  values
    (k_tenant, null, k_action, 'process_step_execution', k_step22, jsonb_build_object(
      'migration', '20261008000001_step22_00013_recovery',
      'dossier', 'EFT-IMP-2026-00013',
      'file_id', k_file,
      'step_key', 'billing_dispatch',
      'from_state', 'COMPLETED',
      'to_state', 'ACTIVE',
      'cleared', jsonb_build_array('submitted_by', 'submitted_at', 'completed_at', 'evidence_summary'),
      'preserved', jsonb_build_array('assigned_user_id', 'assigned_role_code', 'started_at'),
      'reason', 'The generic control closed step 22 while the invoice was only VALIDATED: no official number, no issue date, no official document, no delivery. Reopened so the governed issuance action can perform a genuine issuance.',
      'corrects_audit_event', jsonb_build_object(
        'action', 'process.step.completed', 'occurred_at', k_false_completion, 'actor_id', k_finance),
      'invoice_unchanged', k_invoice)),

    (k_tenant, null, k_action, 'process_step_execution', k_step23, jsonb_build_object(
      'migration', '20261008000001_step22_00013_recovery',
      'dossier', 'EFT-IMP-2026-00013',
      'file_id', k_file,
      'step_key', 'administration_deposit_prep',
      'from_state', 'ACTIVE',
      'to_state', 'PENDING',
      'cleared', jsonb_build_array('assigned_user_id', 'started_at'),
      'preserved', jsonb_build_array('assigned_role_code'),
      'reason', 'Its prerequisite billing_dispatch is no longer complete, so neither ACTIVE nor AVAILABLE is truthful. Un-promoted so the genuine completion of step 22 promotes it properly. The claim itself is preserved in audit_log and administration.demo re-claims the step after issuance.',
      'preserves_audit_event', jsonb_build_object(
        'action', 'process.step.activated', 'occurred_at', k_preserved_claim, 'actor_id', k_admin),
      'claim_not_erased_from_history', true));

  raise notice 'STEP22-00013-RECOVERY-01 applied: step 22 ACTIVE (claim preserved), step 23 PENDING, invoice untouched, 2 corrective audit rows written.';
end $$;
