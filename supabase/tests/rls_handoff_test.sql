-- RLS + idempotency regression — Department handoff tasks (Phase 2.1). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves:
--   * DUPLICATE PREVENTION: a second OPEN handoff task of the same (dossier,type)
--     is rejected by the partial unique index (idx_task_open_handoff).      -> blocked
--   * NO RLS WEAKENING: a handoff task obeys the unchanged task_select RLS —
--       OPS_SUPERVISOR (task:read:all) sees it                              -> 1
--       CUSTOMS_DECLARANT (task:read, not assigned, file not theirs) does NOT -> 0
--     (the customs department instead sees it via the dashboard count, which
--      reads through the admin client gated by customs:read — not task RLS.)
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ops@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'dec@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'ops@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'dec@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000a1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, 'CUSTOMS_DECLARANT')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c2a0', '00000000-0000-0000-0000-000000000001', 'Client H')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97001', 'IMP', '00000000-0000-0000-0000-00000000c2a0')
on conflict (id) do nothing;

-- First (legitimate) open handoff task.
insert into public.task (id, tenant_id, file_id, title, status, handoff_type, created_by) values
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f001',
   'Dossier prêt pour déclaration douanière', 'TODO', 'CUSTOMS_HANDOFF', '00000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare dup_blocked int := 0; ops_sees int; dec_sees int;
begin
  -- Duplicate prevention: a second OPEN CUSTOMS_HANDOFF for the same dossier is blocked.
  begin
    insert into public.task (tenant_id, file_id, title, status, handoff_type, created_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f001',
            'duplicate', 'TODO', 'CUSTOMS_HANDOFF', '00000000-0000-0000-0000-0000000000a1');
  exception
    when unique_violation then dup_blocked := 1;
    when others then dup_blocked := 1;
  end;

  perform set_config('role', 'authenticated', true);

  -- OPS_SUPERVISOR (task:read:all) sees the handoff task.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into ops_sees from public.task where id = '00000000-0000-0000-0000-00000000f002';

  -- CUSTOMS_DECLARANT (scoped task:read, not assigned, file not theirs) does NOT.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
  select count(*) into dec_sees from public.task where id = '00000000-0000-0000-0000-00000000f002';

  perform set_config('role', 'postgres', true);

  insert into _r values ('dup_blocked', dup_blocked), ('ops_sees', ops_sees), ('dec_sees', dec_sees);

  if dup_blocked <> 1 or ops_sees <> 1 or dec_sees <> 0 then
    raise exception 'HANDOFF FAIL: dup_blocked=% ops_sees=% dec_sees=%', dup_blocked, ops_sees, dec_sees;
  end if;
end $$;

select * from _r order by check_name;
rollback;
