-- RLS / RPC regression test — CEO-ALIGNMENT WP1 (migrations 157–161).
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
-- ---------------------------------------------------------------------------
-- WHAT THIS PROVES BEHAVIOURALLY (the verifiers prove the shape):
--
--   WP1-B1/C  the two opening columns refuse a blank or oversized value and
--             accept a valid one; they are columns of the DOSSIER, so the
--             governed customs regime is not written by setting them.
--   WP1-E     expiry governance, end to end:
--     E1  a direct UPDATE of document.expiry_date is refused (EFX01) — the
--         governing trigger, with no history row, stops a silent rewrite;
--     E2  an unverified document changes directly with a reason (APPLIED), and
--         refuses blank reason / unchanged value / clearing a validity date;
--     E3  an actor without document:update, and an actor of another tenant,
--         are refused by assert_actor_authority (EFA*), not by a result code;
--     E4  a VERIFIED document only accepts a PROPOSAL; its date does not move;
--         a second proposal is refused while one is open;
--     E5  the proposer cannot confirm their own proposal; a different
--         document:approve holder can; the date then moves and the document
--         STAYS VERIFIED; a second decision is refused;
--     E6  the history is append-only (UPDATE and DELETE raise);
--     E7  an authenticated session can READ the history only with
--         document:read on a visible dossier, cannot INSERT into it, and
--         cannot EXECUTE either RPC directly.
-- Expected: the final DO block raises on any mismatch; otherwise the result
-- table is printed and the transaction rolled back.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e1001', 'wp1-ops@test.local'),
  ('00000000-0000-0000-0000-0000000e1002', 'wp1-chief@test.local'),
  ('00000000-0000-0000-0000-0000000e1003', 'wp1-bdm@test.local'),
  ('00000000-0000-0000-0000-0000000e1004', 'wp1-other-tenant@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-000000000001', 'wp1-ops@test.local'),
  ('00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-000000000001', 'wp1-chief@test.local'),
  ('00000000-0000-0000-0000-0000000e1003', '00000000-0000-0000-0000-000000000001', 'wp1-bdm@test.local'),
  ('00000000-0000-0000-0000-0000000e1004', '00000000-0000-0000-0000-0000000000b2', 'wp1-other-tenant@test.local')
on conflict (id) do nothing;

-- OPS_SUPERVISOR: document:update + document:approve + file:read:all.
-- CHIEF_OF_TRANSIT: document:update + document:approve.
-- QUOTATION_MANAGER (« Business Development Manager »): no document permission.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000e1001'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000e1002'::uuid, 'CHIEF_OF_TRANSIT'),
  ('00000000-0000-0000-0000-0000000e1003'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ec1a0', '00000000-0000-0000-0000-000000000001', 'WP1 Client A')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000ef001', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97001', 'IMP', '00000000-0000-0000-0000-0000000ec1a0')
on conflict (id) do nothing;

-- doc1 UNVERIFIED, doc2 VERIFIED — both of a validity-bearing type.
insert into public.document (id, tenant_id, file_id, type_code, status, storage_path, expiry_date) values
  ('00000000-0000-0000-0000-0000000ed001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ef001',
   'CERTIFICATE_OF_ORIGIN', 'UPLOADED', 't/wp1/d001.pdf', '2026-12-31'),
  ('00000000-0000-0000-0000-0000000ed002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ef001',
   'CERTIFICATE_OF_ORIGIN', 'VERIFIED', 't/wp1/d002.pdf', '2026-12-31')
on conflict (id) do nothing;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  v_tenant   uuid := '00000000-0000-0000-0000-000000000001';
  v_ops      uuid := '00000000-0000-0000-0000-0000000e1001';
  v_chief    uuid := '00000000-0000-0000-0000-0000000e1002';
  v_bdm      uuid := '00000000-0000-0000-0000-0000000e1003';
  v_foreign  uuid := '00000000-0000-0000-0000-0000000e1004';
  v_file     uuid := '00000000-0000-0000-0000-0000000ef001';
  v_doc1     uuid := '00000000-0000-0000-0000-0000000ed001';
  v_doc2     uuid := '00000000-0000-0000-0000-0000000ed002';
  v_state    text;
  v_res      text;
  v_prop     uuid;
  v_n        int;
  v_reader   int;
  v_noread   int;
  v_date     date;
  v_status   text;
  v_fail     text := '';
begin
  -- ===================================================== WP1-B1 / WP1-C ===
  begin
    update public.operational_file set client_po_reference = '   ' where id = v_file;
    v_fail := v_fail || ' po_blank_accepted';
  exception when check_violation then null;
  end;
  begin
    update public.operational_file set client_po_reference = repeat('x', 65) where id = v_file;
    v_fail := v_fail || ' po_oversize_accepted';
  exception when check_violation then null;
  end;
  begin
    update public.operational_file set customs_regime_declared = repeat('x', 81) where id = v_file;
    v_fail := v_fail || ' regime_oversize_accepted';
  exception when check_violation then null;
  end;
  update public.operational_file
     set client_po_reference = 'PO-4500123', customs_regime_declared = 'Mise à la consommation'
   where id = v_file;
  select count(*) into v_n from public.operational_file
   where id = v_file and client_po_reference = 'PO-4500123'
     and customs_regime_declared = 'Mise à la consommation';
  insert into _r values ('B1C_valid_values_stored', v_n::text);
  if v_n <> 1 then v_fail := v_fail || ' po_regime_not_stored'; end if;
  -- Setting the dossier's « régime prévu » wrote no customs record.
  select count(*) into v_n from public.customs_record where file_id = v_file;
  insert into _r values ('C_no_customs_record_written', v_n::text);
  if v_n <> 0 then v_fail := v_fail || ' customs_record_written'; end if;

  -- ============================================================ WP1-E ===
  -- SERVICE lane: no session.
  perform set_config('request.jwt.claims', '', true);

  -- E1 — a direct UPDATE with no history row is refused.
  begin
    update public.document set expiry_date = '2027-06-30' where id = v_doc1;
    v_fail := v_fail || ' E1_silent_rewrite_accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    insert into _r values ('E1_direct_update_sqlstate', v_state);
    if v_state <> 'EFX01' then v_fail := v_fail || ' E1_wrong_sqlstate:' || v_state; end if;
  end;

  -- E2 — unverified: direct change with a reason.
  v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_ops, '2027-06-30', '   ');
  insert into _r values ('E2_blank_reason', v_res);
  if v_res <> 'reason_required' then v_fail := v_fail || ' E2_blank:' || v_res; end if;

  v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_ops, '2026-12-31', 'même date');
  insert into _r values ('E2_unchanged', v_res);
  if v_res <> 'expiry_unchanged' then v_fail := v_fail || ' E2_unchanged:' || v_res; end if;

  v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_ops, null, 'effacer');
  insert into _r values ('E2_clear_validity_date', v_res);
  if v_res <> 'expiry_required' then v_fail := v_fail || ' E2_clear:' || v_res; end if;

  v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_ops, '2027-06-30', 'Date relevée sur le certificat');
  insert into _r values ('E2_applied', v_res);
  if v_res <> 'applied' then v_fail := v_fail || ' E2_apply:' || v_res; end if;
  select expiry_date into v_date from public.document where id = v_doc1;
  if v_date <> '2027-06-30' then v_fail := v_fail || ' E2_date_not_moved'; end if;
  select count(*) into v_n from public.document_expiry_change
   where document_id = v_doc1 and kind = 'APPLIED' and old_expiry = '2026-12-31'
     and new_expiry = '2027-06-30' and actor_id = v_ops;
  insert into _r values ('E2_history_rows', v_n::text);
  if v_n <> 1 then v_fail := v_fail || ' E2_history'; end if;

  -- E3 — authority is re-proved in the database.
  begin
    v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_bdm, '2027-07-31', 'sans droit');
    v_fail := v_fail || ' E3_unprivileged_accepted:' || v_res;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    insert into _r values ('E3_unprivileged_sqlstate', v_state);
    if v_state not like 'EFA%' then v_fail := v_fail || ' E3_unpriv_state:' || v_state; end if;
  end;
  begin
    v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_foreign, '2027-07-31', 'autre tenant');
    v_fail := v_fail || ' E3_foreign_accepted:' || v_res;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    insert into _r values ('E3_foreign_sqlstate', v_state);
    if v_state not like 'EFA%' then v_fail := v_fail || ' E3_foreign_state:' || v_state; end if;
  end;

  -- E4 — verified: a proposal only.
  v_res := public.record_document_expiry_change(v_doc2, v_tenant, v_ops, '2027-03-31', 'Prolongation reçue du client');
  insert into _r values ('E4_verified_proposed', v_res);
  if v_res <> 'proposed' then v_fail := v_fail || ' E4_propose:' || v_res; end if;
  select expiry_date into v_date from public.document where id = v_doc2;
  if v_date <> '2026-12-31' then v_fail := v_fail || ' E4_date_moved_without_approval'; end if;
  v_res := public.record_document_expiry_change(v_doc2, v_tenant, v_chief, '2027-04-30', 'autre');
  insert into _r values ('E4_second_proposal', v_res);
  if v_res <> 'proposal_pending' then v_fail := v_fail || ' E4_pending:' || v_res; end if;
  select id into v_prop from public.document_expiry_change
   where document_id = v_doc2 and kind = 'PROPOSED';

  -- E5 — maker ≠ checker.
  v_res := public.decide_document_expiry_change(v_prop, v_tenant, v_ops, 'CONFIRMED', null);
  insert into _r values ('E5_self_confirm', v_res);
  if v_res <> 'self_approval_forbidden' then v_fail := v_fail || ' E5_self:' || v_res; end if;
  v_res := public.decide_document_expiry_change(v_prop, v_tenant, v_chief, 'CONFIRMED', null);
  insert into _r values ('E5_independent_confirm', v_res);
  if v_res <> 'confirmed' then v_fail := v_fail || ' E5_confirm:' || v_res; end if;
  select expiry_date, status into v_date, v_status from public.document where id = v_doc2;
  if v_date <> '2027-03-31' then v_fail := v_fail || ' E5_date_not_applied'; end if;
  insert into _r values ('E5_status_after_confirm', v_status);
  if v_status <> 'VERIFIED' then v_fail := v_fail || ' E5_status_changed:' || v_status; end if;
  v_res := public.decide_document_expiry_change(v_prop, v_tenant, v_chief, 'REJECTED', 'trop tard');
  insert into _r values ('E5_second_decision', v_res);
  if v_res <> 'already_decided' then v_fail := v_fail || ' E5_twice:' || v_res; end if;

  -- E6 — append-only.
  begin
    update public.document_expiry_change set reason = 'réécrit' where document_id = v_doc1;
    v_fail := v_fail || ' E6_update_accepted';
  exception when others then null;
  end;
  begin
    delete from public.document_expiry_change where document_id = v_doc1;
    v_fail := v_fail || ' E6_delete_accepted';
  exception when others then null;
  end;
  select count(*) into v_n from public.document_expiry_change where document_id in (v_doc1, v_doc2);
  insert into _r values ('E6_history_intact', v_n::text);
  if v_n <> 3 then v_fail := v_fail || ' E6_history_count:' || v_n; end if;

  -- E7 — what an authenticated session may do. Results are held in variables
  -- and recorded only after switching back: the temp result table belongs to
  -- postgres, and writing to it as `authenticated` would fail for the wrong
  -- reason.
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.document_expiry_change where document_id in (v_doc1, v_doc2);
  v_reader := v_n;  -- recorded below, once back as postgres
  if v_n <> 3 then v_fail := v_fail || ' E7_reader:' || v_n; end if;

  begin
    insert into public.document_expiry_change (tenant_id, file_id, document_id, kind, old_expiry, new_expiry, reason, actor_id)
    values (v_tenant, v_file, v_doc1, 'APPLIED', '2027-06-30', '2028-01-01', 'forgé', v_ops);
    v_fail := v_fail || ' E7_client_insert_accepted';
  exception when others then null;
  end;
  -- The REVOKE is the property under test. If EXECUTE ever comes back, the
  -- RPC's own SERVICE-lane assertion still refuses a session-bearing caller —
  -- defence in depth — but that is a SECOND layer holding, not the first one,
  -- so the suite names the revoke regression rather than passing on it.
  begin
    v_res := public.record_document_expiry_change(v_doc1, v_tenant, v_ops, '2028-01-01', 'direct');
    v_fail := v_fail || ' E7_rpc_executable_by_authenticated';
  exception
    when insufficient_privilege then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_fail := v_fail || ' E7_rpc_executable_by_authenticated(refused_later:' || v_state || ')';
  end;
  begin
    v_res := public.decide_document_expiry_change(v_prop, v_tenant, v_chief, 'REJECTED', 'direct');
    v_fail := v_fail || ' E7_decide_executable_by_authenticated';
  exception
    when insufficient_privilege then null;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_fail := v_fail || ' E7_decide_executable_by_authenticated(refused_later:' || v_state || ')';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bdm::text, 'role', 'authenticated')::text, true);
  select count(*) into v_noread from public.document_expiry_change where document_id in (v_doc1, v_doc2);
  if v_noread <> 0 then v_fail := v_fail || ' E7_noread:' || v_noread; end if;

  perform set_config('role', 'postgres', true);
  insert into _r values ('E7_reader_sees', v_reader::text), ('E7_no_document_read_sees', v_noread::text);

  if v_fail <> '' then
    raise exception 'RLS WP1 OPENING FAIL:%', v_fail;
  end if;
end $$;

select * from _r order by check_name;
rollback;
