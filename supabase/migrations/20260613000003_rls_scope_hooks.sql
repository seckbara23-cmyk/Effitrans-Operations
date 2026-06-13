-- 20260613000003_rls_scope_hooks.sql
-- Effitrans Operations Platform — RLS-2: role-scope policy hooks (Wave 4)
-- Reusable own/team/client/all scoping helpers, validated on FOUNDATION tables.
-- Decisions: DEC-C01 (tenant_id + RLS), DEC-B13 (union perms).
--
-- SCOPE GUARD: no business tables. RLS-1 tenant isolation MUST be preserved —
-- the refactored policies are behaviour-identical; only audit_log gains an
-- additional permission requirement. This is the template S2 will reuse.

-- Helpers (SECURITY INVOKER so referenced tables' RLS still applies) ----------

-- Caller's tenant id (reads own app_user row under RLS).
create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security invoker
as $$
  select u.tenant_id from public.app_user u where u.id = auth.uid();
$$;

-- Does the caller hold a permission code (union across their roles)?
create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.get_user_permissions(auth.uid()) gp where gp.code = p_code
  );
$$;

-- Does the caller hold a role code?
create or replace function public.has_role(p_code text)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.user_role ur
    join public.role r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code = p_code
  );
$$;

-- Refactor existing tenant policies to use auth_tenant_id() (behaviour unchanged).
drop policy organization_select_own on public.organization;
create policy organization_select_own
  on public.organization for select to authenticated
  using (id = public.auth_tenant_id());

drop policy role_select_own_tenant on public.role;
create policy role_select_own_tenant
  on public.role for select to authenticated
  using (tenant_id = public.auth_tenant_id());

drop policy user_role_select_own_tenant on public.user_role;
create policy user_role_select_own_tenant
  on public.user_role for select to authenticated
  using (tenant_id = public.auth_tenant_id());

drop policy role_permission_select_own_tenant on public.role_permission;
create policy role_permission_select_own_tenant
  on public.role_permission for select to authenticated
  using (role_id in (
    select r.id from public.role r where r.tenant_id = public.auth_tenant_id()
  ));

-- DEMONSTRATE role-scoping on a foundation table: audit_log is readable only by
-- callers in their own tenant AND holding 'audit:read:all'. This proves the
-- permission hook end-to-end without touching any business table.
drop policy audit_log_select_own_tenant on public.audit_log;
create policy audit_log_select_scoped
  on public.audit_log for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('audit:read:all')
  );

-- Notes:
-- * No write policies added — RBAC/audit writes remain service-role only.
-- * app_user_select_self and permission_select_all are unchanged.
-- * No recursion: helpers read app_user / RBAC tables, never the protected one.
