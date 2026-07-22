-- 20260722000001_messaging_center.sql
-- Effitrans Operations Platform — PHASE 8.7: Effitrans Messaging Center.
--
-- A genuinely new schema — audited first (no existing table is a fit): the AI copilots
-- are session-only (no persisted conversation anywhere), the two notification tables
-- (notification, client_notification) are one-way system-generated feeds with no sender/
-- thread concept, and communication_message is a one-way outbound EMAIL queue. ////////None of
-- these support a two-way, multi-participant, staff+customer authored thread.
--
-- IDENTITY REUSE, NOT A COMPETING MODEL: sender/participant identity is always ONE of the
-- three existing identity classes — app_user (staff), client_user (portal customer), or
-- neither (system/ai) — exactly like audit_log's actor_id/client_user_id/platform_actor_id
-- split. Department routing reuses lib/portal/self-service.ts's existing CONTACT_DEPARTMENTS
-- vocabulary (documentation/customs/transport/finance/general) rather than inventing a new
-- registry or depending on the (often-dark) 15-queue process-engine department list.
--
-- WRITE CONVENTION MATCHES EVERY OTHER MODULE: RLS on every table is SELECT-ONLY for
-- `authenticated` (deny-by-default) — there is no INSERT/UPDATE policy anywhere in this
-- migration. All writes go through service-role server actions (assertPermission + tenant/
-- participant check + audit), exactly like customs/tasks/portal admin actions. This is how
-- "sender identity cannot be forged from the client" is guaranteed: the server derives
-- sender_user_id/sender_client_user_id from the authenticated session, never from form input.

-- ===========================================================================
-- 1. conversation
-- ===========================================================================
create table public.conversation (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id),
  type                      text not null check (type in ('direct_staff', 'department', 'dossier', 'customer_support')),
  title                     text,
  client_id                 uuid references public.client (id),
  file_id                   uuid references public.operational_file (id) on delete set null,
  -- Reuses lib/portal/self-service.ts's CONTACT_DEPARTMENTS vocabulary — see tests/messaging.test.ts
  -- for the parity assertion. NOT the 15-queue process-engine department list (that registry is
  -- gated behind the process-workspaces flag and dark for most tenants; messaging must not depend
  -- on it).
  department_code           text check (department_code in ('documentation', 'customs', 'transport', 'finance', 'general')),
  status                    text not null default 'open'
                              check (status in ('open', 'waiting_customer', 'waiting_effitrans', 'resolved', 'closed')),
  priority                  text not null default 'normal' check (priority in ('normal', 'urgent')),
  assigned_to               uuid references public.app_user (id),
  created_by                uuid references public.app_user (id),
  created_by_client_user_id uuid references public.client_user (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  closed_at                 timestamptz,
  -- A conversation cannot be created_by BOTH a staff member and a portal customer.
  check (created_by is null or created_by_client_user_id is null),
  -- Structural routing invariants.
  check (type <> 'dossier' or file_id is not null),
  check (type <> 'customer_support' or client_id is not null),
  check (type not in ('department', 'customer_support') or department_code is not null)
);

create index idx_conversation_tenant_status on public.conversation (tenant_id, status);
create index idx_conversation_tenant_client on public.conversation (tenant_id, client_id);
create index idx_conversation_tenant_department on public.conversation (tenant_id, department_code);
create index idx_conversation_file on public.conversation (file_id);
create index idx_conversation_assigned on public.conversation (assigned_to);

create trigger trg_conversation_updated_at before update on public.conversation
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. conversation_participant
-- ===========================================================================
create table public.conversation_participant (
  id               uuid primary key default gen_random_uuid(),
  -- Denormalized (not derived via a join) so RLS/index scans never need to reach the
  -- parent conversation row just to scope by tenant.
  tenant_id        uuid not null references public.organization (id),
  conversation_id  uuid not null references public.conversation (id) on delete cascade,
  participant_type text not null check (participant_type in ('staff', 'customer', 'department', 'system')),
  user_id          uuid references public.app_user (id),
  client_user_id   uuid references public.client_user (id),
  department_code  text check (department_code in ('documentation', 'customs', 'transport', 'finance', 'general')),
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  muted_at         timestamptz,
  removed_at       timestamptz,
  check (
    (participant_type = 'staff' and user_id is not null and client_user_id is null and department_code is null)
    or (participant_type = 'customer' and client_user_id is not null and user_id is null and department_code is null)
    or (participant_type = 'department' and department_code is not null and user_id is null and client_user_id is null)
    or (participant_type = 'system' and user_id is null and client_user_id is null and department_code is null)
  )
);

create index idx_conv_participant_conversation on public.conversation_participant (conversation_id);
-- A participant row is only "current" while removed_at is null — partial indexes so a
-- removed-then-re-added participant never collides and lookups skip stale rows for free.
create unique index uq_conv_participant_user
  on public.conversation_participant (conversation_id, user_id)
  where user_id is not null and removed_at is null;
create unique index uq_conv_participant_client_user
  on public.conversation_participant (conversation_id, client_user_id)
  where client_user_id is not null and removed_at is null;
create index idx_conv_participant_user_lookup on public.conversation_participant (user_id) where removed_at is null;
create index idx_conv_participant_client_user_lookup on public.conversation_participant (client_user_id) where removed_at is null;

-- ===========================================================================
-- 3. message
-- ===========================================================================
create table public.message (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  conversation_id        uuid not null references public.conversation (id) on delete cascade,
  sender_type            text not null check (sender_type in ('staff', 'customer', 'system', 'ai')),
  sender_user_id         uuid references public.app_user (id),
  sender_client_user_id  uuid references public.client_user (id),
  body                   text not null,
  message_type           text not null default 'text' check (message_type in ('text', 'attachment', 'system_event')),
  -- 'internal' = staff-only note. Never returned by a portal-scoped read (RLS-enforced
  -- below, not merely filtered in application code).
  visibility             text not null default 'shared' check (visibility in ('shared', 'internal')),
  reply_to_message_id    uuid references public.message (id),
  created_at             timestamptz not null default now(),
  -- Moderation redaction (Prefer no hard deletion — the row, its timestamp and its
  -- position in the thread are preserved; only the body is overwritten).
  redacted_at            timestamptz,
  redacted_by            uuid references public.app_user (id),
  redaction_reason       text,
  -- Sender identity is structurally tied to sender_type — a message cannot claim to be
  -- staff-authored while carrying a client_user id, or vice versa. This is a second,
  -- schema-level backstop; the real guarantee is that the server action derives
  -- sender_user_id / sender_client_user_id from the session, never from client input.
  check (
    (sender_type = 'staff' and sender_user_id is not null and sender_client_user_id is null)
    or (sender_type = 'customer' and sender_client_user_id is not null and sender_user_id is null)
    or (sender_type in ('system', 'ai'))
  ),
  -- A customer can never author an internal note. system/ai may (an AI draft is
  -- internal-only until a human approves it — see docs/messaging/architecture.md).
  check (visibility = 'shared' or sender_type in ('staff', 'system', 'ai'))
);

create index idx_message_conversation_created on public.message (conversation_id, created_at);
create index idx_message_tenant on public.message (tenant_id);
create index idx_message_reply_to on public.message (reply_to_message_id);

-- ===========================================================================
-- 4. message_attachment
-- ===========================================================================
create table public.message_attachment (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id),
  message_id                uuid not null references public.message (id) on delete cascade,
  storage_path              text not null,
  original_filename         text not null,
  mime_type                 text not null,
  size_bytes                bigint not null check (size_bytes > 0),
  uploaded_by_user_id       uuid references public.app_user (id),
  uploaded_by_client_user_id uuid references public.client_user (id),
  created_at                timestamptz not null default now(),
  check (uploaded_by_user_id is null or uploaded_by_client_user_id is null)
);

create index idx_message_attachment_message on public.message_attachment (message_id);

-- ===========================================================================
-- 5. tenant_messaging_rollout — independent of tenant_process_rollout (the 26-step
--    engine's rollout table): messaging has no dependency on the process engine, so
--    coupling it to that table's process_engine-cascades-sub-capabilities constraint
--    would be a false dependency. Same shape/RLS/write-gate convention, own table.
-- ===========================================================================
create table public.tenant_messaging_rollout (
  tenant_id        uuid primary key references public.organization (id) on delete cascade,
  enabled          boolean not null default false,
  note             text,
  first_enabled_at timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.platform_admin (id)
);

alter table public.tenant_messaging_rollout enable row level security;

create policy tenant_messaging_rollout_select on public.tenant_messaging_rollout
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

grant select on public.tenant_messaging_rollout to authenticated;
-- No insert/update/delete policy: only the service-role platform action
-- (lib/platform/messaging-rollout-actions.ts, gated by platform:rollout:manage) may write.

-- ===========================================================================
-- 6. RLS — conversation / conversation_participant / message / message_attachment
--    SELECT-ONLY for `authenticated` (deny-by-default), matching every other module.
-- ===========================================================================
alter table public.conversation           enable row level security;
alter table public.conversation_participant enable row level security;
alter table public.message                enable row level security;
alter table public.message_attachment     enable row level security;

-- Shared access predicate (security definer — the same join-heavy access-check idiom as
-- portal_can_read_file / portal_can_read_shipment), reused across all four tables so the
-- rule is ONE tested source of truth rather than four copies that could drift.
create or replace function public.messaging_staff_can_access_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation c
    where c.id = p_conversation
      and c.tenant_id = public.auth_tenant_id()
      and (
        exists (
          select 1 from public.conversation_participant cp
          where cp.conversation_id = c.id
            and cp.user_id = auth.uid()
            and cp.removed_at is null
        )
        or (c.department_code is not null and public.has_permission('messaging:read:' || c.department_code))
        or public.has_permission('messaging:manage')
      )
  );
$$;

create or replace function public.messaging_portal_can_access_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation c
    where c.id = p_conversation
      and c.tenant_id = public.auth_portal_tenant_id()
      and c.client_id = public.auth_portal_client_id()
  );
$$;

grant execute on function public.messaging_staff_can_access_conversation(uuid) to authenticated;
grant execute on function public.messaging_portal_can_access_conversation(uuid) to authenticated;

create policy conversation_staff_select on public.conversation
  for select to authenticated
  using (public.messaging_staff_can_access_conversation(id));

create policy conversation_portal_select on public.conversation
  for select to authenticated
  using (tenant_id = public.auth_portal_tenant_id() and client_id = public.auth_portal_client_id());

create policy conversation_participant_staff_select on public.conversation_participant
  for select to authenticated
  using (public.messaging_staff_can_access_conversation(conversation_id));

create policy conversation_participant_portal_select on public.conversation_participant
  for select to authenticated
  using (public.messaging_portal_can_access_conversation(conversation_id));

create policy message_staff_select on public.message
  for select to authenticated
  using (public.messaging_staff_can_access_conversation(conversation_id));

-- Portal customers NEVER see an internal-visibility message — enforced here, not merely
-- filtered by the reader, so a bug in application code cannot leak an internal note.
create policy message_portal_select on public.message
  for select to authenticated
  using (visibility = 'shared' and public.messaging_portal_can_access_conversation(conversation_id));

create policy message_attachment_staff_select on public.message_attachment
  for select to authenticated
  using (
    exists (
      select 1 from public.message m
      where m.id = message_attachment.message_id
        and public.messaging_staff_can_access_conversation(m.conversation_id)
    )
  );

create policy message_attachment_portal_select on public.message_attachment
  for select to authenticated
  using (
    exists (
      select 1 from public.message m
      where m.id = message_attachment.message_id
        and m.visibility = 'shared'
        and public.messaging_portal_can_access_conversation(m.conversation_id)
    )
  );

grant select on public.conversation, public.conversation_participant, public.message, public.message_attachment
  to authenticated;

-- ===========================================================================
-- 7. Permission catalog + role grants (seed tenant only; mirrored in seed.sql +
--    lib/platform/role-templates.ts — parity enforced by tests/role-templates.test.ts).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('messaging:read', 'messaging', 'read', 'own', 'Read conversations you directly participate in (staff-to-staff, dossier threads)'),
  ('messaging:send', 'messaging', 'send', 'own', 'Send messages in conversations you can read'),
  ('messaging:read:documentation', 'messaging', 'read', 'documentation', 'Read/reply to Documentation department conversations'),
  ('messaging:read:customs', 'messaging', 'read', 'customs', 'Read/reply to Customs department conversations'),
  ('messaging:read:transport', 'messaging', 'read', 'transport', 'Read/reply to Transport department conversations'),
  ('messaging:read:finance', 'messaging', 'read', 'finance', 'Read/reply to Finance department conversations'),
  ('messaging:read:general', 'messaging', 'read', 'general', 'Read/reply to general customer-service conversations'),
  ('messaging:manage', 'messaging', 'manage', 'all', 'Assign, reassign, close and reopen conversations; add or remove participants'),
  ('messaging:moderate', 'messaging', 'moderate', 'all', 'Redact a message body for governance reasons')
on conflict (code) do nothing;

-- Base read/send: every real operational role. NEVER to CLIENT_USER, PARTNER_AGENT, DRIVER,
-- or COURIER — the same external/narrow-identity exclusion already applied to
-- logistics:copilot:read and executive:dashboard:read.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('messaging:read', 'messaging:send')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in (
    'SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER', 'QUOTATION_MANAGER',
    'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT',
    'TRANSPORT_OFFICER', 'PICKUP_AGENT', 'BILLING_OFFICER', 'FINANCE_OFFICER',
    'ADMINISTRATIVE_OFFICER', 'COLLECTIONS_OFFICER', 'DOCUMENTATION_OFFICER',
    'WAREHOUSE_COORDINATOR', 'COMPLIANCE_HSSE'
  )
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:documentation'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'DOCUMENTATION_OFFICER', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:customs'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:transport'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'TRANSPORT_OFFICER', 'PICKUP_AGENT', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:finance'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'FINANCE_OFFICER', 'BILLING_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:general'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CEO', 'ACCOUNT_MANAGER', 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:moderate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COMPLIANCE_HSSE')
on conflict do nothing;

-- ===========================================================================
-- 8. Notification integration — additive extensions to the TWO existing tables
--    rather than a third, parallel notification store.
-- ===========================================================================

-- Staff-facing `notification`: two new types + a conversation_id so a click-through
-- lands on the right thread (title/body stay denormalized, no read-time join needed).
alter table public.notification
  add column if not exists conversation_id uuid references public.conversation (id) on delete cascade;

alter table public.notification
  drop constraint if exists notification_type_check;
alter table public.notification
  add constraint notification_type_check
  check (type in ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'FILE_ASSIGNED', 'MESSAGE_RECEIVED', 'CONVERSATION_ASSIGNED'));

create index idx_notification_conversation on public.notification (conversation_id);

-- Customer-facing `client_notification`: 'message' joins ('shipment','invoice','payment')
-- as a category, plus the same conversation_id link.
alter table public.client_notification
  add column if not exists conversation_id uuid references public.conversation (id) on delete cascade;

alter table public.client_notification
  drop constraint if exists client_notification_category_check;
alter table public.client_notification
  add constraint client_notification_category_check
  check (category in ('shipment', 'invoice', 'payment', 'message'));

create index idx_client_notification_conversation on public.client_notification (conversation_id);

-- ===========================================================================
-- 9. Storage bucket for attachments — private, deny-by-default (same shape as the
--    existing `documents` bucket: no storage.objects policy for `authenticated`, every
--    access mediated by a server action + short-TTL signed URL).
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messaging-attachments', 'messaging-attachments', false, 15728640, -- 15 MB
  array[
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;
