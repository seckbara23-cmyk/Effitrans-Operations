-- 20260714000001_billing_deposit_collections.sql
-- Effitrans Operations Platform — PHASE 5.0D: official steps 18-26.
-- ---------------------------------------------------------------------------
-- Completes the post-delivery chain: completeness reviews -> billing draft ->
-- Finance validation -> invoice email -> physical deposit -> courier -> proof ->
-- collections -> closure.
--
-- SMALLEST ADDITIVE SCHEMA. Everything that already exists is REUSED, not rebuilt:
--   * partial payments        -> public.payment (amount, reversed_at) already works
--   * receipts/payment proofs -> the PAYMENT_RECEIPT document type already exists
--   * invoice email delivery  -> public.communication_message already carries
--                                status(QUEUED/SENT/FAILED), retry_count, last_error,
--                                sent_at and related_entity_id. NO new email table.
--   * proof storage           -> public.document + the private `documents` bucket
--   * permissions/roles       -> admin_service:manage, courier:deposit,
--                                collections:manage all shipped in Phase 5.0B
--   * aging                   -> DERIVED from invoice.due_date + payments. No table.
--   * closure                 -> a process-engine gate. No table.
--
-- So this migration adds exactly: 11 document types, a maker-checker ALTER on
-- invoice, and TWO tables (invoice_deposit, collection_follow_up).
--
-- CLEAN-REPLAY (822c0d7): document_type and permission are GLOBAL tables (no
-- tenant_id), so their literal inserts are safe on an empty database. No literal
-- tenant-scoped row is inserted here at all.
--
-- Decisions: DEC-A12 (additive/forward-only), DEC-C01 (tenant_id + RLS).

-- ===========================================================================
-- 1. The remaining official document types (Phase 5.0A gap list).
--
--    THE BORDEREAU SPLIT. Until now ONE type, DELIVERY_NOTE ("Bon de livraison /
--    POD"), served BOTH the delivery slip prepared at step 3 AND the SIGNED POD
--    collected at steps 16-17. That conflation is not just untidy — it made the
--    official pickup gate UNSATISFIABLE: the gate requires a Bordereau de
--    Livraison before pickup, but the only type that could satisfy it was the
--    signed POD, which by definition does not exist until after delivery.
--
--    Fix, chosen to keep the shipped driver flow byte-for-byte intact:
--      DELIVERY_NOTE        stays the SIGNED POD. Untouched. The driver's
--                           `pod` evidence kind, canReceivePod() and the Finance
--                           handoff all keep pointing at it and are unchanged.
--      BORDEREAU_LIVRAISON  NEW. The unsigned operational delivery slip prepared
--                           by the Account Manager. This is what the pickup gate
--                           now reads.
--    No data migration, no alias, no rewrite of existing rows.
-- ===========================================================================
insert into public.document_type
  (code, label_fr, label_en, category, has_validity, required_for, conditional, sort_order)
values
  -- The split (see above).
  ('BORDEREAU_LIVRAISON',          'Bordereau de Livraison (non signé)', 'Delivery slip (unsigned)',        'operational', false, '{}',       true,  63),
  -- Commercial intake (official step 1).
  ('QUOTATION',                    'Cotation / Devis',                   'Quotation',                        'commercial',  false, '{}',       true,  10),
  ('QUOTATION_APPROVAL',           'Validation client de la cotation',   'Client quotation approval',        'commercial',  false, '{}',       true,  11),
  -- Account Manager preparation (official step 3).
  ('TRANSPORT_REQUEST',            'Demande de transport',               'Transport request',                'transport',   false, '{}',       true,  64),
  ('VENDOR_INVOICE',               'Facture tierce payable',             'Third-party payable invoice',      'financial',   false, '{}',       true,  70),
  ('SPENDING_AUTHORIZATION',       'Autorisation de dépense',            'Spending authorization',           'financial',   false, '{}',       true,  71),
  -- Customs chain (official steps 9, 11, 13).
  ('GAINDE_REGISTRATION_EVIDENCE', 'Preuve d''enregistrement GAINDE',    'GAINDE registration evidence',     'customs',     false, '{}',       true,  20),
  ('GAINDE_SUBMISSION_EVIDENCE',   'Preuve de dépôt des documents GAINDE', 'GAINDE document submission evidence', 'customs', false, '{}',    true,  21),
  ('BON_A_ENLEVER',                'Bon à Enlever (BAE)',                'Customs release note (BAE)',       'customs',     false, '{}',       true,  22),
  ('CUSTOMS_EXIT_EVIDENCE',        'Preuve de sortie de zone douanière', 'Customs exit evidence',            'customs',     false, '{}',       true,  23),
  -- Physical invoice deposit (official step 24).
  ('PROOF_OF_DEPOSIT',             'Preuve de dépôt physique',           'Proof of physical deposit',        'financial',   false, '{}',       true,  72)
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Invoice maker-checker (official steps 20-21). ADDITIVE ALTER — the existing
--    invoice rows, statuses and actions are untouched.
--
--    `VALIDATED` is inserted between DRAFT and ISSUED. Nothing in the shipped
--    finance module can produce it (canIssue() only accepts DRAFT), so with the
--    process engine dark, invoice behaviour is exactly what it was.
-- ===========================================================================
alter table public.invoice
  drop constraint if exists invoice_status_check;

alter table public.invoice
  add constraint invoice_status_check
    check (status in ('DRAFT', 'VALIDATED', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'));

alter table public.invoice
  add column if not exists submitted_by      uuid references public.app_user (id),
  add column if not exists submitted_at      timestamptz,
  add column if not exists validated_by      uuid references public.app_user (id),
  add column if not exists validated_at      timestamptz,
  add column if not exists rejected_by       uuid references public.app_user (id),
  add column if not exists rejected_at       timestamptz,
  add column if not exists rejection_reason  text,
  -- How many times this invoice has been sent back and redrafted. Traceable
  -- resubmission without a second billing table.
  add column if not exists revision          int not null default 1;

comment on column public.invoice.validated_by is
  'Phase 5.0D — the CHECKER (official step 21). Must differ from submitted_by; the engine enforces it on identity.';

-- Integrity: maker and checker must belong to the invoice''s tenant.
create or replace function public.enforce_invoice_actor_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
begin
  if new.submitted_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.submitted_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'invoice submitted_by belongs to another tenant';
    end if;
  end if;
  if new.validated_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.validated_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'invoice validated_by belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_invoice_actor_tenant before insert or update on public.invoice
  for each row execute function public.enforce_invoice_actor_tenant();

-- ===========================================================================
-- 3. invoice_deposit — the PHYSICAL deposit workflow (official steps 22-25).
--
--    Deliberately NOT modelled on invoice.status: a physical deposit is an
--    operational errand, not a financial state. An invoice can be emailed, in a
--    courier's bag, deposited, and still entirely unpaid — conflating the two
--    would corrupt the payment model. A courier never touches a financial status.
-- ===========================================================================
create table public.invoice_deposit (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  file_id              uuid not null references public.operational_file (id) on delete cascade,
  invoice_id           uuid not null references public.invoice (id) on delete cascade,
  status               text not null default 'PREPARATION_PENDING'
                         check (status in ('PREPARATION_PENDING', 'READY_FOR_COURIER', 'ASSIGNED',
                                           'IN_TRANSIT', 'DEPOSITED', 'PROOF_SUBMITTED',
                                           'PROOF_ACCEPTED', 'PROOF_REJECTED',
                                           'HANDED_TO_COLLECTIONS', 'CANCELLED')),
  prepared_by          uuid references public.app_user (id),
  prepared_at          timestamptz,
  courier_user_id      uuid references public.app_user (id),
  assigned_at          timestamptz,
  departed_at          timestamptz,
  deposited_at         timestamptz,
  recipient_name       text,
  recipient_role       text,
  client_location      text,
  delivery_instructions text,
  -- The proof itself lives in `document` (private bucket, server-built path).
  proof_document_id    uuid references public.document (id) on delete set null,
  returned_to_admin_at timestamptz,
  validated_by_admin   uuid references public.app_user (id),
  validated_at         timestamptz,
  rejection_reason     text,
  failure_reason       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ONE ACTIVE DEPOSIT WORKFLOW PER INVOICE. A cancelled one may be superseded.
create unique index uq_invoice_deposit_active
  on public.invoice_deposit (invoice_id) where status <> 'CANCELLED';
create index idx_invoice_deposit_tenant_status on public.invoice_deposit (tenant_id, status);
create index idx_invoice_deposit_courier on public.invoice_deposit (courier_user_id) where courier_user_id is not null;
create index idx_invoice_deposit_file on public.invoice_deposit (file_id);

create trigger trg_invoice_deposit_updated_at before update on public.invoice_deposit
  for each row execute function public.set_updated_at();

-- Integrity: tenant must match the dossier AND the invoice; the courier and the
-- admin validator must belong to that same tenant; the proof document must belong
-- to the SAME dossier (a proof cannot be borrowed from another file).
create or replace function public.enforce_invoice_deposit_integrity()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
  i_tenant uuid;
  i_file   uuid;
  u_tenant uuid;
  d_tenant uuid;
  d_file   uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'deposit tenant mismatch with dossier';
  end if;

  select tenant_id, file_id into i_tenant, i_file from public.invoice where id = new.invoice_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'deposit tenant mismatch with invoice';
  end if;
  if i_file is distinct from new.file_id then
    raise exception 'deposit invoice belongs to a different dossier';
  end if;

  if new.courier_user_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.courier_user_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'courier belongs to another tenant';
    end if;
  end if;

  if new.validated_by_admin is not null then
    select tenant_id into u_tenant from public.app_user where id = new.validated_by_admin;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'deposit validator belongs to another tenant';
    end if;
  end if;

  if new.proof_document_id is not null then
    select tenant_id, file_id into d_tenant, d_file from public.document where id = new.proof_document_id;
    if d_tenant is distinct from new.tenant_id then
      raise exception 'proof document belongs to another tenant';
    end if;
    if d_file is distinct from new.file_id then
      raise exception 'proof document belongs to another dossier';
    end if;
  end if;

  return new;
end;
$$;
create trigger trg_invoice_deposit_integrity before insert or update on public.invoice_deposit
  for each row execute function public.enforce_invoice_deposit_integrity();

-- ===========================================================================
-- 4. collection_follow_up — official step 26. Append-only relance history.
--    Aging is DERIVED (due_date + payments); it is never stored.
-- ===========================================================================
create table public.collection_follow_up (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  file_id              uuid not null references public.operational_file (id) on delete cascade,
  invoice_id           uuid not null references public.invoice (id) on delete cascade,
  performed_by         uuid references public.app_user (id),
  channel              text not null
                         check (channel in ('PHONE', 'EMAIL', 'VISIT', 'LETTER', 'OTHER')),
  outcome              text not null
                         check (outcome in ('REACHED', 'NO_ANSWER', 'PROMISE_TO_PAY', 'DISPUTED',
                                            'PARTIAL_PAYMENT_AGREED', 'ESCALATED', 'OTHER')),
  -- Operationally necessary note ONLY. Never a transcript of the conversation.
  note                 text,
  promised_payment_date date,
  next_follow_up_at    date,
  created_at           timestamptz not null default now()
);

create index idx_collection_followup_invoice on public.collection_follow_up (invoice_id);
create index idx_collection_followup_tenant on public.collection_follow_up (tenant_id, next_follow_up_at);
create index idx_collection_followup_file on public.collection_follow_up (file_id);

-- Append-only: a follow-up record is history and may never be rewritten.
create trigger trg_collection_followup_no_update before update on public.collection_follow_up
  for each row execute function public.prevent_mutation();

create or replace function public.enforce_collection_followup_integrity()
returns trigger language plpgsql as $$
declare
  i_tenant uuid;
  i_file   uuid;
  u_tenant uuid;
begin
  select tenant_id, file_id into i_tenant, i_file from public.invoice where id = new.invoice_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'follow-up tenant mismatch with invoice';
  end if;
  if i_file is distinct from new.file_id then
    raise exception 'follow-up invoice belongs to a different dossier';
  end if;
  if new.performed_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.performed_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'follow-up actor belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_collection_followup_integrity before insert on public.collection_follow_up
  for each row execute function public.enforce_collection_followup_integrity();

-- Dispute state lives on the invoice (one flag, not a second status machine).
alter table public.invoice
  add column if not exists disputed_at     timestamptz,
  add column if not exists dispute_reason  text;

-- ===========================================================================
-- 5. RLS — SELECT-only for `authenticated`, like every other business table.
--    Writes go through service-role server actions behind assertPermission().
--
--    THE COURIER RULE. A courier is a narrow identity (no finance:* at all). They
--    may read ONLY the deposits assigned to them — never another courier's, never
--    an unassigned one, and never a collection record. That is enforced here, in
--    the policy, not only in the app.
--
--    Portal users and platform admins resolve to zero rows: neither has an
--    app_user row in this tenant, so auth_tenant_id() is null.
-- ===========================================================================
alter table public.invoice_deposit     enable row level security;
alter table public.collection_follow_up enable row level security;

-- Administration / supervisors: the whole deposit workflow.
create policy invoice_deposit_select_admin on public.invoice_deposit
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('admin_service:manage')
  );

-- Collections: needs to see accepted proofs to chase the receivable.
create policy invoice_deposit_select_collections on public.invoice_deposit
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('collections:manage')
  );

-- Courier: ONLY their own assignments. Additive policy (policies are OR'd), so a
-- courier who is not the assignee matches nothing.
create policy invoice_deposit_select_courier on public.invoice_deposit
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('courier:deposit')
    and courier_user_id = auth.uid()
  );

create policy collection_follow_up_select on public.collection_follow_up
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('collections:manage')
  );

grant select on public.invoice_deposit      to authenticated;
grant select on public.collection_follow_up to authenticated;
