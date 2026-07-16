-- 20260718000001_logistics_copilot.sql
-- Effitrans Operations Platform — PHASE 7.6A: Logistics AI Copilot permission.
--
-- Additive ONLY. Adds one tenant permission, `logistics:copilot:read`, for a READ-ONLY
-- cross-modal operational assistant (road/ocean/air/customs). Granted to internal operational
-- staff (the same set that holds process:read); NEVER to CLIENT_USER, PARTNER_AGENT, or DRIVER.
--
-- Clean-replay safe: the catalog insert is global + idempotent; the role grant is select-driven
-- and tenant-guarded, so on a fresh DB (migrations run BEFORE seed.sql, tenant roles not yet
-- present) it matches zero rows and no-ops. seed.sql + lib/platform/role-templates.ts mirror this
-- (parity enforced by tests/role-templates.test.ts). No table, RLS, or operational write.

insert into public.permission (code, module, action, data_scope, description) values
  ('logistics:copilot:read', 'logistics', 'copilot', 'read', 'Read-only Logistics Copilot awareness over road/ocean/air/customs')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'logistics:copilot:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'FINANCE_OFFICER', 'COMPLIANCE_HSSE', 'BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;
