# Phase 7.2B — acceptance

## DoD status

| Item | Status |
|---|---|
| Carrier / port / vessel / voyage management | ✅ `/shipping/{carriers,ports,vessels,voyages}` + `manage-actions` |
| Booking & BL via existing shipment (no new root) | ✅ `updateBookingBl` on `shipment` |
| Containers created + linked safely | ✅ `createContainer` (ISO 6346) + `reassignContainer` (confirm, conflict-guard, history preserved) |
| Route legs + port calls planned | ✅ `upsertRouteLeg` (sequence/chronology/continuity), route panel |
| Projection renders via interactive Leaflet | ✅ `shipment-map.tsx` over `ShipmentMapProjection` (lazy) |
| Confirmed/inferred/manual/stale visually distinct | ✅ marker styles (shipping-map-ui.md) |
| Safe manual milestones + corrections | ✅ Tracking Studio + `previewManualEvent` + CAS |
| Timeline searchable/filterable/bounded | ✅ `listShipmentEvents` (filter + paginate) + detail timeline |
| Attention alerts derived honestly | ✅ `/shipping/alerts` from pure `deriveShipmentAlerts` (read-only) |
| Dashboard metrics link to lists | ✅ dashboard StatCard hrefs + management/alerts links |
| Shipping ↔ Customs connected, no duplication | ✅ read-only summary + links (shipping-customs-handoff.md) |
| Documents via existing system | ✅ `listDocuments(fileId)` (document:read + visibility) |
| Permissions + audit enforced | ✅ transport:read/update/manage; safe audit events |
| Tenant isolation CI-proven | ✅ `rls_shipping_test.sql` (containers/events/carrier + write-reject) |
| No external integration claim | ✅ no live call; stubs unchanged |
| tests/typecheck/build/RLS/CI | ✅ (below) |

## Operator acceptance scenario (manual, no external APIs, no production data)

1. **Create ocean shipment** — a SEA `shipment` on an operational file (existing flow).
2. **Assign carrier** — create the carrier under `/shipping/carriers`; set it on the
   shipment via booking/BL panel.
3. **Add booking & BL** — booking reference + status + master/house BL (ops panel).
4. **Create containers** — ISO 6346 numbers on the shipment (ops panel → `createContainer`).
5. **Assign vessel & voyage** — create under `/shipping/vessels` and `/shipping/voyages`
   (IMO/MMSI validated; arrival ≥ departure).
6. **Build route with transshipment** — add route legs (origin→transship→destination);
   discontinuities are warned, not blocked; planned dates stay distinct from actuals.
7. **Enter manual milestones** — Tracking Studio: BOOKING_CONFIRMED → … → VESSEL_DEPARTED →
   IN_TRANSIT → TRANSSHIPMENT_* → VESSEL_ARRIVED → DISCHARGED; corrections require confirm.
8. **Inspect map & timeline** — Leaflet renders origin/destination/route/current marker
   (confidence + freshness styled); the immutable timeline lists every event.
9. **Observe ETA & alerts** — update the ETA (with provenance); slips + stale tracking appear
   on the dashboard and `/shipping/alerts`.
10. **Connect to Customs Intelligence** — the shipment shows the safe customs summary and a
    link to `/customs/intelligence`; customs stays authoritative.
11. **Complete delivery** — AVAILABLE_FOR_PICKUP → GATE_OUT → DELIVERED → EMPTY_RETURNED →
    COMPLETED.

## Verification

- `npx tsc --noEmit` clean (run AFTER tests — vitest does not typecheck test files).
- `npx next build` clean. Route sizes: `/shipping` 256 B; management pages ~188 B; detail
  6.57 kB (First-Load ≈ 103 kB — Leaflet lazy-loaded as a separate chunk, absent elsewhere).
- Full vitest: **1974 passed** (27 new in `tests/shipping-operations.test.ts`).
- Tenant-scope leak guard: green. CI RLS job runs `rls_shipping_test.sql`.

## Remaining work for Phase 7.2C

- Real carrier + AIS adapters (only after verified contracts); populate status maps.
- Port-call editor UI; per-leg actual-date capture; richer container filters (carrier/
  milestone/stale/exception via inner joins).
- Alert acknowledge/dismiss persistence (needs a new contract) + approved notification
  delivery.
- Voyage detail page + shipment↔voyage linking UI; document upload from the shipping surface
  (reusing the existing uploader).
