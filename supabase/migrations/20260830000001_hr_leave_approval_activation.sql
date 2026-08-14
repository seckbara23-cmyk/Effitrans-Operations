-- 20260830000001_hr_leave_approval_activation.sql
-- Effitrans HR Platform — HR-B1: leave approval, activated with ORGANIZATIONAL
-- authority (ratified: Department Managers + Direction + CEO approve leave).
-- ---------------------------------------------------------------------------
-- ADDITIVE and idempotent. No new table, no RLS change: the RPCs are the
-- boundary (the HR-A2 rule), and this migration makes them carry the authority
-- they previously delegated entirely to the application.
--
-- TWO LANES, ONE ACT (docs/hr/hr-1a-governance-reconciliation.md §4):
--
--   1. ORG-WIDE SEATS (grant). `hr:leave:approve` → the Direction roles DGA
--      and DAF. Deliberately NOT the CEO role: production carries SIX broad
--      multi-role accounts under `CEO`, and granting org-wide leave approval
--      to all six is precisely the permission spraying the governance answer
--      warned against. Effitrans staffs Direction by assigning DGA/DAF through
--      the existing Administration screen; the CEO grant waits for the
--      explicit confirmation HR-1A already requested (question a). A
--      self-assertion below keeps CEO ungranted so widening is a DECISION,
--      never drift.
--
--   2. MANAGER LANE (identity, not permission). Inside
--      `hr_decide_leave_request`: the actor whose LINKED ACTIVE employee is
--      the requester's manager on the OPEN PRIMARY assignment may decide —
--      their organizational authority IS the authorization. The account link
--      (`employee.linked_app_user_id`) that deliberately grants nothing
--      elsewhere becomes load-bearing here BY DESIGN: it proves identity; the
--      assignment row proves authority. Cross-department approval is
--      impossible by construction — a manager simply IS NOT the
--      `manager_employee_id` of someone else's report.
--
-- Everyone else — including any linked employee who manages nobody — falls
-- through to `assert_actor_authority(…, 'hr:leave:approve', 'SERVICE')`
-- (OPS-SEC-2A / INV-7): actor integrity AND the org-wide permission, verified
-- in the database.
--
-- PRESERVED, UNTOUCHED: the SUBMITTED-only rule (HR523), the maker-checker
-- rule (HR524 — the decider is never the requester), immutability once
-- decided (HR520 trigger), single entitlement movement per decision, the
-- ledger event, service_role-only execution. ADDED: HR527 — a decider whose
-- own employee record IS the request's employee is refused on BOTH lanes
-- (self-approval via an HR-filed request was the residual hole).
--
-- `hr_cancel_leave_request` gains an explicit p_mode:
--   'ADMIN' (default) — the existing behaviour, now asserting the actor holds
--                       `hr:manage` in the DATABASE (INV-7, previously
--                       app-side only). DRAFT/SUBMITTED/APPROVED cancellable;
--                       an approved cancellation returns the entitlement.
--   'SELF'            — the employee retracts their OWN request, only while
--                       UNDECIDED (DRAFT/SUBMITTED). Cancelling approved
--                       leave remains an administrative act.
-- The old 4-argument signature is DROPPED so the pair can never diverge.

-- ===========================================================================
-- 1. Org-wide seats: DGA + DAF. Explicit p.code (the seed.sql rule). CEO is
--    deliberately absent — see the header and self-assertion 3c.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'hr:leave:approve'
where r.code in ('DGA', 'DAF')
on conflict do nothing;

-- ===========================================================================
-- 2. The decision RPC — authority moves INTO the database.
--    Body comments deliberately absent (INV-3 scans definer sources).
-- ===========================================================================
create or replace function public.hr_decide_leave_request(
  p_tenant uuid, p_request uuid, p_actor uuid, p_decision text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee uuid; v_category uuid; v_tenths int; v_status text; v_requester uuid;
  v_start date; v_end date; v_ent uuid;
  v_actor_emp uuid; v_actor_emp_active boolean := false; v_is_manager boolean := false;
begin
  if p_decision not in ('APPROVED','REFUSED') then
    raise exception 'décision invalide' using errcode = 'HR521';
  end if;
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR530';
  end if;

  select employee_id, category_id, day_tenths, status, requested_by, start_date, end_date
    into v_employee, v_category, v_tenths, v_status, v_requester, v_start, v_end
    from public.hr_leave_request
   where id = p_request and tenant_id = p_tenant for update;
  if not found then raise exception 'demande introuvable' using errcode = 'HR522'; end if;
  if v_status <> 'SUBMITTED' then
    raise exception 'seule une demande soumise peut être décidée' using errcode = 'HR523';
  end if;
  if v_requester = p_actor then
    raise exception 'séparation des tâches : le décideur doit différer du demandeur' using errcode = 'HR524';
  end if;

  select e.id, (e.status = 'ACTIVE')
    into v_actor_emp, v_actor_emp_active
    from public.employee e
   where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor
   limit 1;
  if v_actor_emp is not null and v_actor_emp = v_employee then
    raise exception 'un décideur ne décide jamais de son propre congé' using errcode = 'HR527';
  end if;
  if v_actor_emp is not null and v_actor_emp_active then
    v_is_manager := exists (
      select 1 from public.employee_assignment a
       where a.tenant_id = p_tenant and a.employee_id = v_employee
         and a.assignment_kind = 'PRIMARY' and a.effective_to is null
         and a.manager_employee_id = v_actor_emp);
  end if;
  if not v_is_manager then
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:leave:approve', 'SERVICE');
  end if;

  update public.hr_leave_request
     set status = p_decision, approved_by = p_actor, decided_at = now(), decision_note = p_note
   where id = p_request;

  if p_decision = 'APPROVED' then
    select id into v_ent from public.hr_leave_entitlement
     where tenant_id = p_tenant and employee_id = v_employee and category_id = v_category
       and v_start >= period_start and v_start <= period_end
     order by period_start desc limit 1 for update;
    if v_ent is not null then
      update public.hr_leave_entitlement
         set taken_tenths = taken_tenths + v_tenths where id = v_ent;
    end if;
  end if;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee,
          case when p_decision = 'APPROVED' then 'leave_approved' else 'leave_refused' end,
          p_actor,
          jsonb_build_object('request_id', p_request, 'start_date', v_start,
                             'end_date', v_end, 'day_tenths', v_tenths));
  return p_request;
end $$;

-- ===========================================================================
-- 3. The cancellation RPC — explicit modes; old signature dropped.
-- ===========================================================================
drop function if exists public.hr_cancel_leave_request(uuid, uuid, uuid, text);

create or replace function public.hr_cancel_leave_request(
  p_tenant uuid, p_request uuid, p_actor uuid, p_reason text, p_mode text default 'ADMIN')
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee uuid; v_category uuid; v_tenths int; v_status text; v_start date;
  v_ent uuid; v_actor_emp uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif d''annulation obligatoire' using errcode = 'HR525';
  end if;
  if p_mode not in ('ADMIN','SELF') then
    raise exception 'mode d''annulation invalide' using errcode = 'HR528';
  end if;
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR530';
  end if;

  select employee_id, category_id, day_tenths, status, start_date
    into v_employee, v_category, v_tenths, v_status, v_start
    from public.hr_leave_request
   where id = p_request and tenant_id = p_tenant for update;
  if not found then raise exception 'demande introuvable' using errcode = 'HR522'; end if;

  if p_mode = 'SELF' then
    select e.id into v_actor_emp
      from public.employee e
     where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor
     limit 1;
    if v_actor_emp is null or v_actor_emp <> v_employee then
      raise exception 'seul l''employé concerné peut retirer sa demande' using errcode = 'HR529';
    end if;
    if v_status not in ('DRAFT','SUBMITTED') then
      raise exception 'cette demande ne peut plus être annulée' using errcode = 'HR526';
    end if;
  else
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');
    if v_status not in ('DRAFT','SUBMITTED','APPROVED') then
      raise exception 'cette demande ne peut plus être annulée' using errcode = 'HR526';
    end if;
  end if;

  update public.hr_leave_request
     set status = 'CANCELLED', decision_note = p_reason where id = p_request;

  if v_status = 'APPROVED' then
    select id into v_ent from public.hr_leave_entitlement
     where tenant_id = p_tenant and employee_id = v_employee and category_id = v_category
       and v_start >= period_start and v_start <= period_end
     order by period_start desc limit 1 for update;
    if v_ent is not null then
      update public.hr_leave_entitlement
         set taken_tenths = greatest(taken_tenths - v_tenths, 0) where id = v_ent;
    end if;
  end if;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'leave_cancelled', p_actor,
          jsonb_build_object('request_id', p_request, 'reason', p_reason, 'mode', p_mode));
  return p_request;
end $$;

-- create or replace preserves nothing for the NEW 5-arg cancel; assert the
-- transport contract explicitly for both.
revoke execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) from public;
revoke execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) from anon, authenticated;
grant execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) to service_role;
revoke execute on function public.hr_cancel_leave_request(uuid,uuid,uuid,text,text) from public;
revoke execute on function public.hr_cancel_leave_request(uuid,uuid,uuid,text,text) from anon, authenticated;
grant execute on function public.hr_cancel_leave_request(uuid,uuid,uuid,text,text) to service_role;

-- ===========================================================================
-- 4. Self-assertions — the migration proves its own claims, comment-stripped
--    where prosrc is scanned (prosrc INCLUDES comments — the P1.1 lesson).
-- ===========================================================================
do $$
declare v_count int; v_src text;
begin
  -- 4a. Every DGA and DAF role holds hr:leave:approve (0 roles → vacuously true).
  select count(*) into v_count
  from public.role r
  where r.code in ('DGA','DAF')
    and not exists (
      select 1 from public.role_permission rp
      join public.permission p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'hr:leave:approve');
  if v_count <> 0 then
    raise exception 'HR-B1: % Direction role(s) missing hr:leave:approve', v_count;
  end if;

  -- 4b. HR_OFFICER does NOT hold it (requesting and deciding stay separated).
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'HR_OFFICER' and p.code = 'hr:leave:approve';
  if v_count <> 0 then
    raise exception 'HR-B1: HR_OFFICER must not hold hr:leave:approve';
  end if;

  -- 4c. THE GOVERNANCE BOUNDARY: CEO remains ungranted until Effitrans
  --     answers HR-1A question (a). Widening this is a decision, not drift.
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'CEO' and p.code = 'hr:leave:approve';
  if v_count <> 0 then
    raise exception 'HR-B1: CEO must not hold hr:leave:approve without explicit ratification';
  end if;

  -- 4d. SYSTEM_ADMIN still holds NO hr:* (DEC-B25).
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'SYSTEM_ADMIN' and p.code like 'hr:%';
  if v_count <> 0 then
    raise exception 'HR-B1: SYSTEM_ADMIN must hold no hr:* permission';
  end if;

  -- 4e. The decision RPC carries both lanes (comment-stripped source scan).
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_decide_leave_request' and p.pronargs = 5;
  if v_src is null then
    raise exception 'HR-B1: hr_decide_leave_request(5 args) must exist';
  end if;
  if v_src !~ 'assert_actor_authority' or v_src !~ 'manager_employee_id'
     or v_src !~ 'HR527' or v_src !~ 'linked_app_user_id' then
    raise exception 'HR-B1: the decision RPC must carry the manager lane, the permission lane and the self-guard';
  end if;

  -- 4f. The old 4-argument cancel signature is gone; the 5-argument one has
  --     both modes and its own authority assertion.
  select count(*) into v_count from pg_proc
  where proname = 'hr_cancel_leave_request' and pronargs = 4;
  if v_count <> 0 then
    raise exception 'HR-B1: the 4-argument cancel signature must be dropped';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_cancel_leave_request' and p.pronargs = 5;
  if v_src is null or v_src !~ 'SELF' or v_src !~ 'assert_actor_authority' or v_src !~ 'HR529' then
    raise exception 'HR-B1: the cancel RPC must carry the SELF mode and the ADMIN authority assertion';
  end if;

  -- 4g. Transport contract: neither RPC is executable by anon or authenticated.
  if has_function_privilege('anon', 'public.hr_decide_leave_request(uuid,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_decide_leave_request(uuid,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.hr_cancel_leave_request(uuid,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_cancel_leave_request(uuid,uuid,uuid,text,text)', 'execute') then
    raise exception 'HR-B1: leave RPCs must be service_role transport only';
  end if;
end $$;
