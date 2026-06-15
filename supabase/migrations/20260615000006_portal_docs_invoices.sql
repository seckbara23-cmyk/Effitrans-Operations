-- 20260615000006_portal_docs_invoices.sql
-- Effitrans Operations Platform — PHASE 1.12B: Portal Documents & Invoices.
--
-- Lets portal users (client_user, Phase 1.12A) READ their client's APPROVED +
-- SHARED documents and ISSUED+ invoices. ADDITIVE portal RLS only (OR'd with the
-- staff policies) — staff RLS is NOT weakened. Portal users have no finance:read,
-- so the staff finance policy still denies them; they see invoices ONLY via the
-- client-scoped, status-gated portal policy below.
--
-- SCOPE GUARD: read-only portal access. NO client uploads/edits, NO payments,
-- NO charges exposure, NO messaging. Reuses Phase 1.8 documents + 1.11 finance.

-- ===========================================================================
-- 1. Document sharing flag (additive; staff explicitly opt a doc in — DEC-B22).
-- ===========================================================================
alter table public.document
  add column if not exists shared_with_client boolean not null default false;

-- ===========================================================================
-- 2. Helper: can the portal caller read this invoice? (DEFINER -> bypasses inner
--    RLS so the invoice_line/payment policies don't recurse through invoice.)
-- ===========================================================================
create or replace function public.portal_can_read_invoice(p_invoice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invoice i
    where i.id = p_invoice
      and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
      and public.portal_can_read_file(i.file_id)
  );
$$;

grant execute on function public.portal_can_read_invoice(uuid) to authenticated, service_role;

-- ===========================================================================
-- 3. ADDITIVE portal SELECT policies.
-- ===========================================================================
create policy document_portal_select on public.document
  for select to authenticated
  using (
    public.portal_can_read_file(file_id)
    and status = 'APPROVED'
    and shared_with_client
    and deleted_at is null
  );

create policy invoice_portal_select on public.invoice
  for select to authenticated
  using (
    public.portal_can_read_file(file_id)
    and status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
  );

create policy invoice_line_portal_select on public.invoice_line
  for select to authenticated
  using (public.portal_can_read_invoice(invoice_id));

create policy payment_portal_select on public.payment
  for select to authenticated
  using (public.portal_can_read_invoice(invoice_id));

-- billing_charge: intentionally NO portal policy — clients never see raw charges.
