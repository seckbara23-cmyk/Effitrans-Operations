-- 20260719000001_executive_dashboard.sql
-- Effitrans Operations Platform — PHASE 7.7: Executive Intelligence Dashboard permission.
--
-- Additive ONLY. Adds one tenant permission, `executive:dashboard:read`, for the READ-ONLY
-- executive command center (organization-wide intelligence composed from the existing module
-- readers). It is a NARROWER boundary than `analytics:read`: the executive dashboard is for the
-- executive/management tier, while analytics:read remains the wider reporting audience
-- (/reports, /departments/management). It grants NO operational update capability — executives
-- never inherit write permissions, and every underlying module reader still enforces its own
-- read permission (a section the viewer cannot read degrades to "unavailable", never to a false
-- all-clear).
--
-- Granted to the executive/management roles that EXIST in the registry: SYSTEM_ADMIN (platform
-- administrator), CEO (Direction générale), OPS_SUPERVISOR (MANAGER — the operating-management
-- tier). There is deliberately no COO / MANAGING_DIRECTOR / EXECUTIVE_DIRECTOR role in this
-- platform; see docs/executive/reuse-analysis.md. NEVER to CLIENT_USER, PARTNER_AGENT, DRIVER.
--
-- Clean-replay safe: the catalog insert is global + idempotent; the role grant is select-driven
-- and tenant-guarded, so on a fresh DB (migrations run BEFORE seed.sql, tenant roles not yet
-- present) it matches zero rows and no-ops. seed.sql + lib/platform/role-templates.ts mirror this
-- (parity enforced by tests/role-templates.test.ts). No table, RLS, or operational write.

insert into public.permission (code, module, action, data_scope, description) values
  ('executive:dashboard:read', 'executive', 'dashboard', 'read', 'Read-only Executive Intelligence Dashboard composed from existing module readers')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'executive:dashboard:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR')
on conflict do nothing;
