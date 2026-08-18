# TMS-2 — Shipment ↔ Geography: audit & implementation contract

**Date:** 2026-08-18 · Governing frame: frozen TMS-0 roadmap (`544a2de`), ratified
TMS-Q1..Q8, TMS-1 shipped (`4f8c638`, migration 115 applied in production).
**Verdict: GO — one small additive migration is genuinely required; everything
else already exists and is reused.** No new business decision is needed: Q8's
authority already exists in code, linking rides the existing dossier-edit path,
and the honest backfill answer is « none ».

## 1. The exact structural break

`shipment.origin` and `shipment.destination` are **free text** (created that way
in migration 2, `20260614000002`) with **no reference to `ocean_port` or
`air_airport`** — even though both reference tables exist (migrations
`20260716000004/6`) complete with UN/LOCODE-or-IATA codes, coordinates,
timezones, tenant scoping, RLS, audited CRUD and studio UI. Geography attaches
to a dossier only through *optional, later* tracking-studio artifacts
(`ocean_route_leg.origin_port_id/destination_port_id`, `air_awb → air_flight →
origin/destination_airport_id`). Consequences observed in code:

- A SEA shipment with no route legs (the normal state before studio work) has
  **no resolvable endpoints**; the staff ocean map builds with
  `buildShipmentMapProjection({ current, milestoneMarkers })` — no origin, no
  destination — and the portal carriage map does the same.
- The AIR map resolves endpoints only when an AWB with a flight exists.
- The dossier-level origin/destination the intake actually records can never
  anchor the map, an ETA model, or geofences — it is a label, not an entity.

This is precisely the TMS-0 finding: the spine cannot *identify* the geographic
entities the tracking planes are keyed on.

## 2. Existing to reuse (all confirmed in source)

`ocean_port` (unlocode/name/country/lat/lng/tz, UNSEEDED doctrine — no invented
coordinates) and `air_airport` (iata/icao/city/…) — both tenant-scoped, in
`TENANT_SCOPED_TABLES`, RLS `select to authenticated` gated `transport:read`;
audited CRUD in `lib/shipping/intelligence/manage-actions.ts` /
`lib/air/intelligence/manage-actions.ts` gated **`transport:manage`**; studio
surfaces **`/shipping/ports`** and **`/air/airports`** already built;
`listPorts` / `listAirports` reads gated `transport:read`; the provider-neutral
`buildShipmentMapProjection` already ACCEPTS `origin`/`destination` MapPoints;
`enforce_shipment_tenant` trigger as the tenant-boundary idiom; the dossier edit
path (`createFile`/`updateFile` → `shipmentRow()`), where origin/destination
text already lives.

## 3. Proposed schema change (the one genuinely required)

**Migration 116 — `20260907000001_shipment_geography.sql`, additive only:**

- Four **nullable** FK columns on `shipment`: `origin_port_id`,
  `destination_port_id` → `ocean_port`; `origin_airport_id`,
  `destination_airport_id` → `air_airport`. Free-text `origin`/`destination`
  are **preserved untouched** as the human label and intake requirement.
- Partial indexes on each.
- A sibling trigger `enforce_shipment_geo_tenant` (same idiom as
  `enforce_shipment_tenant`): a geo reference must belong to the shipment's own
  tenant — the DB-side boundary the FK alone cannot express.
- Self-assertions: columns present, trigger present, zero cross-tenant rows,
  and **no permission / no policy** created by this migration.

Explicitly rejected alternatives: a new « location » table (competing model —
forbidden), making the FKs NOT NULL or intake-blocking (would block ROAD and
early dossiers), seeding coordinates (UNSEEDED doctrine), geocoding the free
text (fabrication).

## 4. Port/airport ownership & editing authority (TMS-Q8)

Already answered by the existing architecture, reused as ratified: **catalog
authority = `transport:manage`** (existing audited CRUD + studio pages — no new
permission, no new surface); **reading = `transport:read`** (existing RLS);
**linking a dossier to geography = the existing dossier-edit authority** (the
same path that edits the origin/destination text today), with tenant membership
re-validated server-side and DB-side. Roles holding `transport:manage` are
unchanged.

## 5. How each mode resolves geography

- **SEA:** `shipment.origin_port_id/destination_port_id` → `ocean_port`
  coordinates (only when coordinates exist — never invented); fallback: first
  route leg's origin port / last leg's destination port. Feeds the staff map's
  previously-empty endpoint inputs.
- **AIR:** the EXISTING flight-based resolution stays primary (the actual
  flight outranks the plan); `shipment.origin_airport_id/destination_airport_id`
  is the fallback when no AWB/flight exists yet.
- **ROAD:** unchanged — positions are GPS fixes (`tracking_position`),
  endpoints are pickup/delivery addresses; Q8 ratified ports/airports only, and
  no road reference entity is invented.
- **MULTIMODAL:** may carry port and/or airport anchors (app-validated); the
  international leg's mode governs.

## 6. RLS / RBAC consequences

**None.** No new permission, no policy change, no grant change. Staff reads go
through existing service gates; the two new picker option loads REUSE
`listPorts`/`listAirports` (`transport:read`) and the pickers render only for
holders. DB-side, the new trigger NARROWS what a write can do (cross-tenant geo
refused) — it grants nothing.

## 7. Customer-portal consequences

**None in TMS-2.** The portal carriage map keeps its current behavior
(markers from customer-visible events). Rendering endpoint markers to customers
is a TMS-3 activation question (ratified Q7: customer view withholds internal
notes; paid providers dark) and is deliberately NOT touched here. A scope-guard
test pins that `lib/portal` gains no geography reads.

## 8. Migration/backfill strategy for existing dossiers

**No backfill.** Free text cannot be honestly resolved to reference entities
(matching « Dakar » to a row is a guess, and the reference tables are unseeded
in production). Existing dossiers keep text labels and NULL anchors; operators
link geography when it matters (tracking activation, TMS-3). This mirrors the
ratified TMS-1/D3 honesty doctrine: never fabricate what was not recorded.

## 9. Tests & mutation gates

- **SQL suite** `tms_2_shipment_geography_test.sql` (appended LAST in ci.yml;
  runs-last pin moved): columns nullable; same-tenant link accepted;
  cross-tenant port AND airport refused by the trigger; deleting a referenced
  port refused by FK.
- **Vitest suite** `tests/tms-2-shipment-geography.test.ts`: bounded migration
  slices (columns, trigger, assertions; no `create policy`, no permission
  insert); action pins (server-side tenant + mode validation, French errors);
  resolver pins (SEA FK-then-legs; AIR flight-first-then-FK); UI pins (pickers
  gated, optional); scope-guard pins (no vehicle/fleet/fuel/maintenance/
  telematics/route-optimization tables anywhere in the migration; portal
  untouched); build-info pair.
- **Mutations:** M1 drop the trigger's tenant check (SQL suite catches); M2
  drop the app-side tenant validation; M3 drop mode consistency; M4 invert AIR
  resolution order; M5 leak pickers to non-holders; M6 make a geo column NOT
  NULL. All must be CAUGHT.

## 10. Production UAT plan (after operator applies migration 116 + deploy)

1. `/shipping/ports`: create the two real ports of an active SEA dossier
   (with coordinates). `/air/airports`: one airport pair.
2. Edit that SEA dossier: the « Port d'origine / Port de destination » pickers
   appear (transport:read holder), select both, save. Staff shipment map now
   shows origin/destination markers; a dossier with unlinked geography renders
   exactly as before.
3. AIR dossier without AWB: link airports, map shows endpoints; then attach a
   flight and confirm the flight's airports take precedence.
4. ROAD dossier: form unchanged, no pickers for ports on a ROAD mode, tracking
   unchanged.
5. Cross-tenant/negative: a picker never offers another tenant's entries;
   attempting a mismatch (mode vs anchor) is refused in French.
6. Portal: open the client view of the SEA dossier — identical to before.

**Scope guard honored:** no vehicle management, maintenance, fuel, telematics,
fleet accounting, route optimization, driver payroll, carrier billing; no MAYA
parity invented (MAYA had no GPS/vehicle registry/workflow engine). TMS-3
(tracking activation) NOT begun.
