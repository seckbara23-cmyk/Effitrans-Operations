# IA Decision — "Communications" → "Enterprise Mail"

**Date:** 2026-08-08 · **Commit:** `d509b55` · **CI GREEN — run #376: `rls-tests` 81/0/0, `build` 10/0/0**
**Migration: none.** An information-architecture change, not a schema change.

---

## The decision

The workspace formerly at `/communications` **is** the Enterprise Mail Platform: inbound
capture, triage, thread correlation, compose/reply, outbound dispatch, attachment ingestion,
audit and Unified Timeline integration.

**"Communications" is now RESERVED** for a future omnichannel workspace — SMS, WhatsApp,
customer-portal messaging, notifications, AI notifications. Those channels must not be forced
into a mail workspace, and keeping the general name attached to the specific product is what
would have forced them.

## Canonical route: `/mail`

Chosen over `/enterprise-mail` because every other workspace in this platform is a single word:
`/files`, `/clients`, `/finance`, `/air`, `/commercial`, `/shipping`, `/transport`.

| Old | New |
|---|---|
| `/communications` | `/mail` |
| `/communications/triage` | `/mail/inbox` |
| `/communications/triage/:id` | `/mail/inbox/:id` |
| `/communications/mailboxes[/:id]` | `/mail/mailboxes[/:id]` |
| `/communications/compose` | `/mail/compose` |
| `/communications/threads/:messageId` | `/mail/threads/:messageId` |
| — | `/mail/sent`, `/mail/drafts` (new) |

Old paths are **permanently redirected** (308) in `next.config.mjs`, most-specific first so
`/communications/triage` lands on `/mail/inbox` rather than being swallowed by the catch-all.
Permanent rather than temporary because the old prefix is retired, not briefly unavailable — a
308 lets browsers and bookmarks settle instead of re-asking forever.

## The label is English, and that was not the first answer

Every sibling nav label is French — **"Centre de marque"**, not "Brand Center". The first
attempt therefore used **"Messagerie d'entreprise"**, and it was **rejected on inspection**:

> Phase 8.7's Messaging Center is labelled **"Messagerie"** at `/messages`, **in the same nav
> section**. Two adjacent entries differing by one word, naming two unrelated systems — external
> email versus staff↔portal chat — is precisely the confusion this rename exists to end.

**"Enterprise Mail"** is a product name, collides with nothing, and is what the decision
specified. The reasoning is recorded in `lib/nav.ts` so the next person does not re-translate it.

## What was renamed

Sidebar label and key · workspace title and page headers (`meta="Enterprise Mail"`) · sub-navigation
tabs · i18n keys' values · route paths and every reference to them (44 files) ·
`components/communications/` → `components/mail/` · `communications-timeline.tsx` →
`mail-timeline.tsx` (and its exported symbol) · the alerts adapter file · department hub tile ·
documentation · test path constants.

## What was deliberately NOT renamed — these are contracts

| Kept | Why |
|---|---|
| `communication:read / send / manage / triage / inbound:read` | Deployed RBAC with live grants, under the three-source rule (migration + `seed.sql` + `role-templates.ts`). Renaming would revoke and re-grant permissions on a live tenant to change a string. |
| `public.communication_message`, every `ec_*` table | A table rename is a data migration with no functional benefit. |
| The `communication` event domain and `CORRESPONDENCE_*` types | **`business_event` is APPEND-ONLY.** Renaming a domain would orphan every row already written, or require rewriting history — which the whole Unified Tracking programme forbids. |
| Audit action codes (`communication.*`, `ec.*`) | `audit_log` is append-only for the same reason. |
| Storage buckets (`ec-inbound`, `documents`) | Renaming a bucket invalidates every stored path. |
| `communicationsAdapter` and its alert-source key | Internal identifier; churn without user-visible gain. |

**The rule:** rename what a user reads. Do not rename what a row remembers.

## Workspace structure

Shipped: **Boîte de réception · Nouveau message · Brouillons · Envoyés · Journal des envois ·
Boîtes aux lettres**, each permission-gated so an unreachable tab is absent rather than offered
and refused.

`Sent` and `Drafts` are **filtered views over the one outbound queue**, sharing a single list
component so they cannot drift into describing the same row differently.

**Archive and Attachments are named in the target IA and were NOT built.** Neither has a
backing surface, and an empty tab promising a page that does not exist is worse than its
absence. They arrive when they are built.

## Administration → Users → Enterprise Mail — not built here

That page is **EMP-4A** (`docs/mail/emp-4a-mailbox-provisioning-brief.md`), ratified the same
day as a separate audit-first phase whose STOP clause is live: `ec_mailbox` has no membership
concept, access is tenant-wide, so per-mailbox ACL is the new security boundary EMP-0 deferred
as RATIFY-EMP-2. Building provisioning inside a rename would have collapsed that separation.

## Test repairs — considered, not mechanical

The path rewrite touched 44 files and **inverted the intent of two assertions**:

1. **EMP-1's "no second inbox" list** had `app/communications/*` rewritten to `app/mail/*`, so it
   began forbidding the canonical routes it existed to protect. It now asserts
   `app/mail/inbox/page.tsx` **exists** while the plausible duplicates do not.
2. **UT-4's marker** asserted `app/mail` is absent — true when written, stale now that EMP-1..4
   shipped. Removed with a note: *a phase marker asserts what THAT phase did, never that a later
   programme never starts.* This is the fourth time that lesson has surfaced.

EC-2's canonical-route check, the sidebar label fixture and the adapter path were straightforward
updates.

---

## Confirmations

* **No migration, no schema change, no permission change, no RLS change.**
* **No ledger vocabulary was renamed** — `business_event` and `audit_log` are append-only.
* **Old routes redirect permanently**; nothing 404s.
* **Archive, Attachments and the Administration provisioning page were not built** — they belong
  to later work, and EMP-4A remains a separate phase.
* **EMP-5 and EMP-4A have not begun.**
