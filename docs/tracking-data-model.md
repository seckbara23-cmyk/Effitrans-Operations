# Tracking Data Model (Phase 8.4)

8.4 reuses the existing entities rather than introducing the brief's suggested
`tracking_position`/`tracking_route` names — the concepts already exist under production names.
This document maps the brief's canonical model onto what is deployed.

## Positions

The brief's `tracking_position` concept is served by TWO existing stores plus a derived reader:

- **`tracking_position`** (road, 3.4) — `latitude/longitude` NOT NULL, `source` ∈ manual/
  driver_mobile/vehicle_gps/carrier_api/vessel_api/flight_api, `customer_visible`, `recorded_at`,
  `received_at`, `recorded_by`. RLS: staff/driver/portal read policies; **writes service-role
  only**. Dark behind `TRACKING_ENABLED`.
- **`ocean_tracking_event` / `air_tracking_event`** (7.2A/7.3A) — the immutable journals;
  located events (`latitude/longitude`) are positions, milestone events are timeline-only.
  `source` + `confidence` per row; append-only (mutation trigger); `unique(tenant_id,
  shipment_id, fingerprint)` dedup.
- **`resolveCurrentPosition` / `resolveAirPosition`** — derive THE current position at read
  time (no stored `is_current` flag). One per subject by construction; recency-honest (8.4).

**Current-position rules** (satisfied without a mutable flag):
- exactly one current position per subject per read;
- a late historical event (older `occurred_at`) never displaces a newer one — ordering is by
  event time, and 8.4 additionally blocks an older higher-priority source from masking a newer
  lower-priority one;
- concurrent inserts both append; the read orders them deterministically;
- history is never overwritten (append-only journals; corrections supersede, never edit).

**Validation:** app (`isValidCoordinate`: lat ∈ [-90,90], lon ∈ [-180,180], null-island
rejected) AND database (CHECK constraints on all five coordinate-bearing tables, 8.4).

## Routes & waypoints

The brief's `tracking_route`/`tracking_route_point` are served by:
- **`ocean_route_leg`** — `sequence`, `origin_port_id`/`destination_port_id`, `mode`
  (SEA/ROAD/RAIL/TRANSSHIPMENT), `planned_/actual_departure`, `planned_/actual_arrival`,
  `status`, `source`; `unique(tenant_id, shipment_id, sequence)`.
- **`ocean_voyage`** + **`ocean_port_call`** — voyage-level planned/actual times and port calls.
- **`air_flight_leg`** — `sequence`, `origin_/destination_/connection_airport_id`, std/sta/atd/
  ata, status.

Planned vs actual stays distinguishable: legs carry both planned and actual timestamps; the map
draws the **planned** route dashed and an **actual** track solid, and NEVER draws an actual line
from planned points. When only origin+destination are known, an indicative dashed connector is
drawn and labeled as such — never presented as the vessel's real path.

**Road planned stops:** no dedicated table exists; road itinerary today is `ocean_route_leg`
rows with `mode='ROAD'` plus runtime checkpoint events. A future road-stops table is the clean
extension point (documented in the provider-integration guide).

## Location catalog

`ocean_port` (unlocode, name, country, lat, lon, timezone) and `air_airport` (iata, icao, name,
city, country, lat, lon, timezone, active). Coordinates were deliberately UNSEEDED upstream; 8.4
seeds four canonical locations for acceptance (dev/CI) and adds coordinate CHECK constraints.
Admins manage coordinates through the existing port/airport forms (now reachable via
`transport:manage`).
