# TRANSPORT-MAP-SATELLITE-01 — Satellite basemap for `/transport/suivi`

Status: implemented on branch `feat/transport-map-satellite-01` (PR #32, draft), **not configured in any environment, not deployed**. 2026-10-10. ESRI-COMPAT-01 (read-only) verified the Esri endpoints live; ESRI-COMPAT-02 added the explicit tile size and corrected this document.

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

Pricing below is from provider public pages as last known to the author and **must be re-verified on the provider's pricing page before any commitment**; it is not a quote. "Observed" means probed live on 2026-10-10 with no key at all (empty or deliberately bogus tokens only).

| Provider / product | Tile | Labels | Key validation (observed) | Free tier (to verify) | Beyond free (to verify) | Attribution to show |
|---|---|---|---|---|---|---|
| **Esri — ArcGIS Static Basemap Tiles, style `open/hybrid/detail`** — `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/open/hybrid/detail/static/tile/{z}/{y}/{x}?token=` | **512-px PNG**, zoom 0–22 | **Roads and place labels in the tile** | **Strict**: no token → HTTP 401 (code 499), bogus token → HTTP 401 (code 498) → the map falls back to the plan | "Basemap tiles": 2 000 000 / month, one pool across `basemaps-api`, `ibasemaps-api` and `static-map-tiles-api` | US$0.15 per 1 000 tiles | "Powered by Esri" (linked) + "Map data © OpenStreetMap contributors, Microsoft, Esri Community Maps contributors, Map layer by Esri" |
| Esri — World Imagery raster — `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=` | 256-px JPEG | **None.** Esri serves no raster label layer on this host: `Reference/World_Boundaries_and_Places` (documented here before ESRI-COMPAT-01) and five other candidates answer HTTP 404 | **Lenient**: an empty token → HTTP 200 with a JSON error (code 499); any non-empty token — bogus included, on CDN cache misses and with a foreign Referer — returns imagery. A working picture proves nothing about the key | same pool | same | "Powered by Esri" (linked) + "Esri, Vantor, Earthstar Geographics, and the GIS User Community" |
| Esri — Basemap styles service v2, `arcgis/imagery` | a style JSON (raster imagery + vector labels), not a tile template | built in | strict | same pool | same | per the style |
| **MapTiler Cloud** "Hybrid" — `https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key=` | 256-px JPEG | built in | key restricted by allowed origins | ~100 000 requests / month (check commercial-use terms) | Flex from ~US$25 / month | "© MapTiler © OpenStreetMap contributors" |
| Mapbox Satellite Streets (Static Tiles) | raster | built in | token with URL restriction | ~50 000 / month | ~US$0.25 per 1 000 | Mapbox + OSM |
| Google Maps | — | — | different SDK; tiles may not be used inside MapLibre (ToS) | — | — | not an option |
| Bing Maps | — | — | retired for new customers | — | — | not an option |
| Open data (Sentinel-2, NASA GIBS) | free | none | none | free | free | 10 m/px — too coarse for vehicle tracking |

The Basemap styles service returns a *style*, not a tile template; this map accepts XYZ templates only, so it is not usable without a larger change. The Static Basemap Tiles service has **no imagery-only style**: its satellite styles are `open/hybrid/detail` (imagery with labels) and `arcgis/imagery/labels` (labels only).

### Recommendation

**Primary: Esri `open/hybrid/detail` static tiles with `TRANSPORT_SATELLITE_TILE_SIZE=512`** — one strictly validated source with imagery and readable labels, matching the key's "Static basemap tiles" privilege. **Alternative: MapTiler Hybrid** (256). **Smoke test only: Esri World Imagery raster** (256, no labels) — it exercises the switch and the fallback but, because that endpoint does not validate the key, it cannot prove the key or the referrer.

### Estimated consumption

A `/transport/suivi` session frames Senegal (zoom ~6) and zooms to missions (zoom 11–14). Browser caching means a refresh re-fetches **no** tiles unless the camera moves. A 512-px tile covers four 256-px tiles, so the hybrid source needs roughly a quarter of the requests of a 256-px source for the same view (its PNG tiles are heavier per tile than JPEG — bandwidth, not quota). Rough envelope, counted in 256-px requests:

| Scenario | 256-px tiles / month | Esri hybrid (≈ ¼ in 512-px tiles) | MapTiler |
|---|---|---|---|
| 5 operators × 5 sessions/day × ~150 tiles × 22 days | ≈ 80 000 | free | free (at the edge of the Free plan) |
| 20 operators × 10 sessions/day × ~300 tiles × 22 days | ≈ 1 300 000 | free | Flex ≈ US$25–60 / month |
| Wall screen with the camera moving all day | could exceed 2M | ≈ US$0.15 / 1 000 beyond free | Unlimited plan |

Set `TRANSPORT_SATELLITE_DEFAULT=true` only once real consumption has been observed for a few days with the switch available and Plan as default.

## 3. What was implemented

| File | Change |
|---|---|
| `lib/tracking/basemaps.ts` | **Pure.** Template validation (https, `{z}{x}{y}`, length), env → config resolution (attribution mandatory), explicit tile size (`parseTileSize`: unset → 256; exactly "256" or "512"; anything else disables satellite), `initialBasemap`, `buildSatelliteStyle` (raster imagery + optional raster labels above it, both at the configured size), `isSatelliteSourceError`. |
| `lib/tracking/basemap-config.ts` | **`server-only`.** Reads `TRANSPORT_SATELLITE_TILE_URL`, `TRANSPORT_SATELLITE_TILE_SIZE`, `TRANSPORT_SATELLITE_LABELS_TILE_URL`, `TRANSPORT_SATELLITE_ATTRIBUTION`, `TRANSPORT_SATELLITE_DEFAULT`. |
| `app/transport/suivi/page.tsx` | Passes `satellite={getSatelliteTiles()}` to the map — resolved on the server, rendered only for `transport:read` holders. |
| `components/transport/live-map.tsx` | `satellite` prop; « Plan / Satellite » segmented switch (`role="group"`, `aria-pressed`), shown **only when configured**; `map.setStyle(style, { diff: false })` keeps camera and DOM markers, the observed route is re-added after `style.load`; `error` handler reverts to the plan on imagery failures (source id or HTTP 401/403/429) with a visible notice; attribution control responsive (full on maps at least 640 px wide, an accessible toggle below). No `process.env`, no vendor name. |
| `.env.example` | The five variables, documented as server-only, with the verified Esri templates and the attribution requirement. |
| `tests/transport-map-satellite-01.test.ts` | 35 tests: validation, resolution, tile size, style shape, fallback predicate, structural pins, "nothing about tracking changed". |

**Not changed**: missions, assignments, tracking records, `live-service.ts`, `driver/actions.ts`, `marker-motion.ts`, `live-model.ts`, customs gates, database schema, RLS, migrations (151 → 151).

## 4. Credentials, attribution, licensing

- Raster tiles are fetched by the **browser**; any key in the template is visible in the network tab to a signed-in `transport:read` viewer. That is inherent to every raster product. Mitigations: the key is **never bundled** (server-only variables, prop injection after the permission gate), it is **never logged** by the application, it must be **restricted at the provider** to this site's origin/referrer, and it should carry an **expiry** (ArcGIS keys live at most one year). A server-side tile proxy would hide the key but adds a function invocation per tile and conflicts with most providers' no-proxy terms — not recommended.
- **This repository is public.** A committed value is world-readable: `.env.example` holds placeholders only, and no key may appear in commits, logs or PR comments.
- **Esri referrers** accept a wildcard only in the subdomain position (`https://*.example.com`). A Vercel preview host (`<project>-git-<branch-hash>-<team>.vercel.app`) can therefore only be matched by `https://*.vercel.app`, which also matches every other site hosted on vercel.app. Use such a key for **Preview only, short-lived**, and give production a separate key restricted to `https://effitrans-operations.vercel.app` (plus any custom domain). The application sends `Referrer-Policy: strict-origin-when-cross-origin`, so tile requests carry the page origin — what the provider matches.
- **Attribution is mandatory** and enforced: an empty `TRANSPORT_SATELLITE_ATTRIBUTION` disables satellite. Esri requires "Powered by Esri" plus the data-provider credits; the control shows the credit in full on maps at least 640 px wide and behind an accessible toggle on narrower screens.
- **No key and no paid service were added.** All variables ship empty; production is unchanged until an approved key is configured.

## 5. Verification

Automated results are in the PR. What **cannot** be verified from this environment, and is left to review: visual rendering of imagery, label legibility, pan/zoom/rotation feel and mobile layout — there is no browser here and no screenshot was produced. The structural and pure tests cover the switch's presence, the camera-preserving swap, the route re-add, the fallback, the tile size and the untouched tracking behaviour.

Manual checklist for the reviewer once a key is configured in a preview environment:
1. Load `/transport/suivi` with no missions → map renders on the plan; switch visible; empty-state card over the map.
2. Click « Satellite » → imagery **with labels** appears at a legible size; pitch/bearing unchanged; scale control present; attribution visible.
3. With a live mission → marker and heading unchanged across the switch; popup still opens; route line present on both basemaps.
4. Rotate (right-drag), zoom, pan → identical on both basemaps.
5. Break the key (restrict it to another referrer, or revoke it) → the map reverts to the plan and shows « Imagerie satellite indisponible … ». Only a strictly validating endpoint (the recommended one) makes this test meaningful.
6. In the ArcGIS Location Platform dashboard, confirm **Basemap tiles** usage is counted against the key during the session.
7. Phone width → switch wraps under the caption; map height 380 px; attribution toggle reachable.
8. Set `TRANSPORT_SATELLITE_DEFAULT=true` → opens on satellite; unset → opens on plan.

## 6. Vercel Preview configuration

Environment **Preview**, scoped to the branch `feat/transport-map-satellite-01`, variables marked **Sensitive**; then **redeploy** the branch's latest deployment (environment changes do not reach an existing deployment).

```
TRANSPORT_SATELLITE_TILE_URL=https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/open/hybrid/detail/static/tile/{z}/{y}/{x}?token=<ARCGIS_API_KEY>
TRANSPORT_SATELLITE_TILE_SIZE=512
TRANSPORT_SATELLITE_ATTRIBUTION=Powered by <a href="https://www.esri.com/">Esri</a> — Map data © OpenStreetMap contributors, Microsoft, Esri Community Maps contributors, Map layer by Esri
```

Leave `TRANSPORT_SATELLITE_LABELS_TILE_URL` and `TRANSPORT_SATELLITE_DEFAULT` unset. If the switch does not appear after the redeploy, the template or the size failed validation (a trailing space, `http://`, a size other than 256/512).
