-- ===========================================================================
-- TMS-2 — shipment ↔ geography foundation, proven live.
-- ---------------------------------------------------------------------------
--   A. the four anchor columns exist and are NULLABLE: a shipment without
--      geography is fully legal (nothing became mandatory)
--   B. same-tenant anchors are accepted (port pair + airport pair)
--   C. a cross-tenant port is refused by trg_shipment_geo_tenant
--   D. a cross-tenant airport is refused the same way
--   E. deleting a referenced port is refused by the FK — the referential is
--      load-bearing, not decorative
--
-- Mode consistency (ports ⇔ SEA/MULTIMODAL, airports ⇔ AIR/MULTIMODAL) is an
-- APP-side rule in validateShipmentGeography — deliberately not a CHECK, so a
-- mode correction never wedges against its anchors. Pinned in vitest.
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN'),
  ('00000000-0000-0000-0000-00000000b0b2', 'Autre organisation (test TMS-2)', 'SN')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-000000becc01', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-2)')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-000000becf01', '00000000-0000-0000-0000-000000000001', 'TMS2-0001', 'IMP',
   '00000000-0000-0000-0000-000000becc01', 'DRAFT')
on conflict (id) do nothing;

-- Reference data: one port + one airport per tenant. The controlled codes are
-- deliberately NULL: the (tenant, unlocode)/(tenant, iata) unique indexes are
-- partial on NOT NULL, and seed.sql already carries real SNDKR/CNSHA/DSS/CDG
-- rows for tenant 1 — a suite fixture must be collision-proof in EVERY
-- environment (the HR-8 evidence lesson: bring your own, and own it fully).
insert into public.ocean_port (id, tenant_id, name, latitude, longitude) values
  ('00000000-0000-0000-0000-000000bec001', '00000000-0000-0000-0000-000000000001', 'Port A (test TMS-2)', 14.6928, -17.4467),
  ('00000000-0000-0000-0000-000000bec002', '00000000-0000-0000-0000-000000000001', 'Port B (test TMS-2)', 31.2304, 121.4737),
  ('00000000-0000-0000-0000-000000bec099', '00000000-0000-0000-0000-00000000b0b2', 'Port (autre tenant, test TMS-2)', 49.4944, 0.1079)
on conflict (id) do nothing;

insert into public.air_airport (id, tenant_id, name, latitude, longitude) values
  ('00000000-0000-0000-0000-000000beca01', '00000000-0000-0000-0000-000000000001', 'Aéroport A (test TMS-2)', 14.6700, -17.0733),
  ('00000000-0000-0000-0000-000000beca02', '00000000-0000-0000-0000-000000000001', 'Aéroport B (test TMS-2)', 49.0097, 2.5479),
  ('00000000-0000-0000-0000-000000beca99', '00000000-0000-0000-0000-00000000b0b2', 'Aéroport (autre tenant, test TMS-2)', 41.2753, 28.7519)
on conflict (id) do nothing;

-- ---- A. Columns exist, and a shipment WITHOUT geography is legal ----------
insert into public.shipment (id, tenant_id, file_id, transport_mode, origin, destination) values
  ('00000000-0000-0000-0000-000000bec501', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000becf01', 'SEA', 'Shanghai', 'Dakar')
on conflict (id) do nothing;

do $$
declare v_nullable int;
begin
  select count(*) into v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'shipment'
     and column_name in ('origin_port_id', 'destination_port_id', 'origin_airport_id', 'destination_airport_id')
     and is_nullable = 'YES';
  if v_nullable <> 4 then
    raise exception 'TMS2-A failed: expected 4 nullable anchor columns, found %', v_nullable;
  end if;
  if not exists (select 1 from public.shipment
                  where id = '00000000-0000-0000-0000-000000bec501'
                    and origin_port_id is null and destination_port_id is null) then
    raise exception 'TMS2-A failed: a shipment without anchors must be legal';
  end if;
end $$;

-- ---- B. Same-tenant anchors accepted --------------------------------------
do $$
begin
  update public.shipment
     set origin_port_id      = '00000000-0000-0000-0000-000000bec002',
         destination_port_id = '00000000-0000-0000-0000-000000bec001'
   where id = '00000000-0000-0000-0000-000000bec501';
  if not exists (select 1 from public.shipment
                  where id = '00000000-0000-0000-0000-000000bec501'
                    and origin_port_id      = '00000000-0000-0000-0000-000000bec002'
                    and destination_port_id = '00000000-0000-0000-0000-000000bec001') then
    raise exception 'TMS2-B failed: same-tenant port anchors were not persisted';
  end if;
  -- airports too (the trigger validates each independently)
  update public.shipment
     set origin_airport_id      = '00000000-0000-0000-0000-000000beca02',
         destination_airport_id = '00000000-0000-0000-0000-000000beca01'
   where id = '00000000-0000-0000-0000-000000bec501';
  update public.shipment
     set origin_airport_id = null, destination_airport_id = null
   where id = '00000000-0000-0000-0000-000000bec501';
end $$;

-- ---- C. Cross-tenant PORT refused -----------------------------------------
do $$
begin
  begin
    update public.shipment
       set origin_port_id = '00000000-0000-0000-0000-000000bec099'
     where id = '00000000-0000-0000-0000-000000bec501';
    raise exception 'TMS2-C failed: a cross-tenant port was accepted';
  exception
    when others then
      if sqlerrm not like '%shipment geo tenant mismatch%' then
        raise exception 'TMS2-C failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- D. Cross-tenant AIRPORT refused --------------------------------------
do $$
begin
  begin
    update public.shipment
       set destination_airport_id = '00000000-0000-0000-0000-000000beca99'
     where id = '00000000-0000-0000-0000-000000bec501';
    raise exception 'TMS2-D failed: a cross-tenant airport was accepted';
  exception
    when others then
      if sqlerrm not like '%shipment geo tenant mismatch%' then
        raise exception 'TMS2-D failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- E. Deleting a referenced port refused by the FK ----------------------
do $$
begin
  begin
    delete from public.ocean_port where id = '00000000-0000-0000-0000-000000bec001';
    raise exception 'TMS2-E failed: deleting a referenced port was accepted';
  exception
    when foreign_key_violation then
      null; -- the referential is load-bearing
  end;
end $$;

rollback;
