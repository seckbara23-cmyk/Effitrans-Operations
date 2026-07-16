# Phase 7.2A — Shipping Line Platform foundation: acceptance

## Definition of Done — status

| DoD item | Status |
|---|---|
| Existing shipment domain audited and reused | ✅ Option C hybrid (see architecture-decision.md) |
| Provider-neutral ocean domain exists | ✅ `lib/shipping/intelligence/domain.ts` + types |
| Bookings, BLs, containers, vessels, voyages, ports, route legs represented safely | ✅ additive shipment cols + 8 ocean tables |
| Canonical milestones defined | ✅ `milestones.ts` (20, event-driven, classified) |
| Immutable normalized tracking events exist | ✅ `events.ts` + `ocean_tracking_event` (append-only, dedup) |
| Confidence + freshness explicit | ✅ `events.ts` + `freshness.ts` |
| ETA provenance honest | ✅ `eta.ts` (source/confidence/history; no predictor) |
| Deterministic current-position resolution | ✅ `position.ts` (road → inferred vessel → port → none) |
| Map-ready provider-neutral projection | ✅ `map-projection.ts` (no map library imported) |
| Shipping Operations Console usable | ✅ `/shipping`, `/shipping/shipments[/id]`, `/containers`, `/vessels` |
| Operators enter clearly-labelled manual events | ✅ `actions.addManualTrackingEvent` + form (MANUAL) |
| Customs Intelligence safely linked, not duplicated | ✅ `customs-link.ts` (read-only summary) |
| Carrier + AIS adapters honest about configuration | ✅ stubs `not_configured`/`unsupported` + readiness |
| Tenant isolation CI-proven | ✅ `rls_shipping_test.sql` (bidirectional + write-reject) |
| No fabricated external integration | ✅ no live call; empty status maps; no invented env/endpoints |
| tests / typecheck / build / RLS / CI pass | ✅ (see below) |

## Operational vs canonical state

- Operational: `operational_file.status`, `shipment.transport_mode`, `transport_record.status` — UNCHANGED.
- Canonical ocean: `shipment.ocean_milestone` (provider-driven, 20 milestones) — new, distinct.
- Customs: authoritative in `customs_record`; shipping reads a safe summary only.

## Event-store decision

Dedicated `ocean_tracking_event` (append-only via `prevent_mutation`, dedup via
`unique(tenant_id, shipment_id, fingerprint)`) — NOT the audit log. The audit log records
operator/system actions + safe summaries only (`shipping.*`). No raw provider payloads.

## Provider abstraction & readiness

`ShippingEngine` facade over `ShippingProvider`. `manual` configured; carriers
(maersk/msc/cma-cgm/hapag-lloyd/cosco/one/evergreen/aggregator) and AIS are honest stubs.
Status maps intentionally EMPTY until each official vocabulary is verified. See
shipping-provider-readiness.md.

## Current-position algorithm

`resolveCurrentPosition`: road GPS (CONFIRMED) → vessel AIS **only if container confirmed
aboard** (INFERRED) → last carrier milestone port (CONFIRMED/ESTIMATED) → unavailable. Never
guesses coordinates; no port-to-port interpolation in 7.2A.

## Map-provider decision

Reuse installed Leaflet/react-leaflet + OSM (map-provider-decision.md). 7.2A ships the pure
projection + structured route/position visualization; the interactive Leaflet map layers on
the same projection in 7.2B. No map key in the client bundle.

## Permissions

Reuse `transport:*` (read/update/manage). No new permission (no verified gap).

## Performance / route sizes

- Reads: dashboard = 2 bounded queries (shipments cap 2000 + one container-aggregate `.in`);
  list = 1 paginated `.range` + 1 aggregate; detail = shipment + containers + events (≤200)
  + one road-position + customs summary. No N+1, no provider call on reads.
- Indexes: shipment `(tenant_id, ocean_milestone|provider_code|eta_calculated_at)`; event
  `(tenant_id, shipment_id, occurred_at desc)`, `(tenant_id, container_id)`,
  `(tenant_id, event_type)`, `provider_event_id`; container `(tenant_id, shipment_id)`.
- Route sizes: `/shipping` 260 B, list 259 B, detail 2.27 kB, containers/vessels 259 B
  (First-Load JS ≈ 97–99 kB). No mapping library in the domain modules.

## Verification

- `npx tsc --noEmit` clean · `npx next build` clean (5 shipping routes)
- Full vitest: **1947 passed** (37 new in `tests/shipping-intelligence.test.ts`)
- Tenant-scope leak guard: green (every ocean admin read tenant-filtered)
- CI RLS job runs `rls_shipping_test.sql` (bidirectional isolation + write rejection)

## Remaining work for Phase 7.2B

1. Real carrier adapters (Maersk/MSC/…) — only after each official contract is verified;
   populate `CARRIER_STATUS_MAPS` with cited entries; wire config `missing`/`invalid` states.
2. AIS adapter — only with a redistribution license; wire vessel position + container-aboard
   inference end-to-end.
3. Interactive Leaflet map component consuming `ShipmentMapProjection`.
4. Booking/BL/vessel/voyage/port CRUD + container linking UI; route-leg/port-call editors.
5. Notification delivery for the alert contracts (reusing the approved notification path).
6. Provider polling/webhooks — only with verified contracts + signatures.
