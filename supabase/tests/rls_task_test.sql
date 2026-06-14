-- RLS regression test — Tasks (Phase 1.3). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves for task:
--   * a tenant-A user WITH task:read reads tenant A's own tasks      -> 1
--   * the same user CANNOT read tenant B's tasks (tenant isolation)   -> 0
--   * a tenant-A user WITHOUT task:read reads nothing                 -> 0
--   * task follows the operational_file tenant boundary
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- reader (SYSTEM_ADMIN -> task:read); plain (QUOTATION_MANAGER -> no task perms).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'reader@test.local'),
  ('00000000-0000-0000-0000-000000000a02', 'plain@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000001', 'reader@test.local'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000001', 'plain@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-000000000a01', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-000000000a02', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;

-- A client + file + task in each tenant (tasks require a file).
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000a1a00', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-0000000a1b00', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000fa100', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-91001', 'IMP', '00000000-0000-0000-0000-0000000a1a00'),
  ('00000000-0000-0000-0000-0000000fb100', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-91002', 'IMP', '00000000-0000-0000-0000-0000000a1b00')
on conflict (id) do nothing;

insert into public.task (id, tenant_id, file_id, title) values
  ('00000000-0000-0000-0000-00000000aa10', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa100', 'Task A'),
  ('00000000-0000-0000-0000-00000000ab10', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000fb100', 'Task B')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  reader_own int; reader_b int; plain_own int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000a01','role','authenticated')::text, true);
  select count(*) into reader_own from public.task where id='00000000-0000-0000-0000-00000000aa10';
  select count(*) into reader_b   from public.task where id='00000000-0000-0000-0000-00000000ab10';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000a02','role','authenticated')::text, true);
  select count(*) into plain_own from public.task where id='00000000-0000-0000-0000-00000000aa10';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('reader_sees_own_task',     reader_own),
    ('reader_sees_tenantB_task', reader_b),
    ('plain_sees_own_task',      plain_own);

  if reader_own <> 1 or reader_b <> 0 or plain_own <> 0 then
    raise exception 'RLS TASK FAIL: own=%, tenantB=%, plain=% (expected 1/0/0)', reader_own, reader_b, plain_own;
  end if;
end $$;

select * from _r order by check_name;
rollback;
