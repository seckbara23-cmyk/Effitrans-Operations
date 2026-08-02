-- 20260802000001_hr_documents_contracts.sql
-- Effitrans HR Platform — HR-3: Documents, Contracts & Employee File (HR-0F).
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. HR documents get their OWN bounded context:
-- a dedicated PRIVATE bucket, dedicated tables, dedicated RLS — never
-- public.document (ratified refusal, re-confirmed by FIN-AGING-2).
-- employee_identifier is DELIBERATELY ABSENT: DEC-B63's legal answers on
-- identifier storage are pending, and C3 data gets no dark-first pass.
-- No new permission; no grant; B1 pause untouched. C3-classed documents are
-- readable only with hr:sensitive:read (catalog row exists, granted to nobody).

-- 1. Document-type catalog (per tenant; expiry idiom reused as has_validity).
create table if not exists public.hr_document_type (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.organization (id),
  code                     text not null,
  label_fr                 text not null,
  data_class               text not null default 'C2' check (data_class in ('C1','C2','C3')),
  has_validity             boolean not null default false,
  required_for_termination boolean not null default false,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id, code)
);
drop trigger if exists trg_hr_document_type_updated_at on public.hr_document_type;
create trigger trg_hr_document_type_updated_at before update on public.hr_document_type
  for each row execute function public.set_updated_at();

-- Seed the one type the ratified transition rule needs (backfill, guarded).
insert into public.hr_document_type (tenant_id, code, label_fr, data_class, required_for_termination)
select o.id, 'SOLDE_TOUT_COMPTE', 'Solde de tout compte (signé)', 'C2', true
from public.organization o
on conflict (tenant_id, code) do nothing;

-- 2. Employee documents — soft delete, hash, private storage path.
create table if not exists public.hr_document (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  employee_id      uuid not null references public.employee (id),
  document_type_id uuid not null references public.hr_document_type (id),
  title            text not null,
  storage_path     text not null,
  mime_type        text,
  size_bytes       bigint,
  content_sha256   text,
  expiry_date      date,
  uploaded_by      uuid references public.app_user (id),
  uploaded_at      timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists idx_hr_document_employee on public.hr_document (tenant_id, employee_id);

-- 3. Employment contracts — maker-checker as a CHECK; kind is configuration
--    vocabulary (validated app-side against hr_configuration.employment_kinds).
create table if not exists public.employment_contract (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  employee_id    uuid not null references public.employee (id),
  contract_kind  text not null,
  status         text not null default 'DRAFT' check (status in ('DRAFT','VERIFIED','ENDED')),
  start_date     date not null,
  end_date       date,
  probation_end  date,
  document_id    uuid references public.hr_document (id),
  prepared_by    uuid not null references public.app_user (id),
  verified_by    uuid references public.app_user (id),
  verified_at    timestamptz,
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contract_verifier_differs check (verified_by is null or verified_by <> prepared_by),
  constraint contract_verified_has_verifier check (status <> 'VERIFIED' or verified_by is not null),
  constraint contract_dates_ordered check (end_date is null or end_date >= start_date)
);
create index if not exists idx_contract_employee on public.employment_contract (tenant_id, employee_id);
drop trigger if exists trg_employment_contract_updated_at on public.employment_contract;
create trigger trg_employment_contract_updated_at before update on public.employment_contract
  for each row execute function public.set_updated_at();

-- 4. Tenant template versions — rows are IMMUTABLE (a new version = a new row).
create table if not exists public.hr_template_version (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  code       text not null,
  version    int not null,
  title      text not null,
  body_md    text not null,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, code, version)
);
drop trigger if exists trg_hr_template_version_immutable on public.hr_template_version;
create trigger trg_hr_template_version_immutable
  before update or delete on public.hr_template_version
  for each row execute function public.prevent_mutation();

-- 5. The dedicated PRIVATE bucket. No storage policies for authenticated:
--    service-role only, short-TTL signed URLs minted server-side.
insert into storage.buckets (id, name, public)
values ('hr-documents', 'hr-documents', false)
on conflict (id) do nothing;

-- 6. RLS — dedicated to this bounded context. C3-classed documents require
--    hr:sensitive:read ON TOP of hr:read (the gate exists, granted to nobody).
alter table public.hr_document_type   enable row level security;
alter table public.hr_document        enable row level security;
alter table public.employment_contract enable row level security;
alter table public.hr_template_version enable row level security;

drop policy if exists hr_document_type_select on public.hr_document_type;
create policy hr_document_type_select on public.hr_document_type
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_document_select on public.hr_document;
create policy hr_document_select on public.hr_document
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('hr:read')
    and (
      public.has_permission('hr:sensitive:read')
      or not exists (
        select 1 from public.hr_document_type t
         where t.id = document_type_id and t.data_class = 'C3')
    )
  );

drop policy if exists employment_contract_select on public.employment_contract;
create policy employment_contract_select on public.employment_contract
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_template_version_select on public.hr_template_version;
create policy hr_template_version_select on public.hr_template_version
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_document_type, public.hr_document,
                public.employment_contract, public.hr_template_version
  to authenticated;
