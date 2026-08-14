# Effitrans — tracking data activation audit

**Date:** 2026-08-14 · **Baseline:** `c4d742a` · **CI #463 GREEN** · **Ledger 105/105** · **No migration, no implementation.**

## The one-line answer

**The tracking system is built — all of it. It has no data.** Every table in the
spine is empty except **four seeded reference locations**, and the four markers on
the aggregated map are exactly those: two ports and two airports. Nothing is
tracking anything, because no shipment is structurally connected to a coordinate.

---

## 1. Current marker provenance — the highest-priority question

`lib/executive/readers/fleet-map.ts` builds the aggregated map from five marker
kinds. Against production data today:

| Kind | Source table | Rows in prod | Markers rendered |
|---|---|---|---|
| vessel | `ocean_container` → `ocean_vessel` | **0** | 0 |
| aircraft | `air_flight` | **0** | 0 |
| road | `tracking_position` | **0** | 0 |
| **port** | `ocean_port` | **2** | **2** |
| **airport** | `air_airport` | **2** | **2** |

**Every marker currently visible is a static reference location.** The code is
honest about it — port and airport markers are pushed with
`status: null, freshness: null, confidence: null, source: null, occurredAt: null`.

The four rows, all inserted in one statement at `2026-07-17 18:49:32`:

| Code | Name | Lat | Lon | Class |
|---|---|---|---|---|
| `CNSHA` | Port de Shanghai | 31.233 | 121.483 | **seeded reference data** |
| `SNDKR` | Port de Dakar | 14.683 | −17.417 | **seeded reference data** |
| `CDG` | Paris Charles-de-Gaulle | 49.0097 | 2.5478 | **seeded reference data** |
| `DSS` | Blaise-Diagne (Dakar) | 14.6708 | −17.0728 | **seeded reference data** |

**None is production truth about a shipment.** They are operational reference
geography — correct, useful, and not tracking.

## 2. The architecture you described already exists

The target design in the brief is, verbatim, what is implemented:

```
Provider adapter → normalized tracking event → position resolver
   → freshness + confidence → provider-neutral map projection → Leaflet
```

`lib/shipping/intelligence/map-projection.ts` states its own contract:

> A provider-neutral projection any mapping library can consume. It imports NO
> mapping library … Every marker carries source, confidence, and freshness; stale
> positions raise a warning so the UI never renders them as live.

**Do not build a second tracking system.** Components present and working:
`lib/tracking/{position,geo,geofence,eta,events,health,flags,config}.ts`,
`lib/shipping/intelligence/*` (ocean), `lib/air/intelligence/*` (air),
`components/shipping/shipment-map*`, `components/portal/leaflet-map.tsx`.

## 3. The single structural break

The geocoded chain is:

```
shipment → ocean_container (shipment_id, voyage_id, vessel_id)
         → ocean_voyage (origin_port_id, destination_port_id)
         → ocean_port (latitude, longitude)
```

`shipment` carries **`origin` and `destination` as free text**, with **no foreign
key** to `ocean_port` or `air_airport`. Production:

| Dossier | Mode | Origin | Destination | Container/AWB | Vessel/Flight |
|---|---|---|---|---|---|
| …00001 | SEA | `Shanghai` | `Port de Dakar` | — | — |
| …00002 | AIR | `FRANCE` | `DAKAR SENEGAL` | AWB present | `AF0710/19` |
| …00003 | SEA | `Marseille, France` | `Dakar, Sénégal` | container + BL | `MSC DEMO VESSEL 01` |

`"Shanghai"` is not `CNSHA`. `"FRANCE"` is a country, not an airport. `"Marseille"`
has no port row at all. **`ocean_container` has 0 rows**, so no shipment reaches a
voyage, a port, or a coordinate.

**This is the blocker.** Not the map, not the provider, not the renderer.

## 4. Mode readiness

### SEA
Schema is complete — carrier, vessel (IMO/MMSI), voyage, container, port call,
route leg, tracking event, ETA source/confidence, milestones. **All empty.**
Shipment-level fields (`bl_awb_ref`, `container_ref`, `carrier_name`,
`vessel_or_flight`) are populated on 1–2 dossiers but are **strings on the
shipment**, not links to the tracking objects.

### AIR
Same shape: `air_airline`, `air_awb`, `air_flight` (with `origin_airport_id` /
`destination_airport_id`), `air_flight_leg`, `air_tracking_event`, 13 milestones.
`air_airport` has 2 rows; **everything else is empty**. `lib/air/intelligence/service.ts`
already builds the projection from `flight.origin` / `flight.destination` — it just
has no flight.

### ROAD
`tracking_position` is a genuine GPS table — `latitude`, `longitude`,
`accuracy_meters`, `heading_degrees`, `speed_kph`, `source`, `customer_visible`,
`recorded_at`, `received_at`, `recorded_by`, `idempotency_key` — with
`tracking_session`. **0 rows in all three.** `transport_record` (3 rows) holds
`vehicle_plate` and `driver_user_id` but **no coordinates**: today Effitrans records
**vehicle assignment only**, category (1) of the brief's list.

## 5. Provider readiness — code exists, production not activated

Adapters exist and are **honest stubs**: every operation returns `unsupported`
or `not_configured`, never a fabricated position. `provider_code = 'manual'` on
all three shipments.

The whole layer is **dark by default**: `lib/tracking/config.ts` gates on
`TRACKING_ENABLED`, with sub-flags for driver mobile, portal live, realtime and
geofence — each inert without the master. Production env values were **not
inspected and not changed**; the empty position tables are consistent with dark.

## 6. Security

RLS is **enabled with policies on every tracking table** — `ocean_port`,
`air_airport`, `ocean_container`, `ocean_voyage`, `ocean_tracking_event`,
`air_tracking_event`, `tracking_event`, `tracking_position`, `tracking_session`,
`shipment`. `tracking_position` carries `customer_visible`, so driver location is
gated rather than globally readable. The fleet-map reader refuses without
`transport:read` and says so in French. **Nothing to loosen; nothing loosened.**

## 7. Data quality

**No defects — because there is no data.** Zero rows means zero impossible
coordinates, zero `0,0`, zero future timestamps, zero duplicates, zero orphans.
The four reference coordinates are plausible and correct for their places.

## 8. Map semantics — one honest ambiguity

The projection models `kind: origin | destination | port | current | milestone`
plus source/confidence/freshness, and warns on stale. The executive map adds
`port` / `airport` kinds with explicitly null status.

**But the UI caption reads « N marqueur(s) »** without distinguishing a *reference
location* from a *live position*. With four static markers and no positions, a
reader can reasonably conclude four things are being tracked. That is the one
presentational issue worth fixing — and it is a **labelling** change, not a
redesign. Reported, not implemented.

## 9. Activation matrix

| Capability | Code | Schema | Prod data | Provider/config | Map-ready | Blocker |
|---|---|---|---|---|---|---|
| Port locations | ✅ | ✅ | **2 rows** | n/a | ✅ | more ports needed |
| Airport locations | ✅ | ✅ | **2 rows** | n/a | ✅ | more airports needed |
| SEA shipment identity | ✅ | ✅ | strings only | n/a | ❌ | **no link to port/voyage** |
| Container tracking | ✅ | ✅ | **0** | stub | ❌ | data + provider |
| Vessel tracking | ✅ | ✅ | **0** | stub | ❌ | data + AIS provider |
| AIR tracking | ✅ | ✅ | **0** | stub | ❌ | data + provider |
| Vehicle assignment | ✅ | ✅ | 3 records | n/a | ❌ | no coordinates |
| Road GPS | ✅ | ✅ | **0** | `TRACKING_ENABLED` dark | ❌ | activation + device |
| Position resolver | ✅ | ✅ | — | — | ✅ | none |
| Freshness / confidence | ✅ | ✅ | — | — | ✅ | none |
| Map projection | ✅ | ✅ | — | — | ✅ | none |
| Leaflet renderer | ✅ | — | — | — | ✅ | none |

## 10. What it takes to fire up the map — by category

### 1. Already working (zero development)
Renderer, projection, position resolver, freshness, confidence, source
attribution, bounds, stale warnings, RLS, permission gating, port/airport
reference model, ocean + air domain models, milestones, ETA model, geofence, the
provider adapter seam.

### 2. Data entry into existing fields
Link each shipment to its geography and carrier objects: create the
`ocean_container` row (shipment + container number + voyage), the `ocean_voyage`
(origin/destination port + vessel), and for air the `air_flight` (airline +
origin/destination airport). **All of these have UI — `/shipping` and `/air`
management screens exist.**

### 3. Reference data
Add the ports and airports Effitrans actually uses. Today only 4 exist, and
**none matches the current dossiers' text** (Marseille and CDG-vs-"FRANCE" are
unmatched). A modest UN/LOCODE + IATA set for Effitrans' real trade lanes.

### 4. External integrations
Only for **live movement**: AIS/carrier APIs for vessel positions, an aviation
feed for flights, a GPS source for trucks. **None is required for a correct
origin → destination map.**

### 5. Actual engineering gaps
**One:** nothing links `shipment.origin` / `shipment.destination` to the geocoded
reference tables. Whether that is solved by data entry (create the voyage/flight
objects) or by schema (`origin_port_id` on `shipment`) is a design decision —
**not made here**, per the brief.

### 6. Business decisions
Which lanes/ports/airports to seed · whether trucks are tracked by driver phone
or a telematics device · which carriers matter for provider selection · whether
customers see live positions (`customer_visible`, `PORTAL_LIVE_TRACKING_ENABLED`).

## 11. Recommended roadmap

**TRACK-0 — Truthful labelling.** Distinguish « position » from « lieu de
référence » in the map caption. Small, no schema, removes a real misreading.

**TRACK-1 — Static origin → destination map.** Seed the real ports/airports, then
link the existing dossiers through the existing `/shipping` and `/air` screens.
**No provider, no migration, no new code** — this is the phase that makes the map
genuinely useful, and it is mostly data entry.

**TRACK-2 — Maritime activation.** Choose a carrier/AIS provider, implement one
adapter behind the existing seam, activate flags. Migration only if the adapter
needs credentials storage.

**TRACK-3 — Air activation.** Same shape.

**TRACK-4 — Road live location.** `TRACKING_ENABLED` + `DRIVER_MOBILE_TRACKING_ENABLED`,
driver app capture into `tracking_position`. Schema is ready.

**TRACK-5 — ETA / alerts / exceptions.** The ETA and geofence engines already exist.

Sequence deliberately puts **data before providers**: with TRACK-1 alone the map
shows every dossier's true route endpoints, which is most of the operational
value, at zero integration cost.

## 12. Questions for Effitrans

1. Which ports and airports should be seeded (real trade lanes)?
2. Are trucks tracked by driver phone or a telematics device?
3. Which shipping lines matter most — that decides the first adapter.
4. Should customers see live positions in the portal, or only milestones?
5. Should `shipment.origin/destination` become structured references, or stay
   free text with the voyage/flight objects carrying the geography?

## 13. Scope of this phase

**Audit only.** No migration, no schema, no provider, no production change, no
environment variable read or written, no map redesign. Read-only production
queries and repository evidence only.
