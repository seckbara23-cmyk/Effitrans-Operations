# UT-2 — Merged Two-Plane Unified Timeline: Completion Report

**Date:** 2026-08-10 · **Commit:** `031d9db` · **Migration: NONE** · **UI: none** ·
**Emitters: none** · **New permissions: none** · **New tables: none**
**Governing decision:** **DEC-B88** (UT-1A freeze) · Brief: [ut-2-implementation-brief.md](ut-2-implementation-brief.md)

---

## 1. Repository audit

| Subject | Verified finding |
|---|---|
| `lib/unified-timeline` | UT-1's `contract.ts` + `decision-plane.ts`; contract already carried `observation` / `computed` / `external` and a `confidence` slot — **UT-2 added no field to it** |
| `ocean_tracking_event` | 22 types incl. `POSITION_UPDATE` / `ETA_UPDATE`; bitemporal (`occurred_at` ≠ `received_at`); `source` ∈ CARRIER/AIS/PORT/TERMINAL/CUSTOMS/ROAD/MANUAL/SYSTEM; `confidence` ∈ CONFIRMED/INFERRED/MANUAL/ESTIMATED; carries `latitude`, `longitude`, free-text `description` |
| `air_tracking_event` | same shape, 15 types, `location_iata` instead of `location_unlocode`; append-only (`prevent_mutation`) |
| **Observation RLS** | `tenant_id = auth_tenant_id() AND has_permission('transport:read')` — **NOT dossier-derived**. Decisive for §8 |
| Dossier attribution | `ocean/air.shipment_id → shipment.id`, and `shipment.file_id` is **NOT NULL UNIQUE** → the dossier is resolvable **by key** |
| Position / ETA / freshness | `resolveCurrentPosition`, `eta.ts`, `classifyFreshness` — all pure, all reused; **none rewritten** |
| `lib/logistics/compose.ts` | composes domain **tables** directly (UT-0's D4). **Left alone — UT-4 absorbs it** |
| Timeline readers | UT-1's reader + the WES-9 dossier/quotation/portal readers; untouched |
| `clientSafe` rules | 17 registry types, an allow-list — reused verbatim |
| Pagination | UT-1's opaque cursor; UT-2 adds a plane-agnostic one |
| Metadata redaction | per-type allow-list + ~30-key deny-list at write; UT-1 re-applies it at read |

### 1.1 The road-tracking gap — documented, not silently absorbed

`public.tracking_event` (Phase 3.4) **is** a canonical store for road/position events, and in
one respect it is *better* than ocean/air: `file_id` is `NOT NULL`, so attribution is direct.
But it **does not fit the frozen Plane B contract**:

* its `source` vocabulary is different — `manual` / `driver_mobile` / `vehicle_gps` /
  `carrier_api` / `vessel_api` / `flight_api`;
* it has **no `confidence` column at all**;
* it carries `customer_visible` + `customer_message` (its own clientSafe notion) and
  `internal_note` (must never leak).

Admitting it to UT-2 would mean either **fabricating a confidence grade** — which DEC-B88
and this phase's brief both forbid — or **adding a column**, which is a migration and would
have required stopping for approval. **It is therefore excluded from UT-2 and raised as a
UT-3 decision (§16).** No third source was added.

## 2. Architecture reused

UT-1's contract, comparator and provenance derivation · `clientSafeEventTypes()` ·
`classifyFreshness` · `isFileVisible` · the existing ocean/air stores. **Nothing was
rebuilt, and no field was added to UT-1's frozen contract.**

## 3. Two-plane merge design

Two adapters project their rows into one shape; a merge orders them; nothing is copied.

* **Decision adapter** — `fromDecisionEntry()` maps UT-1's `TimelineEntry`, preserving
  ordinal and derived provenance.
* **Observation adapter** — `readObservationPlane()` reads ocean + air for one dossier,
  drops telemetry, and carries `source` / `confidence` / `freshness` verbatim.
* **Merge** — `readUnifiedTimeline()` concatenates, re-scopes, assigns chronology, sorts,
  paginates.

## 4. Canonical merged type

`UnifiedEntry` carries every field the brief required: `entryId · tenantId · dossierId ·
subjectType · subjectId · plane · nature · origin · eventType · occurredAt · ordinal ·
observationSource · confidence · freshness · label · summary · locationName · domain ·
actorId · actorName · chronologyGroup · chronologyProvable · clientSafe · paginationToken`.

**Not carried:** email bodies, document bodies, unrestricted metadata, amounts, audit
payloads, HR data, coordinates, or the observation `description` (free text).

## 5–6. Adapters

Decision entries keep their ordinal; observation entries are **never given one** —
an observation's position is its world time, and a sequence would record *our* ingest order.
`nature` is `observation`; `origin` is `external` unless the source is MANUAL (`human`) or
SYSTEM (`system`).

## 7. Ordering and grouping — with the defect the tests caught

The comparator is `occurredAt` → (ordinal, **only** when both entries are Plane A and both
have one) → source id.

> **A real defect, found by the test that exists to find it.** Entry ids are prefixed `A:` /
> `B:` so the two planes' ids cannot collide. The tiebreaker compared that *prefixed* id —
> which made **every decision sort before every observation** at a shared instant. That is
> exactly the fixed plane precedence ADR-UT-2 forbids, reintroduced through a string. The
> tiebreaker now strips the prefix, and the cursor uses the same key, or paging would
> disagree with ordering precisely where order is least certain.

Grouping is stricter than "same instant":

| At one instant | Result |
|---|---|
| a single entry | its own group, provable |
| several Plane-A entries, **all** with ordinals | each its own group, provable — the ordinals record the real order |
| anything else (planes mixed, or any NULL ordinal) | **ONE group**, every member `chronologyProvable: false` |

An ordinal does **not** rescue provability once an observation shares the instant: A1<A2
stays true, but neither is ordered against B, so the honest answer is one group.
`received_at` appears nowhere in any ordering path (pinned).

## 8. Visibility review

Plane A leans on the ledger's RLS, corrected in UT-1 to be subject-based.

Plane B is gated **in the application**, because its stores' policies are
`transport:read`-based. Relying on them would have been wrong in **both** directions: a
`transport:read` holder who cannot read a dossier would have seen its observations, and a
dossier reader without `transport:read` would have seen none. `isFileVisible` — the same
predicate `can_read_file` encodes — runs **before** the admin client is touched (pinned by
test), and the merged reader re-scopes every entry to the requested dossier **and** the
caller's tenant.

Attribution is **structural**: dossier → shipment by key. No tenant guessing, no
client-name matching, no sender matching, no heuristics (pinned). **No permission is
referenced or minted anywhere in the module; SYSTEM_ADMIN gains nothing.**

## 9. Client-safe projection

An **allow-list on both planes** — the failure mode of forgetting to classify must be a
missing row, not a disclosure. It strips actor identity, observation source, confidence and
freshness, and keeps only four summary keys. `EXCEPTION` is deliberately excluded (it is
where internal detail collects); telemetry never reaches the timeline at all.

**Chronology and grouping are preserved exactly** — a customer is entitled to the same
truthfulness about what we do not know — and `containsUnprovenOrder` is recomputed over
what *survives* the filter.

**Built and exposed to nothing.** No portal route consumes it, no portal permission exists.
Wiring is UT-5, after RATIFY-UT-3/UT-4.

## 10. Pagination

Cursor = `(occurredAt, entryId)`, opaque, carrying **no plane and no ordinal** — it is a
position in a page, not a claim about sequence. **A page never splits a chronology group**:
it ends at the last complete group that fits, and an oversized first group is returned
whole rather than cut, because half a simultaneous set reads as "the rest happened later".

## 11. Security review

Tenant scoping on every read · dossier gate before the admin client · no permission minted ·
SYSTEM_ADMIN unchanged · portal unchanged · `audit_log` never read (pinned) · nothing
written anywhere in `lib/unified-timeline` (pinned) · only three source tables read
(`shipment`, `ocean_tracking_event`, `air_tracking_event` — pinned exactly) · no free text,
coordinates or money projected · nothing copied into `business_event`.

## 12. Files changed

**New:** `lib/unified-timeline/{merged,observation-plane,unified}.ts` ·
`tests/ut-2-merged-timeline.test.ts`.
**Modified:** `tests/ut-1-ordering.test.ts` — its "UT-2 has not begun" marker was correctly
falsified by UT-2 starting and is re-aimed at what UT-1 actually owns.
**Unmodified, deliberately:** `lib/unified-timeline/contract.ts` (UT-1's frozen surface;
the dependency points one way, pinned).

## 13. Tests

**Local: 204 files / 5064 tests green · tsc 0 · build clean.** 40 UT-2 contracts covering
every behaviour the brief listed: single-plane A, single-plane B, merged ordering,
same-instant grouping, no plane precedence, `received_at` never ordering, no ordinal on
Plane B, confidence preserved and unknown-stays-unknown, historical NULL ordinals,
`audit_log` excluded, approved source tables only, no copying, dossier isolation,
tenant re-scoping, SYSTEM_ADMIN unchanged, clientSafe filtering, no bodies, no amounts,
stable pagination, group-preserving boundaries, and **no migration added**.

**No new RLS suite was added, deliberately.** UT-2 changes no schema and no policy; its
database-level guarantees are UT-1's, already proven by `rls_decision_plane_test.sql`. A new
suite would have re-asserted someone else's invariants.

## 14. CI

Pending at the time of writing; the result is recorded below when the run completes.

## 15. Deployment implications

**None.** No migration, no schema change, no permission, no flag. The code is inert until a
caller invokes the reader, and UT-2 adds no caller. Nothing to apply, nothing to verify in
production.

## 16. Remaining UT-3 dependencies

| Ref | Item | State |
|---|---|---|
| **UT3-ROAD** | admit `public.tracking_event` to Plane B? It has no `confidence` column, so this needs either a ratified "road observations carry no confidence grade" rule or a migration adding one. **Do not fabricate a grade** | **new — raised by this phase** |
| RATIFY-UT-5 | order of the 9 missing emitters | open |
| RATIFY-UT-3 / UT-4 | customer-visible positions / ETA wording | open — blocks UT-5, not UT-3 |
| RATIFY-UT-6 | telemetry retention | open |
| D4 | absorb `lib/logistics/compose.ts` | UT-4 |

## 17. Readiness for UT-3 and UT-4

**UT-3** (missing emitters) is unblocked except for the road decision above; new emitters
need no reader change — an emitted event appears in the merged timeline automatically.
**UT-4** (the surface) is unblocked: it consumes `readUnifiedTimeline` and must render
`chronologyGroup` as simultaneity and `confidence` as confidence.

---

## Confirmations

* **UT-2 is complete** as specified; nothing in scope was deferred except the road store,
  which is documented as a decision rather than silently included.
* **No migration was added** — the chain is unchanged at 85 (pinned by test).
* **No UI was created.**
* **No emitter was added** — the registry is untouched and the 9 reserved types still have
  none.
* **No history was copied** — nothing writes to any store, and no observation reaches
  `business_event`.
* **No cross-plane chronology was invented** — same-instant cross-plane entries are grouped,
  and the plane-precedence defect that would have violated this was found and fixed.
* **`audit_log` remains excluded** (pinned in all three modules).
* **UT-3 has not begun.**
