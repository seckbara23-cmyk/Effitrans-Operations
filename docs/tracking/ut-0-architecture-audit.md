# UT-0 — Unified Tracking: Architecture Audit & Governance Freeze

**Date:** 2026-08-09 · **Status: DOCUMENTATION ONLY.** No code, migration, permission,
RPC, SQL or UI was produced or changed by this phase.
**Predecessors:** Foundation · HR · EC-1 · EC-2 · EC-3A/B/C/D — all closed.
**Governing direction:** [digital-los-direction.md](../digital-los-direction.md) (ratified).

---

## 1. Repository audit

Every finding below was verified against the repository, not inferred from phase reports.

### 1.1 The event backbone

| Fact | Verified value |
|---|---|
| Canonical ledger | `business_event` (WES-9, migration 76) |
| Event types registered | **64**, in a closed application registry |
| Domains | **12** — dossier, document, customs, transport, task, handoff, finance, policy, ledger, process, communication, commercial |
| Emission modes | **32 rpc · 23 trigger · 9 reserved** |
| `reserved` = registered but **never emitted** | **9 types** (§1.5) |
| Client-safe types (portal) | **17** |
| Sole insertion path | `emit_business_event`; an unknown type is unwritable |
| Metadata discipline | per-type allow-list **plus** a deny-list of ~30 keys — money, personal data, and **all free text** (`description`, `message`, `body`, `text`, `notes`, `reason`), plus paths and filenames |
| Subject model | `subject_type` + `subject_id`, plus `dossier_id`, plus `correlation_id` (defaults to `dossier_id`) and `causation_id` |
| Provenance | `source` ∈ db_trigger / policy_rpc / app_action; `policy_version_id` + `policy_provenance` |
| Ordering columns | `occurred_at` (default `now()`), `created_at`. **No sequence, no ordinal, no monotonic column** |
| Read visibility | dossier events follow `can_read_file`; non-dossier events require `admin:config:manage` |

### 1.2 The second event store — physical telemetry

`ocean_tracking_event` and `air_tracking_event` (migrations for the Shipping Line and Air
Cargo platforms) are a **structurally different kind of record**:

* **22 ocean event types** in their own database CHECK — including `POSITION_UPDATE` and
  `ETA_UPDATE`, which are high-frequency.
* **Bitemporal**: `occurred_at` (when the fact happened in the world) is distinct from
  `received_at` (when we learned it). Out-of-order arrival is normal and expected.
* **External provenance**: `source` ∈ CARRIER / AIS / PORT / TERMINAL / CUSTOMS / ROAD /
  MANUAL / SYSTEM, with `confidence` ∈ CONFIRMED / INFERRED / MANUAL / ESTIMATED.
* **Carries what the governance ledger forbids**: latitude, longitude, vessel identifiers,
  location names and a free-text `description`.

### 1.3 The third store — `audit_log`

`action`, `entity`, `entity_id`, `before`, `after` (full row snapshots), `override_reason`.
Free text and snapshots are **permitted** here and prohibited in `business_event`. It
answers *"who changed which row, and to what"* — a different question from *"what happened
to this shipment"*.

### 1.4 Module-by-module emission and consumption

| Module | Emits business events? | Consumes them? | Notes |
|---|---|---|---|
| Operations (dossier) | ✅ 7 dossier + 8 task + 2 process | ✅ dossier timeline | the spine |
| Documents | ✅ 7 | — | 1 reserved |
| Customs | ✅ 5 | — | |
| Transport (road) | ✅ 9 | — | |
| Finance | ✅ 3 | — | 1 reserved |
| Enterprise Communications | ✅ 7 | — | 1 reserved (§1.5) |
| Commercial | ✅ 10 | ✅ quotation timeline (EC-3C) | keystone carries the dossier |
| **Ocean tracking** | ❌ **none** | ❌ | own store, own read model |
| **Air tracking** | ❌ **none** | ❌ | own store, own read model |
| **Logistics composition** (`lib/logistics`) | ❌ | ❌ | composes domain tables directly |
| Portal | ❌ | ✅ filtered to the 17 `clientSafe` types | |
| AI Copilots | ❌ | ❌ — meter usage via `audit_log`, read domain tables | |
| Customer Notify | ❌ | ❌ | writes `client_notification` |
| HR | ❌ | ❌ | correct: not shipment history |
| Brand Center | ❌ | ❌ | correct |

### 1.5 Missing emitters — registered, never emitted

| Domain | Type | Consequence for a unified history |
|---|---|---|
| communication | `CORRESPONDENCE_RECEIVED` | **an email's arrival is invisible**; only its later attachment appears |
| handoff | `HANDOFF_SENT`, `HANDOFF_RECEIVED` | inter-department transfers absent from the timeline |
| document | `DOCUMENT_SHARED_WITH_CLIENT` | customer-facing document sharing invisible |
| finance | `EXPENSE_AUTHORIZED` | expense approval absent |
| dossier | `ADMIN_OVERRIDE_EXECUTED`, `WORKFLOW_REVERSED` | exceptional acts — the ones most worth seeing — absent |
| policy | `DOSSIER_POLICY_PINNED` | governance provenance incomplete |
| ledger | `HISTORICAL_EVENTS_NOT_BACKFILLED` | the honesty marker itself is unemitted |

### 1.6 Tracking surfaces that already exist

`lib/shipping/intelligence` (21 modules incl. `position`, `eta`, `freshness`,
`map-projection`, `milestones`, `alerts`, `customs-link`, `status-map`) and
`lib/air/intelligence` (13 modules). Both are **pure read/compose layers over their own
domain tables**. A position engine, an ETA engine, a freshness/confidence classifier and a
map projection all exist and are tested. `lib/logistics/compose.ts` already unifies
road/ocean/air/customs for the Logistics Command Center.

---

## 2. Existing assets Unified Tracking must reuse

| Asset | Reuse as |
|---|---|
| `business_event` + `emit_business_event` + registry + metadata policy | **the decision plane** — unchanged |
| `ocean_tracking_event` / `air_tracking_event` | **the observation plane** — unchanged |
| `readDossierTimeline` / `readQuotationTimeline` / `readClientTimeline` | the timeline readers to generalise |
| `components/files/event-timeline.tsx` + `DOMAIN_TONE` | the renderer |
| `resolveCurrentPosition`, `eta`, `classifyFreshness`, `map-projection` | position/ETA/confidence — **do not rewrite** |
| `lib/logistics/compose.ts` | the existing cross-modal composer |
| `clientSafeEventTypes()` | portal projection |
| `lib/operations/kpi/windows` | tenant-local day boundaries |
| `can_read_file` | the one visibility predicate |
| `audit_log` | forensic plane — never merged into the timeline |

**Nothing in this list should be duplicated. Unified Tracking builds no store.**

---

## 3. Unified Tracking architecture

### 3.1 The central decision: two planes, one read model

The Digital-LOS direction left UT-0 an explicit choice: **(1)** compose the existing ledgers
as-is, or **(2)** funnel every module into `business_event` and read one stream.

**Verdict: neither in pure form. Adopt a TWO-PLANE model with a composing read layer.**

| Plane | Store | Contains | Trust |
|---|---|---|---|
| **A — Decision** | `business_event` | governed state transitions and human decisions | internal, always CONFIRMED |
| **B — Observation** | `ocean_tracking_event`, `air_tracking_event` | physical world telemetry | external, carries `confidence` |
| **Forensic** | `audit_log` | row-level who/what/before/after | internal, **not a timeline** |

**Why option (2) — "everything into `business_event`" — is rejected**, on four independent
grounds, each verified:

1. **It would break the metadata policy or gut telemetry.** Coordinates, vessel names,
   location names and `description` are precisely the keys the deny-list forbids. Funnelling
   telemetry means either weakening the policy that makes the ledger safe, or discarding the
   data that makes tracking useful.
2. **Volume.** `POSITION_UPDATE` / `ETA_UPDATE` are continuous; the decision ledger is
   append-only, immutable and per-decision. Mixing them destroys the ledger's signal-to-noise
   and its index economics.
3. **Bitemporality.** Observations arrive late and out of order (`occurred_at` ≠
   `received_at`). The decision ledger has one time — commit time — and no concept of a
   fact learned later. Retrofitting this changes the meaning of every existing row.
4. **Trust would be flattened.** `source` in Plane A is db_trigger/policy_rpc/app_action —
   all internally guaranteed. In Plane B it is CARRIER/AIS/PORT with a `confidence` grade.
   Merging the columns would make an AIS *estimate* indistinguishable from a committed
   decision. That is the one thing an operational history must never do.

**Why pure option (1) is also rejected:** the cross-module *decision* history genuinely does
belong in one ledger — and already is one. Leaving Tracking to query each module's tables
would recreate the coupling the Digital-LOS direction forbids.

### 3.2 What Unified Tracking is

> A **read model** that merges Plane A and Plane B into one ordered history per subject,
> applies visibility, and renders it. It owns **no table, no state, no rule, no transition
> and no synchronisation**.

**Tracking queries no module's tables.** It reads two ledgers plus the label/reference data
needed to render them. It never queries Communications, Commercial or Finance *tables* —
it consumes their **events**. Answering the phase's questions directly:

* **Should Tracking query Communications?** No — it consumes the 7 communication events.
* **Should Tracking query Finance?** No — it consumes the finance events. Amounts are
  deliberately absent from events; when the timeline must show money it links to Finance
  rather than copying a figure, because a copied amount is a second source of truth.
* **Should Tracking query Commercial?** No — it consumes the 10 commercial events.
* **Should everything consume Business Events?** For **decisions**, yes. For **telemetry**,
  no — Plane B stays where it is and Tracking composes it.

---

## 4. Event ownership

| Concern | Owner | Everyone else |
|---|---|---|
| Deciding a fact happened | the **domain module** | must not write another module's events |
| Emitting the event | the module's **RPC/trigger**, in the same transaction | — |
| The registry + metadata policy | **Platform** (`lib/workflow/events`) | modules propose types |
| Ordering, merging, rendering | **Tracking** | may not reorder or reinterpret |
| Row-level forensics | **`audit_log`** | never surfaced as operational history |
| Customer-visible subset | the **`clientSafe`** flag | Portal filters, never re-decides |

**No event copying between contexts. No module writes into Tracking. Tracking writes nothing.**

---

## 5. Timeline model

### 5.1 Ordering — the most important unresolved defect

`business_event.occurred_at` defaults to `now()`, which in PostgreSQL is **transaction start
time**. Every event emitted inside one transaction therefore carries an **identical**
timestamp, and `id` is a random UUID — not monotonic. **There is today no deterministic
order for events sharing a transaction, and no total order across Plane A and Plane B.**

The exposure is currently small (most RPCs emit a single event) and will grow the moment a
composite act emits several, or the moment two planes are merged — which is exactly what
UT-1 does.

**Required ordering rule (UT-1):** sort by `occurred_at`, then by a **monotonic ordinal**,
then by a stable identifier. The ordinal does not exist and must be added — see ADR-UT-2.
Until it exists, the timeline must not claim a strict order for same-timestamp events; it
should group them.

### 5.2 Subject identity

* **The canonical subject of an operational history is the DOSSIER** (`operational_file`).
  `correlation_id` already defaults to `dossier_id`, and `shipment` is strictly 1:1 with a
  dossier, so shipment and dossier are the same thread.
* **The prologue exists before the subject does.** Correspondence and quotations occur with
  `dossier_id = NULL`; they are stitched to the dossier by two events —
  `CORRESPONDENCE_ATTACHED` and `QUOTATION_CONVERTED_TO_DOSSIER` — both of which already
  carry the dossier as subject. The prologue is therefore reachable, but only by walking
  those events; there is no forward index. **This is a design property to formalise, not a
  defect to fix by duplication** (ADR-UT-1).

### 5.3 Actor identity

`actor_user_id` is nullable and NULL is meaningful — "the domain does not record who".
Names are resolved for display only, on the admin client, because staff-directory
visibility is narrower than dossier visibility. **The timeline must never infer an actor.**

### 5.4 Cross-tenant guarantees

Every plane is tenant-scoped in the row and in the policy. The merge layer must scope
explicitly rather than rely on RLS, because — as EC-3C established — composition layers run
on the admin client, which bypasses RLS. **The application gate is the boundary.**

### 5.5 Linkage rules

| Dimension | Linked by | Rule |
|---|---|---|
| Documents | `document` events + `subject_id` | link, never embed content |
| Communications | `CORRESPONDENCE_*` + `dossier_id` | **never store a message body in an event** |
| Financial | finance events | link; **no amount in a payload** |
| Tracking | Plane B, by shipment → dossier | keep `confidence` and `source` visible |
| Commercial | `metadata.quotation_id` + conversion event | prologue stitching |
| AI | none | AI **reads** the timeline; it never writes to it |
| Portal | `clientSafe` subset | filter, never a second timeline |
| Version handling | `event_version` per type | consumers dispatch on (type, version); old rows keep their version forever |

---

## 6. Dimension model

| Dimension | Classification | Source of truth |
|---|---|---|
| Commercial | **native** (Plane A) | 10 events |
| Communications | **native** (Plane A) | 7 events, 1 missing |
| Operations / dossier | **native** (Plane A) | the spine |
| Transit / transport (road) | **native** (Plane A) | 9 events |
| Customs | **native** (Plane A) | 5 events |
| Finance | **native** (Plane A), amounts **projected** | events carry identifiers; figures stay in Finance |
| Documents | **native** (Plane A), content **linked** | |
| Tracking — milestones | **native to Plane B** | ocean/air stores |
| Tracking — position | **computed** | `resolveCurrentPosition` over Plane B |
| Tracking — ETA | **computed** | ETA engine |
| Tracking — freshness/confidence | **derived** | `classifyFreshness` |
| Customer/portal view | **projected** | `clientSafe` filter |
| AI insight | **derived, non-authoritative** | never persisted as an event |
| Executive KPI | **computed** | over both planes |

---

## 7. Bounded contexts — confirmed

| Context | Owns | Must not |
|---|---|---|
| Commercial | quotation lifecycle, acceptance evidence | create dossiers; own Operations |
| Enterprise Communications | inbound capture, triage, quarantine | interpret business meaning |
| Operations | dossier, process, tasks, assignment | be driven by another context |
| **Tracking** | **projections and visualisation only** | own rules, state, transitions or sync |
| Finance | invoices, expenses, money | expose amounts through events |
| Portal | customer-facing projection | see anything outside `clientSafe` |
| AI | inference over read models | write events or assert facts |
| Documents | artifacts, hashes, storage | be bypassed by a second store |
| HR | people | appear in shipment history |
| Brand Center | brand assets | touch operations |
| Enterprise Mail | *(not started)* | duplicate EC |
| Platform Administration | tenants, roles, config | hold business authority (e.g. no quotation rights) |

---

## 8. Digital-LOS review

**Alignment (strong).** One dossier / one thread is real: `correlation_id` defaults to
`dossier_id`. Modules emit from inside their RPCs. The keystone
`QUOTATION_CONVERTED_TO_DOSSIER` carries the dossier so Tracking never queries Commercial.
The metadata policy is enforced, not aspirational. HR and Brand Center correctly emit
nothing.

**Drift and gaps.**

| # | Finding | Severity |
|---|---|---|
| D1 | **Ocean/air tracking emit nothing into Plane A and are not consumed by any timeline** — the physical dimension is absent from dossier history | **high** |
| D2 | **9 reserved types have no emitter**, including correspondence arrival and both handoffs | **high** |
| D3 | **No monotonic ordinal** — no deterministic order within a transaction, none across planes | **high** |
| D4 | `lib/logistics/compose.ts` composes domain **tables** directly — the coupling the direction forbids; it predates the rule | medium |
| D5 | Non-dossier events require `admin:config:manage` to read, so **prologue events are invisible** to ordinary staff even when the dossier is visible | medium |
| D6 | Three stores each answer "what happened" with **no documented precedence** | medium |
| D7 | No `ledger` honesty event is emitted, so a timeline cannot state its own incompleteness | low |

**Duplication:** none found between the planes. The only true duplication risk is
**forward**: building a third store in UT-1.

---

## 9. Risks

| Ref | Risk | Mitigation |
|---|---|---|
| R1 | UT-1 builds a third event store "for convenience" | freeze: Tracking owns no table |
| R2 | Telemetry is funnelled into `business_event`, weakening the metadata policy | freeze: two planes, §3.1 |
| R3 | Ambiguous ordering presented as authoritative history | ADR-UT-2 before any merged view |
| R4 | Amounts or message bodies copied into events for display convenience | deny-list already enforces; keep the test |
| R5 | Composition layer on the admin client leaks cross-tenant | explicit tenant scope + gate (EC-3C precedent) |
| R6 | AI writes inferences back as events | freeze: AI reads only |
| R7 | Portal gains visibility by widening `clientSafe` casually | each addition is a ratified decision |
| R8 | Backfill invents history that was never recorded | never backfill; emit the honesty marker instead |

---

## 10. Required ADRs

| Ref | Decision | Summary |
|---|---|---|
| **ADR-UT-1** | Subject model | Dossier is the canonical subject; the pre-dossier prologue is stitched by attachment/conversion events; no parallel identifier is invented |
| **ADR-UT-2** | Total ordering | Add a monotonic ordinal to Plane A; define the cross-plane sort as (occurred_at, plane, ordinal, id); until then, same-timestamp events are grouped, not ordered |
| **ADR-UT-3** | Two-plane model | Decision plane vs observation plane; Tracking composes and owns no store |
| **ADR-UT-4** | Trust and confidence | Confidence and source survive into the merged view; an estimate is never rendered as a fact |
| **ADR-UT-5** | Visibility | One predicate (`can_read_file`) for dossier-scoped history; a defined rule for prologue events (D5) |
| **ADR-UT-6** | Non-authoritative AI | AI consumes the timeline and never writes to it |
| **ADR-UT-7** | Incompleteness honesty | A timeline states what it does not contain rather than implying completeness |

---

## 11. Management decisions requiring ratification

| Ref | Question | Why it cannot be decided in engineering |
|---|---|---|
| **RATIFY-UT-1** | Should ocean/air **milestones** appear on the dossier timeline, and at what granularity (every position, or milestone-only)? | operational judgement; drives volume and noise |
| **RATIFY-UT-2** | Who may see the **prologue** (correspondence + quotation) of a dossier? Today it needs a platform-admin permission (D5) | a visibility rule over customer correspondence |
| **RATIFY-UT-3** | Should the **customer** see tracking positions in the portal, and with what confidence labelling? | commercial and liability exposure |
| **RATIFY-UT-4** | Is an **estimated** ETA shown to customers, and with what wording? | commitment risk |
| **RATIFY-UT-5** | Do the 9 missing emitters get built, and in what order? `CORRESPONDENCE_RECEIVED` and the handoffs materially change the history | scope and priority |
| **RATIFY-UT-6** | Retention of Plane B telemetry (positions grow without bound) | cost and legal retention |
| **RATIFY-UT-7** | May the timeline show **money** at all, or only link to Finance? | policy; the current answer is "link only" |

---

## 12. Roadmap and implementation sequence

| Phase | Content | Depends on |
|---|---|---|
| **UT-1** | Ordering foundation: the monotonic ordinal (ADR-UT-2) and the read contract. **No UI.** | ADR-UT-2/3 ratified |
| **UT-2** | The merged read model over both planes, tenant-gated, confidence-preserving | UT-1 |
| **UT-3** | Missing emitters, in the order RATIFY-UT-5 sets | RATIFY-UT-5 |
| **UT-4** | Unified timeline surface; absorb `lib/logistics/compose.ts` (D4) | UT-2 |
| **UT-5** | Portal and AI projections | RATIFY-UT-2/3/4 |

**Migration strategy.** Additive and forward-only, as always. The ordinal is a new column
with a backfill that is **explicitly not a reconstruction of history** — existing rows
receive an ordinal consistent with their commit order and nothing more. **No historical
event is invented, and no existing event is rewritten.** Plane B is untouched. No table is
dropped, renamed or merged.

---

## 13. How UT enables the later programs

| Program | What it consumes |
|---|---|
| **Customer Portal 2.0** | the `clientSafe` projection of the merged timeline — a filter, not a second history |
| **Enterprise Mail Platform** | emits `CORRESPONDENCE_*`; the timeline gains inbound/outbound mail for free |
| **AI Operations Center** | the merged read model as its only ground truth; writes nothing back |
| **Executive Dashboard** | computed aggregates over both planes with tenant-local windows |
| **Predictive Analytics** | Plane B's bitemporal telemetry with `confidence` — which is precisely why it must not be flattened into Plane A |

---

## 14. Readiness assessment

| Dimension | State |
|---|---|
| Canonical ledger | **strong** — closed registry, single write path, enforced metadata policy |
| Domain coverage | **good** — 12 domains, 55 emitted types |
| Physical tracking | **present but disconnected** (D1) |
| Ordering guarantees | **insufficient for a merged timeline** (D3) |
| Visibility model | **good for dossiers, undefined for the prologue** (D5) |
| Reuse surface | **excellent** — position, ETA, freshness, map, renderer all exist |
| Duplication risk | **contained**, provided UT builds no store |

---

## 15. GO / NO-GO for UT-1

# ⚠️ CONDITIONAL GO

**GO**, because the foundation is genuinely sound: one canonical ledger with a single
enforced write path, a closed registry, a metadata policy that already prevents the failures
that usually make timelines unsafe, and a complete set of reusable position/ETA/confidence
engines. Nothing needs rewriting.

**Conditional**, because UT-1 must not begin as a *feature*. Its first deliverable is the
**ordering foundation (ADR-UT-2)**: a merged timeline built on today's ordering would
present an order it cannot actually guarantee, and would do so in the one surface whose
entire value is being trustworthy about sequence.

**Conditions to clear before UT-1 starts:**

1. **ADR-UT-2 (ordering) and ADR-UT-3 (two planes) ratified.** These fix the shape of
   everything after them.
2. **RATIFY-UT-1 answered** — milestone granularity determines the read model's volume.
3. **RATIFY-UT-2 answered** — prologue visibility (D5) is a live gap affecting real staff.

**Not blocking UT-1:** the 9 missing emitters (UT-3), portal/AI projections (UT-5), and
retention (UT-6) — each can follow without reworking the foundation.

**Explicitly out of scope until UT-1 is complete:** Customer Portal 2.0, Enterprise Mail
Platform, AI Operations Center.

---

*UT-0 produced documentation only. No code, migration, permission, RPC, SQL or UI was
created or modified.*
