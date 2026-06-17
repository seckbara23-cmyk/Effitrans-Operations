# Phase 2.0 — Department-Oriented Workspaces

**Date:** 2026-06-17
**Premise:** organize the platform by department while staying ONE integrated system — one DB, one auth, one dossier lifecycle, multiple department workspaces. Department workspaces are **filtered operational views over existing records** — no new business modules, no schema redesign, no RBAC/RLS weakening.

**Validation:** `tsc --noEmit` clean · **173 tests** pass (+13) · `next build` succeeds (5 new dynamic routes) · client/server boundary + secrets checks clean.

---

## 1. Routes added

| Route | Permission gate | Reuses |
|---|---|---|
| `/departments/documentation` | `document:read` | new `getDocumentationQueue` (files + documents + document_type) |
| `/departments/customs` | `customs:read` | `getCustomsQueue` |
| `/departments/transport` | `transport:read` | `getTransportQueue` |
| `/departments/finance` | `finance:read` | `getFinanceQueue` + `getReconciliation` + `getFinanceMonthRevenue` |
| `/departments/management` | `analytics:read` | `getAnalytics` (read-only) |

Each page = **dashboard cards + a filtered queue + per-row "next action / hand-off" link** into the existing dossier action surfaces (`/files/[id]` panels) and module views. They are pure server components (no new mutation paths).

All existing direct routes are **preserved** (`/files`, `/clients`, `/customs`, `/transport`, `/finance`, `/finance/reconciliation`, `/analytics`, `/communications`, `/users`, `/settings/audit`).

## 2. Navigation changes

Sidebar restructured (`lib/nav.ts` + `lib/i18n.ts`) — departments are now the primary workflow entry point:

```
Pilotage        → Centre d'opérations (/dashboard)
Départements    → Documentation · Dédouanement · Transport · Finance · Direction
Opérations      → Dossiers (/files) · Clients (/clients) · Communications
Administration  → Utilisateurs · Journal d'audit
```

Each department item is permission-gated (cosmetic filter; server/RLS remain authoritative). **No removed mock/prototype routes were reintroduced** (`/customers`, `/shipments`, `/documents`, `/reports`, `/settings` stay out of nav) — covered by a test.

## 3. Finance blocker fix (dry-run A1)

Already applied in the prior step (commit `bd287d0`, migration `20260616000001_finance_file_read.sql`): `FINANCE_OFFICER` was granted **`file:read` + `file:read:all`** (read-only). This is what lets the Finance workspace's "open dossier" links reach `/files/[id]` so finance can author charges/invoices/payments.

> Note on "file:read only": plain `file:read` is **insufficient** on its own — the `operational_file` SELECT policy also requires `can_read_file`, which only returns *assigned* dossiers unless the user holds `file:read:all` (`scope_visibility.sql:82,140`). A finance officer is never assigned, so both read codes are required. **No operational write permission was granted** (`file:create/update/delete` are NOT held), satisfying the "do not grant operational write" constraint. This phase adds the RLS test that proves exactly that.

## 4. Hand-offs (Phase 2.0 = indicators; automation deferred to 2.1)

Per the phase's preferred path, automatic cross-department task creation is **not** implemented (avoids noisy duplicate tasks without robust dedup). Instead, each queue row shows a **"next action / next department" indicator** computed by the pure classifier:

| From → To | Trigger | Indicator shown |
|---|---|---|
| Documentation → Douane | docs verified (no missing/pending) | "Prêt → Douane" |
| Douane → Transport | customs `RELEASED` | "Libéré → Transport" |
| Transport → Finance | `POD_RECEIVED` | "Livré → Finance" |
| Finance → Archivage | invoice `PAID` | "Payée → Archivage" |

**Phase 2.1 plan:** convert these indicators into idempotent hand-off tasks (one task per dossier-stage, keyed to prevent duplicates) on the state-transition events that already exist.

## 5. Files changed

**New:**
- `lib/departments/types.ts`, `lib/departments/classify.ts` (pure, tested), `lib/departments/service.ts` (server-only)
- `components/departments/stat-card.tsx`
- `app/departments/{documentation,customs,transport,finance,management}/page.tsx`
- `supabase/tests/rls_finance_file_read_test.sql`
- `tests/departments-classify.test.ts`, `tests/departments-nav.test.ts`

**Edited:**
- `lib/nav.ts` (department section + nav restructure), `lib/i18n.ts` (nav labels)
- `.github/workflows/ci.yml` (run the new RLS test)

## 6. Tests added

- **`departments-classify.test.ts`** — card classification + next-action/hand-off for documentation, customs, transport, finance (12 cases).
- **`departments-nav.test.ts`** — department section + permissions, core routes preserved, **no mock routes reintroduced**, per-permission nav visibility (4 cases).
- **`rls_finance_file_read_test.sql`** — FINANCE_OFFICER can SELECT an unassigned dossier (read works) but UPDATE affects 0 rows and INSERT is blocked (no operational write). Wired into CI.
- Management is **read-only by construction** (imports only `getAnalytics`; no server action imported) — verified by the boundary grep + build.

## 7. Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` (vitest) | ✅ 173 passed |
| `next build` | ✅ success (5 new `ƒ` routes) |
| client/server boundary grep | ✅ no client imports server-only dept service/admin |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |
| RLS (finance file-read) | ⏳ runs in CI `rls-tests` job (local Supabase unavailable here) |

## 8. Migration

**No new migration in this phase.** The only DB change (finance `file:read`) was migration **`20260616000001_finance_file_read.sql`**, applied in the prior step. Department workspaces are pure read views — no schema.

### Production migration instructions
- The finance grant migration ships with the normal deploy: `supabase db push` (or the CI/CD migration step) applies `20260616000001_finance_file_read.sql`. It is idempotent (`on conflict do nothing`) and additive (read-only grant).
- No data backfill, no downtime, no env changes required.
- After deploy, confirm FINANCE_OFFICER users can open `/departments/finance` and click into a dossier.

## 9. Live testing checklist

1. **Nav** — sign in; sidebar shows Pilotage / Départements (5) / Opérations / Administration; no Clients-mock / Shipments / Documents-mock / Reports / Settings entries.
2. **Per-role visibility** — a Customs agent sees the Dédouanement workspace but not Finance/Direction; Finance officer sees Finance + Direction (has analytics:read) but department items they lack are hidden.
3. **Documentation** — cards (pending/missing/verified/urgent) match reality; rows link to the dossier; "Demander les documents manquants / Vérifier" shown appropriately.
4. **Customs** — cards bucket by status; "Déclarer / Libérer / Libéré → Transport" indicators correct; row links open the dossier customs panel.
5. **Transport** — cards (dispatch/assigned/in-transit/POD required/delivered); "Téléverser le POD / Livré → Finance" indicators.
6. **Finance** — cards (pending/outstanding/overdue/revenue month/to-verify); "Paiements à vérifier" links to reconciliation; **FINANCE_OFFICER can open a dossier from the queue and author a charge → issue → record payment** (the A1 fix).
7. **Direction** — read-only executive cards from analytics; links to /files, dept pages, /analytics; no mutation controls.
8. **Regression** — existing /files, /clients, /finance, /customs, /transport, /analytics, /communications, /users, /settings/audit still work; portal unchanged.

## 9b. Addendum — Dossier Lifecycle Tracker

A read-only, **derived** 15-step lifecycle tracker was added to `/files/[id]` (before the panels): Draft → Quote Approved → Documents Collection → Documents Verified → Customs Preparation → Declaration → Inspection → Cleared → Release Authorized → Transport Planned → In Transit → Delivered → Invoiced → Paid → Archived.

- **Helper:** `lib/files/lifecycle.ts` — pure `getDossierLifecycle(input)` returns `{ steps[], currentStep, nextAction, blockers[], completedPercent }`. Each step has `key`, `label`, `department`, `status` (completed / current / pending / blocked / skipped), `description`, optional `reasonCode`/`detail`/`blocker`/`actionHref`. Derived **only** from existing records: `operational_file.status`, document completeness + missing-required, `customs_record.status`, `transport_record.status`, invoice/payment status, and the approved POD document. No new status table, no mutation.
- **Hand-off gates** surfaced as blockers / next-actions: customs declaration is gated on "documents verified first"; transport on "customs released"; invoicing on "POD"; archive on "paid". Customs steps **skip** when not applicable (non-IMP/EXP or `required=false`).
- **UI:** `components/files/lifecycle-tracker.tsx` (server component) — department-grouped timeline (horizontal on desktop, vertical on mobile), a progress bar, and a **Next action card** (responsible department + action + blocking reason + deep-link to the relevant panel via `#documents`/`#customs`/`#transport`/`#finance` anchors).
- **i18n:** `t.lifecycle` (title, departments, statuses, 15 step labels, reason codes).
- **Tests:** `tests/files-lifecycle.test.ts` — 11 cases (new dossier, missing docs → blocked, docs verified, declaration gated on docs, customs declared, customs released, delivered → POD gate, invoice issued, invoice paid, archived, customs-skipped). All derivation is asserted on stable keys/`reasonCode`.
- **Constraints:** no schema, no duplicate status source, derived-only, no RLS change, read-only (no workflow mutation in the tracker). Validation: tsc clean · 184 tests pass · next build succeeds · boundary/secrets clean.

## 10. Constraints honoured

No separate apps · no DB redesign · no new business modules · no mock/prototype pages · no RLS weakening (read-only finance grant + new RLS proof) · no portal changes · no external integrations · pilot readiness preserved.
