# Phase 7.2C — Shipping Platform integration & verification

No new functionality. This phase reconciles the 7.2A/7.2B implementation with reality: every
claimed route was audited, the production-404 root cause identified, and the missing
**discoverability** layer (workspace navigation, breadcrumbs, cross-links) added by reusing
existing components. NO schema/migration/RLS/permission/provider change.

## Part 1 — Route audit

Every route was verified to have a real `page.tsx` under `app/shipping/` and to compile in
`next build` (route sizes confirmed). None is missing, wrong-path, or compile-excluded.

| Route | File | Compiles | Reachable by URL | Discoverable (pre-7.2C) | Verdict |
|---|---|---|---|---|---|
| `/shipping` | `app/shipping/page.tsx` | ✅ | ✅ | ⚠ one buried text link only | **exists** |
| `/shipping/shipments` | `.../shipments/page.tsx` | ✅ | ✅ | ⚠ footer link | **exists** |
| `/shipping/shipments/[id]` | `.../shipments/[shipmentId]/page.tsx` | ✅ | ✅ | via list | **exists** |
| `/shipping/containers` | `.../containers/page.tsx` | ✅ | ✅ | ⚠ dashboard link | **exists** |
| `/shipping/vessels` | `.../vessels/page.tsx` | ✅ | ✅ | ⚠ | **exists** |
| `/shipping/voyages` | `.../voyages/page.tsx` | ✅ | ✅ | ⚠ | **exists** |
| `/shipping/carriers` | `.../carriers/page.tsx` | ✅ | ✅ | ⚠ | **exists** |
| `/shipping/ports` | `.../ports/page.tsx` | ✅ | ✅ | ⚠ | **exists** |
| `/shipping/alerts` | `.../alerts/page.tsx` | ✅ | ✅ | ⚠ | **exists** |

## Root cause of the production 404

The routes are **present in the codebase and in the build**. `middleware.ts` only refreshes
the Supabase session (matcher covers all routes, no redirects/rewrites); `next.config.mjs`
has no rewrites or route exclusions. There is nothing in code that returns 404 for
`/shipping/*`.

**Therefore the production 404 is a STALE DEPLOYMENT** — the Shipping routes landed in Phase
7.2A (commit `fe3041a`) and the deployed build predates it. The fix for the 404 itself is an
**operator deploy of the current `main`**, not a code change. This phase does not fabricate a
deploy; it makes the routes correct, composed, and discoverable so the deployed build serves
a coherent workspace.

## Parts 2–5 — Wiring, navigation, breadcrumbs, cross-links (reuse only)

- **Workspace layout** — `app/shipping/layout.tsx` wraps every `/shipping` route with a shared
  `ShippingNav` (`components/shipping/shipping-nav.tsx`): a breadcrumb (**Transport › Lignes
  maritimes › Section**) + a tab bar to Dashboard / Shipments / Containers / Vessels /
  Voyages / Ports / Carriers / Alerts. No page can be an orphan — the sub-nav is present on
  all of them. (The base sidebar stays the frozen five-section contract.)
- **Transport entry** — `/departments/transport` now shows a prominent "Plateformes de
  transport" card linking to Ocean Shipping (and Air Cargo).
- **Cross-links** — shipment detail links to its file, its containers list, and Customs
  Intelligence; the container list links back to each shipment; every reference surface
  (vessels/voyages/ports/carriers) is one tab away via the workspace nav.

## Part 6 — Dashboard

The dashboard already exposes the implemented capabilities (in-transit, containers loaded,
ETA changes, delayed, stale tracking, exceptions, awaiting customs, delivered, duty totals,
average clearance, provider readiness) and now links to every sub-surface via the workspace
nav. The **interactive Leaflet map** is a per-shipment surface (it needs a shipment's
projection) and lives on the shipment detail page — no aggregate map is fabricated (that
would be new backend, out of scope).

## Part 7 — Verification

- `npx tsc --noEmit` clean; `npx next build` clean (all 9 `/shipping` routes present).
- `tests/shipping-integration.test.ts` proves: every workspace-nav destination has a real
  page file (no dead links), the layout renders `ShippingNav`, and the Transport department
  links to the workspace. Full suite green.
