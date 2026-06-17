# Phase 2.3 — SLA & Delay Monitoring

**Date:** 2026-06-17
**Goal:** add operational delay visibility + SLA monitoring on top of the control tower — derived only. No workflow engine, cron, notifications, escalation, or new status fields. Single source of truth unchanged.

**Validation:** `tsc --noEmit` clean · **234 tests** pass (+14) · `next build` succeeds · boundary + secrets checks clean.

---

## Deliverables

| # | Deliverable | Implementation |
|---|---|---|
| 1 | **Stage Duration Engine** | `lib/sla/stage-duration.ts` (pure) — `stageDuration()` → `{ currentDepartment, currentStage, enteredAt, ageHours, ageDays }` from existing timestamps |
| 2 | **SLA Configuration** | `lib/sla/config.ts` — code-based `SLA_THRESHOLDS` (hours) |
| 3 | **SLA Classification** | `lib/sla/classify.ts` (pure) — `classifySla(department, ageHours)` → normal / warning / critical / informational |
| 4 | **Dossier SLA Panel** | `components/files/sla-panel.tsx` below the lifecycle tracker; data from `getDossierStage()` (gated file:read) |
| 5 | **Control Tower SLA Dashboard** | "Surveillance SLA" cards per department (within/warning/critical) |
| 6 | **Delayed Dossiers Queue** | top 20, critical → warning → longest waiting (`delayedDossiers()`) |
| 7 | **Department SLA Visibility** | `DeptSlaCard` on each department workspace; `getDepartmentSlaSummary(dept)` (gated by that dept's read perm) |
| 8 | **Executive KPIs (avg times)** | "Délais moyens" — customs / transport / time-to-invoice / time-to-payment derived; documentation = N/A (documented) |
| 9 | **Bottleneck Ranking** | "Principaux goulots (SLA)" — departments ranked by critical then warning (`bottleneckRanking()`) |

All SLA values derive from the **existing `getDossierLifecycle`** (current department/stage) + existing timestamps; the control-tower batch pass computes per-dossier SLA in the same loop (no N+1, no duplicate lifecycle logic).

## SLA thresholds (hours)

| Department | Warning | Critical |
|---|---|---|
| Documentation | 48h | 96h |
| Customs | 72h | 144h |
| Transport | 24h | 72h |
| Finance | 7d (168h) | 30d (720h) |
| Archive | — informational only |

Boundaries are inclusive (`>= warning` → warning, `>= critical` → critical).

## Data sources used (no new schema)

`operational_file` (`created_at` / `opened_at` / `updated_at`), `customs_record` (`updated_at` / `declaration_date` / `release_date`), `transport_record` (`updated_at` / `pickup_actual` / `delivery_actual`), `invoice` (`updated_at` / `issue_date`), `payment` (`paid_at`), `document` (approved DELIVERY_NOTE = POD), `getDossierLifecycle`, `getAnalytics`. Nothing stored — all computed at read time.

### Documented limitations
- **`enteredAt` is a derived approximation**: the governing department record's `updated_at` (or the dossier's `opened_at` / `created_at` via a fallback chain). There is no tracked stage-entry event (forbidden by constraints), so "time in stage" reflects the last change to that department's record.
- **Avg Documentation time** and a precise **time-to-invoice** lack reliable timestamps → shown as **N/A** (time-to-invoice approximated as delivery→issue where both exist).

## Permission model

- **Control tower SLA** (cards / delayed queue / ranking / avg times): gated by `analytics:read` (management) — same as the control tower.
- **Finance signals** (finance SLA card, time-to-invoice/payment): only with `finance:read`; otherwise the finance SLA card is hidden and those averages show `—`.
- **Dossier SLA panel**: `file:read` (the dossier page's own gate).
- **Department SLA summaries**: each gated by that department's read permission (`document:read` / `customs:read` / `transport:read` / `finance:read`), reusing the scoped queue reads. No RBAC/RLS changes.

## Files changed

**New:**
- `lib/sla/config.ts`, `lib/sla/classify.ts` (pure), `lib/sla/stage-duration.ts` (pure), `lib/sla/aggregate.ts` (pure), `lib/sla/service.ts` (server)
- `components/files/sla-panel.tsx`, `components/departments/dept-sla-card.tsx`
- `tests/sla.test.ts`, `docs/phase-2.3-sla-monitoring.md`

**Edited:**
- `lib/control-tower/service.ts` (per-dossier SLA in the batch pass + slaByDept / delayed / ranking / avgTimes), `components/dashboard/control-tower.tsx` (SLA sections)
- `app/files/[id]/page.tsx` (SLA panel), the four department pages (`DeptSlaCard`)
- `lib/departments/types.ts` + `service.ts` (added `openedAt` to the documentation queue row, reused for documentation SLA)
- `lib/i18n.ts` (`t.sla`); `tests/departments-classify.test.ts` (fixture `openedAt`)

## Tests added

`tests/sla.test.ts` (14): config thresholds; classify boundaries per department (incl. exact warning/critical edges); stage-duration timestamp selection + fallback; `slaCountsByDept` (closed-excluded); delayed-queue ordering (critical → longest); bottleneck ranking; `slaSummary`; `averageDays` (mean + null). Fixed timestamps — no clock-dependent flakiness.

## Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 234 passed (+14) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only sla/control-tower service / admin client; the 4 SLA pure modules are server-only-free |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## Live testing checklist

1. As **CEO/SYSTEM_ADMIN** (analytics:read): dashboard shows "Surveillance SLA" cards, "Délais moyens", "Principaux goulots (SLA)", and a "Dossiers en retard" table (critical first).
2. Open a dossier sitting in Documentation > 48h → its SLA panel below the lifecycle tracker shows 🟡 Alerte; > 96h → 🔴 Critique; thresholds displayed.
3. A dossier released from customs quickly stays 🟢 Dans les délais.
4. On the **Customs** workspace, the SLA summary card shows within/warning/critical for customs dossiers; same on Documentation/Transport/Finance.
5. A viewer without `finance:read` does not see the finance SLA card or time-to-invoice/payment (show `—`).
6. Delayed queue ordering: a 30-day-old finance dossier and a 5-day-old critical customs dossier both appear, criticals first then by age.
7. Avg documentation time shows **N/A** (documented); customs/transport/payment show derived day counts where data exists.
8. Responsive: SLA cards wrap; delayed table scrolls on mobile.

## Constraints honoured

No schema changes / migrations · no notifications / cron / background workers · no escalation engine · no workflow changes / new states · no duplicate lifecycle logic or state tracking — everything derives from the existing lifecycle tracker, control-tower services, and existing timestamps.
