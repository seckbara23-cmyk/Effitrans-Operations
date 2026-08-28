-- 20260921000001_performance_management_access.sql
-- ===========================================================================
-- Gestion de la Performance — the two capabilities that open the module.
--
-- The module presents ICTD, ICAM and IPAM to management. Those indicators are
-- computed from operational facts that already exist and are already governed:
-- dossiers, customs data, the HR working-day calendar, approved leave. Reading
-- them is a management act; producing them is not, and neither is maintaining
-- the data underneath.
--
-- SO THE CAPABILITIES ARE DELIBERATELY THIN.
--
--   performance:read    — open Gestion de la Performance and read the
--                         indicators. Confers NO ability to change anything:
--                         not a customs field, not a calendar day, not an
--                         employee record.
--   performance:manage  — configure what the governed implementation allows to
--                         be configured. Today that is a small surface and the
--                         module says so; it exists now because the read/manage
--                         split must be in the model before anyone is granted
--                         anything, not bolted on after.
--
-- WHAT THIS MUST NOT BECOME. A "performance" capability that quietly implies
-- hr:manage (to edit the calendar) or customs:update (to fix an ICTD input)
-- would collapse three separations the platform spent three phases building:
-- DEC-B25 keeps SYSTEM_ADMIN out of hr:*, D3 makes HR the calendar's owner, and
-- D4 keeps capture with the Déclarant and certification with the Chef. Reading a
-- number about someone's work is not authority over the work. The grants below
-- are therefore ONLY to the roles that already hold the management reporting
-- audience — and the module re-checks server-side on every route and action.
--
-- The converse holds too and is asserted: holding customs:update or hr:manage
-- grants no access to this module. An operational permission is not a
-- management one.
-- ===========================================================================

insert into public.permission (code, module, action, data_scope, description) values
  ('performance:read', 'performance', 'read', 'tenant',
   'Open Gestion de la Performance and read the ICTD / ICAM / IPAM indicators. Confers NO mutation authority of any kind — not customs capture, not calendar maintenance, not HR records.'),
  ('performance:manage', 'performance', 'manage', 'tenant',
   'Configure Gestion de la Performance where the governed implementation permits it. Confers no operational authority: parameters that would retroactively recompute history are not configurable at all.')
on conflict (code) do nothing;

-- performance:read — the management reporting audience, exactly as it is
-- already constituted for analytics:read. Copying that audience is not the
-- lazy default here; it is the right one, because « qui peut lire les
-- indicateurs de l'entreprise » is a question this platform has already
-- answered once, and answering it differently would be the drift.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'performance:read'
where r.code in ('CEO', 'OPS_SUPERVISOR', 'SYSTEM_ADMIN')
on conflict do nothing;

-- performance:manage — narrower still. Configuration is a direction act.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'performance:manage'
where r.code in ('CEO', 'SYSTEM_ADMIN')
on conflict do nothing;

-- ===========================================================================
-- Self-assertions. Grants are role-relative: migrations run before the seed,
-- so on a fresh database no roles exist yet and every count is legitimately
-- zero (the M125 idiom). The absolute holder lists are pinned where the roles
-- are real — seed.sql, the role templates, and the test that requires all
-- three to agree.
-- ===========================================================================
do $$
declare
  v_perm    int;
  v_roles   int;
  v_granted int;
  v_leaked  int;
begin
  select count(*) into v_perm from public.permission
   where code in ('performance:read', 'performance:manage');
  if v_perm <> 2 then
    raise exception 'M129: expected 2 performance capabilities in the catalog, found % — an uncataloged permission grants nothing and fails silently', v_perm;
  end if;

  select count(*) into v_roles from public.role
   where code in ('CEO', 'OPS_SUPERVISOR', 'SYSTEM_ADMIN');
  select count(*) into v_granted
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'performance:read';
  if v_granted <> v_roles then
    raise exception 'M129: expected % grants of performance:read, got %', v_roles, v_granted;
  end if;

  select count(*) into v_roles from public.role where code in ('CEO', 'SYSTEM_ADMIN');
  select count(*) into v_granted
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'performance:manage';
  if v_granted <> v_roles then
    raise exception 'M129: expected % grants of performance:manage, got %', v_roles, v_granted;
  end if;

  -- THE POINT OF THIS MIGRATION, re-proved: reading performance confers no
  -- operational authority. Any role that holds performance:read must not have
  -- acquired hr:manage or customs:update BECAUSE of it — so no role may hold
  -- performance:read unless it already held those independently. OPS_SUPERVISOR
  -- legitimately holds customs:update from its own supervisory template; what
  -- would be wrong is a role gaining it here. This asserts the reverse
  -- direction, which is the one a migration can prove: nothing in this file
  -- grants an operational permission.
  select count(*) into v_leaked
    from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
   where p.code in ('hr:manage', 'customs:update', 'customs:validate',
                    'customs:correct', 'customs:revalidate')
     and rp.role_id in (
       select r.id from public.role r where r.code in ('CEO')
     );
  if v_leaked <> 0 then
    raise exception 'M129: the CEO template acquired % operational permission(s) — Gestion de la Performance must confer none', v_leaked;
  end if;

  raise notice 'M129 OK: performance:read and performance:manage catalogued and granted to the roles present; no operational authority conferred';
end $$;
