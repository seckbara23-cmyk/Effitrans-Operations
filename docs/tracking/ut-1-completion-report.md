# UT-1 — Decision Plane Ordering Foundation: Completion Report

**Date:** 2026-08-09 · **Migration:** 85 `20260809000001_decision_plane_ordinal.sql`
**Commit:** `a201baf` · **New permissions: none** · **New tables: none** · **New RPCs: none**
**Governing decision:** **DEC-B88** (UT-1A freeze) · Audit: [ut-0-architecture-audit.md](ut-0-architecture-audit.md)

> **STATUS: DEPLOYED & CLOSED 2026-08-09.** Migration 85 applied to production, **ledger
> 85/85**, CI green with zero skipped, deployment **PASS** with **no sequencing deviation**.
> Independent verification and its stated boundaries:
> [deployment-record-83-85.md](../releases/deployment-record-83-85.md).
> **No operator work remains.**
>
> **UT-1 IS FORMALLY CLOSED.** The Decision Plane ordering foundation is live: new events
> carry a monotonic ordinal; historical rows keep `ordinal IS NULL` and are grouped, never
> ordered. **UT-2 has not begun** and is not authorised.


---

## 1. Repository audit (performed before code)

| Subject | Verified finding | Consequence |
|---|---|---|
| `business_event` schema | `occurred_at` defaults to `now()` = **transaction start**; `id` is `gen_random_uuid()`; **no sequence, serial or ordinal column** | the D3 defect, confirmed at the source |
| Immutability | `prevent_mutation()` on UPDATE **and** DELETE, for **every role including service_role** | **no new immutability guard was needed** — the ordinal is immutable the instant it is written |
| Single write path | `emit_business_event` (SECURITY DEFINER, revoked from public); **no authenticated INSERT policy exists** | assignment could be added without touching any RPC |
| Event registry | 64 types · 12 domains · 32 rpc / 23 trigger / 9 reserved | untouched by UT-1 |
| Metadata policy | per-type allow-list + ~30-key deny-list | untouched; re-applied defensively at read |
| Existing counter patterns | **no `create sequence` anywhere**; `file_counter` / `quotation_counter` are locking **tables** | drove the allocation choice (§4) |
| RLS | dossier events via `can_read_file`; **all** non-dossier events required `admin:config:manage` | the D5 gap — one branch covering three unrelated scopes |
| Timeline readers | `readDossierTimeline` (RLS client), `readQuotationTimeline` / `readCommercialActivity` (admin + gate), `readClientTimeline` (portal allow-list) | left in place; UT-4 absorbs them |
| `event-timeline.tsx` | renders `readDossierTimeline`, ordered by `occurred_at` only | unchanged by UT-1 (no UI in scope) |
| Ordering-dependent tests | none asserted intra-transaction order — it was never expressible | no test had to be weakened |
| `lib/tracking/` | **already exists** — Phase-3.4 road telematics (geofence, driver positions) | forced the UT module to live elsewhere (§11) |

## 2. Ordering decision as implemented

The total order is **`occurred_at` → `ordinal` → `id`**, implemented once in
`compareEntries` and mirrored by the database indexes and the reader's `ORDER BY`.
`received_at` is **never** an ordering key — that is when *we* learned something, and
sorting by it would reorder the world by the state of our inbox. Cross-plane ordering is
**not** implemented: it is UT-2's, per the freeze.

## 3. Migration 85

Additive, idempotent, forward-only; migrations 1–84 untouched; **no table created**, no
RPC changed, no permission minted, no registry or metadata-policy change, **no row
updated**.

## 4. Ordinal allocation design

**A PostgreSQL sequence**, deliberately not the repository's counter-table pattern.
`file_counter` and `quotation_counter` mint **business numbers**, which must be dense,
gap-free and scoped per tenant/type/year — properties that justify a row lock. An ordering
token needs none of that and must **never block the platform's single event write path**.
Rollback gaps are harmless: we require **order, not density**, and a gap asserts nothing.

**Scope: GLOBAL**, with the reasoning stated in the migration:

* *dossier-scoped* — needs a hot counter row per dossier, and prologue events have no
  dossier to count against;
* *tenant-scoped* — puts a serialization point on every emission, to order events that are
  **never compared across tenants** (RLS means a reader only ever sees one tenant's rows);
* *global* — costs nothing, and the frozen doctrine only ever orders **within** a subject.

**Accepted trade-off, documented rather than hidden:** a tenant observing gaps in its own
ordinals can infer platform-wide event *volume*. That is low-sensitivity aggregate
information; the alternative trades it for contention on the one path every module depends
on. If ever reversed, the read contract can expose an opaque cursor instead of the raw
ordinal **with no schema change** — the cursor already exists.

**Assignment is by BEFORE INSERT trigger, not inside `emit_business_event`.** That makes
the ordinal **unspoofable by construction**: every insert path — present, future, or a
direct service-role insert — has its supplied value discarded and replaced. It also leaves
`emit_business_event`'s signature untouched, so no RPC and no caller changed.

Requirements met: deterministic · monotonic · assigned in the **same transaction** ·
unspoofable · immutable (existing guard) · tenant-safe in use · pagination-compatible ·
concurrency-safe (no locks).

## 5–6. Read contract and reader

`lib/unified-timeline/contract.ts` — **pure**: `TimelineEntry`, the comparator,
`orderingGroupOf`, `groupUnordered`, provenance derivation, the metadata-safe projection,
and an opaque cursor. Pure so the ordering doctrine is testable without a database,
including the case that matters most: where order is *not* provable.

`lib/unified-timeline/decision-plane.ts` — `readDecisionPlane()` on the **RLS-bound
client**, so visibility is enforced in **one** place (the policy) rather than restated in
TypeScript where it could drift. Returns entries, an opaque `nextCursor`, and
`containsUnprovenOrder`. Actor names reuse the **existing** `resolveActorNames`, exported
rather than copied.

Projection fields: `eventId · tenantId · dossierId · subjectType · subjectId · eventType ·
domain · eventVersion · occurredAt · ordinal · actorId · actorName · labelFr · provenance ·
metadata · orderingGroup · chronologyProvable`. Not exposed: message bodies, document
bodies, amounts, unrestricted metadata, audit payloads, HR data.

## 7. Subject-visibility review

| Scope | Before | After |
|---|---|---|
| dossier | `can_read_file` | **unchanged** |
| commercial prologue | `admin:config:manage` | `quotation:create` OR `quotation:validate` (DEC-C32) |
| correspondence prologue | `admin:config:manage` | `communication:inbound:read` OR `communication:triage` |
| configuration (`policy`, `ledger`) | `admin:config:manage` | **unchanged** |
| portal | no policy | **no policy** |

**No permission minted. Nothing widened.** SYSTEM_ADMIN **narrows** — it holds no quotation
authority, so it stops seeing commercial prologue events. That is the ratified intent, and
the RLS suite asserts it at zero. Stitched events carry a `dossier_id` and so fall in the
first branch: a dossier reader learns *that* a quotation preceded the dossier without
gaining the right to open its amounts.

## 8. Provenance derivation

Two axes, **derived from existing columns — no schema**:

* **nature** — `decision` for every Decision Plane row (the union carries `observation` and
  `computed` so UT-2 adds no field and no consumer changes shape).
* **origin** — `db_trigger` → **system always**, even with an actor, because origin
  describes *how the event was emitted*; who caused it is `actorId`, a different question.
  `policy_rpc`/`app_action` with an actor → `human`; without → `system`.

**Documented ambiguity:** `external` is unreachable on the Decision Plane — nothing outside
the platform can write to `business_event` — and becomes reachable only at UT-2.

## 9. Historical fallback behaviour

* `ordinal IS NULL` is **permanently valid** and means *"this event predates the ordinal and
  its position among same-instant events was never recorded."*
* **Nothing is synthesised.** No backfill ran; no `occurred_at` was rewritten.
* Same-instant NULL-ordinal events share one `orderingGroup` and **must be rendered as
  simultaneous**. `chronologyProvable` is `false` for them and `containsUnprovenOrder` flags
  the page.
* Sort position: NULL ordinals sort **after** recorded ones at the same instant —
  deterministic, and it keeps recorded positions ahead of unrecorded ones.
* The reader never coerces NULL to `0` (pinned by test): that would fabricate a position.

## 10. Security / RLS review

Tenant scoping unchanged · SELECT-only, no write path added · no permission created ·
SYSTEM_ADMIN narrowed, never broadened · portal still has **no policy** · `audit_log` never
enters the read contract (pinned) · no Observation Plane row is read or copied (pinned) ·
metadata deny-list re-applied at read as defence in depth · the sequence is revoked from
`public`.

## 11. Files changed

**New:** migration 85 · `lib/unified-timeline/{contract,decision-plane}.ts` ·
`supabase/tests/rls_decision_plane_test.sql` · `tests/ut-1-ordering.test.ts`.
**Modified:** `lib/workflow/events/readers.ts` (export `resolveActorNames` for reuse) ·
`lib/db/types.ts` (`ordinal`) · `lib/platform/ops/build-info.ts` (85) · `ci.yml` ·
2 drift-pin tests.

**Why `lib/unified-timeline` and not `lib/tracking`:** `lib/tracking` is the Phase-3.4
**road telematics** module — a producer of observations. Housing the Decision Plane
contract beside it would merge two bounded contexts in a directory listing, which is where
such merges usually begin. UT-4 may reconcile the naming.

## 12. Tests

**Local: 203 files / 5024 tests green · tsc 0.**

**CI: GREEN — run `30912513643` (`8de40fb`), `rls-tests` 78 steps / 0 skipped / 0 failed,
`build` 10 / 0 / 0.** `Run UT-1 decision plane ordering isolation test` — **success**, so the
clean **1 → 85** chain is proven and migration 85 has never been applied anywhere while its
suite was unproven.

**The first run (`30810034218`) was red, and the numbers are worth recording**: every
product assertion passed — `sameTime=1 incr=1 assigned=1 spoof=1 upd=1 del=1 legacyNull=1
legacyTime=1 quote=1 mailCommercial=0 adminCommercial=0 adminPolicy=1 portal=0` — and the
sole failure was `ops=0`, because the fixture created its dossier-reader actor with **no
role**, so `can_read_file()` correctly refused it. A fixture that under-provisioned its own
actor, not a policy defect: the dossier branch is unchanged by migration 85 and is already
proven by the WES-9 suite. Fixed by granting the test actor `file:read` / `file:read:all`.
**No policy was touched and no assertion was relaxed.**

`tests/ut-1-ordering.test.ts` — 43 contracts. `rls_decision_plane_test.sql` — 15 checks in
real PostgreSQL, including: three events in **one transaction** still share `occurred_at`
**and** receive strictly increasing ordinals; a supplied `-999` is **discarded**; UPDATE and
DELETE both refused; a pre-ordinal row keeps `ordinal IS NULL` **and** its original
`occurred_at`; the quotation agent sees the commercial prologue; the mail reader sees
correspondence but **not** commercial; **SYSTEM_ADMIN sees zero** commercial prologue while
keeping configuration history; portal sees zero.

**Two defects in my own fixture, caught before CI:** non-hex characters in UUID literals
(the known trap) and a boolean assigned to an integer.

Four drift pins were repaired again — EC-3D's marker joined the others in asserting its
**own** position rather than what is newest. That maintenance defect has now recurred four
times; the durable fix is in place for every phase suite.

## 13. Deployment guide

1. **Wait for CI green** — per job, per step, **zero skipped**; `UT-1 decision plane
   ordering` must appear and pass.
2. Apply migration 85 normally. **Never** `db push`, no ledger INSERT, no replay.
3. Verify: the sequence exists; `business_event.ordinal` exists and is **nullable**; the
   `trg_business_event_ordinal` trigger exists; the count of rows with `ordinal IS NULL`
   equals the pre-migration row count (**nothing was backfilled**); the SELECT policy names
   `quotation:create` and `communication:inbound:read`.
4. Ledger reads **85/85** — repair if it lags, never replay.
5. **Grant nothing.** UT-1 mints no permission.

## 14. Remaining UT-2 dependencies

| Ref | Item | State |
|---|---|---|
| **RATIFY-UT-1** | milestone granularity | **decided** in DEC-B88 (milestone-only) |
| **RATIFY-UT-3/4** | customer-visible positions and ETA wording | **open** — blocks UT-5, not UT-2 |
| **RATIFY-UT-6** | telemetry retention | **open** |
| Cross-plane ordering | same-instant cross-plane grouping | designed in DEC-B88 §2, **unimplemented** — UT-2 |
| Observation Plane reader | ocean/air composition | UT-2 |
| Missing emitters | the 9 reserved types | UT-3 |

## 15. Readiness

The ordering foundation is complete and proven in a real database. UT-2 can be built on it
without revisiting the ordinal, the contract shape or the visibility rule.

---

## Confirmations

* **UT-1 is complete.** Nothing in its scope remains; migration 85 awaits operator
  application, which is deployment, not engineering.
* **No cross-plane merge was implemented** — the reader touches `business_event` only, and
  a test pins that no observation table is referenced.
* **No UI was created** — `app/tracking` and `components/tracking` do not exist (pinned).
* **No historical order was invented** — nothing was backfilled, no `occurred_at` rewritten,
  and same-instant pre-ordinal events are grouped rather than ordered.
* **`audit_log` remains forensic only** — it appears nowhere in `lib/unified-timeline`
  (pinned).
* **UT-2 has not begun** — `lib/unified-timeline` contains exactly two files (pinned).
