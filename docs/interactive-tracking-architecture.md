# Interactive Logistics Tracking — Architecture (Phase 8.4)

## The finding that reframed the phase

The production shipment map honestly reported « Carte indisponible : aucune coordonnée
cartographiable ». The audit proved this was **not** a missing map, reader, or component —
all three were complete and correct. The root cause: the port/airport coordinate-entry actions
gate on `assertPermission("transport:manage")`, **a permission that was never added to the
catalog and granted to no role** (`hasPermission` is a strict membership check with no admin
bypass). So no operator could ever enter a port's latitude/longitude → no shipment had
mappable coordinates → the map correctly said so. 8.4 fixes the door, not the room.

## What already existed (reused, not rebuilt)

| Capability | Where | 8.4 action |
|---|---|---|
| Immutable event journals (source + confidence per row, append-only triggers, dedup) | `ocean_tracking_event`, `air_tracking_event` (7.2A/7.3A) | reused as-is |
| Road position store | `tracking_position` (3.4, dark behind `TRACKING_ENABLED`) | reused |
| Position resolver (source priority, never guesses) | `lib/shipping/intelligence/position.ts`, `lib/air/.../position.ts` | **recency hardened** (below) |
| Freshness classifier (per-source thresholds) | `lib/shipping/intelligence/freshness.ts` | **relabeled** + `ageLabelFr` added |
| Map projection engine (provider-neutral) | `lib/shipping/intelligence/map-projection.ts` | reused |
| Leaflet map renderer (lazy, ssr:false) | `components/shipping/shipment-map.tsx` | **sync + French labels** |
| Manual Tracking Studio (preview→confirm, MANUAL stamp) | `components/shipping/tracking-studio.tsx`, air console | reused |
| Route legs | `ocean_route_leg`, `air_flight_leg` | reused |
| Port/airport catalog + admin CRUD | `ocean_port`/`air_airport` + management-forms | **unlocked** by the permission fix |
| Portal carriage reader (customer-safe, RLS) | `lib/portal/carriage.ts` (7.5A) | reused; labels now French |
| Provider stubs (honest not_configured) | `lib/*/intelligence/provider.ts` | reused |

## What 8.4 built (net-new, minimal)

1. **`transport:manage` cataloged** (migration + seed + 4 role templates) — the root-cause fix.
2. **Recency truthfulness** in `resolveCurrentPosition`: a higher-priority source is used only
   if no lower-priority candidate is strictly newer — a 3-day-old road fix can no longer mask a
   3-hour-old confirmed port milestone.
3. **`TrackingJourney`** (`components/shipping/tracking-journey.tsx`) — the §H coordinator: map
   and immutable journal share ONE selection state via a stable `markerKey (label|occurredAt)`
   derived identically on both sides. No second event history. Events without coordinates stay
   visible, just not map-linked.
4. **Honest labels everywhere**: `sourceLabelFr` / `confidenceLabelFr` (one French map, safe for
   customers — no raw enums) + `ageLabelFr` (« il y a 2 h »). Freshness `LIVE` label changed
   « En direct » → « À jour » (age language, never liveness — see the trust model doc).
5. **DB coordinate CHECK constraints** on all five coordinate-bearing tables (defence-in-depth).
6. **Canonical coordinates** seeded for Dakar/Shanghai ports + DSS/CDG airports (dev/CI only,
   public-domain sources documented; production entry is an operator step).

## Multimodal

The same architecture serves ocean (primary), air, road (`tracking_position`, dark), and
customs (milestone-only — no moving marker unless another source supplies a position). Each
mode reuses the shared resolver → projection → map → journey pipeline.

## Map tiles

OpenStreetMap default (`NEXT_PUBLIC_MAP_TILE_URL` override for an approved provider). OSM
attribution rendered. No key, no confidential data in tile URLs. Tiles fail gracefully; the
textual journal remains fully usable without tiles.
