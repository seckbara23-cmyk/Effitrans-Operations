-- 20260906000001_commercial_owner_assignment.sql
-- Effitrans Operations Platform — TMS-1: the Account-Manager assignment authority.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 115. Governing specification:
-- docs/tms/tms-1-assignment-contract.md (ratified: TMS-Q1, TMS-1-D1 = Option A,
-- D2 self-assignment via the same path, D3 honest LEGACY_IMPORT backfill).
--
-- THE DEFECT THIS CLOSES: createFile silently crowned the dossier CREATOR as
-- Account Manager, and no code path ever wrote account_manager_id again —
-- while registry step 2 (account_manager_assigned) makes the Operations
-- Manager the assignment authority, with evidence. The creator and the
-- Account Manager are separate concepts even when they happen to be the same
-- person.
--
-- WHAT THIS MIGRATION ADDS — and deliberately nothing else:
--   1. ONE permission: file:assign:commercial, granted to OPS_SUPERVISOR and
--      SYSTEM_ADMIN only. file:assign (the working-assignee lane the Account
--      Managers legitimately use) is NOT touched.
--   2. ONE definer RPC: assign_commercial_owner — mirroring WES-3A's
--      assign_operational_owner (FOR UPDATE, active-member target, owner never
--      vacated, owner-unchanged refusal, same-transaction assignment_event,
--      business event), PLUS the INV-7 authority assertion the older WES-3A
--      RPCs predate, PLUS the two rules TMS-Q1 ratified: reassignment demands
--      a non-blank reason, and a terminal dossier (CLOSED/CANCELLED) refuses.
--   3. HONEST history for the existing dossiers: one LEGACY_IMPORT INITIAL row
--      per dossier that already carries an auto-set Account Manager. No actor
--      is fabricated, no date is back-dated, no ownership is rewritten.
--
-- No new table, no new column, no RLS change. assignment_event already
-- reserves subject_type COMMERCIAL_OWNER and already forbids owner
-- unassignment by CHECK; can_read_file already treats account_manager_id as a
-- visibility source. Errcodes: HR630 (platform actor-integrity convention) +
-- TM101..TM106, mapped in lib/files/actions.ts.

-- ===========================================================================
-- 1. THE PERMISSION — the ratified Option A.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('file:assign:commercial', 'files', 'assign_commercial', 'all',
   'Désigner ou remplacer le Responsable client (Account Manager) d''un dossier — autorité du Responsable des opérations')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:assign:commercial'
where r.code in ('OPS_SUPERVISOR', 'SYSTEM_ADMIN')
on conflict do nothing;

-- ===========================================================================
-- 2. THE RPC — service_role transport only.
--    Body comments deliberately absent (INV-3 scans definer sources).
-- ===========================================================================
create or replace function public.assign_commercial_owner(
  p_file        uuid,
  p_new_user_id uuid,
  p_actor       uuid,
  p_reason_code text,
  p_reason      text default null,
  p_policy_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_previous uuid;
  v_status   text;
  v_active   text;
  v_history  uuid;
begin
  if p_new_user_id is null then
    raise exception 'le Responsable client ne peut pas être retiré sans remplaçant' using errcode = 'TM102';
  end if;

  select tenant_id, account_manager_id, status
    into v_tenant, v_previous, v_status
    from public.operational_file where id = p_file for update;
  if not found then
    raise exception 'dossier introuvable' using errcode = 'TM101';
  end if;

  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = v_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, v_tenant, 'file:assign:commercial', 'SERVICE');

  if v_status in ('CLOSED', 'CANCELLED') then
    raise exception 'le dossier est clôturé ou annulé : le Responsable client ne peut plus changer'
      using errcode = 'TM105';
  end if;

  if v_previous is not distinct from p_new_user_id then
    raise exception 'ce Responsable client est déjà désigné' using errcode = 'TM103';
  end if;

  if p_reason_code is null
     or p_reason_code not in ('INITIAL', 'REASSIGNMENT', 'SUPERVISOR_INTERVENTION',
                              'WORKLOAD_BALANCING', 'ABSENCE', 'ESCALATION',
                              'CORRECTION', 'GOVERNANCE') then
    raise exception 'motif de désignation invalide' using errcode = 'TM106';
  end if;
  if v_previous is not null and p_reason_code = 'INITIAL' then
    raise exception 'un remplacement ne peut pas être motivé « INITIAL »' using errcode = 'TM106';
  end if;
  if v_previous is not null and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'un remplacement exige un motif détaillé' using errcode = 'TM106';
  end if;

  select status into v_active from public.app_user
   where id = p_new_user_id and tenant_id = v_tenant;
  if not found then
    raise exception 'le Responsable client désigné n''appartient pas à cette organisation'
      using errcode = 'TM104';
  end if;
  if v_active <> 'active' then
    raise exception 'le Responsable client désigné n''est pas un compte actif' using errcode = 'TM104';
  end if;

  update public.operational_file
     set account_manager_id = p_new_user_id
   where id = p_file;

  insert into public.assignment_event (
    tenant_id, file_id, subject_type, subject_id,
    previous_user_id, new_user_id, actor_user_id,
    reason, reason_code, policy_version_id)
  values (
    v_tenant, p_file, 'COMMERCIAL_OWNER', p_file,
    v_previous, p_new_user_id, p_actor,
    nullif(btrim(coalesce(p_reason, '')), ''), p_reason_code, p_policy_id)
  returning id into v_history;

  perform public.emit_business_event(
    v_tenant,
    case when v_previous is null then 'COMMERCIAL_OWNER_ASSIGNED'
         else 'COMMERCIAL_OWNER_REASSIGNED' end,
    'dossier', 'assignment_rpc', 'operational_file', p_file, p_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'reason_code', p_reason_code,
      'assignment_event_id', v_history::text)));

  return jsonb_build_object(
    'file_id', p_file,
    'previous_user_id', v_previous, 'new_user_id', p_new_user_id,
    'assignment_event_id', v_history);
end; $$;

revoke execute on function public.assign_commercial_owner(uuid, uuid, uuid, text, text, uuid) from public;
grant execute on function public.assign_commercial_owner(uuid, uuid, uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- 3. HONEST HISTORY for the pre-TMS-1 dossiers (D3). LEGACY_IMPORT is the
--    table's own idiom for « derived from a pre-existing column rather than
--    observed »: no actor fabricated, created_at = the backfill moment,
--    ownership untouched. Idempotent by construction.
-- ===========================================================================
insert into public.assignment_event (
  tenant_id, file_id, subject_type, subject_id,
  previous_user_id, new_user_id, actor_user_id,
  reason, reason_code, provenance)
select
  f.tenant_id, f.id, 'COMMERCIAL_OWNER', f.id,
  null, f.account_manager_id, null,
  'Reprise : Responsable client hérité du créateur du dossier (avant TMS-1).',
  'INITIAL', 'LEGACY_IMPORT'
from public.operational_file f
where f.account_manager_id is not null
  and not exists (
    select 1 from public.assignment_event e
     where e.subject_type = 'COMMERCIAL_OWNER' and e.subject_id = f.id);

-- ===========================================================================
-- 4. SELF-ASSERTIONS — refuse to report success if the ratified decisions are
--    not what the database now holds.
-- ===========================================================================

-- 4a. The permission exists exactly once, and file:assign is untouched.
do $$
begin
  if (select count(*) from public.permission where code = 'file:assign:commercial') <> 1 then
    raise exception 'TMS-1 assertion 4a failed: file:assign:commercial not catalogued exactly once';
  end if;
  if (select count(*) from public.permission where code = 'file:assign') <> 1 then
    raise exception 'TMS-1 assertion 4a failed: file:assign was disturbed — it must remain';
  end if;
end $$;

-- 4b. Exactly the two ratified seats hold it — nobody else (Option A).
do $$
declare v_extra text; v_missing int;
begin
  select string_agg(distinct r.code, ', ') into v_extra
    from public.role_permission rp
    join public.permission p on p.id = rp.permission_id and p.code = 'file:assign:commercial'
    join public.role r on r.id = rp.role_id
   where r.code not in ('OPS_SUPERVISOR', 'SYSTEM_ADMIN');
  if v_extra is not null then
    raise exception 'TMS-1 assertion 4b failed: file:assign:commercial held by unratified role(s): %', v_extra;
  end if;
  select count(*) into v_missing
    from public.role r
   where r.code in ('OPS_SUPERVISOR', 'SYSTEM_ADMIN')
     and not exists (
       select 1 from public.role_permission rp
       join public.permission p on p.id = rp.permission_id and p.code = 'file:assign:commercial'
        where rp.role_id = r.id);
  if v_missing > 0 then
    raise exception 'TMS-1 assertion 4b failed: % ratified seat(s) missing the grant', v_missing;
  end if;
end $$;

-- 4c. The RPC holds every ratified rule (comment-stripped source).
do $$
declare v_src text;
begin
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assign_commercial_owner';
  if v_src is null then
    raise exception 'TMS-1 assertion 4c failed: assign_commercial_owner is missing';
  end if;
  if v_src not like '%assert_actor_authority%'
     or v_src not like '%file:assign:commercial%' then
    raise exception 'TMS-1 assertion 4c failed: the INV-7 authority assertion is absent';
  end if;
  if v_src not like '%''CLOSED'', ''CANCELLED''%' then
    raise exception 'TMS-1 assertion 4c failed: the terminal-dossier refusal is absent';
  end if;
  if v_src not like '%un remplacement exige un motif détaillé%' then
    raise exception 'TMS-1 assertion 4c failed: the reassignment-reason requirement is absent';
  end if;
  if v_src not like '%COMMERCIAL_OWNER%' or v_src not like '%assignment_event%' then
    raise exception 'TMS-1 assertion 4c failed: the same-transaction history write is absent';
  end if;
end $$;

-- 4d. Every dossier that has an Account Manager has a history row, and every
--     backfilled row is honestly marked.
do $$
declare v_uncovered int; v_dishonest int;
begin
  select count(*) into v_uncovered
    from public.operational_file f
   where f.account_manager_id is not null
     and not exists (
       select 1 from public.assignment_event e
        where e.subject_type = 'COMMERCIAL_OWNER' and e.subject_id = f.id);
  if v_uncovered > 0 then
    raise exception 'TMS-1 assertion 4d failed: % dossier(s) with an AM lack history', v_uncovered;
  end if;
  select count(*) into v_dishonest
    from public.assignment_event
   where subject_type = 'COMMERCIAL_OWNER'
     and provenance = 'LEGACY_IMPORT'
     and actor_user_id is not null;
  if v_dishonest > 0 then
    raise exception 'TMS-1 assertion 4d failed: % LEGACY_IMPORT row(s) fabricate an actor', v_dishonest;
  end if;
end $$;
