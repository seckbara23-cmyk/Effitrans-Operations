# EMP-2 — Enterprise Mail Thread Correlation: Completion Report

**Date:** 2026-08-05 · **Commit:** `54a45b0` · **Baseline:** EMP-1 `b0009cd` / `04087c0`
**Migration: NONE — chain unchanged at 86 (test-pinned) · No new table · No RLS policy ·
No event · No emitter · No write path · No outbound · No AI · No customer visibility**

> **CI STATUS: GREEN — verified after the fact.** Run **#363** on `54a45b0` completed
> `success`: `rls-tests` 79 steps / 0 skipped / 0 failed, `build` 10 / 0 / 0.
>
> This report was first written during a **GitHub Actions platform outage** (incident opened
> 2026-08-06T15:22:49Z, `Actions` component `major_outage`) which suppressed run CREATION for
> ~30 minutes per push. Nothing in the repository was misconfigured; the full diagnosis is in
> `docs/ops/ops-ci-1-actions-trigger-audit.md` (root cause `GITHUB_INCIDENT`). The earlier
> "not verified" caveat is discharged. Local gate also green: 209 files / 5245 tests, tsc 0.

---

## 1. Mandatory audit — what already existed

| Subject | Finding |
|---|---|
| RFC 5322 fields stored | **All three, since EC-1**: `message_id`, `in_reply_to`, `references_header`, plus a derived `thread_key`. Nothing new had to be captured. |
| Existing correlation logic | **`deriveThreadKey`** (`lib/ec/inbound/parse.ts`) — computed at capture, stored per message, and indexed (`idx_ec_inbound_thread`). Its own comment says *"EC-4 will correlate on it; EC-1 only records it."* **Nothing consumed it.** |
| Existing correspondence linking | `ec_triage_item.outcome_file_id` / `outcome_client_id` (EC-2). Reused; not re-modelled. |
| Existing dossier matching | Human act at triage. Untouched — EMP-2 adds no automatic matching. |
| Attachment ownership | `ec_inbound_attachment` keyed by `(tenant_id, message_id)`, immutable. Reused by count only; **no second attachment model**. |
| Timeline consumption | `readDecisionPlane({subject})` under UT-1's `business_event_select`, which already admits `event_domain='communication'`. Reused verbatim. |

**The gap `deriveThreadKey` leaves.** It keys each message on `References[0]`, else `In-Reply-To`,
else its own `Message-ID` — computed **locally, per message**. A reply that omits `References`
and carries only `In-Reply-To: <b>` keys on `<b>`, while the thread root keys on `<a>`. **One
conversation, two keys.** The key is therefore a good *candidate filter* and an unusable
*identity*, which is exactly how EMP-2 uses it.

## 2. The architectural finding that decided the design

`ec_inbound_message` carries `trg_ec_inbound_message_immutable`, which runs `prevent_mutation`
on **update or delete** — it raises unconditionally. So a `thread_id` column could never be
populated for existing rows: **the backfill is not discouraged, it is impossible.** The brief
independently forbids rewriting historical messages, and the two agree.

Conversation identity is therefore **derived**, and every property the brief demands follows
from the derivation rather than from a table:

| Requirement | How it is met |
|---|---|
| immutable | inputs are immutable headers, so the output cannot change |
| deterministic | pure function; same set → same identity, always |
| survives reprocessing | nothing stored, so nothing can drift out of sync |
| survives provider changes | keyed on RFC headers, never on provider ids |
| tenant isolated | computed over a tenant-scoped RLS read |
| audit friendly | reproducible from the evidence alone, no hidden state |

**Consequence: no migration, and no new RLS policy — so no STOP was triggered.**

## 3. The algorithm

1. **Normalize** each msg-id: strip angle brackets and whitespace; take the first bracketed
   token when a relay appended commentary; reject anything with internal whitespace, over 998
   chars, or **without an `@`** (an RFC 5322 msg-id is `id-left "@" id-right`).
   **Case is never folded** — RFC 5322 makes the local part case-sensitive, and folding could
   merge two distinct threads.
2. **Union** every identifier a message carries — own `Message-ID`, `In-Reply-To`, and all of
   `References` — because one message naming them is evidence they are one conversation.
3. **Anchor** by the brief's priority: `Message-ID` → `In-Reply-To` → `References` → synthetic.
   The anchor decides the reported `basis`; the equivalence class is the same either way.
4. **Identity** = the lexicographically smallest id in the class, chosen by the union-find's
   merge rule. Order-independent, so arrival order cannot change it.
5. **Never neither, never both:** a message with no usable identifier gets `row:<uuid>` — a
   thread of one that cannot collide with a real thread or with another synthetic.

**Splitting is safer than merging.** A missed link shows two threads where there was one:
incomplete, and visibly so. A false link shows unrelated correspondence as one conversation —
a correctness and confidentiality failure. Every ambiguous case resolves toward splitting.

**Thread merges are real and correct.** A later bridging message can join two previously
separate threads. They were always one conversation; the platform merely lacked the evidence.
Identity remains deterministic for any given message set, and no historical row is touched.

**Scale.** Resolution does not load the tenant's mailbox. The seed expands one hop at a time
over three indexed reads (`message_id`, `in_reply_to`, `thread_key`) plus a `references_header`
substring match, to a fixed point or a bound (4 hops / 400 messages). **The cheap index
filters; the exact algorithm decides.** A truncated conversation is declared, not hidden.

## 4. Architecture reused

`ec_inbound_message` (read-only) · the stored `thread_key` and its index, as a candidate filter ·
`ec_triage_item` via `listTriageQueue` for routing outcome and dossier link ·
`ec_inbound_attachment` counts through the same reader · **`readDecisionPlane`** for
correspondence events · `labelFor` from the UT contract · EC-1's RLS policies ·
`communication:inbound:read`. **Nothing was rebuilt, and no second model of anything was
introduced.**

## 5. Files

**New:** `lib/ec/threads/resolve.ts` (pure) · `lib/ec/threads/service.ts` (reads) ·
`app/mail/threads/[messageId]/page.tsx` · `components/ec/thread-view.tsx` ·
`tests/emp-2-thread-correlation.test.ts`.
**Modified:** `app/mail/inbox/page.tsx` (Message-ID lookup) ·
`app/mail/inbox/[id]/page.tsx` (link to the conversation).

The route is keyed on the **message row id**, not a thread id: a derived identity is only
meaningful relative to the messages currently captured, so it must not become a URL.

## 6. Tests — 45 contracts

Behavioural over the resolver: normalization (brackets, relay commentary, **no case folding**,
`@` required, length bound) · References parsing (order, de-duplication, folded headers,
garbage dropped) · exactly one thread per message, never neither, never both · In-Reply-To
joins · deep References chains · **the `thread_key` gap repaired** · basis reporting · anchor
priority · **subject/sender/date can never define a thread** (the resolver has no such field —
pinned by source) · determinism across arrival order · stability across reprocessing ·
identity preserved when a later reply arrives · merge on a bridging message · identity derived
from headers, never a row id.

Structural: no migration (chain 86) · no write anywhere · no conversation/chat/messaging model ·
reads only the capture table · **no event, emitter or second journal** · Unified Timeline
consumed through the existing reader · RLS-bound reads · gated on `communication:inbound:read` ·
every read tenant-scoped (count-matched) · **no SYSTEM_ADMIN** · no body read · PostgREST
filter sanitization · nothing from a later phase (compose/reply/SMTP/IMAP/POP3/templates/AI) ·
no customer surface · the view is read-only (no form, no `useTransition`, not a client
component) · honesty strings · route keyed on message id.

**One real defect found by these tests:** `parseReferences("garbage <b@x> !!!")` returned
`!!!` as an identifier. Two messages carrying the same garbage token would have **merged into
one conversation** — a direct violation of the module's own splitting-is-safer rule. Fixed by
requiring `@`, which is a structural RFC check rather than a heuristic.

## 7. Security

No new boundary. Reads use the RLS-bound client only — **the admin client appears nowhere in
this phase**. Every `ec_inbound_message` read is tenant-scoped, and the count of tenant
predicates is asserted to equal the count of reads. The view is gated on
`communication:inbound:read`; `SYSTEM_ADMIN` appears in no EMP-2 file. No message body is read.
Message-ID search resolves through RLS, so an id from another tenant is simply not found and
the search cannot be used to probe for the existence of another tenant's correspondence.
Evidence remains immutable: there is no write path in the phase at all.

## 8. Deployment implications

**None beyond a deploy of `main`.** No migration, permission, flag or environment variable.
The workspace remains dark: `communication:inbound:read` is still granted to no role pending
RATIFY-EC1-1.

## 9. Remaining EMP roadmap

| Phase | Status |
|---|---|
| **EMP-3** — reply/compose + `CORRESPONDENCE_SENT` emitter | **untouched**, as required; blocked on RATIFY-EMP-6/7 and a live provider |
| EMP-4 — attachment → document ingestion | blocked on RATIFY-EMP-8 |
| EMP-5 — AI suggestions (no autonomous send) | blocked on EMP-1..3 + DPA |
| EMP-6 — customer visibility | blocked on RATIFY-EMP-10 |

Open: RATIFY-EMP-1..11, RATIFY-EC1-1. **New governance note:** EMP-3 will be the first phase
needing an outbound message to join a thread; outbound rows live in `communication_message`,
which has no RFC headers today — that is an EMP-3 design question, not an EMP-2 gap.

---

## Confirmations

* **Deterministic RFC 5322 correlation**, with subject/sender/date structurally excluded.
* **Immutable conversation identity**, derived rather than stored, order-independent and
  stable across reprocessing.
* **Read-only conversation view** — no form, no action, no mutation.
* **Zero duplicate architecture · zero new timeline · zero new event journal · zero outbound ·
  zero AI · zero customer visibility** — each pinned by test.
* **No migration** (chain 86, pinned) · **no new RLS policy** · **no STOP condition met**.
* **EMP-3 remains untouched.**
* **CI not yet verified** — see the banner above. This report is complete on every count
  except that one, which is outside the repository.
