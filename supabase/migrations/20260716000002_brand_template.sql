-- 20260716000002_brand_template.sql
-- Effitrans Operations Platform — DBC-6: brand template governance.
-- ---------------------------------------------------------------------------
-- One tenant-scoped row per (category, template_key) tracking its lifecycle state. Same RLS
-- doctrine as the rest of the Brand Center: read gated by auth_tenant_id + admin:config:manage;
-- writes are service-role only (the gated governance action). Additive/forward-only.

create table if not exists public.brand_template (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id) on delete cascade,
  category         text not null check (category in ('SIGNATURE','DOCUMENT','PRESENTATION','COMMUNICATION','MARKETING_EMAIL')),
  template_key     text not null,
  lifecycle_status text not null default 'DRAFT' check (lifecycle_status in ('DRAFT','APPROVED','PUBLISHED','RETIRED')),
  version          integer not null default 1,
  updated_by       uuid references public.app_user (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_brand_template on public.brand_template (tenant_id, category, template_key);
create index if not exists idx_brand_template_tenant on public.brand_template (tenant_id);

create trigger trg_brand_template_updated_at
  before update on public.brand_template
  for each row execute function public.set_updated_at();

alter table public.brand_template enable row level security;
create policy brand_template_select_own
  on public.brand_template for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));
grant select on public.brand_template to authenticated;
