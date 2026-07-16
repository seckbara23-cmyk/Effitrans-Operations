# Customer Portal — Phase 7.5A Acceptance

**Scope delivered:** *Tracking depth + shared map + RLS* (the increment selected for 7.5A). The
customer portal **foundation already existed** and is production-grade; 7.5A extends it — never
duplicates it (see [architecture.md](./architecture.md)).

## Definition of Done (7.5A DoD)

Customers can:

| DoD item | Status | Notes |
|----------|:------:|-------|
| Login | ✓ (pre-existing) | `client_user` identity, invite/temp-password/reset/disable |
| View only their company's data | ✓ | tenant + customer + portal-account RLS; **extended to ocean/air** in 7.5A (CI-proven) |
| Track shipments | ✓ (deepened) | status/timeline/ETA + **vessel/flight, containers/ULDs, references** (new) |
| View maps | ✓ (consolidated) | now the **shared** provider-neutral projection + renderer (confidence/freshness/warnings) |
| View customs summary | ✓ (pre-existing) | dossier customs status |
| Download documents | ✓ (pre-existing) | APPROVED + shared, signed URL, audited |
| View invoices | ✓ (pre-existing) | read-only ISSUED/PARTIALLY_PAID/PAID |
| Receive notifications | ✓ (pre-existing) | `client_notification` inbox + prefs |
| Message Effitrans | ✓ one-way (pre-existing) | contact→task; two-way thread → 7.5B |
| No internal admin capability exposed | ✓ | no privilege inheritance; portal users hold zero staff permissions |
| Tests, RLS, build, CI green | ✓ | see below |

## What 7.5A changed

- **Migration** [`20260717000001_portal_ocean_air_visibility.sql`](../../supabase/migrations/20260717000001_portal_ocean_air_visibility.sql)
  (additive): `portal_can_read_shipment()` helper + portal SELECT policies on the six shipment-linked
  ocean/air child tables. No new table, column, or permission; reads only.
- **New read** [`lib/portal/carriage.ts`](../../lib/portal/carriage.ts) (`getPortalCarriage`):
  customer-safe vessel/flight + container/ULD list + references + **shared map projection**, ownership
  via the RLS user-context client, reusing `buildShipmentMapProjection` / `resolveCurrentPosition` /
  `resolveAirPosition` (no duplicate map logic). Air airport coordinates via a bounded, tenant-filtered
  service-role lookup of the owned flight (catalog never exposed).
- **UI** [`components/portal/carriage-panel.tsx`](../../components/portal/carriage-panel.tsx) +
  the tracking page now render the **shared** `ShipmentMapLoader` when geo is available, with the
  legacy origin→destination pin map retained only as the road/no-geo fallback.

## Reuse (no duplication)

The customer shipment map now uses the **same** projection + renderer as the internal Ocean/Air
consoles. The legacy `lib/portal/map-points.ts` registry is **retained deliberately** — it is shared
with the driver surface (`lib/driver/service.ts`) and serves the no-geo road fallback — so it is not a
customer-facing duplicate map path.

## Verification

- **Typecheck** (`tsc --noEmit`, tests included): clean.
- **Tests**: `npx vitest run` → **124 files, 2069 passing**, incl.
  [`tests/portal-carriage.test.ts`](../../tests/portal-carriage.test.ts) (shared-projection reuse,
  server-only + RLS ownership, customer-safe projection, additive migration, page consolidation) and
  the service-role tenant-scope guard.
- **Build**: `next build` → compiled successfully; `/portal/files/[id]` emitted.
- **RLS**: [`rls_portal_carriage_test.sql`](../../supabase/tests/rls_portal_carriage_test.sql) proves
  bidirectional customer + tenant isolation on ocean/air child tables, DISABLED-user denial, and
  staff-unaffected — wired into CI.

## Deferred to Phase 7.5B

Company Profile, bounded Search, two-way messaging thread, branding application in the shell,
view-audit events (shipment/timeline/profile viewed), MFA enrollment, a `portal:*` capability catalog
with role differentiation, and per-portal-user auth-layer session revocation.
