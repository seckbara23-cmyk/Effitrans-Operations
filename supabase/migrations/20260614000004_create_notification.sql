-- 20260614000004_create_notification.sql
-- Effitrans Operations Platform — PHASE 1.6: Task notifications / due-date alerts.
--
-- Minimal, SELF-SCOPED in-app notification feed. A user reads ONLY their own
-- notifications (RLS: user_id = auth.uid()). No new RBAC permission — these are
-- self-owned data, like a personal inbox. Writes (insert on assignment, mark-read)
-- go through server actions on the service-role admin client (deny-by-default for
-- authenticated), same pattern as task/operational_file.
--
-- SCOPE GUARD: in-app notifications only. NO email/SMS provider, NO scheduled
-- reminders (TASK_DUE_SOON / TASK_OVERDUE types reserved for a later phase;
-- only TASK_ASSIGNED is generated in 1.6). NO customs / documents / finance /
-- transport module / portal.

create table public.notification (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  user_id     uuid not null references public.app_user (id),   -- recipient
  type        text not null
                check (type in ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE')),
  task_id     uuid references public.task (id) on delete cascade,
  file_id     uuid references public.operational_file (id) on delete cascade,
  title       text not null,        -- denormalized at creation -> no read-time joins
  body        text,
  read_at     timestamptz,          -- null = unread
  created_at  timestamptz not null default now()
);

create index idx_notification_user on public.notification (tenant_id, user_id, read_at);
create index idx_notification_task on public.notification (task_id);

-- Integrity: a notification's tenant must match its recipient's tenant.
create or replace function public.enforce_notification_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
begin
  select tenant_id into u_tenant from public.app_user where id = new.user_id;
  if new.tenant_id is distinct from u_tenant then
    raise exception 'notification tenant mismatch (user_tenant=%, given=%)', u_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_notification_tenant before insert or update on public.notification
  for each row execute function public.enforce_notification_tenant();

-- ===========================================================================
-- RLS — self-scoped reads via the user-context client (own rows, own tenant).
-- No INSERT/UPDATE policy: notifications are created (on assignment) and marked
-- read by server actions on the service-role client, with an explicit ownership
-- check. No new permission: visibility is the recipient identity itself.
-- ===========================================================================
alter table public.notification enable row level security;

create policy notification_select on public.notification
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and user_id = auth.uid());

grant select on public.notification to authenticated;
