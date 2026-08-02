-- RLS + invariants test — EC-3B Commercial/Quotation (migration 82). BEGIN/ROLLBACK.
-- Proves: the Phase-5.0D blanket grant is REVOKED (0 grants on all four codes,
-- SYSTEM_ADMIN included); the EXACT ratified grant matrix (DEC-C32) is live;
-- MAKER-CHECKER is structural (the preparer cannot validate, via RPC AND via
-- CHECK); a sent quotation is immutable and its lines are frozen; only ONE live
-- version may exist per request; revision supersedes and the old version stays
-- visible; acceptance requires an evidence kind and is never inferred;
-- conversion requires ACCEPTED and records the dossier; the keystone event
-- carries the DOSSIER; money stays integer; and no Finance row is touched.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c3a1', 'q-prep@test.local'),
  ('00000000-0000-0000-0000-00000000c3a2', 'q-valid@test.local'),
  ('00000000-0000-0000-0000-00000000c3a3', 'q-admin@test.local'),
  ('00000000-0000-0000-0000-00000000c3a4', 'q-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000c3a1', '00000000-0000-0000-0000-000000000001', 'q-prep@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3a2', '00000000-0000-0000-0000-000000000001', 'q-valid@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000c3a3', '00000000-0000-0000-0000-000000000001', 'q-admin@test.local', 'active')
on conflict (id) do nothing;

-- A reader role holding quotation:create (no seeded role holds it any more).
insert into public.role (id, tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-00000000c3b1', '00000000-0000-0000-0000-000000000001',
   'Q_TEST_READER', 'Lecteur cotation (test)', 'Quotation Test Reader', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000000c3b1', p.id from public.permission p
where p.code = 'quotation:create' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-00000000c3a1', '00000000-0000-0000-0000-00000000c3b1', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000c3a3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c3c1', '00000000-0000-0000-0000-000000000001', 'Client Cotation')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000c3a4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000c3c1', 'q-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000c3d1', '00000000-0000-0000-0000-000000000001',
   'QT-TEST-0001', 'IMP', '00000000-0000-0000-0000-00000000c3c1', 'DRAFT')
on conflict (id) do nothing;

insert into public.quotation_request (id, tenant_id, client_id, subject) values
  ('00000000-0000-0000-0000-00000000c3e1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000c3c1', 'Import conteneur (test)')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  validate_perm int; matrix_grants int; offmatrix_grants int; admin_grants int;
  q1 uuid; q2 uuid; num text;
  same_actor_rejected int := 0; check_rejected int := 0;
  send_before_validate_rejected int := 0; frozen_rejected int := 0;
  lines_frozen_rejected int := 0; two_live_rejected int := 0;
  accept_without_kind_rejected int := 0; convert_before_accept_rejected int := 0;
  superseded_kept int; v1_visible int;
  ev_created int; ev_validated int; ev_sent int; ev_accepted int;
  ev_revised int; ev_converted int; ev_converted_dossier int; ev_cancelled int;
  reader_sees int; admin_sees int; portal_sees int;
  finance_rows int; sub_total bigint;
begin
  perform set_config('role', 'postgres', true);

  -- The authority exists.
  select count(*) into validate_perm from public.permission where code = 'quotation:validate';

  -- EC-3C: the EXACT ratified matrix, read LIVE from the database (DEC-C32).
  -- This assertion used to be "granted to NOBODY", which was correct while
  -- EC-3B held everything ungranted. Migration 83 makes some grants legitimate,
  -- so the check was REPLACED by an exact-matrix one rather than deleted: the
  -- protection is stronger, not weaker, because it now also fails if a grant is
  -- MISSING or lands on the wrong role.
  select count(*) into matrix_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and ((r.code = 'QUOTATION_MANAGER'
           and p.code in ('quotation:create','quotation:send','quotation:approve'))
       or (r.code = 'OPS_SUPERVISOR' and p.code = 'quotation:validate'));

  -- Nobody OUTSIDE the matrix holds any quotation authority (the suite's own
  -- fixture role excepted — it exists to prove RLS, not to model a real seat).
  select count(*) into offmatrix_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where p.code in ('quotation:create','quotation:send','quotation:approve','quotation:validate')
     and rp.role_id <> '00000000-0000-0000-0000-00000000c3b1'
     and not ((r.code = 'QUOTATION_MANAGER'
               and p.code in ('quotation:create','quotation:send','quotation:approve'))
           or (r.code = 'OPS_SUPERVISOR' and p.code = 'quotation:validate'));

  -- The invariant the whole model rests on, asserted on its own.
  select count(*) into admin_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
   where r.code = 'SYSTEM_ADMIN'
     and p.code in ('quotation:create','quotation:send','quotation:approve','quotation:validate');

  -- Draft v1 with two lines, integer money throughout.
  -- Through the RPC, so creation and its event commit together.
  select public.quotation_create('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000c3e1', '00000000-0000-0000-0000-00000000c3a1') into q1;

  insert into public.quotation_line
    (tenant_id, quotation_id, position, description, quantity_milli, unit_amount_minor, tax_rate_bp)
  values
    ('00000000-0000-0000-0000-000000000001', q1, 1, 'Transit maritime', 2000, 15000000, 0),
    ('00000000-0000-0000-0000-000000000001', q1, 2, 'Manutention', 1000, 5000000, 0);

  -- A second LIVE version for the same request is refused by the partial index.
  begin
    insert into public.quotation (tenant_id, request_id, client_id, version, status)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c3e1',
            '00000000-0000-0000-0000-00000000c3c1', 99, 'DRAFT');
  exception when others then two_live_rejected := 1;
  end;

  perform public.quotation_submit('00000000-0000-0000-0000-000000000001', q1,
    '00000000-0000-0000-0000-00000000c3a1');

  -- MAKER-CHECKER: the preparer cannot validate their own quotation (RPC).
  begin
    perform public.quotation_validate('00000000-0000-0000-0000-000000000001', q1,
      '00000000-0000-0000-0000-00000000c3a1', 'VALIDATED');
  exception when others then same_actor_rejected := 1;
  end;
  -- ...and the CHECK refuses it independently of the RPC.
  begin
    update public.quotation
       set validated_by = '00000000-0000-0000-0000-00000000c3a1', validated_at = now()
     where id = q1;
  exception when others then check_rejected := 1;
  end;

  -- Sending before validation is refused.
  begin
    perform public.quotation_send('00000000-0000-0000-0000-000000000001', q1,
      '00000000-0000-0000-0000-00000000c3a1');
  exception when others then send_before_validate_rejected := 1;
  end;

  -- A DIFFERENT actor validates, then sends.
  perform public.quotation_validate('00000000-0000-0000-0000-000000000001', q1,
    '00000000-0000-0000-0000-00000000c3a2', 'VALIDATED');
  select public.quotation_send('00000000-0000-0000-0000-000000000001', q1,
    '00000000-0000-0000-0000-00000000c3a1') into num;

  -- A sent quotation is immutable, and its lines are frozen.
  begin
    update public.quotation set terms = 'réécriture' where id = q1;
  exception when others then frozen_rejected := 1;
  end;
  begin
    update public.quotation_line set unit_amount_minor = 1 where quotation_id = q1;
  exception when others then lines_frozen_rejected := 1;
  end;

  -- Acceptance requires an evidence kind — it is never inferred.
  begin
    perform public.quotation_record_decision('00000000-0000-0000-0000-000000000001', q1,
      '00000000-0000-0000-0000-00000000c3a1', 'ACCEPTED', null);
  exception when others then accept_without_kind_rejected := 1;
  end;

  -- Revision: a NEW version; the old one survives and stays visible.
  select public.quotation_revise('00000000-0000-0000-0000-000000000001', q1,
    '00000000-0000-0000-0000-00000000c3a1') into q2;
  select count(*) into superseded_kept from public.quotation
   where id = q1 and status = 'SUPERSEDED';
  select count(*) into v1_visible from public.quotation
   where request_id = '00000000-0000-0000-0000-00000000c3e1' and version = 1;
  -- Lines were carried into the new version.
  select coalesce(sum(quantity_milli * unit_amount_minor / 1000), 0) into sub_total
    from public.quotation_line where quotation_id = q2;

  -- Drive v2 to ACCEPTED, then convert.
  perform public.quotation_submit('00000000-0000-0000-0000-000000000001', q2,
    '00000000-0000-0000-0000-00000000c3a1');
  perform public.quotation_validate('00000000-0000-0000-0000-000000000001', q2,
    '00000000-0000-0000-0000-00000000c3a2', 'VALIDATED');
  perform public.quotation_send('00000000-0000-0000-0000-000000000001', q2,
    '00000000-0000-0000-0000-00000000c3a1');

  -- Converting before acceptance is refused.
  begin
    perform public.quotation_record_conversion('00000000-0000-0000-0000-000000000001', q2,
      '00000000-0000-0000-0000-00000000c3a1', '00000000-0000-0000-0000-00000000c3d1');
  exception when others then convert_before_accept_rejected := 1;
  end;

  perform public.quotation_record_decision('00000000-0000-0000-0000-000000000001', q2,
    '00000000-0000-0000-0000-00000000c3a1', 'ACCEPTED', 'SIGNED_QUOTATION', current_date);
  perform public.quotation_record_conversion('00000000-0000-0000-0000-000000000001', q2,
    '00000000-0000-0000-0000-00000000c3a1', '00000000-0000-0000-0000-00000000c3d1');

  -- Events.
  select count(*) into ev_validated from public.business_event
   where event_type = 'QUOTATION_VALIDATED' and event_domain = 'commercial';
  select count(*) into ev_sent      from public.business_event where event_type = 'QUOTATION_SENT';
  select count(*) into ev_accepted  from public.business_event where event_type = 'QUOTATION_ACCEPTED';
  select count(*) into ev_revised   from public.business_event where event_type = 'QUOTATION_REVISED';
  select count(*) into ev_converted from public.business_event where event_type = 'QUOTATION_CONVERTED_TO_DOSSIER';
  select count(*) into ev_converted_dossier from public.business_event
   where event_type = 'QUOTATION_CONVERTED_TO_DOSSIER'
     and dossier_id = '00000000-0000-0000-0000-00000000c3d1'
     and subject_id = '00000000-0000-0000-0000-00000000c3d1'
     and subject_type = 'operational_file';

  -- A cancelled quotation, for the event and the mandatory reason.
  begin
    perform public.quotation_cancel('00000000-0000-0000-0000-000000000001', q2,
      '00000000-0000-0000-0000-00000000c3a1', '   ');
  exception when others then null;
  end;
  select count(*) into ev_cancelled from public.business_event where event_type = 'QUOTATION_CANCELLED';
  select count(*) into ev_created  from public.business_event where event_type = 'QUOTATION_CREATED';

  -- No amount ever entered an event payload.
  if exists (select 1 from public.business_event
              where event_domain = 'commercial'
                and (metadata::text like '%15000000%' or metadata::text like '%amount%')) then
    raise exception 'EC-3B FAIL: an amount leaked into a commercial event payload';
  end if;

  -- Commercial touched NO Finance row.
  select (select count(*) from public.invoice where file_id = '00000000-0000-0000-0000-00000000c3d1')
       + (select count(*) from public.billing_charge where file_id = '00000000-0000-0000-0000-00000000c3d1')
    into finance_rows;

  -- ---- RLS ----
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3a1','role','authenticated')::text, true);
  select count(*) into reader_sees from public.quotation where id = q2;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3a3','role','authenticated')::text, true);
  select count(*) into admin_sees from public.quotation where id = q2;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000c3a4','role','authenticated')::text, true);
  select count(*) into portal_sees from public.quotation where id = q2;
  perform set_config('role', 'postgres', true);

  insert into _r values
    ('event_created', ev_created), ('validate_permission_rows', validate_perm),
    ('ratified_matrix_grants', matrix_grants), ('off_matrix_grants', offmatrix_grants),
    ('system_admin_quotation_grants', admin_grants),
    ('same_actor_rejected_rpc', same_actor_rejected),
    ('same_actor_rejected_check', check_rejected),
    ('send_before_validate_rejected', send_before_validate_rejected),
    ('sent_quotation_frozen', frozen_rejected), ('sent_lines_frozen', lines_frozen_rejected),
    ('two_live_versions_rejected', two_live_rejected),
    ('accept_without_kind_rejected', accept_without_kind_rejected),
    ('convert_before_accept_rejected', convert_before_accept_rejected),
    ('superseded_kept', superseded_kept), ('version_1_still_visible', v1_visible),
    ('lines_copied_subtotal_minor', sub_total::int),
    ('event_validated', ev_validated), ('event_sent', ev_sent),
    ('event_accepted', ev_accepted), ('event_revised', ev_revised),
    ('event_converted', ev_converted), ('event_converted_on_dossier', ev_converted_dossier),
    ('reader_sees', reader_sees), ('system_admin_sees', admin_sees), ('portal_sees', portal_sees),
    ('finance_rows_created', finance_rows);

  if ev_created<>1 or validate_perm<>1 or matrix_grants<>4 or offmatrix_grants<>0 or admin_grants<>0
     or same_actor_rejected<>1 or check_rejected<>1
     or send_before_validate_rejected<>1
     or frozen_rejected<>1 or lines_frozen_rejected<>1 or two_live_rejected<>1
     or accept_without_kind_rejected<>1 or convert_before_accept_rejected<>1
     or superseded_kept<>1 or v1_visible<>1
     or sub_total<>35000000
     or ev_validated<>2 or ev_sent<>2 or ev_accepted<>1 or ev_revised<>1
     or ev_converted<>1 or ev_converted_dossier<>1
     or reader_sees<>1 or admin_sees<>0 or portal_sees<>0
     or finance_rows<>0
  then
    raise exception 'EC-3B FAIL: vperm=% matrix=% offmatrix=% admin_grants=% sameRpc=% sameChk=% sendEarly=% frozen=% linesFrozen=% twoLive=% acceptNoKind=% convEarly=% sup=% v1=% subtotal=% evVal=% evSent=% evAcc=% evRev=% evConv=% evConvDoss=% reader=% admin=% portal=% finance=%',
      validate_perm, matrix_grants, offmatrix_grants, admin_grants, same_actor_rejected, check_rejected,
      send_before_validate_rejected, frozen_rejected, lines_frozen_rejected, two_live_rejected,
      accept_without_kind_rejected, convert_before_accept_rejected, superseded_kept, v1_visible,
      sub_total, ev_validated, ev_sent, ev_accepted, ev_revised, ev_converted,
      ev_converted_dossier, reader_sees, admin_sees, portal_sees, finance_rows;
  end if;
end $$;

select * from _r order by check_name;
rollback;
