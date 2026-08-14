-- ===========================================================================
-- MAYA-P1.11 — rattachement (CEO step 9): database behaviour.
-- ---------------------------------------------------------------------------
-- What the pure tests cannot prove: that the DATABASE refuses an unauthorised
-- actor, refuses an unknown system, and records the act without touching any
-- neighbouring customs fact. Runs inside BEGIN/ROLLBACK — nothing persists.
--
-- ⚠ Events written in one transaction all share `occurred_at` (it defaults to
-- now() = TRANSACTION START), so this suite selects by a discriminating
-- metadata field, never by ordering. That defect cost CI #450.
-- ===========================================================================
begin;

-- ---- fixtures -------------------------------------------------------------
insert into public.organization (id, name, slug, status)
values ('00000000-0000-0000-0000-0000000c1100', 'P111 Tenant', 'p111-tenant', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, name)
values ('00000000-0000-0000-0000-0000000c1110', '00000000-0000-0000-0000-0000000c1100', 'DECLARANT_P111', 'Déclarant'),
       ('00000000-0000-0000-0000-0000000c1111', '00000000-0000-0000-0000-0000000c1100', 'OUTSIDER_P111', 'Sans droit')
on conflict (id) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000c1110', p.id from public.permission p where p.code = 'customs:update'
on conflict do nothing;

insert into public.app_user (id, tenant_id, email, full_name, status)
values ('00000000-0000-0000-0000-0000000c1001', '00000000-0000-0000-0000-0000000c1100', 'declarant.p111@example.test', 'Déclarant', 'active'),
       ('00000000-0000-0000-0000-0000000c1002', '00000000-0000-0000-0000-0000000c1100', 'outsider.p111@example.test', 'Sans droit', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id)
values ('00000000-0000-0000-0000-0000000c1001', '00000000-0000-0000-0000-0000000c1110'),
       ('00000000-0000-0000-0000-0000000c1002', '00000000-0000-0000-0000-0000000c1111')
on conflict do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, status)
values ('00000000-0000-0000-0000-0000000c11f1', '00000000-0000-0000-0000-0000000c1100', 'P111-0001', 'IMP', 'IN_PROGRESS')
on conflict (id) do nothing;

insert into public.customs_record (id, tenant_id, file_id, status, required, declaration_number, external_ref)
values ('00000000-0000-0000-0000-0000000c11e1', '00000000-0000-0000-0000-0000000c1100',
        '00000000-0000-0000-0000-0000000c11f1', 'DECLARED', true, 'DEC-P111', 'GND-P111')
on conflict (id) do nothing;

-- ---- 1. AUTHORITY ---------------------------------------------------------
do $$
begin
  -- An actor WITHOUT customs:update is refused by the database (INV-7).
  begin
    perform public.record_customs_attachment(
      '00000000-0000-0000-0000-0000000c11e1', array['GAINDE'], '00000000-0000-0000-0000-0000000c1002');
    raise exception 'P1.11: an actor without customs:update must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;

  -- A non-existent actor is refused.
  begin
    perform public.record_customs_attachment(
      '00000000-0000-0000-0000-0000000c11e1', array['GAINDE'], '00000000-0000-0000-0000-0000dead1111');
    raise exception 'P1.11: an unknown actor must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;

  -- A null actor is refused.
  begin
    perform public.record_customs_attachment(
      '00000000-0000-0000-0000-0000000c11e1', array['GAINDE'], null);
    raise exception 'P1.11: a null actor must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;
end $$;

-- ---- 2. SYSTEM VALIDATION -------------------------------------------------
do $$
begin
  -- An unknown customs system is refused: only GAINDE and ORBUS were ratified.
  begin
    perform public.record_customs_attachment(
      '00000000-0000-0000-0000-0000000c11e1', array['SYDONIA'], '00000000-0000-0000-0000-0000000c1001');
    raise exception 'P1.11: an unknown system must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;

  -- An empty set is refused: an act performed nowhere is not an act.
  begin
    perform public.record_customs_attachment(
      '00000000-0000-0000-0000-0000000c11e1', array[]::text[], '00000000-0000-0000-0000-0000000c1001');
    raise exception 'P1.11: an empty system list must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;
end $$;

-- ---- 3. THE ACT, AND ONLY THE ACT ----------------------------------------
do $$
declare r record; n int;
begin
  perform public.record_customs_attachment(
    '00000000-0000-0000-0000-0000000c11e1', array['gainde', ' orbus '], '00000000-0000-0000-0000-0000000c1001');

  select * into r from public.customs_record where id = '00000000-0000-0000-0000-0000000c11e1';

  if r.attachment_completed_at is null or r.attachment_completed_by is null then
    raise exception 'P1.11: the attachment instant and its author must both be recorded';
  end if;
  if r.attachment_completed_by <> '00000000-0000-0000-0000-0000000c1001' then
    raise exception 'P1.11: the recorded actor must be the caller';
  end if;
  -- Normalised: trimmed, upper-cased, sorted, de-duplicated.
  if r.attachment_systems <> array['GAINDE', 'ORBUS'] then
    raise exception 'P1.11: systems must be normalised, got %', r.attachment_systems;
  end if;

  -- NOTHING ELSE MOVED. Each of these is a different customs act.
  if r.status <> 'DECLARED' then raise exception 'P1.11: the customs status must not move'; end if;
  if r.declaration_number <> 'DEC-P111' then raise exception 'P1.11: the declaration must not change'; end if;
  if r.external_ref <> 'GND-P111' then raise exception 'P1.11: the GAINDE reference must not change'; end if;
  if r.gainde_registered_at is not null then raise exception 'P1.11: Finance registration must not be fabricated'; end if;
  if r.reviewed_at is not null then raise exception 'P1.11: Chef Transit validation must not be fabricated'; end if;
  if r.receivability_status is not null then raise exception 'P1.11: recevabilité must not be decided'; end if;
  if r.bae_reference is not null or r.release_date is not null then
    raise exception 'P1.11: the BAE / release must not be fabricated';
  end if;
  if r.provider_synced_at is not null then
    raise exception 'P1.11: no synchronisation happened and none may be claimed';
  end if;

  -- The first attempt is NOT flagged as a repeat.
  select count(*) into n from public.business_event
   where subject_id = '00000000-0000-0000-0000-0000000c11e1'
     and event_type = 'CUSTOMS_ATTACHMENT_RECORDED'
     and metadata->>'repeated' = 'false';
  if n <> 1 then raise exception 'P1.11: the first attachment must be recorded once, unflagged (got %)', n; end if;
end $$;

-- ---- 4. THE RATIFIED RETRY ------------------------------------------------
do $$
declare n int; r record;
begin
  -- « En cas d'échec … le déclarant rattache de nouveau. » The SAME systems, so
  -- an identical-repeat refusal would block the exact retry the business
  -- describes. It must succeed, and it must be marked as a repeat.
  perform public.record_customs_attachment(
    '00000000-0000-0000-0000-0000000c11e1', array['GAINDE', 'ORBUS'], '00000000-0000-0000-0000-0000000c1001');

  select count(*) into n from public.business_event
   where subject_id = '00000000-0000-0000-0000-0000000c11e1'
     and event_type = 'CUSTOMS_ATTACHMENT_RECORDED'
     and metadata->>'repeated' = 'true';
  if n <> 1 then raise exception 'P1.11: the retry must be recorded and flagged as a repeat (got %)', n; end if;

  -- HISTORY IS PRESERVED: both attempts are in the ledger.
  select count(*) into n from public.business_event
   where subject_id = '00000000-0000-0000-0000-0000000c11e1'
     and event_type = 'CUSTOMS_ATTACHMENT_RECORDED';
  if n <> 2 then raise exception 'P1.11: every attempt must survive in the ledger (got %)', n; end if;

  select * into r from public.customs_record where id = '00000000-0000-0000-0000-0000000c11e1';
  if r.attachment_completed_at is null then raise exception 'P1.11: the retry must leave the act recorded'; end if;
end $$;

-- ---- 5. CONSTRAINTS -------------------------------------------------------
do $$
begin
  -- An instant always has an author.
  begin
    update public.customs_record set attachment_completed_by = null
     where id = '00000000-0000-0000-0000-0000000c11e1';
    raise exception 'P1.11: an attachment instant without an author must be refused';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;

  -- Only the two ratified systems.
  begin
    update public.customs_record set attachment_systems = array['SYDONIA']
     where id = '00000000-0000-0000-0000-0000000c11e1';
    raise exception 'P1.11: an unknown system must be refused by the constraint';
  exception when others then
    if sqlerrm like 'P1.11:%' then raise; end if;
  end;
end $$;

-- ---- 6. PRIVILEGE (OPS-SEC-1) --------------------------------------------
do $$
declare v_sig text := 'public.record_customs_attachment(uuid,text[],uuid)';
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE') then
    raise exception 'P1.11: anon must not execute the attachment RPC';
  end if;
  if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception 'P1.11: authenticated must not execute the attachment RPC';
  end if;
  if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
    raise exception 'P1.11: service_role must execute the attachment RPC';
  end if;
end $$;

rollback;
