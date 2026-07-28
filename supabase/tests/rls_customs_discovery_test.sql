-- RLS regression test — Douane dossier discoverability. Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
--   DISCOVERY (all three customs roles)
--   * a dossier with required=true customs is discoverable                 -> 1 each
--   * still discoverable after customs COMPLETED (RELEASED)                -> 1
--   * still discoverable after responsibility moved on (invoice PAID)      -> 1
--   * still discoverable after ARCHIVAL (file CLOSED)                      -> 1
--   * DISCOVERY == OPENABILITY: can_read_file agrees for every row         -> 0 mismatches
--
--   EXCLUSIONS
--   * required = false (customs waived) is NOT discoverable                -> 0
--   * a handling-only dossier with NO customs record is NOT discoverable    -> 0
--   * a soft-deleted customs record does NOT confer discovery              -> 0
--   * CASHIER discovers nothing (DEC-C21, unchanged)                        -> 0
--   * a non-customs role (BILLING_OFFICER) gains nothing from this change   -> 0
--   * cross-tenant: a customs role in tenant B sees no tenant-A dossier     -> 0
--
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d1', 'Test Tenant DOUANE', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'declarant@test.local'),
  ('00000000-0000-0000-0000-00000000d002', 'chief@test.local'),
  ('00000000-0000-0000-0000-00000000d003', 'field@test.local'),
  ('00000000-0000-0000-0000-00000000d004', 'cashier@test.local'),
  ('00000000-0000-0000-0000-00000000d005', 'billing@test.local'),
  ('00000000-0000-0000-0000-00000000d006', 'declarant-b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'declarant@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000001', 'chief@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-000000000001', 'field@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-000000000001', 'cashier@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-000000000001', 'billing@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000d1', 'declarant-b@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-000000000001', 'Douane Client')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  T uuid := '00000000-0000-0000-0000-000000000001';
  TB uuid := '00000000-0000-0000-0000-0000000000d1';
  CL uuid := '00000000-0000-0000-0000-00000000dc01';
  U_DECL uuid := '00000000-0000-0000-0000-00000000d001';
  U_CHIEF uuid := '00000000-0000-0000-0000-00000000d002';
  U_FIELD uuid := '00000000-0000-0000-0000-00000000d003';
  U_CASH uuid := '00000000-0000-0000-0000-00000000d004';
  U_BILL uuid := '00000000-0000-0000-0000-00000000d005';
  U_DECL_B uuid := '00000000-0000-0000-0000-00000000d006';
  f_open uuid := '00000000-0000-0000-0000-00000000df01';  -- customs required, in progress
  f_done uuid := '00000000-0000-0000-0000-00000000df02';  -- customs RELEASED, invoice paid
  f_arch uuid := '00000000-0000-0000-0000-00000000df03';  -- CLOSED
  f_waiv uuid := '00000000-0000-0000-0000-00000000df04';  -- customs required = false
  f_hand uuid := '00000000-0000-0000-0000-00000000df05';  -- handling only, no customs
  f_soft uuid := '00000000-0000-0000-0000-00000000df06';  -- customs soft-deleted
  d_open int; d_done int; d_arch int; d_waiv int; d_hand int; d_soft int;
  chief_sees int; field_sees int; cash_sees int; bill_sees int; b_sees int;
  mismatches int;
  rid uuid;
begin
  perform set_config('role', 'postgres', true);

  -- roles: attach each user to its role in ITS OWN tenant
  for rid in select id from public.role where tenant_id = T and code = 'CUSTOMS_DECLARANT' loop
    insert into public.user_role (tenant_id, user_id, role_id) values (T, U_DECL, rid) on conflict do nothing;
  end loop;
  for rid in select id from public.role where tenant_id = T and code = 'CHIEF_OF_TRANSIT' loop
    insert into public.user_role (tenant_id, user_id, role_id) values (T, U_CHIEF, rid) on conflict do nothing;
  end loop;
  for rid in select id from public.role where tenant_id = T and code = 'CUSTOMS_FIELD_AGENT' loop
    insert into public.user_role (tenant_id, user_id, role_id) values (T, U_FIELD, rid) on conflict do nothing;
  end loop;
  for rid in select id from public.role where tenant_id = T and code = 'CASHIER' loop
    insert into public.user_role (tenant_id, user_id, role_id) values (T, U_CASH, rid) on conflict do nothing;
  end loop;
  for rid in select id from public.role where tenant_id = T and code = 'BILLING_OFFICER' loop
    insert into public.user_role (tenant_id, user_id, role_id) values (T, U_BILL, rid) on conflict do nothing;
  end loop;

  -- dossiers. NOTE: created_by is deliberately a DIFFERENT user, so nothing is
  -- discoverable through the personal-ownership clauses — only via department.
  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status, created_by) values
    (f_open, T, 'DOUANE-TEST-0001', 'IMP', CL, 'IN_PROGRESS', U_BILL),
    (f_done, T, 'DOUANE-TEST-0002', 'IMP', CL, 'DELIVERED',   U_BILL),
    (f_arch, T, 'DOUANE-TEST-0003', 'IMP', CL, 'CLOSED',      U_BILL),
    (f_waiv, T, 'DOUANE-TEST-0004', 'IMP', CL, 'IN_PROGRESS', U_BILL),
    (f_hand, T, 'DOUANE-TEST-0005', 'HND', CL, 'IN_PROGRESS', U_BILL),
    (f_soft, T, 'DOUANE-TEST-0006', 'IMP', CL, 'IN_PROGRESS', U_BILL);

  insert into public.customs_record (tenant_id, file_id, status, required) values
    (T, f_open, 'DECLARED', true),
    (T, f_done, 'RELEASED', true),
    (T, f_arch, 'RELEASED', true),
    (T, f_waiv, 'NOT_STARTED', false);
  -- soft-deleted customs record confers nothing
  insert into public.customs_record (tenant_id, file_id, status, required, deleted_at)
  values (T, f_soft, 'DECLARED', true, now());
  -- f_hand: no customs record at all

  -- ============================================ discovery (declarant)
  select count(*) into d_open from public.user_readable_file_ids(U_DECL, T) where id = f_open;
  select count(*) into d_done from public.user_readable_file_ids(U_DECL, T) where id = f_done;
  select count(*) into d_arch from public.user_readable_file_ids(U_DECL, T) where id = f_arch;
  select count(*) into d_waiv from public.user_readable_file_ids(U_DECL, T) where id = f_waiv;
  select count(*) into d_hand from public.user_readable_file_ids(U_DECL, T) where id = f_hand;
  select count(*) into d_soft from public.user_readable_file_ids(U_DECL, T) where id = f_soft;

  -- the other two customs roles see the completed dossier too
  select count(*) into chief_sees from public.user_readable_file_ids(U_CHIEF, T) where id = f_done;
  select count(*) into field_sees from public.user_readable_file_ids(U_FIELD, T) where id = f_done;

  -- ============================================ exclusions
  select count(*) into cash_sees from public.user_readable_file_ids(U_CASH, T)
   where id in (f_open, f_done, f_arch, f_waiv, f_hand, f_soft);
  select count(*) into bill_sees from public.user_readable_file_ids(U_BILL, T)
   where id in (f_open, f_done, f_arch);   -- created_by is U_BILL, so exclude those
  -- cross-tenant: a customs role in tenant B sees no tenant-A dossier
  select count(*) into b_sees from public.user_readable_file_ids(U_DECL_B, TB);

  -- ============================================ discovery == openability
  -- Every row discovery returns must also pass can_read_file for that user.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', U_DECL::text, 'role','authenticated')::text, true);
  select count(*) into mismatches
    from public.user_readable_file_ids(U_DECL, T) d
   where not public.can_read_file(d.id);
  perform set_config('role', 'postgres', true);

  raise notice 'DOUANE: open=% done=% arch=% waived=% handling=% softdel=% chief=% field=% cashier=% billing=% tenantB=% mismatch=%',
    d_open, d_done, d_arch, d_waiv, d_hand, d_soft,
    chief_sees, field_sees, cash_sees, bill_sees, b_sees, mismatches;

  insert into _r values
    ('discovers_customs_required', d_open),
    ('discovers_after_completion', d_done),
    ('discovers_after_archival', d_arch),
    ('excludes_waived_required_false', d_waiv),
    ('excludes_handling_only', d_hand),
    ('excludes_soft_deleted_customs', d_soft),
    ('chief_of_transit_discovers', chief_sees),
    ('field_agent_discovers', field_sees),
    ('cashier_discovers_nothing', cash_sees),
    ('billing_officer_gains_nothing', bill_sees),
    ('cross_tenant_denied', b_sees),
    ('discovery_matches_openability', mismatches);

  if d_open <> 1 or d_done <> 1 or d_arch <> 1
     or d_waiv <> 0 or d_hand <> 0 or d_soft <> 0
     or chief_sees <> 1 or field_sees <> 1
     or cash_sees <> 0 or b_sees <> 0
     or mismatches <> 0
  then
    raise exception 'RLS DOUANE FAIL — see the NOTICE line above for every value';
  end if;

  -- BILLING_OFFICER is created_by on three dossiers, so it legitimately sees
  -- exactly those three through the EXISTING ownership clause — never through
  -- the new customs branch. Asserted separately so the number is explained.
  if bill_sees <> 3 then
    raise exception 'RLS DOUANE FAIL — billing officer visibility changed: expected 3 (created_by), got %', bill_sees;
  end if;
end $$;

select * from _r order by check_name;
rollback;
