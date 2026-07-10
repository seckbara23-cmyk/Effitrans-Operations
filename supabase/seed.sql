-- Effitrans Operations Platform — foundation seed
-- Applied by `npm run db:reset`. Foundation only; idempotent.
--
-- Single tenant for Phase 1 (DEC-C01: multi-tenant-ready, no SaaS control plane).
-- A fixed UUID makes the Effitrans tenant referenceable across environments.
--
-- NOTE: app_user is NOT seeded here — it FKs auth.users, so the first admin user
-- is created through Supabase Auth in Wave 3 (AUTH-1/AUTH-2), then linked.

insert into public.organization (id, name, country, storage_region)
values (
  '00000000-0000-0000-0000-000000000001',
  'Effitrans',
  'SN',
  'provisional'   -- region pending BLK-9
)
on conflict (id) do nothing;

-- ===========================================================================
-- RBAC provisional seed (PROVISIONAL pending BLK-RB1) — idempotent.
-- Foundation/admin permissions ONLY. No business module permissions yet.
-- ===========================================================================

insert into public.permission (code, module, action, data_scope, description) values
  ('profile:read:self',   'profile', 'read',   'own', 'Read own profile'),
  ('profile:update:self', 'profile', 'update', 'own', 'Update own profile'),
  ('org:read:own',        'org',     'read',   'all', 'Read own organization'),
  ('audit:read:all',      'audit',   'read',   'all', 'Read the audit log'),
  ('admin:users:manage',  'admin',   'manage', 'all', 'Manage users'),
  ('admin:roles:manage',  'admin',   'manage', 'all', 'Manage roles & permissions'),
  ('admin:config:manage', 'admin',   'manage', 'all', 'Manage system configuration')
on conflict (code) do nothing;

-- Roles for the Effitrans tenant (provisional list from docs/rbac-matrix.md).
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', r.code, r.label_fr, r.label_en, true
from (values
  ('SYSTEM_ADMIN',          'Administrateur système',    'System Administrator'),
  ('CEO',                   'Direction générale',        'CEO / Owner'),
  ('QUOTATION_MANAGER',     'Responsable des cotations',  'Quotation Manager'),
  ('ACCOUNT_MANAGER',       'Account Manager',            'Account Manager'),
  ('COORDINATOR',           'Coordinateur des opérations','Operations Coordinator'),
  ('CHIEF_OF_TRANSIT',      'Chef de transit',            'Chief of Transit'),
  ('CUSTOMS_DECLARANT',     'Déclarant en douane',        'Customs Declarant'),
  ('DOCUMENTATION_OFFICER', 'Agent de documentation',     'Documentation Officer'),
  ('TRANSPORT_OFFICER',     'Responsable transport',      'Transport Officer'),
  ('WAREHOUSE_COORDINATOR', 'Coordinateur entrepôt',      'Warehouse Coordinator'),
  ('FINANCE_OFFICER',       'Agent financier',            'Finance Officer'),
  ('OPS_SUPERVISOR',        'Superviseur opérations',     'Operations Supervisor'),
  ('COMPLIANCE_HSSE',       'Responsable conformité/HSSE','Compliance / HSSE'),
  ('CLIENT_USER',           'Client (portail)',           'Client User'),
  ('PARTNER_AGENT',         'Partenaire / agent',         'Partner / Agent'),
  ('DRIVER',                'Chauffeur',                  'Driver')
) as r(code, label_fr, label_en)
on conflict (tenant_id, code) do nothing;

-- Baseline: every role can read/update its own profile.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('profile:read:self', 'profile:update:self')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- SYSTEM_ADMIN: admin + org + audit.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in
  ('admin:users:manage','admin:roles:manage','admin:config:manage','org:read:own','audit:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- CEO: org + audit (read-only governance/full visibility).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('org:read:own','audit:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;

-- COMPLIANCE_HSSE: audit read.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'audit:read:all'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;

-- ===========================================================================
-- Phase 1.1 Client Management role mappings (mirror of the module migration, so
-- fresh local `db reset` gets them after roles exist). Idempotent.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('client:create', 'client:read', 'client:update', 'client:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('client:create', 'client:read', 'client:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'client:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CEO', 'COORDINATOR', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.2 Operational File role mappings (mirror of the module migration).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:create', 'file:read', 'file:update', 'file:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:create', 'file:read', 'file:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COORDINATOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CEO', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Phase 3.2A Dossier Delete/Assignment (mirror of 20260709000001 migration).
-- file:assign (new) + file:delete widened to OPS_SUPERVISOR.
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('file:assign', 'file', 'assign', 'all', 'Assign operational files to staff')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- ===========================================================================
-- Phase 1.3 Tasks role mappings (mirror of the module migration).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('task:create', 'task:read', 'task:update', 'task:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'COORDINATOR', 'OPS_SUPERVISOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('task:read', 'task:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER',
                 'DOCUMENTATION_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'task:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;

-- ===========================================================================
-- Phase 1.7 Visibility scoping role mappings (mirror of the module migration).
-- Tier-1 tenant-wide read; scoped file:read for execution roles + compliance.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read:all', 'task:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'COMPLIANCE_HSSE')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'task:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;

-- ===========================================================================
-- Phase 1.8 Documents role mappings (mirror of the module migration).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'OPS_SUPERVISOR', 'COORDINATOR',
                 'DOCUMENTATION_OFFICER', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'CHIEF_OF_TRANSIT', 'COMPLIANCE_HSSE')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.9 Customs role mappings (mirror of the module migration).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:create', 'customs:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:release'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.10 Transport role mappings (mirror of the module migration).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'DOCUMENTATION_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('transport:create', 'transport:update', 'transport:assign')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:complete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.11 Finance role mappings (mirror of the module migration).
-- Finance-role based; no operational role gets finance by default.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.module = 'finance'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'finance:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:update', 'finance:issue', 'finance:payment', 'finance:void')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:issue')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:update', 'finance:issue', 'finance:payment', 'finance:void')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

-- Phase 1.19 (A1): tenant-wide file READ so finance can open any dossier to bill
-- it (the finance panel lives on /files/[id], gated by file:read + read:all
-- scope). Read-only; mirror of 20260616000001_finance_file_read.sql.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

-- ===========================================================================
-- Phase 1.12A Customer Portal — internal portal:manage grant (mirror).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'portal:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.13 Analytics — read permissions (mirror).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('analytics:read', 'report:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;

-- ===========================================================================
-- Phase 1.14 Communications Hub — permissions (mirror).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:send'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'FINANCE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'communication:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 3.4 Real-time tracking — permissions catalog + role mappings (mirror of
-- 20260710000002_create_tracking.sql, so a fresh local `db reset` gets them).
-- DARK BY DEFAULT: these are read/write perms; the feature is gated by
-- TRACKING_ENABLED (lib/tracking/config.ts). Idempotent.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('tracking:read',     'tracking', 'read',   'assigned', 'View transport tracking (sessions, positions, events)'),
  ('tracking:read:all', 'tracking', 'read',   'all',      'View tenant-wide / fleet tracking'),
  ('tracking:write',    'tracking', 'write',  'assigned', 'Record manual updates / driver positions'),
  ('tracking:manage',   'tracking', 'manage', 'all',      'Admin tracking controls (end session, hide position, visibility defaults)')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'DOCUMENTATION_OFFICER', 'DRIVER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:read:all'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:write'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER', 'DRIVER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'tracking:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

