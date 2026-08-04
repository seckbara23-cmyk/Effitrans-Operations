# UT-2 — Merged Two-Plane Read Model: Implementation Brief

**Status: BRIEF ONLY — implementation is NOT authorised.** Nothing here has been built.
**Predecessor:** UT-1 **CLOSED** 2026-08-09, migration 85 applied, ledger 85/85.
**Governing decision:** **DEC-B88** (UT-1A freeze). **Audit:** [ut-0-architecture-audit.md](ut-0-architecture-audit.md).

---

## 1. Scope

UT-2 merges the **Decision Plane** (live since UT-1) with the **Observation Plane**
(ocean/air tracking events) into one ordered, provenance-carrying read model.

**In scope:** the observation reader; the cross-plane merge and its ordering; confidence
preservation; the tenant-scoped composition gate; extending `TimelineEntry` to carry
observations without changing its shape for existing consumers.

**Explicitly out of scope:** UI (UT-4) · the 9 missing emitters (UT-3) · portal and AI
projections (UT-5) · absorbing `lib/logistics/compose.ts` (UT-4) · any change to the
Decision Plane's ordinal, contract shape or visibility rule.

## 2. What UT-1 already provides — do not rebuild

| Asset | Reuse as |
|---|---|
| `lib/unified-timeline/contract.ts` | **the** contract. `TimelineEntry`, `compareEntries`, `orderingGroupOf`, `groupUnordered`, cursor, `projectMetadata` |
| `EventNature` / `EventOrigin` | already carry `observation` / `computed` / `external`, and `Provenance.confidence` already exists as `null`. **UT-2 populates them; it adds no field** |
| `readDecisionPlane()` | one half of the merge, unchanged |
| the ordinal + total order | Plane-A ordering is settled |
| subject-based visibility | settled; Plane B needs its own equivalent (§5) |

## 3. Ordering — the rule that must not be softened

Frozen in DEC-B88 §2 and unchanged by UT-2:

* **Within Plane B:** `occurred_at` (world time). **`received_at` is display metadata and
  must never be a sort key** — sorting by it reorders the world by our inbox.
* **Cross-plane, distinct timestamps:** `occurred_at`.
* **Cross-plane, same timestamp:** the entries are **GROUPED**, with no claimed internal
  order. A deterministic plane precedence was **explicitly rejected** in UT-1A because it
  asserts that decisions precede observations at the same instant — invented chronology.
  Determinism for pagination may use (plane, id) internally; the projection must not
  present it as sequence.
* Plane B has **no ordinal and must not be given one**: an observation's position is its
  world time, and a sequence would record *our* ingest order instead.

`compareEntries` therefore needs a **plane-aware extension**, not a replacement: entries
from different planes sharing an instant must land in the same `orderingGroup`.

## 4. Provenance and confidence

| Source (Plane B) | origin |
|---|---|
| CARRIER · AIS · PORT · TERMINAL · CUSTOMS · ROAD | `external` |
| MANUAL | `human` |
| SYSTEM | `system` |

`confidence` (CONFIRMED / INFERRED / MANUAL / ESTIMATED) **must survive into the merged
entry**. ADR-UT-4 stands: an `ESTIMATED` external observation is never rendered with the
authority of a committed decision. Position and ETA remain **`computed`** and are never
persisted as events.

## 5. Visibility

Plane A's rule is settled. Plane B needs the equivalent, and **it must be derived from the
dossier, not invented**: a tracking event belongs to a `shipment`, and `shipment.file_id` is
`NOT NULL UNIQUE`, so an observation's visibility is the **dossier's** visibility.

**Constraint:** mint **no** permission. If the ocean/air tables' existing policies cannot
express dossier-derived visibility for a composing reader, the composition runs on the admin
client **with an explicit application gate** (the EC-3C pattern) — and the brief for that
step must say which of the two it chose and why.

## 6. Granularity — already decided

**RATIFY-UT-1 is decided:** the dossier timeline shows Plane-B **milestones only**.
`POSITION_UPDATE` and `ETA_UPDATE` are **permanently ineligible** for the timeline; they
remain available to the map and tracking surfaces, and at most contribute a *current*
computed state labelled with confidence. **No per-tenant granularity toggle** — a
timeline's meaning must not be configurable.

## 7. Boundaries to hold

Tracking **owns no table**. UT-2 creates no store. If the merge ever needs materialisation
for performance, that is a **cache with a rebuild-from-source guarantee**, ratified
separately — never a third ledger. Nothing crosses planes by copying. `audit_log` remains
forensic and never enters the read model.

## 8. Expected shape of the work

| Step | Content | Schema |
|---|---|---|
| 1 | `observation-plane.ts` — ocean/air reader, dossier-derived visibility, confidence preserved | none |
| 2 | plane-aware ordering: same-instant cross-plane entries share an `orderingGroup` | none |
| 3 | `readUnifiedTimeline()` — merge, page, expose `containsUnprovenOrder` | none |
| 4 | tests: cross-plane grouping, `received_at` never sorting, confidence survival, milestone-only filtering, no observation copied into Plane A, tenant isolation, RLS suite | — |

**Migration: expected NONE.** If one proves necessary, that is a signal to re-read §7
before writing it.

## 9. Risks specific to UT-2

| Risk | Guard to write |
|---|---|
| Same-instant cross-plane entries given a fake precedence | test asserting they share an `orderingGroup` |
| `received_at` creeping in as a sort key | test asserting it appears in no ordering path |
| Confidence dropped in the merge | test asserting an ESTIMATED observation keeps its grade |
| Telemetry flooding the timeline | milestone-only filter, test-pinned against `POSITION_UPDATE` |
| A materialised merge becoming a third ledger | test asserting `lib/unified-timeline` still owns no table |

## 10. Open management items

Not blocking UT-2: **RATIFY-UT-3** (customer-visible positions) and **RATIFY-UT-4** (ETA
wording) block **UT-5**; **RATIFY-UT-6** (telemetry retention) is independent;
**RATIFY-UT-5** (emitter order) belongs to UT-3.

---

**UT-2 must not begin until explicitly authorised.**
