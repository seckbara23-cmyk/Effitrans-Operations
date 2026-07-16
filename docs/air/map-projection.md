# Phase 7.3A — Air map projection

Air **reuses the shipping map stack** — it does not build a second one.

## Architecture

```
lib/air/intelligence/position.ts        → ResolvedPosition (shared contract)
lib/shipping/intelligence/map-projection.ts (buildShipmentMapProjection, PURE, no map lib)
        → ShipmentMapProjection
components/shipping/shipment-map-loader.tsx  (next/dynamic ssr:false)
components/shipping/shipment-map.tsx         (Leaflet renderer — the SAME component)
```

The air detail page builds a `ShipmentMapProjection` from the air position resolver +
air-event milestone markers (with `label` pre-computed via the additive per-marker `label`
option) + the linked flight's origin/destination airport coordinates, then renders it with
the shared `ShipmentMapLoader`. No air-specific map component; no domain logic in React;
Leaflet lazy-loaded (off the server + non-map pages).

## Position hierarchy (air)

1. **Manual** confirmed fix → CONFIRMED/MANUAL.
2. **Aircraft position** — ONLY if the cargo is confirmed aboard that flight → INFERRED
   (no live ADS-B in 7.3A; `flightPosition` is always null until a licensed feed exists).
3. **Last airport event** with known coordinates → CONFIRMED / ESTIMATED.
4. Otherwise unavailable — never a guessed coordinate.

## Visual distinctions

Inherited from the shared renderer: planned (dashed) vs actual (solid); CONFIRMED (teal) /
INFERRED (amber) / MANUAL (sky) / ESTIMATED (slate); **stale = hollow, dashed** so a
stale/inferred marker never looks like a live fix. Popups show safe fields only
(location/event/source/confidence/freshness/timestamp) — no ids, PII, or credentials.

## Tile provider

OSM by default; `NEXT_PUBLIC_MAP_TILE_URL` override; no key embedded (shared with the ocean
map decision, docs/shipping/map-provider-decision.md).
