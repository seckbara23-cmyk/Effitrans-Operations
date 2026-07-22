# Effitrans Messaging Center — Operator Acceptance & Rollout (Phase 8.7)

## Enabling the feature

1. Set `EFFITRANS_MESSAGING_CENTER_ENABLED=true` in the deployment environment (Vercel project
   settings). This is the global kill switch — with it unset/false, the feature is dark for every
   tenant regardless of the per-tenant flag below, and `/messages` / nav entries stay invisible.
   ("Contacter Effitrans" keeps working regardless — see `docs/messaging/architecture.md`'s
   Rollout section for why that one always-on path is intentional.)
2. As a platform administrator, open `/platform/rollout` → the **"Messagerie Effitrans"** section
   (below the process-engine controls) and enable the target tenant. This writes
   `tenant_messaging_rollout.enabled = true`, audited as `platform.messaging_rollout.updated`.
3. Confirm the tenant's staff roles were provisioned with the new `messaging:*` permissions — for
   the existing Effitrans tenant this is automatic (the migration grants them directly); for a
   **new** tenant, `lib/platform/role-templates.ts` already carries the grants, so normal
   provisioning covers it.

## Rollback

Uncheck the tenant's toggle at `/platform/rollout` (or flip `EFFITRANS_MESSAGING_CENTER_ENABLED`
back to unset for an immediate, deployment-wide kill). No data is deleted — conversations and
messages already created remain in the database and remain reachable by direct link (e.g. a
"Contacter Effitrans" reply thread); only the nav discoverability turns off.

## Manual acceptance scenario

Prerequisites: two Effitrans staff accounts with different department permissions (e.g. one
`CUSTOMS_DECLARANT`, one `SYSTEM_ADMIN`), one active customer portal account (Client A), one
second active customer portal account for a **different** client company (Client B), one dossier
belonging to Client A.

1. **Staff direct conversation.** Staff 1 opens `/messages` → "+ Nouvelle conversation" → enters
   Staff 2's user id + a message → Create. Confirm Staff 2 sees it (and its unread badge) on their
   own `/messages`.
2. **Dossier-linked context.** From the Client A dossier, staff (or the customer, via "Contacter
   Effitrans" on that dossier page) starts a conversation; confirm the dossier reference
   (`Dossier <number>`) appears in both the conversation list and the thread header.
3. **Internal note.** A staff member with `messaging:manage` (or any participant with
   `messaging:send`) opens the customer conversation, checks "Note interne", sends a note. Confirm
   it renders with the amber "Note interne — jamais visible du client" banner for staff.
4. **Customer cannot see the internal note.** Sign in as Client A's portal user, open the same
   support conversation. Confirm the internal note is **absent** from the thread — not just hidden
   by the UI; it must not appear even after a hard refresh (RLS-enforced).
5. **Cross-customer isolation.** Sign in as Client B. Attempt to open Client A's conversation by
   its URL (`/portal/messages/<Client A's conversation id>`). Confirm it is not visible (empty/
   "not found" state, never Client A's content).
6. **Permitted attachment.** From either side, attach a PDF or PNG under 15 MB. Confirm it uploads,
   appears in the thread, and downloads via the 📎 link (a signed URL, not a public one — the URL
   should not work if copied and opened in an incognito window more than ~60 seconds later).
7. **Blocked attachment.** Attempt to attach a disallowed file type (e.g. rename a `.exe` to
   `.pdf`, or try a `.zip`). Confirm the upload is rejected client-side.
8. **Closed conversation.** As a manager, close the conversation. Confirm the composer disappears
   for both staff and the customer, replaced by a "clôturée" notice. Reopen it and confirm the
   composer returns.
9. **Android PWA.** Launch the installed PWA as the customer; confirm `/portal/messages` renders
   correctly (list + thread + composer), the on-screen keyboard doesn't obscure the composer, the
   attachment picker opens the native file/photo chooser, and the unread badge (sidebar/portal
   shell) is visible and legible.
10. **Desktop.** Repeat the core flow (send, attach, close/reopen) in desktop Chrome or Edge.
11. **Manual URL-access attempts.** While signed in as a staff member with NO messaging
    permission at all (e.g. `DRIVER`), attempt to open `/messages` directly. Confirm the "no
    access" notice, never conversation content. While signed out, attempt `/messages` and
    `/portal/messages` directly — confirm redirect to the correct login.

## Known limitations (by design, for this phase)

- **No true Realtime channel** — the UI polls every 8 seconds; see
  `docs/messaging/architecture.md`'s Realtime section for why.
- **No staff directory picker** for starting a new direct conversation — the "Nouvelle
  conversation" form asks for the colleague's raw user id. A proper picker is a natural follow-up.
- **No per-message read receipts** — only `participant.last_read_at`-derived unread counts, as
  the brief allowed.
- **No AI auto-reply** — the schema reserves `sender_type = 'ai'` and an `internal` visibility an
  AI draft could use pending human approval, but nothing generates one yet.
- **No push notifications** — only the existing in-app notification bell / portal inbox.
