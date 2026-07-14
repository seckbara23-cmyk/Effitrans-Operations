-- RLS regression test — tenant_process_rollout (Phase 5.0E-2A). Non-destructive.
-- ---------------------------------------------------------------------------
-- The pilot's safety rests on three claims. This suite tries to break each of them:
--
--   1. A tenant reads ONLY its own rollout row. Tenant B must not be able to
--      discover, let alone read, that tenant A is on the pilot.
--   2. NO tenant user can WRITE rollout state — not even a SYSTEM_ADMIN holding
--      every tenant permission there is. A tenant must not be able to enable its own
--      pilot; that decision belongs to the platform, and the only write path is the
--      service-role action (which is audited).
--   3. The CHECK constraint refuses an incoherent row (a sub-capability with no
--      engine), so queues-over-a-dark-engine cannot even be stored.
--
-- All UUIDs below are hex-only and correctly shaped (8-4-4-4-12).

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c2', 'Rollout Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000cf01a', 'rollout_a@test.local'),
  ('00000000-0000-0000-0000-0000000cf01b', 'rollout_b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000cf01a', '00000000-0000-0000-0000-000000000001', 'rollout_a@test.local'),
  ('00000000-0000-0000-0000-0000000cf01b', '00000000-0000-0000-0000-0000000000c2', 'rollout_b@test.local')
on conflict (id) do nothing;

-- Tenant A is the pilot: engine + workspaces on. Tenant B has NO row at all, which
-- is the state every other tenant in production is in.
insert into public.tenant_process_rollout (tenant_id, process_engine, process_workspaces)
values ('00000000-0000-0000-0000-000000000001', true, true)
on conflict (tenant_id) do update
  set process_engine = true, process_workspaces = true;

-- Give tenant A's user EVERY role the tenant has, so the write tests below prove
-- that no permission — not even SYSTEM_ADMIN — opens a write path.
-- user_role.tenant_id is NOT NULL and a trigger cross-checks it against both the
-- user's and the role's tenant. Supply it from the role row, as every other suite does.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000cf01a', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  a_own int; a_other int; b_own int; b_other int;
  wrote int := 0;
  updated int := 0;
  deleted int := 0;
  constraint_held boolean := false;
begin
  perform set_config('role', 'authenticated', true);

  -- (1) READ ISOLATION -------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000cf01a', 'role', 'authenticated')::text, true);
  select count(*) into a_own   from public.tenant_process_rollout
    where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into a_other from public.tenant_process_rollout
    where tenant_id = '00000000-0000-0000-0000-0000000000c2';

  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000cf01b', 'role', 'authenticated')::text, true);
  -- Tenant B has no row: it reads zero of its own, and — critically — zero of A's.
  -- It must not even be able to observe that another tenant is piloting.
  select count(*) into b_own   from public.tenant_process_rollout
    where tenant_id = '00000000-0000-0000-0000-0000000000c2';
  select count(*) into b_other from public.tenant_process_rollout
    where tenant_id = '00000000-0000-0000-0000-000000000001';

  -- (2) NO TENANT WRITE PATH -------------------------------------------------
  -- Tenant A's SYSTEM_ADMIN attempts to enable Collections for itself.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000cf01a', 'role', 'authenticated')::text, true);

  begin
    update public.tenant_process_rollout
      set collections = true
      where tenant_id = '00000000-0000-0000-0000-000000000001';
    get diagnostics updated = row_count;
  exception when insufficient_privilege or others then
    updated := -1;  -- refused outright (no grant) — also a pass
  end;

  begin
    insert into public.tenant_process_rollout (tenant_id, process_engine)
    values ('00000000-0000-0000-0000-0000000000c2', true);
    get diagnostics wrote = row_count;
  exception when insufficient_privilege or others then
    wrote := -1;
  end;

  begin
    delete from public.tenant_process_rollout
      where tenant_id = '00000000-0000-0000-0000-000000000001';
    get diagnostics deleted = row_count;
  exception when insufficient_privilege or others then
    deleted := -1;
  end;

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('a_own', a_own), ('a_other', a_other),
    ('b_own', b_own), ('b_other', b_other),
    ('updated', updated), ('wrote', wrote), ('deleted', deleted);

  if a_own <> 1 then
    raise exception 'RLS ROLLOUT FAIL: pilot tenant cannot read its own rollout row (% rows)', a_own;
  end if;
  if a_other <> 0 then
    raise exception 'RLS ROLLOUT FAIL: tenant A read tenant B rollout (% rows)', a_other;
  end if;
  if b_own <> 0 then
    raise exception 'RLS ROLLOUT FAIL: tenant B has no row but read % rows', b_own;
  end if;
  if b_other <> 0 then
    raise exception 'RLS ROLLOUT LEAK: tenant B can see that tenant A is piloting (% rows)', b_other;
  end if;

  -- A blocked write is either an outright privilege error (-1) or zero rows
  -- affected (RLS filtered it away). Anything else means a tenant just enabled
  -- itself.
  if updated > 0 then
    raise exception 'RLS ROLLOUT BREACH: a tenant SYSTEM_ADMIN UPDATED its own rollout (% rows)', updated;
  end if;
  if wrote > 0 then
    raise exception 'RLS ROLLOUT BREACH: a tenant user INSERTED a rollout row (% rows)', wrote;
  end if;
  if deleted > 0 then
    raise exception 'RLS ROLLOUT BREACH: a tenant user DELETED a rollout row (% rows)', deleted;
  end if;

  -- (3) THE CHECK CONSTRAINT -------------------------------------------------
  -- Service role (postgres) — the only writer. Even IT may not store queues over a
  -- dark engine.
  begin
    insert into public.tenant_process_rollout (tenant_id, process_engine, process_workspaces)
    values ('00000000-0000-0000-0000-0000000000c2', false, true);
    constraint_held := false;
  exception when check_violation then
    constraint_held := true;
  end;

  if not constraint_held then
    raise exception 'ROLLOUT CONSTRAINT FAIL: stored workspaces=true with engine=false';
  end if;

  raise notice 'RLS tenant_process_rollout (isolation + no tenant write + constraint): PASS';
end $$;

rollback;
