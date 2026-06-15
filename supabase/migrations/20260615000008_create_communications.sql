-- 20260615000008_create_communications.sql
-- Effitrans Operations Platform — PHASE 1.14: Communications Hub (email outbox).
--
-- Controlled OUTBOUND email. Queue-first: triggers render + queue a message; an
-- explicit action hands it to a provider (no-op/console by default). Rendered
-- subject/body are STORED for auditability. Staff-role visibility (like finance),
-- NOT portal — clients receive email in their inbox, never see the outbox.
--
-- SCOPE GUARD: transactional operational email only. NO mass/marketing/bulk, NO
-- newsletters, NO SMS/WhatsApp, NO external provider wired here. RLS + audit kept.

create table public.communication_message (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  recipient_email   text not null,
  recipient_name    text,
  channel           text not null default 'EMAIL' check (channel in ('EMAIL')),
  template_key      text not null,
  subject           text not null,
  body_html         text not null,
  body_text         text not null,
  payload           jsonb,
  status            text not null default 'QUEUED'
                      check (status in ('QUEUED', 'SENT', 'FAILED', 'CANCELLED')),
  related_entity    text,
  related_entity_id uuid,
  file_id           uuid references public.operational_file (id) on delete set null,
  client_id         uuid references public.client (id) on delete set null,
  retry_count       int not null default 0,
  last_error        text,
  sent_at           timestamptz,
  created_by        uuid references public.app_user (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_comm_tenant_status on public.communication_message (tenant_id, status);
create index idx_comm_file on public.communication_message (file_id);
create index idx_comm_client on public.communication_message (client_id);

create trigger trg_comm_updated_at before update on public.communication_message
  for each row execute function public.set_updated_at();

-- Integrity: a message's optional file/client must belong to the same tenant.
create or replace function public.enforce_communication_tenant()
returns trigger language plpgsql as $$
declare ft uuid; ct uuid;
begin
  if new.file_id is not null then
    select tenant_id into ft from public.operational_file where id = new.file_id;
    if ft is distinct from new.tenant_id then
      raise exception 'communication file tenant mismatch';
    end if;
  end if;
  if new.client_id is not null then
    select tenant_id into ct from public.client where id = new.client_id;
    if ct is distinct from new.tenant_id then
      raise exception 'communication client tenant mismatch';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_comm_tenant before insert or update on public.communication_message
  for each row execute function public.enforce_communication_tenant();

-- ===========================================================================
-- RLS — staff-role based (tenant + communication:read). Writes via the
-- service-role admin client in server actions (deny-by-default). No portal access.
-- ===========================================================================
alter table public.communication_message enable row level security;

create policy communication_message_select on public.communication_message
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:read'));

grant select on public.communication_message to authenticated;

-- ===========================================================================
-- Permissions (catalog + role grants, mirrored in seed.sql).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('communication:read',   'communication', 'read',   'all', 'View communications log'),
  ('communication:send',   'communication', 'send',   'all', 'Send / queue communications'),
  ('communication:manage', 'communication', 'manage', 'all', 'Retry / cancel communications')
on conflict (code) do nothing;

-- read: management + comms operators.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;

-- send: those who trigger client/staff emails.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:send'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;

-- manage (retry/cancel): admin + ops supervisor.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;
