-- ===========================================================================
-- TMS-6 — Subcontractors / external transport, proven live.
-- ---------------------------------------------------------------------------
--   A. a provider registers; the name is unique per tenant (case/space-insensitive)
--   B. THE EXECUTION-SOURCE INVARIANT: fleet vehicle and external provider are
--      mutually exclusive on one transport — both together is REFUSED
--   C. a SUSPENDED or retired provider cannot be bound; an APPROVED one can
--   D. cross-tenant provider binding is refused
--   E. switching from fleet to provider works when the other side is cleared,
--      and transport_company (the historical carrier name) survives
--
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-000000000001', 'Effitrans (test)', 'SN'),
  ('00000000-0000-0000-0000-0000000051b2', 'Autre organisation (test TMS-6)', 'SN')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000051c1', '00000000-0000-0000-0000-000000000001', 'Client (test TMS-6)')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-000000000001', 'TMS6-0001', 'TRP',
   '00000000-0000-0000-0000-0000000051c1', 'OPENED')
on conflict (id) do nothing;

-- An AVAILABLE fleet vehicle (TMS-5) to prove the exclusion against.
insert into public.vehicle (id, tenant_id, registration, vehicle_type) values
  ('00000000-0000-0000-0000-0000000051e1', '00000000-0000-0000-0000-000000000001', 'TMS6-VEH-01', 'CAMION')
on conflict (id) do nothing;

insert into public.transport_provider (id, tenant_id, name, status) values
  ('00000000-0000-0000-0000-0000000051a1', '00000000-0000-0000-0000-000000000001', 'Sous-traitant A (test)', 'APPROVED'),
  ('00000000-0000-0000-0000-0000000051a2', '00000000-0000-0000-0000-000000000001', 'Sous-traitant B (test)', 'SUSPENDED'),
  ('00000000-0000-0000-0000-0000000051a9', '00000000-0000-0000-0000-0000000051b2', 'Sous-traitant (autre tenant)', 'APPROVED')
on conflict (id) do nothing;

insert into public.transport_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000051d1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000051f1', 'PLANNED')
on conflict (id) do nothing;

-- ---- A. Name uniqueness, normalized ---------------------------------------
do $$
begin
  begin
    insert into public.transport_provider (tenant_id, name)
      values ('00000000-0000-0000-0000-000000000001', '  sous-traitant a (TEST) ');
    raise exception 'TMS6-A failed: a duplicate provider name was accepted';
  exception
    when unique_violation then null;
  end;
end $$;

-- ---- C. Only an APPROVED, active provider may be bound ---------------------
do $$
begin
  begin
    update public.transport_record set provider_id = '00000000-0000-0000-0000-0000000051a2'
     where id = '00000000-0000-0000-0000-0000000051d1';
    raise exception 'TMS6-C failed: a SUSPENDED provider was bound';
  exception
    when others then
      if sqlerrm not like '%pas agréé%' then
        raise exception 'TMS6-C failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;

  update public.transport_provider set is_active = false
   where id = '00000000-0000-0000-0000-0000000051a1';
  begin
    update public.transport_record set provider_id = '00000000-0000-0000-0000-0000000051a1'
     where id = '00000000-0000-0000-0000-0000000051d1';
    raise exception 'TMS6-C failed: a retired provider was bound';
  exception
    when others then
      if sqlerrm not like '%retiré du répertoire%' then
        raise exception 'TMS6-C failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
  update public.transport_provider set is_active = true
   where id = '00000000-0000-0000-0000-0000000051a1';
end $$;

-- ---- D. Cross-tenant provider refused --------------------------------------
do $$
begin
  begin
    update public.transport_record set provider_id = '00000000-0000-0000-0000-0000000051a9'
     where id = '00000000-0000-0000-0000-0000000051d1';
    raise exception 'TMS6-D failed: a cross-tenant provider was bound';
  exception
    when others then
      if sqlerrm not like '%tenant mismatch%' then
        raise exception 'TMS6-D failed: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;

-- ---- B. THE EXECUTION-SOURCE INVARIANT ------------------------------------
do $$
begin
  -- internal execution first
  update public.transport_record set vehicle_id = '00000000-0000-0000-0000-0000000051e1'
   where id = '00000000-0000-0000-0000-0000000051d1';

  begin
    update public.transport_record set provider_id = '00000000-0000-0000-0000-0000000051a1'
     where id = '00000000-0000-0000-0000-0000000051d1';
    raise exception 'TMS6-B failed: one transport was recorded as BOTH fleet and external execution';
  exception
    when check_violation then null;   -- transport_execution_source_exclusive
  end;
end $$;

-- ---- E. Switching sides works when the other is cleared -------------------
do $$
begin
  update public.transport_record
     set vehicle_id = null,
         provider_id = '00000000-0000-0000-0000-0000000051a1',
         transport_company = 'Sous-traitant A (test)'   -- historical name snapshot
   where id = '00000000-0000-0000-0000-0000000051d1';

  if not exists (select 1 from public.transport_record
                  where id = '00000000-0000-0000-0000-0000000051d1'
                    and provider_id = '00000000-0000-0000-0000-0000000051a1'
                    and vehicle_id is null
                    and transport_company = 'Sous-traitant A (test)') then
    raise exception 'TMS6-E failed: the external binding or its carrier-name snapshot did not persist';
  end if;

  -- Renaming the registry row must NOT rewrite what the past transport says.
  update public.transport_provider set name = 'Sous-traitant A (renommé)'
   where id = '00000000-0000-0000-0000-0000000051a1';
  if not exists (select 1 from public.transport_record
                  where id = '00000000-0000-0000-0000-0000000051d1'
                    and transport_company = 'Sous-traitant A (test)') then
    raise exception 'TMS6-E failed: a provider rename rewrote historical carrier identity';
  end if;
end $$;

rollback;
