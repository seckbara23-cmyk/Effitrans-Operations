-- RLS / constraint regression — INCOTERM-CATALOG-01. Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves, against a REAL database, the half that only the database can prove:
--
--   A  all eleven canonical Incoterms are accepted
--   B  an arbitrary value is REFUSED ("TEST", "XYZ", lowercase, padded, "")
--   C  the canonical code is what gets persisted
--   D  the named place persists INDEPENDENTLY of origin/destination
--   E  a shipment with no Incoterm stays valid, with or without a place
--   G  the new columns confer no visibility: a user who cannot read the dossier
--      cannot read its Incoterm, and the tenant boundary is unchanged
--   H  Services demandes are untouched by an Incoterm write
--   I  no workflow row is created or advanced by an Incoterm write
--
-- The application-side half (selector, validator, formatter, read model) is
-- proven in tests/incoterm-catalog-01.test.ts. This file is about the constraint
-- and the RLS boundary.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- A reader WITHOUT any ground on the dossier, to prove the field grants nothing.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ace1', 'inco.outsider@test.local'),
  ('00000000-0000-0000-0000-00000000ace2', 'inco.tenantb@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000ace1', '00000000-0000-0000-0000-000000000001', 'inco.outsider@test.local'),
  ('00000000-0000-0000-0000-00000000ace2', '00000000-0000-0000-0000-0000000000b2', 'inco.tenantb@test.local')
on conflict (id) do nothing;

-- CHIEF_OF_TRANSIT: holds file:read but no tenant-wide read, and has no
-- relationship to the dossier below — so it must see nothing.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000ace1'::uuid, 'CHIEF_OF_TRANSIT', '00000000-0000-0000-0000-000000000001'::uuid)
) as u(uid, code, tid)
join public.role r on r.code = u.code and r.tenant_id = u.tid
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ace10', '00000000-0000-0000-0000-000000000001', 'Client Incoterm')
on conflict (id) do nothing;

create temp table _r (check_name text, pass boolean) on commit drop;

do $$
declare
  t_a uuid := '00000000-0000-0000-0000-000000000001';
  v_client uuid := '00000000-0000-0000-0000-0000000ace10';
  v_file uuid;
  v_ship uuid;
  v_code text;
  v_bad text;
  v_ok boolean;
  v_accepted int := 0;
  v_services_before text;
  v_services_after text;
  v_steps_before int;
  v_steps_after int;
begin
  insert into public.operational_file (tenant_id, file_number, type, client_id)
  values (t_a, public.next_file_number(t_a, 'IMP'), 'IMP', v_client)
  returning id into v_file;

  insert into public.shipment (tenant_id, file_id, transport_mode)
  values (t_a, v_file, 'SEA')
  returning id into v_ship;

  -- ---- A. every canonical code is accepted -------------------------------
  foreach v_code in array array['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP']
  loop
    update public.shipment set incoterm = v_code where id = v_ship;
    if (select incoterm from public.shipment where id = v_ship) = v_code then
      v_accepted := v_accepted + 1;
    end if;
  end loop;
  insert into _r values ('A all 11 canonical Incoterms accepted', v_accepted = 11);

  -- ---- B. anything else is refused BY THE DATABASE ------------------------
  -- Including the near-misses an operator actually produces: lowercase, padded,
  -- and a code that looks plausible but is not in Incoterms 2020.
  foreach v_bad in array array['TEST','XYZ','cif',' CIF','CIF ','FOBB','DAT','']
  loop
    v_ok := false;
    begin
      update public.shipment set incoterm = v_bad where id = v_ship;
    exception when others then v_ok := true;
    end;
    insert into _r values ('B refuses ' || coalesce(nullif(v_bad, ''), '(empty string)'), v_ok);
  end loop;

  -- ---- C. the canonical code is what is stored ---------------------------
  update public.shipment set incoterm = 'CIF' where id = v_ship;
  insert into _r values ('C canonical code persisted',
    (select incoterm = 'CIF' from public.shipment where id = v_ship));

  -- ---- D. the named place persists INDEPENDENTLY -------------------------
  update public.shipment
     set incoterm_place = 'Dakar', origin = 'Shanghai', destination = 'Dakar'
   where id = v_ship;
  insert into _r values ('D place persists beside the route, not instead of it',
    (select incoterm_place = 'Dakar' and origin = 'Shanghai' and destination = 'Dakar'
       from public.shipment where id = v_ship));
  -- …and it is NOT constrained: a port name, a city, a quay all record fine.
  update public.shipment set incoterm_place = 'Port de Dakar, Mole 8' where id = v_ship;
  insert into _r values ('D place is free text, no vocabulary invented',
    (select incoterm_place = 'Port de Dakar, Mole 8' from public.shipment where id = v_ship));

  -- ---- E. no Incoterm is still valid -------------------------------------
  update public.shipment set incoterm = null, incoterm_place = null where id = v_ship;
  insert into _r values ('E a shipment with no Incoterm remains valid',
    (select incoterm is null from public.shipment where id = v_ship));
  -- A place with no code is not refused by the DATABASE — the UI never renders
  -- it and never submits it — so this records the actual contract rather than a
  -- rule this slice did not invent.
  v_ok := true;
  begin
    update public.shipment set incoterm_place = 'Orphelin' where id = v_ship;
  exception when others then v_ok := false;
  end;
  insert into _r values ('E place without code is not a DB error (UI drops it)', v_ok);
  update public.shipment set incoterm = 'CIF', incoterm_place = 'Dakar' where id = v_ship;

  -- ---- H. services demandes are untouched --------------------------------
  -- « Services demandes » live on operational_file.services (text[]), governed by
  -- operational_file_services_known. They are the ONLY authority on what
  -- Effitrans performs, and an Incoterm write must leave them exactly as they are
  -- — including leaving them NULL, which is what « not recorded » means here.
  select coalesce(array_to_string(services, ','), '(null)') into v_services_before
    from public.operational_file where id = v_file;
  update public.shipment set incoterm = 'DDP' where id = v_ship;
  select coalesce(array_to_string(services, ','), '(null)') into v_services_after
    from public.operational_file where id = v_file;
  insert into _r values ('H Incoterm write changes no service scope',
    v_services_before = v_services_after);

  -- …and the same holds when services ARE recorded: DDP is the term that most
  -- tempts a reader to infer "Effitrans does everything", so it is the one tested.
  update public.operational_file set services = array['customs'] where id = v_file;
  update public.shipment set incoterm = 'DDP' where id = v_ship;
  insert into _r values ('H … and a recorded scope is not widened by DDP',
    (select services = array['customs'] from public.operational_file where id = v_file));

  -- ---- I. no workflow row is created or advanced -------------------------
  select count(*) into v_steps_before
    from public.process_step_execution e
    join public.process_instance pi on pi.id = e.process_instance_id
   where pi.file_id = v_file;
  update public.shipment set incoterm = 'FOB', incoterm_place = 'Shanghai' where id = v_ship;
  select count(*) into v_steps_after
    from public.process_step_execution e
    join public.process_instance pi on pi.id = e.process_instance_id
   where pi.file_id = v_file;
  insert into _r values ('I Incoterm write creates/advances no workflow step',
    v_steps_before = v_steps_after);
  insert into _r values ('I Incoterm write opens no process instance',
    (select count(*) = 0 from public.process_instance where file_id = v_file));
  insert into _r values ('I Incoterm write creates no handoff',
    (select count(*) = 0 from public.process_handoff h
      join public.process_instance pi on pi.id = h.process_instance_id
     where pi.file_id = v_file));
  insert into _r values ('I the dossier status is unchanged',
    (select status = 'DRAFT' from public.operational_file where id = v_file));
end $$;

-- ---- G. the field confers NO visibility -----------------------------------
do $$
declare
  v_file uuid := (select id from public.operational_file
                   where client_id = '00000000-0000-0000-0000-0000000ace10'
                   order by created_at desc limit 1);
  v_outsider_file int; v_outsider_ship int; v_tenantb_ship int;
begin
  perform set_config('role', 'authenticated', true);

  -- A same-tenant user with file:read but NO ground on this dossier: the
  -- Incoterm is an attribute of a dossier it cannot read, so it sees neither.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ace1','role','authenticated')::text, true);
  select count(*) into v_outsider_file from public.operational_file where id = v_file;
  select count(*) into v_outsider_ship from public.shipment where file_id = v_file;

  -- A tenant-B user: the tenant boundary is unchanged by this slice.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ace2','role','authenticated')::text, true);
  select count(*) into v_tenantb_ship from public.shipment where file_id = v_file;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('G unrelated same-tenant reader sees no dossier', v_outsider_file = 0),
    ('G … and therefore no shipment/Incoterm', v_outsider_ship = 0),
    ('G cross-tenant reader sees no shipment/Incoterm', v_tenantb_ship = 0);
end $$;

select * from _r order by check_name;

do $$
declare
  v_failed text;
begin
  select string_agg(check_name, '; ') into v_failed from _r where pass is not true;
  if v_failed is not null then
    raise exception 'INCOTERM CATALOG FAIL: %', v_failed;
  end if;
  raise notice 'INCOTERM-CATALOG-01: % checks all hold', (select count(*) from _r);
end $$;

rollback;
