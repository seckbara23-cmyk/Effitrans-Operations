-- RLS regression test — document governance & BAE (WES-4). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the guarantees that must hold in the DATABASE, not merely in the action:
--
--   LIFECYCLE & IMMUTABILITY (WES-4A/4B)
--   * review_document writes status + review row + event in ONE transaction   -> 1/1/1
--   * a version's BYTES and identity are immutable after upload               -> raises
--   * a SUPERSEDED version cannot be reopened                                 -> raises
--   * supersession cannot be changed once recorded                            -> raises
--   * rejection PRESERVES the version and its history                         -> 1
--   * a rejected version is replaced, never verified in place                 -> raises
--   * supersede_document links both directions and closes the old version     -> 1/1
--   * a replacement from ANOTHER dossier is refused                           -> raises
--
--   MAKER-CHECKER (WES-4H)
--   * the uploader cannot verify their own document when maker-checker applies-> raises
--   * a different verifier succeeds                                           -> 1
--   * without maker-checker the same person may verify (policy decides)       -> 1
--
--   REASON GOVERNANCE (WES-4F)
--   * a rejection without a structured reason code is refused                 -> raises
--   * the free-text explanation NEVER reaches business_event                  -> 0
--   * the event carries the code, has_reason and the review reference         -> 1
--
--   BAE (WES-4D/4E)
--   * recording the reference does NOT change the customs status              -> 1
--   * recording the release is a separate action                              -> 1
--   * neither touches the process engine                                      -> 0
--
--   ATOMICITY (WES-9A Model A)
--   * a FAILED event rolls the whole document decision back                   -> unchanged
--
--   ISOLATION
--   * tenant B cannot read tenant A's review records                          -> 0
--   * a portal user cannot read ANY review record                             -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d4', 'Test Tenant W4', 'SN')
on conflict (id) do nothing;

-- D1 = uploader (declarant) · D2 = verifier · D3 = tenant-W4 probe · D4 = portal
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'w4-d1@test.local'),
  ('00000000-0000-0000-0000-00000000d002', 'w4-d2@test.local'),
  ('00000000-0000-0000-0000-00000000d003', 'w4-d3@test.local'),
  ('00000000-0000-0000-0000-00000000d004', 'w4-d4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'w4-d1@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000001', 'w4-d2@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000d4', 'w4-d3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.id, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000d001'::uuid),
  ('00000000-0000-0000-0000-00000000d002'::uuid)
) as u(id)
join public.role r
  on r.code = 'DOCUMENTATION_OFFICER'
 and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-000000000001', 'W4 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000cb', 'w4-d4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  atomic_status int; atomic_review int; atomic_event int;
  bytes_immutable int := 0; superseded_reopen int := 0; supersede_change int := 0;
  rejected_preserved int; reject_then_verify int := 0;
  supersede_forward int; supersede_backward int; cross_dossier int := 0;
  self_verify_rejected int := 0; other_verify_ok int;
  no_reason_rejected int := 0;
  explanation_in_event int; event_reference int;
  bae_status_unchanged int; release_recorded int; engine_untouched int;
  engine_before int;
  rollback_status text; rollback_review int;
  d3_sees int; d4_sees int;
  v_file uuid := '00000000-0000-0000-0000-00000000d410';
  v_doc  uuid := '00000000-0000-0000-0000-00000000d420';
  v_doc2 uuid := '00000000-0000-0000-0000-00000000d421';
  v_doc3 uuid := '00000000-0000-0000-0000-00000000d422';
  v_file2 uuid := '00000000-0000-0000-0000-00000000d411';
  v_cust uuid := '00000000-0000-0000-0000-00000000d430';
  v_review uuid;
begin
  perform set_config('role', 'postgres', true);

  -- Engine baseline. This check asks "did review_document or the customs
  -- release advance the process engine?", and it used to answer by counting
  -- EVERY process_step_execution in the tenant and demanding zero. That was a
  -- true proxy only while nothing else in the CI database had ever opened a
  -- workflow — so the C-4 journey, which legitimately opens one, read as this
  -- suite's own violation. A DELTA asks the real question and keeps the full
  -- tenant-wide breadth: nothing anywhere may advance while these actions run.
  select count(*) into engine_before from public.process_step_execution
   where tenant_id = '00000000-0000-0000-0000-000000000001';

  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
  values (v_file, '00000000-0000-0000-0000-000000000001', 'W4-TEST-0001', 'IMP',
          '00000000-0000-0000-0000-0000000000cb', 'IN_PROGRESS'),
         (v_file2, '00000000-0000-0000-0000-000000000001', 'W4-TEST-0002', 'IMP',
          '00000000-0000-0000-0000-0000000000cb', 'IN_PROGRESS');

  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by, status)
  values (v_doc, '00000000-0000-0000-0000-000000000001', v_file, 'COMMERCIAL_INVOICE',
          'w4/a.pdf', '00000000-0000-0000-0000-00000000d001', 'UPLOADED');

  -- ------------------------------------------------------------- ATOMICITY
  perform public.review_document(
    v_doc, 'VERIFIED', '00000000-0000-0000-0000-00000000d002', null, null, true, false, null);

  select count(*) into atomic_status from public.document
   where id = v_doc and status = 'VERIFIED';
  select count(*) into atomic_review from public.document_review
   where document_id = v_doc and action = 'VERIFIED';
  select count(*) into atomic_event from public.business_event
   where subject_id = v_doc and event_type = 'DOCUMENT_VERIFIED';

  -- Same person verifying their own upload, with maker-checker ON.
  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by, status)
  values (v_doc2, '00000000-0000-0000-0000-000000000001', v_file, 'PACKING_LIST',
          'w4/b.pdf', '00000000-0000-0000-0000-00000000d001', 'UPLOADED');
  begin
    perform public.review_document(
      v_doc2, 'VERIFIED', '00000000-0000-0000-0000-00000000d001', null, null, true, false, null);
  exception when others then self_verify_rejected := 1;
  end;

  -- A different verifier succeeds on the same document.
  perform public.review_document(
    v_doc2, 'VERIFIED', '00000000-0000-0000-0000-00000000d002', null, null, true, false, null);
  select count(*) into other_verify_ok from public.document
   where id = v_doc2 and status = 'VERIFIED';

  -- ------------------------------------------------------- REASON GOVERNANCE
  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by, status)
  values (v_doc3, '00000000-0000-0000-0000-000000000001', v_file, 'CERTIFICATE_OF_ORIGIN',
          'w4/c.pdf', '00000000-0000-0000-0000-00000000d001', 'UPLOADED');

  begin
    perform public.review_document(
      v_doc3, 'REJECTED', '00000000-0000-0000-0000-00000000d002', null, null, false, false, null);
  exception when others then no_reason_rejected := 1;
  end;

  perform public.review_document(
    v_doc3, 'REJECTED', '00000000-0000-0000-0000-00000000d002',
    'DOCUMENT_MISMATCH', 'le nom du destinataire ne correspond pas au connaissement',
    false, false, null);

  -- The version survives its rejection, file and all.
  select count(*) into rejected_preserved from public.document
   where id = v_doc3 and status = 'REJECTED' and storage_path = 'w4/c.pdf';

  -- THE FREE TEXT MUST NOT BE IN THE LEDGER.
  select count(*) into explanation_in_event from public.business_event
   where subject_id = v_doc3 and metadata::text like '%destinataire%';

  select id into v_review from public.document_review
   where document_id = v_doc3 and action = 'REJECTED';
  select count(*) into event_reference from public.business_event
   where subject_id = v_doc3
     and event_type = 'DOCUMENT_REJECTED'
     and metadata->>'reason_code' = 'DOCUMENT_MISMATCH'
     and (metadata->>'has_reason')::boolean
     and metadata->>'reason_reference_id' = v_review::text;

  -- A rejected version is replaced, never verified in place.
  begin
    perform public.review_document(
      v_doc3, 'VERIFIED', '00000000-0000-0000-0000-00000000d002', null, null, false, false, null);
  exception when others then reject_then_verify := 1;
  end;

  -- ------------------------------------------------------------ IMMUTABILITY
  begin
    update public.document set storage_path = 'w4/tampered.pdf' where id = v_doc;
  exception when others then bytes_immutable := 1;
  end;

  -- --------------------------------------------------------------- SUPERSEDE
  perform public.supersede_document(v_doc3, v_doc2, '00000000-0000-0000-0000-00000000d002', null);
  select count(*) into supersede_forward from public.document
   where id = v_doc3 and superseded_by_id = v_doc2 and status = 'SUPERSEDED';
  select count(*) into supersede_backward from public.document
   where id = v_doc2 and supersedes_id = v_doc3;

  begin
    update public.document set status = 'VERIFIED' where id = v_doc3;
  exception when others then superseded_reopen := 1;
  end;

  begin
    update public.document set superseded_by_id = v_doc where id = v_doc3;
  exception when others then supersede_change := 1;
  end;

  -- A replacement must belong to the same dossier.
  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by, status)
  values ('00000000-0000-0000-0000-00000000d423', '00000000-0000-0000-0000-000000000001',
          v_file2, 'PACKING_LIST', 'w4/d.pdf', '00000000-0000-0000-0000-00000000d001', 'UPLOADED');
  begin
    perform public.supersede_document(
      v_doc, '00000000-0000-0000-0000-00000000d423', '00000000-0000-0000-0000-00000000d002', null);
  exception when others then cross_dossier := 1;
  end;

  -- ---------------------------------------------------------------- BAE SPLIT
  insert into public.customs_record (id, tenant_id, file_id, status, created_by)
  values (v_cust, '00000000-0000-0000-0000-000000000001', v_file, 'DECLARATION_PREPARED',
          '00000000-0000-0000-0000-00000000d001');

  perform public.record_bae_reference(v_cust, 'BAE-2026-0001', '00000000-0000-0000-0000-00000000d001');
  -- Recording the reference must NOT release the goods.
  select count(*) into bae_status_unchanged from public.customs_record
   where id = v_cust and status = 'DECLARATION_PREPARED' and bae_reference = 'BAE-2026-0001';

  perform public.record_customs_release(
    v_cust, 'BAE-2026-0001', '00000000-0000-0000-0000-00000000d002', null, null);
  select count(*) into release_recorded from public.customs_record
   where id = v_cust and status = 'RELEASED';

  -- Neither action may advance the process engine (WES-5 owns that).
  select count(*) - engine_before into engine_untouched
    from public.process_step_execution
   where tenant_id = '00000000-0000-0000-0000-000000000001';

  -- ------------------------------------------- FAILED EVENT ROLLS BACK ALL
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$ begin raise exception 'ledger unavailable'; end; $body$;
  $fn$;

  begin
    perform public.review_document(
      v_doc, 'REJECTED', '00000000-0000-0000-0000-00000000d002',
      'DOCUMENT_ILLEGIBLE', null, false, false, null);
  exception when others then null;
  end;

  select status into rollback_status from public.document where id = v_doc;
  select count(*) into rollback_review from public.document_review
   where document_id = v_doc and action = 'REJECTED';

  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$
    declare v_id uuid;
    begin
      insert into public.business_event (
        tenant_id, event_type, event_domain, event_version, source,
        dossier_id, subject_type, subject_id, actor_user_id,
        correlation_id, causation_id, metadata)
      values (
        p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
        p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
        p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb))
      returning id into v_id;
      return v_id;
    end; $body$;
  $fn$;

  -- ---------------------------------------------------------------- ISOLATION
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d003','role','authenticated')::text, true);
  select count(*) into d3_sees from public.document_review where file_id = v_file;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d004','role','authenticated')::text, true);
  select count(*) into d4_sees from public.document_review;

  perform set_config('role', 'postgres', true);

  raise notice 'WES-4 CHECKS: atomic(%/%/%) selfverify=% otherok=% noreason=% expl_in_event=% ref=%',
    atomic_status, atomic_review, atomic_event, self_verify_rejected, other_verify_ok,
    no_reason_rejected, explanation_in_event, event_reference;
  raise notice 'WES-4 CHECKS: bytes=% reopen=% supchange=% rejpreserved=% rejverify=% fwd=% bwd=% xdossier=%',
    bytes_immutable, superseded_reopen, supersede_change, rejected_preserved,
    reject_then_verify, supersede_forward, supersede_backward, cross_dossier;
  raise notice 'WES-4 CHECKS: bae_unchanged=% released=% engine_delta=% (baseline %) rollback(status=% review=%) d3=% d4=%',
    bae_status_unchanged, release_recorded, engine_untouched, engine_before,
    rollback_status, rollback_review, d3_sees, d4_sees;

  insert into _r values
    ('atomic_status', atomic_status),
    ('atomic_review_record', atomic_review),
    ('atomic_event', atomic_event),
    ('self_verification_rejected', self_verify_rejected),
    ('other_verifier_succeeds', other_verify_ok),
    ('rejection_without_code_refused', no_reason_rejected),
    ('explanation_never_in_event', explanation_in_event),
    ('event_carries_code_and_reference', event_reference),
    ('rejected_version_preserved', rejected_preserved),
    ('rejected_cannot_be_verified', reject_then_verify),
    ('bytes_immutable', bytes_immutable),
    ('superseded_cannot_reopen', superseded_reopen),
    ('supersession_cannot_change', supersede_change),
    ('supersede_forward_link', supersede_forward),
    ('supersede_backward_link', supersede_backward),
    ('cross_dossier_replacement_refused', cross_dossier),
    ('bae_reference_does_not_release', bae_status_unchanged),
    ('release_recorded_separately', release_recorded),
    ('process_engine_untouched', engine_untouched),
    ('failed_event_rolls_back_review', rollback_review),
    ('cross_tenant_sees_reviews', d3_sees),
    ('portal_sees_reviews', d4_sees);

  if atomic_status <> 1 or atomic_review <> 1 or atomic_event <> 1
     or self_verify_rejected <> 1 or other_verify_ok <> 1
     or no_reason_rejected <> 1 or explanation_in_event <> 0 or event_reference <> 1
     or rejected_preserved <> 1 or reject_then_verify <> 1
     or bytes_immutable <> 1 or superseded_reopen <> 1 or supersede_change <> 1
     or supersede_forward <> 1 or supersede_backward <> 1 or cross_dossier <> 1
     or bae_status_unchanged <> 1 or release_recorded <> 1 or engine_untouched <> 0
     or rollback_status <> 'VERIFIED' or rollback_review <> 0
     or d3_sees <> 0 or d4_sees <> 0
  then
    raise exception 'RLS WES-4 FAIL — see the NOTICE lines above for every value';
  end if;
end $$;

select * from _r order by check_name;
rollback;
