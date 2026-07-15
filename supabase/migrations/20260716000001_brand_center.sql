-- 20260716000001_brand_center.sql
-- Effitrans Operations Platform — DBC-1: Digital Brand Center foundation.
-- ---------------------------------------------------------------------------
-- Four tenant-scoped tables + a PUBLIC brand-assets storage bucket. Additive,
-- forward-only, idempotent. Reuses the existing RLS doctrine verbatim:
--   * reads: `to authenticated using (tenant_id = auth_tenant_id() and has_permission(...))`;
--   * writes: SERVICE ROLE ONLY (no authenticated write policy) — every write is a gated
--     server action, exactly like branding / rollout / lifecycle.
-- Nothing here duplicates organization or tenant_branding or app_user data; those stay
-- authoritative and are referenced. No brand colors are seeded (Brand Book supplies them).

-- ===========================================================================
-- 1. brand_asset — registry over objects in the public brand-assets bucket.
--    Created first: the profile / membership / workforce tables reference it.
-- ===========================================================================
create table if not exists public.brand_asset (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id) on delete cascade,
  kind         text not null check (kind in (
                 'LOGO_PRIMARY','LOGO_REVERSED','LOGO_MONOCHROME','LOGO_EMAIL_PNG',
                 'NETWORK_LOGO','EMPLOYEE_PHOTO')),
  title        text,
  -- Server-constructed, immutable, versioned. Never a client-provided path.
  storage_path text not null unique,
  version      integer not null default 1,
  mime         text not null,
  bytes        integer not null,
  width        integer,
  height       integer,
  alt_text     text not null,               -- accessibility: mandatory
  checksum     text,
  status       text not null default 'PUBLISHED'
                 check (status in ('DRAFT','APPROVED','PUBLISHED','RETIRED')),
  source_note  text,
  uploaded_by  uuid references public.app_user (id),
  created_at   timestamptz not null default now(),
  retired_at   timestamptz
);
create index if not exists idx_brand_asset_tenant on public.brand_asset (tenant_id);
create index if not exists idx_brand_asset_tenant_kind on public.brand_asset (tenant_id, kind, status);

alter table public.brand_asset enable row level security;
create policy brand_asset_select_own
  on public.brand_asset for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));
grant select on public.brand_asset to authenticated;

-- ===========================================================================
-- 2. tenant_brand_profile — Brand Center fields NOT owned by tenant_branding.
--    1:1 with organization. Colors nullable (Brand Book). Compliance/footer are
--    nullable OVERRIDES; a pure resolver supplies the approved locked defaults.
-- ===========================================================================
create table if not exists public.tenant_brand_profile (
  tenant_id                    uuid primary key references public.organization (id) on delete cascade,
  color_green                  text,   -- hex, from Brand Book — NEVER invented
  color_gold                   text,
  color_anthracite             text,
  font_heading                 text,   -- allowlisted app-side (Montserrat/Open Sans/Calibri)
  font_body                    text,
  font_email_fallback          text,
  slogan                       text,
  value_proposition            text,
  address                      text,
  legal_identifiers            text,   -- RC / NINEA — legal_name stays on organization
  website_url                  text,
  linkedin_url                 text,
  whistleblower_url            text,   -- https-only; rendered as a button, never printed
  compliance_title             text,   -- nullable overrides of the locked template defaults
  compliance_subtitle          text,
  compliance_description        text,
  compliance_button_label      text,
  sustainability_statement     text,
  environmental_print_statement text,
  footer_line                  text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.app_user (id)
);
create trigger trg_tenant_brand_profile_updated_at
  before update on public.tenant_brand_profile
  for each row execute function public.set_updated_at();

alter table public.tenant_brand_profile enable row level security;
create policy tenant_brand_profile_select_own
  on public.tenant_brand_profile for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));
grant select on public.tenant_brand_profile to authenticated;

-- ===========================================================================
-- 3. tenant_membership_registry — international networks (WCA/FIATA/AWS/EURA…).
--    No data seeded: IDs / dates / logos come from approved Brand Book inputs.
-- ===========================================================================
create table if not exists public.tenant_membership_registry (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id) on delete cascade,
  organization_name text not null,
  membership_id     text,
  official_url      text,
  status            text not null default 'active' check (status in ('active','inactive')),
  valid_from        date,
  expires_at        date,
  display_order     integer not null default 0,
  logo_asset_id     uuid references public.brand_asset (id) on delete set null,
  asset_use_notes   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.app_user (id)
);
create index if not exists idx_membership_tenant on public.tenant_membership_registry (tenant_id, display_order);
create trigger trg_membership_updated_at
  before update on public.tenant_membership_registry
  for each row execute function public.set_updated_at();

alter table public.tenant_membership_registry enable row level security;
create policy membership_select_own
  on public.tenant_membership_registry for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));
grant select on public.tenant_membership_registry to authenticated;

-- ===========================================================================
-- 4. workforce_profile — employee brand-identity extension (1:1 with app_user).
--    Name / email / roles / tenant membership stay authoritative on app_user.
-- ===========================================================================
create table if not exists public.workforce_profile (
  user_id             uuid primary key references public.app_user (id) on delete cascade,
  tenant_id           uuid not null references public.organization (id),
  job_title           text,
  phone_office        text,
  phone_mobile        text,
  whatsapp            text,
  photo_asset_id      uuid references public.brand_asset (id) on delete set null,
  signature_variant   text not null default 'CORPORATE'
                        check (signature_variant in ('EXECUTIVE','MANAGEMENT','CORPORATE')),
  public_card_enabled boolean not null default false,
  -- Unguessable, revocable, NOT derived from user_id. NULL until enabled (DBC-3).
  public_card_token   text unique,
  token_rotated_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.app_user (id)
);
create index if not exists idx_workforce_tenant on public.workforce_profile (tenant_id);
create trigger trg_workforce_profile_updated_at
  before update on public.workforce_profile
  for each row execute function public.set_updated_at();

-- The profile's tenant MUST match the app_user's tenant (defence in depth beyond the
-- gated action, which already scopes by session tenant).
create or replace function public.brand_workforce_tenant_match()
returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from (select tenant_id from public.app_user where id = new.user_id) then
    raise exception 'workforce_profile.tenant_id must match app_user.tenant_id';
  end if;
  return new;
end $$;
create trigger trg_workforce_profile_tenant_match
  before insert or update on public.workforce_profile
  for each row execute function public.brand_workforce_tenant_match();

alter table public.workforce_profile enable row level security;
-- Admin (user management) reads any profile in-tenant; an employee may read their OWN
-- (forward-looking for self-service signatures — harmless in DBC-1).
create policy workforce_profile_select_scoped
  on public.workforce_profile for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.has_permission('admin:users:manage') or user_id = auth.uid())
  );
grant select on public.workforce_profile to authenticated;

-- ===========================================================================
-- 5. Public brand-assets bucket. PUBLIC READ (email clients need stable, non-
--    expiring image URLs). Deny-by-default WRITES: no storage.objects policy for
--    authenticated/anon -> only the service role (gated server actions) may write.
--    PNG only, <=100 KB (MVP). Immutable versioned paths; replacement = new object.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 102400, array['image/png'])
on conflict (id) do nothing;
