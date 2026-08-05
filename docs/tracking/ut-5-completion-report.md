# UT-5 — Customer Operational Intelligence: Audit & Completion Report

**Date:** 2026-08-05
**Migration: none · Emitter: none · Store: none · Permission: none · Route: none created**
**Local: 207 files / 5166 tests green · tsc 0 · build compiled**

---

## 1. Repository audit — returned first, as required

| Subject | Finding |
|---|---|
| Customer Portal | **Already mature (Phase 7.5A).** `app/portal/(app)/` carries dashboard, files, documents, invoices, messages, notifications |
| Portal authentication | `requirePortalUser()` → `client_user`. **A portal user is not an `app_user`** and holds no staff permission |
| Portal isolation | `getPortalFileSummary()` reads on the **RLS-bound** client — another client's dossier is *absent*, not filtered |
| Dossier detail page | Already composes summary, next step, **ETA widget**, officer, **shared shipment map**, carriage, documents, invoices, timeline, quick actions |
| **Customer timeline** | **`components/portal/dossier-timeline.tsx`**, fed by `tracking.activity` |
| **`buildTimeline`** | **`lib/portal/tracking-derive.ts:170` — assembled the dossier's creation date + that customer's `client_notification` rows, de-duplicated by title** |
| `readClientTimeline` | WES-9K customer projection — Decision Plane only, **wired to nothing** |
| `readClientSafeTimeline` | UT-2 merged projection — **wired to nothing**, and resolved a **staff** session |
| Customer AI assistant | `lib/portal/copilot/context.ts:242` fed its `HISTORIQUE` section from the same `tracking.activity` |

### The central finding

**A customer timeline already existed, and it was not a projection of the ledger.**
It was the customer's *notification feed*, relabelled as history. Three consequences:

1. **It recorded what we had told the customer, not what had happened.** A step nobody
   emailed about was simply missing from their history.
2. **It was derived from current module state**, so it could not represent the one thing
   this programme insists on — that sometimes the platform *does not know* the order.
   It always rendered a definite sequence, including where none existed.
3. **There were three customer-history paths** (`buildTimeline`, `readClientTimeline`,
   `readClientSafeTimeline`) and the two correct ones were dead code.

So UT-5 is an **absorption**, exactly as UT-4 was — not a new portal, and not a new timeline.

## 2. What was built

**One history, projected once, behind two gates.**

`readClientSafeTimeline` was rewritten from a staff-session filter into a genuinely
portal-authorized reader. It could not have worked as written: it resolved `getCurrentUser()`,
so for a `client_user` it would have returned an empty page forever — or forced a bypass.

| Step | Mechanism |
|---|---|
| Identity | `requirePortalUser()` |
| **Isolation** | `getPortalFileSummary()` — **RLS-bound**, so the database answers, not a filter |
| Decision entries | allow-list `.in("event_type", clientSafe)` — a non-listed type never leaves the DB |
| Observation entries | **the same adapter staff use** (`fetchObservations`), behind the gate above |
| Ordering / grouping / paging | **the same `assignChronology` and `assemblePage`** |

`readObservationPlane` was split into a gate plus `fetchObservations` so the portal reuses the
adapter rather than growing a second copy of the mapping. **Two identity systems, one timeline.**

## 3. What was retired

| Retired | Why |
|---|---|
| `buildTimeline` / `CustomerTimelineEntry` | the notification-feed-as-history described above |
| `tracking.activity` | its only consumers now read the projection |
| `readClientTimeline` / `ClientTimelineEvent` | second customer projection; its **access pattern was correct and is preserved verbatim** in the survivor |

Deletions, not deprecations: on the day two customer projections disagreed, the customer is
the one who would have been told two stories.

`lastActivityAt` was re-sourced from the newest notification to the dossier's own
`updated_at` — the old value made a dossier look idle whenever work happened without anyone
being emailed about it.

## 4. The AI assistant tells the same story

The customer copilot's `HISTORIQUE` now reads the same projection. Two reasons, the second
larger than the first: the assistant and the timeline can no longer describe one dossier
differently; and notification titles are **free text** while event labels are a **closed
vocabulary** with no actor, metadata or amount. That *shrinks* what can reach a model rather
than trusting review to catch it — consistent with the standing "no C3 data in AI prompts" rule.

## 5. Security review

The customer read **selects no column it must not expose** — no `actor_user_id`, no
`metadata`, no `subject_*`, no `policy_version_id`. Withholding at the SELECT rather than
nulling after the fact means no later edit to the mapping can leak one by accident ·
tenant scope comes from the **resolved portal user**, never from an argument · **no permission
is asserted anywhere**, so SYSTEM_ADMIN gains no customer view · the portal component queries
**no module table** and imports no Supabase client · `audit_log` appears nowhere.

**A defect this phase's own tests caught:** the first draft hardcoded `clientSafe: true` on
every decision row, which made `toClientSafe` blind — one barrier, not two. It now re-checks
each row against the registry, so the `.in()` filter and the projection are **independent**:
if either is edited away, the other still refuses.

## 6. Chronology honesty survives the projection

`assignChronology` runs **before** `toClientSafe`, and a test proves the ordering of those two
calls. If narrowing ran first, hiding an internal entry that shared an instant would make the
customer's entry look individually ordered — **the projection would manufacture provability**,
and the customer would be shown a firmer history than exists.

A simultaneous group renders with an explicit sentence — *« Ces évènements ont été enregistrés
au même moment. Leur ordre exact n'est pas connu. »* — and deliberately **without `<ol>`**:
numbering simultaneous events is itself a claimed sequence.

## 7. Customer vocabulary

No plane names, no provenance jargon, no internal actor. Sources are stated in words:
**« Confirmé par Effitrans »** vs **« Information transmise par le transporteur »**, because a
committed decision and a carrier's report are not equally firm. `ESTIMATED`/`INFERRED`
observations carry **« Non confirmé »**; `MANUAL` does not, since a colleague who keyed a
milestone in did observe it. Every entry has a full spoken description; no meaning is carried
by colour alone; icons come from `lib/icons` (**no emoji**, pinned).

## 8. Tests

**37 UT-5 contracts** — one projection · no second route · gate before the admin client ·
tenant from the session · no permission asserted · allow-list not deny-filter · no internal
column selected · no module table · Audit Plane excluded · chronology before narrowing ·
unprovable-with-hidden-mate · no plane precedence · no client-side sort · shared
`assemblePage` and `fetchObservations` · customer wording · no emoji · copilot parity ·
no migration, emitter or permission.

**Re-aimed rather than deleted:** four WES-9K assertions in `tests/business-events.test.ts`
now point at the surviving projection — the *rules* they protect are unchanged — and the D4
`buildTimeline` block in `tests/portal-tracking.test.ts` was retired with its function.

Three failures in my own test authoring were fixed, not worked around: `"document"` matching
`IconDocument`, a slice anchored on an import instead of the JSX, and a `<ol>` found inside
the comment explaining its own absence.

## 9. Deployment implications

**None.** No migration (chain unchanged at 86, pinned), no schema, no permission, no flag, no
environment variable. Code-only; takes effect on the next deploy of `main`.

## 10. Scope stated honestly

The brief listed customer dashboard, documents, communications, commercial, finance,
notifications and tracking surfaces. **The audit found all of them already shipped** in Phase
7.5A / 7.6C, reusing the modules UT-5 was told not to duplicate. Rebuilding them would have
created exactly the second portal the brief forbade. **What was genuinely missing was the
history** — and that is what this phase delivered.

**Not done, and deliberately:** no new customer-visible position or ETA surface was added.
The portal already exposes a map and an ETA widget from Phase 7.5A, and **RATIFY-UT-3**
(may a customer see tracking positions, with what confidence labelling) and **RATIFY-UT-4**
(ESTIMATED ETA wording) remain **open**. UT-5 neither widened nor narrowed that existing
exposure; the timeline shows only what the `CLIENT_SAFE_OBSERVATIONS` allow-list already
admitted.

## 11. Open items preserved

| Ref | Item |
|---|---|
| **RATIFY-UT-3** | customer-visible tracking positions + confidence labelling — **still open** |
| **RATIFY-UT-4** | customer ETA wording — **still open** |
| RATIFY-UT-6 | telemetry retention |
| SEATS / SEATS-CONVERT | no role holds both `file:create` and commercial read |
| RATIFY-UT3-2/3/4 | dossier-less expense visibility, road confidence |
| Ledger marker | `HISTORICAL_EVENTS_NOT_BACKFILLED` still unrecorded (operator action) |

---

## Confirmations

* **UT-5 is complete.**
* **No second timeline was created** — one was *removed*.
* **No new portal was created** · **no new route was created.**
* **No duplicated history**: three customer-history paths became one.
* **No module table is queried by the customer timeline UI.**
* **No migration, emitter, event store or permission was added.**
* **No chronology was invented** — and the way a projection could invent some, narrowing
  before grouping, is pinned against.
* **SYSTEM_ADMIN received no bypass and no new authority.**
* **Customer Portal 2.0 has not begun** · **AI Operations Center has not begun** ·
  **Enterprise Mail Platform has not begun** · **UT-3C has not begun.**
