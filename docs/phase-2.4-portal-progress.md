# Phase 2.4 — Client Portal Progress Tracking

**Date:** 2026-06-17
**Goal:** give portal customers a simplified, business-friendly shipment progress view derived from the existing internal lifecycle — without exposing internal departments, tasks, blockers, staff identities, SLA, or audit detail.

**Validation:** `tsc --noEmit` clean · **242 tests** pass (+8) · `next build` succeeds · boundary + secrets checks clean.

---

## Lifecycle mapping (internal → customer)

The customer timeline is mapped from the **existing `getDossierLifecycle`** steps (single source of truth) by `lib/portal/progress-map.ts` (pure). Only stable customer keys are returned; labels are resolved in the UI via i18n.

| Customer stage | Derived from internal step | Example |
|---|---|---|
| Dossier créé | (dossier exists) | always |
| Documents reçus | `documents_collection` completed | |
| Documents vérifiés | `documents_verified` completed | |
| Dédouanement en cours | `customs_cleared` completed | internal `customs_inspection` etc. **hidden** |
| Dédouanement terminé | `release_authorized` completed | internal `CUSTOMS_RELEASED` → **"Dédouanement terminé"** |
| Transport planifié | `transport_planned` | |
| En transit | `in_transit` | |
| Livré | `delivered` | |
| Facture émise | `invoiced` | |
| Paiement reçu | `paid` | |

**Hidden entirely:** internal step keys, departments, blockers (no "blocked" state — only completed/current/pending), SLA classifications, handoffs (`FINANCE_HANDOFF` → not shown), staff identities, audit/usernames. Non-customs shipments flow past the customs stages (internal `skipped` → shown as completed).

## Portal views added

1. **Shipment timeline** + **progress summary card** (current status, % terminé, "Mis à jour il y a…", prochaine étape) on `/portal/files/[id]`.
2. **Activity feed** — completed milestones, newest first (customer labels only).
3. **My Shipments** dashboard cards: Actives / En transit / Livrées / En attente de paiement.
4. **Invoice & payment visibility**: existing invoice list/detail + a customer-safe **"Paiement en cours de vérification"** note (derived from internal verification status, never exposing the raw status / provider refs / reconciliation).
5. **Delivery / POD**: "Preuve de livraison disponible" when an approved POD is shared (downloadable in the documents section).
6. **Notification template definitions** (`shipment_progress`, `shipment_delivered`, `payment_received`) — definitions only, no triggers/sending (Phase 2.5 decides strategy).

## Data sources & single source of truth

`getPortalProgress(fileId)` (server): verifies dossier ownership via the **RLS user-context client**, then reads the full lifecycle inputs (documents, document_type, customs/transport records, invoices + lines + payments) with the admin client **purely to compute** the customer-safe timeline — returning only mapped stages / percent / activity / POD-availability. Reuses `getDossierLifecycle`; no second lifecycle, no portal status fields, no schema changes.

## Permissions / isolation

Portal RLS unchanged. Ownership is verified through the user-context client before any admin read; output is customer-safe only. No cross-client, staff, or management visibility; no RBAC/RLS changes. The payment-verifying flag is a derived boolean — the internal `verification_status`, provider references, and reconciliation detail are never sent to the portal.

## Files changed

**New:**
- `lib/portal/progress-map.ts` (pure: timeline/activity/relative-time/shipment cards), `lib/portal/progress.ts` (server, ownership-gated)
- `components/portal/portal-progress.tsx`
- `tests/portal-progress.test.ts`, `docs/phase-2.4-portal-progress.md`

**Edited:**
- `app/portal/(app)/files/[id]/page.tsx` (progress view), `app/portal/(app)/page.tsx` (My Shipments cards), `app/portal/(app)/invoices/[id]/page.tsx` (verifying note)
- `lib/portal/service.ts` (list includes transport status for the cards), `lib/portal/docs-service.ts` + `lib/portal/types.ts` (derived `paymentVerifying`)
- `lib/comms/templates.ts` (3 customer template definitions), `lib/i18n.ts` (`t.portal.progress` + dashboard shipments + `paymentVerifying`)

## Tests added

`tests/portal-progress.test.ts` (8): the exact 10 customer stages + **no internal-key/blocker/SLA leakage** (serialized timeline asserted clean), `CUSTOMS_RELEASED → "Dédouanement terminé"`, only completed/current/pending (missing docs ≠ blocked), progress % + next step, non-customs flow (skipped → completed), activity ordering, French relative time, and shipment-card counts.

## Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 242 passed (+8) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only `portal/progress` / admin client; `progress-map` is pure |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## Live testing checklist

1. As a portal user, open a dossier: progress card shows the current customer status, % terminé, "Mis à jour il y a…", and prochaine étape; the timeline shows completed/current/pending (no internal terms, no blocked).
2. A dossier with customs RELEASED shows "Dédouanement terminé" completed and "Transport planifié" current.
3. Missing documents internally → the customer timeline shows "Documents vérifiés" as current (never "blocked").
4. Documents section lists only approved+shared docs; an approved+shared POD shows "Preuve de livraison disponible" and is downloadable.
5. Invoice detail with an unverified payment shows "Paiement en cours de vérification" (no internal status/refs).
6. Dashboard shows My Shipments counts (Actives / En transit / Livrées / En attente de paiement).
7. Cross-client isolation: a portal user cannot open another client's dossier (RLS → not found); progress returns null.
8. Mobile: timeline + cards remain readable.

## Constraints honoured

No schema changes / migrations · no workflow changes / new status fields · no notifications / email sending (templates are definitions only) · no portal-specific lifecycle source (reuses `getDossierLifecycle`) · no internal data leakage · portal RLS preserved.
