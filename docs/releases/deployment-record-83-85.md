# Deployment Record — Migrations 83, 84, 85 (EC-3C · EC-3D · UT-1)

**Date:** 2026-08-09 · **Production:** `xtpppzhkiagdpmnghdlc` · **Ledger: 85/85**
**Verdict: PASS** · **Sequencing deviation: none** — all three applied after CI was green.

| # | Migration | Phase |
|---|---|---|
| 83 | `20260807000001_commercial_activation.sql` | EC-3C |
| 84 | `20260808000001_commercial_conversion.sql` | EC-3D |
| 85 | `20260809000001_decision_plane_ordinal.sql` | UT-1 |

---

## 1. CI gates — satisfied before application

| Phase | Run | Jobs | Skipped | Failed |
|---|---|---|---|---|
| EC-3C | `30773158495` | build + rls-tests (76+10) | **0** | **0** |
| EC-3D | `30774583748` | build + rls-tests (77+10) | **0** | **0** |
| UT-1 | `30912513643` | build + rls-tests (78+10) | **0** | **0** |

Each phase's own isolation suite executed **by name** and passed. No migration was applied
while its suite was unproven — the DEV-HR6-01 exposure, avoided three times running.

## 2. Independent verification (performed by Claude, not read from the report)

Environment constraints unchanged: **no Docker** (so `supabase db dump` is unavailable),
**no `psql`**, no service-role key. Verification used the CLI's direct-connection commands.

| Check | Method | Result |
|---|---|---|
| Ledger completeness | `migration list --linked`, parsed | **85 entries**; **0** local-only, **0** remote-only, **0** mismatched |
| Last entry | same | `20260809000001` |
| 83 / 84 / 85 each recorded | same | all three `local == remote` |
| No local file unapplied | 85 `.sql` files cross-checked | **0 unapplied** |
| **Migration 85 objects** | `inspect db index-stats` | `idx_business_event_dossier_order` **PRESENT** · `idx_business_event_tenant_order` **PRESENT** |
| **Migration 84 objects** | same | `idx_client_notification_quotation` **PRESENT** |
| Nothing destroyed | same | pre-existing `idx_business_event_dossier`, `idx_business_event_tenant_time`, `uq_quotation_one_live_version` all still present |
| Probe not credulous | same | negative control **absent** |
| Commercial still dark | `inspect db table-stats` | `quotation_request` / `quotation` / `quotation_line` / `quotation_counter` — all present, **0 rows** |
| Ledger populated | same | `business_event` ≈ **26 rows** (pre-existing history) |
| Application | `GET /api/version` | **`19c75b1`** — current `main` HEAD |

### 2.1 What was NOT independently verified, and why

Stated as a boundary rather than glossed, because a deployment report is not evidence:

* **The grant matrix and the `= 0` counts** (EC-3C) — row data; this environment cannot run
  arbitrary SQL.
* **Policy text** — the corrected `business_event_select` and the three widened quotation
  SELECT policies are schema, reachable only through `db dump`, which needs Docker.
* **Migration 85's column, sequence and trigger** — `business_event.ordinal`,
  `business_event_ordinal_seq`, `trg_business_event_ordinal`.
* **Migration 83 has no directly observable object from here at all** — it creates grants
  and policies but no index or table, so the ledger entry is the only evidence available
  outside the database.

Two things make the reported state consistent with everything verified: migrations run
transactionally, so a recorded migration's statements committed as a unit; and both of the
migrations that *do* create observable objects have them present, in the right database,
alongside untouched pre-existing ones.

### 2.2 The one check the operator should still run

Migration 85 was designed to **backfill nothing**. `business_event` holds ≈26 rows, all of
which predate the ordinal, so:

```sql
select count(*) filter (where ordinal is null) as pre_ordinal,
       count(*)                                as total
  from public.business_event;
```

**`pre_ordinal` must equal `total`** until the next event is emitted. That is the direct
proof that no historical row was given a synthesised position and no chronology was
invented. Any new event emitted after application will carry an ordinal, and from then on
`pre_ordinal` stays frozen at 26 forever.

## 3. Activation state after deployment

| Item | State |
|---|---|
| Commercial tables | present, **0 rows** |
| Quotation authorities | granted per **DEC-C32** to QUOTATION_MANAGER / OPS_SUPERVISOR; **SYSTEM_ADMIN holds none** |
| Commercial workspace | reachable by holders of the two roles |
| Conversion | code live; **cannot be performed by anyone** until a seat holds both authorities (SEATS-CONVERT) |
| Decision Plane ordinal | live for **new** events; historical rows remain `NULL` by design |
| Prologue visibility | now follows the subject; SYSTEM_ADMIN **narrowed** |
| Unified Tracking | read contract only. **No UI, no cross-plane merge** |

## 4. Operator work remaining

**None.** All three migrations are applied, the ledger is reconciled at 85/85, the history
repair used the sanctioned history-only mechanism, no replay occurred, and the application
already serves the matching commit.

Everything still open is **management**, not operator — see §5 of
[STATUS.md](STATUS.md) and the two seat blockers, which are decisions about people rather
than engineering.
