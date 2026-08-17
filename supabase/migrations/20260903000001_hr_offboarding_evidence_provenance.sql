-- 20260903000001_hr_offboarding_evidence_provenance.sql
-- Effitrans HR Platform — HR-8C finding D-4: QUALIFYING evidence, not just any.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 112. Governing specification:
-- docs/hr/hr-8-offboarding-audit.md + the HR-8 completion report (finding D-4).
--
-- WHAT THE AUDIT FOUND. Migration 111 rejects a MISSING evidence document
-- server-side (HR809) — presence was already a database rule, never a UI
-- courtesy. What it did NOT check is whether the document offered as evidence
-- has anything to do with the case: any `hr_document` uuid was accepted,
-- including one belonging to ANOTHER EMPLOYEE, one from another tenant, or one
-- already soft-deleted. The application layer only ever offers the right
-- documents, but the boundary is the database — so the check belongs here.
--
-- THIS MIGRATION CHANGES ONE FUNCTION AND NOTHING ELSE. No table, no column,
-- no permission, no policy. hr_complete_offboarding_item keeps every existing
-- rule (HR630 actor integrity, INV-7 authority, HR807 status vocabulary,
-- HR808 item, HR810 closed case, HR809 evidence required) and gains one:
--
--   HR816 — the evidence document must belong to THIS tenant, to the case's
--           OWN employee, and must not be soft-deleted.
--
-- Checked whenever p_evidence is supplied, whatever the target status: an
-- item never carries a document that was not the departing person's.

create or replace function public.hr_complete_offboarding_item(
  p_tenant uuid, p_item uuid, p_actor uuid,
  p_status text, p_evidence uuid default null, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_case uuid; v_case_status text; v_employee uuid; v_label text; v_evidence_required boolean;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  if p_status not in ('DONE','NOT_APPLICABLE','PENDING') then
    raise exception 'statut d''élément invalide' using errcode = 'HR807';
  end if;
  select i.case_id, c.status, c.employee_id, i.label_fr, i.evidence_required
    into v_case, v_case_status, v_employee, v_label, v_evidence_required
    from public.hr_offboarding_item i
    join public.hr_offboarding_case c on c.id = i.case_id
   where i.id = p_item and i.tenant_id = p_tenant for update of i, c;
  if not found then
    raise exception 'élément introuvable' using errcode = 'HR808';
  end if;
  if v_case_status not in ('OPEN','IN_PROGRESS') then
    raise exception 'ce dossier de départ n''est plus modifiable' using errcode = 'HR810';
  end if;
  if p_status = 'DONE' and v_evidence_required and p_evidence is null then
    raise exception 'preuve requise pour cet élément' using errcode = 'HR809';
  end if;
  if p_evidence is not null and not exists (
    select 1 from public.hr_document d
     where d.id = p_evidence and d.tenant_id = p_tenant
       and d.employee_id = v_employee and d.deleted_at is null) then
    raise exception 'la pièce justificative doit appartenir au dossier de cet employé'
      using errcode = 'HR816';
  end if;

  update public.hr_offboarding_item
     set status = p_status,
         evidence_document_id = coalesce(p_evidence, evidence_document_id),
         comment = coalesce(p_comment, comment),
         completed_by = case when p_status = 'PENDING' then null else p_actor end,
         completed_at = case when p_status = 'PENDING' then null else now() end
   where id = p_item;

  if v_case_status = 'OPEN' then
    update public.hr_offboarding_case set status = 'IN_PROGRESS'
     where id = v_case and status = 'OPEN';
  end if;

  if p_status <> 'PENDING' then
    insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
    values (p_tenant, v_employee, 'offboarding_item_completed', p_actor,
            jsonb_build_object('case_id', v_case, 'item', v_label, 'status', p_status,
                               'evidence_document_id', p_evidence));
  end if;
  return p_item;
end $$;

revoke execute on function public.hr_complete_offboarding_item(uuid,uuid,uuid,text,uuid,text) from public;
grant execute on function public.hr_complete_offboarding_item(uuid,uuid,uuid,text,uuid,text) to service_role;

-- ===========================================================================
-- SELF-ASSERTIONS — the migration refuses to report success if the rules it
-- claims are not the rules the database now holds.
-- ===========================================================================

-- 1. The new provenance rule is present, AND every rule it was added beside
--    survived the replacement (a CREATE OR REPLACE that silently drops a check
--    is the failure mode this guards).
do $$
declare v_src text;
begin
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_offboarding_item';
  if v_src is null then
    raise exception 'HR-8D assertion 1 failed: hr_complete_offboarding_item is missing';
  end if;
  if v_src not like '%HR816%'
     or v_src not like '%d.employee_id = v_employee%'
     or v_src not like '%d.deleted_at is null%'
     or v_src not like '%d.tenant_id = p_tenant%' then
    raise exception 'HR-8D assertion 1 failed: the evidence provenance rule is absent or weakened';
  end if;
  if v_src not like '%HR630%' or v_src not like '%assert_actor_authority%'
     or v_src not like '%HR809%' or v_src not like '%HR810%' then
    raise exception 'HR-8D assertion 1 failed: an existing rule was lost in the replacement';
  end if;
end $$;

-- 2. The completion gate itself is untouched by this migration.
do $$
declare v_src text;
begin
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_complete_offboarding';
  if v_src is null
     or v_src not like '%TERMINATED%'
     or v_src not like '%returned_on is null%'
     or v_src not like '%is_blocking%' then
    raise exception 'HR-8D assertion 2 failed: the closure gate changed — it must not';
  end if;
end $$;
