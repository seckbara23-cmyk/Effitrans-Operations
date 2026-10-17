-- RLS + publication-gate regression test — Customs Reference Library
-- (CUSTOMS-REF-01A / REF-1 and REF-1-PUBLISH-GATE). Non-destructive
-- (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS. REF-1 shipped with its RLS policy asserted only by
-- SHAPE: the migration verifier reads pg_policy and confirms the policy is
-- SELECT-only, tenant-scoped and names both permissions. That proves it is
-- PRESENT. It does not prove it REFUSES. Every other module in this job has a
-- test that drives real authenticated identities through its policy.
--
-- REF-1-PUBLISH-GATE then added the control this file matters most for: only a
-- trusted recorder may record a CLEAN malware verdict. That claim cannot be
-- tested from the application at all, because every application write uses the
-- service role. The probes in part C run as `postgres` — strictly MORE
-- privileged than the service role and entirely past RLS — and still must fail.
--
-- WHAT IT PROVES
--   A. visibility: reader vs publisher vs no-permission vs another tenant
--   B. the write boundary: SELECT is the only privilege granted
--   C. the scan trust boundary, the binding, and rescan invalidation
--   D. scan evidence is visible to publishers only
--
-- THE FIXTURES CANNOT CHEAT THE GATE. A PUBLISHED row now requires a CLEAN
-- scan bound to its own bytes AND two distinct actors, so the published
-- fixtures are built the only way the schema allows: inserted QUARANTINE with a
-- submitter, cleared through `record_customs_reference_scan`, then approved by
-- a different person. If any of those controls were dropped, building the
-- fixture would be the thing that breaks.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- A second tenant, with a role inside it that genuinely HOLDS the library
-- permissions. Without the grant, a foreign refusal would be a permission
-- failure wearing a tenancy costume.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b8', 'Test Tenant Ref-B', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
values
  ('00000000-0000-0000-0000-0000000000b8', 'CUSTOMS_DECLARANT',
   'Déclarant en douane', 'Customs Declarant', true),
  ('00000000-0000-0000-0000-0000000000b8', 'CHIEF_OF_TRANSIT',
   'Chef de transit', 'Chief of Transit', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:reference:read'
where r.tenant_id = '00000000-0000-0000-0000-0000000000b8'
  and r.code in ('CUSTOMS_DECLARANT', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:reference:publish'
where r.tenant_id = '00000000-0000-0000-0000-0000000000b8'
  and r.code = 'CHIEF_OF_TRANSIT'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000cfa1', 'refrdr@test.local'),
  ('00000000-0000-0000-0000-00000000cfa2', 'refpub@test.local'),
  ('00000000-0000-0000-0000-00000000cfa3', 'refnone@test.local'),
  ('00000000-0000-0000-0000-00000000cfa4', 'refpub2@test.local'),
  ('00000000-0000-0000-0000-00000000cfb1', 'reffrn@test.local'),
  ('00000000-0000-0000-0000-00000000cfb2', 'reffrnpub@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000cfa1', '00000000-0000-0000-0000-000000000001', 'refrdr@test.local'),
  ('00000000-0000-0000-0000-00000000cfa2', '00000000-0000-0000-0000-000000000001', 'refpub@test.local'),
  ('00000000-0000-0000-0000-00000000cfa3', '00000000-0000-0000-0000-000000000001', 'refnone@test.local'),
  ('00000000-0000-0000-0000-00000000cfa4', '00000000-0000-0000-0000-000000000001', 'refpub2@test.local'),
  ('00000000-0000-0000-0000-00000000cfb1', '00000000-0000-0000-0000-0000000000b8', 'reffrn@test.local'),
  ('00000000-0000-0000-0000-00000000cfb2', '00000000-0000-0000-0000-0000000000b8', 'reffrnpub@test.local')
on conflict (id) do nothing;

-- CUSTOMS_DECLARANT holds read only; CHIEF_OF_TRANSIT holds read AND publish;
-- QUOTATION_MANAGER holds neither. All from seed.sql's real grants — the
-- permissions are never stubbed here.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000cfa1'::uuid, 'CUSTOMS_DECLARANT', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfa2'::uuid, 'CHIEF_OF_TRANSIT',  '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfa3'::uuid, 'QUOTATION_MANAGER', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfa4'::uuid, 'CHIEF_OF_TRANSIT',  '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfb1'::uuid, 'CUSTOMS_DECLARANT', '00000000-0000-0000-0000-0000000000b8'::uuid),
  ('00000000-0000-0000-0000-00000000cfb2'::uuid, 'CHIEF_OF_TRANSIT',  '00000000-0000-0000-0000-0000000000b8'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

-- Three documents, all QUARANTINE at birth because that is the only state the
-- schema admits. cfd1 and cfd3 carry a SUBMITTER; cfd2 deliberately does not.
insert into public.customs_reference_document
  (id, tenant_id, category, title, source_authority, reference_code,
   storage_path, mime_type, size_bytes, content_sha256,
   licence_status, provenance_verified, legal_version_verified,
   uploaded_by, submitted_for_publication_by, submitted_for_publication_at)
values
  ('00000000-0000-0000-0000-00000000cfd1', '00000000-0000-0000-0000-000000000001',
   'LEGISLATION', 'Code des douanes (à publier)', 'DGD', 'RLS-PUB',
   '00000000-0000-0000-0000-000000000001/cfd1.pdf', 'application/pdf', 4096, repeat('a', 64),
   'INTERNAL_ONLY', true, true,
   '00000000-0000-0000-0000-00000000cfa2', '00000000-0000-0000-0000-00000000cfa4', now()),
  ('00000000-0000-0000-0000-00000000cfd2', '00000000-0000-0000-0000-000000000001',
   'CIRCULAR', 'Circulaire en quarantaine', 'DGD', 'RLS-QUAR',
   '00000000-0000-0000-0000-000000000001/cfd2.pdf', 'application/pdf', 4096, repeat('b', 64),
   'RESTRICTED', false, false,
   '00000000-0000-0000-0000-00000000cfa2', null, null),
  ('00000000-0000-0000-0000-00000000cfd3', '00000000-0000-0000-0000-0000000000b8',
   'LEGISLATION', 'Texte d''un autre tenant', 'Autre administration', 'RLS-FRN',
   '00000000-0000-0000-0000-0000000000b8/cfd3.pdf', 'application/pdf', 4096, repeat('c', 64),
   'INTERNAL_ONLY', true, true,
   '00000000-0000-0000-0000-00000000cfb2', '00000000-0000-0000-0000-00000000cfb2', now())
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

-- Clear and publish the two that need to be PUBLISHED for part A. The scan can
-- only be recorded through the trusted function, and the approver must differ
-- from the submitter — so this fixture setup is itself a proof that both
-- controls work in the permissive direction.
do $$
begin
  perform public.record_customs_reference_scan(
    '00000000-0000-0000-0000-00000000cfd1', '00000000-0000-0000-0000-000000000001',
    'CLEAN', repeat('a', 64), '00000000-0000-0000-0000-000000000001/cfd1.pdf',
    'fixture-scanner', '1.0', 'fx-1', null);
  perform public.record_customs_reference_scan(
    '00000000-0000-0000-0000-00000000cfd3', '00000000-0000-0000-0000-0000000000b8',
    'CLEAN', repeat('c', 64), '00000000-0000-0000-0000-0000000000b8/cfd3.pdf',
    'fixture-scanner', '1.0', 'fx-3', null);

  update public.customs_reference_document
     set status = 'PUBLISHED', published_by = '00000000-0000-0000-0000-00000000cfa2', published_at = now()
   where id = '00000000-0000-0000-0000-00000000cfd1';
  update public.customs_reference_document
     set status = 'PUBLISHED', published_by = '00000000-0000-0000-0000-00000000cfb1', published_at = now()
   where id = '00000000-0000-0000-0000-00000000cfd3';
end $$;

-- ===========================================================================
-- A. VISIBILITY
-- ===========================================================================
do $$
declare
  reader_published int; reader_quarantine int; reader_foreign int;
  publisher_published int; publisher_quarantine int;
  noperm_published int; foreign_published int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa1','role','authenticated')::text, true);
  select count(*) into reader_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';
  select count(*) into reader_quarantine
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd2';
  select count(*) into reader_foreign
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd3';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa2','role','authenticated')::text, true);
  select count(*) into publisher_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';
  select count(*) into publisher_quarantine
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd2';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa3','role','authenticated')::text, true);
  select count(*) into noperm_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfb1','role','authenticated')::text, true);
  select count(*) into foreign_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('reader_published', reader_published),
    ('reader_quarantine', reader_quarantine),
    ('reader_foreign', reader_foreign),
    ('publisher_published', publisher_published),
    ('publisher_quarantine', publisher_quarantine),
    ('noperm_published', noperm_published),
    ('foreign_published', foreign_published);

  if reader_published <> 1 or reader_quarantine <> 0 or reader_foreign <> 0
     or publisher_published <> 1 or publisher_quarantine <> 1
     or noperm_published <> 0 or foreign_published <> 0 then
    raise exception
      'RLS CUSTOMS REFERENCE FAIL: reader(pub=% quar=% frn=%) publisher(pub=% quar=%) noperm(pub=%) foreign(pub=%)',
      reader_published, reader_quarantine, reader_foreign,
      publisher_published, publisher_quarantine, noperm_published, foreign_published;
  end if;
end $$;

-- ===========================================================================
-- B. THE WRITE BOUNDARY. SELECT is the only privilege granted, so even the
-- publisher — the one identity that may publish through the application —
-- cannot move a row from the client.
-- ===========================================================================
do $$
declare
  pub_blocked boolean := false; pub_affected int := 0;
  frn_blocked boolean := false; frn_affected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa2','role','authenticated')::text, true);
  begin
    update public.customs_reference_document
       set status = 'PUBLISHED'
     where id = '00000000-0000-0000-0000-00000000cfd2';
    get diagnostics pub_affected = row_count;
  exception when others then
    pub_blocked := true;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfb1','role','authenticated')::text, true);
  begin
    update public.customs_reference_document
       set title = 'pirated'
     where id = '00000000-0000-0000-0000-00000000cfd1';
    get diagnostics frn_affected = row_count;
  exception when others then
    frn_blocked := true;
  end;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('publisher_write_blocked', case when pub_blocked or pub_affected = 0 then 1 else 0 end),
    ('foreign_write_blocked',   case when frn_blocked or frn_affected = 0 then 1 else 0 end);

  if not (pub_blocked or pub_affected = 0) then
    raise exception 'RLS CUSTOMS REFERENCE WRITE FAIL: publisher updated % row(s) from the client', pub_affected;
  end if;
  if not (frn_blocked or frn_affected = 0) then
    raise exception 'RLS CUSTOMS REFERENCE CROSS-TENANT WRITE FAIL: % row(s)', frn_affected;
  end if;

  if (select status from public.customs_reference_document
       where id = '00000000-0000-0000-0000-00000000cfd2') <> 'QUARANTINE' then
    raise exception 'RLS CUSTOMS REFERENCE FAIL: the quarantined document moved';
  end if;
end $$;

-- ===========================================================================
-- C. THE SCAN TRUST BOUNDARY — probed as `postgres`, past RLS entirely.
-- ===========================================================================
do $$
declare
  ordinary_blocked boolean := false;
  insert_blocked   boolean := false;
  rebind_blocked   boolean := false;
  recorder_ok      text;
  final_scan       text;
  final_status     text;
  wrong_bytes      text;
begin
  -- 1. An ordinary UPDATE to CLEAN is refused, even as postgres.
  begin
    update public.customs_reference_document
       set scan_status = 'CLEAN',
           scanned_sha256 = content_sha256,
           scanned_storage_path = storage_path,
           scan_completed_at = now(),
           scanner_name = 'pretend'
     where id = '00000000-0000-0000-0000-00000000cfd2';
  exception when others then
    ordinary_blocked := true;
  end;

  -- 2. Nor can a row be born CLEAN.
  begin
    insert into public.customs_reference_document
      (id, tenant_id, category, title, source_authority, reference_code,
       storage_path, mime_type, size_bytes, content_sha256,
       scan_status, scanned_sha256, scanned_storage_path, scan_completed_at,
       scanner_name, uploaded_by)
    values
      ('00000000-0000-0000-0000-00000000cfd9', '00000000-0000-0000-0000-000000000001',
       'CIRCULAR', 'Né propre', 'DGD', 'RLS-BORN-CLEAN',
       '00000000-0000-0000-0000-000000000001/cfd9.pdf', 'application/pdf', 4096, repeat('9', 64),
       'CLEAN', repeat('9', 64), '00000000-0000-0000-0000-000000000001/cfd9.pdf', now(),
       'pretend', '00000000-0000-0000-0000-00000000cfa2');
  exception when others then
    insert_blocked := true;
  end;

  -- 3. A verdict about the WRONG bytes is refused by the recorder itself.
  select public.record_customs_reference_scan(
           '00000000-0000-0000-0000-00000000cfd2', '00000000-0000-0000-0000-000000000001',
           'CLEAN', repeat('f', 64), 'wrong/path', 'rls-probe-scanner', null, null, null)
    into wrong_bytes;

  -- 4. The trusted recorder can, about the right ones.
  select public.record_customs_reference_scan(
           '00000000-0000-0000-0000-00000000cfd2', '00000000-0000-0000-0000-000000000001',
           'CLEAN', repeat('b', 64), '00000000-0000-0000-0000-000000000001/cfd2.pdf',
           'rls-probe-scanner', '1.0', 'ref-1', null)
    into recorder_ok;
  select scan_status into final_scan
    from public.customs_reference_document where id = '00000000-0000-0000-0000-00000000cfd2';

  -- 5. And a clearance cannot be re-pointed at different bytes afterwards.
  begin
    update public.customs_reference_document
       set scanned_sha256 = repeat('7', 64)
     where id = '00000000-0000-0000-0000-00000000cfd2';
  exception when others then
    rebind_blocked := true;
  end;

  -- 6. A rescan that turns INFECTED retires the PUBLISHED document.
  perform public.record_customs_reference_scan(
    '00000000-0000-0000-0000-00000000cfd1', '00000000-0000-0000-0000-000000000001',
    'INFECTED', repeat('a', 64), '00000000-0000-0000-0000-000000000001/cfd1.pdf',
    'rls-probe-scanner', null, null, 'eicar');
  select status into final_status
    from public.customs_reference_document where id = '00000000-0000-0000-0000-00000000cfd1';

  insert into _r values
    ('ordinary_clean_write_blocked',  case when ordinary_blocked then 1 else 0 end),
    ('born_clean_insert_blocked',     case when insert_blocked then 1 else 0 end),
    ('recorder_rejects_wrong_bytes',  case when wrong_bytes = 'binding_mismatch' then 1 else 0 end),
    ('recorder_records_clean',        case when recorder_ok = 'clean' then 1 else 0 end),
    ('document_is_clean',             case when final_scan = 'CLEAN' then 1 else 0 end),
    ('clearance_rebind_blocked',      case when rebind_blocked then 1 else 0 end),
    ('infected_rescan_withdrew',      case when final_status = 'WITHDRAWN' then 1 else 0 end);

  if not ordinary_blocked then
    raise exception 'SCAN GATE FAIL: an ordinary UPDATE manufactured a CLEAN verdict';
  end if;
  if not insert_blocked then
    raise exception 'SCAN GATE FAIL: a row was inserted already CLEAN';
  end if;
  if wrong_bytes is distinct from 'binding_mismatch' then
    raise exception 'SCAN GATE FAIL: a verdict about other bytes was accepted (%)', wrong_bytes;
  end if;
  if recorder_ok is distinct from 'clean' or final_scan is distinct from 'CLEAN' then
    raise exception 'SCAN GATE FAIL: the trusted recorder could not record CLEAN (got %, status %)',
      recorder_ok, final_scan;
  end if;
  if not rebind_blocked then
    raise exception 'SCAN GATE FAIL: a recorded clearance was re-pointed at other bytes';
  end if;
  if final_status is distinct from 'WITHDRAWN' then
    raise exception 'SCAN GATE FAIL: an INFECTED rescan left the document published (status %)', final_status;
  end if;
end $$;

-- ===========================================================================
-- D. Scan evidence is visible to publishers only.
-- ===========================================================================
do $$
declare reader_sees int; publisher_sees int; foreign_sees int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa1','role','authenticated')::text, true);
  select count(*) into reader_sees from public.customs_reference_scan;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa2','role','authenticated')::text, true);
  select count(*) into publisher_sees from public.customs_reference_scan;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfb1','role','authenticated')::text, true);
  select count(*) into foreign_sees from public.customs_reference_scan;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('scan_evidence_reader_sees',    reader_sees),
    ('scan_evidence_publisher_sees', publisher_sees),
    ('scan_evidence_foreign_sees',   foreign_sees);

  -- A reader holds `read` but not `publish`, so scan evidence is not theirs.
  -- The foreign reader holds neither in tenant A's rows.
  if reader_sees <> 0 or publisher_sees < 1 or foreign_sees <> 0 then
    raise exception 'SCAN EVIDENCE RLS FAIL: reader=% publisher=% foreign=%',
      reader_sees, publisher_sees, foreign_sees;
  end if;
end $$;

-- ===========================================================================
-- PART 5 — REF-2: the regime axis normalises itself, and grants nothing.
-- ===========================================================================
-- WHY THIS IS HERE AND NOT ONLY IN THE VERIFIER. The verifier asserts that the
-- trigger EXISTS, is security-invoker and watches the right column. It cannot
-- assert that the trigger WORKS: that needs a write. These checks perform the
-- writes, so a normaliser that was present but wrong would be caught here
-- rather than by an operator wondering why 'transit' does not match 'TRANSIT'.
do $$
declare
  normalised   text[];
  bounded      boolean := false;
  over_long    boolean := false;
  reader_writes int;
begin
  perform set_config('role', 'postgres', true);

  -- Trim, upper-case, de-duplicate, sort, and drop blanks and NULLs in one go.
  update public.customs_reference_document
     set customs_regimes = array[' transit ', 'MISE EN CONSOMMATION', 'Transit', '', null]
   where id = '00000000-0000-0000-0000-00000000cfd1';

  select customs_regimes into normalised
    from public.customs_reference_document
   where id = '00000000-0000-0000-0000-00000000cfd1';

  if normalised is distinct from array['MISE EN CONSOMMATION', 'TRANSIT'] then
    raise exception 'REGIME NORMALISE FAIL: got %', normalised;
  end if;

  -- An entry over 48 characters is REFUSED, not silently shortened: a row
  -- searchable under a name nobody typed is worse than a rejected write.
  begin
    update public.customs_reference_document
       set customs_regimes = array[repeat('x', 49)]
     where id = '00000000-0000-0000-0000-00000000cfd1';
  exception when others then
    over_long := true;
  end;

  -- And the array is bounded, so the GIN index cannot be used as a DoS surface.
  begin
    update public.customs_reference_document
       set customs_regimes = (select array_agg('R' || g::text) from generate_series(1, 25) g)
     where id = '00000000-0000-0000-0000-00000000cfd1';
  exception when others then
    bounded := true;
  end;

  -- The new column is NOT a new write path. A plain reader still cannot write
  -- this table, and adding a searchable column must not have changed that.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa1','role','authenticated')::text, true);
  begin
    update public.customs_reference_document
       set customs_regimes = array['FORGED']
     where id = '00000000-0000-0000-0000-00000000cfd1';
    reader_writes := 1;
  exception when others then
    reader_writes := 0;
  end;
  -- An UPDATE with no permitting policy affects zero rows rather than raising,
  -- so "no exception" is not success: the row must be UNCHANGED.
  perform set_config('role', 'postgres', true);
  if exists (
    select 1 from public.customs_reference_document
     where id = '00000000-0000-0000-0000-00000000cfd1'
       and customs_regimes @> array['FORGED']
  ) then
    reader_writes := 1;
  else
    reader_writes := 0;
  end if;

  insert into _r values
    ('regime_normalised',            case when normalised = array['MISE EN CONSOMMATION','TRANSIT'] then 1 else 0 end),
    ('regime_over_long_refused',     case when over_long then 1 else 0 end),
    ('regime_cardinality_bounded',   case when bounded then 1 else 0 end),
    ('regime_reader_write_blocked',  case when reader_writes = 0 then 1 else 0 end);

  if not over_long or not bounded or reader_writes <> 0 then
    raise exception 'REF-2 REGIME FAIL: over_long=% bounded=% reader_writes=%',
      over_long, bounded, reader_writes;
  end if;
end $$;

select check_name, value from _r order by check_name;

rollback;
