-- RLS/invariant regression test — UAT-2B official invoice artifact + charge uniqueness.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
--   CHARGE UNIQUENESS
--   * a second invoice_line on the SAME charge is refused                    -> raises
--   * a DIFFERENT charge on the same invoice is allowed                      -> 1
--   * deleting a DRAFT invoice releases its charge (intentional cascade)     -> rebillable
--   * a VOID invoice does NOT release its charge                             -> raises
--
--   OFFICIAL INVOICE ARTIFACT
--   * finalize creates exactly one artifact, VERIFIED, version 1             -> 1
--   * finalize is IDEMPOTENT: same document id returned, no second row       -> already=true
--   * a SECOND invoice on the same dossier gets its OWN artifact, and
--     NEITHER is superseded (the WES-4G trap this migration exists to avoid) -> 2 / 0
--   * an official artifact is IMMUTABLE: bytes, hash, status, supersession
--     and soft-delete all refused                                           -> raises
--   * an official artifact cannot be hard-deleted                            -> raises
--   * an ORDINARY document can still be deleted (trigger passes it through)  -> 0
--   * finalize refuses a blank hash and a blank invoice number               -> raises
--
--   ISOLATION
--   * tenant B cannot read tenant A's official invoice document              -> 0
--   * a portal user cannot read it through the document policy               -> 0
--
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000f2', 'Test Tenant INV', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'inv-a@test.local'),
  ('00000000-0000-0000-0000-0000000a0002', 'inv-b@test.local'),
  ('00000000-0000-0000-0000-0000000a0003', 'inv-p@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000001', 'inv-a@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000000f2', 'inv-b@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000a00c1', '00000000-0000-0000-0000-000000000001', 'INV Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000a00c1', 'inv-p@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  T   uuid := '00000000-0000-0000-0000-000000000001';
  U   uuid := '00000000-0000-0000-0000-0000000a0001';
  CL  uuid := '00000000-0000-0000-0000-0000000a00c1';
  v_file uuid := '00000000-0000-0000-0000-0000000a0f01';
  v_inv1 uuid := '00000000-0000-0000-0000-0000000a0101';
  v_inv2 uuid := '00000000-0000-0000-0000-0000000a0102';
  v_draft uuid := '00000000-0000-0000-0000-0000000a0103';
  v_void  uuid := '00000000-0000-0000-0000-0000000a0104';
  v_ch1 uuid := '00000000-0000-0000-0000-0000000a0201';
  v_ch2 uuid := '00000000-0000-0000-0000-0000000a0202';
  v_ch3 uuid := '00000000-0000-0000-0000-0000000a0203';
  v_ch4 uuid := '00000000-0000-0000-0000-0000000a0204';
  v_doc1 uuid := '00000000-0000-0000-0000-0000000a0301';
  v_doc2 uuid := '00000000-0000-0000-0000-0000000a0302';
  v_ordinary uuid := '00000000-0000-0000-0000-0000000a0303';
  dup_refused int := 0; other_charge_ok int := 0;
  draft_release_ok int := 0; void_release_refused int := 0;
  art_count int; art_ok int; again jsonb; art_after int;
  second_art int; superseded int;
  imm_path int := 0; imm_hash int := 0; imm_status int := 0; imm_del int := 0; imm_hard int := 0;
  ordinary_deleted int;
  blank_hash_refused int := 0; blank_num_refused int := 0;
  b_sees int; portal_sees int;
begin
  perform set_config('role', 'postgres', true);

  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
  values (v_file, T, 'INV-TEST-0001', 'IMP', CL, 'IN_PROGRESS');

  insert into public.billing_charge (id, tenant_id, file_id, description, quantity, unit_amount) values
    (v_ch1, T, v_file, 'Charge 1', 1, 750000),
    (v_ch2, T, v_file, 'Charge 2', 1, 100000),
    (v_ch3, T, v_file, 'Charge 3', 1,  50000),
    (v_ch4, T, v_file, 'Charge 4', 1,  25000);

  insert into public.invoice (id, tenant_id, file_id, client_id, status, invoice_number, currency, issue_date) values
    (v_inv1,  T, v_file, CL, 'ISSUED', 'EFT-INV-TEST-0001', 'XOF', current_date),
    (v_inv2,  T, v_file, CL, 'ISSUED', 'EFT-INV-TEST-0002', 'XOF', current_date),
    (v_draft, T, v_file, CL, 'DRAFT',  null,                'XOF', null),
    (v_void,  T, v_file, CL, 'VOID',   'EFT-INV-TEST-0003', 'XOF', current_date);

  -- ============================================ charge uniqueness
  insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
  values (T, v_inv1, v_ch1, 'Ligne 1', 1, 750000);

  begin
    -- the SAME charge on a different invoice must be refused
    insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
    values (T, v_inv2, v_ch1, 'Double facturation', 1, 750000);
  exception when unique_violation then dup_refused := 1;
  end;

  -- a different charge is fine
  insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
  values (T, v_inv1, v_ch2, 'Ligne 2', 1, 100000);
  select count(*) into other_charge_ok from public.invoice_line
   where invoice_id = v_inv1 and charge_id = v_ch2;

  -- DRAFT deletion releases the charge (intentional cascade)
  insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
  values (T, v_draft, v_ch3, 'Brouillon', 1, 50000);
  delete from public.invoice where id = v_draft;
  begin
    insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
    values (T, v_inv2, v_ch3, 'Rebilled after draft abandon', 1, 50000);
    draft_release_ok := 1;
  exception when others then draft_release_ok := 0;
  end;

  -- a VOID invoice does NOT release its charge
  insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
  values (T, v_void, v_ch4, 'Annulée', 1, 25000);
  begin
    insert into public.invoice_line (tenant_id, invoice_id, charge_id, description, quantity, unit_amount)
    values (T, v_inv2, v_ch4, 'Rebilled after void', 1, 25000);
  exception when unique_violation then void_release_refused := 1;
  end;

  -- ============================================ official artifact
  perform public.finalize_official_invoice(
    v_doc1, T, v_file, v_inv1, 'EFT-INV-TEST-0001',
    'tenant/file/invoices/one.pdf', 'hash-invoice-one',
    '{"invoiceNumber":"EFT-INV-TEST-0001"}'::jsonb, 'uat2b-1', U, 1234);

  select count(*) into art_count from public.document
   where invoice_id = v_inv1 and artifact_code = 'OFFICIAL_INVOICE';
  select count(*) into art_ok from public.document
   where id = v_doc1 and status = 'VERIFIED' and version = 1
     and content_sha256 = 'hash-invoice-one' and superseded_by_id is null;

  -- IDEMPOTENT: a retry returns the existing artifact, renders nothing new
  select public.finalize_official_invoice(
    '00000000-0000-0000-0000-0000000a03ff'::uuid, T, v_file, v_inv1, 'EFT-INV-TEST-0001',
    'tenant/file/invoices/one-again.pdf', 'hash-invoice-one-again',
    '{}'::jsonb, 'uat2b-1', U, 1234) into again;
  select count(*) into art_after from public.document
   where invoice_id = v_inv1 and artifact_code = 'OFFICIAL_INVOICE';

  -- A SECOND invoice on the SAME dossier gets its own artifact, and the first
  -- is NOT superseded. This is the WES-4G file-level supersession trap.
  perform public.finalize_official_invoice(
    v_doc2, T, v_file, v_inv2, 'EFT-INV-TEST-0002',
    'tenant/file/invoices/two.pdf', 'hash-invoice-two',
    '{}'::jsonb, 'uat2b-1', U, 999);
  select count(*) into second_art from public.document
   where file_id = v_file and artifact_code = 'OFFICIAL_INVOICE';
  select count(*) into superseded from public.document
   where artifact_code = 'OFFICIAL_INVOICE' and (superseded_by_id is not null or status = 'SUPERSEDED');

  -- blank hash / blank number refused
  begin
    perform public.finalize_official_invoice(
      gen_random_uuid(), T, v_file, v_void, 'EFT-INV-TEST-0003',
      'p.pdf', '   ', '{}'::jsonb, 'uat2b-1', U, 1);
  exception when others then blank_hash_refused := 1;
  end;
  begin
    perform public.finalize_official_invoice(
      gen_random_uuid(), T, v_file, v_void, '  ',
      'p.pdf', 'hash-x', '{}'::jsonb, 'uat2b-1', U, 1);
  exception when others then blank_num_refused := 1;
  end;

  -- ============================================ immutability
  begin update public.document set storage_path = 'tampered.pdf' where id = v_doc1;
  exception when others then imm_path := 1; end;
  begin update public.document set content_sha256 = 'tampered' where id = v_doc1;
  exception when others then imm_hash := 1; end;
  begin update public.document set status = 'REJECTED' where id = v_doc1;
  exception when others then imm_status := 1; end;
  begin update public.document set deleted_at = now() where id = v_doc1;
  exception when others then imm_del := 1; end;
  begin delete from public.document where id = v_doc1;
  exception when others then imm_hard := 1; end;

  -- an ORDINARY document must still delete normally (the trigger must pass
  -- non-invoice rows through with the right record on DELETE)
  insert into public.document (id, tenant_id, file_id, type_code, storage_path, uploaded_by, status)
  values (v_ordinary, T, v_file, 'DELIVERY_NOTE', 'ordinary.pdf', U, 'UPLOADED');
  delete from public.document where id = v_ordinary;
  select count(*) into ordinary_deleted from public.document where id = v_ordinary;

  -- ============================================ isolation
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000a0002','role','authenticated')::text, true);
  select count(*) into b_sees from public.document where id = v_doc1;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000a0003','role','authenticated')::text, true);
  select count(*) into portal_sees from public.document where id = v_doc1;
  perform set_config('role', 'postgres', true);

  raise notice 'UAT-2B: dup=% other=% draftRel=% voidRef=% art=% artOk=% again=% artAfter=% second=% sup=% immP=% immH=% immS=% immD=% immX=% ordDel=% blankH=% blankN=% b=% p=%',
    dup_refused, other_charge_ok, draft_release_ok, void_release_refused,
    art_count, art_ok, again->>'already', art_after, second_art, superseded,
    imm_path, imm_hash, imm_status, imm_del, imm_hard, ordinary_deleted,
    blank_hash_refused, blank_num_refused, b_sees, portal_sees;

  insert into _r values
    ('duplicate_charge_refused', dup_refused),
    ('other_charge_allowed', other_charge_ok),
    ('draft_deletion_releases_charge', draft_release_ok),
    ('void_does_not_release_charge', void_release_refused),
    ('one_artifact_created', art_count),
    ('artifact_verified_v1', art_ok),
    ('idempotent_no_second_row', art_after),
    ('second_invoice_own_artifact', second_art),
    ('no_cross_invoice_supersession', superseded),
    ('immutable_storage_path', imm_path),
    ('immutable_hash', imm_hash),
    ('immutable_status', imm_status),
    ('immutable_soft_delete', imm_del),
    ('immutable_hard_delete', imm_hard),
    ('ordinary_document_deletes', ordinary_deleted),
    ('blank_hash_refused', blank_hash_refused),
    ('blank_number_refused', blank_num_refused),
    ('cross_tenant_sees', b_sees),
    ('portal_sees', portal_sees);

  if dup_refused <> 1 or other_charge_ok <> 1 or draft_release_ok <> 1 or void_release_refused <> 1
     or art_count <> 1 or art_ok <> 1 or (again->>'already') is distinct from 'true'
     or art_after <> 1 or second_art <> 2 or superseded <> 0
     or imm_path <> 1 or imm_hash <> 1 or imm_status <> 1 or imm_del <> 1 or imm_hard <> 1
     or ordinary_deleted <> 0
     or blank_hash_refused <> 1 or blank_num_refused <> 1
     or b_sees <> 0 or portal_sees <> 0
  then
    raise exception 'RLS UAT-2B FAIL — see the NOTICE line above for every value';
  end if;
end $$;

select * from _r order by check_name;
rollback;
