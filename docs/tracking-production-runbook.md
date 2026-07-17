# Interactive Tracking — Production Runbook (Phase 8.4)

## Migration

`20260721000001_transport_manage.sql` — forward-only, additive:
- catalogs `transport:manage` + grants it to SYSTEM_ADMIN, OPS_SUPERVISOR, COORDINATOR,
  TRANSPORT_OFFICER (clean-replay-safe select-driven grant);
- adds coordinate-range CHECK constraints to `ocean_port`, `air_airport`,
  `ocean_tracking_event`, `air_tracking_event`, `tracking_position`.

Apply with `supabase db push`. No data is written; no destructive operation.

## Enable in production (operator steps — production is never auto-seeded)

1. **Apply the migration** to production.
2. **Verify the permission grant reached the existing tenant** (Effitrans is a pre-migration
   tenant, so the seed-style grant only covers the reference tenant; run for the live tenant):
   ```sql
   insert into public.role_permission (role_id, permission_id)
   select r.id, p.id from public.role r
   join public.permission p on p.code = 'transport:manage'
   where r.tenant_id = '<EFFITRANS_TENANT_ID>'
     and r.code in ('SYSTEM_ADMIN','OPS_SUPERVISOR','COORDINATOR','TRANSPORT_OFFICER')
   on conflict do nothing;
   ```
   (Same pattern every prior permission migration needed for the live tenant.)
3. **Enter port coordinates** through the app: Shipping → Ports → edit « Port de Dakar » /
   « Port de Shanghai » → set Lat/Lon (public-domain values below), Save. Repeat Airports for
   DSS/CDG. A COORDINATOR/OPS_SUPERVISOR can now do this (was impossible before the fix).
   Verified canonical coordinates (World Port Index / OurAirports, public domain):
   - Port de Dakar `14.683, -17.417` · Port de Shanghai `31.233, 121.483`
   - DSS/GOBD `14.670833, -17.072778` · CDG/LFPG `49.009722, 2.547778`
4. **Open the Shanghai→Dakar shipment**: with both ports now geocoded, the map renders (planned
   dashed origin→destination); enter a manual position to see the current-position marker.
5. **Verify RLS** unchanged (CI already proves it) and **customer isolation** (portal user sees
   only own shipment).

## Rollback / disable

No feature flag gates the ocean/air map (it degrades to the honest textual state on its own).
To retract:
- **Coordinates**: clear a port's Lat/Lon in the admin form → its shipments fall back to
  « Carte indisponible » (textual tracking preserved). Non-destructive.
- **Permission**: revoke `transport:manage` from roles to re-lock coordinate entry (existing
  coordinates stay).
- **Migration**: forward-only; the CHECK constraints and permission are additive and safe to
  leave. A corrective migration would drop the constraints/permission if ever required.
- Tracking HISTORY (the immutable journals) is never removed by any rollback.

## Health check

`/platform/operations` shows deployment + migration state; the shipping dashboard's provider
panel honestly shows AIS/carrier « Non connecté ». The map's own no-coordinate and stale states
are the in-page health signals.
