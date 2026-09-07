-- OPS-CUSTOMS-GAINDE-04 — two GAINDE acts, told apart at last.
-- ===========================================================================
-- THE RATIFIED BUSINESS FACTS (Effitrans, 2026-09-06 — DEC-C37..C39).
--
--   The DÉCLARANT prepares the declaration, performs the saisie in GAINDE,
--   receives a declaration/reference number, and records THAT in Effitrans.
--
--   The FINANCE customs officer then performs a DIFFERENT act: the GAINDE
--   registration WITH the duties and taxes — an ACTUAL PAYMENT, with a
--   breakdown of the individual taxes, not a single assessed total and not a
--   re-typing of the Déclarant's reference.
--
-- WHAT WAS TRUE BEFORE, AND WHY IT COULD NOT STAY. Both acts were called
-- « enregistrement GAINDE » and both were expected to live in ONE column,
-- `customs_record.external_ref`. That is not a naming problem, it is a
-- correctness one: `record_gainde_registration` refuses a reference identical
-- to the stored one, so a Déclarant who typed the true GAINDE number at step 6
-- would make Finance's step 9 PERMANENTLY unperformable and
-- `gainde_registration` permanently unsatisfiable. One column cannot carry two
-- acts when one of them refuses to repeat the other.
--
-- ---------------------------------------------------------------------------
-- WHY A DEDICATED COLUMN AND NOT `declaration_number`
-- ---------------------------------------------------------------------------
-- `declaration_number` is the Déclarant's own paperwork field, writable through
-- the ordinary metadata form, and nothing establishes that it means the same
-- thing as the reference GAINDE hands back. Overloading it would make an
-- existing field silently change meaning on every dossier that already has one.
-- A new, named, nullable column asserts nothing about history.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE TABLE FOR THE TAXES, AND NOT COLUMNS ON `customs_record`
-- ---------------------------------------------------------------------------
-- TWO reasons, either of which is sufficient.
--
--   1. RATIFIED (DEC-C39): the fiscal detail is INTERNAL Effitrans data. The
--      portal policy on `customs_record` is `for select ... using
--      (portal_can_read_file(file_id) ...)` with NO column list, so every
--      column of that table is readable by a customer whatever the application
--      selects. A duties breakdown added there would be exposed by
--      construction. Migration 135 made exactly this ruling for transport
--      mission data; this follows it.
--   2. A payment has LINES. « Do not hard-code DD/TVA/PCS/PCC/COSEC/RS as
--      schema columns » — and no canonical customs tax-code catalogue exists in
--      this platform, so the lines carry a governed code and a French label
--      rather than a foreign key to a catalogue that would have to be invented.
--
-- ---------------------------------------------------------------------------
-- ONE MONEY AUTHORITY (§8 of the ratification)
-- ---------------------------------------------------------------------------
-- `finance_request` / `CUSTOMS_DUTY` already models « may this money be spent,
-- and who approved it » — a request with a maker/checker review, a disbursement
-- lifecycle and a conversion path to a customer charge. This table models
-- something else entirely: the EXECUTION RECORD of the customs act, what was
-- actually paid at GAINDE and how it breaks down. It has:
--
--   * NO approval lifecycle — no REQUESTED/APPROVED/REJECTED, no reviewer.
--     It records an act that happened; it never authorizes one.
--   * NO path to `billing_charge`. Re-invoicing stays `finance_request`'s.
--   * an OPTIONAL `finance_request_id`, so that where a CUSTOMS_DUTY request
--     preceded the payment the execution can be SETTLED against it and the two
--     planes stay joined rather than parallel.
--
-- So there is still exactly one authority over money leaving the company, and
-- it is `finance_request`. Recording what GAINDE charged is not a second one.
--
-- ---------------------------------------------------------------------------
-- ONE FINANCE REGISTRATION ACTION
-- ---------------------------------------------------------------------------
-- The 3-argument `record_gainde_registration` is DROPPED, not left beside its
-- successor. Two competing registration paths — one that records taxes and one
-- that does not — would let the incomplete act keep happening, which is the
-- defect this migration exists to end.
--
-- ---------------------------------------------------------------------------
-- ADDITIVE, TENANT-SAFE, RE-RUN SAFE. Nothing is backfilled: inventing a
-- payment that never happened would be worse than having none. Every existing
-- dossier stays valid with the new column null and no payment row, and every
-- dossier already carrying `gainde_registered_at` keeps it — that milestone was
-- true, it was simply incomplete.
-- ===========================================================================

-- ===========================================================================
-- 1. The Déclarant's declaration reference — step 6, his own fact.
-- ===========================================================================
alter table public.customs_record
  -- The reference GAINDE returns to the Déclarant after his saisie. NOT
  -- `external_ref`, which belongs to Finance's step-9 act (see the header).
  add column if not exists gainde_declaration_reference    text,
  add column if not exists gainde_declaration_recorded_by  uuid references public.app_user (id),
  add column if not exists gainde_declaration_recorded_at  timestamptz;

do $$
begin
  -- A reference cannot exist without an author and a date, and an author
  -- cannot exist without a reference. Half a fact is not a fact.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.customs_record'::regclass
       and conname = 'customs_declaration_reference_complete'
  ) then
    alter table public.customs_record
      add constraint customs_declaration_reference_complete check (
        (gainde_declaration_reference is null
           and gainde_declaration_recorded_by is null
           and gainde_declaration_recorded_at is null)
        or
        (gainde_declaration_reference is not null
           and gainde_declaration_recorded_by is not null
           and gainde_declaration_recorded_at is not null)
      );
  end if;
end $$;

comment on column public.customs_record.gainde_declaration_reference is
  'DEC-C38 — the declaration/reference number GAINDE returns to the DÉCLARANT after his saisie (step 6). Distinct from external_ref, which is Finance''s step-9 registration reference. The two are different business acts and must never share a column.';

-- ===========================================================================
-- 2. Finance's tax payment — the execution record of step 9.
-- ===========================================================================
create table if not exists public.gainde_tax_payment (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  file_id             uuid not null references public.operational_file (id) on delete cascade,
  customs_record_id   uuid not null references public.customs_record (id) on delete cascade,

  -- The authorization this execution settles, when one exists. OPTIONAL by
  -- design: `finance_request` is dark today and the customs-finance seat cannot
  -- reach it, so REQUIRING it would make step 9 unperformable. Nullable keeps
  -- the join available without inventing a dependency.
  finance_request_id  uuid references public.finance_request (id),

  paid_at             timestamptz not null,
  paid_by             uuid not null references public.app_user (id),

  -- Integer MINOR units, per the platform's money doctrine: XOF has no minor
  -- unit in practice, but the doctrine is uniform and a float would be worse
  -- everywhere else. Strictly positive — a zero-franc payment is not a payment.
  currency            text   not null default 'XOF' check (currency = upper(currency) and length(currency) = 3),
  total_paid_minor    bigint not null check (total_paid_minor > 0),

  -- The quittance / receipt reference GAINDE issues for the payment. Mandatory:
  -- an unevidenced payment of public money is precisely what this records
  -- against.
  quittance_reference text not null check (btrim(quittance_reference) <> ''),

  -- Corroborating document, when one is attached. The document store is the
  -- existing one — this creates no second document system.
  evidence_document_id uuid references public.document (id),

  -- THE CORRECTION DOOR. A payment is never edited and never deleted: it is
  -- VOIDED, with a motif and an author, and a replacement is recorded. That
  -- keeps the wrong figure visible, which is the whole point of an execution
  -- ledger.
  voided_at           timestamptz,
  voided_by           uuid references public.app_user (id),
  void_reason         text,

  created_at          timestamptz not null default now(),
  created_by          uuid not null references public.app_user (id),

  -- A void is all three or none of them. A voided payment with no motif would
  -- be an unexplained erasure, which is the one thing this door must not allow.
  constraint gainde_tax_payment_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and btrim(coalesce(void_reason, '')) <> '')
  )
);

create table if not exists public.gainde_tax_payment_line (
  id           uuid primary key default gen_random_uuid(),
  -- Carried on the line as well as the header so the tenant guard can see this
  -- table without a join: a table the guard cannot scope is a table it cannot
  -- protect (the TENANT_SCOPED_TABLES lesson).
  tenant_id    uuid not null references public.organization (id),
  payment_id   uuid not null references public.gainde_tax_payment (id) on delete cascade,

  -- GOVERNED LINE ITEMS, not columns. Effitrans names DD, TVA, PCS, PCC, COSEC
  -- and RS today; a schema that hard-coded them would need a migration the day
  -- a seventh tax appears, and no canonical tax catalogue exists in this
  -- platform to reference instead.
  tax_code     text   not null check (btrim(tax_code) <> ''),
  label_fr     text   not null check (btrim(label_fr) <> ''),
  amount_minor bigint not null check (amount_minor > 0),
  ordinal      integer not null default 0,

  constraint gainde_tax_line_unique_code unique (payment_id, tax_code)
);

-- ONE live payment per customs record. Step 9 is one act; a second live one
-- would mean the dossier had been registered twice. Voided rows stay, which is
-- what makes the correction door auditable rather than destructive.
create unique index if not exists uq_gainde_tax_payment_live
  on public.gainde_tax_payment (customs_record_id)
  where voided_at is null;

create index if not exists idx_gainde_tax_payment_file on public.gainde_tax_payment (file_id);
create index if not exists idx_gainde_tax_line_payment on public.gainde_tax_payment_line (payment_id);

comment on table public.gainde_tax_payment is
  'DEC-C39 — the EXECUTION record of Finance''s step-9 GAINDE registration: what was actually paid, with a per-tax breakdown. NOT an authorization: finance_request/CUSTOMS_DUTY remains the single authority over money leaving the company, and finance_request_id links this execution to it when one exists. Staff-only: no portal policy, ever, without an explicit ruling.';

-- ===========================================================================
-- 3. The sum must reconcile — checked at COMMIT, not per statement.
--
-- DEFERRABLE INITIALLY DEFERRED on purpose: the header is inserted before its
-- lines, so an immediate check would refuse every legitimate payment. Deferring
-- to commit means the transaction as a whole must balance, which is the actual
-- rule. A payment with no lines is refused too — a total with no breakdown is
-- what the ratification set out to replace.
-- ===========================================================================
create or replace function public.assert_gainde_tax_payment_balances()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment uuid;
  v_total   bigint;
  v_sum     bigint;
  v_voided  timestamptz;
  v_lines   integer;
begin
  -- ONE function, TWO tables with different shapes — so the row's identity is
  -- resolved from the table it came from, never by trying fields in turn.
  -- `coalesce(new.payment_id, new.id, …)` reads plausibly and raises « record
  -- "new" has no field "payment_id" » the moment it fires on the HEADER table:
  -- PL/pgSQL resolves record fields at runtime, so a field that does not exist
  -- is an error rather than a null. And NEW is null on DELETE, OLD on INSERT,
  -- so each is read only where it exists.
  if tg_table_name = 'gainde_tax_payment' then
    v_payment := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_payment := case when tg_op = 'DELETE' then old.payment_id else new.payment_id end;
  end if;
  select total_paid_minor, voided_at into v_total, v_voided
    from public.gainde_tax_payment where id = v_payment;
  -- The header is gone (cascade delete): there is nothing left to balance.
  if not found then return null; end if;
  -- A voided payment is history. Re-balancing it would mean editing it.
  if v_voided is not null then return null; end if;

  select coalesce(sum(amount_minor), 0), count(*) into v_sum, v_lines
    from public.gainde_tax_payment_line where payment_id = v_payment;

  if v_lines = 0 then
    raise exception 'tax_lines_required: a GAINDE tax payment must carry its breakdown';
  end if;
  if v_sum <> v_total then
    raise exception 'tax_total_mismatch: lines total % but the payment records %', v_sum, v_total;
  end if;
  return null;
end $$;

drop trigger if exists trg_gainde_tax_payment_balances on public.gainde_tax_payment;
create constraint trigger trg_gainde_tax_payment_balances
  after insert or update on public.gainde_tax_payment
  deferrable initially deferred
  for each row execute function public.assert_gainde_tax_payment_balances();

drop trigger if exists trg_gainde_tax_line_balances on public.gainde_tax_payment_line;
create constraint trigger trg_gainde_tax_line_balances
  after insert or update or delete on public.gainde_tax_payment_line
  deferrable initially deferred
  for each row execute function public.assert_gainde_tax_payment_balances();

-- ===========================================================================
-- 4. RLS — STAFF ONLY. No portal policy, by ratification (DEC-C39).
--
-- Modelled on `finance_request` (migration 20260723000002 §3): SELECT for tenant
-- staff who hold the customs-finance capability AND can see the dossier. Every
-- write goes through the service-role RPC below — there is no write policy, so
-- the actions ARE the boundary.
-- ===========================================================================
alter table public.gainde_tax_payment      enable row level security;
alter table public.gainde_tax_payment_line enable row level security;

drop policy if exists gainde_tax_payment_select on public.gainde_tax_payment;
create policy gainde_tax_payment_select on public.gainde_tax_payment
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('customs:read')
    and public.can_read_file(file_id)
  );

drop policy if exists gainde_tax_payment_line_select on public.gainde_tax_payment_line;
create policy gainde_tax_payment_line_select on public.gainde_tax_payment_line
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and exists (
      select 1 from public.gainde_tax_payment p
       where p.id = payment_id
         and p.tenant_id = public.auth_tenant_id()
         and public.has_permission('customs:read')
         and public.can_read_file(p.file_id)
    )
  );

grant select on public.gainde_tax_payment      to authenticated;
grant select on public.gainde_tax_payment_line to authenticated;

-- ===========================================================================
-- 5. record_declaration_reference — the DÉCLARANT's act, step 6.
--
-- Authority is `customs:update`, which the Déclarant already holds for his own
-- step. NO new permission, and `customs:register` is emphatically NOT granted
-- to him: that is Finance's.
--
-- THE CORRECTION DOOR. Before the Chef validates, the Déclarant may re-record
-- freely — it is his step and his working data. AFTER validation a motif
-- becomes MANDATORY and the act is emitted as a correction, so a typo is never
-- permanently unfixable and never silently rewritten either. This does not
-- weaken D4: the five governed elements keep their own door, and this column is
-- not one of them.
-- ===========================================================================
create or replace function public.record_declaration_reference(
  p_customs_id uuid,
  p_reference  text,
  p_actor      uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_reviewed timestamptz;
  v_prev     text;
  v_ref      text := nullif(btrim(coalesce(p_reference, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_ref is null then
    raise exception 'reference_required: a GAINDE declaration reference is required';
  end if;
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, reviewed_at, gainde_declaration_reference
    into v_tenant, v_file, v_reviewed, v_prev
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  -- INV-7 — a definer function that takes an actor proves that actor's
  -- authority in the database rather than believing the caller.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:update', 'SERVICE');

  if v_prev is not distinct from v_ref then
    raise exception 'reference_unchanged: this declaration reference is already recorded';
  end if;

  -- After the Chef's validation this is a CORRECTION and must be explained.
  if v_reviewed is not null and v_reason is null then
    raise exception 'reason_required: correcting a validated declaration reference requires a motif';
  end if;

  update public.customs_record
     set gainde_declaration_reference   = v_ref,
         gainde_declaration_recorded_by = p_actor,
         gainde_declaration_recorded_at = now(),
         updated_by                     = p_actor
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => case when v_reviewed is null
                            then 'CUSTOMS_DECLARATION_REFERENCE_RECORDED'
                            else 'CUSTOMS_DECLARATION_REFERENCE_CORRECTED' end,
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    -- `reference` and `corrected` only: the WES-9C metadata allow-list for this
    -- domain admits nothing else, and money never travels in an event.
    p_metadata      => jsonb_build_object('reference', v_ref, 'corrected', v_prev is not null)
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file, 'corrected', v_prev is not null);
end $$;

revoke execute on function public.record_declaration_reference(uuid, text, uuid, text) from public;
revoke execute on function public.record_declaration_reference(uuid, text, uuid, text) from anon;
revoke execute on function public.record_declaration_reference(uuid, text, uuid, text) from authenticated;
grant  execute on function public.record_declaration_reference(uuid, text, uuid, text) to service_role;

-- ===========================================================================
-- 6. record_gainde_registration — Finance's act, step 9, WITH the taxes.
--
-- Replaces the 3-argument version, which recorded a reference and called that a
-- registration. Same name, same permission, same milestone columns — a
-- COMPLETED act rather than a second one.
-- ===========================================================================
drop function if exists public.record_gainde_registration(uuid, text, uuid);

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

  if v_prev is not distinct from v_ref then
    raise exception 'reference_unchanged: this GAINDE reference is already recorded';
  end if;

  -- A RE-REGISTRATION IS A CORRECTION, and the correction door is the void.
  -- `record_gainde_registration` has always allowed a second call with a
  -- different reference (that is how a mistyped registration is repaired), and
  -- one live payment per record is the rule — so the previous one is superseded
  -- here rather than edited, keeping the earlier figures visible. Nothing is
  -- deleted: the void carries its reason, its author and its moment.
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
    v_total := v_total + (v_line ->> 'amountMinor')::bigint;
  end loop;

  -- Written after the lines so the deferred balance trigger compares the real
  -- figures. The placeholder above exists only because the column is NOT NULL
  -- and strictly positive.
  update public.gainde_tax_payment set total_paid_minor = v_total where id = v_payment;

  -- The MILESTONE. Unchanged in meaning and in columns — what changed is that
  -- it can no longer be reached without the taxes.
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

revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from public;
revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from anon;
revoke execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) from authenticated;
grant  execute on function public.record_gainde_registration(uuid, text, uuid, timestamptz, text, text, jsonb) to service_role;

-- ===========================================================================
-- 7. void_gainde_tax_payment — the correction door.
--
-- A payment is never edited and never deleted. It is voided with a motif, and a
-- replacement is recorded through the ordinary path — so the wrong figure stays
-- visible, which is what an execution ledger is for.
-- ===========================================================================
create or replace function public.void_gainde_tax_payment(
  p_payment_id uuid,
  p_actor      uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_file   uuid;
  v_customs uuid;
  v_voided timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'reason_required: voiding a recorded payment requires a motif';
  end if;

  select tenant_id, file_id, customs_record_id, voided_at
    into v_tenant, v_file, v_customs, v_voided
    from public.gainde_tax_payment where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if v_voided is not null then
    raise exception 'already_decided: this payment is already voided';
  end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:register', 'SERVICE');

  update public.gainde_tax_payment
     set voided_at = now(), voided_by = p_actor, void_reason = v_reason
   where id = p_payment_id;

  -- The milestone goes with it: a dossier whose only payment was voided is not
  -- registered any more, and pretending otherwise would leave step 9 satisfied
  -- by a payment that no longer stands.
  update public.customs_record
     set gainde_registered_at = null, gainde_registered_by = null
   where id = v_customs
     and not exists (
       select 1 from public.gainde_tax_payment
        where customs_record_id = v_customs and voided_at is null
     );

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'GAINDE_REGISTRATION_VOIDED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => v_customs,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object('corrected', true)
  );

  return jsonb_build_object('payment_id', p_payment_id, 'customs_id', v_customs);
end $$;

revoke execute on function public.void_gainde_tax_payment(uuid, uuid, text) from public;
revoke execute on function public.void_gainde_tax_payment(uuid, uuid, text) from anon;
revoke execute on function public.void_gainde_tax_payment(uuid, uuid, text) from authenticated;
grant  execute on function public.void_gainde_tax_payment(uuid, uuid, text) to service_role;


-- ===========================================================================
-- 9. Step 10 / step 11 — the receiver projection, reconciled (DEC-C40).
--
-- THE CONTRADICTION. `process_step_receiving_role` said the DÉCLARANT receives
-- at step 10 `coordinator_to_declarant`. Enforcement said otherwise:
-- `isRoutedReceiverRole` derives eligibility from the step's DEPARTMENT, and
-- step 10 belongs to `coordination`, so the engine admits the COORDINATOR and
-- refuses the Déclarant with `not_eligible_receiver`. The projection therefore
-- gave a Déclarant dossier VISIBILITY for a reception the engine would then
-- refuse — a promise the platform could not keep.
--
-- THE RULING (2026-09-06). Step 10 is the COORDINATOR's return handoff; step 11
-- is the Déclarant's rattachement AND its verification. So the Déclarant's
-- receiving role moves to the step where he actually receives, and step 10
-- names the role enforcement already admits. Nothing is granted and nothing is
-- widened: this table is a READ-ONLY visibility projection and says so of
-- itself — « Never a source of mutation authority. »
--
-- The superseded row is DELETED rather than annotated because it is a
-- projection, not a record of anything that happened: the history of the
-- ruling lives in DEC-C40 and in the documents that carried the divergence.
-- ===========================================================================
delete from public.process_step_receiving_role
 where step_key = 'coordinator_to_declarant' and role_code = 'CUSTOMS_DECLARANT';

insert into public.process_step_receiving_role (step_key, role_code, note) values
  ('coordinator_to_declarant',  'COORDINATOR',
   'RATIFIED 2026-09-06 (DEC-C40): step 10 is the Coordinator''s RETURN handoff from Finance douane. Matches what isRoutedReceiverRole already enforces from the step department.'),
  ('gainde_document_submission','CUSTOMS_DECLARANT',
   'RATIFIED 2026-09-06 (DEC-C40): the Declarant receives at step 11, where he performs and verifies the rattachement. Moved from step 10, where the projection promised a reception the engine refused.')
on conflict (step_key, role_code) do nothing;
-- ===========================================================================
-- 8. Application-time assertions. These run once, now, and can never run
--    again — which is why the companion verifier exists.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'customs_record'
       and column_name = 'gainde_declaration_reference'
  ) then
    raise exception 'MIGRATION FAILED: gainde_declaration_reference missing';
  end if;

  -- ARITY, not the identity string. `pg_get_function_identity_arguments`
  -- includes parameter NAMES — the live function reads
  -- « p_customs_id uuid, p_reference text, p_actor uuid » — so comparing it to
  -- 'uuid, text, uuid' can never match, and this guard would have passed even
  -- if the DROP had silently failed. An assertion that cannot fail is worse
  -- than no assertion: it reads as protection.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_gainde_registration'
       and p.pronargs = 3
  ) then
    raise exception 'MIGRATION FAILED: the 3-arg record_gainde_registration still exists — two competing Finance registration paths';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_gainde_registration'
       and p.pronargs = 7
  ) then
    raise exception 'MIGRATION FAILED: the 7-arg record_gainde_registration is missing';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('gainde_tax_payment', 'gainde_tax_payment_line')
       and qual ilike '%portal_can_read_file%'
  ) then
    raise exception 'MIGRATION FAILED: a portal policy on the tax payment tables — DEC-C39 forbids it';
  end if;
end $$;
