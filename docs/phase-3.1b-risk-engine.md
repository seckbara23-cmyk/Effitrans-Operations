# Phase 3.1B — AI Risk & Attention Engine

A **derived-only** visibility layer that surfaces operational risk across the
dossier page, department workspaces, the Control Tower and the Operations
Copilot. It writes nothing, creates no tasks/notifications/cron/automations,
changes no lifecycle or SLA state, and persists no scores. The existing
lifecycle tracker, SLA engine, handoff engine and Control Tower remain the
single source of truth.

## Core artifact

`lib/copilot/risk-engine.ts` — a **pure** module (no I/O, no server-only imports):

- `assessRisk(input): { level, score, reasons, actions }` — the single source of
  truth for scoring.
- `riskInputFromContext(ctx, now)` — derives the engine input from the Copilot
  snapshot.
- `rankAttention(rows, limit)` / `riskKpis(rows, …)` — Control Tower aggregations.
- `overdueDays(dueDate, now)` — shared pure date helper.

### Scoring model
| Domain | Signal | Points |
| --- | --- | --- |
| Documents | 1 missing required | +20 |
| Documents | 2+ missing required | +40 |
| SLA | warning | +15 |
| SLA | critical | +35 |
| Customs | under inspection | +15 |
| Customs | inspection > 5 days | +30 |
| Transport | awaiting POD | +15 |
| Transport | transit exceeds SLA | +25 |
| Finance | invoice overdue | +20 |
| Finance | overdue > 30 days | +40 |

Documents / customs / finance are **tiered** (higher tier supersedes); transport
conditions are **additive**. Score is capped at 100.

### Risk levels
`0–19 LOW · 20–49 MEDIUM · 50–79 HIGH · 80+ CRITICAL`

## Files changed

**New**
- `lib/copilot/risk-engine.ts` — the engine + adapters + aggregations.
- `components/copilot/risk-panel.tsx` — dossier Risk Assessment card.
- `components/departments/dept-attention-card.tsx` — department risk visibility.
- `tests/risk-engine.test.ts` — 25 unit tests.
- `docs/phase-3.1b-risk-engine.md` — this document.

**Modified**
- `lib/copilot/context.ts` — adds `risk: RiskAssessment` to the Copilot context (computed from the assembled snapshot, `now` injected).
- `lib/copilot/prompt.ts` — renders a `=== RISQUE ===` section and instructs the Copilot to consume it (single source of truth) instead of reasoning from scratch.
- `lib/control-tower/service.ts` — computes per-dossier risk in the existing lifecycle/SLA pass; exposes `attentionQueue` (max 10, risk-ranked) and `riskKpis`. No new queries; captures max overdue days per file from invoice data already loaded.
- `components/dashboard/control-tower.tsx` — Risk KPI band + "Attention immédiate requise" queue (dossier №, risk level, primary reason, link).
- `app/files/[id]/page.tsx` — builds the risk input and renders `RiskPanel` directly below the Lifecycle Tracker.
- `app/departments/{documentation,customs,transport,finance}/page.tsx` — each adds a `DeptAttentionCard` derived from data already loaded.
- `lib/i18n.ts` — `t.risk.*` strings.
- `tests/copilot-context.test.ts`, `tests/copilot-prompt.test.ts` — extended for the new `risk` field + risk section.

## Tests added
`tests/risk-engine.test.ts` (25 tests) covers: level thresholds; LOW/MEDIUM/HIGH/CRITICAL; missing documents (1 vs many); SLA warning/critical; customs inspection (short vs >5 days); transport (awaiting POD, transit-over-SLA, additive); overdue invoice (≤30 vs >30 days); combined scoring + score cap; `overdueDays`; `rankAttention` (filter/rank/limit); `riskKpis`. Copilot context/prompt tests extended (+3) for risk derivation and the risk brief section.

## Validation results
- `tsc --noEmit` — **clean**.
- `vitest run` — **315 tests passed** (39 files), incl. 28 new.
- `next build` — **succeeded**; all routes compiled (`/files/[id]`, the four department workspaces, dashboard).

## Live testing checklist

### Dossier page (`/files/[id]`)
- [ ] A "Évaluation des risques" card renders directly below the Lifecycle Tracker.
- [ ] Level badge + score bar reflect the dossier: a clean dossier shows LOW / 0; a dossier with missing docs + SLA warning shows the summed score.
- [ ] Reasons and Recommended Actions match the scoring model (e.g. "Un document requis est manquant." → +20).
- [ ] Removing a blocker (e.g. approving the last missing doc) lowers the level on refresh — no manual edit, no persisted value.
- [ ] A user without `finance:read` sees no finance-driven risk reasons (the signal is invisible, not invented).

### Department workspaces
- [ ] Documentation: "Points d'attention" shows missing-required + verification-bottleneck counts.
- [ ] Customs: shows SLA-exceeded + under-inspection counts.
- [ ] Transport: shows awaiting-POD + transport-delay counts.
- [ ] Finance: shows overdue invoices + outstanding receivables.
- [ ] When nothing is wrong, the card shows "Rien à signaler."

### Control Tower (dashboard, `analytics:read`)
- [ ] "Indicateurs de risque" band shows Critical / High / SLA breaches / Overdue finance.
- [ ] "Attention immédiate requise" lists ≤10 high/critical dossiers, ranked critical→high→age→priority, each linking to its dossier with a primary reason.
- [ ] Without `finance:read`, Overdue finance shows "—" and finance risk is excluded.

### Copilot (`/api/copilot`)
- [ ] "Quels sont les risques ?" → answer mirrors the dossier Risk panel (same level/reasons), not a re-derivation.
- [ ] "Que dois-je surveiller ?" / "Quel dossier nécessite une attention ?" → grounded in the RISQUE section.
- [ ] The Copilot does not invent a different score or risks absent from the section.

### Read-only / no side effects
- [ ] No new rows in any table after viewing risk anywhere (no risk persistence).
- [ ] No tasks, notifications, emails, or workflow transitions are created.
- [ ] Lifecycle and SLA states are unchanged.

## Constraints honored
No schema changes · no migrations · no workflow changes · no new tasks/notifications/cron/automations · no persisted risk scores. Reuses the lifecycle tracker, SLA engine, Control Tower aggregation path, Copilot context and existing dossier/department services.
