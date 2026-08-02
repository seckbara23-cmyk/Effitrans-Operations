-- ===========================================================================
-- EC-3C — Commercial / Quotation ACTIVATION (migration 83)
--
-- Implements DEC-C32 (RATIFY-EC3-1, answered 2026-08-06). EC-3B built the
-- module and deliberately left every quotation authority held by NOBODY;
-- this migration assigns them, and only them.
--
--   QUOTATION_MANAGER  → quotation:create, quotation:send, quotation:approve
--   OPS_SUPERVISOR     → quotation:validate
--   SYSTEM_ADMIN       → NOTHING (re-asserted below, not merely assumed)
--
-- It also corrects a real defect found by the audit DEC-C32 required: all three
-- quotation SELECT policies gate on `quotation:create` alone, so a supervisor
-- holding only `quotation:validate` could not SEE the quotation they are
-- required to validate. The policies are widened to `create OR validate`.
-- No `quotation:read` is invented — the existing family expresses this.
--
-- Additive, idempotent, forward-only. Migrations 1–82 are untouched.
-- ===========================================================================

-- ===========================================================================
-- 1. THE GRANT MATRIX — exactly what DEC-C32 ratified, and nothing else.
--
--    Tenant-pinned to the primary tenant, following the idiom of every prior
--    grant migration in this repository (e.g. 20260718000001). New tenants
--    receive the same matrix from lib/platform/role-templates.ts at
--    provisioning, and local/CI databases from supabase/seed.sql. All three
--    sources must agree: EC-3B proved that a grant present in only some of
--    them produces a database that disagrees with itself.
-- ===========================================================================

-- The quotation agents: prepare, send, and record the customer's acceptance.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('quotation:create', 'quotation:send', 'quotation:approve')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;

-- Internal managerial validation. OPS_SUPERVISOR receives `quotation:validate`
-- and NOTHING ELSE — explicitly not `quotation:create`, which DEC-C32 refuses
-- as a way of making quotations readable. Readability is solved in §2.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'quotation:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- SYSTEM_ADMIN holds no quotation authority. This is already true after
-- migration 82, and is re-asserted here rather than assumed: an administrator
-- must never be able to prepare, validate, send or accept a commercial offer.
-- Same doctrine as DEC-C31 for the expense chain.
delete from public.role_permission rp
 using public.permission p, public.role r
 where p.id = rp.permission_id
   and r.id = rp.role_id
   and r.code = 'SYSTEM_ADMIN'
   and p.code in ('quotation:create', 'quotation:send',
                  'quotation:approve', 'quotation:validate');

-- ===========================================================================
-- 2. READ COMPOSITION — the audit's one real finding.
--
--    A supervisor holding only `quotation:validate` matched none of the three
--    SELECT policies, so the validation queue would have been empty for exactly
--    the person who has to work it. Widened to `create OR validate`: that
--    admits the quotation agents and the validating supervisors, and nobody
--    else. `quotation:send` / `:approve` are deliberately NOT in the predicate
--    — under DEC-C32 no role holds either without `quotation:create`, so adding
--    them would widen the read surface without admitting one legitimate reader.
--
--    RLS remains SELECT-only for `authenticated`: every write goes through the
--    SECURITY DEFINER RPCs. And note this is defence in depth, not the app's
--    gate — lib/commercial reads on the admin client, which bypasses RLS, so
--    EC-3C gates those reads in the application as well.
-- ===========================================================================

drop policy if exists quotation_request_select on public.quotation_request;
create policy quotation_request_select on public.quotation_request
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.has_permission('quotation:create')
         or public.has_permission('quotation:validate'))
  );

drop policy if exists quotation_select on public.quotation;
create policy quotation_select on public.quotation
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.has_permission('quotation:create')
         or public.has_permission('quotation:validate'))
  );

drop policy if exists quotation_line_select on public.quotation_line;
create policy quotation_line_select on public.quotation_line
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.has_permission('quotation:create')
         or public.has_permission('quotation:validate'))
  );
