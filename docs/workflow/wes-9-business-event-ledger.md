# WES-9 — Immutable Business Event Ledger

**Date:** 2026-07-26 · **Implements:** ADR-WES-014 · **Migration:** `20260726000004_business_event_ledger` (62nd)
**Depends on:** WES-0/0A (architecture), WES-1 (integrity), WES-2 (canonical projection), WES-7 (policy registry)

One canonical cross-domain operational timeline, populated from committed domain facts. It **records**
history and **authorizes nothing** — no workflow module reads it to make a decision, and no behaviour
changed because it exists.

---

## 1. The finding that shaped the design

The mandate was "reuse first; do not implement until the transactionality map is complete." The audit
found, across 61 migrations and every domain module:

| Question | Answer |
|---|---|
| Is there a transactional outbox? | **No.** Nothing resembling one exists. |
| How do domain actions record history today? | `.update(...)` on the domain table, then `writeAudit(...)` — a **separate PostgREST request**. |
| Can the app hold a multi-statement transaction? | **No.** The supabase-js service-role client cannot; PostgREST runs each request in its own transaction. |
| Which RPCs are transaction-capable? | Of 68, only `provision_tenant`, `activate_workflow_policy` and the `next_*` counters. |
| Are there correlation / request / transition IDs? | **None.** No existing identifier groups a business thread. |
| Are there metadata-redaction utilities? | **None.** |
| Are there retention or deletion policies? | **None** anywhere in the repository. |

So an application-layer "write the row, then write the event" is a **dual write by construction**: a crash
between the two produces a committed business fact with no event. `audit_log` already lives with that
risk. A timeline consumers are told to trust must not inherit it.

**Emission therefore lives in the database.** Two patterns, and only two.

---

## 2. Transactionality matrix

| Action | Write path today | Pattern | Emitted? |
|---|---|---|---|
| Dossier opened / status change / closed | `.insert` / `.update` on `operational_file` | **B — trigger** | ✅ |
| Document uploaded / verified / rejected | `.insert` / `.update` on `document` | **B — trigger** | ✅ |
| Customs record created, status, declaration, BAE, release | `.update` on `customs_record` | **B — trigger** | ✅ |
| Transport planning, status ladder, driver assign/unassign | `.update` on `transport_record` | **B — trigger** | ✅ |
| Task created / completed / cancelled | `.insert` / `.update` on `task` | **B — trigger** | ✅ |
| Invoice issued | `.update` on `invoice` | **B — trigger** | ✅ |
| Payment recorded | `.insert` on `payment` | **B — trigger** | ✅ |
| Policy activated / retired | `activate_workflow_policy` RPC | **A — RPC** | ✅ |
| Handoff sent / received | app-layer multi-write across `task` + notifications | — | ❌ **reserved** |
| Expense visa recorded | app-layer multi-write (`expense_visa` + attempt CAS) | — | ❌ **reserved** |
| Document shared with client | app-layer portal flag | — | ❌ **reserved** |
| Admin override / workflow reversal | no single domain transition | — | ❌ **reserved** |

**Reserved** means the *type name* is fixed in the registry but **nothing writes it**. Per WES-9J: fewer
trustworthy events beat broad unreliable coverage. When those write paths become transactional, emission
is added — not a new vocabulary.

### 2.1 Event classification

Every integrated event is **mandatory**; the ledger holds no observational class. "Atomicity proven"
names the check in `supabase/tests/rls_business_events_test.sql` or `tests/business-events.test.ts`.

| Event type | Source domain | Class | Emission | Failure behaviour | Atomicity proven |
|---|---|---|---|---|---|
| `DOSSIER_OPENED` | `operational_file` insert | mandatory | trigger | rolls back the dossier insert | `insert_rolls_back_when_event_fails` |
| `DOSSIER_STATUS_CHANGED` | `operational_file` status | mandatory | trigger | rolls back the status change | `update_rolls_back_when_event_fails` |
| `DOSSIER_CLOSED` | status → `CLOSED` | mandatory | trigger | rolls back the closure | `update_rolls_back_when_event_fails` |
| `DOCUMENT_UPLOADED` | `document` insert | mandatory | trigger | rolls back the upload row | shared handler, `re-raises from every single handler` |
| `DOCUMENT_VERIFIED` | status → `APPROVED` | mandatory | trigger | rolls back the verification | shared handler |
| `DOCUMENT_REJECTED` | status → `REJECTED` | mandatory | trigger | rolls back the rejection | shared handler |
| `CUSTOMS_RECORD_CREATED` | `customs_record` insert | mandatory | trigger | rolls back the record | shared handler |
| `CUSTOMS_STATUS_CHANGED` | `customs_record` status | mandatory | trigger | rolls back the transition | shared handler |
| `CUSTOMS_DECLARED` | status → `DECLARED` | mandatory | trigger | rolls back the declaration | shared handler |
| `BAE_RECORDED` | `bae_reference` null → set | mandatory | trigger | rolls back the BAE write | shared handler |
| `CUSTOMS_RELEASE_COMPLETED` | status → `RELEASED` | mandatory | trigger | rolls back the release | shared handler |
| `TRANSPORT_PLANNING_CREATED` | `transport_record` insert | mandatory | trigger | rolls back the record | shared handler |
| `TRANSPORT_STATUS_CHANGED` | `transport_record` status | mandatory | trigger | rolls back the transition | shared handler |
| `TRANSPORT_PLANNED` / `PICKUP_CONFIRMED` / `TRANSPORT_STARTED` / `DELIVERY_COMPLETED` / `POD_RECEIVED` | status milestones | mandatory | trigger | rolls back the milestone | shared handler |
| `DRIVER_ASSIGNED` / `DRIVER_UNASSIGNED` | `driver_name` null ⇄ set | mandatory | trigger | rolls back the assignment | shared handler |
| `TASK_CREATED` | `task` insert | mandatory | trigger | rolls back the task | `insert_rolls_back_when_event_fails` |
| `TASK_COMPLETED` | status → `DONE` | mandatory | trigger | rolls back the completion | shared handler |
| `TASK_CANCELLED` | status → `CANCELLED` | mandatory | trigger | rolls back the cancellation | shared handler |
| `INVOICE_ISSUED` | status → `ISSUED` | mandatory | trigger | rolls back the issuance | shared handler |
| `PAYMENT_RECORDED` | `payment` insert | mandatory | trigger | rolls back the payment | shared handler |
| `POLICY_ACTIVATED` / `POLICY_RETIRED` | `activate_workflow_policy` | mandatory | RPC | RPC raises; activation rolls back | `emits policy activation inside the existing atomic RPC` |
| **`DOSSIER_POLICY_PINNED`** | — | — | — | **NOT EMITTED — atomic path unavailable** | no instance-creation path pins yet |
| **`HANDOFF_SENT` / `HANDOFF_RECEIVED`** | — | — | — | **NOT EMITTED — atomic path unavailable** | app-layer multi-write |
| **`EXPENSE_AUTHORIZED`** | — | — | — | **NOT EMITTED — atomic path unavailable** | app-layer multi-write |
| **`DOCUMENT_SHARED_WITH_CLIENT`** | — | — | — | **NOT EMITTED — atomic path unavailable** | app-layer portal flag |
| **`ADMIN_OVERRIDE_EXECUTED` / `WORKFLOW_REVERSED`** | — | — | — | **NOT EMITTED — atomic path unavailable** | no single domain transition |

Additional guarantees proven in SQL against persisted rows: a **domain** failure writes no event
(`domain_failure_writes_no_event`); a **retry** of the same status appends no duplicate
(`retry_appends_no_duplicate`); a **cross-tenant** event failure rolls the domain mutation back
(`cross_tenant_event_rolls_back_domain`); an aborted action leaves no partial event
(`no_orphan_event_after_rollback`); the caller receives `EF001`, not internals
(`failure_uses_safe_error_code`).

Types for features that **do not exist yet** (internal document generation → WES-4, transport order
generation and missions → WES-6, assignment history → WES-3) are **absent entirely**. Naming them now
would be vocabulary for behaviour nobody has written.

---

## 3. Mandatory-event atomicity (Model A)

> **Mandatory business events are part of the domain transaction. Failure to append the event aborts the
> domain change.**
>
> **Observational telemetry is outside this authoritative ledger** and may use separate best-effort
> mechanisms. Nothing observational is permitted in `business_event`.

**Every event in this ledger is mandatory.** There is no second class. The test is simple: if a signal is
not worth aborting the business action for, it does not belong here. Page views, report downloads,
notification delivery and UI interaction have no type in the registry and never will.

The WES-9D caution against "a trigger on every table" is respected precisely:

- Triggers fire on **explicit, enumerated transitions only**. An arbitrary column edit emits nothing —
  the RLS suite proves it by editing `priority` and asserting zero new events.
- A status moving to an unlisted value emits only the generic `*_STATUS_CHANGED` fact, never an invented
  milestone.
- An emission failure **aborts the domain mutation**. An AFTER trigger that raises aborts its statement
  and transaction, so the domain row and its event commit together or not at all.

Each handler logs the underlying cause for operators and then **re-raises**, carrying SQLSTATE `EF001`
and a message safe to show a user — a raw constraint error would otherwise reach the client through
PostgREST. The handler exists only to sanitise and preserve the diagnostic; removing it entirely would
also roll back correctly. It can never permit the write.

> ### Correction, 2026-07-27 (WES-9A)
>
> Migration `20260726000004` as first shipped wrapped every emission in
> `exception when others then raise warning …; return null`. A failed append became a log line and the
> domain write **committed anyway** — Model B, and a direct violation of ADR-WES-014, which forbids
> best-effort event writes by name. The tests shipped alongside it *asserted* the swallowing, which
> locked the defect in. Migration `20260727000001` replaces all seven functions and the tests now prove
> rollback against persisted rows. Migration 62 is left in place as the historical record; it is not
> edited, because this repository has a known ledger/schema history gap (Phase 9.0F) and no
> environment's applied state can be asserted remotely.

**Actor resolution.** PostgREST's per-request transactions mean an app-set `set_config` GUC cannot reach
the trigger, and the service role's `auth.uid()` is NULL. Actor comes from the row's **own actor columns**
(`created_by`, `uploaded_by`, `reviewed_by`, `assigned_by`, `recorded_by`, `issued_by`) — data the domain
already commits atomically with the fact.

Where the schema records **no** actor for a transition, actor is **NULL**. `task` has `assigned_to` and
`created_by` but nothing recording who marked it done, so `TASK_COMPLETED` carries no actor. Naming the
assignee would be an inference presented as a fact. WES-3 is where that becomes knowable.

---

## 4. Envelope

| Field | Meaning |
|---|---|
| `event_type`, `event_domain`, `event_version` | Closed vocabulary, mirrored in `lib/workflow/events/types.ts`. Consumers dispatch on **type + version**. |
| `source` | `db_trigger` · `policy_rpc` · `app_action` — how much the row can be trusted, recorded on the row. |
| `dossier_id` | The dossier, when there is one. Config-scope events have none. |
| `subject_type`, `subject_id` | The row the event is about. |
| `actor_user_id` | NULL means *the domain does not record who did this*. Never a stand-in. |
| `correlation_id`, `causation_id` | Thread grouping and cause linkage. |
| `metadata` | Identifiers and status codes only (§5). |
| `policy_version_id`, `policy_provenance` | Which WES-7 policy governed the dossier at that moment. |
| `occurred_at` | When the fact's transaction committed. |

**No foreign keys except `tenant_id`, actor, causation and policy.** `document`, `customs_record`,
`transport_record`, `task` and `invoice` all reference `operational_file` with `ON DELETE CASCADE`. A FK
from an event to any of them would make history deletable through a cascade — the one thing an immutable
ledger may never permit. `dossier_id` and `subject_id` are plain uuids: they point, they do not bind. The
RLS suite hard-deletes a document and asserts its event survives.

**Correlation** is the dossier. Dossier-scoped work already has a business thread and every module knows
its id; minting a parallel identifier nothing else can join on would add a column and no capability. Where
a genuine cause exists it is linked: a `POLICY_RETIRED` carries the `POLICY_ACTIVATED` that caused it.

---

## 5. Metadata contract — the privacy boundary

> **Identifiers and status codes only. Never free text, never money, never personal data, never file
> content, never a row snapshot.**

An event ledger is immutable and long-lived: anything copied into it can never be corrected, redacted or
deleted. Enforced three ways, deliberately overlapping:

1. a **per-type allow-list** — an unknown key is *rejected*, not dropped, so mistakes surface at the call site;
2. a **deny-list** of key names (`amount`, `email`, `phone`, `notes`, `reason`, `storage_path`, `password`, …)
   that catches a future type declaring a dangerous key by accident — a test asserts no registry type violates it;
3. **value constraints** — scalars only, ≤120 chars, ≤12 keys, ≤2 KB, no nesting.

Three concrete exclusions, each tested in SQL against real data:

- **`payment.amount` is not copied.** Not because it is secret, but because an immutable second copy of a
  financial figure can drift from the ledger it was copied from and can never be corrected. `payment`
  stays authoritative; the event says a payment was recorded and points at it.
- **`document.review_note` is not copied.** Free text about a person's work, unredactable forever.
- **`driver_name` / `driver_phone` are not copied.** `DRIVER_ASSIGNED` carries *no* metadata at all; it
  states that an assignment happened.

Validation is **fail-closed** and returns nothing on any error, so a caller cannot persist a
partially-scrubbed object. A rejection never blocks the business action.

---

## 6. Immutability, RLS, and the client-safe projection

- **Append-only for every role, service role included** — `prevent_mutation()` on UPDATE and DELETE, the
  same guard the other append-only ledgers use. No correction path, no soft delete, no admin escape hatch.
  A wrong event is corrected by appending, exactly as with a real ledger.
- **One insertion path**: `emit_business_event()`, security definer, revoked from `public`. The typed
  client declares `Insert: never` / `Update: never`, so an application-side insert is not merely
  discouraged — it is unrepresentable in TypeScript.
- **RLS is SELECT-only.** There is no authenticated INSERT/UPDATE/DELETE policy at all. Dossier events
  defer to `can_read_file(dossier_id)` — the dossier's *existing* visibility rule, not a second weaker
  copy. Config-scope events require `admin:config:manage`.
- **Portal users get no policy.** The customer feed is a server-side **projection over an allow-list**,
  never a relaxed row filter. A filter ("hide the ones marked internal") leaks every type someone forgets
  to classify; an allow-list omits them by default, so the failure mode of forgetfulness is a missing row
  rather than a disclosure. The projection also drops actor, metadata, subject, source and policy —
  a customer sees *what* happened and *when*, never who did it internally.

**Client-safe:** dossier opened/closed · document received/verified · customs declared · release obtained ·
transport planned · pickup confirmed · transport started · delivery completed · POD received · invoice
issued · payment recorded.
**Never client-safe:** every status-changed fact, document rejection, BAE, driver assignment, all task
events, all policy events.

---

## 7. Relationship to `audit_log`

They answer different questions and neither replaces the other.

| | `audit_log` | `business_event` |
|---|---|---|
| Question | *Who touched what, and was it allowed?* | *What happened to this shipment?* |
| Audience | security review, incident response | operators, and eventually customers |
| Scope | every privileged action, including reads and failures | committed business facts only |
| Guarantee | best-effort app-layer write | commits with the fact, or not at all |

`audit_log` is untouched by this phase: not modified, not migrated, not read, not written.

---

## 8. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3586 passed / 164 files** (70 in `tests/business-events.test.ts`) |
| Production build | compiled |
| SQL/RLS suites | **50** wired in CI (was 49) — `rls_business_events_test.sql`; WES-9A strengthens it in place |
| Seed idempotency | **unchanged** — `supabase/seed.sql` not modified |
| Migration clean replay | CI gate (no Docker locally — Phase 8.0A) |

Six migration-pin assertions from earlier phases and `lib/platform/ops/build-info.ts` were updated in
lockstep, which is what those pins exist to force.

---

## 9. Retention — UNCONFIGURED

**There is no retention policy, no purge job, no archival tier, and nothing is scheduled.** This is a
recorded decision, not an oversight:

- the repository has **no existing retention policy for any table** — inventing one here would set
  platform-wide precedent from inside a feature phase;
- events reference dossiers whose own legal retention obligations are **not yet established** for this
  business;
- a destructive job against an immutable ledger is the single most dangerous thing this phase could ship,
  and WES-9M explicitly forbids it.

The ledger grows without bound until retention is ratified as its own decision. A test asserts the
migration contains no cron schedule, no `delete from`, and no purge function.

---

## 10. Known limitations

0. **The structural SQL tests strip `--` comments.** The first version of these assertions read raw
   SQL, so a migration header that *quoted* the anti-pattern under test satisfied the test about the
   code. `sqlCode()` now strips SQL line comments for every structural check — the same self-matching
   class this project has hit before.
1. **Coverage is partial and the UI says so.** Handoffs, expense visas and document sharing are real
   features that emit nothing, because their write paths cannot yet guarantee the event. The timeline
   footnote states this rather than letting an operator read an incomplete list as the whole story.
2. **`TASK_COMPLETED` has no actor** — the schema does not record who completed a task.
3. **No historical backfill.** Events before this migration were never recorded and are not invented.
   `HISTORICAL_EVENTS_NOT_BACKFILLED` exists in the registry as the honest marker, reserved.
4. **Platform-default policy activations are not emitted.** `business_event.tenant_id` is NOT NULL, and
   attributing a platform-wide change to one arbitrary tenant would be false. Those stay recorded in
   `workflow_policy_version`, which is already immutable.
5. **No external broker, no subscriptions, no event sourcing.** The ledger is a table other code may read.
   Nothing publishes, nothing replays state from it, and no aggregate is rebuilt from events.
6. **Rejection reasons are omitted, and this contradicts ADR-WES-014.** The ADR's privacy section
   states override and rejection reasons *are* included because governance requires them; WES-9 omits
   them (DEC-B73) because an immutable table can never redact staff-authored free text. Both positions
   are defensible and they conflict. **Flagged, not silently resolved** — a ratification decision is
   required before WES-4 depends on reasons being present.
7. **Several ratified envelope fields are not implemented** — `actor_role_at_time`,
   `responsible_department`, `process_instance_id`, `step_execution_id`, `override_marker`,
   `override_reason`. They belong to WES-3/4/5; writing them now would freeze values no subsystem
   computes.
8. **A trigger emits with the row's actor, which is the row's *last* actor.** For a status change the
   emitting actor is inferred from the column the domain updated in the same write (`reviewed_by`,
   `assigned_by`). Where the domain does not update an actor column alongside the status, the value is
   whatever was last written — an accepted imprecision, and the reason `source` is recorded on every row.
