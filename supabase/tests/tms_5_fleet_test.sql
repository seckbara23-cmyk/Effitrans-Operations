-- ===========================================================================
-- TMS-5 — Parc & Flotte, proven live.
-- ---------------------------------------------------------------------------
--   A. a vehicle registers; immatriculation is unique per tenant (case- and
--      space-insensitive)
--   B. THE INTERLOCK: a transport cannot be bound to a MAINTENANCE, an
--      OUT_OF_SERVICE, or a retired vehicle — refused DB-side
--   C. an AVAILABLE vehicle binds, and vehicle_plate still works alongside for
--      an external/hired vehicle (the TMS-6 boundary survives)
--   D. cross-tenant geography of the parc is refused (vehicle, compliance,
--      maintenance)
--   E. one OPEN immobilizing intervention per vehicle (database invariant)
--
-- « En mission » is DERIVED from transport_record and therefore has no column
-- to test here: the status CHECK refusing an ASSIGNED value is asserted by the
-- migration itself (7b) and pinned in vitest.
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN'),
  ('00000000-0000-0000-0000-00000000fee2', 'Autre organisation (test TMS-5)', 'SN')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000fec1', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-5)')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000fef1', '00000000-0000-0000-0000-000000000001', 'TMS5-0001', 'TRP',
   '00000000-0000-0000-0000-00000000fec1', 'OPENED')
on conflict (id) do nothing;

-- ---- A. Registration + uniqueness ----------------------------------------
insert into public.vehicle (id, tenant_id, registration, internal_code, vehicle_type) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-000000000001', 'DK-1234-A', 'CAM-01', 'CAMION'),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-000000000001', 'DK-5678-B', 'CAM-02', 'CAMIONNETTE'),
  ('00000000-0000-0000-0000-00000000fe99', '00000000-0000-0000-0000-00000000fee2', 'XX-0000-Z', 'AUTRE-01', 'CAMION')
on conflict (id) do nothing;

do $$
begin
  begin
    insert into public.vehicle (tenant_id, registration)
      values ('00000000-0000-0000-0000-000000000001', '  dk-1234-a ');
    raise exception 'TMS5-A failed: a duplicate immatriculation was accepted';
  exception
    when unique_violation then null;   -- normalized uniqueness holds
  end;
end $$;

-- ---- B. THE INTERLOCK -----------------------------------------------------
insert into public.transport_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-00000000fed1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fef1', 'PLANNED')
on conflict (id) do nothing;

do $$
begin
  -- immobilized
  update public.vehicle set status = 'MAINTENANCE'
   where id = '00000000-0000-0000-0000-00000000fe01';
  begin
    update public.transport_record set vehicle_id = '00000000-0000-0000-0000-00000000fe01'
     where id = '00000000-0000-0000-0000-00000000fed1';
    raise exception 'TMS5-B failed: a vehicle in MAINTENANCE was bound to a transport';
  exception
    when others then
      if sqlerrm not like '%pas disponible%' then
        raise exception 'TMS5-B failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;

  -- out of service
  update public.vehicle set status = 'OUT_OF_SERVICE'
   where id = '00000000-0000-0000-0000-00000000fe01';
  begin
    update public.transport_record set vehicle_id = '00000000-0000-0000-0000-00000000fe01'
     where id = '00000000-0000-0000-0000-00000000fed1';
    raise exception 'TMS5-B failed: an OUT_OF_SERVICE vehicle was bound to a transport';
  exception
    when others then
      if sqlerrm not like '%pas disponible%' then
        raise exception 'TMS5-B failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;

  -- retired from the parc
  update public.vehicle set status = 'AVAILABLE', is_active = false
   where id = '00000000-0000-0000-0000-00000000fe01';
  begin
    update public.transport_record set vehicle_id = '00000000-0000-0000-0000-00000000fe01'
     where id = '00000000-0000-0000-0000-00000000fed1';
    raise exception 'TMS5-B failed: a retired vehicle was bound to a transport';
  exception
    when others then
      if sqlerrm not like '%retiré du parc%' then
        raise exception 'TMS5-B failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;

  -- cross-tenant
  begin
    update public.transport_record set vehicle_id = '00000000-0000-0000-0000-00000000fe99'
     where id = '00000000-0000-0000-0000-00000000fed1';
    raise exception 'TMS5-B failed: a cross-tenant vehicle was bound to a transport';
  exception
    when others then
      if sqlerrm not like '%tenant mismatch%' then
        raise exception 'TMS5-B failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- C. An available vehicle binds; the free-text plate still works --------
do $$
begin
  update public.transport_record
     set vehicle_id = '00000000-0000-0000-0000-00000000fe02',
         vehicle_plate = 'DK-9999-EXT'
   where id = '00000000-0000-0000-0000-00000000fed1';
  if not exists (select 1 from public.transport_record
                  where id = '00000000-0000-0000-0000-00000000fed1'
                    and vehicle_id = '00000000-0000-0000-0000-00000000fe02'
                    and vehicle_plate = 'DK-9999-EXT') then
    raise exception 'TMS5-C failed: the available vehicle did not bind, or the free-text plate was lost';
  end if;
  -- unbinding is always allowed (an external vehicle takes over)
  update public.transport_record set vehicle_id = null
   where id = '00000000-0000-0000-0000-00000000fed1';
end $$;

-- ---- D. Cross-tenant children refused -------------------------------------
do $$
begin
  begin
    insert into public.vehicle_compliance (tenant_id, vehicle_id, type_code, expires_on)
      values ('00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-00000000fe99', 'ASSURANCE', current_date + 30);
    raise exception 'TMS5-D failed: a cross-tenant compliance row was accepted';
  exception
    when others then
      if sqlerrm not like '%vehicle child tenant mismatch%' then
        raise exception 'TMS5-D failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
  begin
    insert into public.vehicle_maintenance (tenant_id, vehicle_id, kind, description)
      values ('00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-00000000fe99', 'PLANNED', 'Vidange (test)');
    raise exception 'TMS5-D failed: a cross-tenant maintenance row was accepted';
  exception
    when others then
      if sqlerrm not like '%vehicle child tenant mismatch%' then
        raise exception 'TMS5-D failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- E. One OPEN immobilizing intervention per vehicle --------------------
do $$
begin
  insert into public.vehicle_maintenance (tenant_id, vehicle_id, kind, description, immobilizing)
    values ('00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-00000000fe02', 'UNPLANNED', 'Freins (test)', true);
  begin
    insert into public.vehicle_maintenance (tenant_id, vehicle_id, kind, description, immobilizing)
      values ('00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-00000000fe02', 'PLANNED', 'Vidange (test)', true);
    raise exception 'TMS5-E failed: a second open immobilizing intervention was accepted';
  exception
    when unique_violation then null;
  end;
  -- a NON-immobilizing intervention may coexist
  insert into public.vehicle_maintenance (tenant_id, vehicle_id, kind, description, immobilizing)
    values ('00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-00000000fe02', 'PLANNED', 'Lavage (test)', false);
end $$;

rollback;
