# Customer Portal — Architecture Decision (Phase 7.5A)

## Critical finding: the portal foundation already exists

An audit of authentication, the org/customer/contact model, `operational_file` / `shipment` /
`customs_record`, document storage, permissions, notifications, existing portals, public routes,
branding, and security shows that a **mature customer portal already ships** in this repo (built
across phases 1.12A → 3.3B). Therefore Phase 7.5A is **not** a greenfield build. The governing
decision is:

> **Extend the existing customer portal. Never duplicate operational data, map logic, document
> storage, finance math, notifications, or the identity/RLS model. Close the specific gaps the
> 7.5A brief adds.**

## What already exists (verified, with references)

- **Two-identity model.** `client_user` (`supabase/migrations/20260615000005_create_portal.sql:19`)
  has `id uuid PK → auth.users(id)` plus `tenant_id` and **`client_id`** — one login = exactly one
  customer. Staff (`app_user`) and portal (`client_user`) identities are **disjoint** on the same
  Supabase project.
- **Tenant + customer RLS isolation (not just tenant).** Helpers `auth_portal_client_id()` /
  `auth_portal_tenant_id()` (ACTIVE-gated) and `portal_can_read_file(file_id)` join a row's
  `operational_file.client_id` to the caller's own `client_user.client_id`. Two customers in the same
  tenant cannot see each other's data. Proven by `supabase/tests/rls_portal_test.sql` (+ documents,
  invoice, temp-password RLS tests) in CI.
- **Authentication.** Login (email/pw + Google), invitation + temp-password with forced first-login
  change, forgot/reset password, session management, per-user disable — `lib/portal/{auth,actions,
  admin-actions,password-reset,password-change,temp-password,oauth,oauth-gate}.ts`; middleware
  classifies staff vs portal sessions (`lib/auth/session-class.ts`).
- **Portal pages** under `app/portal/(app)/`: dashboard, shipments list, **shipment tracking detail**
  (status/timeline/map/ETA/BL-AWB/container ref/customs summary/documents/invoices), documents,
  invoices (list + printable detail), notifications.
- **Documents.** RLS-gated to `APPROVED` **and** `shared_with_client`; server-minted 60-second signed
  URLs (`lib/documents/storage.ts` + `lib/portal/docs-actions.ts`); download audited.
- **Invoices.** Read list/detail + line items + payments via portal RLS reusing shared `finance/calc`
  (never `finance/service`, which is `finance:read`-gated).
- **Notifications.** `client_notification` inbox + mark-read + email prefs
  (`lib/customer-notify/**`), lifecycle-generated and dedup-guarded.
- **Audit.** `audit_log.client_user_id` + a `portal.*` action family (login, document download,
  invoice view, message sent, password events) — safe metadata only.
- **Independence guaranteed by construction.** Staff RBAC keys on `app_user`/`user_role`; a
  `client_user` has zero `user_role` rows, so `has_permission()`/`assertPermission` deny **everything**
  staff. There is no privilege inheritance path. The only `portal:*` code is `portal:manage` (a
  **staff** capability to manage portal users).

## Reuse map (extend, don't duplicate)

| Portal need | Reuse | Adaptation |
|-------------|-------|------------|
| Shipment map | `buildShipmentMapProjection` (`lib/shipping/intelligence/map-projection.ts`) + `ShipmentMap` renderer + lazy loader — **already dual-mode ocean/air**, with confidence/freshness/warnings | Feed it from a portal-scoped, own-client, customer-safe builder; **retire the portal's parallel map** (`lib/portal/map-points.ts` + `components/portal/leaflet-map.tsx`) |
| Tracking derivations | Pure builders: `projectTimeline`, `sortEvents`, `resolveCurrentPosition`, `classifyFreshness`, `derivePortalEta` | Call over the **portal RLS client**; project customer-safe fields (mirror `docs-service.ts`) |
| Documents | `createSignedDownloadUrl` + the `docs-actions.ts` pattern (RLS read → signed URL → audit) | Copy the pattern; never touch `storage.ts` |
| Invoices | `listPortalInvoices`/`getPortalInvoice` + `finance/calc`; `ReportLayout` PDF engine for PDFs | Reuse as-is |
| Notifications | `listClientNotifications` / `notifyCustomer` | Reuse as-is |
| Branding | `resolveTenantBranding` → `TenantBranding` (logo/colors), already resolved in the portal layout | **Apply** `portalLogoUrl`/`primaryColor` in `PortalShell` (today only `displayName` is used) |
| UI shell / i18n | `PageHeader`, `Panel`, `.surface`, `t.portal.*` | Compose; add strings under `t.portal.*` |
| Auth | `requirePortalUser` / `getCurrentPortalUser` | Session-authenticated (not tokens); borrow `/card/[token]` uniform-404/noindex only for any future public share link |

## Gaps the 7.5A brief adds (vs current state)

1. **Ocean/Air tracking not portal-visible.** The 16 `ocean_*` / `air_*` tables are staff-only
   (`transport:read`); they have **no** portal RLS. So vessel/voyage, flight number, and the per-
   container list the brief's Shipment Tracking requests are not surfaced. → add a
   `portal_can_read_shipment(shipment_id)` helper + additive portal `SELECT` policies on the
   shipment-linked ocean/air tables, and a customer-safe read.
2. **Map duplication.** The portal uses its own poorer map instead of the shared projection. → consolidate.
3. **Company Profile** — no `/portal/profile` (company info / contacts / addresses / preferences,
   read-only; no critical-master-data editing yet).
4. **Search** — no bounded, SQL-paginated search over shipment/container/booking/BL/AWB/reference/document.
5. **Two-way messaging** — only one-way `contactEffitrans` → task exists; no threaded customer↔operator
   conversation (new table + RLS + operator reply surface). *Largest net-new item.*
6. **View-audit events** — `portal.shipment.viewed` / `timeline.viewed` / `profile.viewed` are missing.
7. **Branding application** — logo/colors resolved but not rendered in the shell.
8. **MFA-ready** — Supabase stack is MFA-capable but nothing enrolls/asserts AAL2 (absent, not blocked).

## Isolation, security, performance (unchanged principles the extension must uphold)

- Every portal read proves **tenant + customer + portal-account** via `portal_can_read_*` /
  `auth_portal_client_id()`; new tables get an explicit `*_portal_select` policy or they return
  nothing (fail-safe). No portal WRITE policies — writes are service-role actions that re-derive
  `auth_portal_client_id()` and re-check scope, then `writeAudit({ clientUserId })`.
- **No privilege inheritance:** portal users never receive admin/transport/customs/platform/staff
  permissions (structurally impossible; keep it that way — never grant a `client_user` a `user_role`).
- **Customer-safe projections only:** no internal notes, SLA, risk scores, staff identity, or raw
  provider references leave the portal boundary.
- **Performance:** server components, bounded reads, pagination, no N+1 (batched reads as in
  `lib/portal/shipments.ts`), lazy map + lazy document previews.

## Recommended 7.5A scope (extend now) vs 7.5B (defer)

- **7.5A (this phase):** map consolidation onto the shared projection; ocean/air portal RLS + helper +
  customer-safe vessel/flight/container tracking + an RLS isolation test; portal view-audit events;
  branding application; a read-only Company Profile; bounded Search.
- **7.5B (defer):** two-way messaging thread (new model + operator surface), MFA enrollment, a
  `portal:*` capability catalog with `CLIENT_ADMIN`/`CLIENT_USER` differentiation, and per-portal-user
  auth-layer session revocation.

Exact scope confirmed with the product owner before implementation (see the phase's scope decision).
