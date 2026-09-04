-- H-9 (ratified 2026-09-03) — the Operations Supervisor maintains the dossier.
-- ---------------------------------------------------------------------------
-- THE RATIFIED PRINCIPLE. A dossier is a living operational record: information
-- arrives and is corrected throughout an operation, and authorized Operations
-- personnel must be able to maintain it. Workflow progression must not freeze
-- ordinary dossier metadata.
--
-- WHAT WAS TRUE BEFORE. `file:update` (edit dossier / master data) was held by
-- SYSTEM_ADMIN, ACCOUNT_MANAGER and COORDINATOR. OPS_SUPERVISOR — the role that
-- opens dossiers, assigns owners, advances the status ladder and supervises the
-- whole operation — held none of it, so the supervisor could close a dossier but
-- not correct a destination on it.
--
-- WHAT THIS CHANGES, AND ONLY THIS. One grant, one role, one tenant-scoped row
-- per tenant. It does NOT:
--   * grant `file:create` — deliberately withheld (creation stays where it is);
--   * merge `file:update` with `file:transition` — those remain two distinct
--     authorities, exactly as ratified on 2026-07-28. Only the GRANT moved;
--   * confer any authority over independently governed records. Finance
--     authorizations (DEC-C08 chain), customs declarations, the signed POD and
--     payment confirmations each keep their own permission and their own
--     maker-checker, and none of them is reachable through `file:update`.
--
-- Idempotent, additive, reversible by deleting the same row. No table, policy,
-- function or RLS rule is touched.
--
-- Mirrors: lib/platform/role-templates.ts (OPS_SUPERVISOR) and supabase/seed.sql
-- — the three grant sources must agree, and a parity test asserts they do.

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:update'
where r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- Assert the outcome rather than trusting the insert: every tenant that has an
-- OPS_SUPERVISOR role must now have the grant. Fails loudly here rather than
-- silently leaving a supervisor unable to edit.
do $$
declare
  missing integer;
begin
  select count(*) into missing
  from public.role r
  where r.code = 'OPS_SUPERVISOR'
    and not exists (
      select 1
      from public.role_permission rp
      join public.permission p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'file:update'
    );
  if missing > 0 then
    raise exception 'H-9: % OPS_SUPERVISOR role(s) still lack file:update', missing;
  end if;
end $$;
