-- 20260717000001_portal_ocean_air_visibility.sql
-- Effitrans Operations Platform — PHASE 7.5A: expose ocean/air shipment tracking to the portal.
--
-- Additive ONLY. The ocean_* / air_* tracking tables were staff-only (transport:read). A customer
-- portal user holds NO staff permission, so they see NOTHING there today — the tracking page can't
-- show vessel/flight or the container/ULD list. This migration adds tenant + customer + portal-
-- account scoped SELECT policies (OR'd with the staff policies, which are never weakened) on the
-- SHIPMENT-LINKED child tables only. Reference catalog tables (vessel/port/airline/airport/flight)
-- are deliberately NOT exposed to the portal — names reach the portal via denormalized event fields
-- or a server-side lookup scoped to the owned shipment. No new table, column, or permission.

-- Customer + portal-account scope for a shipment: the caller's own client owns the file the
-- shipment belongs to, in the caller's tenant, and the portal user is ACTIVE. SECURITY DEFINER so
-- it can join the base tables without recursing into their RLS (mirrors portal_can_read_file).
create or replace function public.portal_can_read_shipment(p_shipment uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.shipment s
    join public.operational_file f on f.id = s.file_id
    join public.client_user cu on cu.client_id = f.client_id
    where s.id = p_shipment
      and cu.id = auth.uid()
      and cu.status = 'ACTIVE'
      and cu.tenant_id = f.tenant_id
  );
$$;

-- Ocean — shipment-linked child tables the portal tracking read consumes.
create policy ocean_container_portal_select on public.ocean_container for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));
create policy ocean_tracking_event_portal_select on public.ocean_tracking_event for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));

-- Air — shipment-linked child tables (AWB, ULDs, cargo pieces, tracking events).
create policy air_awb_portal_select on public.air_awb for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));
create policy air_uld_portal_select on public.air_uld for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));
create policy air_cargo_piece_portal_select on public.air_cargo_piece for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));
create policy air_tracking_event_portal_select on public.air_tracking_event for select to authenticated
  using (public.portal_can_read_shipment(shipment_id));

-- SELECT is already granted to authenticated on these tables (see the ocean/air platform
-- migrations); RLS is what gates. No additional grant required.
