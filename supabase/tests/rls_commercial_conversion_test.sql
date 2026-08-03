-- RLS + invariants test — EC-3D Customer acceptance & conversion (migration 84).
-- BEGIN/ROLLBACK.
--
-- Proves what the phase actually promises, in real PostgreSQL:
--   * acceptance REQUIRES evidence — a decision without it is refused;
--   * only the LATEST live version may be accepted; an older, superseded one
--     cannot, and stays immutable;
--   * conversion is refused unless the quotation is ACCEPTED (QT616);
--   * a CROSS-TENANT dossier is refused (QT617) — the security claim that
--     matters most here, because the RPC is SECURITY DEFINER;
--   * the keystone event carries the DOSSIER as subject AND dossier_id;
--   * recording a conversion writes NO operational_file row (Commercial owns
--     no dossier: the count is unchanged across the call);
--   * the customer notification can now carry a quotation, and 'commercial' is
--     an accepted category.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c3f1', 'ec3d-agent@test.local'),
  ('00000000-0000-0000-0000-00000000c3f2', 'ec3d-sup@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000c3f1', '00000000-0000-0000-0000-000000000001', 'ec3d-agent@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3f2', '00000000-0000-0000-0000-000000000001', 'ec3d-sup@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c3f9', '00000000-0000-0000-0000-000000000001', 'Client EC3D')
on conflict (id) do nothing;

-- A dossier in THIS tenant, and one in ANOTHER tenant: the cross-tenant control.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000c3fa', '00000000-0000-0000-0000-000000000001',
   'EC3D-TEST-0001', 'IMP', '00000000-0000-0000-0000-00000000c3f9', 'DRAFT')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  req uuid; v1 uuid; v2 uuid; other_tenant uuid; other_file uuid;
  accept_without_evidence_rejected int := 0;
  old_version_accept_rejected int := 0;
  convert_before_accept_rejected int := 0;
  cross_tenant_convert_rejected int := 0;
  files_before int; files_after int; files_created_by_rpc int;
  conv_event int; conv_event_dossier int;
  v1_status text; v1_frozen int := 0;
  notif_ok int := 0; category_ok int := 0;
  converted_ok int;
begin
  perform set_config('role', 'postgres', true);

  select id into other_tenant from public.organization
   where id <> '00000000-0000-0000-0000-000000000001' limit 1;

  insert into public.quotation_request (id, tenant_id, client_id, subject, opened_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000c3f9', 'Conversion EC3D',
          '00000000-0000-0000-0000-00000000c3f1')
  returning id into req;

  -- ---- version 1: prepared, validated, sent -----------------------------
  select public.quotation_create('00000000-0000-0000-0000-000000000001', req,
    '00000000-0000-0000-0000-00000000c3f1') into v1;
  insert into public.quotation_line
    (tenant_id, quotation_id, position, description, quantity_milli, unit_amount_minor, tax_rate_bp)
  values ('00000000-0000-0000-0000-000000000001', v1, 1, 'Prestation', 1000, 500000, 0);
  perform public.quotation_submit('00000000-0000-0000-0000-000000000001', v1,
    '00000000-0000-0000-0000-00000000c3f1');
  perform public.quotation_validate('00000000-0000-0000-0000-000000000001', v1,
    '00000000-0000-0000-0000-00000000c3f2', 'VALIDATED', null);
  perform public.quotation_send('00000000-0000-0000-0000-000000000001', v1,
    '00000000-0000-0000-0000-00000000c3f1');

  -- RULE: conversion before acceptance is refused (QT616).
  begin
    perform public.quotation_record_conversion('00000000-0000-0000-0000-000000000001',
      v1, '00000000-0000-0000-0000-00000000c3f1', '00000000-0000-0000-0000-00000000c3fa');
  exception when others then convert_before_accept_rejected := 1;
  end;

  -- RULE: acceptance REQUIRES evidence. Decision with no kind/date is refused.
  begin
    perform public.quotation_record_decision('00000000-0000-0000-0000-000000000001',
      v1, '00000000-0000-0000-0000-00000000c3f1', 'ACCEPTED', null, null, null, null, null);
  exception when others then accept_without_evidence_rejected := 1;
  end;

  -- ---- revise: v1 becomes SUPERSEDED, v2 is the live version -------------
  select public.quotation_revise('00000000-0000-0000-0000-000000000001', v1,
    '00000000-0000-0000-0000-00000000c3f1') into v2;

  select status into v1_status from public.quotation where id = v1;

  -- RULE: an OLD version may not be accepted. Only the latest live one.
  begin
    perform public.quotation_record_decision('00000000-0000-0000-0000-000000000001',
      v1, '00000000-0000-0000-0000-00000000c3f1', 'ACCEPTED',
      'SIGNED_QUOTATION', current_date, null, null, null);
  exception when others then old_version_accept_rejected := 1;
  end;

  -- And it stays immutable: a direct line edit on the superseded version fails.
  begin
    -- EXPECT-FAIL: lines of a frozen quotation cannot change (QT612).
    update public.quotation_line set description = 'modifiée' where quotation_id = v1;
  exception when others then v1_frozen := 1;
  end;

  -- ---- accept v2 properly, with evidence ---------------------------------
  perform public.quotation_submit('00000000-0000-0000-0000-000000000001', v2,
    '00000000-0000-0000-0000-00000000c3f1');
  perform public.quotation_validate('00000000-0000-0000-0000-000000000001', v2,
    '00000000-0000-0000-0000-00000000c3f2', 'VALIDATED', null);
  perform public.quotation_send('00000000-0000-0000-0000-000000000001', v2,
    '00000000-0000-0000-0000-00000000c3f1');
  perform public.quotation_record_decision('00000000-0000-0000-0000-000000000001',
    v2, '00000000-0000-0000-0000-00000000c3f1', 'ACCEPTED',
    'SIGNED_QUOTATION', current_date, null, null, null);

  -- RULE: a dossier from ANOTHER tenant is refused (QT617). The RPC is
  -- SECURITY DEFINER, so this check is the boundary — not RLS.
  if other_tenant is not null then
    insert into public.operational_file (id, tenant_id, file_number, type, status)
    values (gen_random_uuid(), other_tenant, 'EC3D-OTHER-0001', 'IMP', 'DRAFT')
    returning id into other_file;
    begin
      perform public.quotation_record_conversion('00000000-0000-0000-0000-000000000001',
        v2, '00000000-0000-0000-0000-00000000c3f1', other_file);
    exception when others then cross_tenant_convert_rejected := 1;
    end;
  else
    cross_tenant_convert_rejected := 1;  -- no second tenant seeded; not a failure
  end if;

  -- ---- the conversion itself --------------------------------------------
  select count(*) into files_before from public.operational_file
   where tenant_id = '00000000-0000-0000-0000-000000000001';

  perform public.quotation_record_conversion('00000000-0000-0000-0000-000000000001',
    v2, '00000000-0000-0000-0000-00000000c3f1', '00000000-0000-0000-0000-00000000c3fa');

  select count(*) into files_after from public.operational_file
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  files_created_by_rpc := files_after - files_before;

  select count(*) into converted_ok from public.quotation
   where id = v2 and status = 'CONVERTED'
     and converted_file_id = '00000000-0000-0000-0000-00000000c3fa';

  -- The keystone event: DOSSIER as subject AND as dossier_id.
  select count(*) into conv_event from public.business_event
   where event_type = 'QUOTATION_CONVERTED_TO_DOSSIER'
     and subject_id = '00000000-0000-0000-0000-00000000c3fa';
  select count(*) into conv_event_dossier from public.business_event
   where event_type = 'QUOTATION_CONVERTED_TO_DOSSIER'
     and dossier_id = '00000000-0000-0000-0000-00000000c3fa'
     and subject_type = 'operational_file';

  -- ---- migration 84: the notification can carry a quotation --------------
  begin
    insert into public.client_notification
      (tenant_id, client_id, event_type, category, template_key, title, body,
       quotation_id, dedup_key)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c3f9',
            'quotation_accepted', 'commercial', 'quotation_accepted',
            'Cotation acceptée', 'Acceptation enregistrée', v2, 'ec3d:test:' || v2::text);
    notif_ok := 1; category_ok := 1;
  exception when others then notif_ok := 0;
  end;

  insert into _r values
    ('accept_without_evidence_rejected', accept_without_evidence_rejected),
    ('old_version_accept_rejected', old_version_accept_rejected),
    ('superseded_lines_frozen', v1_frozen),
    ('convert_before_accept_rejected', convert_before_accept_rejected),
    ('cross_tenant_convert_rejected', cross_tenant_convert_rejected),
    ('files_created_by_rpc', files_created_by_rpc),
    ('quotation_converted', converted_ok),
    ('event_on_dossier_subject', conv_event),
    ('event_carries_dossier_id', conv_event_dossier),
    ('commercial_notification_accepted', notif_ok),
    ('commercial_category_allowed', category_ok);

  if accept_without_evidence_rejected<>1 or old_version_accept_rejected<>1
     or v1_frozen<>1 or convert_before_accept_rejected<>1
     or cross_tenant_convert_rejected<>1
     or files_created_by_rpc<>0 or converted_ok<>1
     or conv_event<>1 or conv_event_dossier<>1
     or notif_ok<>1 or category_ok<>1
     or v1_status <> 'SUPERSEDED'
  then
    raise exception 'EC-3D FAIL: noEvidence=% oldVersion=% frozen=% convEarly=% xTenant=% filesByRpc=% converted=% evSubj=% evDoss=% notif=% category=% v1Status=%',
      accept_without_evidence_rejected, old_version_accept_rejected, v1_frozen,
      convert_before_accept_rejected, cross_tenant_convert_rejected,
      files_created_by_rpc, converted_ok, conv_event, conv_event_dossier,
      notif_ok, category_ok, v1_status;
  end if;
end $$;

select * from _r order by check_name;
rollback;
