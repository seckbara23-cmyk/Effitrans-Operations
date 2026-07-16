# Customer Portal — Journeys

**Phase 7.5A.** The customer-facing journeys the portal supports. Most journeys predate 7.5A (see
[architecture.md](./architecture.md)); this phase deepens the **shipment-tracking** journey (vessel/
flight, containers/ULDs, and a rich shared map) and proves ocean/air isolation.

## 1. Sign in (existing)

Customer rep receives an invitation (or temp password), sets their password (forced first-login
change), and logs in at `/portal/login` (email/password or Google). A disabled account is denied at
the login gate + RLS. Session is managed by Supabase SSR cookies; staff and portal sessions are kept
separate by identity class.

## 2. Dashboard (existing)

`/portal` shows the customer's active shipments and the latest notifications (unread badge). Only the
customer's own company's dossiers appear.

## 3. Track a shipment — **deepened in 7.5A**

Open a dossier from the dashboard or shipments list (`/portal/files/[id]`). The tracking page shows,
all scoped to the customer's own company:

- **Status + timeline** — customer-safe lifecycle stages (existing).
- **Interactive map — now the shared provider-neutral map.** For an ocean/air shipment the page
  renders the same projection + Leaflet renderer used by the internal Ocean/Air consoles: current
  position, milestone markers, planned/actual tracks, and **confidence / freshness / warnings**.
  Stale or inferred positions render hollow and carry a warning so they are never read as a live fix.
  Road-only / no-geo dossiers fall back to the origin→destination pin map.
- **Vessel or Flight + Voyage** — surfaced from the tracking events (`vessel_name` / `voyage_reference`
  for ocean; `flight_number` for air). *(new)*
- **Container(s) / ULD(s)** — the per-unit list with number, type, and status. *(new)*
- **References** — MBL / HBL / Booking (ocean) or MAWB / HAWB (air), customer-safe. *(new)*
- **ETA**, **customs status summary**, **documents**, and **invoices** for the dossier (existing).
- **No editing** — the tracking surface is read-only; self-service actions (document upload, payment
  proof, request update, contact) are the only writes and are unchanged.

The vessel/flight/container data comes from a customer-safe read (`getPortalCarriage`) that proves
ownership via the RLS user-context client and reuses the shared map + position engines — no second
map logic, no cross-customer or cross-tenant leakage.

## 4. Documents (existing)

`/portal/documents` and the dossier's document center list only documents the operator marked
`APPROVED` **and** shared with the client. Downloads are short-TTL signed URLs, authorized per
document and audited.

## 5. Invoices (existing)

`/portal/invoices` and the dossier invoice center show read-only ISSUED/PARTIALLY_PAID/PAID invoices
with line items and payment status; a printable detail view; audited views.

## 6. Notifications (existing)

`/portal/notifications` — the customer's read-only inbox (shipment/invoice/payment events) with
mark-read and email preferences.

## 7. Contact the operator (existing, one-way)

The dossier "request update" / "contact" actions create a task for the assigned operator (audited as
`portal.message.sent`). A **two-way threaded** conversation is deferred to Phase 7.5B.

## Deferred to Phase 7.5B

Company Profile page, bounded Search, two-way messaging thread, branding application in the shell,
the missing view-audit events (`portal.shipment.viewed` / `timeline.viewed` / `profile.viewed`), MFA
enrollment, a `portal:*` capability catalog with `CLIENT_ADMIN`/`CLIENT_USER` differentiation, and
per-portal-user auth-layer session revocation.
