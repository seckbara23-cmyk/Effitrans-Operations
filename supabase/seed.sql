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
  ('PARTNER_AGENT',         'Partenaire / agent',         'Partner / Agent')
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

