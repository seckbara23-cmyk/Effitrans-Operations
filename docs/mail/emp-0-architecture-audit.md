# EMP-0 — Enterprise Mail Platform : Architecture Audit

**Date:** 2026-08-05 · **Baseline:** commit `1719a28`, CI run `31002422034` (rls-tests 79/79, build green), migration chain **86**
**Status: documentation only. No code, no SQL, no permission, no UI was changed by this phase.**

---

## 0. The central finding

**The platform already contains most of an Enterprise Mail Platform, built across three
programmes that did not call it that.** EC-1/EC-2 built the inbound spine (capture,
quarantine, evidence, triage). Phase 1.14/1.18 built the outbound engine (queue, provider
seam, branding). WES-9/UT-1..5 built the place mail becomes history (the Decision Plane and
the Unified Timeline), and migration 86 already emits `CORRESPONDENCE_RECEIVED` the moment a
message row is inserted. What does **not** exist is the workspace that makes these one
product — mailbox administration, thread correlation, reply/compose — and the outbound half
of the ledger vocabulary.

The consequence: **EMP is an extension programme, not a construction programme.** Every
phase below extends an existing bounded context; none introduces a parallel system.

---

## 1. Architecture discovered

### 1.1 Inbound capture — EC-1 (migration 80, `20260804000001_ec_inbound_foundation.sql`)

| Object | Role | Properties verified |
|---|---|---|
| `ec_mailbox` | tenant mail addresses | lowercase + shape CHECKs; active flag; **no admin UI exists — rows are operator-seeded** |
| `ec_webhook_event` | capture journal | outcomes `CAPTURED/DUPLICATE/QUARANTINED/REJECTED/ERROR`; **immutable** (`prevent_mutation`) |
| `ec_inbound_message` | the envelope | **immutable**; `capture_status RECEIVED/QUARANTINED`; quarantine is **capture-time only** (terminal); RFC 5322 `in_reply_to` + `references_header` captured — the migration itself says *"EC-4 will correlate on these"* |
| `ec_inbound_attachment` | attachment registry | **immutable**; hash-indexed; `stored` flag + typed `rejection_reason` |
| `tenant_ec_inbound_rollout` | per-tenant activation | two-layer flag with `EFFITRANS_EC_INBOUND_ENABLED` |

Raw bytes are preserved (`raw_storage_path`) in the **private** `ec-inbound` bucket; a
message whose tenant cannot be resolved is stored under a quarantine scope. The webhook
endpoint (`app/api/ec/inbound/[provider]/route.ts`) is machine-to-machine, verifies an HMAC
over the raw body, is dark unless the flag is set, and returns **a classification, never
content**. Provider abstraction exists: `INBOUND_PROVIDERS = ["GENERIC", "RESEND"]` behind
`getInboundProvider`.

### 1.2 Triage — EC-2 (migration 81)

`ec_triage_item` with a transition-guard trigger; **four ratified outcomes (Q-EC2-1), "there
is no fifth"**: `ATTACH_TO_DOSSIER` · `HANDOFF_TO_QUOTATION` · `GENERAL_CORRESPONDENCE` ·
`DISCARD` (typed reason codes). Attachment access is a 60-second signed URL that writes
`ec.correspondence.attachment_accessed` to the audit log. Cross-tenant attach is refused
twice (application + ownership). Capture **cannot** create a client or quotation by
construction; matching a sender to a client is a **human** act performed at triage.

### 1.3 The ledger already speaks mail — and the answer to the CORRESPONDENCE_RECEIVED question

The `communication` domain holds **eight** event types: `CORRESPONDENCE_RECEIVED` (emission
**trigger**), and `ASSIGNED / REASSIGNED / ATTACHED / QUOTATION_HANDOFF / RESOLVED /
DISCARDED` (emission **rpc**). Metadata carries **identifiers and codes only** — never a
subject, sender, filename or body.

**Where `CORRESPONDENCE_RECEIVED` originates:** migration 86's `emit_correspondence_received`
— `AFTER INSERT ON ec_inbound_message WHEN (new.tenant_id IS NOT NULL)`. The emitter is the
**database**, provenance origin `system`; quarantined-without-tenant messages deliberately do
not reach the ledger.

**Should Enterprise Mail become its source? No — and it must not.** EMP ingests **into**
`ec_inbound_message`; the event then exists by construction, in the same transaction as the
insert. A second emitter (application-level or a new RPC) would be the RPC-vs-trigger
double-emission trap WES-4 documented, and would violate the registry's single-emission
rule asserted in `tests/business-events.test.ts`.

**Defect found (code-level, cannot be fixed in a docs-only phase):** the registry comment
above the entry still reads *"CORRESPONDENCE_RECEIVED is RESERVED, deliberately"* — stale
since UT-3B flipped it to `trigger`. EMP-1 must correct the comment.

### 1.4 Outbound engine — Phase 1.14/1.18

`communication_message` (migration `20260615000008`): statuses `QUEUED/SENT/FAILED/CANCELLED`,
`retry_count`, `template_key` **NOT NULL** (template-driven only — free compose does not
exist), `file_id`, `client_id`, stored subject/body, branding read at queue time.
`lib/comms/queue.ts#queueAndSend` inserts then sends; `lib/comms/provider.ts` is the provider
seam — `COMMUNICATIONS_EMAIL_PROVIDER ∈ {smtp, resend}`, **dark no-op by default**, Resend
implemented, **`smtp` selected-but-unimplemented** (`provider_not_implemented`).

Callers today: quotation send, invoice send, payment links, portal invitations, staff
welcome/password, customer notifications (`notifyCustomer` → `client_notification`,
email-per-category **false by default**, `commercial` category added by migration 84).

**Verified absence:** no outbound path writes to `business_event` — `lib/comms`,
`lib/customer-notify`, `lib/notifications` contain **zero** ledger references. Outbound mail
is invisible to the Unified Timeline except where a domain RPC (e.g. `QUOTATION_SENT`)
happens to record the business fact.

### 1.5 Neighbouring systems that are NOT mail — and must stay distinct

| System | Why it is not EMP |
|---|---|
| Messaging Center (`conversation`/`message`, Phase 8.7) | staff↔portal chat; session-authenticated, no MIME, no external addresses |
| `client_notification` | a **delivery** record of what we told the customer, not correspondence |
| Marketing email (DBC-6) | brand governance artefact generation |
| `audit_log` | never a timeline or mail source (DEC-B88) |

### 1.6 Security envelope (existing)

- **RLS on all five `ec_*` tables:** `tenant_id = auth_tenant_id() AND
  has_permission('communication:inbound:read')`.
- **Permission family already exists:** `communication:read / send / manage / triage /
  inbound:read` — EMP needs at most additive codes, no new model.
- EC-1's migration header records that granting the administrator by default is **forbidden
  by EC-1's own security requirement** — SYSTEM_ADMIN holds no correspondence read.
- Immutability triggers on webhook event, message, attachment = **evidence preservation** is
  already structural.
- Triage reads use the **admin client behind an explicit app gate** (the EC-3C rule).
- All eight communication events are `clientSafe: false` — **customers currently see no
  correspondence anywhere**, including in UT-5's portal projection. Correct today.

---

## 2. Gap analysis

| Capability | Exists | Reuse candidate | New build required |
|---|---|---|---|
| Inbound capture, dedup, quarantine | **Yes** (EC-1) | as-is | — |
| Webhook signature + provider abstraction | **Yes** (GENERIC HMAC, RESEND) | as-is | additional provider adapters only when a real provider is chosen |
| Evidence preservation (raw MIME, immutability) | **Yes** | as-is | — |
| Triage with ratified outcomes | **Yes** (EC-2) | as-is | — |
| Ledger vocabulary — inbound | **Yes** (8 events, 1 trigger + 6 rpc + registry) | as-is | — |
| Ledger vocabulary — outbound | **No** | registry pattern | `CORRESPONDENCE_SENT` (+ possibly `REPLIED`) — registry rows + emitters |
| Mailbox administration UI | **No** (rows operator-seeded) | `communication:manage` gate, existing admin UI idioms | mailbox CRUD (retire-not-delete) |
| Mail workspace (read, search, thread view) | **Partial** (`/mail` triage only) | `/mail` shell, triage service | the workspace itself |
| Thread correlation | **No** (headers captured, unused — the reserved "EC-4") | `in_reply_to`/`references_header`, thread index | correlation logic; possibly additive thread key |
| Reply / free compose | **No** (`template_key` NOT NULL) | provider seam, `communication_message` | compose path + authority model (ratification) |
| Outbound↔inbound thread unification | **No** | both tables + correlation | read-model join (no sync engine) |
| Attachment → dossier document ingestion | **No** (signed-URL view only) | document pipeline; `DOCUMENT_UPLOADED` trigger emits for free | explicit staff "ingest as document" action |
| IMAP / POP3 polling | **No** | — | **do not build** (§6) |
| SMTP outbound | Seam accepts the value; unimplemented | provider seam | only if a real SMTP need is ratified |
| Legal retention policy | **No** (indefinite immutable retention today) | — | ratified policy first; never invent Senegal rules |
| Customer visibility of correspondence | **No** (all `clientSafe: false`) | UT-5 projection, allow-list | ratification first |
| AI (classify / summarize / suggest) | **No** for mail (doctrine exists in Doc-Intel 7.4A) | suggestions-only doctrine, `runCopilot` patterns | EMP-late phase, human approval mandatory |

---

## 3. Required architectural decisions (ratification before implementation)

| Ref | Decision | Default recommendation |
|---|---|---|
| RATIFY-EMP-1 | **Mailbox strategy** — shared departmental mailboxes vs per-user | shared departmental (matches `ec_mailbox` + dept doctrine 9.0A); per-user mailboxes change the RLS story |
| RATIFY-EMP-2 | **Per-mailbox access control** — may all `communication:inbound:read` holders read all mailboxes? | yes for v1 (single boundary); per-mailbox ACL is the only genuinely **new** security boundary EMP could introduce — defer until a real need |
| RATIFY-EMP-3 | **Inbound provider** — which real ESP webhook feeds production | keep GENERIC+RESEND seam; choose by DPA + Senegal data-residency review, never in code first |
| RATIFY-EMP-4 | **Tenant mail domains** — per-tenant sending domains & DNS verification | operator-managed; platform stores state only |
| RATIFY-EMP-5 | **Threading model** — RFC 5322 correlation, one thread per root message | yes; correlation is derivation, stored additively, never rewrites envelopes |
| RATIFY-EMP-6 | **Free-compose authority** — who may write a non-template email to a customer, and is maker-checker required? | `communication:send`; maker-checker decision is management's, not engineering's |
| RATIFY-EMP-7 | **Reply identity** — which address outbound replies carry | the mailbox address of the thread |
| RATIFY-EMP-8 | **Attachment policy** — size/type limits, ingestion rules | ingestion only by explicit staff action into the existing document pipeline |
| RATIFY-EMP-9 | **Legal retention** — duration for raw MIME + attachments (Senegal law) | **blocked on counsel; the platform must not invent a retention rule** — today's behaviour (indefinite immutable) stands until ratified |
| RATIFY-EMP-10 | **Customer visibility** — do any correspondence events become `clientSafe`? | not in EMP-1..3; if ever, presence-signals only (never subject/sender/body), through the UT-5 allow-list |
| RATIFY-EMP-11 | **Quarantine review authority** — who may inspect quarantined (tenant-unresolved) captures | platform operator only; quarantine remains capture-time-only and terminal |

---

## 4. Proposed roadmap

| Phase | Purpose | Dependencies | Migration impact | Principal risk |
|---|---|---|---|---|
| **EMP-1** | **Mail workspace consolidation** — mailbox administration (CRUD, retire-not-delete), correspondence list/search/detail over existing `ec_*` + triage, `/mail` becomes the mail workspace; fix the stale registry comment | RATIFY-EMP-1/2 | **likely none** (read + existing tables; mailbox INSERT policy may need adding — STOP rule applies if so) | scope creep into compose |
| **EMP-2** | **Thread correlation** (the reserved "EC-4") — correlate on `in_reply_to`/`references_header`, thread read model | EMP-1, RATIFY-EMP-5 | additive (thread key or correlation table) | retro-correlation must never rewrite envelopes |
| **EMP-3** | **Outbound: reply & compose** — reply from a thread via the existing provider seam; `CORRESPONDENCE_SENT` registry row + RPC emitter; link outbound rows to threads | EMP-2, RATIFY-EMP-6/7, provider live | additive (outbound linkage + emitter migration) | double-emission trap; authority model |
| **EMP-4** | **Attachment → document ingestion** — explicit staff action creates `document` rows through the existing pipeline (`DOCUMENT_UPLOADED` emits by trigger, free) | EMP-1, RATIFY-EMP-8 | none expected | duplicate document identity (hash reuse exists) |
| **EMP-5** | **AI assistance** — suggestions only: classification, summary, suggested triage outcome, suggested dossier match; reuses Doc-Intel doctrine; **no autonomous sending, ever; human approval mandatory** | EMP-1..3, AI provider DPA | none expected | C3 in prompts — forbidden; same allow-list discipline as UT-5 |
| EMP-6 (conditional) | Customer-visible correspondence signals | RATIFY-EMP-10 | registry `clientSafe` flips only | disclosure |

Each phase answers the Digital-LOS question — *"what event does this emit?"* — from the
existing registry, extending it only in EMP-3.

## 5. Risks

- **Technical:** double emission (trigger already fires on insert — no new emitter may touch
  `ec_inbound_message`); thread mis-correlation (headers are attacker-controlled text —
  correlation must be advisory, never merge envelopes); SMTP path half-open (selected value
  accepted, unimplemented).
- **Operational:** mailbox rows currently operator-seeded — a typo silently drops mail to
  quarantine; storage growth of raw MIME with no retention policy.
- **Security:** webhook secret rotation is undefined; attachment content is C3-adjacent and
  must never enter ledger metadata, logs or AI prompts; per-mailbox ACL absence means any
  triage-capable user reads all correspondence (acceptable only if RATIFY-EMP-2 says so).
- **Compliance:** retention/erasure under Senegal law unratified — the platform must not
  invent it; ESP choice needs a DPA and data-residency review.
- **Performance:** large attachments transit a Next route handler; provider size limits must
  be enforced at capture (rejection reasons already typed).
- **Governance:** the strongest risk is **duplication** — a "mail center" built beside EC
  rather than on it. Every EMP phase must extend `ec_*`, `communication_message`, the
  registry and the timeline, or STOP.

## 6. Recommendations

**Reuse (mandatory):** EC-1 capture + quarantine + evidence · EC-2 triage and its four
outcomes · the 8-event `communication` vocabulary and migration-86 trigger ·
`communication_message` + the provider seam · the `communication:*` permission family ·
tenant RLS + immutability triggers · the Unified Timeline (staff and UT-5 customer
projections) · the document pipeline for ingestion · Doc-Intel's suggestions-only AI
doctrine.

**Build (new):** mail workspace + mailbox administration · thread correlation ·
reply/compose + `CORRESPONDENCE_SENT` emitter · attachment-to-document action · AI
suggestions.

**Do not build:** IMAP/POP3 polling (webhook ingestion is the platform's proven shape; a
poller is a second ingestion engine) · a second timeline or mail-history store · a
notification-to-mail sync engine · autonomous AI sending · a second outbound queue · a
parallel attachment store.

**Never duplicate:** the capture pipeline, the triage state machine, the emission discipline
(one source per event, same transaction), the customer allow-list.

---

## 7. Verdict

**GO for EMP-1** — justification: EMP-1 as scoped is read-surface + administration over
tables, permissions, RLS, events and flags that already exist and are CI-proven; it requires
at most one small additive policy migration (STOP rule applies if discovered), it resolves a
real operational gap (operator-seeded mailboxes), and it forces no ratification-blocked
choice — RATIFY-EMP-1/2 are the only two gates and both have safe defaults. Everything
outbound (EMP-3) and AI (EMP-5) stays behind explicit ratification.

*EMP-1 will not begin until explicitly authorized.*
