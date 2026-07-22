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

-- Phase 4.0B-3: platform metadata + branding for the Effitrans tenant (mirror of
-- the 20260712110000 migration backfill, so a fresh `db reset` reproduces it —
-- migrations run BEFORE this seed, so the backfill there is a no-op on fresh DBs).
update public.organization set
  legal_name        = coalesce(legal_name, 'Effitrans'),
  trade_name        = coalesce(trade_name, 'Effitrans'),
  slug              = coalesce(slug, 'effitrans'),
  plan_key          = coalesce(plan_key, 'ENTERPRISE'),
  lifecycle_status  = 'ACTIVE',
  onboarding_status = 'complete',
  branding_complete = true
where id = '00000000-0000-0000-0000-000000000001';

insert into public.tenant_branding
  (tenant_id, display_name, primary_color, secondary_color, email_footer, pdf_header_text, tagline)
values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans Operations', '#0B1F33', '#0F766E',
   'Effitrans Operations · Dakar, Sénégal', 'EFFITRANS OPERATIONS', 'Transit • Logistique • Douane')
on conflict (tenant_id) do nothing;

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

-- ===========================================================================
-- Phase 5.0B — official process engine: the seven roles Phase 5.0A found missing
-- plus the permissions the 26-step registry declares.
-- MIRROR of supabase/migrations/20260713000001_process_engine.sql. Parity with
-- lib/platform/role-templates.ts is enforced by tests/role-templates.test.ts,
-- which re-parses THIS file.
--
-- Maker-checker: BILLING_OFFICER holds finance:create (the MAKER half) and
-- deliberately NOT finance:validate. FINANCE_OFFICER holds finance:validate (the
-- CHECKER half). OPS_SUPERVISOR/SYSTEM_ADMIN hold both by design — a supervisor may
-- act in either capacity — but they still cannot validate their OWN work, because
-- maker != checker is enforced on IDENTITY in the engine, not on permission alone.
-- process:override is granted to NO ROLE: self-validation is off by default.
-- ===========================================================================
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', r.code, r.label_fr, r.label_en, true
from (values
  ('BILLING_OFFICER',         'Agent de facturation',    'Billing Officer'),
  ('CUSTOMS_FINANCE_OFFICER', 'Finance douane',          'Customs Finance Officer'),
  ('CUSTOMS_FIELD_AGENT',     'Agent de terrain douane', 'Customs Field Agent'),
  ('PICKUP_AGENT',            'Agent enlèvement',        'Pickup Agent'),
  ('ADMINISTRATIVE_OFFICER',  'Agent administratif',     'Administrative Officer'),
  ('COURIER',                 'Coursier',                'Courier'),
  ('COLLECTIONS_OFFICER',     'Agent de recouvrement',   'Collections Officer')
) as r(code, label_fr, label_en)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'FINANCE_OFFICER', 'COMPLIANCE_HSSE', 'BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('process:handoff:send', 'process:handoff:receive')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:completeness:review'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT', 'COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:register'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CUSTOMS_FINANCE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'finance:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:request'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'TRANSPORT_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('admin_service:manage', 'courier:assign')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'courier:deposit'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'COURIER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'collections:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('quotation:create', 'quotation:send', 'quotation:approve')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'QUOTATION_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('profile:read:self', 'profile:update:self')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

-- ===========================================================================
-- Phase 7.6A — Logistics AI Copilot: a read-only cross-modal operational
-- assistant. Granted to internal operational staff (the process:read set);
-- NEVER to CLIENT_USER / PARTNER_AGENT / DRIVER. Mirrors migration
-- 20260718000001_logistics_copilot.sql and lib/platform/role-templates.ts
-- (parity enforced by tests/role-templates.test.ts).
-- ===========================================================================
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

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read:all'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'ADMINISTRATIVE_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:create', 'finance:read', 'finance:update', 'finance:issue', 'client:read', 'communication:send', 'communication:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'BILLING_OFFICER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:read', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'CUSTOMS_FINANCE_OFFICER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:read', 'customs:update', 'customs:release', 'document:create', 'document:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'CUSTOMS_FIELD_AGENT'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('transport:read', 'transport:update', 'document:create', 'document:read', 'tracking:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PICKUP_AGENT'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:read', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'ADMINISTRATIVE_OFFICER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'COURIER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:payment', 'communication:read', 'communication:send', 'report:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'COLLECTIONS_OFFICER'
on conflict do nothing;

-- Phase 5.0D-4 — final dossier closure. Tenant-scoped, supervisors only.
-- Deliberately NOT granted to COLLECTIONS_OFFICER (who completes the recovery),
-- BILLING_OFFICER, COURIER, DRIVER or any portal identity.
insert into public.permission (code, module, action, data_scope, description) values
  ('process:close', 'process', 'close', 'all', 'Close a dossier after the full official process, including recovery, is complete. Tenant-scoped.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:close'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 7.7 — Executive Intelligence Dashboard: a READ-ONLY, organization-wide
-- command center composed from the existing module readers. A NARROWER boundary
-- than analytics:read (which remains the wider reporting audience for /reports
-- and Direction): granted only to the executive/management tier that exists —
-- SYSTEM_ADMIN (platform administrator), CEO (Direction générale), and
-- OPS_SUPERVISOR (MANAGER). Grants NO operational update capability; each module
-- reader still enforces its own read permission. NEVER to CLIENT_USER /
-- PARTNER_AGENT / DRIVER. Mirrors migration 20260719000001_executive_dashboard.sql
-- and lib/platform/role-templates.ts (parity enforced by tests/role-templates.test.ts).
-- ===========================================================================
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

-- ===========================================================================
-- Phase 8.4 — canonical location coordinates (DEV/CI seed; production entry is
-- an OPERATOR step via the port/airport management UI or the runbook SQL —
-- production is never seeded automatically).
-- Coordinate sources (public reference data, no fabrication):
--   ports    — US NGA World Port Index (public domain): Dakar 14.683,-17.417;
--              Shanghai 31.233,121.483
--   airports — OurAirports database (public domain): GOBD/DSS 14.670833,-17.072778;
--              LFPG/CDG 49.009722,2.547778
-- Idempotent: partial-unique on (tenant_id, unlocode/iata) → conflict do nothing.
-- ===========================================================================
insert into public.ocean_port (tenant_id, unlocode, name, country, latitude, longitude, timezone) values
  ('00000000-0000-0000-0000-000000000001', 'SNDKR', 'Port de Dakar', 'SN', 14.683, -17.417, 'Africa/Dakar'),
  ('00000000-0000-0000-0000-000000000001', 'CNSHA', 'Port de Shanghai', 'CN', 31.233, 121.483, 'Asia/Shanghai')
on conflict (tenant_id, unlocode) where unlocode is not null do nothing;

insert into public.air_airport (tenant_id, iata, icao, name, city, country, latitude, longitude, timezone, active) values
  ('00000000-0000-0000-0000-000000000001', 'DSS', 'GOBD', 'Aéroport international Blaise-Diagne', 'Dakar', 'SN', 14.670833, -17.072778, 'Africa/Dakar', true),
  ('00000000-0000-0000-0000-000000000001', 'CDG', 'LFPG', 'Paris Charles-de-Gaulle', 'Paris', 'FR', 49.009722, 2.547778, 'Europe/Paris', true)
on conflict (tenant_id, iata) where iata is not null do nothing;

-- ===========================================================================
-- Phase 8.4 — `transport:manage`: the reference-data permission the 7.2B/7.3B
-- management actions ALREADY gate on, but which was never cataloged (root cause
-- of the unreachable port/airport coordinate entry → unmappable shipments).
-- Granted to the transport coordination tier. Mirrors migration
-- 20260721000001_transport_manage.sql and lib/platform/role-templates.ts.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('transport:manage', 'transport', 'manage', 'all', 'Manage transport reference data (ports, airports, carriers, vessels, voyages) and tracking providers')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

-- ===========================================================================
-- Phase 8.7 — Effitrans Messaging Center. Mirrors migration
-- 20260722000001_messaging_center.sql and lib/platform/role-templates.ts (parity
-- enforced by tests/role-templates.test.ts). NEVER to CLIENT_USER / PARTNER_AGENT /
-- DRIVER / COURIER — the same external/narrow-identity exclusion used throughout.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('messaging:read', 'messaging', 'read', 'own', 'Read conversations you directly participate in (staff-to-staff, dossier threads)'),
  ('messaging:send', 'messaging', 'send', 'own', 'Send messages in conversations you can read'),
  ('messaging:read:documentation', 'messaging', 'read', 'documentation', 'Read/reply to Documentation department conversations'),
  ('messaging:read:customs', 'messaging', 'read', 'customs', 'Read/reply to Customs department conversations'),
  ('messaging:read:transport', 'messaging', 'read', 'transport', 'Read/reply to Transport department conversations'),
  ('messaging:read:finance', 'messaging', 'read', 'finance', 'Read/reply to Finance department conversations'),
  ('messaging:read:general', 'messaging', 'read', 'general', 'Read/reply to general customer-service conversations'),
  ('messaging:manage', 'messaging', 'manage', 'all', 'Assign, reassign, close and reopen conversations; add or remove participants'),
  ('messaging:moderate', 'messaging', 'moderate', 'all', 'Redact a message body for governance reasons')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('messaging:read', 'messaging:send')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in (
    'SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER', 'QUOTATION_MANAGER',
    'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT',
    'TRANSPORT_OFFICER', 'PICKUP_AGENT', 'BILLING_OFFICER', 'FINANCE_OFFICER',
    'ADMINISTRATIVE_OFFICER', 'COLLECTIONS_OFFICER', 'DOCUMENTATION_OFFICER',
    'WAREHOUSE_COORDINATOR', 'COMPLIANCE_HSSE'
  )
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:documentation'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'DOCUMENTATION_OFFICER', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:customs'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:transport'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'TRANSPORT_OFFICER', 'PICKUP_AGENT', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:finance'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'FINANCE_OFFICER', 'BILLING_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:read:general'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CEO', 'ACCOUNT_MANAGER', 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'messaging:moderate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COMPLIANCE_HSSE')
on conflict do nothing;
