# UT-4 — Unified Operational Timeline Experience: Completion Report

**Date:** 2026-08-12 · **Commit:** `849af88`
**CI: GREEN — run `30953710749`, 79+10 steps, 0 skipped, 0 failed**
**Migration: none · Emitter: none · Store: none · Permission: none · Route: none created**

---

## 1. Repository audit

| Subject | Finding |
|---|---|
| `lib/unified-timeline` | UT-1 contract + UT-2 merged reader + observation adapter, all intact |
| **Existing dossier timeline** | **`components/files/event-timeline.tsx` (WES-9L)** — mounted at `app/files/[id]/page.tsx:359`. Decision Plane only, unpaginated, rendered **raw metadata chips**, and carried a footnote saying handoffs and expense visas were absent |
| Icon library | `lib/icons.tsx`, 39 icons incl. `IconHistory`, `IconRoute`, `IconQuote`, `IconStamp` |
| Empty state | `components/ui/empty-state.tsx` (icon + title + description) |
| Loading | `app/files/[id]/loading.tsx` — animate-pulse skeleton blocks |
| Filter idiom | `components/files/files-filters.tsx` — `useSearchParams` + router |
| Map surfaces | `/transport` is the existing road/tracking workspace |
| Portal projection | `readClientSafeTimeline` built at UT-2, **wired to nothing** |

## 2. Canonical route decision

**No route was created.** A dossier timeline already existed, so UT-4 **absorbed** it: same
file, same export, same call site, new data source. Creating `/files/[id]/timeline` beside
it would have left two histories of the same dossier free to disagree about what happened.
The dossier page section **is** the canonical entry point, and a test pins that
`app/files/[id]/timeline`, `app/timeline` and `app/operations/files` do not exist and that
`<EventTimeline>` is mounted exactly once.

## 3. Architecture reused

`readUnifiedTimeline` (both planes, ordering, grouping, cursor) · `assignChronology` /
`truncateAtGroupBoundary` · the UT-2 clientSafe projection (**left unwired**) ·
`lib/icons` · `requireUser` + `getEffectivePermissions` · the existing `/transport` map ·
the dossier document workspace. **Nothing was rebuilt.**

## 4. Structure

| File | Role |
|---|---|
| `lib/unified-timeline/presentation.ts` | **pure** — filters, labels, icon keys, spoken descriptions, authorized links |
| `lib/unified-timeline/actions.ts` | one server action; forwards to the reader, adds no gate |
| `components/files/event-timeline.tsx` | server wrapper: first page + permissions + ledger boundary |
| `components/files/unified-timeline-view.tsx` | client: rendering, filters, grouping, load-more |

## 5. Decision / Observation visual model

Decision entries render with **stronger emphasis** and a navy tone; observations with a
lighter weight and a sand tone — because a committed decision and a carrier's report are
not equally firm, and the surface should not present them as if they were.

Each entry shows: title · date/time · plane · nature · origin · actor **or** source ·
confidence · freshness · location label · client-safe indicator · one authorized link.
**No raw metadata, no prose, no amounts.** Icons come from `lib/icons`; **no emoji** (pinned
by a codepoint-range assertion).

## 6. Chronology-group rendering — and the decision that matters most

**Chronology is assigned BEFORE filtering.** An entry is unprovable because something else
shared its instant; if the filter ran first, hiding that something else would make the
survivor look individually ordered. **The filter would have manufactured provability**, and
a user narrowing to "Commercial" would be shown a firmer history than exists. The call-site
order is pinned by test.

A group renders as a bracketed block with an explicit sentence — *"leur ordre entre eux n'a
jamais été enregistré"* — and deliberately **without `<ol>` semantics**: numbering
simultaneous events is itself a claimed sequence. The view **never sorts**; order arrives
settled. `received_at` appears nowhere.

## 7. Filters

Seven primary: All · Commercial · Communications · Operations · Documents · Finance ·
Tracking. **Tracking selects the Observation Plane**, not a domain, because an observation
has no domain. **Operations** covers `dossier`/`task`/`process`/`handoff` — one operational
idea, four registry domains, because a user does not think in domain names. Secondary
plane/origin predicates exist in the contract and default to open.

**Filters narrow what is shown, never what is true** — the timeline's meaning is not
configurable.

## 8. Pagination

The UT-2 group-safe cursor, unchanged. Appends de-duplicate by `entryId`, the client never
re-sorts, and the first page is bounded at 40 — no full history is ever loaded. One reader
call per render; **no per-entry query**.

## 9–14. Integrations

Links resolve from permissions the page already holds and return **null** when they are
missing, so an unauthorized link is absent rather than rendered-and-refused:

| Domain | Link | Never |
|---|---|---|
| Document | dossier document workspace | storage path |
| Communication | `/communications` | body, subject |
| Commercial | the quotation, behind the DEC-C32 read pair | pricing |
| Finance | the dossier | balances, invoice or payment amounts |
| Observation | **existing `/transport`** | second map engine, coordinates |

## 15. Security review

The UI queries **no module table** (pinned across nine table names) · reads only through
`readUnifiedTimeline`, which gates the Decision Plane by RLS and the Observation Plane by
`isFileVisible`, then re-scopes every entry to the dossier and the caller's tenant · the
load-more action adds **no second gate**, because a copy of a rule is the thing that drifts ·
the single admin-client read is the ledger-boundary **count** (`head: true`), tenant-scoped
from the resolved user, never from a prop · no permission is asserted or referenced in the
UI, so **SYSTEM_ADMIN gets no bypass** · the clientSafe projection is never used as internal
data · `audit_log` appears in no UT-4 file.

**Portal users** reach no internal timeline: the surface lives on `/files/[id]`, which portal
users cannot open, and `business_event` has no portal policy.

## 16. Accessibility review

Semantic `<ol>`/`<li>` · a labelled region (`aria-labelledby`) · filters as a `role="group"`
with `aria-pressed` · **every entry carries a full spoken description** including plane,
nature, origin, source, confidence, freshness and — when applicable — that its order is not
provable · `role="status"` + `aria-live="polite"` for loading, `role="alert"` for partial
failure, `sr-only` text for the skeleton · **no meaning carried by colour alone**: every tone
is accompanied by its word · wrapping layout with no fixed pixel widths for mobile.

## 17. Files changed

**New:** `lib/unified-timeline/presentation.ts` · `lib/unified-timeline/actions.ts` ·
`components/files/unified-timeline-view.tsx` · `tests/ut-4-timeline-ui.test.ts`.
**Modified:** `components/files/event-timeline.tsx` (absorbed) ·
`lib/unified-timeline/unified.ts` (filters, additively) · three test files whose assertions
pointed at the old component's internals.

## 18. Tests

**Local: 205 files / 5138 tests green · tsc 0 · build compiled.** 48 UT-4 contracts:
canonical route and no duplicate implementation · no module table · `audit_log` excluded ·
no bypass · no raw metadata, body, subject, path or amount · no emoji · filter-cannot-
manufacture-provability · group rendering without `<ol>` · no plane precedence · filters ·
group-safe pagination and de-duplication · authorized links · map reuse · accessibility
labels · honest empty states · ledger-boundary present/absent · no migration, emitter or
store.

**Two things this phase found in its own work:**

1. **A regression I introduced.** The old component said *"Auteur non enregistré"*; my first
   draft silently omitted a missing actor. It is now **more precise than the string it
   replaced**: no `actorId` means the domain records none, an unresolved `actorId` is a
   directory limit, and the two read differently.
2. **A stale honesty footnote.** The old note said handoffs and expense visas were absent —
   UT-3B emitted both. Retired rather than left to mislead, and replaced by the
   ledger-boundary statement, which is about a real and current limit. The boundary probe
   **fails closed**: unknown means "not complete".

## 19. CI

**GREEN — run `30953710749`: `build` 10/0/0, `rls-tests` 79/0/0.** The rls step count is
unchanged from UT-3B, which is itself evidence UT-4 added no database surface.

## 20. Deployment implications

**None.** No migration, no schema, no permission, no flag, no environment variable. The
change is code-only and takes effect on the next deploy of `main`.

## 21. Remaining UT-5 dependencies

| Ref | Item |
|---|---|
| **RATIFY-UT-3** | may a customer see tracking positions, and with what confidence labelling? |
| **RATIFY-UT-4** | is an ESTIMATED ETA shown to customers, and in what wording? |
| RATIFY-UT-6 | telemetry retention |
| clientSafe projection | built at UT-2, still wired to nothing — UT-5 wires it |
| Ledger marker | still unrecorded; the timeline states its own incompleteness meanwhile |

## 22. Readiness

**Customer Portal 2.0** — the projection and this UI's grouping/labelling patterns are
ready; it needs RATIFY-UT-3/UT-4 answered first, and must reuse `toClientSafe` rather than
filtering the internal entries.
**AI Operations Center** — can consume `readUnifiedTimeline` as ground truth today; it
writes nothing back, and `chronologyProvable` is the field that stops it asserting an order
the platform cannot prove.

---

## Confirmations

* **UT-4 is complete.** Nothing in scope remains.
* **No migration was added** (chain unchanged at 86, pinned).
* **No emitter was added** — exactly two reserved types remain.
* **No new event store was created.**
* **No module table was queried by the timeline UI** (pinned across nine names).
* **No chronology was invented** — and the one way a UI could have invented some,
  filtering before grouping, is pinned against.
* **`audit_log` remains excluded.**
* **Customer Portal 2.0 has not begun** · **AI Operations Center has not begun** ·
  **Enterprise Mail Platform has not begun** · **UT-5 has not begun.**
