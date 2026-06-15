# Performance Phase P1 — Audit, Optimizations & Strategy

> Non-governance engineering doc. Pairs with [engineering-backlog.md](engineering-backlog.md)
> (EB-001/EB-002). P1 = low-risk wins now + documented strategy for the bigger
> structural changes (materialized views, archiving). No feature work.

**Status:** implemented items shipped in this phase; strategy items proposed (deferred).

---

## 1. Permission / identity resolution caching — ✅ IMPLEMENTED
**Finding:** `getCurrentUser`, `getEffectivePermissions`, and `getCurrentPortalUser`
were plain async functions. A single dossier render calls ~8 gated services
(`getFile`, `listFiles`, `listTasks`, `listDocuments`, `getCustomsRecord`,
`getTransportRecord`, `getFinanceForFile`, `listCommunicationsForFile`), each
calling `assertPermission` → **one `app_user` lookup + one `get_user_permissions`
RPC per call**. So ~8 redundant identity lookups + ~8 RPCs per page.

**Fix:** wrapped all three in React `cache()` (request-scoped memoization). One
render now resolves identity **once** and permissions **once per userId**.
Estimated DB round-trip reduction on a populated dossier page: **~16 → ~2**.
Portal pages benefit identically (layout guard + page + actions dedupe). Server
actions get the same dedupe within a single action invocation.

## 2. Database index audit — ✅ IMPLEMENTED (migration `20260615000009`)
Existing per-module indexes were already solid (tenant_id, status, file_id,
ownership columns). Gaps for the hot composite read paths, added (IF NOT EXISTS):
| Index | Serves |
|---|---|
| `audit_log (tenant_id, occurred_at desc)` | paginated audit page |
| `file_state_transition (tenant_id, to_status)` | analytics avg-closure-time |
| `operational_file (tenant_id, created_at desc)` | recent dossiers, new-per-month, analytics scans |
| `invoice (tenant_id, issue_date)` | analytics revenue-by-month / financial filters |
| `client_user (tenant_id, client_id)` | comms recipients, portal lookups |

> **Prod note:** on large tables prefer `CREATE INDEX CONCURRENTLY` (outside a
> migration transaction) to avoid write locks. At current volume, in-transaction
> creation is fine.

## 3. Audit log pagination hardening — ✅ IMPLEMENTED
Was: a single `limit(100)`, no navigation, ordered only by `occurred_at`
(unstable on ties). Now: bounded page size (`50`, max `100`), **offset
pagination** with a **stable order** (`occurred_at desc, id desc`), `hasMore`
detected by fetching `size+1` (no count query), and prev/next links on the page.
Backed by the new `(tenant_id, occurred_at desc)` index.

## 4. Portal shell optimization — ✅ IMPLEMENTED
The portal `(app)` layout guard, each portal page's `requirePortalUser`, and the
download/view actions all resolved `client_user`. `cache(getCurrentPortalUser)`
(item 1) collapses these to one lookup per render.

## 5. Dashboard query consolidation — ◻️ PROPOSED (partially mitigated)
`getFileOverview` and `getRecentFiles` both scan `operational_file` with
different projections; `getDashboardTasks` + `getFinanceKpis` add more. The
permission-cache (item 1) already removes the per-call auth overhead. **Next
step (deferred):** a single `operational_file` fetch feeding both overview +
recent (one projection, computed twice in TS), and folding `getFinanceKpis` into
the same finance round-trip used elsewhere. Low risk; do when dashboard latency
warrants.

## 6. Analytics snapshot / materialized-view strategy — ◻️ PROPOSED (EB-002)
`getAnalytics` + `getExecutiveAnalytics` aggregate live over invoices/lines/
payments/files/customs/transport/etc. per request. **Recommended structural fix
when a tenant nears ~10k files (EB-002 trigger):**
1. **`analytics_snapshot`** table (one row per tenant per day) holding the KPI
   bundle as `jsonb`, refreshed by a scheduled job (pg_cron / edge function) +
   on-demand "refresh now".
2. Or **materialized views** per aggregate (`mv_revenue_by_month`,
   `mv_status_distribution`, …) refreshed `CONCURRENTLY`.
3. The `AnalyticsData`/`ExecutiveData` **contracts stay identical** — only the
   service swaps its source. UI unchanged. The pure `calc`/`executive` modules
   remain the validation oracle.
Until then, live aggregation is acceptable and the new indexes (item 2) cover the
scans.

## 7. Lazy-load heavy analytics sections — ◻️ PROPOSED
`/analytics` awaits `getAnalytics` then `getExecutiveAnalytics` (the latter
depends on the former, so they're sequential). Options when needed: render the
KPI bands first and **stream** the executive layer + charts via `<Suspense>`
async boundaries; or move heavy aggregation behind the snapshot (item 6, the real
fix). No client-side chart library is used (CSS/SVG only), so there is no chart
bundle to defer.

## 8. Server / client component bundle audit — ◻️ FINDINGS
- **Good:** all routes are server components; client components are small
  interactive panels/rows/forms invoking server-action proxies. No chart/BI
  library, no heavy client deps. The boundary grep gate keeps service-role /
  server-only code out of the client bundle.
- **Finding:** `lib/i18n.ts` is one large object imported by many **client**
  components (`t`), so the whole translation object ships in the client bundle.
  **Recommendation (deferred):** split `t` per-namespace or pass only needed
  strings as props, so client chunks carry just their slice. Medium effort; do
  when client bundle size becomes a concern.
- **Finding:** a few orphaned mock components (`customs-explorer`, mock
  dashboard tables) remain unimported — safe to delete in a cleanup pass.

## 9. Archive strategy proposal — ◻️ PROPOSED (ties to DEC-B19 retention)
Keep operational tables lean without losing history or breaking audit/compliance.
- **Closed dossiers:** add `archived_at`; a job archives dossiers `CLOSED` > N
  months (e.g. 12) — either a boolean flag excluded from default queues, or a
  cold `operational_file_archive` table. Reads stay available; queues/analytics
  filter to non-archived by default. **Never** cascade-delete linked finance/
  customs/audit.
- **Old notifications:** `notification` rows that are read + older than ~90 days
  can be hard-deleted (low value, high volume) or moved to a cold table. The
  unread badge and recent feed are unaffected.
- **Audit logs:** **never delete** (compliance) — instead **partition by month**
  (`audit_log_YYYY_MM`) and/or move partitions older than the legal retention
  window (DEC-B19, Senegal minimum — TBD) to cheaper storage. The append-only
  triggers + RLS carry over per partition.
- **Mechanism:** all via pg_cron / a scheduled edge function (the same scheduler
  the Phase-1.6 reminders + a real comms provider will need) — **deferred** until
  that scheduler is approved.

---

## Validation
`tsc`, `vitest`, `next build`, client-boundary grep, secrets check — all green.
Behaviour unchanged; only fewer DB round-trips, better indexes, and a paginated
audit log. The migration is additive (indexes only) and CI-validated.
