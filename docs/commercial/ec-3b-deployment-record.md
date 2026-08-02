# EC-3B — Deployment Record

**Date:** 2026-08-06 · **Production:** `xtpppzhkiagdpmnghdlc` · **Ledger: 82/82**
**Migration:** 82 `20260806000001_commercial_quotation.sql` · **Verdict: PASS**
**Sequencing deviation: none** — applied after CI was green (contrast DEV-HR6-01).

---

## 1. CI gate — satisfied before application

Run **`30769464325`**, commit **`b735bb7`**:

| Job | Conclusion | Steps | Skipped | Failed |
|---|---|---|---|---|
| `build` | **success** | 10 | **0** | 0 |
| `rls-tests` | **success** | **75** | **0** | **0** |

Confirmed **by name**, per step rather than inferred from the job summary:
`Run EC-1 inbound email isolation test` — success ·
`Run EC-2 triage outcomes isolation test` — success ·
`Run EC-3B commercial quotation isolation test` — **success**.

**The EC-3B suite had never executed anywhere before this run.** It was skipped behind an
aborting step in the two preceding runs. Migration 82 was therefore *not* applied while
its isolation suite was unproven — the exposure DEV-HR6-01 recorded, avoided here.

## 2. Independent verification (performed by Claude, not read from the report)

Access constraints of this environment: **no Docker** (so `supabase db dump` is
unavailable), **no `psql`**, and no service-role key. Verification used the Supabase CLI's
direct-connection commands, which do not require Docker.

| Check | Method | Result |
|---|---|---|
| Ledger completeness | `supabase migration list --linked`, parsed | **82 entries**; **0** local-only, **0** remote-only, **0** mismatched |
| Migration 82 recorded | same | `20260806000001` present, `local == remote` |
| No local file unapplied | 82 local `.sql` files cross-checked against the ledger | **0 unapplied** |
| Migration-82 tables | `inspect db table-stats`, schema-qualified compare | `public.quotation_request`, `public.quotation`, `public.quotation_line`, `public.quotation_counter` — **all PRESENT** |
| Production is dark | same, estimated row counts | **0 rows in all four tables** |
| Probe not blind | control group `operational_file`, `permission`, `role_permission`, `business_event`, `ec_triage_item` | all PRESENT |
| Probe not credulous | negative control `public.quotation_nonexistent_xyz` | **absent**, as required |
| Deeper object than tables | `inspect db index-stats` | **`uq_quotation_one_live_version` PRESENT** (the one-live-version invariant), plus all 4 primary keys; negative control absent |
| Application version | `GET /api/version` | `b735bb7` — **the commit that removed the quotation grants from the role templates** |

**Schema-qualified comparison was used deliberately.** An earlier phase's probe reported
0/9 because it compared bare table names against a `public.x` field; the control groups
above exist so that a silent probe failure cannot be mistaken for a production alarm.

### 2.1 What was NOT independently verified, and why

The operator reports **quotation permission grants = 0** across `quotation:create`,
`:validate`, `:send`, `:approve`. **This environment cannot run arbitrary SQL against
production** (no Docker, no `psql`, no service key), so that count is **accepted from the
operator's report and not independently confirmed**. It is stated here as a boundary
rather than glossed, because the whole point of this record is that a deployment report is
not evidence.

Three things make the reported 0 consistent with everything that *was* verified:

1. Migration 82's `delete from role_permission … quotation:create/send/approve` is
   recorded as applied, and migrations run transactionally — a failed statement would
   have rolled back the file and left no ledger row.
2. `supabase/seed.sql` — the source that reinstated the grant in CI — **never runs against
   production**; it is applied only by `supabase db reset` locally and in CI.
3. `lib/platform/role-templates.ts`, which would re-grant on **new-tenant provisioning**,
   was corrected in `b735bb7`, and `/api/version` confirms production serves exactly that
   commit. **No tenant can be provisioned with the withdrawn grant.**

The standing verification query in the completion report §10 remains the operator's
instrument for re-confirming the count at any time.

## 3. Activation state — production remains DARK

* `quotation:validate` exists in the catalog and is **granted to nobody**.
* The Phase-5.0B blanket grant of `quotation:create` / `:send` / `:approve` is
  **withdrawn**, at all three sources (migration, seed, role templates).
* **No route, no navigation entry, no queue and no consumer of `lib/commercial` exists** —
  verified by search; the module is unreachable by any user.
* All four tables hold **0 rows**.

## 4. Operator work remaining

**None.** Migration 82 is applied, the ledger is reconciled at 82/82, no repair was
required, no replay occurred, and the application already serves the matching commit.

Everything still open is **management**, not operator — and as of 2026-08-06 the principal
item is answered: see **DEC-C32 / RATIFY-EC3-1** in the decision register, and
`ec-3c-implementation-brief.md` for the resulting activation plan (additive migration 83,
**not yet authorised**).
