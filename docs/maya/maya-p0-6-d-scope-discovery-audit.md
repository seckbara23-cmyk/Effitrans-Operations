# MAYA-P0.6-D — Scope Discovery & Ratification Audit

**Mode:** discovery and ratification only. No application code, no test, no
migration, no schema, no workflow, no permission or RLS change, no Sage change,
no MAYA APPLY, no live MAYA access, no production data touched.
**Baseline verified, not assumed:** `21d907b`, working tree clean, 101 migration
files on disk, `MIGRATION_COUNT = 101`,
`LATEST_MIGRATION = "20260823000001_maya_migration_staging"`, CI run **#432**
(`31550828121`) — rls-tests 91/0/0, build 10/0/0.
**Inputs:** this repository, plus `maya-0-parity-audit.md` and
`maya-q125-workflow-forensics.md` (read-only; the MAYA Analysis workspace was
not modified).

---

## A. Baseline verification

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| HEAD | `21d907b` | `21d907b89b60f0884a58acae6f787fc43daa8297` | ✅ |
| Working tree | clean | clean | ✅ |
| CI run | #432 / `31550828121` | completed · success | ✅ |
| rls-tests | 91 / 0 / 0 | 91 ok, 0 skipped, 0 failed | ✅ |
| build | 10 / 0 / 0 | 10 ok, 0 skipped, 0 failed | ✅ |
| Migration files | 101 | 101 | ✅ |
| `MIGRATION_COUNT` | 101 | 101 | ✅ |
| `LATEST_MIGRATION` | `20260823000001_maya_migration_staging` | identical | ✅ |

**Baseline accepted.** The audit proceeds from `21d907b`.

---

## B. P0.6 lineage reconstruction

| Phase | Intended capability | Delivered capability | Explicit exclusions | Remaining gaps |
|---|---|---|---|---|
| **P0.6-A** (`92d92cb`) | Audit the dossier workspace, naming and activity; plan B/C/D/E | One doc, 431 lines. Established: the workspace and the unified timeline **already exist**; the real gap is **reach**, not capability | No implementation, no migration, no code | Its own §S sequencing was a *proposal*, not evidence — §12 below re-tests it |
| **P0.6-B** (`dd687fa`) | Carry the derived MAYA name and identity refs into the surfaces people scan | `mayaLabel` + `legacyReference` + `clientReference` + `provenance` on `FileListItem`; list renders the derived name with generic fallback; header subtitle carries name + both refs; batched regime read behind `customs:read` | No stored MAYA type; no partial label; no per-row customs read; no `IMPORT MARITIME VRAC`; groupage/remises/autres stay unresolved | Form live-preview of the derived name (proposed in §E of P0.6-A) **was not built** |
| **P0.6-C** (`21d907b`) | Find a dossier by whatever reference is in hand | `FileSearchRow` + `matchesSearch` widened to legacy ref, client ref, vessel/flight, `ocean_container` child rows, declaration number, derived MAYA name; label derived **before** filtering; ≤3 queries/call | No second search engine; no index; no new permission; declaration never returned; legacy ref never parsed | Responsibility is still not a search or filter dimension (P0.6-A §O row 10) |

### Moment-in-time tests that now describe boundaries rather than architecture

Reported for the record. **Not modified in this audit.**

| Location | Assertion | Status |
|---|---|---|
| `tests/maya-p06b-naming-identity.test.ts` "search widening belongs to P0.6-C" | Already marked **SUPERSEDED** in P0.6-C and rewritten to assert where the property lives | Correct as-is |
| `tests/maya-p06b-naming-identity.test.ts` "no migration was added by this phase" | Pins `toHaveLength(101)` and `LATEST_MIGRATION = …maya_migration_staging` | **Will break on the next migration in any phase.** It reads as a permanent claim but is a P0.6-B-scope claim |
| `tests/maya-p06c-search-reach.test.ts` "18 — no migration was added" | Pins `toHaveLength(101)` and `MIGRATION_COUNT = 101` | Same. Both are correct *today* and correct for their phase; neither describes permanent architecture |
| `tests/maya-p06c-search-reach.test.ts` "15 — no N+1" | Pins `from("customs_record")` occurring **exactly twice** | Fragile: it encodes the current two-literal-select workaround rather than the durable property (one execution, outside the row map), which the same test also asserts |

P0.6-D does not add a migration, so none of these break under the recommendation
in §J. They are flagged because the first two will mislead a future phase.

---

## C. Remaining dossier-parity matrix

### C.1 Identity and naming

| Concept | State | Evidence | Class |
|---|---|---|---|
| Native dossier number | Identity everywhere; result key; link target | `files-table.tsx`, `getFile` | **A** |
| MAYA legacy reference | Detail header, list, search; opaque | `page.tsx:246`, `filter.ts:74` | **A** |
| Client reference | Detail header, `Identification` block, list, search | `page.tsx:247,286` | **A** |
| Derived MAYA label | Detail header + `Identification` note + list + search; `customs:read`-gated | `page.tsx:135`, `service.ts:160` | **A** |
| Dossier type (IMP/EXP/TRP/HND) | Unchanged 4-value enum | `types.ts` | **A** |
| Duplicate identity concepts | **None found.** One taxonomy module; MAYA label stored nowhere; `legacy_reference` never a key | `taxonomy.ts`, `service.ts` | **A** |

### C.2 Search and retrieval

`matchesSearch` in `lib/files/filter.ts` is the **sole** list-search authority —
confirmed by grep: no other module defines a dossier text-match. The Copilot
reads one dossier through `getFile` and never calls `listFiles`
(pinned by `maya-p06c-search-reach.test.ts`). **Class A.**

One residual: **responsibility is not a filter dimension** (`FileFilterCriteria`
has `mine` but no "assigned to X" / "responsible department" filter). Class **D**,
but it is an Effitrans ergonomics item, not a MAYA parity gap — MAYA-0 records no
such register filter. Not recommended.

### C.3 Dossier workspace — field-by-field census

`app/files/[id]/page.tsx` renders an `Identification du dossier` block plus
`FileForm` in `mode="edit"`. **The form renders every field for a read-only
viewer too** — `editable = mode === "create" || canUpdate` only sets `disabled`,
it does not hide values (`file-form.tsx:95`). So "in the form" means "visible".

| P0.5-B field | In DB | In `FileDetail` | In form | In read-only block | Class |
|---|---|---|---|---|---|
| `cargo_form`, `quantity`, `quantity_unit`, `net_weight_kg`, `gross_weight_kg`, `volume_m3`, `goods_description`, `warehouse_entry_date` | ✅ | ✅ | ✅ | ✅ | **A** |
| `package_count` | ✅ | ✅ | ✅ | ❌ | **A** (visible via form; summary omits it) |
| `supplier_name` | ✅ | ✅ | ✅ | ❌ | **A** (same) |
| `client_reference`, `on_behalf_of`, `processing_due_date` | ✅ | ✅ | ✅ | ✅ | **A** |
| `provenance`, `legacy_reference` | ✅ | ✅ | read-only by design | ✅ | **A** |
| `parent_file_id` → `parentFileNumber` | ✅ | ✅ | ✅ (select) | ✅ **as plain text, not a link** | **D** (see C.7) |

**Finding C.3-a.** `package_count` and `supplier_name` are absent from the
`Identification du dossier` summary while every sibling cargo fact is present
(`page.tsx:291–313`). This is a cosmetic inconsistency in one `<dl>`, not a
capability gap — both are readable in the form immediately below. **Not a phase.**

### C.4 Carriage units — **the gap**

| Concept | Stored | Read by portal | Read by `/shipping` | Rendered on the dossier workspace |
|---|---|---|---|---|
| Ocean containers (`ocean_container`) | ✅ Phase 7.2A | ✅ `lib/portal/carriage.ts:78,108` « Conteneurs » | ✅ `lib/shipping/intelligence/service.ts:106,245,322` | ❌ **nothing** |
| Air ULDs (`air_uld`) | ✅ Phase 7.3A | ✅ `carriage.ts:151` « ULD » | ✅ | ❌ **nothing** |
| Air cargo pieces (`air_cargo_piece`) | ✅ Phase 7.3A | ❌ | write-only helper today | ❌ **nothing** |
| `master_bl` / `house_bl` / `booking_reference` | ✅ `shipment` | ✅ `carriage.ts` references block | ✅ | ❌ **nothing** |

Grep of `components/files/`, `components/transport/`, `components/customs/`
finds **no container rendering**. The only container-shaped thing on the dossier
is `shipment.container_ref` — one free-text field in the form
(`file-form.tsx:224`). `lib/files/service.ts:122` reads `ocean_container`
**for search only** and deliberately does not return it (P0.6-C).

**The asymmetry:** a customer can see the container list for their dossier in
the portal; the Effitrans operator working that same dossier cannot, and must
navigate to the separate `/shipping` workspace and locate the shipment.

**MAYA evidence:** `maya-0-parity-audit.md:110` — « CONTENAIRE (per-container
rows; TC20/TC40 counts on the form) ». MAYA showed container detail *on the
dossier*. `maya-p0-5-a-convergence-audit.md` classification **#17 — Container
counts — NEEDS CONVERGENCE**, §3.3: *"derive the counts from `ocean_container`
rows for display/migration reconciliation. Store nothing."*

**Class B — existing authority, presentation missing.**

**Finding C.4-a — a narrowing the audit forces.** MAYA's « TC 20' / TC 40' »
counts are **not safely derivable today**. `iso_type` is written as
`normalizeReference(input.isoType, 8)` (`manage-actions.ts:179`) — unvalidated
free text with no vocabulary, no CHECK and no parser anywhere in the repo.
Deriving a size class from it would be exactly the opaque-string parsing the
programme forbids. A **total count** is safe (`rows.length`); size-class counts
are **Class C — existing data, semantics unresolved**, pending an ISO-type
vocabulary decision. Do not implement them.

### C.5 Activity / history

`EventTimeline` on the dossier page (`page.tsx:442`) mounts the UT-2/UT-4
unified timeline: decision plane (`business_event`) + observation plane
(ocean/air/road milestones), cursor-paginated, gated per plane by the ledger's
own RLS. `audit_log` is deliberately excluded as forensic-not-narrative.
`MailTimeline`, `TrackingTimeline` and `file_state_transition` history are all
mounted. **Class A. No presentation change required, and no competing activity
authority may be created.**

### C.6 Responsibility

`OwnershipPanel` (WES-3K) separates four concepts MAYA conflated — responsable
commercial, responsable opérationnel, département responsable, tâche en cours —
fed by the one access contract `getDossierAccess`. `LifecycleTracker` adds stage
and open handoff; `FileAssignment` handles assignment. **Class A. Do not invent
a new assignment model.**

### C.7 Relationships

`getFile` reads the **parent** (`service.ts:296–300`) and returns
`parentFileNumber`, rendered as plain text (`page.tsx:288`). There is **no
children reader anywhere** — grep for `parent_file_id` returns only
`lib/db/types.ts`, `lib/files/actions.ts` and `lib/files/service.ts`.

So: the parent is named but **not navigable**, and a parent dossier cannot list
what is attached to it. Class **D** for the neutral presentation; the *semantics*
of that link remain Class **E**. See §F and §G.

### C.8 Customs context

`CustomsPanel` renders behind `canReadCustoms`, and every customs read on the
page is inside that gate (`page.tsx:126–129`). The derived label's regime
dependency is gated identically. **Class A. The P0.6-C rule holds: nothing
customs-shaped is fetched for an unauthorized viewer.**

### C.9 Documents

`DocumentsPanel` (with missing-required list), `ArtifactPanel`,
`DeliveryProofPanel` and the per-document intelligence sub-route are all mounted
behind `document:read`. A user can locate every document belonging to the
dossier. **Class A. Do not redesign document management.**

---

## D. Architecture discovered (reuse inventory for the recommendation)

| Layer | Existing artefact | Reuse verdict |
|---|---|---|
| Table | `public.ocean_container` (7.2A), `public.air_cargo_piece` (7.3A) | **Reuse** — no new table |
| Index | `idx_ocean_container_shipment (tenant_id, shipment_id)`, `idx_air_cargo_piece_shipment (tenant_id, shipment_id)` | **Reuse** — the read is already indexed |
| Permission | `transport:read` | **Reuse** — no new permission |
| RLS | `ocean_container_select`: `tenant_id = auth_tenant_id() and has_permission('transport:read')`; `air_cargo_piece_select`: identical | **Reuse** — no policy change |
| Tenant registry | both in `TENANT_SCOPED_TABLES` (`tenant-tables.ts:88,99`) | Already registered |
| Reader pattern | `lib/portal/carriage.ts` (RLS client, batched, ordered) | **Reuse the shape** |
| Page-level gate | `canReadTransport` already computed at `page.tsx:145` | **Reuse the variable** |
| Component idiom | `scroll-mt-24` anchored sections; `TransportPanel` layout | **Reuse** |
| Client | `getServerSupabaseClient()` (RLS-enforced), as `getFile` uses | **Reuse** |

**Nothing in the recommendation requires a new authority.**

---

## E. Permission / RLS findings

* `transport:read` is enforced **in the database** for both tables, not in the
  UI. An unauthorized viewer's query returns zero rows because the policy
  refuses them — satisfying the P0.6-C rule that *authorization must prevent
  restricted retrieval, not merely hide retrieved values afterward*.
* Tenant isolation is in the same policy predicate (`tenant_id =
  auth_tenant_id()`), reinforced by `enforce_ocean_shipment_tenant()` triggers
  on write.
* The dossier page already computes `canReadTransport`; the recommendation adds
  an app-level gate on top of the RLS gate, matching the EC-3C lesson that a
  read needs its own app gate as well as its policy.
* **No new permission is justified.** `transport:read` already expresses exactly
  "may see this dossier's transport detail", and it is what both the ocean and
  air workspaces already use.
* No RLS change is proposed. None was made in this audit.

---

## F. Q1 / Q2 / Q5 dependency analysis

Authoritative status — `maya-q125-workflow-forensics.md` §12 table; MAYA-0 §19
unchanged.

| Q | Definition | Status | Grade |
|---|---|---|---|
| **Q1** | Per-dossier-type stage sequence; whether « Position » is stage, station or queue | Not recoverable from binaries; MAYA has **no workflow engine** (0 of 91 tables) | sequence **UNKNOWN**; "no engine" **STRONGLY SUPPORTED** |
| **Q2** | Recevabilité / acceptance and rejection semantics | No acceptance table; French workflow words found are PC SOFT runtime text | storage **PLAUSIBLE**; semantics **UNKNOWN** |
| **Q5** | Groupage / dossier mère; remises documentaires | **Two distinct mechanisms exist** — `DOSSIERMERE` (separate table) and `ENTETESOUSBL→SOUSBL` (header/detail). Which serves groupage is unknown; **three mutually exclusive relationship models remain live** | existence **VERIFIED**; role **UNKNOWN** |

| Candidate | Q-dependency |
|---|---|
| **Carriage units on the dossier (§J)** | **Independent.** A container belongs to *this* shipment by FK. Listing a dossier's own units asserts nothing about stage order (Q1), acceptance (Q2), or how dossiers relate to each other (Q5) |
| Total unit count | **Independent** — arithmetic over the same rows |
| TC20/TC40 size-class counts | Independent of Q1/Q2/Q5, but **blocked on data vocabulary** (C.4-a) |
| Children list on a parent | **Independent of Q1/Q2** and defensible under Q5 *only* if strictly neutral — but see §G |
| Sub-BL / house-BL breakdown | **BLOCKED — Q5.** `ENTETESOUSBL→SOUSBL` is one of the two candidate groupage mechanisms |
| Per-stage remarks / observations feed | **BLOCKED — Q1** |
| Acceptance state on the dossier | **BLOCKED — Q2** |

---

## G. Groupage / remises / autres boundary

Unchanged and preserved:

* `IMPORT MARITIME GROUPAGE` remains a **label only**; its semantics are Q5.
* `REMISES DOCUMENTAIRES` stays `unresolved`, `blockedBy: "Q5"`
  (`taxonomy.ts:139`).
* `AUTRES DOSSIERS` stays `unresolved`, `blockedBy: "Q1"` (`taxonomy.ts:149`).
* `IMPORT MARITIME VRAC` is **not** added — absent from MAYA-0's observed
  register.
* `type = "IMP" | "EXP" | "TRP" | "HND"` is not extended or reinterpreted.

**Why the children list is *not* this phase.** Q125 §8 grades three DOSSIERMERE
models PLAUSIBLE and mutually exclusive, one of them being *"« Dossier mère » is
merely a text field and the table is vestigial GINFO"*. P0.6-A §M proposed a
neutral children list as "the safe maximum" — safe, but MAYA-0 documents **no
children-list screen**, so it closes no *demonstrated* parity gap. The brief
forbids implementing something merely because it is the logical next step.
Recorded as a **P0.6-E candidate**, not bundled here. Presenting a "related
dossiers" collection immediately adjacent to a container list would also invite
precisely the consolidation reading Q5 forbids.

---

## H. Sage boundary

**No Sage integration code exists in the repository** — verified by search;
every apparent hit is the substring in `message` / `usage`. Sage 100
Comptabilité i7 remains an external system whose interface is MAYA-P6, and the
MAYA→Sage mechanism is still **UNKNOWN** (SAGE-0 F1–F16 open).

The recommendation touches no accounting object: not `invoice`, not
`billing_charge`, not `payment`, not `expense_*`. Containers and cargo pieces
are logistics facts and carry no monetary value. **P0.6-D changes no Sage
behaviour.** Nothing in the recommendation requires new Sage semantics, so
nothing is deferred on that account.

---

## I. MAYA migration boundary

`lib/maya/staging/actions.ts` exports exactly three actions — `stageMayaBatch`,
`validateMayaBatch`, `cancelMayaBatch`. **No apply, no promote** — confirmed by
search, and pinned structurally by `maya-p05c-migration-staging`.

The recommendation reads `ocean_container` and `air_cargo_piece` only. It does
not touch `maya_import_*`, does not create a production record from a staged
row, does not modify staging semantics, does not connect to live MAYA, and does
not import MAYA data. P0.5-D remains separate and still blocked on F7/F18.
`maya_import_*` remains behind `admin:config:manage` and unreadable from any
dossier surface.

---

## J. Recommended P0.6-D scope

> ### **The dossier shows what it is actually carrying.**
>
> Render the dossier's own **carriage units** — ocean containers for a sea
> shipment, cargo pieces for an air shipment — as one read-only panel on the
> dossier workspace, behind the existing `transport:read` authority, with a
> plain total count. Read-only, no schema, no new permission, no migration.

**Why this and not something else**

1. **Demonstrated MAYA gap.** MAYA-0 records per-container rows on the dossier
   form; P0.5-A classified container counts as NEEDS CONVERGENCE (#17) and it
   is the only NEEDS-CONVERGENCE item still open that is not a business choice
   (#16 numbering: *"leave numbering alone"*; #18 logistics fields: *"none
   required for parity"*).
2. **Proven by asymmetry, not by opinion.** The customer portal already renders
   this exact data for this exact dossier. An operator seeing less about a
   dossier than the client does is a concrete, demonstrable regression against
   MAYA.
3. **Pure reuse.** Existing tables, existing indexes, existing permission,
   existing RLS, existing reader shape, existing page-level gate variable.
4. **Q-independent.** A container belongs to one shipment by foreign key.
5. **Structurally safe by construction.** The permission gate is a database
   policy, so an unauthorized viewer cannot retrieve the rows at all.

**Explicitly NOT in scope** (each discovered, each deliberately excluded):
TC20/TC40 size-class counts (C.4-a); children/parent navigation (§G — P0.6-E);
`package_count` / `supplier_name` in the summary `<dl>` (C.3-a — cosmetic);
responsibility as a filter (C.2); any sub-BL or house-BL breakdown (Q5); any
write path; the `/shipping` workspace; the portal.

---

## K. Reuse vs build matrix

| Need | Existing artefact | Decision | Justification |
|---|---|---|---|
| Container data | `ocean_container` | **REUSE** | — |
| Air piece data | `air_cargo_piece` | **REUSE** | — |
| Authorization | `transport:read` | **REUSE** | Already the RLS predicate on both tables |
| RLS policy | `ocean_container_select`, `air_cargo_piece_select` | **REUSE** | Already correct |
| Index | `idx_*_shipment (tenant_id, shipment_id)` | **REUSE** | Read is already indexed |
| Reader | none for the internal dossier context | **BUILD — one function** in `lib/files/service.ts` | The portal reader is portal-scoped (`getCurrentPortalUser`); shipping's `readContainers` is a private admin-client helper in an ocean-only module. A new *reader* is not a new authority |
| Shipment id on the dossier | `getFile` does not select `shipment.id` | **EXTEND** one select + one type field | Avoids a second query |
| Component | no internal units panel exists | **BUILD — one presentational component** | A component is not an architecture |
| Search | `matchesSearch` | **REUSE, unchanged** | P0.6-C already matches container numbers |
| Timeline / activity | `EventTimeline` | **REUSE, unchanged** | No new activity authority |
| New table / column / enum / RPC / permission / workflow / state / search pipeline | — | **NONE** | Nothing in the slice requires one |

---

## L. Migration determination

### **NO.**

Every object the slice reads already exists and is already applied: both tables
(migrations `20260716000004`, `20260716000006`), both `(tenant_id, shipment_id)`
indexes, both SELECT policies, both tenant triggers. The read is indexed, so no
performance migration is justified either. **The ledger must remain 101/101, and
`LATEST_MIGRATION` must remain `20260823000001_maya_migration_staging`.**

A migration would only become justified if a size-class vocabulary for
`iso_type` were ratified (C.4-a) — that is a separate decision, not this phase.

---

## M. Test matrix

| Kind | Assertion |
|---|---|
| **Positive** | A sea dossier with containers renders each container number, its ISO type as stored, its status, and the total count |
| **Positive** | An air dossier renders its cargo pieces through the same panel |
| **Negative** | A road-only dossier, a dossier with no shipment, and a shipment with zero units each render nothing — an empty carriage panel must not appear, and zero must never read as unavailable |
| **Permission** | Without `transport:read` the reader is **not called** and no unit query is issued — asserted structurally against the source, as P0.6-C asserts its customs gate |
| **Permission** | The RLS policy text is pinned: both `*_select` policies require `has_permission('transport:read')` **and** `tenant_id = auth_tenant_id()` |
| **Tenant isolation** | SQL suite: a container belonging to tenant B is invisible to a tenant-A reader holding `transport:read` |
| **Performance** | At most **one** additional query per dossier page load; the read is outside any row mapping; no `await` inside a `.map` |
| **Architecture** | No new permission code; no new table; migration count still 101; `matchesSearch` unchanged; no `maya_import_*` read from a dossier surface; portal `carriage.ts` unchanged; `/shipping` unchanged |
| **Regression** | `maya-p05b-*`, `maya-p05c-*`, `maya-p06b-*`, `maya-p06c-*`, `files-*`, `ut-*`, `wes-*`, `tenant-scope` stay green |
| **Boundary** | No `groupage` / `sous-bl` / `house bl breakdown` vocabulary in any changed file; `FileType` enum unchanged; no `iso_type` parsing |

Expected legitimate test updates: any suite pinning the exact `FileDetail.shipment`
shape will need `id` added. That is a real shape change, not a moment-in-time pin.

---

## N. Risks and stop conditions

| Risk | Mitigation |
|---|---|
| A units panel is read as a groupage/consolidation structure | Neutral vocabulary (« Conteneurs » / « Colis »); one dossier's own units only; no parent/child adjacency; no sub-BL grouping |
| `iso_type` parsed to derive TC20/TC40 | **Banned** — C.4-a; total count only |
| The panel implies a workflow state | Units are facts; no unit value may gate a stage, and none is mandatory |
| A second container authority emerges | One reader; `/shipping` and the portal are untouched |
| `FileDetail.shipment` shape change ripples | Additive optional `id`; typecheck + full suite before commit |
| Restricted data fetched then hidden | The gate is the RLS policy plus the existing `canReadTransport` app gate; the reader is not called when ungated |

**Discovered, pre-existing, NOT part of P0.6-D — reported for a separate decision.**
`app/files/[id]/page.tsx:94–96` calls `await listFiles()` on **every dossier page
load** purely to populate the « Dossier mère » dropdown. Since P0.6-B/C that call
maps up to 2000 dossiers, issues a batched customs read, and derives a MAYA label
per row — all discarded except `{id, fileNumber}`. It is gated on `canUpdate`, so
read-only viewers do not pay it. This is a genuine efficiency defect, not a parity
gap; folding it into P0.6-D would bundle unrelated work.

**Stop conditions for the build phase**
1. The baseline is not `21d907b` / CI not green → stop.
2. The ledger is not 101/101 → stop.
3. Any proposal to add a column, table, enum, permission, policy or migration → stop and re-ratify.
4. Any need to parse `iso_type`, or any request for TC20/TC40 counts → stop; that needs a vocabulary decision.
5. Any groupage, sub-BL or parent/child semantics entering the slice → stop.
6. A units value being made mandatory or used as a workflow prerequisite → stop.
7. `transport:read` proving insufficient such that a new permission looks necessary → stop and re-audit rather than inventing one.

---

## O. Implementation contract — MAYA-P0.6-D

**Scope.** Render the dossier's own carriage units on the dossier workspace,
read-only, behind `transport:read`: ocean containers (number, ISO type as
stored, status) for a sea shipment; air cargo pieces for an air shipment; a
plain total count. Nothing else.

**Files expected to change**
* `lib/files/service.ts` — add one reader (`getDossierCarriage(fileId)`); add
  `id` to the `getFile` shipment select.
* `lib/files/types.ts` — add `id` to `FileDetail["shipment"]`; add the carriage
  result type.
* `app/files/[id]/page.tsx` — call the reader inside the existing
  `canReadTransport` gate; mount the panel in an anchored section.
* `components/files/carriage-panel.tsx` — **new**, presentational only.
* `tests/maya-p06d-carriage-reach.test.ts` — **new**.
* `supabase/tests/rls_*` — one tenant-isolation case (wired **last** in
  `ci.yml`, with the runs-last pin moved in `tests/fin-aging-schema.test.ts`).
* Any suite pinning `FileDetail.shipment`'s shape.

**Files that must not change**
`lib/process/applicability.ts` · `lib/workflow/projection.ts` ·
`lib/files/{status,lifecycle,closure}.ts` · `lib/files/filter.ts` ·
`lib/maya/staging/*` · `lib/portal/carriage.ts` · `lib/shipping/**` ·
`lib/air/**` · any finance/accounting module · `supabase/migrations/**` ·
`lib/db/types.ts` (no schema change) · `lib/files/taxonomy.ts`.

**Data sources.** `public.ocean_container`, `public.air_cargo_piece`, joined by
`shipment_id`, tenant-scoped.

**Permissions.** `transport:read` only — enforced by
`ocean_container_select` / `air_cargo_piece_select` in the database and mirrored
by the existing `canReadTransport` app gate.

**UI.** One anchored read-only section on `app/files/[id]/page.tsx`, adjacent to
the transport section. Absent facts read « — », never `0`. Renders nothing at
all when there are no units.

**Performance.** Exactly one additional query per dossier page load, issued only
when `canReadTransport` **and** the shipment mode is SEA or AIR. Served by the
existing `(tenant_id, shipment_id)` index. No query inside any row mapping; no
N+1.

**Tests.** Per §M.

**Migration. NO** — §L. Ledger stays 101/101.

**Stop conditions.** Per §N.

---

*MAYA-P0.6-D is an audit. Nothing was implemented. The build phase does not begin
until this audit is ratified. MAYA-P1 remains blocked on Q1/Q2/Q5; P0.5-D remains
blocked on F7/F18; the MAYA APPLY path remains deliberately non-existent.*
