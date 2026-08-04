# UT-3B — Decision Plane Emitters: Completion Report

**Date:** 2026-08-11 · **Migration:** 86 `20260810000001_decision_plane_emitters.sql`
**Commit:** `f3aa18a` · **CI: GREEN — run `30935590218`, 79+10 steps, 0 skipped, 0 failed**
**New permissions: none · New tables: none · New RPCs: none · No RPC edited**
**Governing docs:** [ut-3a-emitter-governance-audit.md](ut-3a-emitter-governance-audit.md) · DEC-B88

> **STATUS: DEPLOYED & CLOSED 2026-08-11.** Migration 86 applied, **ledger 86/86**, CI green
> with zero skipped, deployment **PASS** with **no sequencing deviation**. Independent
> verification and its stated boundary:
> [deployment-record-86.md](../releases/deployment-record-86.md).
>
> **No historical backfill occurred** — `business_event` is unchanged at ~26 rows, the same
> count verified before migration 86.
>
> **One optional operator action remains:** the `HISTORICAL_EVENTS_NOT_BACKFILLED` marker is
> not yet recorded. A gap found at verification: `recordLedgerStartMarker()` shipped with
> **no invocation surface** (UT-3B forbade UI), so the sanctioned operator path is the
> read-then-emit pair in the deployment record §3. Not recording it is a safe state.
>
> **UT-3C has not begun.**

---

## 1. Repository audit

Confirmed before any code: `emit_business_event` is SECURITY DEFINER and revoked from
public; the registry admits only `trigger | rpc | reserved`, asserted at
`business-events.test.ts:106`; therefore **same-transaction emission is reachable only from
a trigger or an RPC**, and six of the seven acts are TypeScript writes through the admin
client. That is why migration 86 exists, and it is the whole reason.

## 2. The seven approved emitters, as implemented

| Event | Mechanism (migration 86) | Fires exactly when | Dossier |
|---|---|---|---|
| `CORRESPONDENCE_RECEIVED` | `AFTER INSERT` on `ec_inbound_message`, `WHEN (new.tenant_id IS NOT NULL)` | first tenant attribution | none (prologue) |
| `HANDOFF_SENT` | `AFTER INSERT` on `process_handoff` | a handoff is sent | via `process_instance.file_id` |
| `HANDOFF_RECEIVED` | `AFTER UPDATE`, `WHEN (old.status IS DISTINCT FROM 'RECEIVED' AND new.status = 'RECEIVED')` | ownership is acknowledged | via `process_instance.file_id` |
| `DOCUMENT_SHARED_WITH_CLIENT` | `AFTER UPDATE` on `document`, false → true only | a document becomes customer-visible | `document.file_id` |
| `EXPENSE_AUTHORIZED` | `AFTER UPDATE` on `expense_authorization`, → `APPROVED` **and `file_id IS NOT NULL`** | the visa chain completes | `expense_authorization.file_id` |
| `DOSSIER_POLICY_PINNED` | `AFTER INSERT` on `process_instance`, `WHEN (new.policy_version_id IS NOT NULL)` | a dossier is put under a policy version | `process_instance.file_id` |
| `HISTORICAL_EVENTS_NOT_BACKFILLED` | **app-level** (`lib/workflow/events/ledger-marker.ts`) | the statement **is** the act | none (tenant) |

`ADMIN_OVERRIDE_EXECUTED` and `WORKFLOW_REVERSED` remain reserved. Their acts do not exist,
and an emitter without an act fabricates history (ADR-UT3-1).

## 3. Two design corrections found while building

Recorded because both invalidate something I had previously written down:

1. **`DOSSIER_POLICY_PINNED` is not an RPC edit.** My stop report proposed modifying
   `activate_workflow_policy`. That RPC performs *tenant-scope* activation and already
   emits `POLICY_ACTIVATED`; a **dossier's** policy is pinned when its `process_instance`
   row is created. So it is a trigger like the rest — and **migration 86 edits no RPC at
   all**, making it smaller than the shape approved.
2. **Correspondence needs one trigger, not two.** I built a second trigger for
   `UPDATE NULL → tenant`, assuming quarantined mail could later be released. **CI proved
   that branch unreachable**: EC-1 puts `prevent_mutation` on `ec_inbound_message` and no
   code path updates it, so quarantine is terminal. The trigger was removed rather than
   left as a permanently-dead branch, and the suite now asserts the *reason* — it attempts
   the release and requires refusal. On an immutable capture table, "first tenant
   attribution" and "capture with a tenant" are the same instant, always.

## 4–5. Correspondence and handoffs

Correspondence means *"this correspondence now belongs to this tenant"*, never *"an email
arrived"*. `business_event.tenant_id` is NOT NULL, so an unattributed message cannot be
evented at all — which is the truth, not a limitation. It never fires on quarantine,
discard, or triage.

Handoffs emit on **ownership transfer only**: an INSERT for the send, and the exact
transition into `RECEIVED` for the acknowledgement. Sending and acknowledging are two facts
by two actors, so they are two events. A reassignment-shaped update — any other column, any
other status — emits nothing, proven in the suite.

## 6. Finance visibility review

`EXPENSE_AUTHORIZED` is **scoped to dossier-linked expenses**, per the unresolved
RATIFY-UT3-2. `expense_authorization.file_id` is nullable (DEC-C15 allows a general
administrative expense), and such an event would match **no branch** of the `business_event`
SELECT policy — invisible even to Finance. **No policy was widened to make an event
visible.** The `WHEN` clause is the single place that changes when RATIFY-UT3-2 is answered,
and the suite asserts the dossier-less case emits nothing.

## 7. Road adapter

Unchanged from UT3-ROAD Option C: Observation Plane only, `confidence: null`, provenance
preserved, nothing copied into `business_event`, consumed only through the UT-2 adapter.

## 8. Security review

Append-only ledger intact (`prevent_mutation` untouched) · subject-based visibility
unchanged · no permission created or referenced · **no RLS policy added or altered** ·
SYSTEM_ADMIN unchanged · metadata restricted to each type's registry allow-list
(`message_id`/`mailbox_id`, `from_step`/`to_step`, `type_code`, the status transition,
`provenance`, `ledger_started_at`) · `audit_log` untouched.

## 9. Files changed

**New:** migration 86 · `lib/workflow/events/ledger-marker.ts` ·
`supabase/tests/rls_decision_plane_emitters_test.sql`.
**Modified:** `lib/workflow/events/types.ts` (7 entries `reserved` → `trigger`/`rpc`) ·
`lib/platform/ops/build-info.ts` (86) · `ci.yml` · 5 test files whose markers UT-3B
legitimately falsified.

## 10. Tests

**Local: 204 files / 5077 tests green · tsc 0.** The emitters suite proves in real
PostgreSQL: each emitter fires exactly once; quarantined capture is silent; a
quarantine release is impossible; a non-ownership update is silent; un-share and re-save
emit nothing; a dossier-less expense is silent; every event carries its dossier; **and
nothing survives `ROLLBACK`**, which is the direct proof that no emitter wrote out of band.

**The WES-9 guard was rewritten, not deleted.** It kept four types reserved because they
were app-layer multi-writes; that reason is gone. What remains reserved is the stronger
claim that two acts do not exist — now pinned as **exactly two**, so no future phase can
quietly park a third there.

### 10.1 Three CI rounds, and what they say

| Run | Failure | Kind |
|---|---|---|
| `30933922358` | `UPDATE is not permitted on ec_inbound_message` | **design defect** — the unreachable trigger (§3.2) |
| `30934636661` | `document.storage_path` NOT NULL | fixture |
| `30934923041` | `expense_authorization.amount` NOT NULL | fixture |

The first was worth having. The second and third were not: I verified the *trigger*
contracts meticulously and the *fixture* contracts not at all. After the third I stopped
iterating against CI and checked **every** INSERT against its table's required columns
(NOT NULL, no default) in one pass — eleven statements, zero gaps. That check should have
run before the first push.

## 11. Deployment implications

Migration 86 is **not applied**. Applying it is safe and additive: it creates six trigger
functions and six triggers and nothing else. From the moment it lands, the seven event
types begin appearing in the ledger for **new** acts only — **no backfill, no history
rewritten**.

Verification after application:
1. six trigger functions exist (`emit_correspondence_received`, `emit_handoff_sent`,
   `emit_handoff_received`, `emit_document_shared`, `emit_expense_authorized`,
   `emit_dossier_policy_pinned`);
2. six triggers exist on their five tables;
3. `business_event` gains no row from the migration itself;
4. ledger reads **86/86**.

The ledger marker (`recordLedgerStartMarker`) is an **operator action**, not part of the
migration, and should be run **after** the emitters are live so its statement is true.

## 12. Remaining UT-3C work

| Ref | Item |
|---|---|
| **RATIFY-UT3-2** | dossier-less expenses: scope the emitter (today's behaviour) or add a finance-prologue visibility branch (a migration) |
| RATIFY-UT3-3 | confirm `DOCUMENT_SHARED_WITH_CLIENT` as customer-visible |
| RATIFY-UT3-4 | may `DELAY_REPORTED` / `INCIDENT_REPORTED` ever enter the timeline (they carry prose)? Default: no |
| Ledger marker | run once per tenant after deployment |

## 13. Readiness for UT-4

**Ready.** UT-4 (the timeline surface) consumes `readUnifiedTimeline` unchanged; the new
events appear automatically because the reader dispatches on the registry, not on a list.
UT-4 must render `chronologyGroup` as simultaneity and `confidence` as confidence.

---

## Confirmations

* **Exactly seven emitters implemented.**
* **`ADMIN_OVERRIDE_EXECUTED` remains intentionally reserved.**
* **`WORKFLOW_REVERSED` remains intentionally reserved.**
* **Migration 86 contains only transactional infrastructure** — six trigger functions and
  six triggers; no table, event store, permission, RLS policy, index, column, backfill,
  scheduler or worker, and no RPC was edited.
* **No new business capability was introduced** — every act already existed and already
  committed.
* **No new event store · no synchronization engine · no copied history · no fabricated
  chronology.**
* **`audit_log` unchanged.**
* **Decision Plane remains append-only.**
* **Unified Timeline architecture unchanged.**
* **UT-3C has not begun.**
