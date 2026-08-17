-- 20260904000001_hr_onboarding_evidence_provenance.sql
-- Effitrans HR Platform — HR-8 carryover: Intégration reaches evidence parity.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 113. Governing specification:
-- the D-4 finding and its resolution in docs/hr/hr-8-completion-report.md.
--
-- THIS IS THE SAME ARCHITECTURE, NOT A SECOND ONE. HR-8's D-4 established the
-- ratified evidence model for a checklist step:
--
--   presence   the step cannot be DONE with no document        (offboarding: HR809)
--   provenance the document must belong to THIS tenant, to the
--              case's OWN employee, and must not be soft-deleted (offboarding: HR816)
--   surface    a picker offering exactly those documents; the refusal
--              reaches the user as a French sentence, never a code
--
-- Intégration (HR-4, migration 76) already had the presence half — HR408 — and
-- the same provenance hole HR-8 had before migration 112: any `hr_document`
-- uuid was accepted, including ANOTHER EMPLOYEE's, another tenant's, or one
-- already soft-deleted. Its UI likewise withheld « Marquer fait » because no
-- picker existed. This migration closes the database half; the workspace
-- gains the same picker in the same commit.
--
-- The errcode stays inside HR-4's own family (HR401–HR411 are taken, HR412 is
-- next) and maps to the SAME application error and the SAME French sentence as
-- the offboarding twin — one semantic, expressed in each family's numbering.
--
-- ONE FUNCTION CHANGES. No table, no column, no permission, no policy.

create or replace function public.hr_complete_onboarding_item(
  p_tenant uuid, p_item uuid, p_actor uuid,
  p_status text, p_evidence uuid default null, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_case uuid; v_employee uuid; v_label text; v_evidence_required boolean;
begin
  if p_status not in ('DONE','NOT_APPLICABLE','PENDING') then
    raise exception 'statut d''élément invalide' using errcode = 'HR406';
  end if;
  select i.case_id, c.employee_id, i.label_fr, i.evidence_required
    into v_case, v_employee, v_label, v_evidence_required
    from public.hr_onboarding_item i
    join public.hr_onboarding_case c on c.id = i.case_id
   where i.id = p_item and i.tenant_id = p_tenant for update;
  if not found then raise exception 'élément introuvable' using errcode = 'HR407'; end if;
  if p_status = 'DONE' and v_evidence_required and p_evidence is null then
    raise exception 'preuve requise pour cet élément' using errcode = 'HR408';
  end if;
  if p_evidence is not null and not exists (
    select 1 from public.hr_document d
     where d.id = p_evidence and d.tenant_id = p_tenant
       and d.employee_id = v_employee and d.deleted_at is null) then
    raise exception 'la pièce justificative doit appartenir au dossier de cet employé'
      using errcode = 'HR412';
  end if;

  update public.hr_onboarding_item
     set status = p_status,
         evidence_document_id = coalesce(p_evidence, evidence_document_id),
         comment = coalesce(p_comment, comment),
         completed_by = case when p_status = 'PENDING' then null else p_actor end,
         completed_at = case when p_status = 'PENDING' then null else now() end
   where id = p_item;

  if p_status <> 'PENDING' then
    insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
    values (p_tenant, v_employee, 'onboarding_item_completed', p_actor,
            jsonb_build_object('case_id', v_case, 'item', v_label, 'status', p_status,
                               'evidence_document_id', p_evidence));
  end if;
  return p_item;
end $$;

revoke execute on function public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text) from public;
grant execute on function public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text) to service_role;

-- ===========================================================================
-- SELF-ASSERTIONS
-- ===========================================================================

-- 1. The provenance rule is present and the presence rule survived the replace.
do $$
declare v_src text;
begin
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_onboarding_item';
  if v_src is null then
    raise exception 'HR-4E assertion 1 failed: hr_complete_onboarding_item is missing';
  end if;
  if v_src not like '%HR412%'
     or v_src not like '%d.employee_id = v_employee%'
     or v_src not like '%d.deleted_at is null%'
     or v_src not like '%d.tenant_id = p_tenant%' then
    raise exception 'HR-4E assertion 1 failed: the evidence provenance rule is absent or weakened';
  end if;
  if v_src not like '%HR408%' or v_src not like '%HR407%' or v_src not like '%HR406%' then
    raise exception 'HR-4E assertion 1 failed: an existing rule was lost in the replacement';
  end if;
end $$;

-- 2. Both checklist families now hold the SAME rule — parity is the point.
do $$
declare v_on text; v_off text;
begin
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_on
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_onboarding_item';
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_off
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_offboarding_item';
  if v_off is null then
    raise exception 'HR-4E assertion 2 failed: the offboarding twin is missing';
  end if;
  if (v_on like '%d.employee_id = v_employee%') is distinct from
     (v_off like '%d.employee_id = v_employee%') then
    raise exception 'HR-4E assertion 2 failed: the two checklist families disagree on evidence provenance';
  end if;
end $$;
