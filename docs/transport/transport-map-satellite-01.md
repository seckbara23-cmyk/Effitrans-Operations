# TRANSPORT-MAP-SATELLITE-01 — Satellite basemap for `/transport/suivi`

Status: implemented on branch `feat/transport-map-satellite-01`, **not configured in any environment, not deployed**. 2026-10-10.

## 1. What exists today (Phase 1, read-only)

| Question | Finding | Where |
|---|---|---|
| Map library on `/transport/suivi` | **MapLibre GL JS 5.24.0** (WebGL; real pitch 45° / bearing −8°, drag-rotate, `NavigationControl` with compass, `ScaleControl`). The two other maps (portal, shipping) use Leaflet and are untouched. | `components/transport/live-map.tsx`, `package.json` |
| Tile provider | An **inline OpenStreetMap raster style** (`a/b/c.tile.openstreetmap.org`), hard-coded; the Leaflet maps' `NEXT_PUBLIC_MAP_TILE_URL` is **not** read by this map. | `live-map.tsx` `OSM_RASTER_STYLE` |
| Satellite support | **None anywhere** in the application. | — |
| Markers / GPS | One `maplibregl.Marker` per located mission, keyed by `transportId`, restyled in place on each 30 s refresh; rotated **only** from a device-reported heading; glide between two recorded fixes; popup with mission facts. | `live-map.tsx`, `lib/tracking/marker-motion.ts` |
| Clustering | **Not implemented** — fleet sizes do not need it; nothing to preserve. | — |
| Rotation / zoom | Camera is MapLibre's; the operator's view is never reset by telemetry; "Recentrer sur le Sénégal" / "Cadrer les missions" are the only framing actions. | `live-map.tsx` |
| Empty state | Map always renders; overlay card over an otherwise working map; WebGL-absent fallback message. | `live-map.tsx` |
| CSP | None set (deliberately, `next.config.mjs`) — no tile-host allow-list to extend. | `next.config.mjs` |
| Tests pinning this surface | `tms-2d-live-map.test.ts`, `tms-2-driver-tracking.test.ts`, `tracking-06a/06b`: among others, **`live-map.tsx` must contain no `process.env`, no key-shaped token and no vendor name**. | `tests/` |

## 2. Provider options (compatible with MapLibre raster sources)

Pricing below is from provider public pages as last known to the author and **must be re-verified on the provider's pricing page before any commitment**; it is not a quote.

| Provider | Product | Labels on imagery | Key / account | Free tier (to verify) | Beyond free (to verify) | Senegal coverage | Licence / attribution |
|---|---|---|---|---|---|---|---|
| **Esri — ArcGIS Location Platform** | World Imagery raster tiles (`ibasemaps-api.arcgis.com/…/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=`) + **Reference / World Boundaries and Places** labels layer | Separate transparent labels layer (supported here via `TRANSPORT_SATELLITE_LABELS_TILE_URL`) | API key with **referrer restriction**; free account | ~2,000,000 basemap tiles / month | ~US$0.15 per 1,000 tiles | **Strong** (Maxar / Earthstar high-res over Dakar, Thiès, main corridors) | Attribution required ("Powered by Esri" + data credits); no caching/proxying beyond browser cache |
| **MapTiler Cloud** | "Hybrid" raster (`api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key=`) — imagery **with labels baked in** | Built in | Key with **allowed-origins** restriction | ~100,000 requests / month (Free plan; check commercial-use terms) | Flex from ~US$25 / month (≈500k requests), then per 1,000 | Good in cities, coarser outside | "© MapTiler © OpenStreetMap contributors" required |
| Mapbox | Satellite Streets raster (Static Tiles) | Built in | Token with URL restriction | ~50,000 tile requests / month | ~US$0.25 per 1,000 | Good | Mapbox attribution + OSM; Mapbox ToS |
| Google Maps | Satellite / Hybrid | Built in | Different SDK (Maps JavaScript API); **tiles may not be used inside MapLibre** (ToS) | — | per map load | Excellent | Not compatible with this map without replacing it |
| Bing Maps | Aerial | — | Retired for new customers (2025) | — | — | — | Not an option |
| Open data (Sentinel-2, NASA GIBS) | Free imagery | None | None | Free | Free | 10 m/px — **too coarse** for vehicle tracking | CC-BY-style |

### Recommendation

**Primary: Esri World Imagery via an ArcGIS Location Platform API key, with the Reference labels layer.** Best imagery over Senegal, the most generous free allowance, a referrer-restrictable key, and a two-layer configuration this slice supports natively. **Alternative: MapTiler Hybrid** when a single-layer setup is preferred (labels baked in), at a lower free allowance.

### Estimated consumption

A `/transport/suivi` session frames Senegal (zoom ~6) and zooms to missions (zoom 11–14). Browser caching means a refresh re-fetches **no** tiles unless the camera moves. Rough envelope:

| Scenario | Tiles / month | Esri | MapTiler |
|---|---|---|---|
| 5 operators × 5 sessions/day × ~150 tiles × 22 days | ≈ 80,000 | free | free (at the edge of the Free plan) |
| 20 operators × 10 sessions/day × ~300 tiles × 22 days | ≈ 1,300,000 | free | Flex ≈ US$25–60 / month |
| Wall-screen auto-refresh with camera movement all day | could exceed 2M | ≈ US$0.15 / 1,000 beyond free | Unlimited plan |

Set `TRANSPORT_SATELLITE_DEFAULT=true` only once real consumption has been observed for a few days with the switch available but Plan as default.

## 3. What was implemented (Phase 2)

| File | Change |
|---|---|
| `lib/tracking/basemaps.ts` | **New, pure.** Template validation (https, `{z}{x}{y}`, length), env → config resolution (attribution mandatory), `initialBasemap`, `buildSatelliteStyle` (raster imagery + optional raster labels above it), `isSatelliteSourceError`. |
| `lib/tracking/basemap-config.ts` | **New, `server-only`.** Reads `TRANSPORT_SATELLITE_TILE_URL`, `TRANSPORT_SATELLITE_LABELS_TILE_URL`, `TRANSPORT_SATELLITE_ATTRIBUTION`, `TRANSPORT_SATELLITE_DEFAULT`. |
| `app/transport/suivi/page.tsx` | Passes `satellite={getSatelliteTiles()}` to the map — resolved on the server, rendered only for `transport:read` holders. |
| `components/transport/live-map.tsx` | `satellite` prop; « Plan / Satellite » segmented switch (`role="group"`, `aria-pressed`), shown **only when configured**; `map.setStyle(style, { diff: false })` keeps camera and DOM markers, the observed route is re-added after `style.load`; `error` handler reverts to the plan on imagery failures (source id or HTTP 401/403/429) with a visible notice. No `process.env`, no vendor name. |
| `.env.example` | The four variables, documented as server-only, with provider templates and the attribution requirement. |
| `tests/transport-map-satellite-01.test.ts` | 28 tests: validation, resolution, style shape, fallback predicate, structural pins, "nothing about tracking changed". |

**Not changed**: missions, assignments, tracking records, `live-service.ts`, `driver/actions.ts`, `marker-motion.ts`, `live-model.ts`, customs gates, database schema, RLS, migrations (151 → 151).

## 4. Credentials, attribution, licensing

- Raster tiles are fetched by the **browser**; any key in the template is visible in the network tab. That is inherent to every raster product. The mitigations are: the key is **never bundled** into client JavaScript (server-only variables, prop injection), it is rendered **only for signed-in `transport:read` viewers**, and it must be **restricted at the provider** to this site's origin/referrer and to tile endpoints. A server-side tile proxy would hide the key but adds a function invocation per tile and conflicts with most providers' no-proxy terms — not recommended.
- **Attribution is mandatory** and enforced: an empty `TRANSPORT_SATELLITE_ATTRIBUTION` disables satellite. MapLibre's compact attribution control shows the credit on the map.
- **No key and no paid service were added.** All variables ship empty; production is unchanged until an approved key is configured.

## 5. Verification (Phase 3)

Automated results are in the PR description. What **cannot** be verified from this environment, and is left to review: visual rendering of imagery, label legibility, pan/zoom/rotation feel and mobile layout — there is no browser here and no screenshot was produced. The structural and pure tests cover the switch's presence, the camera-preserving swap, the route re-add, the fallback and the untouched tracking behaviour.

Manual checklist for the reviewer once a key is configured in a preview environment:
1. Load `/transport/suivi` with no missions → map renders on the plan; switch visible; empty-state card over the map.
2. Click « Satellite » → imagery appears; pitch/bearing unchanged; scale control present; attribution visible.
3. With a live mission → marker and heading unchanged across the switch; popup still opens; route line present on both basemaps.
4. Rotate (right-drag), zoom, pan → identical on both basemaps.
5. Break the key (restrict it to another origin) → the map reverts to the plan and shows « Imagerie satellite indisponible … ».
6. Phone width → switch wraps under the caption; map height 380 px; buttons reachable.
7. Set `TRANSPORT_SATELLITE_DEFAULT=true` → opens on satellite; unset → opens on plan.
