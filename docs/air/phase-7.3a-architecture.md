# Phase 7.3A — Air Cargo Platform architecture

Air Cargo is the **sibling** of Ocean Shipping (7.2). It reuses the generic logistics engine
and adds only air-specific vocabulary and relational data. NO live airline/IATA/FlightRadar/
ADS-B; no OCR/AI/notifications/billing.

## Reuse analysis (what is reused / extended / new)

| Concern | Decision | Source |
|---|---|---|
| Operational root | **Reuse** — air shipment = `shipment` with `transport_mode='AIR'` (no new root) | 7.1.2 |
| Freshness engine | **Reuse (import)** — per-source `classifyFreshness` | `lib/shipping/intelligence/freshness.ts` |
| ETA provenance | **Reuse (import)** — `applyEta`, `detectEtaChange` | `lib/shipping/intelligence/eta.ts` |
| Tracking event helpers | **Reuse (import)** — `eventFingerprint`, `dedupeEvents`, `sortEvents` | `lib/shipping/intelligence/events.ts` |
| Position CONTRACT | **Reuse type** `ResolvedPosition`; air-specific resolver instance | `.../position.ts` |
| Map projection | **Reuse (import)** — `buildShipmentMapProjection`, `ShipmentMapProjection` (added an optional per-marker `label` so air milestones label correctly — additive, non-breaking) | `.../map-projection.ts` |
| Leaflet renderer | **Reuse the SAME component** — `ShipmentMapLoader`/`shipment-map.tsx` consumes the shared projection | `components/shipping/*` |
| Customs summary | **Reuse (import)** — read-only `getShipmentCustomsSummary` | `.../customs-link.ts` |
| Documents | **Reuse** — `listDocuments(fileId)` (document RLS boundary) | `lib/documents/service.ts` |
| Permissions | **Reuse** `transport:read/update/manage` — no new permission | seed |
| Audit | **Reuse** `writeAudit` + safe metadata; add `air.*` action codes | `lib/audit/*` |
| Coordinate validation | **Reuse (import)** `isValidCoordinate`, `normalizeReference` | `.../validators.ts`, `.../manage-validate.ts` |
| CAS transitions | **Reuse pattern** — `air_tracking_version` compare-and-set on `shipment` | 7.2 |

**Intentionally new (air vocabulary + relations):** air milestones, IATA/ICAO validators, air
domain types, an air event VOCABULARY + a dedicated `air_tracking_event` store (sibling to
`ocean_tracking_event`), an air position resolver (airport anchor → flight position →
manual → unavailable), air dashboard/alert contracts, and the `AirCargoEngine` provider
(`ManualAirProvider` + `AirlineProvider` stub).

## Persistence (siblings, not duplicates)

Additive `shipment` columns: `air_milestone`, `air_provider_code`, `airline_id`,
`air_tracking_version`. New tables (all tenant-scoped, RLS `transport:read`, service-role
writes): `air_airline`, `air_airport`, `air_flight`, `air_flight_leg`, `air_awb`
(shipment↔flight link + MAWB/HAWB), `air_uld`, `air_cargo_piece`, `air_tracking_event`. No
new permission, no new document store, no second customs authority.

## Boundary

Air CONSUMES a read-only customs summary and links to `/customs/intelligence`; it never
writes customs. The airline/AIS-equivalent providers are honest stubs (`not_configured`/
`unsupported`) with a readiness checklist — no invented URL, credential, status vocabulary,
or env var. No public tracking route.
