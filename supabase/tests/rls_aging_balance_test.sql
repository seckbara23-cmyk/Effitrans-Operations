-- RLS + integrity regression test — Aging Balance foundation (FIN-AGING-2).
-- Migration 20260729000002. Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the invariants the ratification requires, in the database rather than
-- in an action that a future caller might bypass:
--
--   Q-08 provenance
--     * PLATFORM_NATIVE without a dossier                            -> REJECTED
--     * OPENING_IMPORT with a legacy reference, no dossier           -> ACCEPTED
--     * OPENING_IMPORT with neither dossier nor legacy reference     -> REJECTED
--     * cross-tenant dossier on an invoice                           -> REJECTED
--
--   Maker-checker (structural, not conventional)
--     * import batch approved by its preparer                        -> REJECTED
--     * report validated by its preparer                             -> REJECTED
--     * report finalized by its preparer                             -> REJECTED
--
--   Snapshot immutability and lifecycle
--     * rows added to a VALIDATED report                             -> REJECTED
--     * rows mutated on a FINAL report                               -> REJECTED
--     * illegal transition (DRAFT -> FINAL)                          -> REJECTED
--     * SUPERSEDED without naming the successor                      -> REJECTED
--     * deleting a FINAL report                                      -> REJECTED
--     * superseding preserves the predecessor's rows                 -> PRESERVED
--     * two live FINALs for one (tenant, date, currency)             -> REJECTED
--     * editing a template version pinned by a report                -> REJECTED
--     * artifact hash mutation / deletion                            -> REJECTED
--
--   Sharing
--     * share link on a DRAFT report's artifact                      -> REJECTED
--     * share link on a FINAL report's artifact                      -> ACCEPTED
--
--   Import pipeline
--     * a REJECTED staging row carrying an invoice                   -> REJECTED
--     * cross-tenant dossier match on a staging row                  -> REJECTED
--
--   Tenant isolation (RLS)
--     * tenant-A finance reader sees A's report, not B's             -> 1 / 0
--     * a reader WITHOUT finance:aging:read sees nothing             -> 0
--     * SYSTEM_ADMIN holds no validate/finalize/import_approve/share -> 0 each
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Tenant A is the seeded Effitrans tenant; tenant B is foreign.
-- ---------------------------------------------------------------------------
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c1', 'Test Tenant B (aging)', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'agingfin@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'agingdaf@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'agingnone@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'agingfin@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'agingdaf@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000001', 'agingnone@test.local')
on conflict (id) do nothing;

-- E1 = FINANCE_OFFICER (reads), E2 = DAF (reads + approves), E3 = no finance role.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DAF'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000001', 'Client Aging A'),
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000c1', 'Client Aging B')
on conflict (id) do nothing;

-- A dossier in tenant B, used to prove cross-tenant linkage is refused.
insert into public.operational_file (id, tenant_id, file_number, client_id, type, status)
values ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-0000000000c1',
        'EFT-B-AGING-1', '00000000-0000-0000-0000-00000000cb01', 'IMP', 'OPENED')
on conflict (id) do nothing;

insert into public.aging_template_version (id, tenant_id, code, version, title_fr, renderer_key)
values ('00000000-0000-0000-0000-00000000dd01', null, 'AGING_BALANCE', 1, 'Balance âgée', 'aging-xlsx-v1')
on conflict (id) do nothing;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  T_A uuid := '00000000-0000-0000-0000-000000000001';
  T_B uuid := '00000000-0000-0000-0000-0000000000c1';
  U1  uuid := '00000000-0000-0000-0000-0000000000e1';
  U2  uuid := '00000000-0000-0000-0000-0000000000e2';
  U3  uuid := '00000000-0000-0000-0000-0000000000e3';
  TPL uuid := '00000000-0000-0000-0000-00000000dd01';
  CLI uuid := '00000000-0000-0000-0000-00000000ca01';
  FB  uuid := '00000000-0000-0000-0000-00000000fb01';

  native_no_dossier int := 0;
  legacy_ok         int := 0;
  legacy_naked      int := 0;
  xtenant_dossier   int := 0;
  batch_self        int := 0;
  report_self_val   int := 0;
  report_self_fin   int := 0;
  rows_after_valid  int := 0;
  rows_on_final     int := 0;
  bad_transition    int := 0;
  supersede_naked   int := 0;
  final_delete      int := 0;
  two_finals        int := 0;
  pinned_template   int := 0;
  artifact_mutate   int := 0;
  artifact_delete   int := 0;
  share_on_draft    int := 0;
  share_on_final    int := 0;
  staging_rejected  int := 0;
  staging_xtenant   int := 0;

  a_sees_own int; a_sees_b int; none_sees int;
  sysadmin_validate int; sysadmin_finalize int; sysadmin_approve int; sysadmin_share int;
  preserved_rows int;

  v_report uuid; v_report2 uuid; v_legacy uuid; v_batch uuid; v_artifact uuid;
begin
  -- =========================================================== Q-08 provenance
  begin
    insert into public.invoice (tenant_id, file_id, client_id, provenance, status)
    values (T_A, null, CLI, 'PLATFORM_NATIVE', 'DRAFT');
  exception when others then native_no_dossier := 1;
  end;

  begin
    insert into public.invoice (id, tenant_id, file_id, client_id, provenance,
                                legacy_file_reference, invoice_number, status, issue_date, due_date)
    values ('00000000-0000-0000-0000-0000000019a1', T_A, null, CLI, 'OPENING_IMPORT',
            'DOSSIER-LEGACY-2019-044', 'LEG-2019-0001', 'ISSUED', date '2019-03-01', date '2019-04-01');
    legacy_ok := 1;
    v_legacy := '00000000-0000-0000-0000-0000000019a1';
  exception when others then legacy_ok := 0;
  end;

  begin
    insert into public.invoice (tenant_id, file_id, client_id, provenance, status)
    values (T_A, null, CLI, 'OPENING_IMPORT', 'DRAFT');
  exception when others then legacy_naked := 1;
  end;

  -- A tenant-A invoice may not point at a tenant-B dossier.
  begin
    insert into public.invoice (tenant_id, file_id, client_id, provenance, status)
    values (T_A, FB, CLI, 'PLATFORM_NATIVE', 'DRAFT');
  exception when others then xtenant_dossier := 1;
  end;

  -- ===================================================== maker-checker: import
  insert into public.legacy_import_batch (id, tenant_id, batch_number, prepared_by)
  values ('00000000-0000-0000-0000-00000000b101', T_A, 'IMP-0001', U1);
  v_batch := '00000000-0000-0000-0000-00000000b101';

  begin
    update public.legacy_import_batch set approved_by = U1, approved_at = now(), status = 'APPROVED'
     where id = v_batch;
  exception when others then batch_self := 1;
  end;
  -- a DIFFERENT actor may approve
  update public.legacy_import_batch set approved_by = U2, approved_at = now(), status = 'APPROVED'
   where id = v_batch;

  -- ===================================================== maker-checker: report
  insert into public.aging_report (id, tenant_id, report_number, reporting_date, template_id,
                                   engine_version, bucket_scheme, risk_scheme, prepared_by, prepared_at)
  values ('00000000-0000-0000-0000-00000000ee01', T_A, 'EFT-BAL-2026-00001', date '2026-06-12', TPL,
          'fin-aging-1', 'AGING_BALANCE_V1', 'AGING_BALANCE_V1', U1, now());
  v_report := '00000000-0000-0000-0000-00000000ee01';

  begin
    update public.aging_report set validated_by = U1, validated_at = now(), status = 'VALIDATED'
     where id = v_report;
  exception when others then report_self_val := 1;
  end;

  begin
    update public.aging_report set finalized_by = U1 where id = v_report;
  exception when others then report_self_fin := 1;
  end;

  -- One snapshot row while DRAFT (legal).
  insert into public.aging_report_row (tenant_id, report_id, source_invoice_id, invoice_number,
    issue_date, due_date, client_name, original_amount, outstanding, days_overdue, bucket, risk, row_order)
  values (T_A, v_report, v_legacy, 'LEG-2019-0001', date '2019-03-01', date '2019-04-01',
          'Client Aging A', 1000000.00, 1000000.00, 2599, 'OVER_365', 'CRITIQUE', 1);

  insert into public.aging_report_totals (report_id, tenant_id, kpis, buckets, clients, charts)
  values (v_report, T_A, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);

  -- ============================================ illegal transition DRAFT->FINAL
  begin
    update public.aging_report set status = 'FINAL' where id = v_report;
  exception when others then bad_transition := 1;
  end;

  -- Validate properly (different actor).
  update public.aging_report set validated_by = U2, validated_at = now(), status = 'VALIDATED'
   where id = v_report;

  -- ================================================== snapshot immutability
  begin
    insert into public.aging_report_row (tenant_id, report_id, invoice_number, issue_date, due_date,
      client_name, original_amount, outstanding, days_overdue, bucket, risk, row_order)
    values (T_A, v_report, 'SNEAK-1', date '2020-01-01', date '2020-02-01',
            'Client Aging A', 1.00, 1.00, 10, 'D1_30', 'FAIBLE', 2);
  exception when others then rows_after_valid := 1;
  end;

  update public.aging_report set finalized_by = U2, finalized_at = now(), status = 'FINAL'
   where id = v_report;

  begin
    update public.aging_report_row set outstanding = 1.00 where report_id = v_report;
  exception when others then rows_on_final := 1;
  end;

  -- ====================================================== artifact protection
  insert into public.aging_report_artifact (id, tenant_id, report_id, format, storage_path,
                                            content_sha256, renderer_key)
  values ('00000000-0000-0000-0000-00000000a101', T_A, v_report, 'XLSX', 'aging/r1.xlsx',
          repeat('a', 64), 'aging-xlsx-v1');
  v_artifact := '00000000-0000-0000-0000-00000000a101';

  begin
    update public.aging_report_artifact set content_sha256 = repeat('b', 64) where id = v_artifact;
  exception when others then artifact_mutate := 1;
  end;
  begin
    delete from public.aging_report_artifact where id = v_artifact;
  exception when others then artifact_delete := 1;
  end;

  -- =============================================================== sharing
  -- A DRAFT report's artifact may not be shared.
  insert into public.aging_report (id, tenant_id, report_number, reporting_date, template_id,
                                   engine_version, bucket_scheme, risk_scheme, prepared_by, prepared_at)
  values ('00000000-0000-0000-0000-00000000ee02', T_A, 'EFT-BAL-2026-00002', date '2026-05-31', TPL,
          'fin-aging-1', 'AGING_BALANCE_V1', 'AGING_BALANCE_V1', U1, now());
  v_report2 := '00000000-0000-0000-0000-00000000ee02';
  insert into public.aging_report_artifact (id, tenant_id, report_id, format, storage_path,
                                            content_sha256, renderer_key)
  values ('00000000-0000-0000-0000-00000000a102', T_A, v_report2, 'PDF', 'aging/r2.pdf',
          repeat('c', 64), 'aging-pdf-v1');

  begin
    insert into public.aging_report_share (tenant_id, artifact_id, token_hash, expires_at)
    values (T_A, '00000000-0000-0000-0000-00000000a102', repeat('d', 64), now() + interval '7 days');
  exception when others then share_on_draft := 1;
  end;

  begin
    insert into public.aging_report_share (tenant_id, artifact_id, token_hash, expires_at)
    values (T_A, v_artifact, repeat('e', 64), now() + interval '7 days');
    share_on_final := 1;
  exception when others then share_on_final := 0;
  end;

  -- ==================================================== two live FINALs refused
  begin
    update public.aging_report set reporting_date = date '2026-06-12' where id = v_report2;
    update public.aging_report set validated_by = U2, validated_at = now(), status = 'VALIDATED' where id = v_report2;
    update public.aging_report set finalized_by = U2, finalized_at = now(), status = 'FINAL' where id = v_report2;
  exception when others then two_finals := 1;
  end;

  -- ================================================ supersede must name successor
  begin
    update public.aging_report set status = 'SUPERSEDED' where id = v_report;
  exception when others then supersede_naked := 1;
  end;

  -- Legal supersede: the predecessor keeps its rows.
  update public.aging_report set status = 'SUPERSEDED', superseded_by_id = v_report2 where id = v_report;
  select count(*) into preserved_rows from public.aging_report_row where report_id = v_report;

  begin
    delete from public.aging_report where id = v_report;
  exception when others then final_delete := 1;
  end;

  -- =================================================== pinned template immutable
  begin
    update public.aging_template_version set config = '{"changed":true}'::jsonb where id = TPL;
  exception when others then pinned_template := 1;
  end;

  -- ========================================================= import pipeline
  begin
    insert into public.legacy_import_staging_row (tenant_id, batch_id, source_row_number, raw,
                                                  status, created_invoice_id)
    values (T_A, v_batch, 1, '{}'::jsonb, 'REJECTED', v_legacy);
  exception when others then staging_rejected := 1;
  end;

  begin
    insert into public.legacy_import_staging_row (tenant_id, batch_id, source_row_number, raw,
                                                  matched_file_id)
    values (T_A, v_batch, 2, '{}'::jsonb, FB);
  exception when others then staging_xtenant := 1;
  end;

  -- ============================================================ RLS isolation
  -- A tenant-B report, to prove tenant-A cannot see it.
  insert into public.aging_report (id, tenant_id, report_number, reporting_date, template_id,
                                   engine_version, bucket_scheme, risk_scheme)
  values ('00000000-0000-0000-0000-00000000ee03', T_B, 'B-BAL-1', date '2026-06-12', TPL,
          'fin-aging-1', 'AGING_BALANCE_V1', 'AGING_BALANCE_V1');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', U1::text, 'role', 'authenticated')::text, true);
  select count(*) into a_sees_own from public.aging_report where tenant_id = T_A;
  select count(*) into a_sees_b   from public.aging_report where tenant_id = T_B;

  perform set_config('request.jwt.claims',
    json_build_object('sub', U3::text, 'role', 'authenticated')::text, true);
  select count(*) into none_sees from public.aging_report;

  perform set_config('role', 'postgres', true);

  -- ================================= SYSTEM_ADMIN holds no approval authority
  select count(*) into sysadmin_validate from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'SYSTEM_ADMIN' and p.code = 'finance:aging:validate';
  select count(*) into sysadmin_finalize from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'SYSTEM_ADMIN' and p.code = 'finance:aging:finalize';
  select count(*) into sysadmin_approve from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'SYSTEM_ADMIN' and p.code = 'finance:aging:import_approve';
  select count(*) into sysadmin_share from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'SYSTEM_ADMIN' and p.code = 'finance:aging:share';

  insert into _r values
    ('q08_native_without_dossier_rejected', native_no_dossier::text),
    ('q08_legacy_with_reference_accepted', legacy_ok::text),
    ('q08_legacy_without_anything_rejected', legacy_naked::text),
    ('q08_cross_tenant_dossier_rejected', xtenant_dossier::text),
    ('mc_batch_self_approval_rejected', batch_self::text),
    ('mc_report_self_validation_rejected', report_self_val::text),
    ('mc_report_self_finalization_rejected', report_self_fin::text),
    ('snapshot_rows_frozen_after_validate', rows_after_valid::text),
    ('snapshot_rows_frozen_on_final', rows_on_final::text),
    ('lifecycle_draft_to_final_rejected', bad_transition::text),
    ('supersede_requires_successor', supersede_naked::text),
    ('final_report_delete_rejected', final_delete::text),
    ('superseded_rows_preserved', preserved_rows::text),
    ('two_live_finals_rejected', two_finals::text),
    ('pinned_template_immutable', pinned_template::text),
    ('artifact_hash_immutable', artifact_mutate::text),
    ('artifact_delete_rejected', artifact_delete::text),
    ('share_on_draft_rejected', share_on_draft::text),
    ('share_on_final_accepted', share_on_final::text),
    ('staging_rejected_row_carries_no_invoice', staging_rejected::text),
    ('staging_cross_tenant_dossier_rejected', staging_xtenant::text),
    ('rls_tenant_a_sees_own', a_sees_own::text),
    ('rls_tenant_a_sees_b', a_sees_b::text),
    ('rls_no_permission_sees_nothing', none_sees::text),
    ('sysadmin_cannot_validate', sysadmin_validate::text),
    ('sysadmin_cannot_finalize', sysadmin_finalize::text),
    ('sysadmin_cannot_approve_import', sysadmin_approve::text),
    ('sysadmin_cannot_share', sysadmin_share::text);

  if native_no_dossier <> 1 or legacy_ok <> 1 or legacy_naked <> 1 or xtenant_dossier <> 1
     or batch_self <> 1 or report_self_val <> 1 or report_self_fin <> 1
     or rows_after_valid <> 1 or rows_on_final <> 1 or bad_transition <> 1
     or supersede_naked <> 1 or final_delete <> 1 or preserved_rows <> 1
     or two_finals <> 1 or pinned_template <> 1
     or artifact_mutate <> 1 or artifact_delete <> 1
     or share_on_draft <> 1 or share_on_final <> 1
     or staging_rejected <> 1 or staging_xtenant <> 1
     or a_sees_own < 1 or a_sees_b <> 0 or none_sees <> 0
     or sysadmin_validate <> 0 or sysadmin_finalize <> 0
     or sysadmin_approve <> 0 or sysadmin_share <> 0 then
    raise exception 'AGING FAIL: q08(% % % %) mc(% % %) snap(% % % % % %) two_finals=% tpl=% art(% %) share(% %) staging(% %) rls(% % %) sysadmin(% % % %)',
      native_no_dossier, legacy_ok, legacy_naked, xtenant_dossier,
      batch_self, report_self_val, report_self_fin,
      rows_after_valid, rows_on_final, bad_transition, supersede_naked, final_delete, preserved_rows,
      two_finals, pinned_template, artifact_mutate, artifact_delete,
      share_on_draft, share_on_final, staging_rejected, staging_xtenant,
      a_sees_own, a_sees_b, none_sees,
      sysadmin_validate, sysadmin_finalize, sysadmin_approve, sysadmin_share;
  end if;
end $$;

select * from _r order by check_name;
rollback;
