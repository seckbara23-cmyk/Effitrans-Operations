-- 20260712110000_company_metadata_branding.sql
-- Effitrans Operations Platform — PHASE 4.0B-3: Company metadata + tenant branding.
-- ---------------------------------------------------------------------------
-- Adds platform-level company metadata to `organization` (reused, not duplicated)
-- and a dedicated 1:1 `tenant_branding` table for tenant-resolved output branding.
--
-- Additive + forward-only + idempotent; no destructive backfill; no RLS weakening.
-- The existing Effitrans tenant is backfilled to today's values so nothing changes
-- visually (the de-branding in 4.0B-4 reads these). NOTE: on a fresh local/CI
-- `db reset` the organization row is seeded by seed.sql AFTER migrations run, so
-- the backfill here is a no-op there and seed.sql mirrors it; on a linked/production
-- DB (where the org already exists) this migration performs the backfill.

-- Company metadata on organization (additive) --------------------------------
alter table public.organization
  add column if not exists legal_name        text,
  add column if not exists trade_name        text,
  add column if not exists slug              text,
  add column if not exists lifecycle_status  text not null default 'ACTIVE'
    check (lifecycle_status in ('TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  add column if not exists product_profile   text not null default 'LOGISTICS_COMPANY'
    check (product_profile in ('LOGISTICS_COMPANY', 'ENTERPRISE_SHIPPER', 'GOVERNMENT_AGENCY', 'PLATFORM_OPERATOR')),
  add column if not exists locale            text not null default 'fr',
  add column if not exists currency          text not null default 'XOF',
  add column if not exists timezone          text not null default 'Africa/Dakar',
  add column if not exists plan_key          text,
  add column if not exists trial_started_at  timestamptz,
  add column if not exists trial_ends_at     timestamptz,
  add column if not exists onboarding_status text not null default 'complete'
    check (onboarding_status in ('pending', 'in_progress', 'complete')),
  add column if not exists branding_complete boolean not null default false;

-- Slugs are globally unique (they become tenant subdomains / URL segments later).
create unique index if not exists uq_organization_slug
  on public.organization (lower(slug)) where slug is not null;

-- tenant_branding (1:1 with organization) ------------------------------------
create table if not exists public.tenant_branding (
  tenant_id           uuid primary key references public.organization (id) on delete cascade,
  display_name        text,
  logo_url            text,
  portal_logo_url     text,
  primary_color       text,
  secondary_color     text,
  email_footer        text,
  pdf_header_text     text,
  invoice_footer_text text,
  support_email       text,
  support_phone       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_tenant_branding_updated_at
  before update on public.tenant_branding
  for each row execute function public.set_updated_at();

-- RLS: tenant staff read their OWN tenant's branding. Writes and platform reads
-- run via the service role (branding-management UI is a later phase). No
-- cross-tenant read is possible — the resolver never leaks another tenant's brand.
alter table public.tenant_branding enable row level security;

create policy tenant_branding_select_own
  on public.tenant_branding for select to authenticated
  using (tenant_id = public.auth_tenant_id());

grant select on public.tenant_branding to authenticated;

-- Production backfill (linked DB where the Effitrans org already exists). On a
-- fresh CI reset the org does not exist yet, so these affect 0 rows and seed.sql
-- performs the equivalent mirror after inserting the org.
update public.organization
set legal_name        = coalesce(legal_name, 'Effitrans'),
    trade_name        = coalesce(trade_name, 'Effitrans'),
    slug              = coalesce(slug, 'effitrans'),
    plan_key          = coalesce(plan_key, 'ENTERPRISE'),
    lifecycle_status  = 'ACTIVE',
    onboarding_status = 'complete',
    branding_complete = true
where id = '00000000-0000-0000-0000-000000000001';

insert into public.tenant_branding
  (tenant_id, display_name, primary_color, secondary_color, email_footer, pdf_header_text)
select '00000000-0000-0000-0000-000000000001', 'Effitrans Operations', '#0B1F33', '#0F766E',
       'Effitrans Operations · Dakar, Sénégal', 'EFFITRANS OPERATIONS'
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id) do nothing;
