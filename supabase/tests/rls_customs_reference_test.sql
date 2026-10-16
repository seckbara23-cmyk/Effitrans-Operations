-- RLS regression test — Customs Reference Library (CUSTOMS-REF-01A / REF-1).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS. REF-1 shipped with its RLS policy asserted only by
-- SHAPE: the migration verifier reads pg_policy and confirms the policy is
-- SELECT-only, tenant-scoped and names both permissions. That proves the policy
-- is PRESENT. It does not prove it REFUSES. Every other module in this job has
-- a test that drives real authenticated identities through its policy, and the
-- library did not — the F1 finding of the REF-1 PR review.
--
-- WHAT IT PROVES, as five distinct questions:
--   reader_published     a holder of customs:reference:read sees a PUBLISHED row
--   reader_quarantine    …and CANNOT see a QUARANTINE one
--   publisher_quarantine a holder of customs:reference:publish CAN see it,
--                        because somebody has to look at an upload to judge it
--   noperm_published     a staff user holding NEITHER permission sees nothing
--   foreign_published    a holder of the permission IN ANOTHER TENANT sees
--                        nothing of tenant A's — the isolation case, and the
--                        reason the foreign user is granted the permission
--                        rather than left without it: a refusal caused by a
--                        missing grant would prove nothing about tenancy.
--
-- It also proves the WRITE boundary: the table grants SELECT only, so an
-- authenticated client cannot publish, withdraw or re-licence anything —
-- writes go exclusively through the permission-gated service role.
--
-- Expected: 1 / 0 / 1 / 1 / 0 / 0 / 0, then both write probes blocked.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- A second tenant, and a role inside it that genuinely HOLDS the library
-- permission. Without the grant, the foreign refusal would be a permission
-- failure wearing a tenancy costume.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b8', 'Test Tenant Ref-B', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
values ('00000000-0000-0000-0000-0000000000b8', 'CUSTOMS_DECLARANT',
        'Déclarant en douane', 'Customs Declarant', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:reference:read'
where r.tenant_id = '00000000-0000-0000-0000-0000000000b8'
  and r.code = 'CUSTOMS_DECLARANT'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000cfa1', 'refrdr@test.local'),
  ('00000000-0000-0000-0000-00000000cfa2', 'refpub@test.local'),
  ('00000000-0000-0000-0000-00000000cfa3', 'refnone@test.local'),
  ('00000000-0000-0000-0000-00000000cfb1', 'reffrn@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000cfa1', '00000000-0000-0000-0000-000000000001', 'refrdr@test.local'),
  ('00000000-0000-0000-0000-00000000cfa2', '00000000-0000-0000-0000-000000000001', 'refpub@test.local'),
  ('00000000-0000-0000-0000-00000000cfa3', '00000000-0000-0000-0000-000000000001', 'refnone@test.local'),
  ('00000000-0000-0000-0000-00000000cfb1', '00000000-0000-0000-0000-0000000000b8', 'reffrn@test.local')
on conflict (id) do nothing;

-- CUSTOMS_DECLARANT holds read only; CHIEF_OF_TRANSIT holds read AND publish;
-- QUOTATION_MANAGER holds neither. All three from seed.sql's real grants — the
-- permissions are never stubbed here.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000cfa1'::uuid, 'CUSTOMS_DECLARANT', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfa2'::uuid, 'CHIEF_OF_TRANSIT',  '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfa3'::uuid, 'QUOTATION_MANAGER', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000cfb1'::uuid, 'CUSTOMS_DECLARANT', '00000000-0000-0000-0000-0000000000b8'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

-- Three documents. The PUBLISHED ones must satisfy
-- customs_reference_published_is_verified, so they carry the publisher, the
-- moment, both verifications and a licence ruling — the fixture cannot cheat
-- the constraint the slice exists to enforce.
insert into public.customs_reference_document
  (id, tenant_id, category, title, source_authority, reference_code,
   storage_path, mime_type, size_bytes, content_sha256,
   status, licence_status, provenance_verified, legal_version_verified,
   uploaded_by, published_by, published_at)
values
  ('00000000-0000-0000-0000-00000000cfd1', '00000000-0000-0000-0000-000000000001',
   'LEGISLATION', 'Code des douanes (publié)', 'DGD', 'RLS-PUB',
   '00000000-0000-0000-0000-000000000001/cfd1.pdf', 'application/pdf', 4096, repeat('a', 64),
   'PUBLISHED', 'INTERNAL_ONLY', true, true,
   '00000000-0000-0000-0000-00000000cfa2', '00000000-0000-0000-0000-00000000cfa2', now()),
  ('00000000-0000-0000-0000-00000000cfd2', '00000000-0000-0000-0000-000000000001',
   'CIRCULAR', 'Circulaire en quarantaine', 'DGD', 'RLS-QUAR',
   '00000000-0000-0000-0000-000000000001/cfd2.pdf', 'application/pdf', 4096, repeat('b', 64),
   'QUARANTINE', 'RESTRICTED', false, false,
   '00000000-0000-0000-0000-00000000cfa2', null, null),
  ('00000000-0000-0000-0000-00000000cfd3', '00000000-0000-0000-0000-0000000000b8',
   'LEGISLATION', 'Texte d''un autre tenant', 'Autre administration', 'RLS-FRN',
   '00000000-0000-0000-0000-0000000000b8/cfd3.pdf', 'application/pdf', 4096, repeat('c', 64),
   'PUBLISHED', 'INTERNAL_ONLY', true, true,
   '00000000-0000-0000-0000-00000000cfb1', '00000000-0000-0000-0000-00000000cfb1', now())
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  reader_published int; reader_quarantine int; reader_foreign int;
  publisher_published int; publisher_quarantine int;
  noperm_published int; foreign_published int;
begin
  perform set_config('role', 'authenticated', true);

  -- A reader: PUBLISHED yes, QUARANTINE no, another tenant no.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa1','role','authenticated')::text, true);
  select count(*) into reader_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';
  select count(*) into reader_quarantine
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd2';
  select count(*) into reader_foreign
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd3';

  -- A publisher: both, because a quarantined upload has to be examinable.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa2','role','authenticated')::text, true);
  select count(*) into publisher_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';
  select count(*) into publisher_quarantine
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd2';

  -- Staff holding NEITHER permission: nothing, not even the published text.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000cfa3','role','authenticated')::text, true);
  select count(*) into noperm_published
    from public.customs_reference_document where id='00000000-0000-0000-0000-00000000cfd1';

  -- A holder of the permission in ANOTHER tenant: nothing of tenant A's.
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

-- The WRITE boundary. SELECT is the only privilege granted, so even the
-- publisher — the one identity that may publish through the application —
-- cannot move a row from the client. Publication is a service-role act behind a
-- permission check, and this is what makes that statement true rather than
-- merely intended.
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

  -- …and a cross-tenant write is refused for both reasons at once.
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

  -- The quarantined row must still be QUARANTINE after both attempts.
  if (select status from public.customs_reference_document
       where id = '00000000-0000-0000-0000-00000000cfd2') <> 'QUARANTINE' then
    raise exception 'RLS CUSTOMS REFERENCE FAIL: the quarantined document moved';
  end if;
end $$;

select check_name, value from _r order by check_name;

rollback;
