-- 20260720000001_user_archive.sql
-- Effitrans Operations Platform — PHASE 8.1A: staff user ARCHIVE lifecycle state.
--
-- Additive ONLY. Extends the app_user.status vocabulary with 'archived' — the permanent
-- employee-departure state, distinct from 'inactive' (temporary suspension):
--
--   invited/active ⇄ inactive (suspend / reactivate)          — existing behavior, unchanged
--   active|inactive → archived (departure)  → active (restore, SYSTEM_ADMIN only)
--
-- NO deletion is introduced anywhere: an archived user's rows — audit history, shipment /
-- customs / document / invoice ownership, AI activity — are preserved verbatim; only the
-- status changes. Enforcement is inherited, not duplicated:
--   - authentication: getCurrentUser() already denies ANY non-'active' status;
--   - password reset: isActiveStaff() already requires 'active';
--   - assignment pickers: every reader already filters eq(status,'active');
--   - assignment writes: collections/deposit/file-assign already validate status='active'.
--
-- Clean-replay safe: pure DDL on a table created earlier in the sequence; no tenant-scoped
-- row insert. RLS policies untouched (status is not a policy input). The existing inline
-- CHECK from 20260613000001 carries the auto-generated name app_user_status_check.

alter table public.app_user
  drop constraint if exists app_user_status_check;

alter table public.app_user
  add constraint app_user_status_check
  check (status in ('active', 'inactive', 'archived'));
