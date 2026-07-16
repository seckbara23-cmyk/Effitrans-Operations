# Phase 7.3A — Air Cargo domain model

Provider-neutral air domain. Types in `lib/air/intelligence/domain.ts`; milestones in
`milestones.ts`; events in `events.ts`; validators in `validators.ts`. Reuses the shipment
root; adds air relations.

## Relationships

```
operational_file (reuse)
  └─ shipment (reuse; transport_mode='AIR'; +air_milestone, air_provider_code, airline_id, air_tracking_version)
       ├─ air_awb (0..1; shipment↔flight link; MAWB/HAWB, status)
       ├─ air_uld (0..n; ULD number/type/owner/status; linked flight)
       ├─ air_cargo_piece (0..n; pieces/weight/volume/dims/DGR/temp; linked ULD)
       └─ air_tracking_event (0..n; immutable, deduped)
  air_airline (name/IATA/ICAO) ─ air_flight (number, airports, times, status) ─ air_flight_leg (seq, airports, connection, times)
  air_airport (IATA/ICAO, city/country, lat/lon, tz)
```

## Validation (`validators.ts`)

- **IATA** — airline 2 alnum (`AF`), airport 3 letters (`DKR`). **ICAO** — airline 3 letters
  (`AFR`), airport 4 letters (`GOBD`). Distinct systems, validated separately.
- **WGS84** coordinate — reused from the shipping validators (`isValidCoordinate`).
- Total (never throw); optional codes allowed empty.

## Canonical milestones (`milestones.ts`)

13: `BOOKED, ACCEPTED, SECURITY, READY_FOR_FLIGHT, LOADED, DEPARTED, ARRIVED, TRANSFER,
CUSTOMS, RELEASED, DELIVERED, EXCEPTION, CANCELLED`. `classifyAirMilestone` mirrors the ocean
model: validate only the impossible (leaving DELIVERED/CANCELLED); classify advance / repeat
/ regress(correction) / exception / cancel. EXCEPTION is a resolvable hold.

## Tracking events (`events.ts`)

Air vocabulary `AIR_EVENTS` (milestones + POSITION_UPDATE + ETA_UPDATE); the fingerprint /
dedupe / sort helpers are **imported from the shipping layer** (no duplicate engine). Stored
in the dedicated append-only `air_tracking_event` (unique `(tenant,shipment,fingerprint)`).

## Reuse (siblings, not duplicates)

Freshness, ETA provenance, position CONTRACT, map projection, customs summary, Leaflet
renderer, permissions, audit — all reused from the shipping/customs/document layers. Only air
vocabulary + relations are new.
