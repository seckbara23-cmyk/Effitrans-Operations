# Phase 7.2A — Tracking confidence & data freshness

Two orthogonal, explicit dimensions describe every tracking datum. Neither is ever
inferred away: a stale position never renders as live, and an inferred position never
renders as confirmed.

## Confidence — how do we know?

| Confidence | Meaning |
|---|---|
| `CONFIRMED` | A first-party event states this directly (carrier milestone with a known port; road GPS fix; terminal gate event). |
| `INFERRED` | Derived from a linked fact, not stated directly (container's position taken from the vessel it is confirmed loaded on). |
| `MANUAL` | Entered by an authorized operator. Always visibly labelled as manual. |
| `ESTIMATED` | A system estimate (e.g. a port location used as an approximate position, or a system ETA). Never presented as carrier-confirmed. |

Rule: **never present `INFERRED` or `ESTIMATED` as `CONFIRMED`.** The current-position
resolver and every marker carry the confidence verbatim.

## Freshness — how old is it?

Freshness is a PURE function of `now - occurredAt`, classified against source-specific
thresholds (a carrier milestone is meaningfully "recent" for far longer than an AIS
position).

| Freshness | Intent |
|---|---|
| `LIVE` | Within the source's live window. |
| `RECENT` | Older than live but still operationally trustworthy. |
| `STALE` | Old enough to warn the operator. |
| `VERY_STALE` | Old enough that the datum should not drive decisions. |
| `UNKNOWN` | No timestamp available. |

### Default thresholds (documented defaults, changeable on confirmation)

Thresholds differ by source because the sources update at very different cadences. These
are **defaults**, not product guarantees, and live in one pure table
(`lib/shipping/intelligence/freshness.ts`).

| Source | LIVE ≤ | RECENT ≤ | STALE ≤ | else |
|---|---|---|---|---|
| `ROAD` (GPS) | 15 min | 2 h | 12 h | VERY_STALE |
| `AIS` | 2 h | 6 h | 24 h | VERY_STALE |
| `CARRIER` | 12 h | 48 h | 7 d | VERY_STALE |
| `PORT` / `TERMINAL` | 12 h | 48 h | 7 d | VERY_STALE |
| `CUSTOMS` | 24 h | 72 h | 14 d | VERY_STALE |
| `MANUAL` | 24 h | 7 d | 30 d | VERY_STALE |
| `SYSTEM` | 1 h | 6 h | 24 h | VERY_STALE |

Rationale: AIS positions age quickly (a vessel moves); a "vessel departed" carrier
milestone stays meaningful for days; a manual note is trusted longer because a human
asserted it deliberately.

## Presentation contract

Every current-position panel and every map marker MUST show: **last update, source,
confidence, and freshness.** A `STALE`/`VERY_STALE` marker must be visually distinct from
a `LIVE` one, and the map projection emits a warning flag for stale positions so the UI
cannot accidentally render them as current.
