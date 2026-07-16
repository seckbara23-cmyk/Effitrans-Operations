# Phase 7.2A — Map provider decision

**Decision: reuse the already-installed Leaflet / react-leaflet stack with an approved
open tile source (OpenStreetMap by default). Do NOT install a new mapping library. The
domain layer stays map-library-neutral; only a thin client component may touch Leaflet.**

## Audit of existing dependencies

`package.json` already declares, as first-class dependencies:

- `leaflet@^1.9.4`
- `react-leaflet@^4.2.1`
- `@types/leaflet@^1.9.12`

They were installed for the Phase 3.4 real-time operations tracking map. No new mapping
dependency is therefore required, and the phase rule "do not install a mapping library
until the decision is documented" is satisfied by reusing what is already approved and
present.

## Options considered

| Option | Verdict |
|---|---|
| **Leaflet + react-leaflet + OSM tiles (reuse)** | **Chosen** — already installed, already used for road tracking, no license/key, self-hostable tiles, custom markers (vessel/container/truck), route polylines, good Africa/Senegal coverage via OSM. Zero new vendor lock-in. |
| Mapbox | Rejected for 7.2A — requires an access token (key-leakage surface), paid tiles, and a new dependency, for no capability we need now. |
| HERE | Rejected — new paid dependency + key management; maritime layers are not needed at the foundation stage. |
| Google Maps | Rejected — new paid dependency, key leakage surface, heavier bundle, stronger vendor lock-in. |

## Sovereignty, licensing, cost

- OSM tiles are ODbL-licensed; attribution is required and will be shown. For production
  volume the tenant/operator may point Leaflet at a self-hosted or contracted tile
  endpoint — a configuration value, not a code change (no key is embedded in the client
  bundle in 7.2A).
- No map-provider API key is shipped to the browser in 7.2A. If a keyed tile provider is
  later adopted, the key must be a server-proxied/config value, never inlined — enforced
  by the same bundle-safety tests used elsewhere.

## Architectural rule

The domain **map-ready projection** (`lib/shipping/intelligence/map-projection.ts`) is
PURE and imports NO mapping library. It emits provider-neutral points/markers/bounds. Any
interactive map is a separate client component that consumes the projection. This keeps
the domain testable and lets the map provider change without touching business logic.

## 7.2A scope

Per the brief, "a simple non-map timeline may ship before the interactive map." 7.2A ships
the **provider-neutral projection + a structured route/timeline visualization**. An
interactive Leaflet map can be layered on in 7.2B by feeding the same projection into a
`react-leaflet` client component — no domain change required. Every marker renders its
source, confidence, and freshness so a stale position never appears live.
