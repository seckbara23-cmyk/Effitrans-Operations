-- 20260617000002_user_presence.sql
-- Effitrans Operations Platform — PHASE 2.1A: User presence & login visibility.
-- ---------------------------------------------------------------------------
-- Operational admin metadata only (login + last-seen). NO page-level tracking,
-- NO route history. Additive columns; client_user.last_login_at already exists
-- (20260615000005). No RLS change — presence is read by the admin directory
-- (listUsers, gated by admin:users:manage on the service-role client) and the
-- SYSTEM_ADMIN dashboard summary. Forward-only, idempotent.

alter table public.app_user
  add column if not exists last_login_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_login_method text,
  add column if not exists login_count integer not null default 0,
  add column if not exists onboarding_email_sent_at timestamptz;

alter table public.client_user
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_login_method text,
  add column if not exists login_count integer not null default 0,
  add column if not exists onboarding_email_sent_at timestamptz;

-- Lightweight indexes for the "active today / online" dashboard counts.
create index if not exists idx_app_user_last_seen on public.app_user (tenant_id, last_seen_at);
create index if not exists idx_client_user_last_seen on public.client_user (tenant_id, last_seen_at);
