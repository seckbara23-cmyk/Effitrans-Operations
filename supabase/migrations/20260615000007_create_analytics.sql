-- 20260615000007_create_analytics.sql
-- Effitrans Operations Platform — PHASE 1.13: Reporting & Analytics (permissions).
--
-- Executive dashboard analytics READ over EXISTING data only — no new tables, no
-- new workflows. Aggregation is server-side (lib/analytics). This migration just
-- adds the read permissions + grants; all KPIs stay tenant-scoped, and finance
-- KPIs additionally require finance:read (enforced in the page/service).
--
-- SCOPE GUARD: read permissions only. No PDF/CSV/scheduled/email reports, no BI.

insert into public.permission (code, module, action, data_scope, description) values
  ('analytics:read', 'analytics', 'read', 'all', 'View executive analytics dashboard'),
  ('report:read',    'report',    'read', 'all', 'View reports (foundation)')
on conflict (code) do nothing;

-- Management + finance roles. Operational execution roles get NO analytics access.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('analytics:read', 'report:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;
