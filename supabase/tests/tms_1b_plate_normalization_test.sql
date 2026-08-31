-- ===========================================================================
-- TMS-1B — normalized registration identity, proven live.
-- ---------------------------------------------------------------------------
--   A. the four formatting variants of one plate are ONE vehicle: case,
--      spaces and separators all refuse as duplicates of the stored form
--   B. a RETIRED vehicle's plate still blocks an active twin — reactivate,
--      never duplicate
--   C. genuinely distinct plates still register (the rule is identity, not
--      similarity)
--   D. the stored form is untouched — what was typed is what is displayed
--   E. deletion of a vehicle with mission history is refused by the DATABASE
--      (FK NO ACTION) even when application checks are bypassed
--   F. both uniqueness indexes are present: 117's and the normalized one
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001b0001', 'tms1b-steward@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000001b0001', '00000000-0000-0000-0000-000000000001', 'tms1b-steward@test.local', 'active')
on conflict (id) do nothing;

-- The canonical stored form, typed with hyphens on purpose: D proves it stays.
insert into public.vehicle (id, tenant_id, registration, vehicle_type) values
  ('00000000-0000-0000-0000-0000001b0e01', '00000000-0000-0000-0000-000000000001', 'ZT-914-KX', 'CAMION')
on conflict (id) do nothing;

-- ---- A. formatting is not identity ----------------------------------------
do $$
declare
  v_variant text;
begin
  foreach v_variant in array array['ZT914KX', 'zt914kx', 'zt-914-kx', 'ZT 914 KX', 'ZT.914.KX']
  loop
    begin
      insert into public.vehicle (tenant_id, registration)
        values ('00000000-0000-0000-0000-000000000001', v_variant);
      raise exception 'TMS1B-A failed: variant % was accepted as a NEW vehicle', v_variant;
    exception
      when unique_violation then null;   -- one plate, one vehicle
    end;
  end loop;
end $$;

-- ---- B. a retired plate still blocks a twin -------------------------------
do $$
begin
  -- Retire the vehicle through the governed act (motif + actor, TMS-1A).
  update public.vehicle
     set is_active = false,
         retired_reason = 'Vente (test TMS-1B)',
         retired_by = '00000000-0000-0000-0000-0000001b0001'
   where id = '00000000-0000-0000-0000-0000001b0e01';

  begin
    insert into public.vehicle (tenant_id, registration)
      values ('00000000-0000-0000-0000-000000000001', 'ZT 914 KX');
    raise exception 'TMS1B-B failed: a retired plate was re-registered as a new vehicle';
  exception
    when unique_violation then null;     -- reactivate, never duplicate
  end;

  -- …and reactivation is the sanctioned way back.
  update public.vehicle set is_active = true
   where id = '00000000-0000-0000-0000-0000001b0e01';
end $$;

-- ---- C. distinct plates still register ------------------------------------
insert into public.vehicle (id, tenant_id, registration, vehicle_type) values
  ('00000000-0000-0000-0000-0000001b0e02', '00000000-0000-0000-0000-000000000001', 'ZT-915-KX', 'CAMION');

-- ---- D. the stored form is EXACTLY what was typed -------------------------
do $$
declare v_reg text;
begin
  select registration into v_reg from public.vehicle
   where id = '00000000-0000-0000-0000-0000001b0e01';
  if v_reg <> 'ZT-914-KX' then
    raise exception 'TMS1B-D failed: the stored registration was rewritten (got %)', v_reg;
  end if;
end $$;

-- ---- E. mission history blocks deletion AT THE DATABASE -------------------
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000001b00c1', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-1B)')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-0000001b00f1', '00000000-0000-0000-0000-000000000001', 'TMS1B-0001', 'TRP',
   '00000000-0000-0000-0000-0000001b00c1', 'OPENED')
on conflict (id) do nothing;
insert into public.transport_record (id, tenant_id, file_id, status, vehicle_id) values
  ('00000000-0000-0000-0000-0000001b0d01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001b00f1', 'PLANNED', '00000000-0000-0000-0000-0000001b0e01')
on conflict (id) do nothing;

do $$
begin
  begin
    delete from public.vehicle where id = '00000000-0000-0000-0000-0000001b0e01';
    raise exception 'TMS1B-E failed: a vehicle with mission history was deleted';
  exception
    when foreign_key_violation then null;  -- the FK is the backstop, app checks aside
  end;
end $$;

-- ---- F. both indexes present ----------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_indexes
   where schemaname = 'public'
     and indexname in ('uq_vehicle_registration', 'uq_vehicle_registration_normalized');
  if v_n <> 2 then
    raise exception 'TMS1B-F failed: expected both uniqueness indexes, found %', v_n;
  end if;
end $$;

do $$ begin raise notice 'TMS1B OK: formatting is not identity; retired plates block twins; stored text untouched; FK blocks history deletion; both indexes live'; end $$;

rollback;
