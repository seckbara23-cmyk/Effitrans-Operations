-- VERIFIER for 20261009000001_coordinator_tenant_read
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly against
-- production. Mutates no schema, no data, no permission, no session role, no
-- configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is one permission grant, so the postconditions
-- are: the grant reached every COORDINATOR role; it conferred nothing but read;
-- and the mechanism it depends on is still the ratified one. A verifier asserts
-- what ITS OWN migration establishes — it does not assert that any particular
-- dossier is visible to any particular person, which depends on data this
-- migration never touched.
--
-- THE SECOND HALF IS THE POINT. A grant is trivially easy to verify and trivially
-- easy to render meaningless: `file:read:all` confers tenant-wide read ONLY
-- because it is the first ground of `user_readable_file_ids`. Migration 121
-- showed how that goes wrong — a `create or replace` written from a stale body
-- silently deleted four grounds while its own assertions passed. If a future edit
-- dropped the `file:read:all` ground, this grant would become inert, every
-- Coordinator would be blind again, and NOTHING would fail. So the function's
-- ground is asserted here, months later, alongside the grant itself.
--
-- AND IT ASSERTS THE SHAPE OF THE FIX, not just its effect. The ratified
-- instruction was to use the existing governed permission rather than add a
-- COORDINATOR branch to the visibility function. A later "helpful" special case
-- would make the two sources disagree about why a Coordinator can see a dossier,
-- which is exactly how the rule rots. The absence of that branch is checked.
--
-- SUBJECT-CONDITIONAL, COHERENCE UNCONDITIONAL. `verify-migrations.mjs` runs
-- every applied migration's verifier, including against databases that may not
-- hold a COORDINATOR role at all. The grant checks are conditional on there
-- being such a role; the FUNCTION and POLICY checks are not, so this file can
-- never pass vacuously.
--
-- IT NEVER CONSULTS THE MIGRATION LEDGER. `supabase_migrations` is exactly
-- (version, statements, name); the #140/#141 verifiers compared against an
-- `inserted_at` that does not exist and took every other check in the file down
-- with them (MIGRATION-GATE-139-141-REPAIR).
-- ===========================================================================
with subject as (
  select
    (select count(*) from public.role where code = 'COORDINATOR') as coordinator_roles
),
fn as (
  -- COMMENTS STRIPPED, so "no special COORDINATOR branch" is a statement about the
  -- CODE. `pg_get_functiondef` returns body comments too, and migration 148's body
  -- legitimately discusses the role in prose; matching the raw definition would
  -- report that discussion as a branch (MAYA-P1).
  select coalesce(
    (select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'user_readable_file_ids'
      limit 1),
    '') as src
),
pol as (
  select coalesce(
    (select pg_get_expr(pol.polqual, pol.polrelid)
       from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'operational_file'
        and pol.polname = 'operational_file_select'
      limit 1),
    '') as qual
),
checks(label, ok, conditional) as (
  -- ---- 1. the grant reached every COORDINATOR role ----------------------
  values
    ('every COORDINATOR role carries file:read:all', (
      select count(*) = 0
        from public.role r
       where r.code = 'COORDINATOR'
         and not exists (
           select 1
             from public.role_permission rp
             join public.permission p on p.id = rp.permission_id
            where rp.role_id = r.id and p.code = 'file:read:all')
    ), true),

    -- The dossier-read gate is `has_permission('file:read') AND can_read_file`,
    -- so the tenant-wide ground is inert without the baseline read permission.
    ('… alongside the baseline file:read it needs to matter', (
      select count(*) = 0
        from public.role r
       where r.code = 'COORDINATOR'
         and not exists (
           select 1
             from public.role_permission rp
             join public.permission p on p.id = rp.permission_id
            where rp.role_id = r.id and p.code = 'file:read')
    ), true),

    -- ---- 2. THE INVARIANT: it conferred READ and nothing else -------------
    -- COORDINATOR has legitimately held file:transition, file:update,
    -- task:update and the handoff pair since 2026-07-28 / Phase 9.0B, so those
    -- are not listed. These are the authorities it has never held and must not
    -- acquire by way of a visibility fix.
    ('COORDINATOR gained no dossier creation, deletion or assignment authority', (
      select count(*) = 0
        from public.role r
        join public.role_permission rp on rp.role_id = r.id
        join public.permission p on p.id = rp.permission_id
       where r.code = 'COORDINATOR'
         and p.code in ('file:create', 'file:delete', 'file:assign')
    ), true),

    ('… no financial mutation authority', (
      select count(*) = 0
        from public.role r
        join public.role_permission rp on rp.role_id = r.id
        join public.permission p on p.id = rp.permission_id
       where r.code = 'COORDINATOR'
         and p.code in ('finance:issue', 'finance:payment', 'finance:void',
                        'finance:create', 'finance:update')
    ), true),

    ('… and no governance or approval authority', (
      select count(*) = 0
        from public.role r
        join public.role_permission rp on rp.role_id = r.id
        join public.permission p on p.id = rp.permission_id
       where r.code = 'COORDINATOR'
         and p.code in ('decision:approve', 'team:manage', 'admin:config:manage',
                        'admin:users:manage')
    ), true),

    -- The ratified rule is about DOSSIER read. Task reach widens only as a
    -- derived consequence of can_read_task's existing file_id ground — the same
    -- read, not a second grant — so the second tenant-wide permission must not
    -- have ridden along.
    ('… and task:read:all was not granted as well', (
      select count(*) = 0
        from public.role r
        join public.role_permission rp on rp.role_id = r.id
        join public.permission p on p.id = rp.permission_id
       where r.code = 'COORDINATOR' and p.code = 'task:read:all'
    ), true),

    -- ---- 3. THE MECHANISM: the ground the grant depends on still exists ----
    ('user_readable_file_ids still exists', (
      select src <> '' from fn
    ), false),

    ('… with the file:read:all tenant-wide ground the grant relies on', (
      select src like '%file:read:all%' from fn
    ), false),

    -- The instruction was to reuse the governed permission, not to special-case
    -- the role. A COORDINATOR branch here would be a second implementation of a
    -- rule that already exists.
    ('… and with NO special COORDINATOR branch — the permission is the mechanism', (
      select src not like '%COORDINATOR%' from fn
    ), false),

    -- ---- 4. THE INVARIANT: visibility widened, the tenant did not ----------
    ('the visibility function is still bounded to one tenant', (
      select src like '%f.tenant_id = p_tenant%' from fn
    ), false),

    ('the dossier SELECT policy still requires the caller''s own tenant', (
      select qual like '%auth_tenant_id()%' from pol
    ), false),

    ('… and still gates on file:read + can_read_file, not on this grant alone', (
      select qual like '%file:read%' and qual like '%can_read_file%' from pol
    ), false),

    -- ---- 5. no other read ground was traded away for this one -------------
    -- Migration 121 deleted four grounds with a stale `create or replace` while
    -- its own assertions passed. A grant migration must not have been the
    -- occasion for the same loss.
    ('the relationship grounds a role WITHOUT file:read:all depends on are intact', (
      select src like '%f.account_manager_id = p_user%'
         and src like '%f.coordinator_id = p_user%'
         and src like '%f.created_by = p_user%'
         and src like '%pi.owner_user_id = p_user%'
         and src like '%t.assigned_to = p_user%'
         and src like '%e.assigned_user_id = p_user%'
         and src like '%assignment_event ae%'
         and src like '%process_step_receiving_role%'
         and src like '%process_step_owning_role%'
        from fn
    ), false)
)
select
  bool_and(coalesce(c.ok, false)) filter (
    where not c.conditional or (select coordinator_roles from subject) > 0
  ) as ok,
  case
    when not bool_and(coalesce(c.ok, false)) filter (
      where not c.conditional or (select coordinator_roles from subject) > 0
    )
      then 'COORDINATOR-TENANT-VISIBILITY-01 #147 FAILED: '
           || string_agg(c.label, '; ') filter (
                where not coalesce(c.ok, false)
                  and (not c.conditional or (select coordinator_roles from subject) > 0))
    when (select coordinator_roles from subject) = 0
      then 'COORDINATOR-TENANT-VISIBILITY-01 #147 verified (mechanism only): no COORDINATOR role exists in this database, so the grant has no subject here; the visibility function and dossier policy postconditions all hold'
    else 'COORDINATOR-TENANT-VISIBILITY-01 #147 verified: file:read:all held by all '
         || (select coordinator_roles from subject)
         || ' COORDINATOR role(s), no mutation authority added, and the tenant-bounded read ground intact ('
         || count(*) || '/' || count(*) || ' postconditions)'
  end as detail
from checks c;
