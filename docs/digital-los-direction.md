# Architecture Direction — Digital Logistics Operating System (Digital LOS)

**Ratified by management: 2026-08-04.** Standing direction for every future bounded
context, ADR, audit, migration and implementation decision. Register entries proposed
below as **DEC-B84..B87** (next free B-series numbers) for the next hygiene pass —
per the register's own rule, the register remains authoritative once they are entered.

---

## 1. The direction, restated as enforceable rules

1. **One shipment, one digital lifecycle.** Everything operationally significant
   revolves around the Dossier (`operational_file`); nothing operationally significant
   lives outside it.
2. **Tracking is a bounded context and the read backbone — never an engine.**
   It owns timeline projection, visualization, geographic projection, operational
   history. It owns **no** business rule, no business state, no workflow transition,
   no synchronization job. There is never a second tracking engine.
3. **Modules emit; Tracking consumes.** Every module's design question is
   *"what operational event should this emit?"* — never *"how should Tracking be
   updated?"* Tracking evolves as the read model over the immutable event stream.
4. **No duplicated tables, no sync engine, no secondary source of truth.**
5. **Four dimensions**: operational timeline · geographic movement · document
   lifecycle · communication history — all projections over the same dossier.
6. **AI reasons over the timeline**, not beside it: delay prediction, missing-document
   detection, blocked-dossier surfacing, ETA confidence, SLA risk, next-action
   recommendation, anomaly surfacing, communication summarization — all read-only over
   the event stream, under the standing suggestions-only doctrine.

## 2. Honest alignment audit — where the platform already is

The direction is largely a *naming* of what the architecture has been converging on
since WES-9, which is why it can be adopted without correction:

| Direction element | Existing foundation | State |
|---|---|---|
| Immutable event stream | `business_event` (WES-9: typed, versioned, emit-RPC, **mandatory emission aborts the write**) | **exists — the spine** |
| Domain event stores | `ocean_tracking_event`, `air_tracking_event`, `tracking_event` (road), `assignment_event`, `hr_employee_event`, `invoice_deposit_event` — all append-only (`prevent_mutation`, 26 migrations use it) | exist |
| Dossier-centric ownership | WES-3: departments own dossiers, people own tasks; WES-5 fact-based reconciliation | ratified + shipped |
| Communication history on the dossier | `communication_message.file_id` (outbound, since 1.14) · conversations typed `dossier` (8.7) · `ec_inbound_message` + `thread_key` (EC-1) → EC-2 attaches inbound to dossiers | converging by design |
| Document lifecycle | WES-4 governance (UPLOADED → PENDING_REVIEW → APPROVED/REJECTED/EXPIRED, maker-checker, evidence doctrine) | exists — see gap D below |
| Geographic projection | Leaflet maps + position intelligence (7.2/7.3), provider-neutral carrier/AIS stubs, geofences (`lib/tracking/geo, geofence, position`) | exists, provider-dark |
| Channel-neutral EC | EC-1 adapter registry; capture-then-human-triage (ADR-EC-1) | exists — see gap C |
| AI over composed operational state | copilots already consume composed read models (7.6B risk engine, 10.0F operations copilot) | exists — context source shifts to the timeline as it unifies |

**Conclusion: adopt without a rewrite.** The Unified Tracking phase is a
*consolidation* phase, not a construction phase.

## 3. The four tensions the direction must resolve (named now, decided at UT-0)

**A — The event surface is plural today.** Nine append-only stores plus `audit_log`.
The vision's read model needs a defined surface. Two honest options for the Unified
Tracking audit (UT-0) to decide: **(1)** Tracking composes the existing ledgers as-is
(the platform's proven composition pattern — no migration, no backfill risk); **(2)**
every module funnels into `business_event` and Tracking reads one stream (cleaner, but
requires emission retrofits and a versioning discipline across domains). The direction's
"no synchronization engine" rule **excludes** any option that copies events between
stores. Recommendation: start with (1) — a `lib/timeline` composition — and let (2)
happen organically as new phases emit `business_event` natively (WES-9A already made
emission mandatory for new domain writes).

**B — A tracking module already exists** (`lib/tracking`, `tracking:read/manage/write`,
8.4 interactive map; plus ocean/air event stores with their own maps). Rule 2 means the
Unified Tracking context **absorbs and composes** these — the existing module becomes
the bounded context's geographic dimension. Any UT phase that builds beside them
violates the direction it implements.

**C — EC channels.** `ec_inbound_message` is email-shaped (from_address, subject,
MIME). WhatsApp/website/API channels fit the adapter seam, but the envelope will need
mild, additive generalization (channel column, channel-appropriate identifiers) when a
second channel is ratified. Not now — no channel beyond email is approved (DEC-EC-D2
still open even for email's provider).

**D — Document lifecycle has a transmission gap.** WES-4 covers
production/verification (Generated → Reviewed). The direction adds **Sent → Received →
Accepted → Archived** — transmission and acknowledgment states that today live only as
`communication_message` rows (sent) and nowhere (received/accepted). This is additive:
document-lifecycle *events* on the timeline, likely portal acknowledgment for
"accepted". Belongs to the Unified Tracking + Portal phases; no change to WES-4's
verification doctrine.

**One boundary kept explicit:** HR, Brand Center, Caisse/treasury and platform
administration are corporate contexts, **not** dossier satellites. They emit to the
timeline only when operationally relevant (the direction's own wording) — an employee's
C3 record never becomes shipment history. The dossier-centric rule governs the
*logistics operational core*.

## 4. Ratified roadmap order

> EC-2 Triage Workspace → EC-3 Commercial/Quotation → Operations integration
> (Quotation → Dossier) → **Unified Tracking bounded context** → Customer Portal
> (evolution of the existing 7.5A portal around the timeline) → AI Operations Copilot
> (evolution of 10.0F over timeline context).

Consistent with LOG-0's recommendation (EC-2 next, after Q-COMM-1..4 +
RATIFY-EC1-1/DEC-EC-D3). The two final entries are **evolutions of shipped modules**,
not new builds — the portal and the operations copilot exist.

## 5. Proposed register entries (for the next hygiene pass)

* **DEC-B84 — Digital LOS principle**: one shipment, one lifecycle; the Dossier is the
  digital source of truth; nothing operationally significant outside it (corporate
  contexts emit-when-relevant only).
* **DEC-B85 — Tracking bounded context**: read-model-only backbone; owns projections
  and visualization; owns no business rule/state/transition/sync; never a second engine;
  absorbs the existing tracking/ocean/air read surfaces.
* **DEC-B86 — Emission rule**: every future phase answers "what operational event does
  this module emit?"; Tracking is never updated directly; no event copying between
  stores.
* **DEC-B87 — Roadmap order** as §4, superseding any earlier ordering.

## 6. Standing evaluation question

Every future phase review starts with: **does this strengthen the Digital LOS — one
dossier, one timeline, emitted events, no parallel state — or does it introduce an
isolated module?** A phase that cannot answer the emission question has not finished
its audit.
