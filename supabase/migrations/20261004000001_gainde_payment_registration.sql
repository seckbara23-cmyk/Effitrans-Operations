-- UAT-STEP9-FINANCE-01 — step 9 is a PAYMENT, so it must guard the payment.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- THE DEFECT, as it executed on EFT-IMP-2026-00011.
--
-- Finance (fonction douane) claimed step 9, filled in the quittance, the
-- payment date and the six tax lines, submitted with the dossier's existing
-- GAINDE reference — and read « Cette référence GAINDE est déjà enregistrée. »
-- The card stayed « Non enregistré » and no payment existed: the dossier had
-- `gainde_registered_at` null and zero rows in `gainde_tax_payment`.
--
-- WHY. `record_gainde_registration` still carries the guard it was born with:
--
--     if v_prev is not distinct from v_ref then
--       raise exception 'reference_unchanged: this GAINDE reference is already recorded';
--
-- That guard was CORRECT for the act this function used to perform. Before
-- 20261001000001, step 9 WAS a reference registration: writing `external_ref`
-- was the whole deed, and re-submitting the string already stored meant the
-- operator had changed nothing. Migration 20261001000001 turned the act into
-- an actual PAYMENT — paid_at, quittance, a per-tax breakdown, a ledger row,
-- one live payment per record — and left the guard pointing at the reference.
--
-- So the function now refuses on a fact that no longer decides anything.
-- Whether the reference string moved has no bearing on whether Finance paid
-- the duties; the reference is the DECLARATION Finance pays AGAINST, and
-- reusing it is not a duplicate, it is the point. Worse, it is not a chance
-- collision: the Finance form defaults its reference field to the stored
-- `external_ref`, so on any dossier where that column already holds a value
-- the default submission is guaranteed to equal it. Step 9 was unperformable
-- for every such dossier, and the only way through was to type a reference
-- that was NOT the declaration's — that is, to falsify it.
--
-- WHAT REPLACES IT. The guard moves from the wrong fact to the right one: an
-- ACCIDENTAL DUPLICATE PAYMENT. A live (non-voided) payment on this customs
-- record carrying the same quittance, the same instant and the same total is a
-- double submission, and is refused with `payment_unchanged`. A payment whose
-- FIGURES differ is a correction, and keeps the behaviour this function has
-- always had: the previous one is voided with a motif — never edited, never
-- deleted — and superseded, so the earlier figures stay visible.
--
-- WHAT IS DELIBERATELY NOT WEAKENED:
--   • `record_declaration_reference` is untouched. Re-recording the SAME
--     declaration reference is still refused there, because THAT function's
--     act really is the reference, and its uniqueness is real.
--   • the declaration reference column is never written here. Two acts, two
--     columns, unchanged — what changes is only which fact step 9 guards.
--   • `assert_gainde_tax_payment_balances` still holds the lines to the total.
--   • `assert_actor_authority(..., 'customs:register', ...)` is unchanged: the
--     database still establishes Finance's authority itself, and no role is
--     widened to reach this.
--   • the emitted business event, its metadata allow-list and its money ban
--     are unchanged.
--
-- ONE FUNCTION IS REPLACED. No table, no column, no constraint, no grant and
-- no data is touched by this migration.
-- ===========================================================================

create or replace function public.record_gainde_registration(
  p_customs_id uuid,
  p_reference  text,
  p_actor      uuid,
  p_paid_at    timestamptz,
  p_currency   text,
  p_quittance  text,
  p_lines      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_prev     text;
  v_payment  uuid;
  v_total    bigint := 0;
  v_line     jsonb;
  v_count    integer := 0;
  v_ref      text := nullif(btrim(coalesce(p_reference, '')), '');
  v_quit     text := nullif(btrim(coalesce(p_quittance, '')), '');
  v_cur      text := upper(nullif(btrim(coalesce(p_currency, 'XOF')), ''));
begin
  if v_ref is null then
    raise exception 'reference_required: a GAINDE reference is required';
  end if;
  if v_quit is null then
    raise exception 'quittance_required: the payment receipt reference is required';
  end if;
  if p_paid_at is null then
    raise exception 'paid_at_required: the payment date is required';
  end if;
  if p_actor is null then
    raise exception 'an actor is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'tax_lines_required: a GAINDE tax payment must carry its breakdown';
  end if;

  select tenant_id, file_id, external_ref
    into v_tenant, v_file, v_prev
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:register', 'SERVICE');

  -- The total, computed BEFORE anything is written, because the duplicate
  -- guard below compares against it. The deferred balance trigger checks the
  -- same arithmetic independently once the lines are in, so a discrepancy
  -- between this sum and the stored lines aborts the transaction.
  select coalesce(sum((e ->> 'amountMinor')::bigint), 0)
    into v_total
    from jsonb_array_elements(p_lines) e;

  -- ACCIDENTAL DUPLICATE, which is what step 9 actually has to refuse.
  --
  -- Same receipt, same instant, same total, still live: that is one payment
  -- submitted twice, not two payments. It is refused rather than absorbed so
  -- the operator learns the first one landed — silently voiding and re-writing
  -- an identical row would churn the ledger and hide a double click.
  --
  -- NOTE what this does NOT ask: whether `external_ref` already equals
  -- `v_ref`. Finance registers a payment against the declaration the Déclarant
  -- recorded at step 6, so reusing that reference is correct and expected.
  if exists (
    select 1
      from public.gainde_tax_payment gp
     where gp.customs_record_id = p_customs_id
       and gp.voided_at is null
       and gp.quittance_reference = v_quit
       and gp.paid_at = p_paid_at
       and gp.total_paid_minor = v_total
  ) then
    raise exception 'payment_unchanged: this GAINDE payment is already recorded';
  end if;

  -- A RE-REGISTRATION WITH DIFFERENT FIGURES IS A CORRECTION, and the
  -- correction door is the void. One live payment per record is the rule, so
  -- the previous one is superseded here rather than edited, keeping the
  -- earlier figures visible. Nothing is deleted: the void carries its reason,
  -- its author and its moment.
  update public.gainde_tax_payment
     set voided_at   = now(),
         voided_by   = p_actor,
         void_reason = 'Remplacé par un nouvel enregistrement GAINDE'
   where customs_record_id = p_customs_id and voided_at is null;

  insert into public.gainde_tax_payment
    (tenant_id, file_id, customs_record_id, paid_at, paid_by,
     currency, total_paid_minor, quittance_reference, created_by)
  values
    (v_tenant, v_file, p_customs_id, p_paid_at, p_actor,
     coalesce(v_cur, 'XOF'), 1, v_quit, p_actor)
  returning id into v_payment;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_count := v_count + 1;
    insert into public.gainde_tax_payment_line
      (tenant_id, payment_id, tax_code, label_fr, amount_minor, ordinal)
    values (
      v_tenant, v_payment,
      btrim(coalesce(v_line ->> 'taxCode', '')),
      btrim(coalesce(v_line ->> 'labelFr', '')),
      (v_line ->> 'amountMinor')::bigint,
      v_count
    );
  end loop;

  -- Written after the lines so the deferred balance trigger compares the real
  -- figures. The placeholder above exists only because the column is NOT NULL
  -- and strictly positive.
  update public.gainde_tax_payment set total_paid_minor = v_total where id = v_payment;

  -- The MILESTONE. Unchanged in meaning and in columns. `external_ref` is
  -- FINANCE's registration reference and is written here as it always was;
  -- `gainde_declaration_reference` — the Déclarant's step-6 fact — is not
  -- touched, read or overwritten by this function.
  update public.customs_record
     set external_ref          = v_ref,
         gainde_registered_at  = now(),
         gainde_registered_by  = p_actor
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'GAINDE_REGISTRATION_RECORDED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    -- NO money in the event. WES-9C bans it by doctrine and this domain's
    -- allow-list admits exactly `reference` and `corrected`; the figures live
    -- in the payment ledger, where they are governed.
    p_metadata      => jsonb_build_object('reference', v_ref, 'corrected', v_prev is not null)
  );

  return jsonb_build_object(
    'customs_id', p_customs_id, 'file_id', v_file,
    'payment_id', v_payment, 'lines', v_count
  );
end $$;

-- `create or replace` preserves the ACL, and the ACL is the control: this
-- function is SECURITY DEFINER and writes money. Re-stated so the grant is a
-- fact of THIS migration rather than an inheritance nobody re-reads.
revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from public;
revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from anon;
revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from authenticated;
grant  execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) to service_role;

-- ===========================================================================
-- Self-assertions — the moment of application.
-- ===========================================================================
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_gainde_registration'
     and p.oid::regprocedure::text like '%timestamp with time zone%';
  if v_src is null then
    raise exception 'STEP9: the 7-argument payment RPC is missing';
  end if;

  -- The reference-identity guard is GONE. Pinned on the predicate rather than
  -- on the token, because the token is reused by the declaration function and
  -- would still match there.
  if v_src ~ 'v_prev\s+is\s+not\s+distinct\s+from\s+v_ref' then
    raise exception 'STEP9: the payment RPC still refuses a reused declaration reference';
  end if;

  -- …and the payment guard is present, on the payment.
  if v_src !~ 'payment_unchanged' then
    raise exception 'STEP9: the payment RPC has no duplicate-payment guard';
  end if;
  if v_src !~ 'voided_at\s+is\s+null' then
    raise exception 'STEP9: the duplicate-payment guard must consider only LIVE payments';
  end if;

  -- The declaration act is untouched, and still refuses its own duplicate.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_declaration_reference';
  if v_src is null or v_src !~ 'reference_unchanged' then
    raise exception 'STEP9: declaration-reference uniqueness must NOT be weakened';
  end if;
  if v_src ~ 'external_ref\s*=' then
    raise exception 'STEP9: the declaration act must never write Finance''s column';
  end if;

  -- The arithmetic is still somebody's job.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'assert_gainde_tax_payment_balances'
  ) then
    raise exception 'STEP9: the lines-equal-total trigger function is missing';
  end if;

  -- Authority is still established by the database, not asserted by a caller.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_gainde_registration'
     and p.oid::regprocedure::text like '%timestamp with time zone%';
  if v_src !~ 'assert_actor_authority' then
    raise exception 'STEP9: the payment RPC must assert actor authority (INV-7)';
  end if;
  if v_src !~ 'customs:register' then
    raise exception 'STEP9: the payment RPC must demand customs:register';
  end if;
end $$;
