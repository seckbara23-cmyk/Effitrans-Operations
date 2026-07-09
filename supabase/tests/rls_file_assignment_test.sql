-- RLS regression test — Assignment-based visibility (Phase 3.2A). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves that assigning a dossier to a staff member grants that user READ
-- visibility of it through user_readable_file_ids, WITHOUT any other tie:
--   * U4 (DOCUMENTATION_OFFICER — plain file:read, NOT file:read:all, and not
--     account_manager / coordinator / created_by / task-assignee of any file)
--     sees ONLY the dossier assigned to them (fileA), never the unrelated one
--     (fileB).
-- This is the additive widening in the 20260709000001 migration; the isolation
-- guarantees from rls_visibility_test.sql are unchanged.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- U4: a scoped execution role (file:read only) with no ownership tie to a file.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'assignee@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000001', 'assignee@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a4', r.id, r.tenant_id
from public.role r
where r.code = 'DOCUMENTATION_OFFICER' and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000001', 'Client Assign')
on conflict (id) do nothing;

-- fileA: assigned to U4 (no account_manager / coordinator / created_by).
-- fileB: unrelated, unassigned.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, assigned_to_user_id) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96002', 'IMP', '00000000-0000-0000-0000-0000000000ca', null)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  u4_fa int; u4_fb int;
begin
  perform set_config('role', 'authenticated', true);

  -- U4 assignee: sees the assigned dossier only.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
  select count(*) into u4_fa from public.operational_file where id='00000000-0000-0000-0000-00000000fa01';
  select count(*) into u4_fb from public.operational_file where id='00000000-0000-0000-0000-00000000fa02';

  perform set_config('role', 'postgres', true);
  insert into _r values ('assignee_fileA', u4_fa), ('assignee_fileB', u4_fb);

  if u4_fa <> 1 or u4_fb <> 0 then
    raise exception 'RLS ASSIGNMENT FAIL: assignee(fileA=% fileB=%) — expected (1, 0)', u4_fa, u4_fb;
  end if;
end $$;

select * from _r order by check_name;
rollback;
