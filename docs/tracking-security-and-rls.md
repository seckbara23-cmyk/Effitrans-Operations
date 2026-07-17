# Tracking Security & RLS (Phase 8.4)

8.4 adds NO new table and NO new RLS surface — it reuses the isolation already proven in CI.
This documents that boundary and what 8.4 verified.

## Isolation (existing, CI-proven each commit)

| Table | RLS | Test |
|---|---|---|
| `ocean_tracking_event`, `ocean_container` | tenant-isolated both directions under `transport:read`; no-perm sees none; SELECT-only (writes service-role) | `rls_shipping_test.sql` |
| `air_tracking_event`, `air_uld` | same | `rls_air_test.sql` |
| `tracking_position`, `tracking_event` | staff (perm + tenant + file scope), driver (own assigned transport), portal (`customer_visible` + own file) | `rls_tracking_test.sql` |
| shipment-linked ocean/air child tables (portal) | portal user sees ONLY own shipment via `portal_can_read_shipment`; not another customer same tenant; not another tenant; disabled portal user sees nothing | `rls_portal_carriage_test.sql` |

Bidirectional tenant isolation and cross-customer isolation are asserted by the real-Postgres
suite (CI `rls-tests` job, clean DB → all migrations → seed → RLS SQL). 8.4's positions/routes
live in these same tables, so they inherit the proven boundary.

## What 8.4 changed, and why it doesn't weaken RLS

- **`transport:manage` cataloged**: a permission grant. It gates reference-data WRITES
  (ports/airports); it does not widen any READ policy. Held by 4 coordination-tier roles, never
  CLIENT_USER/PARTNER_AGENT/DRIVER.
- **Coordinate CHECK constraints**: DDL only; strengthens integrity, touches no policy.
- **French labels + sync coordinator**: pure UI/read; no new data path.

## Customer-safe surface

The portal renders the SAME shared map projection as staff, but through the customer-safe
carriage reader (7.5A) — only safe references, milestone labels, and the position marker with
its source/confidence/freshness/date. 8.4 makes the customer-facing source render as a **French
label** (« Saisie manuelle », « Signal AIS », …) instead of the raw enum. Never exposed to
customers: internal notes, operator identity, raw provider payloads, audit detail, risk labels,
hidden milestones, other customers' or other shipments' positions.

## Audit

Manual position/milestone creation, route changes, provider accept/reject, and customer-
visibility changes are audited via the existing audit service — SAFE metadata only, never a raw
provider payload. The immutable journals are the tamper-evident record of movement.

## Corrections

An incorrect historical point is never silently edited. The Manual Tracking Studio's
preview→confirm flow writes a NEW superseding event (with the correction acknowledgement when it
regresses a milestone); the original remains in the immutable journal.
