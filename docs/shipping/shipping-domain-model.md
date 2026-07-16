# Phase 7.2A — Shipping domain model

Provider-neutral ocean domain. Types live in `lib/shipping/intelligence/domain.ts`; the
canonical milestone lifecycle in `milestones.ts`; tracking events in `events.ts`;
identifier validators in `validators.ts`. Everything is PURE and imports no mapping
library, no carrier SDK, and no DB client.

## Entity relationships

```
operational_file (reuse)
  └─ shipment (reuse; 1:1; extended: ocean_milestone, provider_code, carrier_id,
                booking_reference, master_bl, house_bl, eta_source/confidence/…)
       ├─ ocean_container (0..n; ISO 6346 number, ISO type, seal, status, confidence)
       ├─ ocean_route_leg (0..n; sequence, origin/dest port, mode, vessel/voyage, dates)
       ├─ ocean_port_call (0..n; port, arrival/berth/departure, terminal, source)
       └─ ocean_tracking_event (0..n; immutable normalized events)
  ocean_carrier (tenant ref) ─ ocean_vessel (imo/mmsi/flag) ─ ocean_voyage (ref, ports, dates)
  ocean_port (UN/LOCODE, name, country, lat/lon, tz)
```

## Identifier validation (`validators.ts`)

- **Container number — ISO 6346**: 4 letters (owner + category U/J/Z) + 6 digits + 1 check
  digit; check digit verified by the standard mod-11 weighting. `isValidContainerNumber`.
- **IMO number**: `IMO` optional prefix + 7 digits; check digit = (Σ dᵢ·(7−i)) mod 10 equals
  the 7th digit. `isValidIMO`.
- **MMSI**: exactly 9 digits (distinct identifier type from IMO). `isValidMMSI`.
- **UN/LOCODE**: 5 chars — 2-letter ISO country + 3 alnum locode. `isValidUnlocode`.

Validators are total (never throw) and used at the persistence boundary and in tests.

## Canonical milestones (`milestones.ts`)

20 milestones (`BOOKING_CREATED … DELIVERED, EMPTY_RETURNED, COMPLETED, CANCELLED,
EXCEPTION`), each mapped to a category (`shipment | container | vessel | customs | delivery
| control`). Ocean logistics is event-driven, so `classifyMilestone(current, next)`
validates only the impossible (leaving a terminal state, completing before delivery) and
CLASSIFIES the rest — `advance | repeat | regress(correction) | exception | cancel |
complete`. Transshipments, rolled cargo, holds, corrections, and manual events are all
representable.

## Tracking events (`events.ts`)

One immutable canonical shape per update: `{ shipmentId, containerId?, eventType,
occurredAt, receivedAt, source, providerCode, confidence, location?, vessel?, description?,
fingerprint }`. `source ∈ {CARRIER, AIS, PORT, TERMINAL, CUSTOMS, ROAD, MANUAL, SYSTEM}`;
`confidence ∈ {CONFIRMED, INFERRED, MANUAL, ESTIMATED}`. A deterministic `fingerprint`
(shipment+container+type+occurredAt+location) drives deduplication. Inferred is never
presented as confirmed.

## Position, freshness, ETA, projection

- `position.ts` — deterministic current-position resolver: road GPS (CONFIRMED) → vessel
  AIS only if the container is confirmed aboard (INFERRED) → port milestone
  (CONFIRMED/ESTIMATED) → unavailable. Never guesses coordinates.
- `freshness.ts` — pure age classification with per-source thresholds
  (tracking-confidence-and-freshness.md).
- `eta.ts` — ETA with provenance (`source/confidence/calculatedAt/previousValue`) and
  significant-change detection. No predictor.
- `map-projection.ts` — pure provider-neutral projection (origin/destination/planned
  route/actual track/current marker/milestone markers/bounds/warnings).
- `dashboard.ts` / `alerts.ts` — pure aggregate + exception contracts.

## Carriers, vessels, ports — honesty

`ocean_carrier`/`ocean_vessel`/`ocean_port` are unseeded. No carrier code, SCAC, URL, port
coordinate, or vessel identifier is invented; operators/verified references populate them.
