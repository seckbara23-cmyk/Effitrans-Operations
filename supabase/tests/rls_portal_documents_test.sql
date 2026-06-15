-- RLS regression test — Portal Documents (Phase 1.12B). Non-destructive.
-- ---------------------------------------------------------------------------
-- A portal user sees a document ONLY when it is APPROVED + shared_with_client +
-- on their own client's dossier:
--   * approved + shared + own client    -> 1
--   * approved but NOT shared            -> 0
--   * shared but NOT approved            -> 0
--   * approved + shared, OTHER client    -> 0
--   * staff (document:read) unaffected   -> 1
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dstaff@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'dportal@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'dstaff@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000d1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1d1', '00000000-0000-0000-0000-000000000001', 'Client D1'),
  ('00000000-0000-0000-0000-00000000c1d2', '00000000-0000-0000-0000-000000000001', 'Client D2')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c1d1', 'dportal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fad1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-80001', 'IMP', '00000000-0000-0000-0000-00000000c1d1'),
  ('00000000-0000-0000-0000-00000000fad2', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-80002', 'IMP', '00000000-0000-0000-0000-00000000c1d2')
on conflict (id) do nothing;

insert into public.document (id, tenant_id, file_id, type_code, status, storage_path, shared_with_client) values
  ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fad1', 'OTHER', 'APPROVED', 't/x/d0c1.pdf', true),
  ('00000000-0000-0000-0000-00000000d0c2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fad1', 'OTHER', 'APPROVED', 't/x/d0c2.pdf', false),
  ('00000000-0000-0000-0000-00000000d0c3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fad1', 'OTHER', 'UPLOADED', 't/x/d0c3.pdf', true),
  ('00000000-0000-0000-0000-00000000d0c4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fad2', 'OTHER', 'APPROVED', 't/x/d0c4.pdf', true)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  p_shared int; p_notshared int; p_notapproved int; p_other int; staff_shared int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d2','role','authenticated')::text, true);
  select count(*) into p_shared      from public.document where id='00000000-0000-0000-0000-00000000d0c1';
  select count(*) into p_notshared   from public.document where id='00000000-0000-0000-0000-00000000d0c2';
  select count(*) into p_notapproved from public.document where id='00000000-0000-0000-0000-00000000d0c3';
  select count(*) into p_other       from public.document where id='00000000-0000-0000-0000-00000000d0c4';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  select count(*) into staff_shared from public.document where id='00000000-0000-0000-0000-00000000d0c1';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('portal_shared', p_shared), ('portal_not_shared', p_notshared),
    ('portal_not_approved', p_notapproved), ('portal_other_client', p_other),
    ('staff_unaffected', staff_shared);

  if p_shared<>1 or p_notshared<>0 or p_notapproved<>0 or p_other<>0 or staff_shared<>1 then
    raise exception 'RLS PORTAL DOC FAIL: shared=% notShared=% notApproved=% other=% staff=%',
      p_shared, p_notshared, p_notapproved, p_other, staff_shared;
  end if;
end $$;

select * from _r order by check_name;
rollback;
