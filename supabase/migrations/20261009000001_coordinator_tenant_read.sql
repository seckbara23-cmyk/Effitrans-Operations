-- ===========================================================================
-- Migration 147 — COORDINATOR-TENANT-VISIBILITY-01: the control tower SEES the
-- whole tenant. (ratified 2026-10-01)
-- ===========================================================================
-- WHY A MIGRATION AND NOT JUST THE TEMPLATE. `provision_tenant` materializes
-- `role_permission` from the TypeScript templates exactly once, for a tenant that
-- does not yet exist — it returns `already_exists` and writes nothing when the
-- slug or the administrator is already taken. `supabase/seed.sql` only ever runs
-- against a fresh stack. So neither authoritative source reaches a tenant that is
-- already provisioned: without this migration the Effitrans tenant's COORDINATOR
-- role row would keep the 47 permissions it has today and the defect would
-- survive every deploy. This is the third source, and the only one that reaches
-- production.
--
-- WHAT WAS WRONG. Every ground in `user_readable_file_ids` other than
-- `file:read:all` asks "is this dossier attached to you PERSONALLY?" — you are
-- its account manager, its coordinator_id, its creator, its process owner, the
-- assignee of one of its tasks or steps, a name in its assignment ledger, a
-- member of the receiving role of an open handoff, or the holder of a role that
-- owns one of its OPEN and UNASSIGNED steps. A Coordinator who had not personally
-- handled a dossier matches none of them. Proven against production on
-- 2026-10-01: `user_readable_file_ids(coordonateur.demo, tenant A)` returned ZERO
-- rows while the tenant held fourteen dossiers, so the seat whose whole purpose
-- is oversight could not open a single one of them.
--
-- THE RATIFIED RULE. A Coordinator SEES every dossier belonging to their tenant,
-- regardless of who created it, who the Account Manager is, who the current
-- assignee is, who holds custody, which department or step is current, and
-- whether the Coordinator ever touched it. Closed and cancelled dossiers stay
-- readable: neither `operational_file_select` nor `listFiles` filters on
-- lifecycle state, so the archive and search surfaces that already show those
-- states keep showing them.
--
-- NO NEW MECHANISM. `file:read:all` IS the ratified tenant-wide read ground —
-- the FIRST branch of `user_readable_file_ids`, held already by nine roles. This
-- migration therefore changes no function, no policy and no schema: it grants an
-- existing permission to an existing role. Adding a COORDINATOR branch to
-- `user_readable_file_ids` would have been a second implementation of a rule that
-- already exists, and `create or replace` on that function is how migration 121
-- silently deleted four grounds.
--
-- SEE ≠ ACT. `file:read:all` is consulted in exactly fifteen places and every
-- one of them is a read: `user_readable_file_ids`' own ground, `resolveFileScope`
-- and `isFileVisible`, the list/KPI/queue/journey/SLA/department/customs/
-- docintel/transport services, the portfolio page's "see the whole tenant"
-- toggle, and one diagnostics readout. Step completion, state transitions,
-- assignment, handoff send and reception, custody and every domain mutation are
-- authorized by their own permissions — `process:step:*`, `file:transition`,
-- `file:assign`, `process:handoff:*`, `task:update`, `finance:*` — and this
-- grant touches none of them. The single non-read consumer,
-- `resolveDossierAccess`, deliberately EXCLUDES platform governance from
-- `canActOnCurrentStep`, `canCompleteAssignedTask` and `canIntervene`; only
-- `canReassignWithinDepartment` includes it, and no mutation in the repository
-- consumes that field (asserted in tests/coordinator-tenant-visibility-01).
--
-- STRICT TENANT ISOLATION IS UNAFFECTED, AND TWICE OVER. The permission is only
-- ever evaluated INSIDE `user_readable_file_ids`, whose every row is already
-- bounded by `f.tenant_id = p_tenant`; `operational_file_select` independently
-- requires `tenant_id = auth_tenant_id()`; and the admin-client readers that
-- bypass RLS re-apply `.eq("tenant_id", user.tenantId)` even when the resolved
-- scope is `all`. There is no path on which a wider read ground becomes a wider
-- TENANT.
--
-- TENANT-WIDE BY DESIGN, exactly like 20260728000003 (`file:transition`) and
-- 20260916000001 (`document:read`): the ratified rule is about the ROLE, so this
-- is keyed on `r.code` with no tenant filter. A tenant filter here would leave
-- every other provisioned tenant's Coordinator blind and make the three sources
-- disagree the moment a second tenant exists.
--
-- Mirrored in supabase/seed.sql (fresh stacks) and lib/platform/role-templates.ts
-- (provisioning), whose exact parity is asserted by tests/role-templates.test.ts.
-- ===========================================================================

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read:all'
where r.code = 'COORDINATOR'
on conflict do nothing;

-- ------------------------------------------------------- self-assertions ----
-- Apply-time only. These run once, in the transaction that performs the grant,
-- and are the place for anything that must be true AT THAT MOMENT. The companion
-- verifier asserts the durable postconditions.
do $$
declare
  v_roles int;
  v_granted int;
  v_act int;
  v_ground boolean;
begin
  -- 1. EVERY COORDINATOR role row carries it. An unqualified insert would have
  --    been silent about reaching none of them.
  select count(*) into v_roles from public.role where code = 'COORDINATOR';
  if v_roles = 0 then
    raise exception 'M147: no COORDINATOR role exists — the grant had no subject, which means the seed/provisioning source is not what this migration assumed';
  end if;

  select count(*) into v_granted
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'COORDINATOR' and p.code = 'file:read:all';

  if v_granted <> v_roles then
    raise exception 'M147: expected % COORDINATOR grant(s) of file:read:all, got %', v_roles, v_granted;
  end if;

  -- 2. THE GRANT IS READ-ONLY. A visibility fix that quietly handed the control
  --    tower mutation authority would be the opposite of what was ratified, so
  --    the ACT permissions the Coordinator must NOT gain are named explicitly.
  --    COORDINATOR legitimately holds file:transition, file:update, task:update
  --    and the handoff pair ALREADY (ratified 2026-07-28 / 9.0B); those are not
  --    listed. What is listed is what it has never held and must not acquire by
  --    way of a read fix.
  select count(*) into v_act
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'COORDINATOR'
    and p.code in ('file:create', 'file:delete', 'file:assign',
                   'finance:issue', 'finance:payment', 'finance:void',
                   'decision:approve', 'team:manage', 'admin:config:manage');
  if v_act <> 0 then
    raise exception 'M147: COORDINATOR acquired % mutation permission(s) it must not hold — SEE is not ACT', v_act;
  end if;

  -- 3. THE MECHANISM IS THE RATIFIED ONE. If the tenant-wide ground were ever
  --    removed from `user_readable_file_ids`, this grant would be inert and the
  --    Coordinator would be blind again with nothing failing. Assert the ground
  --    the grant depends on actually exists.
  select pg_get_functiondef(p.oid) like '%file:read:all%' into v_ground
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'user_readable_file_ids';
  if v_ground is not true then
    raise exception 'M147: user_readable_file_ids has no file:read:all ground — this grant would confer nothing';
  end if;

  raise notice 'M147 OK: file:read:all granted to % COORDINATOR role(s); no mutation permission added', v_granted;
end $$;
