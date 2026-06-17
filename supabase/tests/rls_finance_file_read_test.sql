-- RLS regression — Finance Officer file READ (Phase 2.0 / A1). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves the dry-run blocker fix is safe: FINANCE_OFFICER (granted file:read +
-- file:read:all in 20260616000001) can READ any dossier it is NOT assigned to
-- (so it can reach the file page to author invoices/payments), but CANNOT
-- perform operational WRITES on operational_file (no file:create / file:update).
--   * SELECT an unassigned dossier            -> 1        (read works tenant-wide)
--   * UPDATE that dossier                      -> blocked  (authenticated has no
--                                                           UPDATE grant — writes are
--                                                           service-role only)
--   * INSERT a new dossier                     -> blocked  (no INSERT grant either)
-- operational_file grants SELECT-only to `authenticated` (20260614000002); all
-- writes go through the service-role admin client in server actions. So a write
-- here is denied at the TABLE-PRIVILEGE level (before RLS row-filtering).
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000fc', 'finread@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-000000000001', 'finread@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000fc', r.id, r.tenant_id
from public.role r
where r.code = 'FINANCE_OFFICER' and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1f0', '00000000-0000-0000-0000-000000000001', 'Client FC')
on conflict (id) do nothing;

-- A dossier the finance officer is NOT assigned to (no AM / coordinator / creator / task).
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-98001', 'IMP', '00000000-0000-0000-0000-00000000c1f0')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  can_read int; upd_blocked int := 0; ins_blocked int := 0;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000fc','role','authenticated')::text, true);

  -- READ: file:read + file:read:all -> sees the unassigned dossier.
  select count(*) into can_read from public.operational_file
    where id = '00000000-0000-0000-0000-00000000fc01';

  -- UPDATE: no table-level UPDATE grant for authenticated -> denied (raises).
  begin
    update public.operational_file set priority = 'high'
      where id = '00000000-0000-0000-0000-00000000fc01';
  exception when others then
    upd_blocked := 1;
  end;

  -- INSERT: no table-level INSERT grant for authenticated -> denied (raises).
  begin
    insert into public.operational_file (id, tenant_id, file_number, type, client_id)
    values ('00000000-0000-0000-0000-00000000fc02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-98002', 'IMP', '00000000-0000-0000-0000-00000000c1f0');
  exception when others then
    ins_blocked := 1;
  end;

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('fin_can_read', can_read), ('fin_update_blocked', upd_blocked), ('fin_insert_blocked', ins_blocked);

  if can_read <> 1 or upd_blocked <> 1 or ins_blocked <> 1 then
    raise exception 'RLS FINANCE FILE-READ FAIL: read=% updBlocked=% insBlocked=%', can_read, upd_blocked, ins_blocked;
  end if;
end $$;

select * from _r order by check_name;
rollback;
