-- ===========================================================================
-- Migration 124 — C-4: the quotation lead may READ its own step's evidence.
-- ===========================================================================
-- Step 1 (Cotation) requires QUOTATION and QUOTATION_APPROVAL as evidence, and
-- QUOTATION_MANAGER is the role that owns that step. It held no document:read,
-- so both items evaluated to `unauthorized` — neither satisfied nor missing.
-- The engine's completeness test ignored `unauthorized`, so the step reported
-- complete on an empty `missing` and closed having verified nothing. The write
-- path now refuses that case with `evidence_unauthorized`; without this grant
-- the same role would be hard-blocked from the step it exists to perform.
--
-- SCOPE — verified before granting, not assumed. This adds a CAPABILITY, not
-- reach. Every path that returns document rows bounds them independently:
--   * RLS  — document_select and both document-intelligence policies are each
--            `tenant_id = auth_tenant_id() AND has_permission('document:read')
--             AND can_read_file(file_id)`. There is no policy anywhere where
--            document:read is the only gate.
--   * app  — admin-client reads bypass RLS and so rebuild the filter by hand:
--            listDocuments and missingDocuments call isFileVisible per dossier,
--            getDocumentationQueue narrows with resolveFileScope + .in(ids).
-- QUOTATION_MANAGER holds no file:read:all, so its dossier scope stays exactly
-- what user_readable_file_ids grants it by ground. It gains sight of documents
-- on dossiers it already legitimately reaches, and on none it does not.
--
-- Mirrored in supabase/seed.sql (new tenants) and lib/platform/role-templates.ts
-- (provisioning), whose parity is asserted by tests/role-templates.test.ts.
-- Tenant-wide by design: every tenant's quotation lead needs this, so this is
-- keyed on role code, not on the pilot tenant id.

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'document:read'
where r.code = 'QUOTATION_MANAGER'
on conflict do nothing;

-- Self-assertion: every QUOTATION_MANAGER role row now carries document:read,
-- and the grant did not leak to a role that should not have it. The second
-- check is the one that matters — an unqualified insert would have been silent.
do $$
declare
  v_roles int;
  v_granted int;
  v_quotation_only int;
begin
  select count(*) into v_roles from public.role where code = 'QUOTATION_MANAGER';

  select count(*) into v_granted
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'QUOTATION_MANAGER' and p.code = 'document:read';

  if v_granted <> v_roles then
    raise exception 'M124: expected % QUOTATION_MANAGER grants, got %', v_roles, v_granted;
  end if;

  -- The role must still NOT hold document:create / document:update / approve:
  -- reading its evidence is not authoring or signing it.
  select count(*) into v_quotation_only
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'QUOTATION_MANAGER'
    and p.code in ('document:create', 'document:update', 'document:approve');

  if v_quotation_only <> 0 then
    raise exception 'M124: QUOTATION_MANAGER must read evidence, not author it (got % write grants)', v_quotation_only;
  end if;

  raise notice 'M124 OK: document:read granted to % QUOTATION_MANAGER role(s), no write grants', v_granted;
end $$;
