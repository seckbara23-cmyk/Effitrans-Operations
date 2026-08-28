-- 20260921000001_performance_management_access.sql
-- ===========================================================================
-- Gestion de la Performance — the module's capabilities AND the assignable
-- role that carries them.
--
-- RATIFIED 2026-08-28 (final access ruling). Access to Gestion de la
-- Performance is granted by an EXPLICIT role assignment, never by holding an
-- operational job role. The System Administrator assigns « Gestion de la
-- Performance » to the people who should read it — the CEO, the person running
-- the exercise, a small number of others — through the existing
-- « Ajouter un rôle… → Attribuer » screen, and removes it the same way.
--
-- The earlier draft of this migration granted performance:read to CEO,
-- OPS_SUPERVISOR and SYSTEM_ADMIN by template. That is the model the ruling
-- replaces: an Operations Supervisor was reading per-person performance because
-- of their job, and a CEO could not be un-granted without editing a template.
-- Both are now assignment questions, which is what an access role is for.
--
-- WHY THE CAPABILITIES STAY THIN. The module presents indicators computed from
-- facts other people govern: customs data, the HR working-day calendar,
-- approved leave. Reading a number about someone's work is not authority over
-- the work, so neither capability implies hr:manage, customs:update,
-- customs:validate, customs:correct, customs:revalidate, or any Finance,
-- Collections, Transport or process-execution authority. The role below holds
-- the two performance capabilities and the profile baseline every role carries.
-- Nothing else. A capability-diff test proves exactly that.
--
-- SYSTEM_ADMIN HOLDS NEITHER, and that is doctrine rather than an exception
-- invented here. DEC-B61 already withholds `hr:*` from SYSTEM_ADMIN because the
-- data is personal — "a deliberate exception to the full-admin grant
-- convention". Per-person performance indicators, computed partly FROM that HR
-- leave data, are the same kind of fact. Administering the platform is not a
-- reason to read what a named colleague produced last month, and SYSTEM_ADMIN
-- needs none of it to do its actual job here: assigning the role runs on
-- admin:roles:manage / admin:users:update, which it already holds. If Effitrans
-- wants a system administrator to read performance, the answer is the same as
-- for everyone else — assign them the role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The capabilities (GLOBAL reference data — no tenant).
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('performance:read', 'performance', 'read', 'tenant',
   'Open Gestion de la Performance and read the ICTD / ICAM / IPAM indicators. Confers NO mutation authority of any kind — not customs capture, not calendar maintenance, not HR records.'),
  ('performance:manage', 'performance', 'manage', 'tenant',
   'Configure Gestion de la Performance where the governed implementation permits it. Confers no operational authority: parameters that would retroactively recompute history are not configurable at all.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The assignable role, for the Effitrans tenant. Guarded backfill: a no-op
--    on an empty database, where seed.sql creates it, and on any tenant that
--    does not exist. New tenants receive it from the role templates, which
--    provision_tenant() materializes.
--
--    This is an ACCESS role, not a job or a department. Somebody holds it IN
--    ADDITION to being CEO, Chargé RH or Operations — the platform has always
--    supported several roles per user, and this uses that rather than adding a
--    parallel mechanism.
-- ---------------------------------------------------------------------------
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001',
       'PERFORMANCE_MANAGEMENT', 'Gestion de la Performance', 'Performance Management', false
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The role's grants — the two capabilities plus the profile baseline every
--    role carries. performance:manage belongs here because it governs only the
--    module's own configuration surface, and that surface is read-only BY
--    CONSTRUCTION: without parameter version pinning an edited coefficient
--    would retroactively rewrite published months (§17.2), so Paramètres
--    refuses editing for every holder. The capability therefore confers no
--    configuration authority today, and a test pins that it does not. When
--    pinning lands, its scope must be revisited before anything becomes
--    editable.
-- ---------------------------------------------------------------------------
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self',
                'performance:read', 'performance:manage')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. No other role receives performance access. Stated as an assertion rather
--    than as silence, because silence is indistinguishable from forgetting.
-- ---------------------------------------------------------------------------
do $$
declare
  v_perm    int;
  v_role    int;
  v_granted int;
  v_leaked  int;
  v_extra   text;
begin
  select count(*) into v_perm from public.permission
   where code in ('performance:read', 'performance:manage');
  if v_perm <> 2 then
    raise exception 'M129: expected 2 performance capabilities in the catalog, found % — an uncataloged permission grants nothing and fails silently', v_perm;
  end if;

  -- Grants are role-relative: migrations run before the seed, so on a fresh
  -- database no role rows exist and every count below is legitimately zero.
  select count(*) into v_role from public.role where code = 'PERFORMANCE_MANAGEMENT';

  select count(*) into v_granted
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'PERFORMANCE_MANAGEMENT' and p.code = 'performance:read';
  if v_granted <> v_role then
    raise exception 'M129: expected % PERFORMANCE_MANAGEMENT grant(s) of performance:read, got %', v_role, v_granted;
  end if;

  -- THE RULING, asserted: no OTHER role holds performance access. An
  -- operational job role must never be a way into this module.
  select count(*), min(r.code) into v_leaked, v_extra
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code in ('performance:read', 'performance:manage')
     and r.code <> 'PERFORMANCE_MANAGEMENT';
  if v_leaked <> 0 then
    raise exception 'M129: % role(s) other than PERFORMANCE_MANAGEMENT hold performance access (e.g. %) — access must come from an explicit role assignment', v_leaked, v_extra;
  end if;

  -- …and the converse: the access role acquired no operational authority.
  select count(*), min(p.code) into v_leaked, v_extra
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'PERFORMANCE_MANAGEMENT'
     and p.code not in ('profile:read:self', 'profile:update:self',
                        'performance:read', 'performance:manage');
  if v_leaked <> 0 then
    raise exception 'M129: PERFORMANCE_MANAGEMENT holds % permission(s) beyond its four (e.g. %) — this is an access role, not a super-role', v_leaked, v_extra;
  end if;

  raise notice 'M129 OK: performance capabilities catalogued; PERFORMANCE_MANAGEMENT created and granted; no operational role holds performance access, and the access role holds no operational authority';
end $$;
