-- 20260615000002_create_customs.sql
-- Effitrans Operations Platform — PHASE 1.9: Customs clearance (dossier-attached).
--
-- Realizes DEC-B01 (MANUAL reference-tracking — no GAINDE/Orbus API; BLK-1 real
-- integration stays deferred). One customs_record per operational_file (1:1).
-- Visibility INHERITS the dossier (Phase 1.7 can_read_file) — no customs:read:all.
-- Soft-delete via deleted_at; CANCELLED is the normal workflow abort. EXPIRED/
-- duties/tariff are out of scope (no finance, no tariff computation).
--
-- SCOPE GUARD: customs reference tracking only. No GAINDE/Orbus, no duties/tax
-- calculation, no finance, no transport module, no portal. RLS + audit preserved.

-- ===========================================================================
-- 1. Document-type flag: which document types gate the DECLARED transition.
--    Additive + editable (Chief of Transit can adjust). Defaults seeded below.
-- ===========================================================================
alter table public.document_type
  add column if not exists gates_customs boolean not null default false;

update public.document_type set gates_customs = true
  where code in ('COMMERCIAL_INVOICE', 'PACKING_LIST', 'CUSTOMS_DECLARATION',
                 'BILL_OF_LADING', 'AIRWAY_BILL');
-- Certificate of Origin remains conditional (not a hard gate by default).

-- ===========================================================================
-- 2. customs_record (1:1 with operational_file).
-- ===========================================================================
create table public.customs_record (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  file_id            uuid not null unique references public.operational_file (id) on delete cascade,
  status             text not null default 'NOT_STARTED'
                       check (status in ('NOT_STARTED', 'DOCUMENTS_PENDING', 'DECLARATION_PREPARED',
                                         'DECLARED', 'UNDER_REVIEW', 'INSPECTION', 'DUTIES_ASSESSED',
                                         'RELEASED', 'BLOCKED', 'CANCELLED')),
  required           boolean not null default true,   -- escape hatch for the close-guard
  declaration_number text,
  customs_office     text,
  regime             text,
  declaration_date   date,
  bae_reference      text,                            -- Bon À Enlever / release reference
  release_date       date,
  inspection_status  text not null default 'NOT_REQUIRED'
                       check (inspection_status in ('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED')),
  external_ref       text,                            -- reserved for GAINDE/Orbus number (manual)
  notes              text,
  created_by         uuid references public.app_user (id),
  reviewed_by        uuid references public.app_user (id),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_customs_tenant_status on public.customs_record (tenant_id, status) where deleted_at is null;
create index idx_customs_file on public.customs_record (file_id);

create trigger trg_customs_updated_at before update on public.customs_record
  for each row execute function public.set_updated_at();

-- Integrity: a customs record's tenant must match its dossier's tenant.
create or replace function public.enforce_customs_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'customs tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_customs_tenant before insert or update on public.customs_record
  for each row execute function public.enforce_customs_tenant();

-- ===========================================================================
-- 3. RLS — read inherits dossier visibility (Phase 1.7). Writes via the
--    service-role admin client in server actions (deny-by-default). Soft-deleted
--    rows are never returned.
-- ===========================================================================
alter table public.customs_record enable row level security;

create policy customs_record_select on public.customs_record
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('customs:read')
    and public.can_read_file(file_id)
    and deleted_at is null
  );

grant select on public.customs_record to authenticated;

-- ===========================================================================
-- 4. Permissions (catalog + role grants, mirrored in seed.sql). Release is the
--    BAE authority (DEC: SYSTEM_ADMIN, OPS_SUPERVISOR, CHIEF_OF_TRANSIT).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('customs:create',  'customs', 'create',  'assigned', 'Create customs records'),
  ('customs:read',    'customs', 'read',    'assigned', 'View customs records'),
  ('customs:update',  'customs', 'update',  'assigned', 'Edit / progress customs records'),
  ('customs:release', 'customs', 'release', 'assigned', 'Release customs (BAE / RELEASED)'),
  ('customs:delete',  'customs', 'delete',  'assigned', 'Delete customs records (soft)')
on conflict (code) do nothing;

-- read: everyone who works dossiers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER')
on conflict do nothing;

-- create + update: the declaration preparers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:create', 'customs:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT')
on conflict do nothing;

-- release: the BAE authority (not CUSTOMS_DECLARANT).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:release'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

-- delete (soft): admin + ops supervisor.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;
