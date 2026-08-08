# EC-0 — Enterprise Communications: Architecture Audit

**Date:** 2026-08-02 · **Type:** read-only repository audit. **No code, no migration,
no permission, no UI was written.** Companion: [ec-0-implementation-brief.md](ec-0-implementation-brief.md).

---

## 1. Repository audit — what exists (verified in code, not from memory)

### 1.1 The four existing communication subsystems

The platform already runs **four distinct communication subsystems**, each with its own
tables, doctrine and audience. EC must compose them, not become a fifth competitor.

| # | Subsystem | Phase | Direction / audience | Storage | State |
|---|---|---|---|---|---|
| 1 | **Communications Hub** `lib/comms` | 1.14 / 1.18 | **outbound email** to anyone | `communication_message` | **live-capable** |
| 2 | **Messaging Center** `lib/messaging` | 8.7 | internal chat + portal support | `conversation` / `message` / `message_attachment` | shipped, tenant-flag-gated |
| 3 | **Notifications** `lib/notifications` | 1.6 | in-app, self-scoped feed | `notification` | live |
| 4 | **Customer Notify** `lib/customer-notify` | 2.5 | lifecycle → portal inbox + email | `client_notification` | live |

**Communications Hub — the most important finding of this audit.** A complete outbound
email pipeline already exists and is one env var away from live delivery:

* `communication_message` (migration `20260615000008`): tenant-scoped, **`channel`
  CHECK currently `('EMAIL')`** — designed extensible; status
  `QUEUED/SENT/FAILED/CANCELLED`; `retry_count`, sanitized `last_error`;
  **`related_entity`/`related_entity_id`, `file_id`, `client_id`** — correlation to
  dossier and client is already modelled; rendered subject/body **stored** for
  auditability; tenant-integrity trigger.
* Provider seam (`lib/comms/provider.ts`): **Resend wired via plain HTTPS fetch (no
  SDK)**, no-op provider by default (dark), production guard against the `resend.dev`
  testing sender, credential-redacting error sanitizer, **file attachments** carrying
  the exact stored artifact (UAT-2B invoice discipline: never re-rendered).
* Template registry + renderer + tenant branding merge.
* Permission family **`communication:read` / `communication:send` /
  `communication:manage`** — catalogued *and granted* since Phase 1.14.
* UI: `/mail` log; rows surface on the dossier timeline and client history;
  `countCommunications` already feeds the alert center.

**Messaging Center** — conversations typed `direct_staff | department | dossier |
customer_support`; participants typed `staff | customer | department | system`; message
`sender_type` already includes **`'ai'`**; private `messaging-attachments` bucket
(15 MB); **RLS *is* the authorization** (participant / department permission /
`messaging:manage`; portal sees own-client, shared-only). Chat semantics: presence,
unread counts, polling.

**Notifications** — recipient-identity-scoped rows; **no scheduler exists anywhere**
(re-confirmed for the third time after HR-5A and HR-6 — no cron, no queue worker, no
`app/api/cron*`).

**Customer Notify** — the composition precedent EC should imitate: one event → portal
inbox + email **through the comms hub** ("no second comms engine", its own header says
so), idempotent via dedup key + unique index, per-user email preference gating,
best-effort so it never breaks the triggering business action.

### 1.2 What does NOT exist — the EC-shaped hole

| Gap | Evidence |
|---|---|
| **Inbound email — nothing.** No IMAP, no POP, no inbound webhook, no parser | no mail dependency in `package.json`; no inbound route in `app/api` |
| **Quotation entity — nothing.** | process registry step 1 verdict **`missing`**, listing verbatim: *"no quotation / quotation_line table · no QUOTATION or QUOTATION_APPROVAL document type · no client.has_contract flag · no quotation:* permissions · no conversion-to-dossier action"* |
| **Email threading** | `communication_message` rows are one-way; no `Message-ID`/`In-Reply-To`/thread model |
| **Tenant routing for inbound** | nothing maps an inbound address to a tenant |
| Scheduler | none (twice deferred, stands) |

### 1.3 Reusable subsystem inventory (the rest)

| Subsystem | What exists | EC relevance |
|---|---|---|
| **Documents** | `public.document` + private `documents` bucket (25 MB; PDF/images/Office); **WES-4 governance**: uploader/verifier roles from the pinned policy, maker-checker where a checker seat exists; separate `hr-documents` bounded context proves documents can live outside `public.document` when governance differs | inbound attachments need a home that is **not** automatically `public.document` (§ADR-EC-5) |
| **Doc Intelligence** | `lib/docintel`: **suggestions-only doctrine** (7.4A), FR/EN text classification, declared-class-stays-authoritative, provider stub + `LlmStructuredExtractor`, confidence model | the ready-made doctrine and engine for email classification/extraction |
| **Dossier** | `operational_file` (IMP/EXP/TRP/HND) + 26-step process registry **with per-step implementation verdicts**; 9.0C intake (blocking vs warnings; *"Cotation: skipped by default at intake (contract client / no quotation)"*); WES-3 (departments own dossiers, people own tasks, `assignment_event`); `process_handoff`; WES-5 reconciliation | the attach-to-dossier target; the conversion target for accepted quotations |
| **Audit** | `writeAudit` (`audit_log`) + **`business_event` ledger** (WES-9: `event_type`/`event_version`/`source`, emit-RPC, mandatory-emission-aborts-write discipline) + per-context ledgers (`hr_employee_event`) | every EC action audits; correspondence facts can emit business events |
| **AI** | shared `runCopilot`/`runCopilotDetailed`; five copilot routes (platform/logistics/operations/executive/portal); portal AI gated by `getCurrentPortalUser`, **no supabase client in portal AI context** | triage assistance; **C3/no-PII-in-prompts discipline carries over** |
| **Customer** | `client` (master data), `client_user` (portal identities — **not RBAC subjects**), portal auth, `client_notification`, portal preferences | sender-matching target; portal visibility questions |
| **Permissions** | catalog `module/action/data_scope`; **no hyphens**; HR-6 discipline: fewest codes, catalogue-then-grant, consequential authority = own code | `communication:*` family already exists to extend |
| **Storage** | five buckets, uniform idiom: **private + service-role writes + short-TTL signed URLs** (`documents`, `messaging-attachments`, `expense-attachments`, `hr-documents`; only `brand-assets` public) | sixth bucket for raw inbound mail follows the idiom |
| **Workflows** | process engine (instances, steps, decisions, blockers, teams), 15 queues, SLA policies — **`quotation_response` SLA already defined** in `lib/process/sla-policies.ts` | the quotation workflow's rails already exist |
| **Inbound M2M precedent** | `app/api/payments/webhook/[provider]/route.ts`: raw-body capture, **signature verification inside the processor**, no auth cookie, env-gated (`PAYMENTS_ENABLED`), provider path param, internals never leaked | **the template for the inbound email webhook** |
| **Rollout** | two-layer flags: `EFFITRANS_*_ENABLED` env AND tenant row | EC activation model |

---

## 2. The central question: Quotation Request entity vs. attach to Dossier

**Answer: it is not either/or, and neither should happen automatically.** The two
options are outcomes of a **triage step**, and the codebase itself says so:

1. **The ratified process demands a pre-dossier entity.** Step 1 (Cotation) *precedes*
   `operations_intake`; its completion rule is `quotation_approved_or_client_under_contract`;
   and the registry lists the missing quotation table and the missing
   conversion-to-dossier action as *the* implementation gaps. An inbound inquiry that
   became an `operational_file` directly would skip the ratified step 1 and pollute the
   operational registry with unaccepted, unpriced, possibly-spam requests — every
   dossier KPI (10.0D), queue and reconciliation (WES-5) assumes an accepted dossier.
2. **But much inbound mail is about existing dossiers.** A BL correction, an ETA
   question, a document from a shipping line — these must land on the dossier timeline
   (`communication_message.file_id` already models exactly this), not spawn entities.
3. **And some mail is neither** — general correspondence, spam, misdirected mail.

So the flow is **capture → triage → one of three governed outcomes**:

```
inbound email ──► ec_inbound_message (immutable capture, always)
                        │
                   TRIAGE (human decides; AI suggests)
                        │
        ┌───────────────┼──────────────────────┐
        ▼               ▼                      ▼
 attach to existing   create QUOTATION      client/general
 DOSSIER (file_id)    REQUEST (new entity,  correspondence
 → dossier timeline   fills ratified        (client_id only)
                      step-1 gap)           or discard-with-reason
```

The **Quotation Request** then follows step 1 as ratified: request → quotation
(document type `QUOTATION`) → client approval (evidence: actor + date, per
`requiredEvidence`) → **conversion to dossier** (the registry's missing action) →
`operations_intake`. Contract clients bypass it, which requires the equally-missing
`client.has_contract` designation.

---

## 3. Bounded context definition

**Enterprise Communications (EC) owns:**

* **Inbound capture** — raw email ingestion, immutable storage, tenant routing.
* **Triage** — the governed decision (attach / create quotation request / correspond /
  discard), with AI suggestions.
* **Correspondence threading** — inbound + outbound as one thread per subject
  (`Message-ID`/`In-Reply-To`), correlated to dossier/client/quotation-request.
* **Outbound** — the existing Communications Hub *is* EC's outbound half. **Extend,
  never replace** (9.0A doctrine): same tables, same `communication:*` family.

**EC does NOT own (integration points only):**

* **Quotation business logic** — pricing, approval, conversion belong to a **Commercial
  context** (the step-1 implementation). EC *creates* a Quotation Request and hands off;
  it never prices or approves. (Same shape as: intake creates, Transit executes.)
* **Dossiers** — EC attaches to them; process engine owns them.
* **Messaging Center** — chat ≠ correspondence. Real-time internal/portal conversation
  stays 8.7's; EC threads are asynchronous external correspondence. A conversation may
  *reference* a thread; nothing merges.
* **Notifications** — EC emits into the existing rail (as customer-notify does).
* **Client master data** — EC matches senders against `client`; never creates clients
  silently.

---

## 4. Architecture decision records

### ADR-EC-1 — Capture-then-triage; no parser ever creates a business entity
Every inbound email is stored **first** as an immutable `ec_inbound_message` (append-only,
WES-9 `prevent_mutation` idiom) with its raw MIME in a private bucket. Business entities
(dossier attachment, quotation request) are created only by an explicit, permission-gated,
audited human action from the triage surface. **Rationale:** the docintel doctrine
(suggestions never write), the WES-4 finding (acts need actors and evidence), and spam
reality — an unauthenticated internet input must never mint rows in operational tables.

### ADR-EC-2 — Quotation Request is a new entity in a Commercial context; dossier attachment is a peer outcome
Triage may produce **either** (or neither). The Quotation Request implements the
ratified step-1 gap *as recorded in the process registry itself*; conversion-to-dossier
is its terminal act, feeding `operations_intake`. Dossier attachment reuses
`communication_message`-style correlation (`file_id`). **Neither is the default;
the triage actor decides.**

### ADR-EC-3 — Inbound transport is a provider webhook, on the payments-webhook pattern
Raw body + provider signature verification inside the processor; no auth cookie;
env-gated (`EFFITRANS_EC_INBOUND_ENABLED` AND tenant row — the two-layer flag doctrine);
provider as path param (Resend inbound first, since outbound already speaks Resend; the
seam stays provider-agnostic exactly like `lib/comms/provider.ts` and
`lib/finance/webhook.ts`). **No IMAP/POP polling**: polling needs the scheduler this
platform deliberately does not have, and a webhook needs none.

### ADR-EC-4 — Extend the `communication:*` permission family; triage is its own authority
Reads ride `communication:read`; replies ride `communication:send`; ops ride
`communication:manage` — all existing, all granted. **One** new code is anticipated:
`communication:triage` (converting an internet input into business state is a
consequential authority, on the `hr:leave:approve` / `hr:performance:finalize`
precedent) — catalogued, granted to nobody until ratified. Commercial-context codes
(`quotation:create/send/approve`) are **already named by the process registry** and
belong to the Commercial phase, not to EC ingestion.

### ADR-EC-5 — Inbound attachments are evidence-in-waiting, not documents
Raw MIME and extracted attachments live in a **new private bucket** (`ec-inbound`),
service-role only, short-TTL signed URLs — the five-bucket idiom. An attachment becomes
a `public.document` row **only** when a human promotes it during/after triage, entering
WES-4 governance (typed, uploader recorded, verifiable). Rationale: `public.document`
rows carry governance weight (required-document sets, completeness rules, BAE
evidence); letting an anonymous sender create them would corrupt the doctrine. Same
separation HR-3 proved with `hr-documents`.

### ADR-EC-6 — AI assists triage under the suggestions-only doctrine
Classification (dossier-reference detection, sender→client matching, inquiry-vs-existing
routing, language) reuses `lib/docintel` shapes: declared/decided stays authoritative,
confidence surfaced, suggestions never write. **Email bodies are C3-adjacent**: no
message content in audit payloads, URLs, logs or notification titles (subject lines
truncated + sanitized where shown); prompts receive the minimum excerpt needed, never
attachment binaries; the portal-AI rule (no supabase client in AI context) carries over.

### ADR-EC-7 — One outbound pipeline, threading added additively
Replies send through `lib/comms` (`queueAndSend`) — customer-notify already proved the
"no second engine" rule. Threading columns (`message_id`, `in_reply_to`,
`thread_key`) are **added** to the existing `communication_message` and mirrored on
`ec_inbound_message`; the `channel` CHECK extends by the established
drop-and-recreate-CHECK precedent (the messaging migration already did this to
`notification_type_check`).

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Public unauthenticated endpoint** (webhook) — spam floods, forged posts | signature verification (ADR-EC-3); env-gated dark; rate-limit at edge; capture-only design bounds blast radius to storage |
| R2 | **C3/PII in email bodies** | ADR-EC-6 disciplines; retention decision **DEC-EC-D4** before activation |
| R3 | **Malicious attachments** | never executed/rendered server-side; stored raw, MIME-typed, size-capped at bucket; promotion to document is human + typed |
| R4 | **Tenant misrouting** of inbound (mail for tenant A landing in tenant B) | address→tenant mapping is explicit configuration (DEC-EC-D1); unmatched mail quarantines to a platform queue, never guesses |
| R5 | **`operational_file` pollution** if triage defaults to dossier-creation | structurally prevented: triage has no create-dossier outcome; only quotation-request conversion reaches intake |
| R6 | **Retention/legal** — raw correspondence is discoverable business record; Senegal obligations unratified | DEC-EC-D4 (counsel), the HR-5 rule: no legal value invented |
| R7 | **Provider lock-in / inbound availability** | provider seam identical to outbound; capture format is raw MIME (portable) |
| R8 | **Quotation scope creep into EC** | bounded-context split (§3): EC stops at the hand-off; Commercial is its own phase with its own ratifications |
| R9 | PUBLIC repo — no secrets, no real addresses in fixtures | standing discipline; webhook secrets env-only |

## 6. Dependencies (management / external — none are code)

| Ref | Decision needed | Blocks |
|---|---|---|
| **DEC-EC-D1** | inbound address & domain strategy (dedicated subdomain? per-tenant addresses? who owns DNS) | activation of EC-1 |
| **DEC-EC-D2** | inbound provider choice (Resend inbound vs. alternative) + DPA | EC-1 live traffic |
| **DEC-EC-D3** | triage seat — which role holds `communication:triage` | EC-2 activation (build proceeds dark) |
| **DEC-EC-D4** | retention period for raw inbound mail + discard policy | activation, not schema |
| **DEC-EC-D5** | quotation vocabulary: numbering, validity, `has_contract` designation authority | Commercial phase (EC-3+) |
| Existing | Messaging-Center activation state (unverified since 8.7) | portal-facing surfaces only |

## 7. Migration strategy

Additive, forward-only, idempotent, dark-first — unchanged discipline; migrations
land at 80+ and never modify 1–79.

1. **Expand:** new `ec_*` tables (inbound message, thread, triage decision) + `ec-inbound`
   bucket + threading columns on `communication_message` (nullable, additive) + `channel`
   CHECK widened by drop-and-recreate. RLS on every table from birth
   (`communication:read` gate, no portal policy initially). New permission catalogued,
   granted to nobody.
2. **Activate:** two-layer flag per tenant; webhook 503s while env-dark (payments
   precedent); triage workspace appears only under the flag + permission.
3. **Contract:** none foreseen — nothing is replaced. `communication_message` is
   extended in place; the four existing subsystems keep their contracts byte-compatible.
4. **Commercial phase (quotation)** ships as its **own** migrations/permissions after
   its own ratifications — EC-1/EC-2 must not smuggle it in.

**CI:** each phase adds a BEGIN/ROLLBACK RLS suite appended last; per-step zero-skipped
verification before any production application (the DEV-HR6-01 reinforced control).
