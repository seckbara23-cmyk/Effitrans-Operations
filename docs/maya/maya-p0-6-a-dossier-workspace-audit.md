# MAYA-P0.6-A — Dossier Workspace, Naming & Activity Audit

**Mode:** audit and plan only. No implementation, no migration, no application
or schema change, no MAYA access, no Sage access, no MAYA-P1.
**Baseline verified, not assumed:** working tree clean at `517a7dd`; 101
migration files on disk.
**Inputs:** this repository, plus `maya-0-parity-audit.md` and
`maya-q125-workflow-forensics.md` (read-only; the MAYA Analysis workspace was
not modified).

---

## A. Executive verdict

**Three findings decide the shape of P0.6-B.**

**1. A production ledger gap exists and must be closed first.** Migration 101's
objects are **physically complete** in production — `maya_import_batch` (21
columns), `maya_import_row` (42), `maya_import_issue` (9), both reconciliation
CHECKs, both tenant triggers, RLS on all three, three policies — but
`supabase_migrations.schema_migrations` **stops at `20260822000001`** and
contains no row for `20260823000001`. The DDL ran; the ledger repair did not.
This is the "physically applied, ledger gap" case, and repair is legitimate
precisely because the change is already applied (§V, operator step).

**2. The dossier workspace the brief imagines already exists — and the activity
timeline does too.** There is exactly **one** canonical dossier surface
(`app/files/[id]/page.tsx`); every domain — process journey, lifecycle,
ownership, risk, SLA, assignment, tasks, documents, customs, transport,
tracking, driver, delivery proof, timeline — is *absorbed into it as a panel*
rather than scattered across routes. And UT-2/UT-4 already delivered the
"one coherent chronological activity timeline without another history table":
`readUnifiedTimeline` merges a **decision plane** (the `business_event` ledger)
with an **observation plane** (ocean/air/road tracking milestones), is
cursor-paginated, permission-gated per plane, and is mounted on the dossier
page as `EventTimeline`. **Audit Areas 5 and 6 are therefore mostly ALREADY
EXISTS.** P0.6-B must not build a workspace or a timeline; at most it groups
what is there and converges vocabulary.

**3. The real gap is REACH, not capability.** Everything P0.5-B added — cargo
declaration, parent link, client reference, dates, lineage — and the derived
MAYA-compatible label exist in exactly **two UI files**: the dossier detail
page and the dossier form. They are absent from the dossier **list**, the
**search/filter**, the **copilot context**, the **generated documents** and the
**portal**. A MAYA user scanning the dossier list today sees `Import` — the
generic four-value label from `t.files.types` — where MAYA showed
`IMPORT MARITIME TC`. That single mismatch is the highest-value, lowest-risk
convergence in this phase.

**Nothing here requires a migration.** P0.6-B is presentation and read-model
reach over already-ratified data.

---

## B. Existing dossier architecture discovered

| Layer | Artefacts | Verdict |
|---|---|---|
| Routes | `app/files/page.tsx` (list) · `app/files/new` · `app/files/[id]` (workspace) · `[id]/documents/[docId]/intelligence` · `[id]/process` | **ALREADY EXISTS** — one workspace, two focused sub-routes |
| Workspace composition | ~50 imports on the detail page: `ProcessJourneyPanel`, `FileWorkflow`, `FileAssignment`, `LifecycleTracker`, `OwnershipPanel`, `RiskPanel`, `SlaPanel`, `FileForm`, `TaskPanel`, `DocumentsPanel`, `CustomsPanel`, `TransportPanel`, `DeliveryProofPanel`, `TrackingTimeline`, `DriverAssign`, `EventTimeline`, `FileDangerZone` | **ALREADY EXISTS** — absorbed, not fragmented |
| Readers | `lib/files/service.ts` (`listFiles`, `getFile`, `getFileOverview`, `getRecentFiles`, `listAssignableStaff`), `lib/files/filter.ts` (pure), `lib/files/aggregate.ts` | ALREADY EXISTS |
| Actions | `lib/files/actions.ts` (create/update/transition/assign/delete) | ALREADY EXISTS |
| Pure domain | `types.ts`, `validate.ts`, `status.ts`, `lifecycle.ts`, `closure.ts`, `delete-policy.ts`, `assign-policy.ts`, **`taxonomy.ts`** | ALREADY EXISTS |
| Canonical projection | `lib/workflow/projection.ts` — monotonic stage/progress/department authority | ALREADY EXISTS |
| Timeline | `lib/unified-timeline/{unified,decision-plane,observation-plane,merged,contract,presentation}.ts` + `components/files/{event-timeline,unified-timeline-view}.tsx` | **ALREADY EXISTS** |
| Tests | `maya-p05b-dossier-convergence`, `files-*`, `wes-*`, `ut-*` suites | ALREADY EXISTS |

**Conclusion: there is a canonical dossier workspace. Do not propose a competing one.**

## C. Current dossier routes / components / readers / actions

See §B. The one structural observation worth carrying into P0.6-B: the detail
page is a long linear stack of panels with no grouping. It is *coherent* (one
page, one source per fact) but *undifferentiated* — a MAYA user looking for
"the customs part" scrolls. That is a presentation problem, not an
architectural one.

## D. MAYA dossier naming inventory (from evidence only)

Authoritative source: MAYA-0 §4 observed register types; Q125 §4 warning that
the list is not closed.

| MAYA name | In MAYA-0 evidence? | Taxonomy entry today | Classification |
|---|---|---|---|
| IMPORT MARITIME TC | Yes | `IMPORT_MARITIME_TC`, resolved | **DERIVABLE NOW** |
| IMPORT MARITIME TC SUSPENSIF | Yes | resolved (regime = SUSPENSIF) | **DERIVABLE NOW** |
| IMPORT MARITIME GROUPAGE | Yes | resolved *as a label* | **DERIVABLE NOW (label only) — semantics BLOCKED BY Q5** |
| EXPORT MARITIME VRAC | Yes | resolved | **DERIVABLE NOW** |
| IMPORT AÉRIEN COLIS | Yes | resolved | **DERIVABLE NOW** |
| TRANSPORT UNIQUEMENT | Yes | resolved (mode deliberately null) | **DERIVABLE NOW** |
| REMISES DOCUMENTAIRES | Yes | `unresolved`, blockedBy Q5 | **UNRESOLVED — BLOCKED BY Q5** |
| AUTRES DOSSIERS | Yes | `unresolved`, blockedBy Q1 | **UNRESOLVED — BLOCKED BY Q1** |
| IMPORT MARITIME VRAC | **No** — appears in the P0.6-A brief but not in MAYA-0's observed register | absent | **OTHER — existence unverified; do not add** |

**Six derivable, two deliberately unresolved, one unverified.** P0.6-B must not
change any of these classifications.

## E. Naming convergence matrix

| Surface | Current label | Target label | Source of truth | Permission consideration | Change required |
|---|---|---|---|---|---|
| Dossier list (`files-table.tsx`) | `t.files.types[type]` → « Import » | MAYA-compatible name when derivable, else « Import » | `deriveMayaLabelFromRow` | **List has no customs regime in scope today** — either omit the regime dimension (so `TC` vs `TC SUSPENSIF` collapse) or extend the read with `customs:read` gating. Recommend: gate, and fall back to the generic label when ungated | **YES — EXISTS BUT NEEDS CONVERGENCE** |
| Dossier detail | Both: generic in the header subtitle, MAYA label in "Identification du dossier" | Keep; make the header itself carry it | same | Already `customs:read`-gated | Minor |
| Dossier form | Direction/mode/cargo-form selects, no compound preview | Live preview of the derived name | same | Same gating | **YES — small** |
| Search / filter chips | Type filter = 4 raw codes | Accept MAYA vocabulary as *input* (see §O) | same | No new disclosure (input matching only) | **YES** |
| Portal | Generic stage/progress only, no type | Unchanged | — | Customer must not receive internal regime | **NO** |
| Generated documents | No type shown | Out of scope | — | — | **NO** |
| Copilot context | `cargoType` free text only | Add derived label + cargo facts | same | Copilot inherits caller permissions | **YES — small** |

**Rule reaffirmed:** one taxonomy module, no stored MAYA type, no second
vocabulary. Every row above reads `lib/files/taxonomy.ts`.

## F. Dossier numbering / reference strategy

Q125 §11.3: MAYA references embed a type mnemonic (EMV, IMT), at least three
shapes have existed and **two coexist in 2026**. Migration 100 typed
`legacy_reference text` — correct and unchanged.

**Ratified presentation rule for P0.6-B:**
* the platform reference (`file_number`, `EFT-…`) is **the identity** and is
  what every surface keys on, links to and sorts by;
* `legacy_reference` is shown as a **secondary, clearly-labelled reference**
  (« Référence MAYA ») on migrated dossiers only, exactly as §N describes;
* the legacy reference is **never parsed** to establish type, direction or
  anything else — the derived label comes from the normalised attributes;
* it is never regenerated, normalised destructively, renumbered, or used as a
  key. **ALREADY CORRECT in the schema; the only work is display.**

## G. P0.5-B field exposure matrix

Evidence: the only files referencing these columns are `app/files/[id]/page.tsx`,
`components/files/file-form.tsx`, `lib/files/{types,validate,actions,service}.ts`,
`lib/db/types.ts`, `lib/files/taxonomy.ts`, and the MAYA staging modules.

| Field | Writable | Readable | Visible (detail) | List | Search | Copilot | Documents | Portal | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `shipment.cargo_form` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `quantity` / `quantity_unit` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `net_weight_kg` / `gross_weight_kg` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `volume_m3` / `package_count` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `goods_description` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `supplier_name` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `warehouse_entry_date` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `operational_file.parent_file_id` | ✅ | ✅ | ✅ (number only) | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE (§M) |
| `client_reference` | ✅ | ✅ | ✅ | ✖ | **✖ — high value** | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `on_behalf_of` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `processing_due_date` | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |
| `provenance` | ✖ (by design) | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | Correct — write path is a future import |
| `legacy_reference` | ✖ (by design) | ✅ | ✅ | ✖ | **✖ — required by §N/§O** | ✖ | ✖ | ✖ | NEEDS CONVERGENCE |

**Validated?** Yes — `validateFile` covers cargo form vocabulary, non-negative
amounts, integer counts, date shapes and parent shape. **Permission-gated?**
Inherited from `file:read` / `file:update`; no field-level gate exists or is
needed, except the derived label's `customs:read` dependency. **In server
types?** Yes (`FileDetail`, `ShipmentInput`, `lib/db/types.ts`).

## H. Unified dossier workspace assessment

**ALREADY EXISTS.** The candidate organisation (OVERVIEW / SHIPMENT / CUSTOMS /
LOGISTICS / FINANCE / DOCUMENTS / ACTIVITY) maps onto panels that are all
already on one page:

| Candidate section | Existing panel(s) | Action |
|---|---|---|
| OVERVIEW | PageHeader + "Identification du dossier" + Ownership + Lifecycle + Risk + SLA | Group, don't build |
| SHIPMENT | FileForm shipment block + TrackingTimeline + cargo facts | Group |
| CUSTOMS | CustomsPanel | Group |
| LOGISTICS | TransportPanel, DriverAssign, DeliveryProofPanel | Group |
| FINANCE | (dossier page shows none today — finance lives in its own workspace) | **Decide: link out, do not duplicate** |
| DOCUMENTS | DocumentsPanel | Group |
| ACTIVITY | EventTimeline (unified) | Already there |

**Recommendation:** do **not** create seven routes or seven tabs. The smallest
convergence is **in-page sectioning with anchored navigation** (the page already
uses `id="documents"` + `scroll-mt-24`, so the idiom exists). Finance stays a
link-out — duplicating finance onto the dossier would create a second surface
for money, which the platform has deliberately avoided.

## I. Activity timeline source map

| Source | In timeline today? | Via | Note |
|---|---|---|---|
| `business_event` (decision plane) | ✅ | `readDecisionPlane` | Ledger RLS is the gate |
| Ocean / air tracking milestones | ✅ | `readObservationPlane` | Dossier-visibility gated in app (EC-3C pattern) |
| Road `tracking_event` | ✅ | same, `confidence: null` | UT3-ROAD Option C |
| Handoffs, expense visas | ✅ | UT-3B emitters into `business_event` | |
| `audit_log` | ❌ **deliberately** | — | "forensic, not narrative" — a principled exclusion to preserve, not fix |
| `file_state_transition` | Indirect (status events are emitted) | | Verify coverage in P0.6-B |
| `assignment_event` | Indirect (WES-3A emitters) | | Verify coverage |
| Free-text notes (§K) | ❌ | — | See §K — **do not** pipe raw notes in |

**Ordering** is `compareUnified` with explicit chronology confidence;
**actor resolution** via `resolveActorNames` on the admin client (tenant-scoped,
because staff directory visibility is narrower than dossier visibility);
**pagination** is opaque cursor; **portal projection** is a `clientSafe`
allow-list, not a filter. **All of this is correct and reusable as-is.**

The only P0.6-B question: does the **label vocabulary** (`labelFor` in
`contract.ts`) read in MAYA-recognisable French? That is a vocabulary review,
not a rebuild.

## J. Current responsibility / assignment assessment

**ALREADY EXISTS and is stronger than MAYA.** `OwnershipPanel` (WES-3K)
deliberately separates four concepts MAYA conflated: **Responsable commercial**,
**Responsable opérationnel**, **Département responsable**, **Tâche en cours** —
created precisely to end the ambiguous single « Responsable ». `LifecycleTracker`
shows stage + open handoff. `process_handoff` records sent/received/rejected
with reason and return-to-step; `assignment_event` is append-only with reason
codes.

MAYA's « Transféré par / le », « Traité par » therefore have equivalents already.
**Safe to expose in an overview strip:** current responsible role, current
responsible user, assigned-at, last handoff. **BLOCKED:** "next permitted
actions" phrased as a *business stage* — that is Q1. Showing the engine's
already-computed next step is fine; inventing Chef Transit → Déclarant ordering
is not.

## K. Observation / comment assessment

**PROVEN GAP — and deliberately not to be filled in P0.6-B.** There is **no
dossier comment/note/observation table** in the schema. Free text lives
scattered as columns: `transport_record.notes`, `customs_record.notes`,
`document.review_note`, `file_state_transition.note`,
`assignment_event.reason` (+ structured `reason_code`),
`process_handoff.rejection_reason`, `invoice.notes`, expense `reason`.

Two rules the brief sets, both respected by the recommendation:
1. **Do not create a second observation system.** So P0.6-B must not add a
   comments table.
2. **Do not collapse security-sensitive audit metadata into ordinary staff
   comments.** `assignment_event.reason` is explicitly kept out of
   `business_event` by WES-9A (only the structured code travels); piping it
   into a staff-visible feed would undo that decision.

**Recommendation:** surface only the notes whose store already intends them to
be read by dossier viewers (transport, customs, document review), rendered
*in their own panels* where they already are. A general observation feed needs
a ratified decision about who may write and read it — **defer, and list it as
an open business question**, since MAYA's « Observations » is bound up with Q1
(per-stage remarks) anyway.

## L. Cargo & shipment UX assessment

The four proven cargo shapes are all representable today (P0.5-B): containerised
(`CONTAINER` + `ocean_container` rows), bulk (`BULK` + quantity/weight/volume),
air parcels (`PARCEL` + `air_cargo_piece`), road-only (`ROAD` + the same
dossier-level facts). **Nothing is missing in the model.**

Smallest UI convergence: a **cargo summary line** in the shipment section
rendering what is present and nothing else (« 1 234,5 TONNE · 250 500 kg net ·
320,75 m³ · Vrac »), plus the derived label. **No field becomes mandatory**, and
no cargo value may gate a stage — cargo is a fact, not a workflow input.

## M. Parent / related dossier assessment

`parent_file_id` exists with same-tenant, no-self, no-cycle guards; the detail
page shows the parent's number. **Safe generic presentation for P0.6-B:**

* on a child: « Dossier mère : EFT-… » (link);
* on a parent: « Dossiers rattachés (N) » — a plain list of children, read via
  the same tenant-scoped, `file:read`-gated reader.

**Explicitly BLOCKED BY Q5 and must not appear:** the word *groupage*, any
lifecycle coupling, closure or transfer propagation, financial or customs
roll-up, document inheritance, shared-BL semantics. Q125 §7–8 left **three live
models** for `DOSSIERMERE`; a neutral "parent / related" presentation is
compatible with all three, which is exactly why it is the safe maximum.

## N. Migrated dossier UX requirements

For a dossier with `provenance = 'MAYA_IMPORT'` (none exist yet — no apply path):

| Requirement | Source | Who sees it |
|---|---|---|
| Native identity | `file_number` | everyone with `file:read` |
| Original reference | `legacy_reference`, labelled « Référence MAYA » | everyone with `file:read` (it is a business reference the client may quote) |
| Source system | `provenance` | rendered as a quiet badge « Repris de MAYA » |
| Migration batch / staging metadata | `maya_import_*` | **administrators only** (`admin:config:manage`) — never on the dossier page |
| Historical vs active migrated status | — | **BLOCKED** — needs ratification; do not invent |

The detail page already renders the first three; P0.6-B extends them to the list
and search (§O) and must keep batch metadata out of the operational surface.

## O. Search / filter assessment

`matchesSearch` matches exactly six fields: `fileNumber`, `clientName`,
`origin`, `destination`, `blAwbRef`, `containerRef`. Structured filters:
status, type, priority, clientId, transportMode, mine, overdue, plus sort.

| A MAYA user would search by | Supported today? | Verdict |
|---|---|---|
| Effitrans dossier number | ✅ | ALREADY EXISTS |
| **MAYA legacy reference** | ❌ | **PROVEN GAP — highest value** |
| Client name | ✅ | ALREADY EXISTS |
| **Client reference (« Réf. Client »)** | ❌ | **PROVEN GAP** |
| MAYA-compatible dossier name | ❌ (type filter is 4 codes) | NEEDS CONVERGENCE |
| Vessel / flight | ❌ (`vesselOrFlight` not in the six) | **PROVEN GAP** |
| BL / LTA | ✅ | ALREADY EXISTS |
| Container number | ✅ (`containerRef`) — but not `ocean_container.container_number` rows | PARTIAL |
| Declaration number | ❌ (`customs_record.declaration_number`) | GAP — needs `customs:read` gating |
| Status / responsibility | ✅ status; responsibility ❌ | PARTIAL |

**No second search system.** Every gap above is an added field on the existing
`FileSearchRow` projection and the existing `matchesSearch`/filter pipeline.

## P. Permission / RLS considerations

* The derived MAYA label depends on `customs_record.regime`; P0.5-B already
  computes it **only when the viewer holds `customs:read`**, precisely so a
  label cannot disclose a suspensive regime. **Extending the label to the list
  must carry the same gate** — and where ungated, fall back to the generic
  label rather than a partial one. This is the single most important
  permission consideration in the phase.
* Declaration-number search must be `customs:read`-gated for the same reason.
* Timeline visibility is already correct per plane; do not add a third path.
* Legacy reference and client reference are ordinary dossier facts under
  `file:read` — no new gate.
* Migration staging stays behind `admin:config:manage`; no dossier surface may
  read `maya_import_*`.
* No new permission, role, or policy is required by anything recommended here.

## Q. Explicit Q1 / Q2 / Q5 blocks

**BLOCKED — must not be designed or implemented in P0.6-B:**
a universal or linear stage order; automatic stage progression; acceptance /
recevabilité semantics and any rejection destination; Chef Transit → Déclarant
→ Coordinateur → Logistique sequencing; groupage lifecycle; parent/child
coupling of any kind; Remises Documentaires workflow; automatic Avis d'arrivée
behaviour; promoting `REMISES DOCUMENTAIRES` or `AUTRES DOSSIERS` out of
`unresolved`; adding `IMPORT MARITIME VRAC` to the taxonomy (§D).

## R. Reuse vs build

**Reuse (build nothing):** the dossier workspace and its panels; the unified
timeline and both planes; `lib/files/taxonomy.ts`; `lib/workflow/projection.ts`;
`OwnershipPanel` / `LifecycleTracker`; `matchesSearch` + `FileSearchRow`;
`process_handoff` / `assignment_event`; the anchor-section idiom already used
for `#documents`.
**Build (small, presentational):** derived-label rendering on list/form/copilot;
a cargo summary line; parent/related presentation; three or four added search
fields; in-page section grouping; a migrated-dossier badge.
**Do not build:** a workspace, a timeline, a comment system, a second taxonomy,
a second search, any workflow.

## S. Proposed implementation sequence

**P0.6-B — Naming & identity reach** *(no migration; highest value)*
Derived MAYA label on the dossier list (with `customs:read` gating and generic
fallback) and as a live preview in the form; « Référence MAYA » + « Repris de
MAYA » badge on the list for migrated dossiers; header subtitle carries the
compound name. *Stop gate: no taxonomy change, no stored type, no Q-blocked
name promoted.*

**P0.6-C — Search & retrieval reach** *(no migration)*
Extend `FileSearchRow` + `matchesSearch` with `legacyReference`,
`clientReference`, `vesselOrFlight`; add declaration-number search behind
`customs:read`; allow MAYA vocabulary as search *input* by matching the derived
label. *Stop gate: one search pipeline; no new index-bearing migration unless
measurement proves the need.*

**P0.6-D — Cargo & related-dossier presentation** *(no migration)*
Cargo summary line in the shipment section; « Dossiers rattachés » list on a
parent. *Stop gate: no groupage vocabulary, no coupling, nothing mandatory.*

**P0.6-E — Workspace sectioning & activity vocabulary** *(no migration)*
Anchored in-page sections; review `contract.ts` labels for MAYA-recognisable
French. *Stop gate: no new route, no new store, `audit_log` stays out.*

**Then:** P0.5-D (supplier/finance, still blocked on F7/F18) and MAYA-P1 (still
blocked on Q1/Q2/Q5). Neither is unblocked by this phase.

## T. Expected migrations

**None.** Every recommendation is presentation or read-model reach over columns
that already exist and are already applied. If P0.6-C measurement later shows a
search index is needed, that is an additive index migration decided on
evidence — not assumed now.

## U. Test strategy

* **Naming:** the list renders the derived label for each of the six derivable
  types; renders the generic label without `customs:read`; never renders a
  Q-blocked name; the taxonomy module remains the only source (no second copy).
* **Permission:** a viewer without `customs:read` cannot distinguish TC from TC
  SUSPENSIF anywhere, including the list.
* **Search:** each new field is matched; legacy reference is matched as an
  opaque string and never parsed; declaration search is gated.
* **Parent/related:** children list is tenant-scoped and `file:read`-gated; no
  module reads `parent_file_id` for status, closure, projection or finance.
* **Invariants (repeat every phase):** no migration added; no permission/policy
  change; type enum unchanged; numbering untouched; no `maya_import_*` read
  from a dossier surface; `audit_log` still absent from the timeline.
* Existing suites to keep green: `maya-p05b-dossier-convergence`,
  `maya-p05c-migration-staging`, `tenant-scope`, `ut-*`, `wes-*`.

## V. Risks, contradictions, STOP conditions

| Risk | Mitigation |
|---|---|
| **Ledger gap on migration 101** — repo says 101, production ledger says 100 | **Operator step below.** Until repaired, `migration list` misreports and a future `db push` could attempt a re-apply |
| Derived label leaks regime to users without `customs:read` | Gate on every new surface; fall back to generic, never partial |
| List label computation triggers a per-row customs read (N+1) | Batch the regime read, or omit the regime dimension in the list and say so |
| Section grouping mistaken for workflow stages | Sections are *information areas*, never stages; no ordering implied |
| "Related dossiers" read as groupage | Neutral vocabulary only; Q5 words banned |
| Timeline vocabulary drifting toward MAYA stage names | Labels describe events that happened, never a stage a dossier is "in" |
| A comment system arriving through the back door | Explicitly deferred (§K); needs its own ratification |

**STOP conditions for P0.6-B:** any proposal requiring a stored MAYA type, a
second taxonomy, a workflow assumption, a comments table, a new route for an
existing surface, or a migration — stop and re-ratify.

### Operator step (outstanding, from §A.1)

Migration 101 is physically applied and complete; only the ledger row is
missing. Repair is legitimate here **because** the change is already applied:

```
npx supabase migration repair --status applied 20260823000001
npx supabase migration list --linked      # expect 101/101
```

Read-only verification already performed: 3 tables, 21/42/9 columns, both
CHECKs (`maya_batch_reconciles`, `maya_batch_unresolved_within_warnings`), both
tenant triggers, RLS enabled with 3 policies, 0 staged batches.

---

*MAYA-P0.6-A is an audit. Nothing was implemented. P0.6-B does not begin until
this audit is ratified; MAYA-P1 remains blocked on Q1/Q2/Q5 and P0.5-D on the
supplier/finance answers.*
