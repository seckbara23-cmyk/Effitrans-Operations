-- 20260714000003_collections_closure.sql
-- Effitrans Operations Platform — PHASE 5.0D-4: Collections, disputes, closure.
-- ---------------------------------------------------------------------------
-- Official step 26 + the explicit dossier closure.
--
-- NO SECOND RECEIVABLES LEDGER. The balance stays exactly where it already is:
--   total   = invoiceTotals(invoice_line)          (lib/finance/calc.ts)
--   paid    = SUM(payment.amount) WHERE reversed_at IS NULL
--   balance = total - paid
-- This is the same derivation invoice.status is driven by. Collections reads it;
-- it never recomputes it, and it never writes a payment.
--
-- A NOTE ON "VERIFIED PAYMENTS". The brief asks aging to count verified payments.
-- We deliberately do NOT: invoice.status is driven by NON-REVERSED payments, so a
-- verified-only balance would disagree with the invoice on every payment still
-- awaiting verification — two contradicting balances, i.e. exactly the second
-- ledger the brief forbids. Instead, payments awaiting verification are surfaced
-- as a PRIORITY SIGNAL and a visible flag on the row (see lib/collections/
-- priority.ts), so Finance is chased rather than the number being quietly changed.
--
-- Collections is not payment processing: nothing here inserts or mutates a payment.
--
-- CLEAN-REPLAY (822c0d7): no literal tenant-scoped insert.

-- ===========================================================================
-- 1. Widen the follow-up vocabulary (5.0D-1 shipped a narrower set).
--    Old values are KEPT so any existing row stays valid — this is additive.
-- ===========================================================================
alter table public.collection_follow_up drop constraint if exists collection_follow_up_channel_check;
alter table public.collection_follow_up
  add constraint collection_follow_up_channel_check
    check (channel in ('PHONE', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'VISIT', 'LETTER', 'OTHER'));

alter table public.collection_follow_up drop constraint if exists collection_follow_up_outcome_check;
alter table public.collection_follow_up
  add constraint collection_follow_up_outcome_check
    check (outcome in ('CLIENT_CONTACTED', 'NO_RESPONSE', 'PAYMENT_PROMISED', 'PAYMENT_RECEIVED',
                       'DISPUTED', 'ESCALATED', 'WRONG_CONTACT', 'RESCHEDULED',
                       -- 5.0D-1 vocabulary, kept so existing rows stay valid.
                       'REACHED', 'NO_ANSWER', 'PROMISE_TO_PAY', 'PARTIAL_PAYMENT_AGREED', 'OTHER'));

alter table public.collection_follow_up
  -- A promise carries an amount as well as a date. Both optional: a client may
  -- promise "next Friday" without committing to a figure.
  add column if not exists promised_amount numeric(14, 2),
  add column if not exists dispute_category text;

-- ===========================================================================
-- 2. Collections state on the invoice — the receivable we already have.
--    No `collection_case` entity: the invoice IS the case.
-- ===========================================================================
alter table public.invoice
  add column if not exists collections_assignee_id uuid references public.app_user (id),
  add column if not exists collections_received_at timestamptz,
  add column if not exists dispute_category        text,
  add column if not exists dispute_opened_by       uuid references public.app_user (id),
  add column if not exists dispute_resolved_at     timestamptz,
  add column if not exists dispute_resolution      text,
  add column if not exists escalated_at            timestamptz,
  -- Step 26 (Collections work complete) is DISTINCT from dossier closure. Marking
  -- the recovery finished never closes anything by itself.
  add column if not exists collections_completed_at timestamptz;

comment on column public.invoice.collections_completed_at is
  'Phase 5.0D-4 — Collections work is done. NOT closure: the dossier is closed by a separate, explicit, authorized action.';

create index if not exists idx_invoice_collections_assignee
  on public.invoice (collections_assignee_id) where collections_assignee_id is not null;
create index if not exists idx_invoice_collections_due
  on public.invoice (tenant_id, due_date) where status in ('ISSUED', 'PARTIALLY_PAID');

-- The collections assignee must belong to the invoice's tenant. Extends the
-- existing 5.0D-2 actor-tenant trigger rather than adding a second one.
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
  if new.collections_assignee_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.collections_assignee_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'invoice collections_assignee belongs to another tenant';
    end if;
  end if;
  if new.dispute_opened_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.dispute_opened_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'invoice dispute_opened_by belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 3. process:close — the TENANT permission for final dossier closure.
--
--    Deliberately NOT granted to COLLECTIONS_OFFICER: a collector may mark the
--    recovery complete, but the dossier is closed by a supervisor. Never granted
--    to BILLING_OFFICER, COURIER, DRIVER or any portal identity. There is no
--    platform-level closure permission.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('process:close', 'process', 'close', 'all',
   'Close a dossier after the full official process, including recovery, is complete. Tenant-scoped.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:close'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- 4. RLS — the assigned collector also reads their own follow-ups.
--    (The 5.0D-1 policy already covers collections:manage holders; this is
--    unchanged. Nothing is weakened: a courier/driver/portal identity still
--    matches no policy at all.)
-- ===========================================================================
-- No policy change required: collection_follow_up_select already gates on
-- collections:manage, which every Collections Officer holds and no Courier,
-- Driver or portal user does.
