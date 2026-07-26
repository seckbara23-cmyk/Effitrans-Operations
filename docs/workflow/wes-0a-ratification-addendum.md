# WES-0A — Architecture Ratification Addendum

**Date:** 2026-07-26 · **Status:** RATIFIED · **Type:** documentation only — no code, no schema, no permissions, no tests changed
**Amends:** [`wes-0-canonical-workflow-architecture.md`](wes-0-canonical-workflow-architecture.md)
**Baseline:** WES Audit + WES-0, both approved, at commit `11b7400`

All WES-0 decisions stand unless explicitly refined below. This addendum adds three governance ADRs,
refines two existing ADRs, and revises the implementation contract and phase sequencing.

---

## 0. Why these three concerns had to be settled before WES-1

The WES-0 architecture decided *what the workflow is*. It did not decide **who may change the rules**,
**how time is accounted for**, or **how history is proven**. Left open, each would have been invented
during implementation — which is precisely how the platform acquired six engines in the first place.

The addendum also corrects one WES-0 overreach: WES-0 pre-decided a physical `transport_mission`
table before anyone examined whether existing structures could carry the contract. That was a
schema decision made without repository evidence, and it is withdrawn in favour of a reuse-first
obligation (§4).

---

## 1. ADR-WES-012 — Business Rules as Versioned Configuration

### Context

Business policy is currently welded into action handlers, seed grants and UI components. The audit
found the consequences directly: BAE authority spread across six roles because it lives in seed SQL;
four department SLA thresholds hardcoded in `lib/sla/config.ts` that *nobody ratified* yet already
drive Control Tower delay flags and Copilot risk scores; step applicability split between a registry
constant and per-action conditionals. Effitrans operates Import, Export, Transit, Air, Maritime and
Road procedures whose rules genuinely differ, and the platform is multi-tenant. Encoding each variant
as code guarantees either a combinatorial explosion of branches or a fork per tenant.

The platform already proves the separation works: `lib/process/applicability.ts` declares exceptions
as data validated against the registry by CI, and `lib/process/sla-policies.ts` declares SLA keys with
an honest `unconfigured / unratified / ratified` tri-state that refuses to fabricate a threshold.

### Decision

**The workflow engine is reusable software. Business policy is versioned configuration.**

Policy that is expected to differ by tenant, shipment type, transport mode, business unit,
regulatory procedure or operational phase **must not be hardcoded** in action handlers or UI
components.

#### A. What remains CODE (never configurable)

These are invariants. No configuration value may weaken, disable or reinterpret them:

1. State-machine mechanics and legal-transition enforcement.
2. Compare-and-set concurrency, idempotency keys, partial unique indexes.
3. Maker-checker **identity** enforcement (maker ≠ checker).
4. Tenant isolation and RLS.
5. The requirement to audit and to emit business events.
6. The monotonic lifecycle guarantee (ADR-WES-010).
7. The evidence-evaluation **framework** (the mechanism that reads requirements and decides).
8. The permission-enforcement **framework** (`assertPermission`, RLS predicates).
9. The canonical projection and the single progress formula (ADR-WES-007/008).
10. Append-only ledger semantics.

#### B. What becomes CONFIGURATION

Seven canonical policy domains:

| # | Domain | Contents |
|---|---|---|
| 1 | **Stage registry** | canonical stages, their order, step-key mapping |
| 2 | **Stage applicability** | by file type, transport mode, business unit, procedure |
| 3 | **Seat bindings** | responsible department by stage · permitted assignee roles · BAE uploader/verifier seats · handoff recipients · escalation recipients · whether a supervisor may intervene |
| 4 | **Evidence requirements** | required document types by stage · verification requirements · gate prerequisites |
| 5 | **Review rules** | which steps require independent review (maker-checker **pairs** — the pairing is policy, the identity rule is code) |
| 6 | **SLA policies** | targets, calendars, pause conditions, escalation schedule (ADR-WES-013) |
| 7 | **Handoff routing** | source → target, whether explicit reception is required |

#### C. Versioning doctrine

- A policy version is **immutable**. Changing policy creates a **new version**; existing versions are
  never edited or deleted.
- Each version carries `effective_from`. There is a **platform default** policy; a tenant either
  inherits it or holds a **tenant override** version.
- **Pinning (the doctrine that makes history reproducible):** a dossier **pins its policy version at
  process-instance creation**. A policy change does **not** affect dossiers already in progress.
- **Migration of an in-flight dossier** to a newer version is possible only through an explicit,
  audited, reasoned action by an authorized seat — never implicitly, never in bulk without preview.
- **Provenance:** every step execution, assignment event and business event records the policy
  version in force at the moment it occurred.

> **Required doctrine, ratified verbatim:** *a dossier must retain enough policy-version provenance
> to explain why an action was allowed or required at the time it occurred.*

#### D. Change governance

- **Who:** a dedicated capability, distinct from `admin:config:manage`, because editing workflow
  policy is not the same authority as editing company settings. Platform-default policy is a platform
  -layer act; tenant overrides are a tenant-admin act.
- **Approval:** maker-checker — the author of a policy version may not be its activator. Reuses the
  ratified `evaluateMakerChecker` identity rule; no second implementation.
- **Preview / dry-run is mandatory before activation**: the diff against the current version and the
  count and list of dossiers that would be affected must be shown. Activation without a preview is
  refused.
- **Activation** publishes a new immutable version with an effective date.
  **Rollback** activates a prior version **as a new version** — never by mutating or deleting.
- **Audit:** draft, preview, activation and rollback are each audited and emitted as business events.

#### E. Safety boundaries (validated at activation, not at runtime)

A policy version that would do any of the following is **rejected at activation**:

1. Bypass or weaken RLS or tenant isolation.
2. Reference a permission that does not exist in the permission catalog, or grant any capability
   outside it.
3. Disable, downgrade or bypass audit logging or business-event emission.
4. Permit maker = checker.
5. Declare a lifecycle or step transition the state machine rejects.
6. Break monotonicity (reorder stages in a way that would decrement an in-flight dossier's ratchet —
   the pinning rule in §C prevents this by construction; the validator enforces it for migrations).
7. Empty a required-evidence set that ratified doctrine mandates (e.g. verified BAE before pickup on
   a customs-leg dossier).
8. Bind a seat that does not exist as a tenant role.

Validation is **fail-closed**: an unvalidatable policy version cannot be activated.

### Consequences

- WES-3 and WES-4 write their seat bindings and evidence requirements **as policy**, not as code —
  which is why the policy registry must precede them (§6).
- The four `unratified` SLA thresholds in `lib/sla/config.ts` become policy values that must be
  explicitly ratified or retired. They may not remain live-but-unapproved.
- `lib/process/applicability.ts` and `lib/process/sla-policies.ts` are the migration seeds for
  domains 2 and 6.
- Every routing decision becomes explainable after the fact.

### Rejected alternatives

- **Keep policy in code, branch per tenant.** Rejected: guarantees forks, and the audit already shows
  what un-versioned policy does to authority (six BAE seats).
- **Fully dynamic rules engine (DSL/scripting).** Rejected: unbounded expressiveness would let policy
  cross the §E boundaries, and it cannot be validated fail-closed.
- **Database-only configuration with no code contract.** Rejected: the platform's registry idiom is
  code constants validated by CI; a DB-only registry loses compile-time and CI validation.
- **Retrofit policy after WES-3/4.** Rejected: doubles the work and re-creates drift.

### Future implications

Multi-procedure and multi-business-unit operation becomes a configuration exercise. Onboarding a new
tenant with different customs procedures no longer requires a release. Policy versions become the
substrate for regulatory change management.

---

## 2. ADR-WES-013 — Canonical SLA, Time and Escalation Model

### Context

Effitrans operations are time-sensitive; workflow state without time accountability is incomplete.
Today there are two competing SLA sources — `lib/sla/config.ts` (four hardcoded, **unratified**,
already-live department thresholds) and `lib/process/sla-policies.ts` (per-step keys, honest
tri-state, no values) — and no canonical timestamp vocabulary. The 10.0D KPI engine already
established the correct time doctrine: tenant-timezone windows resolved from `organization.timezone`
(which exists, defaulting to `Africa/Dakar`), never server-local assumptions.

### Decision

#### Timestamp vocabulary (canonical, required on every SLA-bearing subject)

| Field | Meaning |
|---|---|
| `available_at` | the work became eligible (prerequisites met) |
| `assigned_at` | a person became responsible |
| `accepted_at` | the assignee acknowledged (handoff reception, mission acceptance) |
| `started_at` | work actually began |
| `due_at` | the SLA target instant, computed from policy + calendar |
| `completed_at` | the work finished |
| `paused_seconds` | accumulated explicit pause |
| `blocked_seconds` | accumulated blocked time |
| `elapsed_working_seconds` | derived, calendar-aware |
| `sla_status` | derived: `unconfigured` / `on_track` / `warning` / `breached` / `paused` |

#### Clock model

- All timestamps are stored in **UTC** (`timestamptz`), as today.
- All business-time computation uses the **tenant timezone** from `organization.timezone`, via the
  10.0D mechanism (`resolveTimezone` + tenant windows). **Server-local and browser-local time are
  prohibited** for any SLA or business-date computation.
- **Business calendar** is configuration (ADR-WES-012 domain 6): working days, working hours,
  holidays, and a `continuous` flag for 24-hour operations.
- **Departments may hold different calendars.** Transport and Customs field operations may be
  `continuous` while Finance is business-hours. A calendar is resolved per (tenant, department),
  falling back to the tenant default.
- Calendars are versioned and pinned exactly like any other policy.

#### The four clocks — all four always recorded

| Clock | Definition | Used for |
|---|---|---|
| **Total elapsed** | wall clock, start → completion. Never paused, **never hidden** | client-facing truth, cycle-time reporting |
| **Internal accountable** | calendar-aware working time while Effitrans owed the action | **this is what SLA measures** |
| **External waiting** | waiting on client, Customs, carrier | reported separately, never counted against internal SLA |
| **Paused** | explicit internal suspension (outage, deliberate hold) | excluded from both, always flagged and reasoned |

> **Ratified constraint:** *do not hide elapsed time merely because internal SLA is paused.* Any
> surface that shows an SLA state must be able to show total elapsed alongside it.

#### Pause matrix

| Condition | Internal SLA | Clock that runs |
|---|---|---|
| Waiting for the client | **pauses** | external |
| Waiting for Customs | **pauses** | external |
| Waiting for an external carrier | **pauses** | external |
| Awaiting corrected documentation — from the client | **pauses** | external |
| Awaiting corrected documentation — from an internal department | **runs** (on the responsible department) | internal |
| Blocked internally | **runs** — you do not earn credit for blocking yourself | internal |
| System outage | **pauses** | paused (audited) |

#### SLA ownership

| Subject | Start | Pause | Resume | Complete | Breach | Escalation |
|---|---|---|---|---|---|---|
| **Process step** | `available_at` | per matrix | condition clears | `completed_at` | `due_at` passed | warning → breach → management |
| **Task** | `assigned_at` | per matrix | condition clears | task DONE | `due_at` passed | assignee → supervisor |
| **Handoff** | sent | never (acceptance is internal) | — | received | acceptance target passed | receiving supervisor |
| **Mission** | dispatch | external wait (site closed, customs hold) | condition clears | delivery / POD | planned delivery passed | dispatcher → transport supervisor |
| **Document verification** | upload | never | — | verified / rejected | verification target passed | verifying department |
| **Client request (portal)** | request received | never | — | answered | response target passed | account manager |
| **Finance approval (visa)** | step became current | never | — | visa recorded | step target passed | finance supervisor |

#### Unconfigured doctrine — extended, not replaced

The existing tri-state is ratified as platform-wide law:

- `unconfigured` → renders « SLA non configuré » and **never** produces warning or breach.
- `unratified` → a live value nobody approved. **Must be surfaced as such**, and must be either
  explicitly ratified or retired during WES-8. The four thresholds in `lib/sla/config.ts` are exactly
  this case and may not silently become canonical.
- `ratified` → approved by management, carried as policy with a version.

#### Escalation model

- **Warning threshold** → assignee + department supervisor.
- **Breach threshold** → + operational owner.
- **Breach + escalation interval** (policy) → management.
- **Repeat behaviour:** at most one notification per `(subject, level, escalation window)`.
  Deduplication reuses the proven `dedup_key` + partial-unique pattern already used by
  `tracking_event`.
- Every escalation is a **business event** (ADR-WES-014), not merely a notification — so escalation
  history is queryable and auditable.

#### Reporting contract

The model must answer, without additional computation logic: active steps nearing breach · breached
steps · average processing time by department · **external vs internal delay** · handoff acceptance
time · mission timeliness · client-facing ETA confidence.

### Consequences

- WES-2 must land the canonical timestamp fields even though SLA logic arrives in WES-8.
- Two SLA sources collapse into one policy domain.
- External waiting time becomes reportable for the first time — which is what makes customs and
  client delays defensible to a client.

### Rejected alternatives

- **Single elapsed clock.** Rejected: makes Effitrans accountable for Customs' and clients' time.
- **Hide paused time from users.** Rejected: a dossier that took 14 days took 14 days; concealing
  that to protect an internal metric is dishonest reporting.
- **Per-department hardcoded thresholds (status quo).** Rejected: unratified values already drive
  live risk scoring.
- **Server-local time.** Rejected outright; contradicts the ratified 10.0D tenant-window doctrine.

### Future implications

Contractual SLA per client becomes a policy override. Predictive ETA gains a calendar-aware basis.
Department performance becomes comparable because everyone's clock is defined identically.

---

## 3. ADR-WES-014 — Immutable Business Event Ledger

### Context

The platform holds several append-only ledgers — `audit_log`, `file_state_transition`,
`process_step_execution` attempts, `tracking_event`, `invoice_deposit_event`, `expense_visa`, and the
assignment ledger proposed by WES-0. Each is authoritative in its own domain, and none provides a
**cross-domain operational timeline**. The dossier timeline, the cockpit, SLA analytics, the copilot
and any future integration each reconstruct history by querying six tables with different shapes.

### Decision

Introduce **one append-only `business_event` ledger** as the **canonical cross-domain operational
timeline and integration stream**, populated from **successful, committed domain actions**.

- Events are **appended**, never edited, never deleted.
- **Corrections are represented by later events**, never by rewriting an earlier one.
- The ledger **never authorizes an action** and **never replaces the process engine**.

#### Event envelope (ratified minimum)

`event_id` · `tenant_id` · `file_id` (dossier) · `event_type` · `event_version` · `occurred_at` ·
`recorded_at` · `actor_user_id` · `actor_role_at_time` · `responsible_department` ·
`process_instance_id` · `step_execution_id?` · subject reference (`task_id` / `mission_id` /
`document_id` / `invoice_id` …) · `source_subsystem` · `correlation_id` · `causation_id` ·
`metadata` (safe structured) · `policy_version` · `override_marker` + `override_reason`.

`actor_role_at_time` is frozen at write — the `invoice_deposit_event` and `expense_visa` precedent:
a supervisor holding several roles must never make the chain ambiguous.

#### Event vocabulary (initial, versioned, extensible)

`DOSSIER_OPENED` · `CLIENT_DOCUMENT_UPLOADED` · `DOCUMENT_VERIFIED` · `DOCUMENT_REJECTED` ·
`CUSTOMS_DECLARATION_PREPARED` · `CUSTOMS_DECLARED` · `CUSTOMS_REVIEW_STARTED` ·
`INSPECTION_REQUIRED` · `DUTIES_LIQUIDATED` · `BAE_RECORDED` · `BAE_VERIFIED` ·
`CUSTOMS_RELEASE_COMPLETED` · `TRANSPORT_REQUEST_GENERATED` · `TRANSPORT_ORDER_GENERATED` ·
`MISSION_CREATED` · `DRIVER_ASSIGNED` · `MISSION_STARTED` · `PICKUP_CONFIRMED` ·
`DELIVERY_COMPLETED` · `POD_RECEIVED` · `INVOICE_ISSUED` · `PAYMENT_RECEIVED` · `DOSSIER_ARCHIVED` ·
`WORKFLOW_BLOCKED` · `WORKFLOW_REVERSED` · `ADMIN_OVERRIDE_EXECUTED`.

Each type carries an `event_version`; a payload shape change is a new version, never a silent
reinterpretation.

#### Relationship to existing ledgers — ratified

> **Existing domain ledgers remain authoritative for their domain. The business-event ledger is the
> canonical cross-domain timeline and integration stream, populated from successful committed domain
> actions. Where they disagree, the domain ledger wins.**

| Ledger | Remains authoritative for | Relationship |
|---|---|---|
| `audit_log` | security/compliance — who did what to the system | **Not replaced.** Different purpose, retention and privacy class. An event is not an audit record. |
| `file_state_transition` | dossier status history | source |
| `process_step_execution` | step attempts, reviews, corrections | source |
| `assignment_event` (WES-3) | assignment history | source |
| `tracking_event` | GPS/field telemetry | source (selective — telemetry is not promoted wholesale) |
| `expense_visa`, `invoice_deposit_event`, finance ledgers | finance/custody facts | source (**metadata only** — no amounts) |

#### Transactionality doctrine

**Best-effort event writes are forbidden.** The `handoffs/triggers.ts` shape — a post-commit call
wrapped in a swallowed `catch` — is precisely the pattern that produced the duplicate-task defect and
must not be reproduced for events.

The repository constraint is explicit and acknowledged: the service-role supabase-js client
**cannot hold a multi-statement transaction** (the engine documents this in
`lib/process/engine/actions.ts`). Therefore an app-layer "write domain row, then write event" is
structurally a dual write and is **prohibited**.

Two approved mechanisms — the implementer chooses per action, and must justify the choice:

1. **RPC-first (default).** A `security definer` Postgres function performs the domain write **and**
   the event insert in one call, receiving actor, correlation, causation and policy version as
   parameters. Proven precedent: `provision_tenant`, `next_*_number`.
2. **Trigger-based emission.** An `AFTER INSERT/UPDATE` trigger on the authoritative domain table
   emits the event atomically by construction. Appropriate only where every envelope field is
   derivable from row data; otherwise mechanism 1.

**Rule:** if an event cannot be emitted atomically with its domain fact, the domain action **fails**.
No silent divergence between what happened and what was recorded.

Final physical design is deferred to the implementing phase; this doctrine and the prohibition are
binding on it.

#### Privacy and security

**Prohibited payloads — never written to the ledger:** document contents or bytes · extracted OCR
text · client message or email bodies · monetary amounts, bank details or account numbers ·
beneficiary/supplier banking data · PII beyond actor and subject identifiers · credentials, tokens or
signed URLs · AI prompts or completions · raw form dumps.

**Permitted:** identifiers, type codes, status transitions, step keys, department codes, counts,
durations, content hashes, policy versions, override markers and their reasons.

- **Override and rejection reasons are included** — governance requires them. They are staff-authored
  operational justifications, inherit the dossier's visibility class, and are **never** exposed to
  the client-safe feed.
- **Redaction strategy:** the client-safe activity feed is a projection with an **allow-list of event
  types and fields** — never a filter applied over full rows.
- **Retention:** archive-not-delete (DEC-B19/DEC-C24). Events are never deleted. Statutory retention
  durations remain the open external-legal question already recorded in DEC-C24.
- **Isolation:** `tenant_id NOT NULL`, RLS SELECT-only gated on a read permission, service-role
  writes only, `prevent_mutation` triggers on UPDATE and DELETE.

#### Consumer contract

Supported consumers: dossier timeline · operations cockpit · reporting · SLA analytics ·
notifications · copilot context (counts and type codes only, per the 10.0F redaction doctrine) ·
client-safe activity feed (allow-listed) · future external integrations.

**The ledger is read-only to every consumer.** No consumer may write to it, and no consumer may treat
it as an authorization source.

### Consequences

- The dossier timeline stops being a six-table join.
- Integration with a client's TMS/ERP becomes a stream subscription rather than a bespoke export.
- Emission becomes a correctness requirement of domain actions, not an afterthought — which is why it
  must precede WES-5 (§6).

### Rejected alternatives

- **Extend `audit_log` instead.** Rejected: conflates security auditing with operational history;
  they have different retention, privacy class, consumers and query patterns.
- **Event sourcing as the system of record.** Rejected: would replace the process engine and the
  domain ledgers — enormous, and contrary to ADR-WES-007's single-authority decision.
- **Best-effort async emission (queue, fire-and-forget).** Rejected explicitly: unreliable history is
  worse than no history because it is trusted.
- **Per-domain event tables.** Rejected: that is the status quo the ledger exists to unify.

### Future implications

External integration, client-facing activity feeds, ML/analytics on operational history, and
regulatory reconstruction of "what happened and why" all become tractable from one contract.

---

## 4. ADR-WES-004 — REFINED: mission persistence is reuse-first

**The logical Mission concept remains fully ratified** (WES-0 §7): mission owns driver, vehicle,
route, ETA, GPS, pickup, delivery, POD; the dossier owns client, customs, finance, documents and
commercial history; the chauffeur never works on a dossier.

**Refinement — what is withdrawn:** WES-0's implication that a new `transport_mission` table is
mandatory. That was a physical decision taken without repository analysis.

> **Ratified doctrine:** *The Mission bounded concept is mandatory. A new table is not automatically
> mandatory.*

Before any schema work in the mission phase, implementation **must** produce a written
reuse-versus-new-entity analysis, evaluating at minimum `transport_record`, `tracking_session` /
`tracking_event`, driver assignment structures, process steps, task entities, and existing uniqueness
and lifecycle constraints.

**A dedicated entity is justified only if the existing model cannot safely provide all of:**

1. one dossier → multiple missions;
2. at most one ACTIVE mission by default;
3. authenticated driver-**user** assignment;
4. an independent mission lifecycle;
5. preserved mission history;
6. reassignment without recreating execution state;
7. vehicle and route ownership;
8. tracking linkage;
9. POD/evidence linkage;
10. efficient chauffeur-portal queries.

**Evidence already on record** (from the WES Audit — supplied as input to that analysis, **not** as a
pre-decision):

- `transport_record.file_id` is `UNIQUE NOT NULL` — structurally one transport per dossier. Any reuse
  proposal must explain how requirement 1 is satisfied without weakening a constraint that currently
  prevents duplicate transport records.
- `tracking_session` already carries `file_id`, `transport_id`, `driver_id`, a four-state lifecycle
  (`ACTIVE/PAUSED/COMPLETED/CANCELLED`), `started_at`/`ended_at` and `vehicle_plate` — materially
  close to a mission execution record, but conceptually a GPS session, with nullable
  `transport_id`/`driver_id` and `on delete set null`.
- `transport_record.driver_user_id` exists with a partial index and already drives driver RLS.
- `document` is dossier-bound; mission-scoped evidence linkage (requirement 9) needs an answer.

If the analysis proves a dedicated entity is necessary, it is documented and built **in the mission
phase — not in this addendum**. If reuse suffices, the mission contract is satisfied without new
schema. Either outcome is acceptable; proceeding without the analysis is not.

---

## 5. ADR-WES-005 — REFINED: internal generated documents

Replacing all prior wording for Category B:

> **Internal operational documents are system-generated, immutable artifacts derived from
> authoritative structured operational data. Users may request regeneration when source data changes,
> but may not manually upload or directly edit these artifacts.**

Applies to: Demande de Transport · Ordre de Transport · Mission Sheet · Dispatch Order ·
Internal Manifest.

| Aspect | Ratified rule |
|---|---|
| **Generation trigger** | an authorized workflow action reaching the state that requires the artifact (e.g. dispatch produces the Ordre de Transport). Never a manual upload. |
| **Source-data version** | the artifact records the identity **and version** of the structured records it was rendered from |
| **Artifact version** | monotonically increasing per (document type, subject); prior versions are retained forever |
| **Content hash** | `sha256` of the rendered bytes — the 11.0B/11.0C `content_sha256` discipline reused |
| **Generated-by identity** | the actor and their role at generation time |
| **Supersession** | a new version supersedes the previous one; the superseded version is retained and remains retrievable, never deleted |
| **Download / sharing** | short-TTL signed URLs, mediated server-side, permission-gated — the existing storage doctrine; no public URLs |
| **Regeneration** | permitted when source data changes; produces a **new version**, never an in-place edit |
| **Audit event** | generation, regeneration and supersession are audited and emitted as business events (ADR-WES-014) |

**Correction doctrine:** a correction is made by **changing the structured record through an
authorized workflow action and regenerating the document** — never by editing or re-uploading the
artifact. Uploading a Category-B document type is invalid and must be refused.

**Reuse:** the deterministic renderer + immutable versioned snapshot + content hash + template
version provenance already shipped for Finance expense documents (11.0B/11.0C) is the reference
implementation for this entire category. Do not build a second one.

---

## 6. Revised implementation contract and phase sequencing

### Should the new concerns extend WES-1…6, or become new phases?

**New phases.** Folding a policy registry, an SLA engine and an event ledger into stabilization
phases would inflate them far beyond their purpose and delay the Critical data-loss fixes. Three
dedicated phases are ratified:

- **WES-7 — Policy Registry** (ADR-WES-012)
- **WES-8 — SLA Engine** (ADR-WES-013)
- **WES-9 — Business Event Ledger** (ADR-WES-014)

### Execution order ≠ phase number

Phase numbers are identity; the order below is the schedule. Dependencies, not numbering, drive it:

| # | Phase | Why here |
|---|---|---|
| 1 | **WES-1** — integrity hotfixes | Critical data loss and duplicate tasks. Must not wait for new infrastructure. Also delivers the chauffeur fix (mission link decoupled from `TRACKING_ENABLED`), so drivers receive missions immediately. |
| 2 | **WES-2** — canonical projection, ratchet, one progress formula | Everything downstream reads the projection; lands the canonical timestamp fields for WES-8. |
| 3 | **WES-7** — Policy Registry | **Must precede WES-3 and WES-4**, which are exactly where seat bindings and evidence requirements get written. Building them hardcoded then migrating is double work and re-creates drift. |
| 4 | **WES-9** — Business Event Ledger | **Must precede WES-5**, the highest-volume event producer. Retrofitting atomicity is far harder than building on it. |
| 5 | **WES-3** — ownership, assignment, visibility | Consumes policy (seat bindings), emits events. |
| 6 | **WES-4** — BAE governance and document doctrine | Consumes policy (BAE seats, evidence requirements), emits verification events. |
| 7 | **WES-5** — engine/module reconciliation | Emits reconciliation events atomically on the WES-9 contract. |
| 8 | **WES-8** — SLA Engine | Needs WES-2 timestamps, WES-7 calendars, WES-9 escalation events. |
| 9 | **WES-6** — missions and chauffeur portal | Reuse analysis first (§4). Deferred safely because WES-1 already restores driver missions. |

### Revised acceptance criteria

**WES-1 — integrity hotfixes.** Partial-patch semantics on transport writes with an optimistic
`updated_at` guard · soft-delete forbidden on terminal records · revive preserves prior status ·
handoff re-fire guards (a satisfied handoff never re-opens) · driver-user assignment decoupled from
`TRACKING_ENABLED`.
*Added by this addendum:* must introduce **no new hardcoded policy** — any policy-shaped value it
touches is isolated behind a single named constant module (a policy seam) so WES-7 can lift it into
configuration without rewriting actions. Audit/event writes for every changed action must remain
reliable; no new best-effort write may be introduced.

**WES-2 — canonical projection.** One projection, one progress formula (unchanged), ratchet,
reversal action.
*Added:* the projection carries the ADR-WES-013 canonical timestamp fields (SLA-ready, no SLA logic
yet) · blocked and external-wait states are **distinguished** so SLA responsibility is attributable
later · total elapsed remains visible regardless of blocking.

**WES-3 — ownership, assignment, visibility.** Assignment ledger · task/step/mission assignment ·
visibility matrix into `user_readable_file_ids` · dossier-slot assignment retired.
*Added:* the assignment ledger's envelope aligns with the ADR-WES-014 event contract (actor role at
time, correlation, policy version) · department visibility is never conflated with task assignment ·
the policy version in force is retained whenever a routing decision occurs.

**WES-4 — BAE governance and documents.** Category A/B/C enforcement · verification vocabulary ·
BAE seat chain and grant narrowing · admin override with marker.
*Added:* BAE role bindings and document requirements are expressed **through versioned policy**
wherever practical rather than seed grants · internal generated documents follow the refined
Category-B contract (§5) · verification and override events follow ADR-WES-014.

**WES-5 — engine/module reconciliation.** Evidence-driven engine step completion · handoff tasks
retired.
*Added:* reconciliation produces **transactionally reliable** business events · **no best-effort
trigger may silently advance workflow or emit duplicate events** · evidence evaluation records the
policy version and the causation chain.

**WES-6 — missions and chauffeur portal.**
*Added:* **mission persistence reuse analysis first** (§4) · mission assignment is independent of GPS
flags · generated mission and transport documents derive from structured mission data (§5) · mission
timestamps and SLA semantics follow ADR-WES-013 · mission events follow ADR-WES-014.

**WES-7 — Policy Registry.** Seven policy domains · immutable versions with effective dates ·
platform default plus tenant overrides · dossier pinning at instance creation · maker-checker
activation with mandatory preview/dry-run · rollback as a new version · fail-closed activation
validation against all eight §1E safety boundaries · migration of `lib/process/applicability.ts` and
`lib/process/sla-policies.ts` as seeds.

**WES-8 — SLA Engine.** Four clocks · tenant/department calendars · pause matrix · escalation with
deduplication · the seven reporting queries · resolution of the four `unratified` thresholds
(explicitly ratify or retire — they may not stay live-but-unapproved).

**WES-9 — Business Event Ledger.** Envelope · atomic emission via RPC-first or trigger (no dual
write, no best-effort) · prohibited-payload enforcement · allow-listed client-safe projection ·
RLS + `prevent_mutation` · consumer contract.

Every phase ships with the platform's standing gates: typecheck, full test suite, production build,
and CI RLS verified on GitHub.

---

## 7. Repository contracts implementation must reuse

Building a second one of any of these is a defect, not a choice:

| Contract | Location | Reuse for |
|---|---|---|
| Pure evaluator, many renderers | `lib/finance/expense/visa.ts` (11.0D) | the canonical projection, policy evaluation, SLA status |
| CAS + partial unique index + idempotency key | `lib/process/engine/actions.ts`, `uq_pse_live_step`, `uq_process_handoff_dedup` | every new mutation |
| Maker-checker identity rule | `evaluateMakerChecker`, `lib/process/engine/state.ts` | policy activation approval, BAE verification |
| Append-only ledger discipline | `prevent_mutation` triggers; `expense_visa`, `invoice_deposit_event`, `audit_log` | assignment ledger, business events |
| Actor-role-frozen-at-write | `invoice_deposit_event`, `expense_visa` | assignment ledger, business events |
| Dedup key + partial unique | `tracking_event.dedup_key` | escalation deduplication, event idempotency |
| Atomic multi-table write via `security definer` RPC | `provision_tenant`, `next_*_number` | atomic event emission |
| Tenant-timezone windows | `lib/operations/kpi/*` (10.0D) | every SLA and business-date computation |
| Honest tri-state configuration | `lib/process/sla-policies.ts` | policy values that are unset or unratified |
| CI-validated registry-as-data | `lib/process/applicability.ts`, `validateLifecycleMap()` | every policy domain |
| Deterministic renderer + `content_sha256` + immutable versions + template provenance | `lib/finance/expense/{pdf,hash,templates}.ts` (11.0B/C) | all Category-B generated documents |
| Private bucket + short-TTL signed URLs + service-role mediation | `lib/documents/storage.ts`, `lib/finance/expense/attachments.ts` | generated-document delivery |
| Canonical stage map with CI validation | `lib/process/lifecycle-map.ts` | the stage registry policy domain |
| Redaction doctrine for AI context | 10.0F operations copilot | event ledger → copilot consumer |

---

## 8. Remaining blockers

**None blocking WES-1.** For completeness, the standing items outside WES scope:

| Item | Status | Blocks |
|---|---|---|
| BLK-FIN-1 / BLK-FIN-2 — finance visa signers (Réception, Opération) | open business decision | the finance Bon chain (11.0E); **not** WES |
| 11.0C master template scan (DEC-C26) | outstanding asset | finance PDF pixel-fidelity; **not** WES |
| Statutory retention durations (DEC-C24) | external legal verification | event-ledger retention *values* only; the append-only contract stands regardless |
| Four `unratified` SLA thresholds | live but unapproved | **must be resolved inside WES-8**, not before |

---

## 9. Decision-register entries

Registered as **DEC-B64 … DEC-B68**.

| ID | Subject |
|---|---|
| DEC-B64 | WES-0 canonical workflow architecture (ADR-WES-001…011) |
| DEC-B65 | ADR-WES-012 — business rules as versioned configuration |
| DEC-B66 | ADR-WES-013 — canonical SLA, time and escalation model |
| DEC-B67 | ADR-WES-014 — immutable business event ledger |
| DEC-B68 | ADR-WES-004/005 refinements + WES-7/8/9 and execution order |
