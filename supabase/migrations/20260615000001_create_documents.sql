-- 20260615000001_create_documents.sql
-- Effitrans Operations Platform — PHASE 1.8: Documents (dossier attachments).
--
-- Approved via DEC-B21 (BLK-3 MVP slice). An editable document_type catalog +
-- a document table linked to operational_file. Visibility INHERITS the dossier:
-- a document is readable iff the caller holds document:read AND can_read_file()
-- (Phase 1.7) — no document:read:all. Soft-delete via deleted_at (no CANCELLED).
-- EXPIRED is DERIVED in the app (no scheduler); only the workflow statuses are
-- stored. Files live in a PRIVATE storage bucket; access is server-mediated via
-- short-TTL signed URLs (no public URLs, no direct authenticated storage access).
--
-- SCOPE GUARD: documents only. No customs/finance/transport/portal/OCR. No
-- external integrations. RLS + append-only audit preserved.

-- ===========================================================================
-- 1. Editable document-type catalog (global reference data; seeded with the
--    approved 10 MVP types). required_for drives the dossier "missing docs"
--    indicator. Validity values are placeholders (DEC-B03 full values pending).
-- ===========================================================================
create table public.document_type (
  code                  text primary key,
  label_fr              text not null,
  label_en              text,
  category              text not null,
  has_validity          boolean not null default false,
  default_validity_days int,
  renewable             boolean not null default false,
  required_for          text[] not null default '{}',  -- dossier types: IMP/EXP/TRP/HND
  conditional           boolean not null default false,
  active                boolean not null default true,
  sort_order            int not null default 0
);

insert into public.document_type (code, label_fr, label_en, category, has_validity, required_for, conditional, sort_order) values
  ('BILL_OF_LADING',        'Connaissement (BL)',          'Bill of Lading',        'transport',   false, '{}',            true,  10),
  ('AIRWAY_BILL',           'Lettre de transport aérien',  'Air Waybill',           'transport',   false, '{}',            true,  20),
  ('COMMERCIAL_INVOICE',    'Facture commerciale',         'Commercial Invoice',    'commercial',  false, '{IMP,EXP}',     false, 30),
  ('PACKING_LIST',          'Liste de colisage',           'Packing List',          'transport',   false, '{IMP,EXP,HND}', false, 40),
  ('CERTIFICATE_OF_ORIGIN', 'Certificat d''origine',       'Certificate of Origin', 'compliance',  true,  '{}',            true,  50),
  ('CUSTOMS_DECLARATION',   'Déclaration en douane',       'Customs Declaration',   'customs',     false, '{IMP,EXP}',     false, 60),
  ('DELIVERY_NOTE',         'Bon de livraison / POD',      'Delivery Note / POD',   'operational', false, '{IMP,TRP,HND}', false, 70),
  ('TRANSPORT_ORDER',       'Ordre de transport',          'Transport Order',       'transport',   false, '{TRP}',         false, 80),
  ('PAYMENT_RECEIPT',       'Reçu de paiement',            'Payment Receipt',       'financial',   false, '{}',            false, 90),
  ('OTHER',                 'Autre document',              'Other',                 'operational', false, '{}',            false, 100)
on conflict (code) do nothing;

alter table public.document_type enable row level security;
create policy document_type_select on public.document_type
  for select to authenticated using (true);
grant select on public.document_type to authenticated;

-- ===========================================================================
-- 2. Document instances (linked to a dossier).
-- ===========================================================================
create table public.document (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  file_id       uuid not null references public.operational_file (id) on delete cascade,
  type_code     text not null references public.document_type (code),
  title         text,
  status        text not null default 'UPLOADED'
                  check (status in ('UPLOADED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED')),
  version       int not null default 1,
  supersedes_id uuid references public.document (id),
  expiry_date   date,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references public.app_user (id),
  reviewed_by   uuid references public.app_user (id),
  review_note   text,
  deleted_at    timestamptz,                 -- soft delete (DEC-B21 D6)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_document_file on public.document (file_id) where deleted_at is null;
create index idx_document_tenant on public.document (tenant_id);
create index idx_document_type on public.document (type_code);
create index idx_document_expiry on public.document (tenant_id, expiry_date) where deleted_at is null;

create trigger trg_document_updated_at before update on public.document
  for each row execute function public.set_updated_at();

-- Integrity: a document's tenant must match its dossier's tenant.
create or replace function public.enforce_document_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'document tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_document_tenant before insert or update on public.document
  for each row execute function public.enforce_document_tenant();

-- ===========================================================================
-- 3. RLS — read inherits dossier visibility (Phase 1.7 can_read_file). Writes
--    via the service-role admin client in server actions (deny-by-default).
--    Soft-deleted rows are never returned.
-- ===========================================================================
alter table public.document enable row level security;

create policy document_select on public.document
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('document:read')
    and public.can_read_file(file_id)
    and deleted_at is null
  );

grant select on public.document to authenticated;

-- ===========================================================================
-- 4. Permissions (catalog + role grants, mirrored in seed.sql).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('document:create',  'document', 'create',  'assigned', 'Upload documents'),
  ('document:read',    'document', 'read',    'assigned', 'View / download documents'),
  ('document:update',  'document', 'update',  'assigned', 'Edit document metadata'),
  ('document:approve', 'document', 'approve', 'assigned', 'Approve / reject documents'),
  ('document:delete',  'document', 'delete',  'assigned', 'Delete documents (soft)')
on conflict (code) do nothing;

-- read: everyone who can read dossiers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'DOCUMENTATION_OFFICER',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

-- create + update: operational roles that handle paperwork.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'OPS_SUPERVISOR', 'COORDINATOR',
                 'DOCUMENTATION_OFFICER', 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT',
                 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR')
on conflict do nothing;

-- approve / reject: managers + documentation authority + compliance (DEC-B21 D4).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'CHIEF_OF_TRANSIT', 'COMPLIANCE_HSSE')
on conflict do nothing;

-- delete (soft): admin + ops supervisor.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

-- ===========================================================================
-- 5. Private storage bucket. Deny-by-default: NO storage.objects policies for
--    authenticated -> direct client access is denied; the only path is the
--    server actions (service role) which mint short-TTL signed URLs. No public
--    URLs. Size/MIME limits enforced at the bucket too (DEC-B21 D7).
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;
