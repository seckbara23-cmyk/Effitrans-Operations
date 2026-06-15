-- Phase 1.15A — Payment Recording Integrations (verification + provider tracking)
-- ---------------------------------------------------------------------------
-- ADDITIVE only. Extends the Phase-1.11 `payment` table with manual provider
-- metadata (no API, no webhook, no collection) and a reconciliation workflow:
-- every payment starts PENDING; finance:void may VERIFY it or REJECT it.
--
-- REJECT = reverse + mark REJECTED: rejecting sets reversed_at (existing 1.11
-- mechanism) so the row leaves the paid total, keeping the paid/balance formula
-- (Σ non-reversed) and all invoice calculations UNCHANGED. No new permission
-- (reuse finance:void). No RLS change — `payment` is already finance-role gated
-- (tenant + finance:read), the CI-tested boundary.

alter table public.payment
  add column if not exists provider_name        text,
  add column if not exists provider_reference   text,
  add column if not exists received_by          uuid references public.app_user (id),
  add column if not exists verification_status   text not null default 'PENDING'
    check (verification_status in ('PENDING', 'VERIFIED', 'REJECTED')),
  add column if not exists verified_by          uuid references public.app_user (id),
  add column if not exists verified_at          timestamptz,
  add column if not exists verification_note    text;

-- Reconciliation queues filter by status within a tenant.
create index if not exists idx_payment_tenant_verification
  on public.payment (tenant_id, verification_status);
