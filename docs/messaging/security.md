# Effitrans Messaging Center — Security Model (Phase 8.7)

## The core rule: RLS is SELECT-only, writes are server-action-mediated

Every messaging table (`conversation`, `conversation_participant`, `message`,
`message_attachment`) has RLS enabled with **only SELECT policies** for `authenticated` — there is
no INSERT/UPDATE/DELETE policy anywhere in the migration. This is the exact same convention every
other module in this codebase follows (customs, tasks, portal admin actions): a write is only
possible through a service-role server action that (1) `assertPermission`/resolves the session,
(2) re-derives tenant/participant/ownership from a **freshly loaded row**, never from client input,
(3) writes via the admin client, (4) audits, (5) revalidates. `tests/messaging.test.ts` asserts
this structurally (no `for insert/update/delete` policy exists on either table).

## Why sender identity cannot be forged

`sendMessage`/`createDirectConversation`/`createDossierConversation`/`createDepartmentConversation`
(staff) and `sendPortalMessage`/`createSupportConversation` (portal) never accept a `senderId` or
`senderType` parameter — their input types don't have one. `sender_user_id`/`sender_client_user_id`
are always set from `user.id`, where `user` is the value `assertPermission()` /
`getCurrentPortalUser()` resolved from the authenticated session. The database backstops this too:
a CHECK constraint ties `sender_type` to which of the two identity columns is non-null, so even a
hypothetical future bug in a server action that DID accept client input couldn't produce a message
that claims to be staff-authored while carrying a `client_user` id.

## Read authorization

**Staff** (`lib/messaging/service.ts`) reads go through the RLS-respecting user-context client —
unlike most of this codebase's admin-scoped reads, there is no separate "visibility scope" helper
to duplicate, because the SELECT policy IS the authorization:

```sql
create policy conversation_staff_select on public.conversation
  for select to authenticated
  using (public.messaging_staff_can_access_conversation(id));
```

`messaging_staff_can_access_conversation(p_conversation)` (security definer) is true when the
caller is tenant-matched **and** (an explicit `conversation_participant` row exists for them, OR
they hold `messaging:read:<department>` for the conversation's department, OR they hold
`messaging:manage`). `message`/`message_attachment` policies join through to the same function.

**Portal** reads are scoped to `client_id = auth_portal_client_id()` — the caller's own,
RLS-resolved customer, never a client-supplied id. The portal `message` SELECT policy additionally
requires `visibility = 'shared'`:

```sql
create policy message_portal_select on public.message
  for select to authenticated
  using (visibility = 'shared' and public.messaging_portal_can_access_conversation(conversation_id));
```

An internal staff note is therefore invisible to a portal customer **at the database level** — not
merely filtered out by application code, which is what makes it safe against a future UI bug.

## Write authorization (server actions, since RLS grants none)

Because the admin client bypasses RLS, every write action re-implements the equivalent check by
hand: `loadConversationForStaff()` (staff) loads the conversation, checks `tenant_id` match, then
checks the same three-way OR (participant / department permission / `messaging:manage`) RLS
encodes. Portal actions check `conv.tenant_id !== user.tenantId || conv.client_id !==
user.clientId` before any write. A closed conversation is rejected by `canMessageConversation()`
for both audiences before an insert is attempted.

## Attachments

- **MIME allow-list is not trusted alone.** `validateAttachmentUpload()` additionally checks the
  actual byte signature (PNG: `89 50 4E 47`, JPEG: `FF D8 FF`, PDF: `%PDF`, DOCX/XLSX: `PK` zip
  header) — a renamed executable with a spoofed `Content-Type` is rejected as `invalid_signature`
  even if the declared MIME type is on the allow-list.
- **Filenames are sanitized** (`sanitizeAttachmentFilename`) before ever reaching a storage path —
  path traversal (`../../etc/passwd`) and non-`[A-Za-z0-9._-]` characters are stripped.
- **Storage paths are server-generated and unguessable**: `{tenantId}/{conversationId}/{uuid}.ext`,
  never derived from the original filename.
- **The bucket is private** (`messaging-attachments`, `public: false` in the migration) with no
  `storage.objects` policy for `authenticated` — the only access path is a signed URL, minted by
  `createAttachmentSignedUrl()` (60-second TTL) **after** the caller's conversation access has
  already been verified by the same load-and-check the parent message uses. Attachment RLS itself
  additionally mirrors the parent message's visibility rule, so a portal customer can never reach an
  attachment on an internal-only note even via a guessed/leaked attachment id.
- **15 MB size limit**, enforced both by the bucket's `file_size_limit` and by
  `validateAttachmentUpload()` before the upload is even attempted.

## Revoked / inactive identities

- A `DISABLED` portal user: `getCurrentPortalUser()` still resolves the row, but every portal
  messaging action explicitly checks `user.status !== "ACTIVE"` and denies before touching the
  database — the same gate every other portal action in this codebase already uses.
- An inactive/archived staff user: `getCurrentUser()` (which `assertPermission()` calls) already
  returns `null` for any non-`'active'` `app_user` row — this is pre-existing, tested behavior
  (`tests/customer-identity-routing.test.ts` and others), reused unmodified here.

## Cross-tenant / cross-customer isolation

Proven three ways:
1. **RLS** — every SELECT policy filters by `auth_tenant_id()`/`auth_portal_tenant_id()` and, for
   portal, `auth_portal_client_id()`. `supabase/tests/rls_messaging_test.sql` (CI, `rls-tests` job)
   seeds a second tenant and a second customer and asserts zero cross-boundary reads.
2. **Server actions** — every write re-checks `tenant_id`/`client_id` against the resolved session
   before touching a row (never trusts a client-supplied id).
3. **Structural tests** — `tests/messaging.test.ts` scans the action source for these exact checks,
   so a future edit that removed one would fail CI even without a database.

## Audit

Ordinary sends are audited by **id + safe metadata only** (`messaging.message.sent`: conversation
id, message type, visibility) — the immutable `message` row is itself the record of what was said,
so the audit log doesn't duplicate the body. Structural events are fully audited:
`messaging.conversation.created`, `.assigned`, `.closed`, `.reopened`,
`messaging.participant.added`/`.removed`, `messaging.attachment.uploaded` (metadata: MIME type,
size — never the file), and `messaging.message.redacted` (who, and the moderation reason — the
original body is not preserved in the audit payload beyond what's already in the DB row, matching
the redaction's own "overwrite, don't delete" contract).
