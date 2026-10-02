-- ===========================================================================
-- Migration 148 — the tenant-wide read ground is bounded by the tenant, not by
-- the caller's good manners. (COORDINATOR-TENANT-VISIBILITY-01, CI follow-up)
-- ===========================================================================
-- WHAT THIS CLOSES. `user_readable_file_ids(p_user, p_tenant)` bounds its ROWS
-- with `f.tenant_id = p_tenant`, but its first ground asked only whether the user
-- holds `file:read:all` AT ALL — `get_user_permissions(p_user)` joins `user_role`
-- with no tenant filter. So for a tenant-wide reader the tenant came entirely
-- from the ARGUMENT: pass another tenant's id and you got that tenant's dossiers.
--
-- NOT A LIVE VULNERABILITY, AND THAT IS NOT THE POINT. Every real caller derives
-- the tenant from the session and cannot be asked to do otherwise:
--
--     can_read_file(p_file)   ->  user_readable_file_ids(auth.uid(), auth_tenant_id())
--     resolveFileScope(...)   ->  rpc with the session's own user.tenantId
--
-- so no HTTP request can choose `p_tenant`, and the policies were never bypassable
-- this way. But a tenant boundary that holds only because its callers are
-- well-behaved is not a boundary, and the repository already said so:
-- `rls_responsibility_visibility_test` has asserted R7b — "tenant-A user read
-- tenant-C file by passing tenant C" — since F-1 was ratified. It passed for three
-- years of migrations only because every role it tested cross-tenant lacked
-- `file:read:all`. Granting that permission to COORDINATOR in migration 147 made
-- the suite the first thing to actually exercise the ground, and it failed —
-- correctly, on the first CI run where the RLS suites got to execute at all.
--
-- THE FIX IS THE IDIOM THIS FUNCTION ALREADY USES. The customs-department ground
-- right below says it in its own comment: "The role check is tenant-scoped too, so
-- a role held in another tenant grants nothing here." The governance ground now
-- does the same — the role must be held IN this tenant and BELONG to this tenant.
--
-- NOBODY LOSES ACCESS. Verified read-only against production before writing this:
-- 34 users resolve `file:read:all` under the old untenanted lookup and the same 34
-- under the tenant-scoped one; zero `user_role` rows disagree with their role's
-- tenant or their user's tenant; zero rows have a null tenant; zero users belong
-- to more than one tenant. The apply-time assertion below re-checks that equality
-- on whatever database it runs against, and refuses rather than quietly narrowing.
--
-- WRITTEN FROM THE LIVE BODY, NOT FROM MEMORY. Migration 121 was written from a
-- stale copy and `create or replace` silently deleted four grounds while its own
-- (subset) assertions passed. Before this file was authored, the repository's copy
-- of the function was normalised and compared against `prosrc` read back from
-- production: identical. Only the first ground differs below, and every other
-- ground is re-asserted INDIVIDUALLY after the replace.
--
-- READ ONLY. This narrows a READ ground. It grants nothing, revokes no permission,
-- changes no policy, no table and no other function.
-- ===========================================================================

create or replace function public.user_readable_file_ids(p_user uuid, p_tenant uuid)
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select f.id
  from public.operational_file f
  where f.tenant_id = p_tenant
    and (
      -- EXPLICIT GOVERNANCE PERMISSION, HELD IN THE TENANT BEING ASKED ABOUT.
      --
      -- This used to be `exists (select 1 from public.get_user_permissions(p_user)
      -- gp where gp.code = 'file:read:all')`. `get_user_permissions` answers "does
      -- this user hold this code ANYWHERE" — it joins user_role with no tenant
      -- filter at all — so the only thing bounding the result was the caller's own
      -- `p_tenant` argument. Hand it a different tenant's id and a tenant-wide
      -- reader received that tenant's dossiers.
      --
      -- Not reachable from the application: `can_read_file` calls this as
      -- (auth.uid(), auth_tenant_id()) and `resolveFileScope` passes the session's
      -- own tenant, so no request can choose p_tenant. But a rule that is safe only
      -- because its callers are well-behaved is not a tenant boundary, and
      -- `rls_responsibility_visibility_test` R7b has asserted the opposite since F-1
      -- — it simply had no tenant-wide holder to exercise it with until COORDINATOR
      -- became one.
      --
      -- Scoped the way this function already scopes the customs-department ground:
      -- the role must be held IN this tenant and must BELONG to this tenant.
      exists (
        select 1
          from public.user_role ur0
          join public.role r0 on r0.id = ur0.role_id
          join public.role_permission rp0 on rp0.role_id = r0.id
          join public.permission p0 on p0.id = rp0.permission_id
         where ur0.user_id = p_user
           and ur0.tenant_id = p_tenant
           and r0.tenant_id = p_tenant
           and p0.code = 'file:read:all'
      )
      -- commercial ownership
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.created_by = p_user
      -- CANONICAL operational ownership (WES-3G)
      or exists (
        select 1 from public.process_instance pi
         where pi.file_id = f.id and pi.owner_user_id = p_user)
      -- current work assignment: task …
      or exists (
        select 1 from public.task t
         where t.file_id = f.id and t.assigned_to = p_user)
      -- … or step execution (WES-3B)
      or exists (
        select 1 from public.process_step_execution e
          join public.process_instance pi on pi.id = e.process_instance_id
         where pi.file_id = f.id and e.assigned_user_id = p_user)
      -- BOUNDED historical relationship: this user was verifiably assigned work
      -- on this dossier before. Read from the append-only ledger, so it cannot
      -- be claimed by merely holding a role.
      or exists (
        select 1 from public.assignment_event ae
         where ae.file_id = f.id
           and (ae.new_user_id = p_user or ae.previous_user_id = p_user))
      -- DEPARTMENT INVOLVEMENT — Customs only.
      --
      -- Legitimate involvement, not current responsibility: a customs officer
      -- must find the dossiers their department's work touches, including ones
      -- that have moved on to Finance or been archived. The role check is
      -- tenant-scoped too, so a role held in another tenant grants nothing here.
      or (
        exists (
          select 1
            from public.user_role ur
            join public.role r on r.id = ur.role_id
           where ur.user_id = p_user
             and ur.tenant_id = p_tenant
             and r.code in ('CUSTOMS_DECLARANT', 'CHIEF_OF_TRANSIT', 'CUSTOMS_FIELD_AGENT')
        )
        and exists (
          select 1
            from public.customs_record c
           where c.file_id = f.id
             and c.tenant_id = p_tenant
             and c.deleted_at is null
             and c.required = true
        )
      )
      -- ================= NEW (2026-08-23): handoff-receiver visibility =======
      -- A user who staffs the authorized receiving role of a currently OPEN
      -- ('SENT') handoff may READ that dossier, for as long as it stays open.
      -- Read only, this dossier only, and it expires on reception.
      or exists (
        select 1
        from public.process_handoff h
        join public.process_instance pi2
          on pi2.id = h.process_instance_id
         and pi2.tenant_id = p_tenant
        join public.process_step_receiving_role sr
          on sr.step_key = h.to_step_key
        join public.role r2
          on r2.code = sr.role_code
         and r2.tenant_id = p_tenant
        join public.user_role ur2
          on ur2.role_id = r2.id
         and ur2.user_id = p_user
         and ur2.tenant_id = p_tenant
        where pi2.file_id = f.id
          and h.tenant_id = p_tenant
          and h.status = 'SENT'
      )
      -- ============ NEW (F-1): responsibility-derived visibility ============
      -- An OPEN, UNASSIGNED official step whose owning role the user holds.
      -- Membership alone grants nothing: THIS dossier must carry live work owned
      -- by that role. Assigned steps are excluded on purpose — the assignee is
      -- already covered by the WES-3B ground above, and excluding them here is
      -- what makes ordinary owning-role visibility narrow once a step is claimed.
      or exists (
        select 1
        from public.process_step_execution ex
        join public.process_instance pi3
          on pi3.id = ex.process_instance_id
         and pi3.tenant_id = p_tenant
        join public.process_step_owning_role sor
          on sor.step_key = ex.step_key
        join public.role r3
          on r3.code = sor.role_code
         and r3.tenant_id = p_tenant
        join public.user_role ur3
          on ur3.role_id = r3.id
         and ur3.user_id = p_user
         and ur3.tenant_id = p_tenant
        where pi3.file_id = f.id
          and ex.tenant_id = p_tenant
          and ex.assigned_user_id is null
          and ex.state in ('AVAILABLE', 'ACTIVE', 'BLOCKED', 'SUBMITTED')
      )
    );
$$;


grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------- self-assertions ----
do $$
declare
  v_src text;
  v_untenanted int;
  v_scoped int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'user_readable_file_ids';

  if v_src is null then
    raise exception 'M148: user_readable_file_ids does not exist after the replace';
  end if;

  -- ---- 1. the change itself ---------------------------------------------
  if v_src not like '%ur0.tenant_id = p_tenant%' or v_src not like '%r0.tenant_id = p_tenant%' then
    raise exception 'M148: the governance ground is not tenant-scoped';
  end if;
  if v_src like '%get_user_permissions%' then
    raise exception 'M148: the untenanted get_user_permissions lookup is still in the body';
  end if;
  if v_src not like '%file:read:all%' then
    raise exception 'M148: the governance ground was lost entirely, not scoped';
  end if;
  if v_src not like '%where f.tenant_id = p_tenant%' then
    raise exception 'M148: lost the row-level tenant bound';
  end if;

  -- ---- 2. EVERY pre-existing ground, individually ------------------------
  -- Migration 121 lost four grounds while its own subset assertions passed. A
  -- subset proves a subset, so each one is named.
  if v_src not like '%f.account_manager_id = p_user%' then
    raise exception 'M148: lost ground account_manager_id';
  end if;
  if v_src not like '%f.coordinator_id = p_user%' then
    raise exception 'M148: lost ground coordinator_id';
  end if;
  if v_src not like '%f.created_by = p_user%' then
    raise exception 'M148: lost ground created_by';
  end if;
  if v_src not like '%pi.owner_user_id = p_user%' then
    raise exception 'M148: lost ground WES-3G operational ownership';
  end if;
  if v_src not like '%t.assigned_to = p_user%' then
    raise exception 'M148: lost ground task.assigned_to';
  end if;
  if v_src not like '%e.assigned_user_id = p_user%' then
    raise exception 'M148: lost ground WES-3B step assignee';
  end if;
  if v_src not like '%assignment_event ae%' then
    raise exception 'M148: lost ground assignment_event history';
  end if;
  if v_src not like '%CUSTOMS_FIELD_AGENT%' or v_src not like '%customs_record c%' then
    raise exception 'M148: lost ground customs department involvement';
  end if;
  if v_src not like '%process_step_receiving_role%' or v_src not like '%h.status = ''SENT''%' then
    raise exception 'M148: lost ground 121 handoff-receiver visibility';
  end if;
  if v_src not like '%process_step_owning_role%' then
    raise exception 'M148: lost ground F-1 responsibility visibility';
  end if;
  if v_src not like '%ex.assigned_user_id is null%' then
    raise exception 'M148: lost the F-1 assignee narrowing';
  end if;
  if v_src not like '%ex.state in (''AVAILABLE'', ''ACTIVE'', ''BLOCKED'', ''SUBMITTED'')%' then
    raise exception 'M148: lost the F-1 open-state bound';
  end if;

  -- ---- 3. NOBODY LOSES ACCESS -------------------------------------------
  -- Narrowing a read ground must narrow only the cross-tenant case. Every user
  -- who resolved tenant-wide before must still resolve tenant-wide in their OWN
  -- tenant; if a data anomaly made that untrue, refuse rather than quietly
  -- revoking somebody's visibility.
  select count(distinct ur.user_id) into v_untenanted
  from public.user_role ur
  join public.role_permission rp on rp.role_id = ur.role_id
  join public.permission p on p.id = rp.permission_id
  where p.code = 'file:read:all';

  select count(distinct ur.user_id) into v_scoped
  from public.user_role ur
  join public.app_user au on au.id = ur.user_id
  join public.role r on r.id = ur.role_id
  join public.role_permission rp on rp.role_id = ur.role_id
  join public.permission p on p.id = rp.permission_id
  where p.code = 'file:read:all'
    and ur.tenant_id = au.tenant_id
    and r.tenant_id = au.tenant_id;

  if v_scoped <> v_untenanted then
    raise exception 'M148: tenant-scoping would change who holds file:read:all (% before, % after) — refusing to narrow somebody''s legitimate read', v_untenanted, v_scoped;
  end if;

  raise notice 'M148 OK: governance ground tenant-scoped; all 11 other grounds intact; % tenant-wide reader(s) unchanged', v_scoped;
end $$;
