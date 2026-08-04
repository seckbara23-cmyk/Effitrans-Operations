# UT-3B — STOP: a migration is unavoidable

**Date:** 2026-08-10 · **Status: HALTED BEFORE IMPLEMENTATION, as the brief instructs.**
**No code, no SQL, no migration, no permission, no UI was written.**

> *"No migration unless implementation proves one is absolutely required. If a migration
> becomes necessary: **STOP. Return the reason.**"*

The audit proves it. This document is the reason, the evidence, and the proposed shape —
awaiting approval before any of it is built.

---

## 1. The binding constraint

The brief requires that every emitter *"occur inside the owning transaction"* and
*"use the existing sanctioned event path"*. Those two requirements together are what force
a migration, and the platform already enforces them:

* `emit_business_event` is a SQL `SECURITY DEFINER` function, **revoked from public**. The
  only callers that share a transaction with a business act are **database triggers** and
  **SECURITY DEFINER RPCs**.
* The registry's `emission` field admits exactly `trigger` | `rpc` | `reserved`, and
  `tests/business-events.test.ts:106` asserts it for every non-reserved type:
  `expect(["trigger", "rpc"]).toContain(def.emission)`.
* **There is therefore no sanctioned application-level emission mode.** A TypeScript call
  to `rpc("emit_business_event", …)` after a write is a *second round trip* — a separate
  transaction. EC-3B hit exactly this: `QUOTATION_CREATED` was emitted from the action
  layer until the platform's own guard rejected it, and the fix was to move creation into
  an RPC. That precedent applies unchanged here.

So promoting a reserved type to emitted means writing a trigger or an RPC — **both are SQL,
both are a migration.**

## 2. Per-emitter evidence (verified, not assumed)

| # | Event | The business act | Write path, verified | Same-transaction without a migration? |
|---|---|---|---|---|
| 1 | `CORRESPONDENCE_RECEIVED` | first tenant attribution of an inbound message | `lib/ec/inbound/capture.ts:155` — `admin.from("ec_inbound_message").insert(…)` | ❌ TypeScript insert |
| 2 | `HANDOFF_SENT` | a department sends a handoff | `lib/process/engine/actions.ts:565` — `admin.from("process_handoff").insert(…)` | ❌ TypeScript insert |
| 3 | `HANDOFF_RECEIVED` | the receiving department acknowledges | `actions.ts:619` — `.update({ status: "RECEIVED", … })` | ❌ TypeScript update |
| 4 | `DOCUMENT_SHARED_WITH_CLIENT` | a document is shared | `lib/documents/actions.ts:439` — `.update({ shared_with_client: shared })` | ❌ TypeScript update |
| 5 | `EXPENSE_AUTHORIZED` | the visa chain completes (`APPROVED`) | `lib/finance/expense/actions.ts:594` — status computed in TS, then written | ❌ TypeScript update |
| 6 | `DOSSIER_POLICY_PINNED` | a policy version is pinned | `lib/workflow/policy/actions.ts:311` — `admin.rpc("activate_workflow_policy", …)` | ❌ — an RPC exists, but adding emission means `create or replace function`, which **is** a migration |
| 7 | `HISTORICAL_EVENTS_NOT_BACKFILLED` | the statement **is** the act | a single `emit_business_event` call | ✅ **the only one needing no migration** |

**Six of seven require SQL. The seventh is a one-line administrative statement that
UT-3A's own roadmap places last**, "emitted only once the others are live so it states
something true" — so shipping it alone would be the least useful sixth of the phase and
would state its claim before the claim is complete.

## 3. Two corrections to UT-3A, found by looking again

Recorded because a governance document is only worth what its next reader can trust:

1. **`DOCUMENT_SHARED_WITH_CLIENT` — UT-3A was right, but for the wrong reason.** It named
   "the sharing action in `lib/documents/actions.ts`". The act is real but is a **column
   update** (`shared_with_client`) on `public.document`, not a share record. That changes
   the migration shape: a conditional `AFTER UPDATE` trigger on a boolean transition, not
   an `AFTER INSERT` on a new table.
2. **`EXPENSE_AUTHORIZED`'s dossier-less problem is worse than R1 stated.** The status is
   decided in TypeScript (`chainComplete`) and then written, so a trigger must re-derive
   "the chain just completed" from the row transition into `APPROVED` — it cannot read the
   TS variable. That is achievable (a status-transition trigger, the pattern WES-9 already
   uses) but it is a design constraint UT-3A did not record.

## 4. Proposed migration shape — for approval, not written

One additive migration (**86**), containing only emission plumbing:

| Emitter | Mechanism | Guard |
|---|---|---|
| 1 | `AFTER INSERT` trigger on `ec_inbound_message`, **`WHEN (NEW.tenant_id IS NOT NULL)`** | quarantined mail carries `tenant_id = NULL` and `business_event.tenant_id` is `NOT NULL`, so the guard is what makes ADR-UT3-2 expressible at all |
| 2 | `AFTER INSERT` trigger on `process_handoff` | — |
| 3 | `AFTER UPDATE` trigger on `process_handoff`, `WHEN (OLD.status <> 'RECEIVED' AND NEW.status = 'RECEIVED')` | fires on the transition, never on any other column edit |
| 4 | `AFTER UPDATE` trigger on `document`, `WHEN (OLD.shared_with_client IS DISTINCT FROM NEW.shared_with_client AND NEW.shared_with_client)` | share only, never un-share |
| 5 | `AFTER UPDATE` trigger on `expense_authorization`, `WHEN (OLD.status <> 'APPROVED' AND NEW.status = 'APPROVED')` | **scoped to dossier-linked expenses only**, pending RATIFY-UT3-2 |
| 6 | `create or replace function activate_workflow_policy` — add one `perform emit_business_event(…)` | the body is otherwise untouched |
| 7 | none | app-level administrative statement |

Also required in the same migration: **seven registry entries change `emission: "reserved"`
→ `"trigger"` / `"rpc"`** (TypeScript, not SQL, but it must land together or the guard at
`business-events.test.ts:106` fails).

**Explicitly NOT in the proposal:** no new table, no permission, no policy change, no
backfill, no touching `ADMIN_OVERRIDE_EXECUTED` / `WORKFLOW_REVERSED` (ADR-UT3-1 stands —
their acts still do not exist), and no road-adapter SQL (Option C needs none).

## 5. What is NOT blocked

**The road observation adapter (UT3-ROAD, Option C) requires no migration** and is
unaffected by this stop: it is a read-side adapter over `public.tracking_event`, carrying
`confidence: null`, consumed only through the UT-2 observation path. It can proceed
independently the moment you say so.

## 6. Decision requested

| Option | Consequence |
|---|---|
| **A — approve migration 86 as shaped above** | UT-3B proceeds; six trigger/RPC emitters + the registry flip, plus the administrative marker. RATIFY-UT3-2 must be answered first, since it decides emitter 5's scope |
| **B — approve a subset** | e.g. correspondence + handoffs first (the oldest and most-cited gaps), deferring documents/expense/policy |
| **C — proceed with the road adapter only** | no migration at all; the seven emitters wait |
| **D — hold everything** | the timeline keeps its known gaps, documented since UT-0 D2 |

---

## Confirmations

* **Zero emitters implemented** — the brief's stop condition triggered before any code.
* **No migration was added.** The reason it became necessary is §1: same-transaction
  emission is only reachable from a trigger or an RPC, and both are SQL.
* **No UI, no schema change, no permission change, no history copied, `audit_log`
  untouched.**
* **`ADMIN_OVERRIDE_EXECUTED` and `WORKFLOW_REVERSED` remain intentionally unimplemented.**
* **UT-3C has not begun.**
