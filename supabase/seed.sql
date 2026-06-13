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
