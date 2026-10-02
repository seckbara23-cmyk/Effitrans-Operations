-- VERIFIER for 20261010000001_tenant_scope_read_all_ground
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly against
-- production. Mutates no schema, no data, no permission, no session role, no
-- configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is one narrowed ground inside one function, so
-- the postconditions are: the ground is tenant-scoped, the untenanted lookup is
-- gone, and nothing else in that function moved.
--
-- THE THIRD HALF IS THE POINT. A `create or replace` on this function is how
-- migration 121 silently deleted four read grounds while its own assertions
-- passed — a subset proves a subset. So every ground is listed here
-- INDIVIDUALLY, by the predicate that implements it, and this file is what runs
-- months later to notice that a later edit dropped one.
--
-- UNCONDITIONAL THROUGHOUT. The evidence is the function definition, which exists
-- in every database this migration has been applied to, so there is no subject to
-- be absent and no branch that can pass vacuously.
--
-- IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file down
-- with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with fn as (
  -- COMMENTS STRIPPED. `pg_get_functiondef` reproduces the body verbatim, comments
  -- included, so matching the raw definition asserts about prose as well as code —
  -- MAYA-P1's lesson, and the thing that made migration 148's first revision abort
  -- `supabase start` by tripping over its own explanatory comment.
  select coalesce(
    (select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'user_readable_file_ids'
      limit 1),
    '') as src
),
holders as (
  select
    (select count(distinct ur.user_id)
       from public.user_role ur
       join public.role_permission rp on rp.role_id = ur.role_id
       join public.permission p on p.id = rp.permission_id
      where p.code = 'file:read:all') as untenanted,
    (select count(distinct ur.user_id)
       from public.user_role ur
       join public.app_user au on au.id = ur.user_id
       join public.role r on r.id = ur.role_id
       join public.role_permission rp on rp.role_id = ur.role_id
       join public.permission p on p.id = rp.permission_id
      where p.code = 'file:read:all'
        and ur.tenant_id = au.tenant_id
        and r.tenant_id = au.tenant_id) as scoped
),
checks(label, ok) as (
  values
    -- ---- 1. the function is still there ------------------------------------
    ('user_readable_file_ids exists', (select src <> '' from fn)),

    -- ---- 2. the governance ground is bounded by the tenant -----------------
    ('the governance ground requires the role to be HELD in this tenant', (
      select src like '%ur0.tenant_id = p_tenant%' from fn
    )),
    ('… and to BELONG to this tenant', (
      select src like '%r0.tenant_id = p_tenant%' from fn
    )),
    ('… and it is still the file:read:all ground, not something else', (
      select src like '%file:read:all%' from fn
    )),
    -- The whole defect was this call: get_user_permissions has no tenant filter,
    -- so the tenant came only from the caller's argument.
    ('the untenanted get_user_permissions lookup is gone from this function', (
      select src not like '%get_user_permissions%' from fn
    )),

    -- ---- 3. the row-level tenant bound is untouched ------------------------
    ('rows are still bounded by f.tenant_id = p_tenant', (
      select src like '%where f.tenant_id = p_tenant%' from fn
    )),

    -- ---- 4. EVERY other ground, individually (the migration-121 lesson) ----
    ('ground: commercial account manager', (select src like '%f.account_manager_id = p_user%' from fn)),
    ('ground: coordinator_id', (select src like '%f.coordinator_id = p_user%' from fn)),
    ('ground: created_by', (select src like '%f.created_by = p_user%' from fn)),
    ('ground: WES-3G operational owner', (select src like '%pi.owner_user_id = p_user%' from fn)),
    ('ground: assigned task', (select src like '%t.assigned_to = p_user%' from fn)),
    ('ground: WES-3B step assignee', (select src like '%e.assigned_user_id = p_user%' from fn)),
    ('ground: assignment_event history', (select src like '%assignment_event ae%' from fn)),
    ('ground: customs department involvement', (
      select src like '%CUSTOMS_FIELD_AGENT%' and src like '%customs_record c%' from fn
    )),
    ('ground: 121 handoff receiver, bounded to SENT', (
      select src like '%process_step_receiving_role%' and src like '%h.status = ''SENT''%' from fn
    )),
    ('ground: F-1 responsibility', (select src like '%process_step_owning_role%' from fn)),
    ('… with the F-1 assignee narrowing', (select src like '%ex.assigned_user_id is null%' from fn)),
    ('… and the F-1 open-state bound', (
      select src like '%ex.state in (''AVAILABLE'', ''ACTIVE'', ''BLOCKED'', ''SUBMITTED'')%' from fn
    )),

    -- ---- 5. THE INVARIANT: it narrowed the TENANT, not the audience --------
    -- Everyone who resolves tenant-wide must still do so in their own tenant.
    -- If these two ever diverge, the scoping is revoking somebody's legitimate
    -- visibility rather than only refusing a foreign tenant.
    ('no tenant-wide reader lost their own tenant', (
      select scoped = untenanted from holders
    )),

    -- ---- 6. still a definer function, or the ground cannot be evaluated ----
    ('it is still SECURITY DEFINER with a pinned search_path', (
      select src like '%SECURITY DEFINER%' and src like '%search_path%' from fn
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when not bool_and(coalesce(c.ok, false))
      then 'TENANT-SCOPE-READ-ALL #148 FAILED: '
           || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
    else 'TENANT-SCOPE-READ-ALL #148 verified: the file:read:all ground is tenant-bounded, '
         || (select untenanted from holders)
         || ' tenant-wide reader(s) unaffected, and all 11 other read grounds intact ('
         || count(*) || '/' || count(*) || ' postconditions)'
  end as detail
from checks c;
