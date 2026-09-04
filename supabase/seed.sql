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
join public.permission p on p.code in ('file:create', 'file:read', 'file:update', 'file:delete', 'file:transition')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:create', 'file:read', 'file:update', 'file:transition')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:update', 'file:transition')
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
  ('file:assign', 'file', 'assign', 'all', 'Assign operational files to staff'),
  ('file:assign:commercial', 'files', 'assign_commercial', 'all', 'Désigner ou remplacer le Responsable client (Account Manager) d''un dossier — autorité du Responsable des opérations'),
  -- Advancing the status ladder is INDEPENDENT of editing master data.
  -- Mirrors migration 20260728000003.
  ('file:transition', 'file', 'transition', 'all',
   'Advance an operational file through its status state machine (distinct from editing)')
on conflict (code) do nothing;

-- file:transition is a SEPARATE authority from file:update: advancing the
-- dossier ladder and editing master data are distinct acts, and that
-- distinction (ratified 2026-07-28) is unchanged. What changed on 2026-09-03
-- (H-9) is the GRANT: OPS_SUPERVISOR now also holds file:update, below, so the
-- Operations Supervisor can maintain the operational dossier as information
-- arrives. CEO is deliberately excluded — it reads and reports.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:transition'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

-- H-9 (ratified 2026-09-03, mirrors migration 20260929000001): a dossier is a
-- living operational record and Operations maintains it. This grants ONLY the
-- dossier/master-data edit; file:create is deliberately NOT granted, and every
-- independently governed record (Finance authorizations, customs declarations,
-- signed POD, payments) keeps its own permission.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'file:update'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- TMS-1 (D1 = Option A, ratified 2026-08-18, mirrors migration 20260906000001):
-- the Responsable client assignment authority — Operations Manager + platform
-- administration only. file:assign (working assignee) is untouched.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'file:assign:commercial'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('OPS_SUPERVISOR', 'SYSTEM_ADMIN')
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
  -- C-4: COLLECTIONS_OFFICER and FINANCE_OFFICER are registered receivers of
  -- the Administration handoff (queue `collections`) and could not accept it.
  -- Safe because receiveHandoff now ALSO requires routed-receiver eligibility.
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COLLECTIONS_OFFICER', 'FINANCE_OFFICER')
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

-- EC-3C — the quotation authority matrix ratified as DEC-C32. This seed runs
-- AFTER migrations under `supabase db reset`, so it must state the SAME matrix
-- as migration 83 and lib/platform/role-templates.ts. EC-3B proved why: a grant
-- present in only some of the three sources produces a database that disagrees
-- with itself, and the disagreement is invisible until an RLS suite counts the
-- live grants. Parity is enforced by tests/role-templates.test.ts and by the
-- exact-matrix contract in tests/ec-3b-commercial.test.ts.
--
-- SYSTEM_ADMIN is ABSENT from both statements, deliberately and permanently:
-- an administrator must never prepare, validate, send or accept an offer.

-- Quotation agents — prepare, send, and record the customer's acceptance.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('quotation:create', 'quotation:send', 'quotation:approve')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;

-- C-4 — official step 16 is the Account Manager's, so the Account Manager must
-- be able to perform it. Its gate was transport:complete, which TMS-4
-- deliberately keeps away from this role — the AM requests transport, Transport
-- executes it. The fault was the GATE, not the boundary: step 16 is « suivre la
-- livraison jusqu'à réception client » and obtaining the signed BL, while
-- moving the transport record to DELIVERED is Transport's separate act. This
-- capability means the first and authorizes nothing of the second.
--
-- Granted to the roles that legitimately perform step 16 — NOT to every holder
-- of the old gate. TRANSPORT_OFFICER is absent on purpose: holding the previous
-- permission is not evidence of owning the step.
insert into public.permission (code, module, action, data_scope, description) values
  ('process:delivery:followup', 'process', 'followup', 'assigned',
   'Perform the Account Manager official delivery follow-up (step 16): obtain the signed delivery note and complete that workflow step. Confers NO transport execution authority.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:delivery:followup'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('ACCOUNT_MANAGER', 'OPS_SUPERVISOR', 'SYSTEM_ADMIN')
on conflict do nothing;

-- D4 (RATIFIED 2026-08-28) — the governed correction door for validated customs
-- data, and its recertification.
--
-- Before this, validated customs data was de-facto permanently immutable: the
-- ordinary update path is control-gated to open step states and the owning step
-- is closed by validation time. Effitrans requires neither free editing nor a
-- locked record, but a correction that leaves a trace.
--
-- customs:correct is the Chef de Transit's: correcting certified data is the
-- checker role's accountability. customs:revalidate is BOTH the Chef's and the
-- Déclarant's — the Chef corrects, a different pair of eyes confirms — and it
-- is NOT customs:validate: first certification remains the Chef's alone (PG-6).
insert into public.permission (code, module, action, data_scope, description) values
  ('customs:correct', 'customs', 'correct', 'assigned',
   'Correct VALIDATED customs information through the governed correction door: motif obligatoire, old→new traced, validation cleared for recertification. Confers no ordinary update authority.'),
  ('customs:revalidate', 'customs', 'revalidate', 'assigned',
   'Recertify a customs record after a governed correction. Person-level maker≠checker: the corrector may never revalidate their own correction. Confers no first-validation authority.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:correct'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'SYSTEM_ADMIN')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:revalidate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'SYSTEM_ADMIN')
on conflict do nothing;

-- Gestion de la Performance — the module that presents ICTD / ICAM / IPAM.
--
-- RATIFIED 2026-08-28 (final access ruling): access comes from an EXPLICIT role
-- assignment, never from an operational job role. The System Administrator
-- assigns « Gestion de la Performance » through the existing
-- « Ajouter un rôle… → Attribuer » screen and removes it the same way.
--
-- Two thin capabilities, and the thinness is the design: reading a number about
-- someone's work is not authority over the work. Neither implies hr:manage
-- (D3 keeps the calendar with HR), customs:update or customs:validate (D4 keeps
-- capture with the Déclarant and certification with the Chef), and no
-- operational permission is a way into the module.
--
-- SYSTEM_ADMIN holds neither, following DEC-B61: it already receives no `hr:*`
-- because the data is personal, and per-person performance indicators computed
-- from that same leave data are the same kind of fact. Assigning the role runs
-- on admin:roles:manage, which SYSTEM_ADMIN has; reading the numbers is a
-- separate question with the same answer as for everyone else.
insert into public.permission (code, module, action, data_scope, description) values
  ('performance:read', 'performance', 'read', 'tenant',
   'Open Gestion de la Performance and read the ICTD / ICAM / IPAM indicators. Confers NO mutation authority of any kind.'),
  ('performance:manage', 'performance', 'manage', 'tenant',
   'Configure Gestion de la Performance where the governed implementation permits it. Confers no operational authority.')
on conflict (code) do nothing;

insert into public.role (id, tenant_id, code, label_fr, label_en) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000001',
   'PERFORMANCE_MANAGEMENT', 'Gestion de la Performance', 'Performance Management')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self',
                'performance:read', 'performance:manage')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

-- Slice 1 — the management report lifecycle.
--
-- Drafting belongs with reading: preparing the analysis IS the working half of
-- the module. PUBLISHING is separated, because making a set of numbers the
-- company's official record of a period is a different act from studying them,
-- and the person who studies them should not become the person who freezes them
-- merely by holding one role. Since the administration screen grants ROLES, the
-- separation is a second thin assignable role rather than a permission somebody
-- would have to hand-attach.
insert into public.permission (code, module, action, data_scope, description) values
  ('performance:report:create', 'performance', 'report_create', 'tenant',
   'Draft a management performance report: create it, edit it while it is a draft, and submit it for review. Confers no authority to publish.'),
  ('performance:report:publish', 'performance', 'report_publish', 'tenant',
   'Publish a management performance report, freezing its computed snapshot permanently. Confers no other performance or operational authority.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'performance:report:create'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

insert into public.role (id, tenant_id, code, label_fr, label_en) values
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000001',
   'PERFORMANCE_PUBLISHER', 'Publication des rapports de performance', 'Performance Report Publisher')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'performance:report:publish')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_PUBLISHER'
on conflict do nothing;

-- C-4 — the quotation lead must be able to READ the evidence its own official
-- step requires. Step 1 (Cotation) requires QUOTATION and QUOTATION_APPROVAL,
-- and the engine refuses to complete a step on evidence the actor cannot judge.
-- Capability only: document rows remain bounded by can_read_file, and this role
-- holds no file:read:all, so its reach is unchanged.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;

-- Internal managerial validation ONLY. Not quotation:create — DEC-C32 refuses
-- granting it to OPS_SUPERVISOR merely to make quotations readable; the SELECT
-- policies were widened to `create OR validate` instead.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'quotation:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
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

-- ===========================================================================
-- Phase 9.0B — workflow structural extensions. Mirrors migration
-- 20260723000001_workflow_structures.sql and lib/platform/role-templates.ts
-- (parity enforced by tests/role-templates.test.ts). Grants are deliberately
-- NARROW; the decision-approval grant stays minimal because manager-approval
-- policy is an unresolved business decision (see lib/process/decision-policy.ts).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('process:owner:assign',    'process', 'owner_assign',    'assigned', 'Assign or change the canonical operational owner of a dossier process'),
  ('process:decision:create', 'process', 'decision_create', 'assigned', 'Request a recorded workflow decision (e.g. continue before payment)'),
  ('process:decision:approve','process', 'decision_approve','assigned', 'Finalize a recorded workflow decision'),
  ('process:blocker:manage',  'process', 'blocker_manage',  'assigned', 'Open, acknowledge, resolve or cancel a formal dossier blocker'),
  ('process:team:manage',     'process', 'team_manage',     'all',      'Manage Transit team membership (AIBD / Maritime) and step team targeting'),
  ('process:step:skip',       'process', 'step_skip',       'assigned', 'Explicitly skip a non-applicable process step, or reopen a skipped one')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:owner:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:decision:create'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:decision:approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:blocker:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:team:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:step:skip'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR')
on conflict do nothing;

-- ===========================================================================
-- Phase 9.3A — Caisse & Trésorerie foundation. Mirrors
-- supabase/migrations/20260724000001_caisse_foundation.sql (parity enforced by
-- tests/role-templates.test.ts). Caisse is a FINANCE workspace, not a department;
-- Caissier/Caissière is a role label only. caisse:manage (treasury handling) is
-- kept distinct from finance authorization for segregation of duties.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('caisse:manage', 'caisse', 'manage', 'own', 'Gérer les opérations de caisse et de trésorerie')
on conflict (code) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-000000000001', 'CASHIER', 'Caissier / Caissière', 'Cashier', true)
on conflict (tenant_id, code) do nothing;

-- CASHIER — least privilege (own profile, finance read-only, caisse ops,
-- process:read for Mon Travail visibility). NOT finance:validate/issue/void/
-- delete/payment, collections:manage, admin_service:manage.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'finance:read', 'caisse:manage', 'process:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CASHIER'
on conflict do nothing;

-- Supervisory oversight: SYSTEM_ADMIN (full-admin convention) + OPS_SUPERVISOR
-- (operations/finance supervisor; no separate Finance Manager role). NOT
-- FINANCE_OFFICER / BILLING_OFFICER / COLLECTIONS_OFFICER / CUSTOMS_FINANCE_OFFICER
-- / ADMINISTRATIVE_OFFICER / COURIER.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'caisse:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- Phase HR-1 — Employee Registry. Mirrors
-- supabase/migrations/20260724000002_hr_employee_registry.sql (parity enforced
-- by tests/role-templates.test.ts). HR is a MANAGEMENT surface (/departments/hr),
-- not an operational department; HUMAN_RESOURCES stays canonical metadata.
-- SYSTEM_ADMIN receives NO hr:* (DEC-B25) — see the deliberate omission below.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:read',   'hr', 'read',   'all', 'Consulter le registre du personnel (annuaire et données d''emploi)'),
  ('hr:manage', 'hr', 'manage', 'all', 'Gérer le personnel : création, modification, cycle de vie, liaison de compte')
on conflict (code) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-000000000001', 'HR_OFFICER', 'Chargé RH', 'HR Officer', true)
on conflict (tenant_id, code) do nothing;

-- HR_OFFICER — least privilege: own profile, the HR module (hr:read + hr:manage),
-- and staff messaging (messaging:read + messaging:send). Grant hr:read/hr:manage
-- by explicit p.code (module-based expansion would over-grant). NOT admin:*,
-- finance:*, process:*, or any :delete authority.
-- HR-A1 (HRQ-D2 = Option A, ratified 2026-08-09): + hr:config:manage — the
-- configuration center (structure, postes, sites, numérotation, catalogue de
-- compétences). Mirrors migration 20260821000001. hr:sensitive:read and
-- hr:performance:finalize remain granted to NOBODY; hr:leave:approve went to
-- the Direction seats DAF/DGA in HR-B1 (see the block after the Finance roles).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'hr:read', 'hr:manage',
                'hr:config:manage', 'hr:reports:read', 'messaging:read', 'messaging:send')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;

-- HR-9A (RQ-9.1 ratified, mirrors migration 20260905000001): aggregated HR
-- reporting reaches the executive seat too. It is the CEO role's FIRST and
-- ONLY hr:* — aggregates with no row access, so the privacy floor applies to
-- its small-group breakdowns. DGA/DAF and SYSTEM_ADMIN are deliberately NOT
-- granted; a migration assertion refuses any other holder.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'hr:reports:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;

-- NO hr:* grant to SYSTEM_ADMIN or any other role (DEC-B25): HR data is the
-- strongest case for narrowness; SYSTEM_ADMIN administers accounts, not people.

-- ===========================================================================
-- Phase 11.0B — Finance Expense Documents foundation. Mirrors
-- supabase/migrations/20260725000001_expense_documents.sql (parity enforced by
-- tests/role-templates.test.ts). The finance:expense:* family uses module
-- 'finance_expense' so the module='finance' auto-grant above does NOT sweep it
-- in — every grant is explicit (segregation of duties). finance:expense:sign is
-- granted to NO role in 11.0B (the visa signer-map is 11.0C/D; VISA_RECEPTION /
-- VISA_OPERATIONS remain unmapped blockers). Four ratified authorizer roles —
-- ACCOUNTANT, TREASURER, DAF, DGA (FINANCE canonical department, metadata only).
-- CASHIER stays EXECUTION-ONLY (execute, no authorization).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('finance:expense:read',    'finance_expense', 'read',    'all', 'Consulter les autorisations et bons de dépenses'),
  ('finance:expense:create',  'finance_expense', 'create',  'all', 'Créer un brouillon d''autorisation ou de bon de dépenses'),
  ('finance:expense:submit',  'finance_expense', 'submit',  'all', 'Soumettre une autorisation ou un bon de dépenses au circuit d''approbation'),
  ('finance:expense:sign',    'finance_expense', 'sign',    'all', 'Apposer un visa (approbation électronique authentifiée) sur un document de dépenses'),
  ('finance:expense:export',  'finance_expense', 'export',  'all', 'Générer / exporter / imprimer le PDF d''un document de dépenses'),
  ('finance:expense:execute', 'finance_expense', 'execute', 'all', 'Exécuter le paiement d''un bon de dépenses éligible (caisse)')
on conflict (code) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-000000000001', 'ACCOUNTANT', 'Comptable',                            'Accountant',                          true),
  ('00000000-0000-0000-0000-000000000001', 'TREASURER',  'Trésorier / Trésorière',               'Treasurer',                           true),
  ('00000000-0000-0000-0000-000000000001', 'DAF',        'Directeur administratif et financier', 'Administrative & Financial Director', true),
  ('00000000-0000-0000-0000-000000000001', 'DGA',        'Directeur général adjoint',            'Deputy General Manager',              true)
on conflict (tenant_id, code) do nothing;

-- read: all expense actors see the documents.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER',
                 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CASHIER')
on conflict do nothing;

-- export: authoring + authorizer seats + supervisory (not CASHIER, not CEO).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:export'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER',
                 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA')
on conflict do nothing;

-- create + submit: the finance agent originates the document; SYSTEM_ADMIN convention.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:expense:create', 'finance:expense:submit')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'FINANCE_OFFICER')
on conflict do nothing;

-- execute: CASHIER (execution-only) + supervisory oversight (mirrors caisse:manage).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:execute'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CASHIER')
on conflict do nothing;

-- Baseline for the four new roles: own profile + finance module read visibility.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('ACCOUNTANT', 'TREASURER', 'DAF', 'DGA')
on conflict do nothing;

-- HR-B1 — Direction org-wide leave approval seats (mirrors migration
-- 20260830000001). Deliberately NOT the CEO role: six broad accounts hold it
-- in production, and its grant awaits explicit ratification (HR-1A question a).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'hr:leave:approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('DAF', 'DGA')
on conflict do nothing;

-- HR-B2 — the same Direction seats finalize performance reviews (mirrors
-- migration 20260831000001). CEO again deliberately absent; HR_OFFICER too —
-- preparing a review and freezing it forever are different authorities.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'hr:performance:finalize'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('DAF', 'DGA')
on conflict do nothing;

-- ===========================================================================
-- Phase 11.0D — the Autorisation visa chain (DEC-C08/C11). Mirrors migration
-- 20260726000002. finance:expense:sign goes ONLY to the six seats that sign this
-- chain; VISA_OPERATIONS stays unmapped (BLK-FIN-2), CASHIER stays execution-
-- only, SYSTEM_ADMIN keeps the finance convention of full admin EXCEPT signing,
-- and ACCOUNTANT/DGA sign the BON's chain (11.0E), not this one.
-- CEO gaining a write-class finance capability is the governance change flagged
-- in 11.0A §4.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:sign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('FINANCE_OFFICER', 'CHIEF_OF_TRANSIT', 'COORDINATOR', 'TREASURER', 'DAF', 'CEO')
on conflict do nothing;

-- The three signing seats that would otherwise be unable to READ what they sign.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CHIEF_OF_TRANSIT', 'COORDINATOR', 'CEO')
on conflict do nothing;

-- ===========================================================================
-- 2026-07-29 — Granular user administration. Mirrors migration
-- 20260729000001. The single `admin:users:manage` umbrella could not express
-- "may read the directory" separately from "may create and archive users", so
-- every user-administration capability travelled together. Regenerating a
-- temporary password — which invalidates a live credential — now carries its
-- own permission instead of riding on the token that also lists users.
--
-- Ratified 2026-07-29: SYSTEM_ADMIN only at this stage. HR_OFFICER was
-- considered for admin:users:read and explicitly deferred.
--
-- `admin:users:manage` above is NOT revoked: it remains granted and is honoured
-- by every action as a deprecated compatibility fallback.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('admin:users:read',           'admin', 'read',           'all',
   'Read the staff user directory'),
  ('admin:users:create',         'admin', 'create',         'all',
   'Create a staff user'),
  ('admin:users:update',         'admin', 'update',         'all',
   'Edit a staff user (name, status, role assignments)'),
  ('admin:users:disable',        'admin', 'disable',        'all',
   'Suspend, archive and restore a staff user'),
  ('admin:users:reset_password', 'admin', 'reset_password', 'all',
   'Send a staff user the secure password-reset email'),
  ('admin:users:temp_password',  'admin', 'temp_password',  'all',
   'Generate a temporary password, invalidating the user''s current one'),
  ('admin:users:unlock',         'admin', 'unlock',         'all',
   'Unlock a staff account (lift an authentication ban)')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in (
  'admin:users:read', 'admin:users:create', 'admin:users:update', 'admin:users:disable',
  'admin:users:reset_password', 'admin:users:temp_password', 'admin:users:unlock'
)
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- ===========================================================================
-- FIN-AGING-2 (2026-07-29) — Aging Balance permissions. Mirrors migration
-- 20260729000002. Ratified least-privilege matrix (D-11).
--
-- SYSTEM_ADMIN reads, drafts, stages imports, exports and prints — but does NOT
-- approve imports, validate, finalize, share, or manage templates. Administering
-- the platform is not financial signoff authority; granting it "so an admin can
-- unblock things" is exactly how maker-checker becomes decorative.
--
-- Codes carry an underscore in the third segment (draft_create, import_stage,
-- template_manage): the ratified names used a fourth colon segment, which the
-- repository's permission convention — module:action[:scope], [a-z_] only —
-- does not admit. Same semantics, established separator (cf. admin:users:
-- reset_password).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('finance:aging:read',            'finance_aging', 'read',             'all', 'Consulter la balance âgée'),
  ('finance:aging:draft_create',    'finance_aging', 'draft_create',     'all', 'Créer un brouillon de balance âgée'),
  ('finance:aging:draft_update',    'finance_aging', 'draft_update',     'all', 'Modifier un brouillon de balance âgée'),
  ('finance:aging:import_stage',    'finance_aging', 'import_stage',     'all', 'Préparer et valider un import de créances historiques'),
  ('finance:aging:import_approve',  'finance_aging', 'import_approve',   'all', 'Approuver un lot d''import dans le grand livre clients'),
  ('finance:aging:validate',        'finance_aging', 'validate',         'all', 'Valider une balance âgée'),
  ('finance:aging:finalize',        'finance_aging', 'finalize',         'all', 'Finaliser une balance âgée'),
  ('finance:aging:export',          'finance_aging', 'export',           'all', 'Exporter une balance âgée (Excel / PDF)'),
  ('finance:aging:print',           'finance_aging', 'print',            'all', 'Imprimer une balance âgée'),
  ('finance:aging:share',           'finance_aging', 'share',            'all', 'Partager en externe une balance âgée finalisée'),
  ('finance:aging:template_manage', 'finance_aging', 'template_manage',  'all', 'Administrer les modèles de balance âgée')
on conflict (code) do nothing;

-- Read: the seven finance-visible seats.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CEO', 'SYSTEM_ADMIN')
on conflict do nothing;

-- Draft creation and editing.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:draft_create', 'finance:aging:draft_update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'DAF', 'SYSTEM_ADMIN')
on conflict do nothing;

-- Import staging (preparation). Approval is a DIFFERENT seat, below.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:import_stage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('ACCOUNTANT', 'DAF', 'SYSTEM_ADMIN')
on conflict do nothing;

-- Import approval — NOT SYSTEM_ADMIN.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:import_approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('DAF', 'DGA')
on conflict do nothing;

-- Validation and finalization — NOT SYSTEM_ADMIN.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:validate', 'finance:aging:finalize')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('DAF', 'DGA')
on conflict do nothing;

-- Export and print.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:export', 'finance:aging:print')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CEO', 'SYSTEM_ADMIN')
on conflict do nothing;

-- External sharing — DAF and DGA only. The CEO reads and exports but does not
-- automatically receive operational sharing authority.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:share'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('DAF', 'DGA')
on conflict do nothing;

-- Template administration — DAF. Technical template deployment stays a platform
-- concern and must not let a platform administrator approve financial content.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:template_manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'DAF'
on conflict do nothing;

-- ===========================================================================
-- EMP-4A — Enterprise Mail administration.
--
-- MAIL_ADMIN exists because the only holders of `communication:manage` today
-- are SYSTEM_ADMIN — ratified OUT of correspondence access — and
-- OPS_SUPERVISOR, and granting mailbox provisioning to every operations
-- supervisor would widen a role several people hold.
--
-- It receives mailbox administration and NOTHING ELSE: no admin:*, no
-- finance:*, no document:delete, no role/permission administration, no
-- security configuration. A person holds MAIL_ADMIN and an operational role
-- only by explicit assignment.
--
-- SYSTEM_ADMIN receives NONE of the three new permissions (RATIFY-EMP4A-5),
-- exactly as it receives no hr:* above.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('communication:mailbox:provision', 'communication', 'provision', 'all',
   'Réserver une identité de boîte et enregistrer le résultat de la configuration externe'),
  ('communication:membership:manage', 'communication', 'manage', 'all',
   'Attribuer et révoquer les appartenances et capacités par boîte'),
  ('communication:diagnostics:read', 'communication', 'read', 'all',
   'Consulter le journal des webhooks entrants (diagnostic opérateur)')
on conflict (code) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-000000000001', 'MAIL_ADMIN', 'Administrateur messagerie', 'Mail Administrator', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self',
                'communication:mailbox:provision',
                'communication:membership:manage',
                'communication:diagnostics:read',
                -- The existing minimum needed to USE the surface.
                -- communication:inbound:read is DELIBERATELY ABSENT: RATIFY-EC1-1
                -- keeps it granted to no role, and administering access is not
                -- the same authority as having it.
                'communication:read', 'communication:manage')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'MAIL_ADMIN'
on conflict do nothing;

-- ===========================================================================
-- ICAM-2 (2026-08-30) — the operational incident register.
--
-- Two capabilities on two EXISTING roles. The governance matrix already names
-- both actors, so no role is created: the « Superviseur » records a return or
-- non-conformity (and its treatment completion), the « Responsable Qualité »
-- decides imputability and owns the governed correction.
--
-- They are deliberately SPLIT ACROSS TWO ROLES. Imputability assigns
-- responsibility for a named colleague's work, and the matrix rules that
-- "anything that can blame is NOT entered by the person being measured". The
-- database enforces the person-level rule independently — a recorder is
-- refused on their own incident even if some future role holds both — but the
-- default grants should not invite it.
--
-- SYSTEM_ADMIN receives NEITHER: it may assign these roles, which is not a
-- reason to decide who caused an incident (same doctrine as hr:*).
-- PERFORMANCE_MANAGEMENT and PERFORMANCE_PUBLISHER receive NEITHER: Gestion de
-- la Performance consumes the derived NINC count; it never becomes an incident
-- operator. Migration 20260923000001 asserts both exclusions.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('incident:record', 'incident', 'record', 'assigned',
   'Enregistrer un retour / une non-conformité sur un dossier, et enregistrer la fin de son traitement. Ne confère aucune autorité sur l''imputabilité.'),
  ('incident:adjudicate', 'incident', 'adjudicate', 'assigned',
   'Statuer sur l''imputabilité d''un incident opérationnel, corriger une décision définitive et la revalider. Quatre yeux au niveau de la personne : jamais son propre enregistrement, jamais sa propre correction.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'incident:record'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'incident:adjudicate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;
