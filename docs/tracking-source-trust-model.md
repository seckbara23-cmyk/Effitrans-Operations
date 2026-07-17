# Tracking Source Trust Model (Phase 8.4)

The single question every tracking pixel must answer honestly: **how do we know this, and how
old is it?** This document is the contract; the code enforcing it is cited throughout.

## Source taxonomy (existing, reused — not invented in 8.4)

Both immutable event journals carry source + confidence on every row:

- `ocean_tracking_event.source` ∈ `CARRIER · AIS · PORT · TERMINAL · CUSTOMS · ROAD · MANUAL · SYSTEM`
- `ocean_tracking_event.confidence` ∈ `CONFIRMED · INFERRED · MANUAL · ESTIMATED`
- `air_tracking_event` mirrors this with airline/IATA context.
- `tracking_position` (road, Phase 3.4) carries `source` ∈ `manual · driver_mobile · vehicle_gps · carrier_api · vessel_api · flight_api` — the whole road layer is dark behind `TRACKING_ENABLED`.

Mapping to the brief's vocabulary: MANUAL→`MANUAL`, MILESTONE→journal events without
coordinates, ESTIMATED→confidence `ESTIMATED`/`INFERRED`, PROVIDER/AIS/AIRLINE/TELEMATICS→the
provider sources (none connected today), SYSTEM_DERIVED→`SYSTEM`.

## Freshness is AGE, never liveness

`classifyFreshness(source, occurredAt, now)` (lib/shipping/intelligence/freshness.ts) returns
`LIVE · RECENT · STALE · VERY_STALE · UNKNOWN` with **per-source thresholds** (ROAD 15 min/2 h/
12 h · AIS 2 h/6 h/24 h · CARRIER 12 h/48 h/7 d · MANUAL 24 h/7 d/30 d · …). Central, tested,
reused by every map surface.

**8.4 correction (section O):** the user-facing label for the age-class `LIVE` was
« En direct » — which a one-hour-old *manual* entry would receive. Liveness language is
forbidden for non-live sources, so the label is now **« À jour »** (age language), always
rendered next to the source. « En direct » is reserved for a future provider whose contract
defines real-time data AND whose freshness is within threshold AND whose age is displayed —
the formal live-data contract. No current source qualifies.

## The honest display formula

Every position surface shows: **source label + freshness label + timestamp** (the map marker
model carries `source`, `confidence`, `freshness`, `occurredAt` — lib/shipping/intelligence/
map-projection.ts). Examples of compliant renderings:

- « Position manuelle · À jour · relevée le 17/07 10:42 »
- « Position estimée · non confirmée »
- « Aucune position disponible » (the existing honest empty state — preserved)

Forbidden renderings (test-pinned where mechanizable):

- a green "Live/En direct" badge on any current source;
- « Confirmé par le transporteur » on a MANUAL event;
- a plotted position without a timestamp;
- an actual-route line drawn from *planned* points.

## Current-position semantics (one per subject, by construction)

The platform does **not** store an `is_current` flag. The current position is **derived at
read time**: the resolution engines (`resolveCurrentPosition`, `resolveAirPosition`) order the
subject's located events newest-first by `occurred_at` and apply a fixed priority (road fix >
confirmed vessel > port anchor). Consequences, which satisfy the brief's rules *without* a
mutable flag:

- exactly one current position per subject per read — there is no flag to desynchronize;
- a late-arriving HISTORICAL event (older `occurred_at`) can never displace a newer one —
  ordering is by event time, not insertion time;
- concurrent inserts resolve deterministically — both rows land in the append-only journal;
  the read orders them;
- history is never overwritten — the journals are append-only (no UPDATE path in any action).

Corrections follow the journal model: an erroneous point is superseded by a newer corrective
event (the Manual Tracking Studio's preview→confirm flow), never edited in place.

## Customer-safe source language (portal)

Customers never see internal source enums, provider codes, or operator identity. The portal
carriage reader (7.5A) projects only: safe references, milestone labels, the position marker
with its source/confidence/freshness and date. Portal wording stays in the approved register:
« Mise à jour opérationnelle » / « Position estimée » — never raw enum values, never
« En direct ».

## Provider readiness (nothing faked)

Carrier/AIS/airline adapters remain **honest `not_configured` stubs** (7.2A/7.3A) surfaced in
the provider panels. A future provider plugs in behind the existing event stores by writing
journal rows with its own `source`/`provider_code`/`confidence` — the trust model above then
labels it truthfully with zero UI change. The live-data contract (above) is the bar for ever
using liveness language.
