# Dashboard UX — Department Cards + Recent Activity

**Date:** 2026-06-17
**Goal:** make `/dashboard` feel like an operational control tower — surface per-department workload and a lightweight recent-activity feed directly on the Centre d'opérations, reusing existing helpers (no new schema, no new event system, no polling).

**Validation:** `tsc --noEmit` clean · **211 tests** pass (+11) · `next build` succeeds · boundary + secrets checks clean.

---

## 1. Sections added (placement)

Both render server-side, **after the top KPI band** and **before** the presence / finance / task sections:

1. **Activité par département** — one card per department the viewer may read, each with a primary workload count, a secondary status count, an alert count (red when > 0), and a link to the workspace.
2. **Activité récente** — last ~10 meaningful audit events (broad-visibility roles only).

## 2. Department cards — metrics & data sources

Cards reuse the **Phase 2.0 services + classifiers** and **Phase 2.1 handoff counts** — no business logic duplicated; pure mappers (`lib/departments/dashboard-map.ts`) only choose primary/secondary/alert.

| Card | Primary | Secondary | Alert | Source |
|---|---|---|---|---|
| Documentation | Documents manquants | Prêt pour la douane | Dossiers urgents | `getDocumentationQueue` + `documentationCards` + `readyForCustomsCount` |
| Dédouanement | Prêt pour déclaration | Sous inspection | Bloqués | `getCustomsQueue` + `customsCards` (+ inline BLOCKED count) |
| Transport | Prêt pour dispatch | En transit | POD requis | `getTransportQueue` + `transportCards` |
| Finance | Factures en cours | Paiements à vérifier | En retard | `getFinanceKpis` + `getReconciliation` |
| Direction | Dossiers actifs | Priorité haute | Opérations bloquées | `getAnalytics` |

`getDepartmentCards(permissions)` only queries departments the viewer can read; a failing dept is dropped (best-effort), never fatal.

## 3. Recent activity — data source & shape

Curated read of the **existing `audit_log`** (no new schema/event system). Read via the RLS-respecting user-context client, so `audit_log_select_scoped` (audit:read:all) is the boundary. Each item: time, event label + category badge, dossier link + client (best-effort, one batched RLS-scoped `operational_file` lookup), and actor email. Allow-listed actions: `user.created`, `document.uploaded/approved`, `customs.declared/released`, `transport.picked_up/delivered/pod_received`, `invoice.issued`, `payment.recorded/verified`, `handoff.task.created/completed`, `communication.sent`.

## 4. Permission model

- **Department cards:** each card appears only with its read permission — `document:read` / `customs:read` / `transport:read` / `finance:read` / `analytics:read`. Each underlying service also re-asserts its permission (defense in depth).
- **Recent activity:** the whole section is shown only to holders of `audit:read:all` (SYSTEM_ADMIN, CEO, COMPLIANCE_HSSE) — enforced by the audit RLS policy, not a new gate. **Finance-sensitive events** (`invoice.*` / `payment.*`) are withheld unless the viewer also holds `finance:read` (so e.g. COMPLIANCE_HSSE sees activity but not finance lines). Only allow-listed actions surface — `auth.*`, `portal.*`, `admin.override.*` and any other audit rows never appear. Non-management users see no activity section.

No RBAC/RLS weakening: the activity read uses the existing RLS-scoped audit path; department counts use admin-client reads already gated by each department's read permission (the established queue pattern).

## 5. Files changed

**New:**
- `lib/departments/dashboard-map.ts` (pure card mappers), `lib/departments/dashboard.ts` (server fetcher)
- `lib/activity/classify.ts` (pure label/category/finance-gate), `lib/activity/feed.ts` (server audit reader)
- `components/dashboard/department-cards.tsx`, `components/dashboard/recent-activity.tsx`
- `tests/dashboard-cards.test.ts`, `tests/activity-classify.test.ts`
- `docs/dashboard-ux-department-cards.md`

**Edited:** `app/dashboard/page.tsx` (resolve permissions once; fetch dept cards + activity; render the two sections), `lib/i18n.ts` (`t.dashboard.deptActivity` / `recentActivity`).

## 6. Tests added

- **`dashboard-cards.test.ts`** — primary/secondary/alert mapping for all five cards + a guard that every card links to a real `/departments/*` route (no mock/prototype route reintroduced).
- **`activity-classify.test.ts`** — labels/categories for allow-listed actions, `null` for non-allow-listed (no arbitrary audit leakage), finance events hidden without `finance:read`, non-finance events shown regardless.

## 7. Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 211 passed (+11) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only feed/dashboard/admin client; pure modules are server-only-free |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## 8. Live test checklist

1. As **SYSTEM_ADMIN/CEO**: dashboard shows all five department cards with live counts, and the **Activité récente** feed with mixed events (incl. finance), each linking to its dossier where resolvable.
2. As **COMPLIANCE_HSSE** (audit:read:all, no finance:read): sees the activity feed **without** any invoice/payment events; finance dept card hidden.
3. As **FINANCE_OFFICER** (finance:read, no audit:read:all): sees the Finance department card; the Recent Activity section is **not shown**.
4. As **CUSTOMS_DECLARANT**: sees only the Dédouanement card (and any other dept they can read); no activity feed.
5. **Empty states**: a viewer with no department permissions sees "Aucune activité départementale."; an audit viewer with no recent events sees "Aucune activité récente."
6. **Responsive**: cards wrap 1→2→3→5 columns; the activity rows wrap and stay readable on a 375px viewport.
7. Confirm the cards link to `/departments/*` and no mock route appears.

## 9. Constraints honoured

No schema change · no new business module · no external integration · no mock data · no RBAC/RLS weakening · Phase 2.0 classifier logic reused (not duplicated) · server-rendered only (no polling).
