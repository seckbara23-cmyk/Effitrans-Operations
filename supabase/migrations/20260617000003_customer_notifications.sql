-- 20260617000003_customer_notifications.sql
-- Effitrans Operations Platform — PHASE 2.5: Customer communications & notifications.
-- ---------------------------------------------------------------------------
-- The customer-facing notification CENTER (portal channel). The EMAIL channel
-- stays on the existing Communications Hub (communication_message) — this is not
-- a second comms engine, it is the portal inbox of the same notifications.
-- Per-client, dedup-enforced (one per event+entity). Per-portal-user email
-- preferences live on client_user (additive booleans). RLS mirrors the portal
-- pattern (auth_portal_* helpers) — a portal user only ever sees their own
-- client's notifications. Forward-only.

create table public.client_notification (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  client_id    uuid not null references public.client (id) on delete cascade,
  event_type   text not null,
  category     text not null check (category in ('shipment', 'invoice', 'payment')),
  template_key text,
  title        text not null,
  body         text not null,
  file_id      uuid references public.operational_file (id) on delete set null,
  invoice_id   uuid references public.invoice (id) on delete set null,
  dedup_key    text not null,
  read_at      timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Dedup: one customer notification per (event + entity) per tenant. The app
-- pre-checks; this is the race-proof backstop (webhook retries, double release).
create unique index uq_client_notification_dedup on public.client_notification (tenant_id, dedup_key);
create index idx_client_notification_client on public.client_notification (tenant_id, client_id, read_at);

-- Integrity: a notification's tenant must match its client's tenant.
create or replace function public.enforce_client_notification_tenant()
returns trigger language plpgsql as $$
declare c_tenant uuid;
begin
  select tenant_id into c_tenant from public.client where id = new.client_id;
  if new.tenant_id is distinct from c_tenant then
    raise exception 'client_notification tenant mismatch (client_tenant=%, given=%)', c_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_client_notification_tenant before insert or update on public.client_notification
  for each row execute function public.enforce_client_notification_tenant();

-- RLS — portal users read their own client's notifications (mirror portal policy).
-- Writes go through the service-role admin client (notifyCustomer + markRead).
alter table public.client_notification enable row level security;
create policy client_notification_portal_select on public.client_notification
  for select to authenticated
  using (
    tenant_id = public.auth_portal_tenant_id()
    and client_id = public.auth_portal_client_id()
  );
grant select on public.client_notification to authenticated;

-- Per-portal-user email notification preferences (default ON). Future-ready for
-- SMS/WhatsApp channels. Portal inbox always records; these gate the email push.
alter table public.client_user
  add column if not exists notify_email    boolean not null default true,
  add column if not exists notify_shipment boolean not null default true,
  add column if not exists notify_invoice  boolean not null default true,
  add column if not exists notify_payment  boolean not null default true;
