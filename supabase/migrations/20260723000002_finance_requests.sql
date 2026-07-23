-- 20260723000002_finance_requests.sql
-- Effitrans Operations Platform — PHASE 9.0E: Finance execution (steps 20–26 seam).
-- ---------------------------------------------------------------------------
-- ONE additive table: finance_request — the OUTBOUND money fact the existing
-- model cannot represent. Justification (audit, docs/workflow/
-- phase-9.0e-finance-execution.md §migration):
--   * public.payment is CUSTOMER money IN, hard-bound to an invoice
--     (invoice_id NOT NULL) — it cannot hold a duty/authority/supplier payout.
--   * public.billing_charge is a BILLABLE ITEM — recording every disbursement
--     there would make every expense customer-billable, which the business
--     explicitly forbids ("do not treat every disbursement as billable").
--   * process_decision records an AUTHORIZATION, never an amount/beneficiary/
--     method — "a process decision is not a payment".
-- finance_request carries the full request lifecycle in one row: request →
-- review (maker-checker) → disbursement execution → documentary evidence →
-- verification, with explicit LINKS to the existing contracts (customs_record,
-- process_decision, document, billing_charge) instead of duplicating any.
--
-- NOT a second payment table (customer receipts stay in public.payment), NOT a
-- second invoice table, NOT a new approval engine (review is two columns +
-- application maker-checker, exactly like invoice validation), NOT new document
-- storage (evidence is a FK to public.document).
--
-- NO new permission. All writes go through service-role actions gated on the
-- EXISTING finance:* catalog; RLS below is SELECT-only for tenant staff with
-- finance:read + dossier visibility. Portal users have NO policy — customers
-- never see internal finance operations.

-- ===========================================================================
-- 1. Table
-- ===========================================================================
create table public.finance_request (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  file_id                uuid not null references public.operational_file (id) on delete cascade,

  -- Explicit links to EXISTING contracts (all optional).
  customs_record_id      uuid references public.customs_record (id),
  process_decision_id    uuid references public.process_decision (id),

  -- What is being paid, to whom, and why. purpose/beneficiary are MANDATORY —
  -- an unexplained outbound payment is exactly what the workflow forbids.
  category               text not null check (category in
                           ('CUSTOMS_DUTY', 'AUTHORITY_FEE', 'SUPPLIER_EXPENSE', 'INTERNAL_COST', 'OTHER')),
  amount                 numeric(14, 2) not null check (amount > 0),
  currency               text not null default 'XOF',
  purpose                text not null,
  beneficiary            text not null,
  -- Reimbursable = MAY later become a customer billing_charge. Internal costs
  -- and non-reimbursable duties never silently reach an invoice.
  reimbursable           boolean not null default false,

  -- Request lifecycle. REJECTED / DISBURSED / CANCELLED are terminal;
  -- RETURNED goes back to the requester and may be resubmitted (→ REQUESTED).
  status                 text not null default 'REQUESTED' check (status in
                           ('REQUESTED', 'APPROVED', 'REJECTED', 'RETURNED', 'DISBURSED', 'CANCELLED')),
  requested_by           uuid not null references public.app_user (id),
  requested_at           timestamptz not null default now(),

  -- Review (maker-checker: reviewer ≠ requester, application-enforced on identity).
  reviewed_by            uuid references public.app_user (id),
  reviewed_at            timestamptz,
  review_note            text,

  -- Disbursement EXECUTION — set only by the explicit disbursement action,
  -- never implied by approval. Same method vocabulary as public.payment.
  disbursed_amount       numeric(14, 2) check (disbursed_amount is null or disbursed_amount > 0),
  disbursement_method    text check (disbursement_method is null or disbursement_method in
                           ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'WAVE', 'ORANGE_MONEY', 'OTHER')),
  disbursement_reference text,
  disbursed_at           date,
  disbursed_by           uuid references public.app_user (id),

  -- Documentary evidence: a FK into the EXISTING document store. Submission is
  -- not verification; verification is a distinct audited act by a distinct actor.
  evidence_status        text not null default 'NONE' check (evidence_status in
                           ('NONE', 'SUBMITTED', 'VERIFIED', 'REJECTED')),
  evidence_document_id   uuid references public.document (id),
  evidence_verified_by   uuid references public.app_user (id),
  evidence_verified_at   timestamptz,
  evidence_note          text,

  -- Set when (and only when) a reimbursable, disbursed request is explicitly
  -- converted into a customer-billable charge. Never automatic.
  billing_charge_id      uuid references public.billing_charge (id),

  -- Idempotency backstop for duplicate REQUESTS (the duplicate-DISBURSEMENT
  -- guard is the status CAS: update … where status = 'APPROVED').
  dedup_key              text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_finance_request_file on public.finance_request (file_id);
create index idx_finance_request_tenant_status on public.finance_request (tenant_id, status);
create unique index uq_finance_request_dedup on public.finance_request (dedup_key) where dedup_key is not null;

create trigger trg_finance_request_updated_at before update on public.finance_request
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. Tenant integrity — defense-in-depth, mirroring the engine's triggers:
--    the dossier and every referenced actor/record must share the row's tenant.
-- ===========================================================================
create or replace function public.enforce_finance_request_tenant()
returns trigger language plpgsql as $$
declare
  t uuid;
begin
  select tenant_id into t from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from t then
    raise exception 'finance_request tenant mismatch (file_tenant=%, given=%)', t, new.tenant_id;
  end if;
  select tenant_id into t from public.app_user where id = new.requested_by;
  if t is distinct from new.tenant_id then
    raise exception 'finance_request requester belongs to another tenant';
  end if;
  if new.reviewed_by is not null then
    select tenant_id into t from public.app_user where id = new.reviewed_by;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request reviewer belongs to another tenant';
    end if;
  end if;
  if new.disbursed_by is not null then
    select tenant_id into t from public.app_user where id = new.disbursed_by;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request executor belongs to another tenant';
    end if;
  end if;
  if new.evidence_verified_by is not null then
    select tenant_id into t from public.app_user where id = new.evidence_verified_by;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request verifier belongs to another tenant';
    end if;
  end if;
  if new.customs_record_id is not null then
    select tenant_id into t from public.customs_record where id = new.customs_record_id;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request customs record belongs to another tenant';
    end if;
  end if;
  if new.evidence_document_id is not null then
    select tenant_id into t from public.document where id = new.evidence_document_id;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request evidence document belongs to another tenant';
    end if;
  end if;
  if new.billing_charge_id is not null then
    select tenant_id into t from public.billing_charge where id = new.billing_charge_id;
    if t is distinct from new.tenant_id then
      raise exception 'finance_request billing charge belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_finance_request_tenant before insert or update on public.finance_request
  for each row execute function public.enforce_finance_request_tenant();

-- ===========================================================================
-- 3. RLS — SELECT-only for tenant staff holding finance:read with dossier
--    visibility. NO portal policy: customers never read internal finance
--    operations. All writes go through the service-role actions.
-- ===========================================================================
alter table public.finance_request enable row level security;

create policy finance_request_select on public.finance_request
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('finance:read')
    and public.can_read_file(file_id)
  );

grant select on public.finance_request to authenticated;
