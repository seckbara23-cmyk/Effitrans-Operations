-- ===========================================================================
-- TMS-1A — vehicle retirement, proven live.
-- ---------------------------------------------------------------------------
--   A. retiring a vehicle bound to a LIVE mission is refused, naming the
--      dossier; the same flip succeeds once the mission has released it
--   B. a retirement without a motif, or without an actor, is refused BY THE
--      DATABASE — no path around the action can skip either
--   C. retired_at is DATABASE time (transaction_timestamp), never a client's
--   D. a retired vehicle cannot be bound to a new transport (117's interlock,
--      re-proven against the retirement flip)
--   E. intervention history SURVIVES retirement
--   F. reactivation clears the retirement record and the vehicle is bindable
--      again; the coherence CHECK refuses a half-retired row
--   G. the bind-side read is lock-ordered (FOR SHARE in the function source,
--      comments stripped first)
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001a0001', 'tms1a-steward@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000001a0001', '00000000-0000-0000-0000-000000000001', 'tms1a-steward@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000001a00c1', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-1A)')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-0000001a00f1', '00000000-0000-0000-0000-000000000001', 'TMS1A-0001', 'TRP',
   '00000000-0000-0000-0000-0000001a00c1', 'OPENED'),
  ('00000000-0000-0000-0000-0000001a00f2', '00000000-0000-0000-0000-000000000001', 'TMS1A-0002', 'TRP',
   '00000000-0000-0000-0000-0000001a00c1', 'OPENED')
on conflict (id) do nothing;

insert into public.vehicle (id, tenant_id, registration, internal_code, vehicle_type) values
  ('00000000-0000-0000-0000-0000001a0e01', '00000000-0000-0000-0000-000000000001', 'TMS1A-DK-01', 'T1A-01', 'CAMION')
on conflict (id) do nothing;

-- The vehicle carries an intervention BEFORE retirement — E proves it survives.
insert into public.vehicle_maintenance (id, tenant_id, vehicle_id, kind, status, immobilizing, description, opened_on, closed_on, resolution) values
  ('00000000-0000-0000-0000-0000001a0a01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001a0e01', 'PLANNED', 'CLOSED', true, 'Vidange (test TMS-1A)', current_date - 30, current_date - 29, 'OK')
on conflict (id) do nothing;

-- Bind it to a LIVE mission.
insert into public.transport_record (id, tenant_id, file_id, status, vehicle_id) values
  ('00000000-0000-0000-0000-0000001a0d01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001a00f1', 'PLANNED', '00000000-0000-0000-0000-0000001a0e01')
on conflict (id) do nothing;

-- ---- A. the mid-mission interlock -----------------------------------------
do $$
begin
  begin
    update public.vehicle
       set is_active = false,
           retired_reason = 'Vente (test)',
           retired_by = '00000000-0000-0000-0000-0000001a0001'
     where id = '00000000-0000-0000-0000-0000001a0e01';
    raise exception 'TMS1A-A failed: a vehicle on a live mission was retired';
  exception
    when others then
      if sqlerrm not like '%mission en cours%' or sqlerrm not like '%TMS1A-0001%' then
        raise exception 'TMS1A-A failed: refused for the wrong reason or without naming the dossier: %', sqlerrm;
      end if;
  end;
end $$;

-- The mission completes; the truck is released.
update public.transport_record set status = 'DELIVERED'
 where id = '00000000-0000-0000-0000-0000001a0d01';

-- ---- B. motif and actor are mandatory AT THE DATABASE ----------------------
do $$
begin
  begin
    update public.vehicle set is_active = false, retired_reason = '   ',
           retired_by = '00000000-0000-0000-0000-0000001a0001'
     where id = '00000000-0000-0000-0000-0000001a0e01';
    raise exception 'TMS1A-B failed: a blank motif was accepted';
  exception when others then
    if sqlerrm not like '%motif est obligatoire%' then
      raise exception 'TMS1A-B failed (motif): %', sqlerrm;
    end if;
  end;

  begin
    update public.vehicle set is_active = false, retired_reason = 'Vente (test)'
     where id = '00000000-0000-0000-0000-0000001a0e01';
    raise exception 'TMS1A-B failed: a retirement without an actor was accepted';
  exception when others then
    if sqlerrm not like '%acteur du retrait%' then
      raise exception 'TMS1A-B failed (acteur): %', sqlerrm;
    end if;
  end;
end $$;

-- ---- C. the flip succeeds, database-timed ---------------------------------
do $$
declare v record;
begin
  update public.vehicle
     set is_active = false,
         retired_reason = 'Vente (test TMS-1A)',
         retired_by = '00000000-0000-0000-0000-0000001a0001',
         -- a client-supplied instant is OVERWRITTEN by the guard:
         retired_at = '1999-01-01T00:00:00Z'
   where id = '00000000-0000-0000-0000-0000001a0e01';

  select * into v from public.vehicle where id = '00000000-0000-0000-0000-0000001a0e01';
  if v.is_active then raise exception 'TMS1A-C failed: the retirement did not take'; end if;
  if v.retired_at is distinct from transaction_timestamp() then
    raise exception 'TMS1A-C failed: retired_at is not database time (got %)', v.retired_at;
  end if;
  if v.retired_reason <> 'Vente (test TMS-1A)' then
    raise exception 'TMS1A-C failed: the motif was not preserved';
  end if;
end $$;

-- ---- D. a retired vehicle cannot be bound ---------------------------------
insert into public.transport_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000001a0d02', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000001a00f2', 'PLANNED')
on conflict (id) do nothing;

do $$
begin
  begin
    update public.transport_record set vehicle_id = '00000000-0000-0000-0000-0000001a0e01'
     where id = '00000000-0000-0000-0000-0000001a0d02';
    raise exception 'TMS1A-D failed: a retired vehicle was bound to a transport';
  exception when others then
    if sqlerrm not like '%retiré du parc%' then
      raise exception 'TMS1A-D failed: refused for the wrong reason: %', sqlerrm;
    end if;
  end;
end $$;

-- ---- E. history survives ---------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.vehicle_maintenance
   where vehicle_id = '00000000-0000-0000-0000-0000001a0e01';
  if n <> 1 then
    raise exception 'TMS1A-E failed: intervention history did not survive retirement (found %)', n;
  end if;
end $$;

-- ---- F. reactivation clears the record; coherence is a CHECK ---------------
do $$
declare v record;
begin
  update public.vehicle set is_active = true
   where id = '00000000-0000-0000-0000-0000001a0e01';
  select * into v from public.vehicle where id = '00000000-0000-0000-0000-0000001a0e01';
  if v.retired_at is not null or v.retired_reason is not null or v.retired_by is not null then
    raise exception 'TMS1A-F failed: reactivation left retirement residue';
  end if;

  -- …and bindable again (status untouched by the flip: still AVAILABLE).
  update public.transport_record set vehicle_id = '00000000-0000-0000-0000-0000001a0e01'
   where id = '00000000-0000-0000-0000-0000001a0d02';

  -- A half-retired row (reason planted on an ACTIVE vehicle) is refused by
  -- the coherence CHECK, whatever path writes it.
  begin
    update public.vehicle set retired_reason = 'résidu'
     where id = '00000000-0000-0000-0000-0000001a0e01';
    raise exception 'TMS1A-F failed: an active vehicle accepted retirement residue';
  exception when check_violation then null;
  end;
end $$;

-- ---- G. the bind-side read is lock-ordered --------------------------------
do $$
declare v_src text;
begin
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc where proname = 'enforce_transport_vehicle';
  if position('for share' in lower(v_src)) = 0 then
    raise exception 'TMS1A-G failed: enforce_transport_vehicle reads the vehicle without FOR SHARE — the retire/bind race is open';
  end if;
end $$;

do $$ begin raise notice 'TMS1A OK: mid-mission refusal (naming the dossier), motif+acteur mandatory DB-side, database-timed, bind interlock intact, history preserved, reactivation clean, race lock-ordered'; end $$;

rollback;
