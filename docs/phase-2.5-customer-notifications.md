# Phase 2.5 — Customer Communication & Notifications

**Date:** 2026-06-17
**Goal:** automatically notify customers at major shipment milestones (portal + email), reusing the Communications Hub / Resend / audit / portal architecture. Lifecycle stays authoritative; no second comms engine, no cron, no SMS/WhatsApp.

**Validation:** `tsc --noEmit` clean · **249 tests** pass (+7) · `next build` succeeds · boundary + secrets checks clean.

---

## Notification events implemented (7)

Generated from lifecycle events via best-effort triggers on the existing actions (same hook points as Phase 2.1), each **idempotent**:

| Event | Trigger site | Customer message |
|---|---|---|
| `documents_received` | `uploadDocument` | "Nous avons bien reçu vos documents…" |
| `documents_verified` | `approveDocument` (all required approved) | "Votre dossier est complet et prêt pour les formalités douanières." |
| `customs_cleared` | `releaseCustoms` (RELEASED) | "Votre marchandise a été dédouanée avec succès." |
| `transport_started` | `changeTransportStatus` → IN_TRANSIT | "Votre marchandise est en cours de transport." |
| `delivered` | transport DELIVERED / POD_RECEIVED | "Votre livraison a été effectuée." |
| `invoice_issued` | `issueInvoice` | "Une nouvelle facture est disponible dans votre portail." |
| `payment_received` | `verifyPayment` (VERIFIED) | "Votre paiement a été enregistré." |

No internal language leaks (e.g. internal `CUSTOMS_RELEASED` → customer "Marchandise dédouanée"; `FINANCE_HANDOFF` → not a customer event).

## Two channels of one notification

- **Portal inbox** — new `client_notification` table (the portal channel), per-client, dedup-guarded.
- **Email** — via the existing **Communications Hub** `queueAndSend` (Resend when configured), per active portal user, gated by their preferences.

`notifyCustomer` (server) is best-effort, never throws, and is **idempotent**: an app pre-check + a `unique(tenant_id, dedup_key)` index guarantee one notification per `(event + entity)` — a double release or webhook retry produces exactly one.

## Templates

Reuses the existing template architecture (`lib/comms/templates.ts`, rendered by the Hub):
- `shipment_progress` (client_name, dossier_number/status, portal_url), `shipment_delivered`, `invoice_issued` (invoice_number, total, portal_url), `payment_received` (amount, invoice_number, portal_url). No duplicate rendering system.

## Customer preferences

Per-portal-user, additive booleans on `client_user` (default ON): `notify_email` (master), `notify_shipment`, `notify_invoice`, `notify_payment`. Email is sent for a category only when `notify_email AND notify_<category>`. The portal inbox always records (history); preferences gate the email push (future-ready for SMS/WhatsApp). Editable from the portal notifications page.

## Portal views added

- **`/portal/notifications`** — notification center: list (unread highlighted), mark-read + mark-all-read, related dossier/invoice links, no delete; plus the preferences form.
- **Dashboard widget** — "Notifications (N)" unread badge + recent items + link.
- **Nav** — "Notifications" link in the portal shell.

## Audit

- `notification.customer.created` — on portal-inbox creation. Payload: `{ client, dossier, template, channel: "portal", event }`.
- `notification.customer.sent` — per email queued via the Hub. Payload: `{ communication, channel: "email", event }`.

## Permissions / isolation

Portal RLS preserved. `client_notification` SELECT mirrors the portal policy (`auth_portal_tenant_id()` + `auth_portal_client_id()`) — a portal user sees only their own client's notifications; no cross-client/staff/management visibility. Writes go through the service-role admin client (notify + mark-read/prefs, scoped to the caller's own client / client_user). No RBAC/RLS changes beyond the additive table + policy.

## Channels not implemented

SMS and WhatsApp are **not** implemented — the channel model (`NotifyChannel`, per-category prefs) is the extension point for Phase 2.6+.

## Files changed

**New:** `lib/customer-notify/events.ts` (pure), `service.ts` (server), `actions.ts` (portal server actions), `triggers.ts` (server); `components/portal/portal-notifications.tsx`, `notification-prefs.tsx`; `app/portal/(app)/notifications/page.tsx`; `supabase/migrations/20260617000003_customer_notifications.sql`; `supabase/tests/rls_client_notification_test.sql`; `tests/customer-notify.test.ts`; `docs/phase-2.5-customer-notifications.md`.

**Edited:** trigger hooks in `lib/documents/actions.ts`, `lib/customs/actions.ts`, `lib/transport/actions.ts`, `lib/finance/actions.ts`; `lib/audit/events.ts`; `app/portal/(app)/page.tsx` (widget) + `components/portal/portal-shell.tsx` (nav); `lib/i18n.ts` (`t.portal.notify`); `lib/db/types.ts` (client_notification + client_user prefs); `.github/workflows/ci.yml`.

## Tests added

- **`tests/customer-notify.test.ts`** (7): event→category/template mapping, **no internal-event leakage**, customer-friendly copy (CUSTOMS_RELEASED → "dédouanée"), stable dedup keys, and email-preference filtering (master + per-category).
- **`supabase/tests/rls_client_notification_test.sql`**: dedup unique-index enforcement + RLS isolation (own client sees, other client doesn't); wired into CI.

## Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 249 passed (+7) |
| `next build` | ✅ success |
| boundary grep | ✅ no runtime client import of the server-only service/triggers/admin (only a `import type`); `events.ts` pure |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## Migration

**`20260617000003_customer_notifications.sql`** — new `client_notification` table (+ tenant trigger, dedup unique index, portal RLS) + additive `client_user` notify_* preference columns. Forward-only; `lib/db/types.ts` updated. Production: ships with `supabase db push`; no backfill (existing portal users default to all preferences ON).

## Live testing checklist

1. With Resend configured (or no-op), advance a dossier: each milestone creates **one** portal notification + (if prefs allow) one email; the portal `/portal/notifications` center and dashboard widget show them.
2. **Dedup**: release customs twice / retry a webhook → still **one** "Marchandise dédouanée" notification.
3. Mark-read and mark-all-read update the unread badge; no delete.
4. Preferences: turn off "Factures" → invoice emails stop, but the portal inbox still records (and the center still shows it).
5. Turn off master "Notifications par e-mail" → no emails on any event; portal inbox unaffected.
6. Cross-client isolation: a portal user never sees another client's notifications (RLS).
7. Audit log shows `notification.customer.created` (+ `…sent` per email) for each event.
8. No internal terms appear in any customer message.

## Constraints honoured

No workflow changes · no new lifecycle (events derive from existing lifecycle/actions) · no duplicate communication system (email via the Hub) · no SMS/WhatsApp · no cron / background workers · reuses Communications Hub + Resend + audit + portal architecture · single source of truth unchanged.
