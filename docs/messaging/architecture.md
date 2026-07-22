# Effitrans Messaging Center — Architecture (Phase 8.7)

## Why a new schema, and why it isn't a competing identity model

Before writing any code this phase audited every existing candidate table: the Logistics and
Platform Copilots persist **nothing** (session-only, client-resent history — see
`lib/copilot/*`, `lib/ai/*`), `notification`/`client_notification` are one-way system-generated
feeds with no sender/thread concept, and `communication_message` is a one-way outbound **email**
queue. None supports a two-way, multi-participant, staff-and-customer-authored thread, so
`conversation` / `conversation_participant` / `message` / `message_attachment`
(`supabase/migrations/20260722000001_messaging_center.sql`) are genuinely new tables.

They are **not** a new identity model. Every sender/participant is exactly one of the three
identity classes that already exist — `app_user` (staff), `client_user` (portal customer), or
neither (`system`/`ai`) — mirrored on `message` as `sender_type` + two nullable typed FK columns
(`sender_user_id`, `sender_client_user_id`), the same split `audit_log` already uses
(`actor_id` / `client_user_id` / `platform_actor_id`). A CHECK constraint ties `sender_type` to
which column is populated, so a message can never claim to be staff-authored while carrying a
customer id or vice versa.

## Data model

| Table | Purpose |
|---|---|
| `conversation` | One thread. `type` ∈ `direct_staff \| department \| dossier \| customer_support`. `department_code` reuses `lib/portal/self-service.ts`'s existing `CONTACT_DEPARTMENTS` (`documentation, customs, transport, finance, general`) — **not** the 15-queue process-engine department list, which is gated behind a flag that's dark for most tenants and would have made messaging depend on the process engine for no reason. `file_id` links a dossier (and, transitively, its 1:1 `shipment` — no separate `shipment_id` column; that would duplicate an existing relationship). `status` ∈ `open \| waiting_customer \| waiting_effitrans \| resolved \| closed`. |
| `conversation_participant` | Explicit membership for `direct_staff`/`dossier` threads. Department-level access does **not** require a row here — it's permission-based (see Security). A participant auto-joins the first time they open a conversation they can already access (`touchStaffParticipant`/`touchPortalParticipant`), which is also how `last_read_at` (and therefore unread counts) gets set. |
| `message` | Immutable after sending (no edit window — the simpler of the two options the spec offered). `visibility` ∈ `shared \| internal`; a customer can never author `internal` (schema-enforced). Moderation is a **redaction**, not a delete: `redacted_at`/`redacted_by`/`redaction_reason` are set and the body is overwritten with a fixed placeholder; the row, its position in the thread, and its timestamp are preserved. |
| `message_attachment` | One row per uploaded file; storage details only (see Attachments). |
| `tenant_messaging_rollout` | Per-tenant enablement, independent of the process engine's `tenant_process_rollout` (see Rollout). |

## Permissions

`messaging:read` / `messaging:send` (direct/dossier threads you participate in), five narrow
`messaging:read:<department>` permissions (department-wide access, no participant row needed),
`messaging:manage` (assign/close/reopen/add-remove participants), `messaging:moderate` (redact).
Granted per role in `supabase/seed.sql` + mirrored in `lib/platform/role-templates.ts` (parity
enforced by `tests/role-templates.test.ts`) — never to `CLIENT_USER`, `PARTNER_AGENT`, `DRIVER`,
or `COURIER`, the same external/narrow-identity exclusion `logistics:copilot:read` already uses.

## Realtime model — deliberately polling, not a Supabase Realtime channel

An exhaustive repo-wide grep before writing any UI code confirmed **Supabase Realtime is used
nowhere in this codebase** — no `supabase.channel()`, no `postgres_changes` subscription, not
even for live tracking (`TRACKING_REALTIME_ENABLED` exists as a flag but has zero callers). There
is no channel-naming convention, no precedent for Realtime-specific RLS authorization, and no way
to verify one under this phase's time constraints without a live database to test against.
Introducing the first Realtime channel in the codebase as an unproven, unverified authorization
surface would have been the least honest choice available.

Instead, `components/messaging/messaging-center.tsx` and
`components/portal/messaging/portal-messaging.tsx` poll `fetchStaffConversations` /
`fetchStaffConversationDetail` (and their portal equivalents) every 8 seconds while mounted — the
same "load on mount, load on interaction" idiom `NotificationBell` already uses, just with an
added interval. **Persisted rows are the only source of truth.** A poll never claims a message was
"delivered"; it just reconciles the UI with whatever the server has already committed. This
satisfies every REQUIRED realtime behavior (new messages appear without a manual refresh, unread
counts update, the conversation list updates, reconnection after a network blip is simply the next
successful poll) without inventing a new, unverified security boundary. A true Realtime channel is
a reasonable follow-up once this schema/RLS foundation has run in production.

## Notifications

Reuses the **two existing** notification tables rather than adding a third:
- Staff: `public.notification`, extended with two new types (`MESSAGE_RECEIVED`,
  `CONVERSATION_ASSIGNED`) and a nullable `conversation_id` column, written via the existing
  `createNotification()`.
- Portal: `public.client_notification`, extended with a new `category = 'message'` and a nullable
  `conversation_id` column, written via a **direct insert** (`lib/messaging/notify.ts`) — not the
  templated `notifyCustomer()` pipeline, which renders fixed lifecycle-event templates and has no
  template for free-text user content. The `dedup_key` is `messaging:<message.id>` — the message id
  is already globally unique, so (unlike lifecycle-event dedup, which collapses *retries of the same
  event*) every real message gets exactly one notification.

Department-wide recipients (a customer's first message, or a reply on an unassigned
conversation) are resolved live via `resolveStaffWithPermission()` — a `role_permission` →
`user_role` → `app_user(status='active')` join — never a hardcoded staff list.

## Attachments

Mirrors `lib/documents/storage.ts` (private bucket, service-role only, 60-second signed URLs,
never a public URL) and `lib/brand/assets.ts`'s validation discipline (the declared MIME type is
never trusted alone — the actual byte signature is checked; filenames are sanitized before ever
reaching a storage path). New private bucket `messaging-attachments` (15 MB limit, same five MIME
types as `documents`: PDF/PNG/JPEG/DOCX/XLSX). See `docs/messaging/security.md` for the full
threat-relevant detail.

## PWA / mobile

`public/sw.js`'s cacheable-static allowlist (`/_next/static/`, `/icons/`, `/favicon.ico`) was
**not modified** — messaging routes were never added to it, and don't need to be: every navigation
is already network-only and never cached (the existing, unchanged Phase 8.3 contract), and
messaging has no dedicated `/api/*` route to accidentally cache (all reads/writes are Server
Actions). `tests/messaging.test.ts` pins the allowlist to its original three patterns as a
regression guard.

## Staff recipient picker (Phase 8.6A)

The "start a direct conversation" form originally asked for the colleague's raw `app_user.id`
(a UUID) — functional, but not production UX, and it leaked an internal identifier into a form
field. `lib/messaging/staff-directory.ts:searchStaffRecipients(query)` replaces it with a
searchable combobox (`components/messaging/staff-recipient-picker.tsx`).

**Not a new employee directory.** The existing admin-scoped reader
(`lib/users/service.ts:listUsers`, gated on `admin:users:manage`) was deliberately **not** reused
— it's for the `/users` admin screen and returns admin-only fields (presence, login metadata,
onboarding state) to admins only. This reader needed a narrower gate (`messaging:send` — any
staff member who can message someone, not just admins) and a narrower field set (id, name, email,
role label, department label — nothing else), so it's its own small, purpose-built reader rather
than a widened admin one.

**Bounded, not a directory dump.** The reader pulls at most `CANDIDATE_CEILING = 200` active,
same-tenant `app_user` rows (excluding the caller), joins `user_role`/`role` for each (also
tenant-filtered), computes a display role/department label per user, then calls the PURE function
`searchStaffDirectory()` (`lib/messaging/access.ts`) to filter by substring match across
name/email/role-label/department-label and cap the RETURNED set at `RESULT_LIMIT = 8`. For this
business's realistic staff count, 200 is effectively "the whole active roster" — the ceiling exists
so this reader can never become an unbounded table scan if that assumption ever changes, not
because 200 is expected to bind in practice.

**Department label derivation reuses, rather than duplicates, an existing association.** A role's
department (e.g. `CUSTOMS_DECLARANT` → "Douane") is NOT a new registry — it mirrors the EXACT
role↔department pairing already granted in `supabase/seed.sql`'s `messaging:read:<dept>`
`role_permission` inserts (Phase 8.7). `lib/messaging/access.ts:roleDepartmentCode()` is
deliberately a *partial* map: a role that holds several department permissions at once
(`SYSTEM_ADMIN`, `OPS_SUPERVISOR`, `COORDINATOR`, `CHIEF_OF_TRANSIT`, `ACCOUNT_MANAGER`) or none
(`QUOTATION_MANAGER`, `COMPLIANCE_HSSE`) resolves to `null` rather than an arbitrary or fabricated
label — `tests/messaging-recipient-picker.test.ts` asserts every *mapped* role's single department
against the actual seed.sql grant, so the two can't silently drift apart.

**Direct-conversation reuse.** Before Phase 8.6A, every "start a conversation" call created a
brand-new `direct_staff` conversation, even between the same two colleagues. `createDirectConversation`
now looks for an existing **OPEN** `direct_staff` conversation where both users are still current
(non-removed) participants (`findOpenDirectConversation` in `lib/messaging/actions.ts`) and, if
found, adds the new message there instead of spawning a duplicate thread. A **closed** prior thread
does not count — a fresh conversation begins, consistent with "closed conversations don't silently
reopen" everywhere else in this feature. This only touches `direct_staff`; `dossier`, `department`,
and `customer_support` conversations are unaffected.

## Rollout

`tenant_messaging_rollout` (one row per tenant) + `EFFITRANS_MESSAGING_CENTER_ENABLED` env kill
switch, resolved by `lib/messaging/rollout.ts` — deliberately **independent** of
`tenant_process_rollout`/`ROLLOUT_FEATURES` (the 26-step engine's rollout table), since messaging
has no dependency on that engine and forcing it in would have coupled two unrelated capabilities
under one constraint (`process_engine` gates its sub-capabilities; messaging must not be gated by
it). Same fail-closed rule: a missing row, a query error, or an unresolved tenant all mean
**disabled**. Managed from the existing `/platform/rollout` console (a second, independent section
added below the process-engine controls) via `lib/platform/messaging-rollout-actions.ts`
(`platform:rollout:manage`-gated, audited).

**What the rollout flag actually gates — and what it deliberately does not.** It controls
**discoverability**: the "Messagerie" sidebar entry (`lib/navigation/build.ts`) and the portal
shell's "Messages" link. It does **not** block `/messages`, `/messages/[id]`,
`/portal/messages`, or `/portal/messages/[id]` themselves, and it does not gate
`createSupportConversation`/`contactEffitrans`. Reason: "Contacter Effitrans"
(`lib/portal/self-service-actions.ts`) is an **always-on, pre-existing** customer feature that this
phase upgraded from a one-way, unthreaded task into a real conversation — it must keep working
for every tenant regardless of rollout state, and staff must always be able to open and answer the
resulting conversation on a direct link. Authorization for those pages is the `messaging:read`
permission (staff) / active portal session + RLS ownership (customer) — exactly like every other
page in the app; rollout is a navigation-discovery control, not a second authorization layer.
