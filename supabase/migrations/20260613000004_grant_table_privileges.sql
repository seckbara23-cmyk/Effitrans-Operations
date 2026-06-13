-- 20260613000004_grant_table_privileges.sql
-- Explicit privilege grants for the `authenticated` role (Wave-4 follow-up / CI fix).
--
-- WHY: RLS controls WHICH ROWS a role may see; table-level GRANTs control whether
-- the role may touch the table AT ALL. Environments that don't pre-seed Supabase's
-- default privileges (e.g. the local stack used by CI) leave `authenticated`
-- without SELECT, so RLS policy evaluation fails with
-- "permission denied for table organization" before any row filtering happens.
-- Declaring grants explicitly makes the schema portable across environments and
-- removes the reliance on implicit default privileges.
--
-- SECURITY: this does NOT weaken tenant isolation — RLS still scopes the rows.
--   * READS ONLY: no INSERT/UPDATE/DELETE granted to `authenticated` (the
--     foundation has no write policies; writes run via the service role).
--   * `anon` is intentionally NOT granted (unauthenticated users read nothing).
--   * RLS remains ENABLED on every table.
--   * Service-role write grants are out of scope for this fix (Supabase provisions
--     service_role separately); they are added per-table when write flows land.

grant usage on schema public to authenticated;

-- Read access — RLS policies still restrict the visible rows to the caller's tenant
-- (and, for audit_log, to holders of 'audit:read:all').
grant select on
  public.organization,
  public.app_user,
  public.permission,
  public.role,
  public.role_permission,
  public.user_role,
  public.audit_log
to authenticated;

-- Execute the resolution / scope helpers used inside RLS policies and the app.
grant execute on function public.get_user_permissions(uuid) to authenticated;
grant execute on function public.auth_tenant_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_role(text) to authenticated;
