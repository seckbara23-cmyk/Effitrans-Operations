# Phase 7.2B — Shipping Operations (implementation plan + operations)

Turns the 7.2A foundation into a usable internal ocean-shipping workspace. NO live carrier/
AIS/OCR/AI. The 7.2A domain is reused, never redesigned.

## Extension points reused (not duplicated)

| Concern | Reused from |
|---|---|
| Map projection, position resolver, event normalization, milestone classify | `lib/shipping/intelligence/*` (7.2A) — imported, never re-implemented |
| Customs state | `customs-link.ts` safe summary (read-only) — no customs write |
| Dossier identity, tenant/actor | `operational_file` / `shipment`, `assertPermission` |
| Documents | `lib/documents/service.ts listDocuments(fileId)` (document:read + visibility) |
| Pagination, tenant scope guard | `.range()` + `.eq("tenant_id", …)` (leak-guard enforced) |
| Map renderer | installed Leaflet/react-leaflet (map-provider-decision.md) |
| Permissions | `transport:read/update/manage` — no new permission |

## New this phase

- **Migration `20260716000005`** — additive `active` (+ carrier `notes`) columns on
  `ocean_carrier`/`ocean_port`/`ocean_vessel` for retire-not-delete + active filters. No new
  table, no new permission, no RLS policy change (inherits 7.2A `transport:read`).
- **Pure** `manage-validate.ts` (safe URL, UN/LOCODE, IMO/MMSI reuse, voyage chronology,
  route sequence/continuity) + `studio.ts` (`previewManualEvent` effect classification).
- **`manage-service.ts`** — SQL-paginated reads: carriers/ports/vessels/voyages/containers
  (filters), voyage detail, route legs/port calls, timeline (filter+paginate), attention queue.
- **`manage-actions.ts`** (`"use server"`) — CRUD for carrier/port/vessel/voyage; container
  create/link/reassign (conflict-guarded, confirmation, history preserved); route-leg/port-call
  upsert; booking/BL update on the existing shipment. Every write: tenant+actor from session,
  `transport:update`/`manage` gate, validation, referenced-guard (deactivate not delete),
  compare-and-set where stateful, safe audit.
- **UI** — management pages (`/shipping/carriers|ports|vessels|voyages`), container
  create/link on `/shipping/containers`, route builder + booking/BL + document panel +
  customs handoff on shipment detail, **interactive Leaflet map** (dynamic import, consumes
  `ShipmentMapProjection`), **Manual Tracking Studio** (effect preview), `/shipping/alerts`
  attention queue, dashboard filters + metric links.

## Operational vs canonical vs customs (unchanged boundary)

Operational file/transport status untouched; `shipment.ocean_milestone` is the canonical
provider-driven state; customs is authoritative in `customs_record` and only READ here.
Planned route facts (`ocean_route_leg` planned dates) stay distinct from observed movements
(`ocean_tracking_event`). A planned leg is never presented as an observed movement.

## Map provider configuration

Leaflet renders the provider-neutral projection. Tile source defaults to OSM (no key). A
`NEXT_PUBLIC_MAP_TILE_URL` may override the tile template for an approved provider; when
absent, OSM is used and the map shows an attribution. No provider key is embedded; map-tile
config is kept SEPARATE from tracking-provider config. Leaflet loads only on the detail
surface via `next/dynamic({ ssr: false })` — never in server/domain modules.

## Audit

New safe events (`shipping.carrier.*`, `shipping.port.*`, `shipping.vessel.*`,
`shipping.voyage.*`, `shipping.container.created/linked/reassigned`, `shipping.route.updated`,
`shipping.eta.updated`) carry actor/tenant/entity id/changed field NAMES/safe relationship
ids only — never coordinates, PII, full BL/booking bodies, credentials, or telemetry.
High-volume tracking stays in `ocean_tracking_event`.
