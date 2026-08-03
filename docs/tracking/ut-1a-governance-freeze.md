# UT-1A — Unified Tracking Governance Freeze

**Date:** 2026-08-09 · **Status: DOCUMENTATION ONLY — this freeze changes no code, no
schema, no permission, no RPC and no UI.**
**Converts:** [ut-0-architecture-audit.md](ut-0-architecture-audit.md) (CONDITIONAL GO)
into permanent governance. **Implementation is not begun by this phase.**

Every UT-0 recommendation was **reviewed, not silently accepted**. Two were amended
(§2.2's cross-plane tiebreaker, §6's provenance taxonomy), one was narrowed (§4
RATIFY-UT-1), and the rest are frozen as audited. Amendments are marked **AMENDED**.

---

## 1. Architecture freeze — the three planes

| Plane | Store | Contains | Never contains |
|---|---|---|---|
| **Decision** | `business_event` | governed state transitions and recorded human decisions; identifiers and status codes only | free text, money, personal data, coordinates, telemetry, row snapshots |
| **Observation** | `ocean_tracking_event`, `air_tracking_event` (and future modal siblings) | physical-world telemetry: positions, ETAs, carrier milestones, with `source` + `confidence` + bitemporal (`occurred_at` / `received_at`) | business decisions, internal state transitions, anything asserting what the *platform* decided |
| **Audit** | `audit_log` | row-level forensics: who changed what, before/after snapshots, override reasons | — (it may contain anything, because it is never rendered as history) |

**Cross-plane rules, permanent:**

1. **Nothing crosses planes by copying.** No event is ever written into two planes. A
   decision that *reacts* to an observation (e.g. an operator confirms arrival) is a new
   Plane-A event that may reference the observation by identifier — reference, never copy.
2. **The Audit plane is never a timeline source.** It answers investigations, not "what
   happened to this shipment". No UT phase may surface `audit_log` rows in a timeline.
3. **Projection is one-way.** Planes A and B project *into* read models; read models never
   write back into any plane.
4. **What may never be duplicated:** the stores themselves. Unified Tracking owns **no
   table**. If UT-2's read model requires materialisation for performance, that is a
   *cache with a rebuild-from-source guarantee*, ratified separately — never a third ledger.

## 2. ADR-UT-2 — Timeline ordering (FROZEN, with one amendment)

### 2.1 The ordering authority

**The emitting plane is the ordering authority for its own events; Unified Tracking is the
ordering authority for nothing.** Tracking sorts by recorded values and *presents* — it
never assigns, corrects or infers a sequence. **Unified Tracking never invents chronology.**

### 2.2 The ordering model

| Case | Rule |
|---|---|
| **Within Plane A, different transactions** | `occurred_at`, then ordinal, then `id` |
| **Within Plane A, same transaction** | the **monotonic ordinal** (UT-1 adds it — the only schema change the UT program's foundation requires). Same-transaction events share `occurred_at` by construction; the ordinal is the only truthful intra-transaction order |
| **Within Plane B** | `occurred_at` (world time). `received_at` is display metadata ("learned late"), never a sort key — sorting by receipt would re-order the world by our inbox |
| **Cross-plane, distinct timestamps** | `occurred_at` |
| **Cross-plane, same timestamp** | **AMENDED from UT-0.** UT-0 proposed (occurred_at, plane, ordinal, id) — a fixed plane precedence. Rejected: a deterministic plane tiebreaker *asserts* that decisions precede observations (or vice versa) at the same instant, which is exactly the invented chronology this ADR forbids. Frozen rule: same-instant events from different planes are rendered as a **group** with no claimed internal order. Determinism for pagination may use (plane, id) internally, but the UI must present the group as simultaneous |
| **Projection ordering** | projections (portal, AI, KPI) inherit the merged order; they may filter, never re-sort by other keys |
| **Render ordering** | newest-first or oldest-first is presentation; the *relative* order is the one above, always |
| **Historical ordering** | rows predating the ordinal keep `occurred_at` + `created_at` + `id`; where several share a timestamp they are **grouped, not ordered** — permanently. Their true intra-transaction order was never recorded, and honesty beats neatness |
| **Backfill ordering** | the ordinal backfill for existing rows follows (`occurred_at`, `created_at`, `id`) and is documented as *administrative, not historical*: it stabilises pagination and claims nothing about real sequence. **No `occurred_at` is ever rewritten. No historical event is ever invented.** |

## 3. ADR-UT-3 — Two-plane architecture (FROZEN as audited)

The four UT-0 grounds (metadata policy, volume, bitemporality, trust-flattening) were
re-verified and stand. Frozen: telemetry never enters `business_event`; decisions never
enter the observation stores; Unified Tracking is a read model over both and owns no store,
no state, no rule, no transition, no sync. `POSITION_UPDATE`/`ETA_UPDATE` remain Plane-B
concepts and are **permanently ineligible** for Plane A.

## 4. RATIFY-UT-1 — Milestone granularity (DECIDED by this freeze; NARROWED)

**Decision: milestone-level, not telemetry-level.** The dossier timeline shows Plane-B
**milestones** (departed, arrived, discharged, delivered, exceptions…) and never individual
`POSITION_UPDATE`/`ETA_UPDATE` rows. Position and ETA remain available on the map and
tracking surfaces, summarised on the timeline at most as the *current* computed state, and
labelled with confidence.

**Narrowing (this is the "not silently accepted" part):** UT-0 posed "every position, or
milestone-only" as an open range. Frozen at milestone-only with **no per-tenant toggle** —
a granularity toggle would make two tenants' histories mean different things, and the
timeline's meaning must not be configurable. Revisable only by a future management
decision, recorded here.

## 5. RATIFY-UT-2 — Prologue visibility (DECIDED by this freeze)

**Decision: visibility follows the SUBJECT, never the ledger.** An event is visible to
whoever may see the thing it is about:

| Event scope | Visible to |
|---|---|
| dossier-scoped (`dossier_id` set) | whoever passes `can_read_file` — unchanged |
| quotation prologue | whoever may read the quotation (DEC-C32: `quotation:create` OR `quotation:validate`) |
| correspondence prologue | whoever holds the communication read authorities (EC-1/EC-2) |
| config-scoped (policy events) | platform administration — unchanged |

Consequence, frozen: **once a prologue is stitched to a dossier** (attachment or
conversion), the stitching events are dossier-scoped and visible to dossier readers — the
dossier reader sees *that* a quotation preceded the dossier and *that* correspondence was
attached, without thereby gaining the right to open the quotation's amounts or the
mail body. Deep content stays behind its own module's gate. **No new permission is minted
for the prologue**, closing UT-0's D5 without widening `admin:config:manage` or inventing
`tracking:read`.

## 6. Provenance model (AMENDED from the brief's flat list)

The recommended categories (Decision / Observation / Human / System / External Partner /
Computed) mix two independent axes and would force false choices — a carrier milestone is
*both* an observation *and* external; a validation is *both* a decision *and* human.
**Frozen as a two-axis classification, fully derivable from columns that already exist —
no schema change:**

| Axis 1 — NATURE | derived from |
|---|---|
| `decision` | Plane A |
| `observation` | Plane B |
| `computed` | produced at read time (current position, ETA, freshness) — never stored as an event |

| Axis 2 — ORIGIN | derived from |
|---|---|
| `human` | Plane A `actor_user_id` present; Plane B source MANUAL |
| `system` | Plane A `source` db_trigger/policy_rpc with no actor; Plane B source SYSTEM |
| `external` | Plane B source CARRIER/AIS/PORT/TERMINAL/CUSTOMS/ROAD |

Every rendered timeline entry carries (nature, origin) **plus** Plane B's `confidence`
where applicable. A `computed` value is never rendered as an event and never persisted as
one. An `external` `ESTIMATED` fact is never displayed with the same visual authority as a
`decision` — ADR-UT-4 stands.

## 7. Subject and identity model (FROZEN)

| Identity | Frozen definition |
|---|---|
| **Timeline identity** | the dossier. One dossier = one timeline |
| Subject identity | `subject_type` + `subject_id`; the dossier via `dossier_id`/`correlation_id` |
| Dossier ↔ shipment | 1:1 (`shipment.file_id NOT NULL UNIQUE`) — the same thread, no second identifier |
| Communication identity | `ec_inbound_message.id`; joins the timeline only through attachment events |
| Document identity | `document.id` + SHA-256; linked, never embedded |
| Tracking identity | Plane-B row ids; reach the timeline via shipment → dossier |
| Customer identity | `client.id`; portal users see projections, never identities beyond their client |
| Financial identity | invoice/expense ids; **amounts never travel** — the timeline links to Finance (RATIFY-UT-7 default confirmed: link-only) |
| AI identity | none. AI output has no event identity because it is not an event |

## 8. Projection and read-model rules (FROZEN)

**Tracking stores:** nothing.
**Tracking computes:** current position, ETA, freshness, confidence labels, KPI aggregates.
**Tracking projects:** the merged (A+B) history per dossier; the `clientSafe` subset for
the portal; milestone summaries for dashboards.
**Tracking never owns:** a table, a state machine, a business rule, a transition, a sync
job, a scheduler, or a write path into any plane.

Read-model rules: explicit tenant scope on every read (admin-client composition — the
EC-3C rule); visibility per §5; ordering per §2; provenance per §6; incompleteness stated
(ADR-UT-7) — a timeline that lacks prologue rights says so rather than rendering a
seamless-but-partial history.

## 9. Bounded contexts — owner / producer / consumer (FROZEN)

| Context | Owns | Produces (events) | Consumes |
|---|---|---|---|
| Commercial | quotation lifecycle | 10 commercial | own timeline |
| Enterprise Communications | capture, triage | 7 communication (+`CORRESPONDENCE_RECEIVED` in UT-3) | — |
| Operations | dossier, process, tasks | dossier/task/process/handoff | dossier timeline |
| Transit/Customs/Transport | their milestones | customs + transport | — |
| Finance | money | finance events (ids only) | — |
| Documents | artifacts | document events | — |
| **Tracking** | **projections only** | **nothing** | **both planes** |
| Portal | customer projection | nothing | `clientSafe` projection only — **never module tables** |
| AI | inference | **nothing** | the merged read model only — no module-specific reasoning paths |
| Enterprise Mail *(future)* | outbound/inbound mail platform | correspondence events through the **existing EC vocabulary** — it extends EC's emitters, it does not mint a parallel mail domain | — |
| HR / Brand Center | people / brand | nothing into shipment history | — |
| Platform | tenants, roles, registry, metadata policy | policy events | — |

**Portal 2.0** consumes the `clientSafe` projection of the unified read model and nothing
else. **Enterprise Mail** contributes by emitting into the existing `communication` domain.
**AI** consumes the merged timeline as its only operational ground truth, writes nothing
back, and gains no module-specific side channels.

## 10. Risks carried forward

R1–R8 from UT-0 stand, now with owners: R1/R2 (third store, telemetry funnelling) are
blocked by §1; R3 (false ordering) by §2; R4 by the existing deny-list test; R5 by §8;
R6 by §9; R7 by making each `clientSafe` addition a ratified decision; R8 by §2's backfill
rule. New risk **R9**: the ordinal backfill being read as historical truth — mitigated by
its "administrative, not historical" designation in §2.2.

## 11. Roadmap — responsibilities (no implementation here)

| Phase | Responsibility | Schema change |
|---|---|---|
| **UT-1** | the ordering foundation: monotonic ordinal + the frozen read contract (§2), proven by tests. No UI | the ordinal (the program's only foundational one) |
| **UT-2** | the merged two-plane read model: tenant-gated, provenance-carrying, confidence-preserving | none |
| **UT-3** | the 9 missing emitters, `CORRESPONDENCE_RECEIVED` and the two handoffs first (order per RATIFY-UT-5, still open) | none (RPC/trigger edits only) |
| **UT-4** | the unified timeline surface; absorb `lib/logistics/compose.ts` (D4) into the read model | none |
| **UT-5** | portal + AI projections under RATIFY-UT-3/4 | none |

Open management items **not** blocking UT-1: RATIFY-UT-3 (customer position visibility),
RATIFY-UT-4 (customer ETA wording), RATIFY-UT-5 (emitter order), RATIFY-UT-6 (telemetry
retention).

## 12. Readiness and verdict

UT-0's three conditions are now cleared: ADR-UT-2 frozen (§2, amended), ADR-UT-3 frozen
(§3), RATIFY-UT-1 decided (§4), RATIFY-UT-2 decided (§5). All seven ADRs are in force;
ADR-UT-5 is superseded in its open part by §5's subject-follows-visibility rule.

# ✅ GO for UT-1

UT-1 is authorised to build **exactly** the ordering foundation of §11 — the ordinal and
the read contract — and nothing beyond it. Any deviation from this freeze returns to
management before code.

---

*UT-1A produced documentation only. No code, migration, SQL, permission, RPC or UI was
created or modified.*
