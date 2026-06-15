-- Phase 1.15B — Real Payment Provider Integration (scaffold; no live money)
-- ===========================================================================
-- ADDITIVE only. Two new tables orchestrate provider-initiated online payments
-- WITHOUT touching the 1.11 finance calculations:
--   * payment_intent       — orchestration record (may never become money).
--                            Only a SUCCEEDED intent auto-creates a normal
--                            `payment` row, so paid = Σ non-reversed is unchanged.
--   * provider_webhook_event — append-only log: idempotency + replay protection.
--
-- RLS mirrors `payment`: finance-role gated (tenant + finance:read), writes via
-- service-role only. payment_intent additionally gets an ADDITIVE portal read
-- (portal_can_read_invoice) so a client sees its own intents — read-only.
-- No new RBAC permission (reuse finance:payment / finance:read / finance:void).

-- ---------------------------------------------------------------------------
-- 1. payment_intent
-- ---------------------------------------------------------------------------
create table public.payment_intent (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  invoice_id            uuid not null references public.invoice (id) on delete cascade,
  provider              text not null check (provider in ('WAVE', 'ORANGE_MONEY', 'MOCK')),
  amount                numeric(14, 2) not null check (amount > 0),
  currency              text not null default 'XOF',
  status                text not null default 'CREATED'
                          check (status in ('CREATED', 'PENDING', 'PROCESSING',
                                            'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  provider_intent_id    text,
  provider_checkout_url text,
  provider_reference    text,
  payment_id            uuid references public.payment (id),
  expires_at            timestamptz,
  completed_at          timestamptz,
  failed_at             timestamptz,
  last_error            text,
  created_by            uuid references public.app_user (id),     -- staff initiator (nullable)
  created_by_client     uuid references public.client_user (id), -- portal initiator (nullable)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_payment_intent_tenant_status on public.payment_intent (tenant_id, status);
create index idx_payment_intent_invoice on public.payment_intent (invoice_id);
create unique index uq_payment_intent_provider_ref
  on public.payment_intent (provider, provider_intent_id)
  where provider_intent_id is not null;

create trigger trg_payment_intent_updated_at before update on public.payment_intent
  for each row execute function public.set_updated_at();

-- Tenant-match vs invoice (reuse the 1.11 helper: checks new.tenant_id = invoice.tenant_id).
create trigger trg_payment_intent_tenant before insert or update on public.payment_intent
  for each row execute function public.enforce_finance_invoice_tenant();

-- ---------------------------------------------------------------------------
-- 2. provider_webhook_event  (append-only: idempotency + replay protection)
-- ---------------------------------------------------------------------------
create table public.provider_webhook_event (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.organization (id),  -- null until matched to an intent
  provider          text not null check (provider in ('WAVE', 'ORANGE_MONEY', 'MOCK')),
  provider_event_id text not null,
  event_type        text not null,
  payment_intent_id uuid references public.payment_intent (id),
  signature_valid   boolean not null,
  outcome           text not null
                      check (outcome in ('APPLIED', 'DUPLICATE', 'REPLAYED', 'REJECTED', 'UNMATCHED')),
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index idx_webhook_event_intent on public.provider_webhook_event (payment_intent_id);
create index idx_webhook_event_tenant on public.provider_webhook_event (tenant_id, received_at desc);

-- Append-only: block UPDATE/DELETE for all roles (incl. service role).
create trigger trg_webhook_event_no_update before update on public.provider_webhook_event
  for each row execute function public.prevent_mutation();
create trigger trg_webhook_event_no_delete before delete on public.provider_webhook_event
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------------
-- 3. RLS — finance-role gated (tenant + finance:read); writes service-role only.
-- ---------------------------------------------------------------------------
alter table public.payment_intent         enable row level security;
alter table public.provider_webhook_event enable row level security;

create policy payment_intent_select on public.payment_intent
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read'));

-- ADDITIVE portal read: a client sees intents for its own readable invoices.
create policy payment_intent_portal_select on public.payment_intent
  for select to authenticated
  using (public.portal_can_read_invoice(invoice_id));

create policy provider_webhook_event_select on public.provider_webhook_event
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read'));

grant select on public.payment_intent, public.provider_webhook_event to authenticated;
