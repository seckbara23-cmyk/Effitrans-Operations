-- 20260712120000_tenant_branding_tagline.sql
-- Phase 4.0B-5: add a branding `tagline` (the wordmark / report subtitle) so it is
-- tenant-driven rather than a hardcoded Effitrans string that would otherwise leak
-- to other tenants. Additive + idempotent; no RLS change.

alter table public.tenant_branding add column if not exists tagline text;

-- Backfill the Effitrans tenant's tagline (no-op on a fresh CI DB where the row is
-- seeded afterwards; seed.sql sets it there).
update public.tenant_branding
set tagline = coalesce(tagline, 'Transit • Logistique • Douane')
where tenant_id = '00000000-0000-0000-0000-000000000001';
