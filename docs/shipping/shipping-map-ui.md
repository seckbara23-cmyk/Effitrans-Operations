# Phase 7.2B — Shipping map UI

## Architecture

```
lib/shipping/intelligence/map-projection.ts   (PURE, no map library)
        → ShipmentMapProjection
components/shipping/shipment-map-loader.tsx    ("use client", next/dynamic ssr:false)
        → lazy-loads
components/shipping/shipment-map.tsx           ("use client", Leaflet renderer ONLY)
```

The domain produces the provider-neutral projection; the map is a pure renderer. No
position resolution, milestone rule, or DB access lives in React. Leaflet loads only on the
shipment detail surface, as its own client chunk (detail First-Load JS ≈ 103 kB vs ≈ 97 kB
elsewhere; the Leaflet chunk is fetched on demand, not shipped to non-map pages).

## Tile provider

Default: OpenStreetMap (`https://{s}.tile.openstreetmap.org/...`), approved in
map-provider-decision.md, no key. An operator may override the tile template with the
build-time public var `NEXT_PUBLIC_MAP_TILE_URL` for an approved provider. **No provider key
is embedded in the client bundle**, and map-tile config is kept SEPARATE from
tracking-provider config. Attribution is always shown.

## Visual distinctions (a stale/inferred marker never looks like a live GPS fix)

| Element | Style |
|---|---|
| Planned route | dashed slate polyline |
| Actual track | solid teal polyline |
| Origin / destination | filled navy / teal dots |
| Milestone markers | filled slate dots |
| Current — CONFIRMED | filled teal, larger |
| Current — INFERRED | filled amber |
| Current — MANUAL | filled sky |
| Current — ESTIMATED | filled slate |
| Current — STALE/VERY_STALE/UNKNOWN | **hollow, dashed border** (any confidence) |
| No mappable position | no marker + explicit "carte indisponible" |

Warnings from the projection (stale / inferred / estimated / unavailable) render below the
map so the UI cannot present a non-live position as live.

## Popup safety

Marker tooltips expose ONLY: label, source, confidence, freshness, timestamp (and safe
vessel/voyage where present). Never database ids, customer PII, credentials, document
links, or raw provider payloads.
