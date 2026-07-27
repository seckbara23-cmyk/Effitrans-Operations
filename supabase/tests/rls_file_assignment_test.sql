-- RLS regression test — Assignment-based visibility. Non-destructive.
-- ---------------------------------------------------------------------------
-- ORIGINALLY (Phase 3.2A) this suite proved that setting
-- `operational_file.assigned_to_user_id` granted a user READ visibility of that
-- dossier with no other tie.
--
-- WES-3F RETIRED THAT SEMANTIC, so the suite now proves the opposite, plus what
-- replaced it. The legacy column was one of only two non-owner routes into
-- `user_readable_file_ids`, which is precisely why reassigning a dossier made it
-- disappear for the person who had been working it. Work assignment still grants
-- visibility — but through a TASK (or a step, or ownership), which is the thing
-- that actually represents work.
--
--   * U4 holds ONLY `assigned_to_user_id` on fileA          -> 0  (retired)
--   * fileB is unrelated                                     -> 0  (unchanged)
--   * U4 is assigned a TASK on fileC                         -> 1  (replacement)
--
-- The isolation guarantees in rls_visibility_test.sql are unchanged.
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

-- fileA: legacy assigned_to_user_id ONLY (no account_manager / coordinator /
--        created_by / task) — the retired route.
-- fileB: unrelated, unassigned.
-- fileC: no legacy column at all; U4 holds an assigned TASK — the replacement.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, assigned_to_user_id) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96002', 'IMP', '00000000-0000-0000-0000-0000000000ca', null),
  ('00000000-0000-0000-0000-00000000fa03', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96003', 'IMP', '00000000-0000-0000-0000-0000000000ca', null)
on conflict (id) do nothing;

insert into public.task (id, tenant_id, file_id, title, status, assigned_to) values
  ('00000000-0000-0000-0000-00000000fa13', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fa03', 'Work on fileC', 'TODO',
   '00000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  u4_fa int; u4_fb int; u4_fc int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
  select count(*) into u4_fa from public.operational_file where id='00000000-0000-0000-0000-00000000fa01';
  select count(*) into u4_fb from public.operational_file where id='00000000-0000-0000-0000-00000000fa02';
  select count(*) into u4_fc from public.operational_file where id='00000000-0000-0000-0000-00000000fa03';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('legacy_column_alone_grants_nothing', u4_fa),
    ('unrelated_dossier', u4_fb),
    ('task_assignment_grants_visibility', u4_fc);

  if u4_fa <> 0 or u4_fb <> 0 or u4_fc <> 1 then
    raise exception
      'RLS ASSIGNMENT FAIL: legacy(fileA=%) unrelated(fileB=%) task(fileC=%) — expected (0, 0, 1)',
      u4_fa, u4_fb, u4_fc;
  end if;
end $$;

select * from _r order by check_name;
rollback;
