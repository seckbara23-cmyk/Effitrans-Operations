# Manual Tracking — Operator Guide (English)

The Manual Tracking Studio lets authorized operators record a shipment's position and
milestones when no external provider (AIS, carrier) is connected.

**Everything entered here is MANUAL DATA.** It is never shown as "carrier-confirmed" or "live".
The map and journal always display the source and age of each item.

## Permissions

- Record a position/milestone: **`transport:update`** (Coordinator, Transport Officer,
  Supervisor, System Admin, Pickup Agent).
- Manage ports/airports and their coordinates: **`transport:manage`** (Coordinator, Transport
  Officer, Supervisor, System Admin).

## Prerequisites for a map

A shipment appears on the map only if **coordinates** exist:
1. its origin/destination port or airport has latitude/longitude (Ports / Airports page —
   Lat/Lon fields); **or**
2. a manual position with latitude/longitude has been entered.
Without coordinates the map honestly shows "Carte indisponible".

## Recording a position

1. Open the shipment → Manual Tracking Studio.
2. Event type: "Position update" (or a milestone).
3. Enter date/time, latitude and longitude (decimal), location name.
4. **Preview**: check the displayed effect and any out-of-order warning.
5. If the event predates an already-recorded milestone, tick the correction checkbox.
6. **Confirm**. An audited event is written; map and journal update.

## Rules

- Valid coordinates only: latitude −90 to 90, longitude −180 to 180 (rejected at BOTH the app
  and database levels).
- The journal is **immutable**: an error is corrected by a new superseding event, never by
  editing.
- An OLDER position never replaces a newer current position.
- Every journal row shows its **source** ("Saisie manuelle", "GPS routier"…) and, for the
  current position, its **age** ("il y a 2 h").
