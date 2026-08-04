# Deployment Record — Migration 86 (UT-3B Decision Plane Emitters)

**Date:** 2026-08-11 · **Production:** `xtpppzhkiagdpmnghdlc` · **Ledger: 86/86**
**Migration:** 86 `20260810000001_decision_plane_emitters.sql` · **Verdict: PASS**
**Sequencing deviation: none** — applied after CI was green on the exact commit.

---

## 1. CI gate — satisfied before application

Run **`30946945660`**, commit **`fe6a9ff`**:

| Job | Conclusion | Steps | Skipped | Failed |
|---|---|---|---|---|
| `build` | **success** | 10 | **0** | 0 |
| `rls-tests` | **success** | **79** | **0** | **0** |

`Run UT-3B decision plane emitters test` — **success**, confirmed by name. All seven
emitters are positively verified, including the `ROLLBACK` proof that each shares its act's
transaction.

## 2. Independent verification (performed by Claude)

Environment constraints unchanged: **no Docker**, **no `psql`**, no service-role key.

| Check | Method | Result |
|---|---|---|
| Ledger completeness | `migration list --linked`, parsed | **86 entries**; **0** local-only, **0** remote-only, **0** mismatched |
| Last entry | same | `20260810000001` |
| Migration 86 recorded | same | `local == remote` |
| No local file unapplied | 86 `.sql` files cross-checked | **0 unapplied** |
| **No historical backfill** | `inspect db table-stats` | `business_event` ≈ **26 rows — unchanged from the 83–85 verification.** Migration 86 wrote no event |
| Source tables intact | same | `ec_inbound_message`, `process_handoff`, `process_instance`, `document`, `expense_authorization` all present |

### 2.1 What was NOT independently verified, and why

**The trigger objects themselves.** Migration 86 creates six trigger functions and six
triggers and **nothing else** — no table, no index, no column — so it has *no object this
environment can observe*. `inspect db` exposes table and index statistics only; reading
`pg_trigger` needs arbitrary SQL, which requires Docker or `psql`.

This is the same boundary recorded for migration 83, and it is stated rather than glossed:
the ledger entry plus the unchanged row count are consistent with a clean application, but
they are not direct proof that the twelve objects exist.

**Operator SQL to close that gap** (read-only):

```sql
select tgname, relname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal
   and tgname in ('trg_ec_message_received_insert', 'trg_process_handoff_sent',
                  'trg_process_handoff_received', 'trg_document_shared_with_client',
                  'trg_expense_authorized', 'trg_process_instance_policy_pinned')
 order by 2, 1;                                        -- expect 6 rows

select proname from pg_proc
 where proname in ('emit_correspondence_received', 'emit_handoff_sent',
                   'emit_handoff_received', 'emit_document_shared',
                   'emit_expense_authorized', 'emit_dossier_policy_pinned');  -- expect 6
```

## 3. The ledger honesty marker — NOT yet recorded, and why

`HISTORICAL_EVENTS_NOT_BACKFILLED` is the seventh emitter. It is **not part of migration
86** and is **not yet recorded in production**.

**A gap found during this verification:** `recordLedgerStartMarker()` exists in
`lib/workflow/events/ledger-marker.ts` and is fully tested, but **nothing calls it** — no
route, no UI, no script. UT-3B forbade UI, so the action shipped without an invocation
surface. An operator therefore cannot run it from the application today.

**Sanctioned operator path.** The marker's TypeScript guard is *read-then-emit*; the same
two statements can be run directly, and they use the **same sanctioned emission path**
(`emit_business_event`) rather than bypassing it:

```sql
-- 1. Has it already been stated? A ledger has ONE beginning.
select count(*) from public.business_event
 where tenant_id = '<tenant>' and event_type = 'HISTORICAL_EVENTS_NOT_BACKFILLED';
-- If this returns > 0, STOP. Do not record a second marker.

-- 2. The boundary is dated from the EARLIEST recorded event, never from now():
--    the claim is "recorded history starts here", not "someone pressed a button today".
select public.emit_business_event(
  '<tenant>', 'HISTORICAL_EVENTS_NOT_BACKFILLED', 'ledger', 'app_action',
  'organization', '<tenant>', null, '<actor_user_id>',
  jsonb_build_object('ledger_started_at',
    (select min(occurred_at)::text from public.business_event where tenant_id = '<tenant>')));
```

**Run it only after the emitters are live** — which they now are — so the statement is true
when made. Wiring a UI control is UT-4 scope, not UT-3B.

**Not recording it is a safe state.** Nothing breaks; the timeline simply cannot yet state
its own incompleteness (ADR-UT-7), so an empty early period may read as a quiet period.

## 4. Activation state after deployment

| Item | State |
|---|---|
| Six trigger emitters | **live**, for **new acts only** |
| Historical events | **untouched** — no backfill, no rewrite (row count unchanged) |
| `HISTORICAL_EVENTS_NOT_BACKFILLED` | **not yet recorded** — operator action, §3 |
| `ADMIN_OVERRIDE_EXECUTED` / `WORKFLOW_REVERSED` | **reserved**; their acts still do not exist |
| `EXPENSE_AUTHORIZED` | dossier-linked expenses only, pending RATIFY-UT3-2 |
| Unified Timeline | reader unchanged; new events surface automatically |

## 5. Operator work remaining

**One optional action: the ledger marker (§3).** It is not required for correctness and
nothing depends on it. Everything else is complete — migration applied, ledger reconciled
at 86/86, no replay, no backfill.

The trigger-object verification query in §2.1 is *confirmatory*, not remedial.
