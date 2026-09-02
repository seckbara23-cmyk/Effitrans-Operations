-- ===========================================================================
-- TMS-1C — external mission tracking reference, proven live.
-- ---------------------------------------------------------------------------
--   A. one reference per mission (UNIQUE transport_id)
--   B. the SAME VEHICLE on two missions carries TWO references — tracking
--      belongs to the mission, never to the asset
--   C. a non-https link is refused by the DATABASE, not only the action
--   D. tenant and dossier mismatches are refused by the guard trigger
--   E. RLS: transport:read sees it; the assigned DRIVER does not; the CUSTOMER
--      PORTAL does not — the two exposures the design exists to prevent
--   F. cross-tenant readers see nothing
--   G. no write policy: the governed actions are the only door
--   H. changing the mission's driver leaves the reference untouched
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

create temp table _r (check_name text, value int) on commit drop;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN'),
  ('00000000-0000-0000-0000-0000001c00b2', 'TMS1C Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001c0001', 'tms1c-transport@test.local'),
  ('00000000-0000-0000-0000-0000001c0002', 'tms1c-driver@test.local'),
  ('00000000-0000-0000-0000-0000001c0003', 'tms1c-xtenant@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000001c0001', '00000000-0000-0000-0000-000000000001', 'tms1c-transport@test.local', 'active'),
  ('00000000-0000-0000-0000-0000001c0002', '00000000-0000-0000-0000-000000000001', 'tms1c-driver@test.local', 'active'),
  ('00000000-0000-0000-0000-0000001c0003', '00000000-0000-0000-0000-0000001c00b2', 'tms1c-xtenant@test.local', 'active')
on conflict (id) do nothing;

-- Real seeded roles: the grants themselves are under test.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000001c0001', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'TRANSPORT_OFFICER'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000001c0002', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DRIVER'
on conflict do nothing;

-- Tenant B's reader holds transport:read IN ITS OWN TENANT, so its zero proves
-- isolation rather than a missing capability.
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000001c00c9', '00000000-0000-0000-0000-0000001c00b2', 'TMS1C_TRANSPORT_B', 'Transport B (test)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000001c00c9', p.id from public.permission p
 where p.code in ('transport:read', 'file:read')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000001c0003', '00000000-0000-0000-0000-0000001c00c9', '00000000-0000-0000-0000-0000001c00b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000001c00d1', '00000000-0000-0000-0000-000000000001', 'TMS1C Client')
on conflict (id) do nothing;

-- TWO dossiers = TWO missions, and ONE vehicle that runs both (case B).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-0000001c00f1', '00000000-0000-0000-0000-000000000001', 'TMS1C-0001', 'TRP',
   '00000000-0000-0000-0000-0000001c00d1', 'OPENED'),
  ('00000000-0000-0000-0000-0000001c00f2', '00000000-0000-0000-0000-000000000001', 'TMS1C-0002', 'TRP',
   '00000000-0000-0000-0000-0000001c00d1', 'OPENED')
on conflict (id) do nothing;

insert into public.vehicle (id, tenant_id, registration, vehicle_type) values
  ('00000000-0000-0000-0000-0000001c00e1', '00000000-0000-0000-0000-000000000001', 'TMS1C-DK-77', 'CAMION')
on conflict (id) do nothing;

insert into public.transport_record (id, tenant_id, file_id, status, vehicle_id, driver_user_id) values
  ('00000000-0000-0000-0000-0000001c0d01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001c00f1', 'PLANNED', '00000000-0000-0000-0000-0000001c00e1',
   '00000000-0000-0000-0000-0000001c0002'),
  ('00000000-0000-0000-0000-0000001c0d02', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001c00f2', 'PLANNED', null, null)
on conflict (id) do nothing;

-- ---- A + B. one per mission; the same vehicle on two missions -------------
insert into public.transport_tracking_reference
  (id, tenant_id, transport_id, file_id, provider, tracking_url, attached_by) values
  ('00000000-0000-0000-0000-0000001c0a01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001c0d01', '00000000-0000-0000-0000-0000001c00f1',
   'Prestataire A', 'https://tracker.example.sn/m/1', '00000000-0000-0000-0000-0000001c0001');

do $$
declare dup boolean := false; n int;
begin
  -- A: a second reference for the SAME mission is refused.
  begin
    insert into public.transport_tracking_reference
      (tenant_id, transport_id, file_id, provider, tracking_url, attached_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000001c0d01',
            '00000000-0000-0000-0000-0000001c00f1', 'Prestataire B',
            'https://tracker.example.sn/m/2', '00000000-0000-0000-0000-0000001c0001');
    raise exception 'TMS1C-A failed: a second reference was accepted for one mission';
  exception when unique_violation then dup := true;
  end;

  -- B: the SAME VEHICLE, a different mission — accepted, and distinct.
  update public.transport_record set vehicle_id = '00000000-0000-0000-0000-0000001c00e1'
   where id = '00000000-0000-0000-0000-0000001c0d02';
  insert into public.transport_tracking_reference
    (tenant_id, transport_id, file_id, provider, tracking_url, attached_by)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000001c0d02',
          '00000000-0000-0000-0000-0000001c00f2', 'Prestataire A',
          'https://tracker.example.sn/m/2', '00000000-0000-0000-0000-0000001c0001');

  select count(*) into n
    from public.transport_tracking_reference tr
    join public.transport_record t on t.id = tr.transport_id
   where t.vehicle_id = '00000000-0000-0000-0000-0000001c00e1';

  insert into _r values
    ('one_reference_per_mission', case when dup then 1 else 0 end),
    ('same_vehicle_two_missions_two_references', case when n = 2 then 1 else 0 end);
  if n <> 2 then
    raise exception 'TMS1C-B failed: one vehicle on two missions produced % reference(s), expected 2', n;
  end if;
end $$;

-- ---- C. the database refuses a non-https link -----------------------------
do $$
declare http_ boolean := false; js boolean := false;
begin
  begin
    insert into public.transport_tracking_reference
      (tenant_id, transport_id, file_id, provider, tracking_url, attached_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000001c0d02',
            '00000000-0000-0000-0000-0000001c00f2', 'X', 'http://tracker.example.sn/m/3',
            '00000000-0000-0000-0000-0000001c0001');
    raise exception 'TMS1C-C failed: an http link was accepted';
  exception when check_violation then http_ := true; when unique_violation then http_ := true;
  end;

  begin
    update public.transport_tracking_reference
       set tracking_url = 'javascript:alert(1)'
     where id = '00000000-0000-0000-0000-0000001c0a01';
    raise exception 'TMS1C-C failed: a javascript: link was accepted';
  exception when check_violation then js := true;
  end;

  insert into _r values ('non_https_refused_by_database', case when http_ and js then 1 else 0 end);
end $$;

-- ---- D. tenant / dossier guard --------------------------------------------
do $$
declare xtenant boolean := false; xfile boolean := false;
begin
  begin
    insert into public.transport_tracking_reference
      (tenant_id, transport_id, file_id, provider, tracking_url, attached_by)
    values ('00000000-0000-0000-0000-0000001c00b2', '00000000-0000-0000-0000-0000001c0d01',
            '00000000-0000-0000-0000-0000001c00f1', 'X', 'https://tracker.example.sn/x',
            '00000000-0000-0000-0000-0000001c0001');
    raise exception 'TMS1C-D failed: a cross-tenant reference was accepted';
  exception when others then
    if sqlerrm not like '%tenant mismatch%' and sqlerrm not like '%duplicate%' then
      raise exception 'TMS1C-D failed (tenant): %', sqlerrm;
    end if;
    xtenant := true;
  end;

  begin
    update public.transport_tracking_reference
       set file_id = '00000000-0000-0000-0000-0000001c00f2'
     where id = '00000000-0000-0000-0000-0000001c0a01';
    raise exception 'TMS1C-D failed: a reference pointing at the wrong dossier was accepted';
  exception when others then
    if sqlerrm not like '%dossier mismatch%' then
      raise exception 'TMS1C-D failed (dossier): %', sqlerrm;
    end if;
    xfile := true;
  end;

  insert into _r values ('tenant_and_dossier_guard', case when xtenant and xfile then 1 else 0 end);
end $$;

-- ---- E + F. RLS: staff yes, driver no, portal no, cross-tenant no ---------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000001c0001', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.transport_tracking_reference;
  perform set_config('tms1c.staff', n::text, true);
  if n < 1 then raise exception 'TMS1C-E failed: a transport:read holder saw % references', n; end if;
end $$;

-- The ASSIGNED DRIVER of mission 1 — holds tracking:read but not transport:read.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000001c0002', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.transport_tracking_reference;
  perform set_config('tms1c.driver', n::text, true);
  if n <> 0 then
    raise exception 'TMS1C-E failed: the tracked driver saw % tracking reference(s) — a provider link can expose a whole fleet', n;
  end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000001c0003', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.transport_tracking_reference
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('tms1c.xtenant', n::text, true);
  if n <> 0 then raise exception 'TMS1C-F failed: cross-tenant leak of % reference(s)', n; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

insert into _r values
  ('staff_with_transport_read_sees_reference', case when current_setting('tms1c.staff')::int >= 1 then 1 else 0 end),
  ('assigned_driver_sees_nothing', case when current_setting('tms1c.driver')::int = 0 then 1 else 0 end),
  ('cross_tenant_sees_nothing', case when current_setting('tms1c.xtenant')::int = 0 then 1 else 0 end);

-- ---- G. no write policy, and no portal/driver clause ----------------------
do $$
declare n_write int; n_all int; v_qual text;
begin
  select count(*) into n_write from pg_policies
   where schemaname='public' and tablename='transport_tracking_reference'
     and cmd in ('INSERT','UPDATE','DELETE');
  select count(*) into n_all from pg_policies
   where schemaname='public' and tablename='transport_tracking_reference';
  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='transport_tracking_reference'
     and policyname='transport_tracking_reference_select';

  insert into _r values
    ('no_write_policy', case when n_write = 0 then 1 else 0 end),
    ('exactly_one_policy', case when n_all = 1 then 1 else 0 end),
    ('no_portal_or_driver_clause',
     case when v_qual not like '%portal_can_read_file%'
           and v_qual not like '%is_assigned_driver%'
           and v_qual not like '%driver_id%' then 1 else 0 end);
  if n_write <> 0 then raise exception 'TMS1C-G failed: % write policy(ies)', n_write; end if;
  if v_qual like '%portal_can_read_file%' then
    raise exception 'TMS1C-G failed: the customer portal can read tracking references';
  end if;
end $$;

-- ---- H. changing the driver leaves the reference untouched ---------------
do $$
declare v_before text; v_after text;
begin
  select tracking_url into v_before from public.transport_tracking_reference
   where transport_id = '00000000-0000-0000-0000-0000001c0d01';
  update public.transport_record set driver_user_id = null
   where id = '00000000-0000-0000-0000-0000001c0d01';
  select tracking_url into v_after from public.transport_tracking_reference
   where transport_id = '00000000-0000-0000-0000-0000001c0d01';
  insert into _r values ('driver_change_does_not_rewrite_tracking',
    case when v_before is not distinct from v_after and v_after is not null then 1 else 0 end);
  if v_before is distinct from v_after then
    raise exception 'TMS1C-H failed: changing the driver altered the tracking reference';
  end if;
end $$;

-- ---- every recorded check must hold --------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*), min(check_name) into v_n, v_bad from _r where value = 0;
  if v_n <> 0 then raise exception 'TMS1C FAIL: % check(s) did not hold (e.g. %)', v_n, v_bad; end if;
  raise notice 'TMS1C OK: mission-scoped reference, https enforced DB-side, driver and portal see nothing, cross-tenant isolated, no write policy';
end $$;

select * from _r order by check_name;
rollback;
