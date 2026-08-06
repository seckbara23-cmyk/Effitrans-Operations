# EMP-1 — Enterprise Mail Workspace & Mailbox Administration: Completion Report

**Date:** 2026-08-05 · **Commit:** `b0009cd` · **Baseline:** EMP-0 `4c01d61`
**Migration: NONE — chain unchanged at 86 (test-pinned) · No new table · No event journal ·
No timeline · No attachment system · No outbound · No permission created**

---

## 1. Required audit — and what it changed

| Question the brief required | Finding |
|---|---|
| Does a duplicate inbox already exist? | **Yes, in substance.** EC-2's triage queue (`/communications/triage`) already had status filters, `mine`/`unassigned` filters, mailbox/sender/date search, a detail view and queue counts. EMP-1's "views" are that queue renamed, not a second one. |
| Duplicate mailbox UI? | **No** — `ec_mailbox` had no surface at all; rows were operator-seeded. This was the real gap. |
| Duplicate admin tooling? | **No.** `/platform/operations` is a platform-wide console and covers no mail. |
| Existing operational dashboard? | **Partly** — `triageCounts` fed four stat cards. Reused as-is; mailbox/webhook posture was missing and is new. |

Consequence: **objectives 2–4 were largely reuse; objective 1 (mailbox administration) was the
only substantial build.** The phase was scoped accordingly rather than re-implementing a queue
that already worked.

## 2. Two architectural discoveries (reported, not silently handled)

### 2.1 No `ec_*` table has a write policy — and why no migration was added

EC-1 created **SELECT policies only** on all five `ec_*` tables. Under RLS that makes
`ec_mailbox` read-only to every session, so activation/deactivation cannot go through the
user-context client.

The two options were a migration adding an UPDATE policy — **a new write boundary in the
correspondence schema, which the brief says to stop for** — or the pattern this codebase
already established at EC-3C: the admin client **only** behind an explicit application gate.
EMP-1 took the second. The write is:

- gated on `communication:manage`, **stricter** than the read policy's
  `communication:inbound:read`;
- re-scoped with `.eq("tenant_id", user.tenantId)` on the update itself, so a forged id
  cannot cross tenants even with the permission held;
- audited (`ec.mailbox.activated` / `ec.mailbox.deactivated`);
- **exactly one mutation**, on one boolean — test-pinned that `.update(` appears once and
  that `.insert(`, `.delete(`, `.upsert(` appear never.

**No migration was necessary, so none was written, and no STOP was triggered.** If
defence-in-depth on this write is later wanted, an UPDATE policy is a clean additive change —
recorded as a governance option, not taken unilaterally.

### 2.2 The Quarantine view is unreachable BY CONSTRUCTION

EMP-1 lists "Quarantine" as a view. EC-1's CHECK constraint `ec_inbound_quarantine_shape`
requires `tenant_id IS NULL` whenever `capture_status = 'QUARANTINED'`, and every RLS policy
is `tenant_id = auth_tenant_id()`. A tenant-scoped quarantine list is therefore **permanently
empty — not "empty right now"**.

This does **not** contradict EMP-0, which anticipated it (RATIFY-EMP-11, quarantine review is
a platform-operator authority). EMP-1 therefore ships the view as an **explicit statement**
rather than an empty grid, and never issues the query. An empty table would have read as
"no mail was rejected" — a claim the platform cannot make — and would have invited a future
engineer to "fix" the blank view by weakening the constraint.

## 3. Architecture reused

`ec_mailbox` · `ec_inbound_message` · `ec_webhook_event` · `ec_inbound_attachment` ·
`ec_triage_item` · `tenant_ec_inbound_rollout` · `listTriageQueue` / `getTriageDetail` /
`triageCounts` / `listMailboxes` · the four ratified triage outcomes · `TriageStudio` ·
**`readDecisionPlane`** (subject-scoped, under the UT-1 `business_event_select` policy) ·
`labelFor` from the UT contract · the `communication:*` permission family · `writeAudit` ·
`StatCard`, `PageHeader`. **Nothing was rebuilt.**

## 4. Files

**New:** `lib/ec/mailboxes/service.ts` (reads + capture evidence) ·
`lib/ec/mailboxes/actions.ts` (the one write) · `app/communications/layout.tsx` ·
`app/communications/mailboxes/page.tsx` · `app/communications/mailboxes/[id]/page.tsx` ·
`components/ec/mail-nav.tsx` · `components/ec/mailbox-toggle.tsx` ·
`components/ec/message-evidence.tsx` · `tests/emp-1-mail-workspace.test.ts`.

**Modified:** `lib/ec/triage/service.ts` (additive filters + view vocabulary + one shared
search sanitizer replacing an inline one) · `app/communications/triage/page.tsx` (views,
subject/recipient/dossier search) · `app/communications/triage/[id]/page.tsx` (evidence
panel) · `lib/audit/events.ts` (two action codes).

## 5. Why each reuse decision

- **Views over the existing queue, not a new inbox** — two inboxes over one table would
  eventually disagree about what "open" means.
- **RLS-bound client for all reads** — the policies exist and are CI-proven; the triage
  service reaches for the admin client, but where the weaker tool suffices it is the one to
  use, and the application gate on top only ever narrows.
- **`readDecisionPlane` for message history** — the ledger already had a subject-scoped
  reader and a policy covering `event_domain = 'communication'`. A second reader would have
  been a second visibility rule.
- **Mailbox activation only; no create, no delete, no address edit** — addresses are globally
  unique because two tenants claiming one makes routing a guess, and captures reference the
  mailbox as evidence. Retire, never delete.
- **Dossier search resolved through RLS before filtering** — an unresolved number yields
  **no rows**, never a dropped filter. A search that silently returns more than asked is the
  kind of bug nobody reports.

## 6. Migration

**None.** Test-pinned: the chain ends at `20260810000001_decision_plane_emitters.sql` with
86 files.

## 7. Tests

`tests/emp-1-mail-workspace.test.ts` — **34 contracts**: no migration · no second inbox route ·
no module-table query from a page · Decision Plane reused · **zero outbound** (no `sendEmail`,
`queueAndSend`, `communication_message`, resend/smtp/nodemailer, no reply/compose strings) ·
RLS-bound reads · exactly one admin write behind `communication:manage` · no create/delete ·
secret never displayed · **no SYSTEM_ADMIN anywhere** · audit on every state change · no body
ever read · no mutation of any evidence table · integrity hash surfaced · the five views and
their filter semantics · quarantine declared unreachable and never queried · the capture
constraint still present · one shared search sanitizer · unresolved-dossier honesty ·
reachability via the shared layout · permission-gated tabs · every capture outcome labelled ·
no emoji · deactivation warns it quarantines future mail.

**Local: 208 files / 5200 tests green · tsc 0 · build compiled** (all five
`/communications/*` routes present).

## 8. Security review

No new security boundary. Reads go through policies that already existed; the one write is
narrower than the read gate, tenant-re-scoped and audited. Evidence tables are never mutated.
No message body is read anywhere in the workspace. The webhook secret is reported as
configured-or-not and never displayed. `SYSTEM_ADMIN` appears in no EMP-1 file. Ledger
visibility follows the subject, and the panel **says so** rather than presenting a possibly
truncated history as complete.

## 9. Deployment implications

**None beyond a deploy of `main`.** No migration, no permission, no environment variable, no
flag change. The workspace stays dark exactly as EC-1/EC-2 are: `communication:inbound:read`
is still granted to no role pending RATIFY-EC1-1, and capture still requires both
`EFFITRANS_EC_INBOUND_ENABLED` and the tenant rollout row. The mailbox dashboard now shows
both halves of that flag pair, so an operator can see which one is holding mail back.

## 10. Remaining EMP roadmap

| Phase | Status |
|---|---|
| **EMP-2** — thread correlation (`in_reply_to` / `references_header`) | untouched, as required |
| EMP-3 — reply/compose + `CORRESPONDENCE_SENT` emitter | blocked on RATIFY-EMP-6/7 + a live provider |
| EMP-4 — attachment → document ingestion | blocked on RATIFY-EMP-8 |
| EMP-5 — AI suggestions (no autonomous send) | blocked on EMP-1..3 + DPA |
| EMP-6 — customer visibility | blocked on RATIFY-EMP-10 |

**Open ratifications:** RATIFY-EMP-1..11 (EMP-0), RATIFY-EC1-1 (grants
`communication:inbound:read` to a role — until then the entire workspace 404s, by design).
**New governance option recorded:** an additive UPDATE policy on `ec_mailbox` if
defence-in-depth on the one write is wanted.

---

## Confirmations

* **EMP-1 is complete.** Operational mailbox administration, operational mail workspace,
  immutable message viewing and operational search all exist.
* **Zero duplicate architecture** — no new table, event journal, timeline, attachment system
  or mailbox model; the views are filters over the queue that already existed.
* **Zero outbound functionality** · **zero customer visibility** · **zero AI functionality** —
  each pinned by test.
* **No migration** (chain 86, pinned) · **no new permission** · **no new security boundary**.
* **EMP-2 remains untouched.**
