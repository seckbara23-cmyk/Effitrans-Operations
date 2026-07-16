# Phase 7.2A — Shipping Line Platform architecture decision

**Decision: Option C (Hybrid).** Reuse the existing `operational_file` spine and the flat
`shipment` detail record (extended additively) and the road `tracking_*` evidence layer;
add ocean-specific satellite tables only for what is genuinely missing. Do NOT create a new
root shipment entity.

## What the audit found (reuse basis)

| Concern | Exists today | Verdict |
|---|---|---|
| Operational file / dossier | `operational_file` (spine, RLS `file:read`) | **Reuse** |
| Shipment | `shipment` — 1:1 with file, flat free-text: `transport_mode, origin, destination, carrier_name, vessel_or_flight, bl_awb_ref, container_ref, etd/atd/eta/ata` | **Reuse + extend additively** |
| Road / final-mile transport | `transport_record` (road; no GPS in it) | **Reuse (unchanged)** |
| Road GPS positions | `tracking_position` (real lat/lon, `source` enum reserves `vessel_api`/`carrier_api`) | **Reuse as the CONFIRMED road source** for the position resolver |
| Carrier / vessel / voyage / port | free-text only (`carrier_name`, `vessel_or_flight`); NO tables | **New tables** |
| Container | `shipment.container_ref` (single free text); NO table | **New table** (multi-container, ISO 6346) |
| Booking / BL | `shipment.bl_awb_ref` (single free text); no booking field | **Extend shipment** (structured refs) |
| Route legs / port calls | none (journeys = process steps, not geography) | **New tables** |
| Map | Leaflet + react-leaflet installed; `components/portal/leaflet-map.tsx`, `lib/portal/map-points.ts` registry | **Reuse** (see map-provider-decision.md) |
| Provider pattern | `lib/customs/intelligence/provider.ts` (`CustomsEngine`) | **Mirror** for `ShippingEngine` |
| Pagination | `lib/platform/console/table.ts` `paginate<T>()` | **Reuse** |
| Permissions | `transport:*`, `tracking:*`, `file:*`, `customs:*`; NO `shipment:*`/`vessel:*` | **Reuse `transport:*`** (no new permission) |

## Persistence design

**Extend `shipment` additively** (mirrors the 7.1B customs pattern) with the shipment-level
ocean state that is 1:1 with the shipment:

- `ocean_milestone` (canonical), `provider_code`, `carrier_id` (→ ocean_carrier),
  `booking_reference`, `booking_status`, `master_bl`, `house_bl`,
  `eta_source`, `eta_confidence`, `eta_calculated_at`, `eta_previous`,
  `tracking_synced_at`, `tracking_version` (compare-and-set).

No RLS change to `shipment` (stays `file:read`); services read via the admin client gated
by `transport:read`.

**New satellite tables** (all tenant-scoped, RLS `tenant + transport:read`, writes
service-role, tenant-match trigger where they reference a file/shipment):

- `ocean_carrier` — provider-neutral carrier reference (code, name). Unseeded (no invented SCAC/URLs).
- `ocean_vessel` — name, IMO, MMSI, flag, carrier.
- `ocean_voyage` — carrier voyage ref, vessel, origin/destination port, planned/actual dates, status.
- `ocean_port` — UN/LOCODE, name, country, latitude, longitude, timezone. **Unseeded** (no invented coordinates).
- `ocean_container` — container number (ISO 6346), ISO equipment type, seal, gross weight, status, shipment, vessel/voyage, last event, position confidence.
- `ocean_route_leg` — sequence, origin/destination port, mode, vessel/voyage, planned/actual dates, status, source.
- `ocean_port_call` — voyage/shipment, port, arrival, berth, departure, terminal, event source.
- `ocean_tracking_event` — the high-volume immutable normalized event store (see event-store decision below).

### Rejected alternatives

- **Option A (extend existing entities only):** rejected — containers are multi-row and
  vessels/voyages/ports/route-legs are genuinely relational; flattening them onto
  `shipment` free-text (today's state) is exactly what the phase must fix.
- **Option B (all-new root shipment entity):** rejected — `shipment` already owns shipment
  identity 1:1 with the file; a parallel root would fork the dossier model and duplicate
  origin/destination/carrier/BL. The brief explicitly forbids a new root "merely because
  the feature is called a Shipping Line Platform."
- **Audit-log-as-event-store:** rejected for tracking (see below).

## Operational-state vs provider/canonical-state boundary

- `shipment.transport_mode`/`status` and the operational file `status` remain the
  OPERATIONAL truth (unchanged).
- `shipment.ocean_milestone` is the CANONICAL, provider-driven ocean lifecycle
  (`lib/shipping/intelligence/milestones.ts`) — distinct from the file/transport workflow.
- Providers never write canonical state directly: every external/manual update is
  normalized into an `ocean_tracking_event`, validated against the milestone model, then
  the shipment's canonical state is recomputed. Compare-and-set (`tracking_version`)
  guards concurrent updates.

## Event-store decision

**A dedicated `ocean_tracking_event` table — NOT the audit log.** External ocean tracking is
high-volume machine telemetry (many events per container per voyage). The append-only
`audit_log` is for sensitive user/platform actions and must not become a telemetry sink.
The audit log continues to record OPERATOR actions (manual event added, provider refresh
requested/succeeded/failed, ETA changed) as safe summaries. Raw provider payloads are NOT
stored in the MVP; if needed later, a separate encrypted/quarantined store will be proposed.

## Permissions

Reuse `transport:*` — ocean shipping is a transport concern and the transport roles already
cover the operators. `transport:read` (console/list/detail), `transport:update` (manual
event, booking/BL edit), `transport:manage` (provider refresh, vessel/voyage management).
No new permission — no verified gap that `transport:*` does not already cover.

## Customs integration

Shipping consumes a **safe, read-only customs summary** (status + release flag) via the
existing Customs Intelligence read path. Customs remains authoritative for declaration
state; shipping never writes customs. No cyclic writes; no customs duplication.
