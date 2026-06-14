# Effitrans Operations Platform — Engineering Backlog

> Implementation-discovered tech-debt and deferred optimizations. This is **not**
> a governance document — it does not change requirements or decisions. Business,
> architecture, and security decisions live in the authoritative
> [decision-register.md](decision-register.md); scope/sequence lives in
> [phase-1-roadmap.md](phase-1-roadmap.md).
>
> Each item records: what, why deferred, the trigger that should promote it, the
> proposed fix, and rough effort. Add a dated row; never silently delete — mark
> `Done` with the commit when resolved.

---

## Open items

### EB-001 — Push `/files` search/filter/sort down to SQL
- **Status:** Open · logged 2026-06-14 (during Phase 1.4 review)
- **Area:** `lib/files/service.ts` (`listFiles`), `lib/files/filter.ts`
- **Current behavior:** `listFiles` fetches the tenant's operational files (capped
  at **2,000 rows**) and applies search / filter / sort **in application code**
  via the pure `lib/files/filter.ts` module. Correct and fast at current volume;
  deliberately FTS-free per the Phase 1.4 spec.
- **Why deferred:** in-app filtering keeps the logic pure and unit-testable, and
  tenant file counts are well under the cap today.
- **Trigger to promote:** any tenant's `operational_file` count approaches
  **~2,000 rows** (set an alert at 1,500), or the `/files` page p95 latency rises.
- **Proposed fix:** move the structured filters (`status`, `type`, `priority`,
  `client_id`, `transport_mode`, `mine`) to DB `.eq()` predicates and the search
  to a SQL `ILIKE`/`pg_trgm` (or `tsvector`) query — likely a `view` or RPC that
  flattens file + client + shipment so the OR-search is expressible server-side.
  Keep `lib/files/filter.ts` for unit tests / small sets. Add pagination.
- **Effort:** M (1 migration for index/view + service rewrite; UI unchanged).

### EB-002 — Push dashboard file KPI aggregation down to SQL `GROUP BY`
- **Status:** Open · logged 2026-06-14 (during Phase 1.5 review)
- **Area:** `lib/files/service.ts` (`getFileOverview`), `lib/files/aggregate.ts`
- **Current behavior:** `getFileOverview` fetches up to **10,000** tenant file
  rows (status, priority, shipment.transport_mode, shipment.eta) and aggregates
  counts + status/mode breakdowns **in application code** via the pure
  `lib/files/aggregate.ts` module, on every dashboard load.
- **Why deferred:** the aggregation is pure and unit-tested, and current volumes
  make a full-scan-per-load negligible.
- **Trigger to promote:** any tenant's `operational_file` count approaches
  **~10,000 rows** (alert at 7,500), or dashboard TTFB regresses.
- **Proposed fix:** replace the row fetch with SQL aggregate queries
  (`select status, count(*) … group by status`; same for `transport_mode`; plus
  scalar counts for high/critical priority and overdue shipments), or a cached
  materialized view / RPC refreshed on write. Keep `aggregate.ts` for tests.
  Consider `count` head queries instead of fetching rows.
- **Effort:** S–M (service rewrite; optional 1 migration for an RPC/view; UI
  unchanged since it already consumes `FileOverview`).

---

## Resolved items
_(none yet)_
