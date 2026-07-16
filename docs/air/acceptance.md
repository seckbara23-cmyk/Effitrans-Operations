# Phase 7.3A — Air Cargo foundation: acceptance

## DoD status

| Item | Status |
|---|---|
| Airports work | ✅ `/air/airports` + create/retire (IATA/ICAO/WGS84 validated) |
| Airlines work | ✅ `/air/airlines` + create/retire |
| Flights work | ✅ `/air/flights` + create (chronology + in-tenant airports/airline) |
| Flight legs work | ✅ `upsertFlightLeg` (sequence, chronology, in-tenant airports) |
| AWBs work | ✅ `air_awb` (MAWB/HAWB, shipment↔flight); no new shipment root |
| ULDs work | ✅ `air_uld` create + list |
| Cargo pieces work | ✅ `air_cargo_piece` (DGR/temp flags) |
| Milestones exist | ✅ 13 canonical (`milestones.ts`) |
| Manual tracking works | ✅ `addManualAirEvent` (validated, MANUAL, dedup, CAS) + studio preview |
| Projection works | ✅ air position → shared `ShipmentMapProjection` |
| Leaflet renders air routes | ✅ shared `ShipmentMapLoader` (lazy) on detail |
| Alerts derive correctly | ✅ `/air/alerts` from pure `deriveAirAlerts` |
| Dashboard contracts exist | ✅ `buildAirDashboard` + `/air` |
| Customs links exist | ✅ read-only `getShipmentCustomsSummary` + `/customs/intelligence` |
| Documents reuse storage | ✅ `listDocuments(fileId)` |
| Provider abstraction exists | ✅ `AirCargoEngine` + Manual + Airline stub |
| Tenant isolation proven | ✅ `rls_air_test.sql` (bidirectional + write-reject) |
| No external integration claimed | ✅ stubs `not_configured`; no invented endpoints/env |

## Operator acceptance scenario (manual; no airline API; no production data)

1. Create an AIR shipment (existing flow; `transport_mode='AIR'`).
2. Create airline + origin/destination airports (`/air/airlines`, `/air/airports`).
3. Create a flight (chronology validated) (`/air/flights`).
4. On the shipment detail: set MAWB/HAWB + link the flight (AWB form); add ULDs; add cargo
   pieces (DGR/temp).
5. Enter manual milestones in the studio: ACCEPTED → SECURITY → READY_FOR_FLIGHT → LOADED →
   DEPARTED → (TRANSFER) → ARRIVED → CUSTOMS → RELEASED; corrections require confirmation.
6. Inspect the map (Leaflet, current position + airport markers, confidence/freshness styled)
   and the immutable timeline.
7. Update the ETA (with provenance); delays + stale tracking appear on the dashboard and
   `/air/alerts`.
8. Connect to Customs Intelligence via the read-only summary + link; customs stays
   authoritative.
9. Complete: DELIVERED.

## Verification

- `npx tsc --noEmit` clean (run AFTER tests). `npx next build` clean. Routes: `/air` 265 B;
  management ~188 B; detail 5.92 kB (First-Load ≈102 kB — Leaflet lazy).
- Full vitest: **1994 passed** (20 new in `tests/air-cargo.test.ts`).
- Tenant-scope leak guard green. CI RLS job runs `rls_air_test.sql`.

## Remaining work — Phase 7.3B (Airline Integration & Live Flight Operations)

- Real airline/cargo adapters (only after verified contracts); populate `AIRLINE_STATUS_MAP`.
- Licensed flight-position / ADS-B feed → aircraft-position inference end-to-end.
- Flight-leg / connection editor UI; ULD reassign; cargo edit; AWB document upload from the
  air surface.
- Alert acknowledge/dismiss persistence + approved notification delivery.
