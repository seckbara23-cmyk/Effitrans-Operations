# Executive Intelligence Dashboard — Acceptance (Phase 7.7)

## Definition of Done

| Requirement | Status | Evidence |
|---|---|---|
| No duplicated operational logic | ✅ | reader runs no lifecycle/risk/SLA/finance calc and queries no table (test) |
| No duplicated state machines | ✅ | no `getDossierLifecycle`/`assessRisk`/`classifySla`/`stageDuration` in `lib/executive` (test) |
| 100% composed from existing modules | ✅ | 9 composed readers; the only new reads are the 3 documented gap-readers |
| Read-only | ✅ | no form/action/mutation on the page (test); only the audit row is written |
| Server rendered | ✅ | no `"use client"` on the page; `force-dynamic` (test) |
| CI green | ✅ | 128 files / 2238 tests pass (incl. all pre-existing suites) |
| Typecheck clean | ✅ | `tsc --noEmit` exit 0 |
| Build clean | ✅ | `next build` compiled; `/dashboard/executive` + `/api/executive/copilot` registered |
| Executive AI fully provider-neutral | ✅ | only `runCopilotDetailed`; no `@/lib/ai`, no provider name (test) |
| Aggregate map reuses the existing projection engine | ✅ | `toShipmentProjection` → `ShipmentMapLoader`; `classifyFreshness` reused; no Leaflet/mapbox import in the reader (test) |
| Every KPI traceable to an authoritative source | ✅ | `ExecutiveKpi.source` ∈ `KPI_SOURCES` + `href`; a figure with no source cannot be represented (test) |

## Test coverage — `tests/executive-dashboard.test.ts` (76 tests)

**Pure:** severity normalization (both vocabularies, 1:1, unknown token neither dropped nor
promoted, `sourceSeverity` retained, no scoring in compose); alert dedupe/order-by-level-then-age/
bounding; timeline newest-first, undated dropped, deduped, bounded; map adapter preserves
status/freshness/confidence/source and maps kinds; bounds over real markers only; KPI traceability
(null → `—`, never `0`); rate-over-zero is null not 0 %; 10 card kinds grounded and cited;
Missing ≠ Negative; empty snapshot invents nothing; **no card title claims a trend**; no suggested
action points at a nonexistent workspace; prompt guardrails; shared-budget reuse.

**Structural:** composition-only reader (no domain calc, no table query, no admin client),
permission gate, degrade-by-section, financial withheld without `finance:read`, request-cache,
no provider call, **no module imports the dashboard**; the three gap-readers are narrow/bounded/
batched with no N+1 and no writes; the AI route (gate, shared engine, cached snapshot, deterministic
fallback, safe audit); the page (server-rendered, new gate, read-only, reuses the Leaflet renderer,
audits the view but no metric, unavailable notice); every drill-down resolves to a real page;
permission wired across migration + seed + templates + nav + events and never granted to
CLIENT_USER/PARTNER_AGENT/DRIVER.

Two bugs were caught by these tests during development and fixed:
1. `DRILL.documents` pointed at `/documents`, which does not exist → now `/departments/documentation`.
2. The "Growing Delays" card title asserted a trend its own reasoning disclaimed → retitled
   "Délais opérationnels mesurés", now pinned by a test.

## Access change (deliberate — please confirm with stakeholders)

`/dashboard/executive` moved from `analytics:read` (5 roles) to `executive:dashboard:read` (3
roles). **ACCOUNT_MANAGER and FINANCE_OFFICER lose the executive dashboard** and keep `/reports`
and `/departments/management`. This is the requested narrowing ("Only: CEO, COO, Managing
Director, Executive Director, Platform Administrator"), mapped onto the roles that exist.

## Remaining external dependencies & future enhancements

1. **No COO / Managing Director / Executive Director role exists.** The registry has 23 roles and
   only `CEO` is executive-tier; `OPS_SUPERVISOR` (`MANAGER`) was used as the operating-management
   tier. Creating the three roles is a follow-up decision (touches provisioning for every tenant).
2. **ETA accuracy is not measurable.** No promised-vs-actual ETA history is stored. Reported as
   "NON MESURÉE"; the prompt forbids estimating it. Enabling it needs an ETA-history table
   (snapshot promised ETA at each change) — a schema change, deliberately out of scope.
3. **Tenant-wide "missing required documents" has no reader.** Only per-file computation exists.
   Reported `null`. A bounded reader could be added, but it would need a required-vs-approved pass
   over all files — closer to the control tower's job than the dashboard's.
4. **Warehouse and customs-office map markers cannot be sourced** — no such tables exist. Omitted
   rather than invented (port/airport coordinates are also deliberately UNSEEDED upstream, so only
   rows carrying a real position are plotted).
5. **Customer satisfaction indicators** are not reportable — the portal's `Satisfaction` component
   is UI-only with no persistence.
6. **No live provider run.** No AI provider is configured in this environment, so the executive
   copilot's `answered` path is verified structurally and by type; the deterministic fallback path
   is exercised. Same posture as 6.0G/7.6C — a staging run is an operator step.
7. **Dashboard export is registered but not implemented.** `executive.dashboard.exported` exists in
   the audit registry and `lib/reports/executive-pdf.ts` already exists for reuse; wiring an
   executive PDF export is a natural follow-up.
8. **`getControlTower` reads up to 2000 files per call.** That is the pre-existing authoritative
   reader's own bound, inherited rather than introduced here. It is the heaviest part of the page;
   if it becomes a latency problem, the fix belongs in the control tower, not the dashboard.
