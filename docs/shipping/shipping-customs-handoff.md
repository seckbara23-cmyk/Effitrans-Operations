# Phase 7.2B — Shipping ↔ Customs Intelligence handoff

Shipping and Customs Intelligence stay **separate authorities** connected by references and
projections — never by cyclic writes.

## Direction of truth

- **Customs is authoritative** for declaration state (`customs_record`, canonical
  `intel_status`). Shipping NEVER writes customs.
- **Shipping is authoritative** for the ocean milestone (`shipment.ocean_milestone`).
  Customs never writes shipping.

## What crosses the boundary

Shipping consumes a **safe, read-only customs summary**
(`lib/shipping/intelligence/customs-link.ts` → `getShipmentCustomsSummary`), returning only
non-sensitive booleans/enums for the shipment's file:

- `present`, `operationalStatus`, `canonicalStatus`, `released`, `blocked`.

No declaration number, BAE reference, document, or customer data crosses. Because the
summary is non-sensitive, it is available to a `transport:read` operator without granting
customs access. The read is tenant-filtered (a cross-tenant customs reference returns
nothing).

## Operator handoff

- On `VESSEL_ARRIVED` / `DISCHARGED`, the shipment detail surfaces customs readiness and a
  link to `/customs/intelligence`.
- `CUSTOMS_PROCESSING` / `CUSTOMS_RELEASED` are READ from the customs summary and shown on
  the shipment; a `CUSTOMS_RELEASED` milestone may also be entered manually in the studio if
  the operator is driving the ocean timeline by hand — but this changes only the SHIPPING
  milestone, never the customs record.
- `GATE_OUT` begins the road delivery leg (existing transport domain, unchanged).

## No cycles

Shipping reads customs; customs does not read shipping; neither writes the other. There is
no automatic write in either direction — a human links or advances, and each domain audits
its own action.
