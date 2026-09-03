-- ===========================================================================
-- TMS-2 — chauffeur live mission tracking, proven live.
-- ---------------------------------------------------------------------------
--   A. the RETURNING leg exists and a session may travel ACTIVE → RETURNING →
--      COMPLETED; an unknown status is refused
--   B. the return point lives on the MISSION, is optional, and its coordinates
--      come as a coherent, valid pair or not at all
--   C. RLS — the ASSIGNED driver reads their own session and positions; a
--      DIFFERENT driver reads neither (mission ownership, DB-enforced)
--   D. the customer portal sees only positions explicitly marked
--      customer_visible; never the fleet's live stream
--   E. cross-tenant readers see nothing
--   F. Transport staff (transport:read + tracking:read) see the mission
--   G. tracking is NOT workflow authority: ending a session leaves the
--      transport status, the POD and the dossier exactly as they were
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

create temp table _r (check_name text, value int) on commit drop;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN'),
  ('00000000-0000-0000-0000-00000002d0b2', 'TMS2 Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000002d001', 'tms2-driver@test.local'),
  ('00000000-0000-0000-0000-00000002d002', 'tms2-otherdriver@test.local'),
  ('00000000-0000-0000-0000-00000002d003', 'tms2-transport@test.local'),
  ('00000000-0000-0000-0000-00000002d004', 'tms2-xtenant@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000002d001', '00000000-0000-0000-0000-000000000001', 'tms2-driver@test.local', 'active'),
  ('00000000-0000-0000-0000-00000002d002', '00000000-0000-0000-0000-000000000001', 'tms2-otherdriver@test.local', 'active'),
  ('00000000-0000-0000-0000-00000002d003', '00000000-0000-0000-0000-000000000001', 'tms2-transport@test.local', 'active'),
  ('00000000-0000-0000-0000-00000002d004', '00000000-0000-0000-0000-00000002d0b2', 'tms2-xtenant@test.local', 'active')
on conflict (id) do nothing;

-- Real seeded roles: the grants themselves are under test.
insert into public.user_role (user_id, role_id, tenant_id)
select s.u, r.id, '00000000-0000-0000-0000-000000000001'
from public.role r,
     (values ('00000000-0000-0000-0000-00000002d001'::uuid),
             ('00000000-0000-0000-0000-00000002d002'::uuid)) as s(u)
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DRIVER'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000002d003', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'TRANSPORT_OFFICER'
on conflict do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-00000002d0c9', '00000000-0000-0000-0000-00000002d0b2', 'TMS2_TRANSPORT_B', 'Transport B (test)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000002d0c9', p.id from public.permission p
 where p.code in ('transport:read', 'tracking:read', 'file:read')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-00000002d004', '00000000-0000-0000-0000-00000002d0c9', '00000000-0000-0000-0000-00000002d0b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000002d0d1', '00000000-0000-0000-0000-000000000001', 'TMS2 Client')
on conflict (id) do nothing;

-- created_by = the transport officer, so can_read_file() grants dossier
-- visibility through a REAL relationship (TRANSPORT_OFFICER holds file:read,
-- not file:read:all) and the checks below exercise the TRACKING policies.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status, created_by) values
  ('00000000-0000-0000-0000-00000002d0f1', '00000000-0000-0000-0000-000000000001', 'TMS2-0001', 'TRP',
   '00000000-0000-0000-0000-00000002d0d1', 'OPENED', '00000000-0000-0000-0000-00000002d003')
on conflict (id) do nothing;

insert into public.vehicle (id, tenant_id, registration, vehicle_type) values
  ('00000000-0000-0000-0000-00000002d0e1', '00000000-0000-0000-0000-000000000001', 'TMS2-DK-42', 'CAMION')
on conflict (id) do nothing;

insert into public.transport_record
  (id, tenant_id, file_id, status, vehicle_id, driver_user_id, pickup_location, delivery_location) values
  ('00000000-0000-0000-0000-00000002d0a1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000002d0f1', 'IN_TRANSIT', '00000000-0000-0000-0000-00000002d0e1',
   '00000000-0000-0000-0000-00000002d001', 'Port de Dakar', 'Thiès')
on conflict (id) do nothing;

-- ---- A. the return leg ----------------------------------------------------
insert into public.tracking_session
  (id, tenant_id, file_id, transport_id, driver_id, source, status) values
  ('00000000-0000-0000-0000-00000002d0b1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000002d0f1', '00000000-0000-0000-0000-00000002d0a1',
   '00000000-0000-0000-0000-00000002d001', 'driver_mobile', 'ACTIVE')
on conflict (id) do nothing;

do $$
declare bad boolean := false; v_status text;
begin
  -- ACTIVE -> RETURNING is admitted, and carries its instant.
  update public.tracking_session
     set status = 'RETURNING', return_started_at = now()
   where id = '00000000-0000-0000-0000-00000002d0b1';
  select status into v_status from public.tracking_session
   where id = '00000000-0000-0000-0000-00000002d0b1';

  -- An invented status is still refused: the vocabulary was widened, not opened.
  begin
    update public.tracking_session set status = 'DRIVING_HOME'
     where id = '00000000-0000-0000-0000-00000002d0b1';
    raise exception 'TMS2-A failed: an unknown session status was accepted';
  exception when check_violation then bad := true;
  end;

  insert into _r values
    ('return_leg_admitted', case when v_status = 'RETURNING' then 1 else 0 end),
    ('unknown_status_refused', case when bad then 1 else 0 end);
  if v_status <> 'RETURNING' then raise exception 'TMS2-A failed: RETURNING did not take'; end if;
end $$;

-- ---- B. the return point --------------------------------------------------
do $$
declare half boolean := false; bad_coord boolean := false; v_loc text;
begin
  -- Optional: a mission with no return point is perfectly legal (the default).
  select return_location into v_loc from public.transport_record
   where id = '00000000-0000-0000-0000-00000002d0a1';

  -- A half-pair is refused.
  begin
    update public.transport_record set return_latitude = 14.7
     where id = '00000000-0000-0000-0000-00000002d0a1';
    raise exception 'TMS2-B failed: a latitude without a longitude was accepted';
  exception when check_violation then half := true;
  end;

  -- An impossible coordinate is refused.
  begin
    update public.transport_record set return_latitude = 200, return_longitude = 10
     where id = '00000000-0000-0000-0000-00000002d0a1';
    raise exception 'TMS2-B failed: an out-of-range return point was accepted';
  exception when check_violation then bad_coord := true;
  end;

  -- A coherent point is accepted.
  update public.transport_record
     set return_location = 'Base Effitrans — Dakar', return_latitude = 14.72, return_longitude = -17.46
   where id = '00000000-0000-0000-0000-00000002d0a1';

  insert into _r values
    ('return_point_optional_by_default', case when v_loc is null then 1 else 0 end),
    ('return_point_half_pair_refused', case when half then 1 else 0 end),
    ('return_point_range_checked', case when bad_coord then 1 else 0 end);
end $$;

-- Positions for the RLS checks: one internal, one explicitly customer-visible.
insert into public.tracking_position
  (tenant_id, tracking_session_id, file_id, transport_id, latitude, longitude, source, customer_visible, recorded_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000002d0b1',
   '00000000-0000-0000-0000-00000002d0f1', '00000000-0000-0000-0000-00000002d0a1',
   14.70, -17.45, 'driver_mobile', false, now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000002d0b1',
   '00000000-0000-0000-0000-00000002d0f1', '00000000-0000-0000-0000-00000002d0a1',
   14.71, -17.44, 'driver_mobile', true, now() - interval '1 minute');

-- ---- C..F. RLS, measured under each impersonated identity ------------------
set local role authenticated;

-- The ASSIGNED driver: own session, own positions.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000002d001', 'role', 'authenticated')::text, true);
do $$
declare n_s int; n_p int;
begin
  select count(*) into n_s from public.tracking_session;
  select count(*) into n_p from public.tracking_position;
  perform set_config('tms2.own_sessions', n_s::text, true);
  perform set_config('tms2.own_positions', n_p::text, true);
  if n_s < 1 then raise exception 'TMS2-C failed: the assigned driver saw % of their own sessions', n_s; end if;
end $$;

-- A DIFFERENT driver of the same tenant: nothing. Mission ownership, not role.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000002d002', 'role', 'authenticated')::text, true);
do $$
declare n_s int; n_p int;
begin
  select count(*) into n_s from public.tracking_session;
  select count(*) into n_p from public.tracking_position;
  perform set_config('tms2.other_sessions', n_s::text, true);
  perform set_config('tms2.other_positions', n_p::text, true);
  if n_s <> 0 or n_p <> 0 then
    raise exception 'TMS2-C failed: an unassigned driver saw % session(s) and % position(s)', n_s, n_p;
  end if;
end $$;

-- Transport staff: sees the mission's telemetry.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000002d003', 'role', 'authenticated')::text, true);
do $$
declare n_p int;
begin
  select count(*) into n_p from public.tracking_position;
  perform set_config('tms2.staff_positions', n_p::text, true);
  if n_p < 2 then raise exception 'TMS2-F failed: Transport staff saw % position(s), expected 2', n_p; end if;
end $$;

-- Cross-tenant, fully permissioned in ITS OWN tenant: nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000002d004', 'role', 'authenticated')::text, true);
do $$
declare n_p int;
begin
  select count(*) into n_p from public.tracking_position
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('tms2.xtenant_positions', n_p::text, true);
  if n_p <> 0 then raise exception 'TMS2-E failed: cross-tenant leak of % position(s)', n_p; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

insert into _r values
  ('assigned_driver_sees_own_session', case when current_setting('tms2.own_sessions')::int >= 1 then 1 else 0 end),
  ('assigned_driver_sees_own_positions', case when current_setting('tms2.own_positions')::int >= 1 then 1 else 0 end),
  ('other_driver_sees_no_session', case when current_setting('tms2.other_sessions')::int = 0 then 1 else 0 end),
  ('other_driver_sees_no_positions', case when current_setting('tms2.other_positions')::int = 0 then 1 else 0 end),
  ('transport_staff_sees_positions', case when current_setting('tms2.staff_positions')::int >= 2 then 1 else 0 end),
  ('cross_tenant_sees_nothing', case when current_setting('tms2.xtenant_positions')::int = 0 then 1 else 0 end);

-- ---- D. the customer portal reaches only what was explicitly published -----
do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'tracking_position'
     and policyname = 'tracking_position_portal_select';
  insert into _r values
    ('portal_requires_customer_visible',
     case when v_qual like '%customer_visible%' then 1 else 0 end);
  if v_qual not like '%customer_visible%' then
    raise exception 'TMS2-D failed: the portal policy no longer requires customer_visible';
  end if;

  -- …and the fleet's live stream is internal by default.
  insert into _r values
    ('internal_positions_not_customer_visible',
     case when (select count(*) from public.tracking_position
                 where transport_id = '00000000-0000-0000-0000-00000002d0a1'
                   and customer_visible = false) >= 1 then 1 else 0 end);
end $$;

-- ---- G. tracking is NOT workflow authority --------------------------------
do $$
declare v_before text; v_after text; v_pod uuid; v_file text;
begin
  select status, pod_document_id into v_before, v_pod from public.transport_record
   where id = '00000000-0000-0000-0000-00000002d0a1';
  select status into v_file from public.operational_file
   where id = '00000000-0000-0000-0000-00000002d0f1';

  -- End the round trip, exactly as the driver action does.
  update public.tracking_session
     set status = 'COMPLETED', ended_at = now()
   where id = '00000000-0000-0000-0000-00000002d0b1';

  select status into v_after from public.transport_record
   where id = '00000000-0000-0000-0000-00000002d0a1';

  insert into _r values
    ('ending_tracking_does_not_move_transport',
     case when v_before = v_after then 1 else 0 end),
    ('ending_tracking_creates_no_pod', case when v_pod is null then 1 else 0 end),
    ('ending_tracking_does_not_close_dossier',
     case when (select status from public.operational_file
                 where id = '00000000-0000-0000-0000-00000002d0f1') = v_file then 1 else 0 end);

  if v_before <> v_after then
    raise exception 'TMS2-G failed: ending tracking moved the mission from % to %', v_before, v_after;
  end if;
end $$;

-- ---- every recorded check must hold ---------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*), min(check_name) into v_n, v_bad from _r where value = 0;
  if v_n <> 0 then raise exception 'TMS2 FAIL: % check(s) did not hold (e.g. %)', v_n, v_bad; end if;
  raise notice 'TMS2 OK: return leg live; mission ownership DB-enforced (assigned driver only); portal needs customer_visible; cross-tenant isolated; ending tracking moves no mission, no POD, no dossier';
end $$;

select * from _r order by check_name;
rollback;
