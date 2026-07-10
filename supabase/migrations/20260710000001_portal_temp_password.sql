-- 20260710000001_portal_temp_password.sql
-- Effitrans Operations Platform — PHASE 3.2B: Client portal temporary-password onboarding.
-- ---------------------------------------------------------------------------
-- Additive, forward-only (DEC-A12). Replaces invitation-EMAIL dependence with an
-- admin-created temporary password + forced change at first login.
--
-- One additive boolean on client_user: must_change_password. Set true when an
-- admin creates a portal account with a temporary password (or resets it); the
-- portal (app) layout guard redirects such a user to /portal/auth/change-password
-- and blocks all other portal content until it is cleared.
--
-- NO RLS change: the temporary password lives ONLY in Supabase Auth
-- (auth.users.encrypted_password) — never in this table, audit, logs or comms.
-- The existing client_user_self_select / client_user_staff_select policies
-- already govern who can read this row; a new non-secret boolean needs no new
-- policy. Tenant isolation and staff RLS are unchanged.
--
-- SCOPE GUARD (3.2B): portal client_user only. No app_user / staff onboarding change.

alter table public.client_user
  add column if not exists must_change_password boolean not null default false;
