# EMP-3 — Outbound Mail: Repository Audit

**Date:** 2026-08-07 · **Baseline:** EMP-2 `54a45b0`, CI run #363 green, migration chain **86**
**Status: AUDIT ONLY. No code, no SQL, no migration was written by this step.**

---

## 0. Headline

The outbound half of the platform is **older and thinner than the inbound half**.
`communication_message` was created on 2026-06-15 (migration `20260615000008`) and **has never
been altered since** — no `ALTER TABLE` exists in any of the 86 migrations. It was built for
one job: *render a known template and mail it to one address.* Every assumption in it follows
from that job, and free compose and reply break all of them.

Three findings decide the phase, and two of them are governance questions rather than
engineering ones. They are stated in §4 before any implementation is proposed.

---

## 1. The existing outbound architecture

### 1.1 `communication_message` — the only outbound store

```
id, tenant_id, recipient_email (text NOT NULL), recipient_name,
channel ('EMAIL' only), template_key (text NOT NULL), subject, body_html, body_text,
payload jsonb, status ('QUEUED'|'SENT'|'FAILED'|'CANCELLED'),
related_entity, related_entity_id, file_id, client_id,
retry_count, last_error, sent_at, created_by, created_at, updated_at
```

Triggers: `set_updated_at`; `enforce_communication_tenant` (rejects a `file_id` or `client_id`
belonging to another tenant — a genuine integrity guard worth keeping).

**RLS: SELECT only.** `communication_message_select` = `tenant_id = auth_tenant_id() AND
has_permission('communication:read')`, plus `grant select ... to authenticated`. The migration
states the intent explicitly: *"Writes via the service-role admin client in server actions
(deny-by-default)."*

**Consequence for EMP-3: no new RLS policy is required.** Writes continue through the admin
client behind an application gate — the identical pattern EMP-1 used for `ec_mailbox`. **No
STOP is triggered on the security clause.**

### 1.2 Provider seam — `lib/comms/provider.ts`

`sendEmail(OutboundEmail): SendResult` where
`OutboundEmail = { to, toName, subject, html, text, attachments?: {filename, contentBase64}[] }`
and `SendResult = { ok: boolean; error?: string }`.

Selected by `COMMUNICATIONS_EMAIL_PROVIDER ∈ {resend, smtp}`; **anything else is a no-op stub
that returns `{ ok: true }`**. Resend is fully implemented (`POST /emails`, sanitized errors,
a production guard refusing the `resend.dev` testing sender). **SMTP returns
`provider_not_implemented`** and the comment says *"needs a mailer dependency — documented, not
implemented this phase."*

### 1.3 Callers

`queueAndSend` (render → insert QUEUED → send → SENT/FAILED) is used by quotation send, invoice
send, payment links, portal invitations, staff welcome/password, and customer notifications.
Server actions `sendMessage` (`communication:send`), `retryMessage` (`communication:manage`) and
`cancelMessage` (`communication:manage`) already exist and share one private `deliver()`.

### 1.4 Permissions — already deployed

`communication:read` / `send` ("Send / queue communications") / `manage` ("Retry / cancel
communications") exist in the catalogue, and **`communication:send` is already granted to six
role templates.** The brief's maker-checker default — *agents may draft, direct send requires
the explicit send authority* — is therefore **already the deployed reality**, needing no new
permission and no ratification. `SYSTEM_ADMIN` is not among the six.

---

## 2. Component classification (26 audited items)

| # | Component | Classification | Note |
|---|---|---|---|
| 1 | `communication_message` schema | **partially complete** | single recipient, no Cc/Bcc, no attachments, no headers, no mailbox, no draft |
| 2 | Outbound server actions | **complete and reusable** | send/retry/cancel exist with correct gates |
| 3 | Provider abstraction | **complete and reusable** | clean seam, dark by default |
| 4 | Resend implementation | **complete and reusable** | incl. production sender guard |
| 5 | `smtp` provider value | **dark / unimplemented** | **audit conclusion: do NOT build it** — the contract neither requires nor supports it, and the brief forbids building it absent proof |
| 6 | `template_key NOT NULL` | **blocks free compose** | see §3.1 |
| 7 | Draft behaviour | **missing** | no `DRAFT` status; a row exists only once queued |
| 8 | Sender identity | **missing** | sender is a single global `COMMUNICATIONS_EMAIL_FROM`; no per-mailbox sender, no `mailbox_id` |
| 9 | Recipient fields | **partially complete** | `recipient_email` is one `text`; no Cc/Bcc |
| 10 | Outbound attachments | **partially complete** | the **seam supports them**; the **table does not persist them** |
| 11 | Delivery status | **partially complete + unsafe** | `SENT` is set on stub acceptance — see §4.2 |
| 12 | Retry behaviour | **defective** | see §4.1 |
| 13 | Idempotency | **missing** | no key, no constraint, no CAS |
| 14 | Provider message identifiers | **missing** | Resend returns an id; `sendEmail` discards it |
| 15 | Audit logging | **complete and reusable** | `COMMUNICATION_SENT/FAILED/CANCELLED` exist |
| 16 | Communication permissions | **complete and reusable** | read/send/manage, 6 roles hold send |
| 17 | RLS | **complete and reusable** | SELECT-only + admin-client writes; no change needed |
| 18 | Decision Plane registry | **missing (outbound)** | no `CORRESPONDENCE_SENT`; 8 inbound types exist; exactly 2 reserved types remain |
| 19 | Communication event types | **complete (inbound)** | metadata is identifiers/codes only — the pattern EMP-3 must follow |
| 20 | Unified Timeline readers | **complete and reusable** | `readDecisionPlane({subject})` under the UT-1 policy |
| 21 | Branding / signatures | **complete and reusable** | `mergeBranding` + `renderTemplate` chrome |
| 22 | Customer/contact data | **complete and reusable** | `client`, `client_contact` exist; EMP-3 must not create master data |
| 23 | Mailbox activation / rollout | **partially complete** | `ec_mailbox.is_active` exists (EMP-1); **no OUTBOUND rollout table** — see §4.3 |
| 24 | EMP-2 threading | **complete and reusable** | derived identity; headers on inbound rows are the reply source |
| 25 | Bounce/failure webhooks | **missing** | no delivery webhook of any kind ⇒ **`DELIVERED` and `READ` are unprovable and must not be introduced** |
| 26 | Tests / SQL suites | **complete and reusable** | `comms-provider`, `comms-render`, `rls_communication_test.sql`, `emp-1`, `emp-2` |

---

## 3. Reuse-versus-build

**Reuse unchanged:** the provider seam and Resend implementation · `communication_message` as
*the* outbound queue · `queueAndSend` for template mail · send/retry/cancel actions and their
gates · the `communication:*` family · SELECT-only RLS + admin-client writes ·
`enforce_communication_tenant` · branding/render · audit actions · EMP-2 correlation ·
`readDecisionPlane` · EMP-1's mailbox administration and workspace shell.

**Build (all additive):** free-compose and reply composition · draft lifecycle · outbound
recipient/attachment persistence · sender-mailbox binding · idempotency and a compare-and-set
dispatch · provider id capture · `CORRESPONDENCE_SENT` · compose/reply/drafts/sent/failed UI.

**Do not build:** SMTP · a second queue or message table · a second timeline or journal · a
second attachment store · delivery/bounce/read events (no evidence source exists) · document
ingestion (EMP-4) · any customer visibility · any AI path.

### 3.1 `template_key NOT NULL`

There is **no** existing message-kind or source column to distinguish template mail from free
compose, and **no** precedent in this codebase for a sentinel template key. Inventing
`FREE_COMPOSE` would be exactly the "fake template to bypass a constraint" the brief forbids.

**Smallest correct change: make `template_key` nullable and add a `kind` column**
(`'TEMPLATE' | 'COMPOSE' | 'REPLY'`) with a CHECK tying them together —
`kind = 'TEMPLATE'` ⟺ `template_key IS NOT NULL`. Every existing row is `TEMPLATE`, so the
backfill is a constant and no historical row changes meaning.

---

## 4. Three findings that require a decision before implementation

### 4.1 DEFECT (pre-existing, production): `deliver()` can send the same email twice

```ts
if (m.status !== "QUEUED" && m.status !== "FAILED") return invalid_status;
const res = await sendEmail({...});          // <-- no status transition in between
if (res.ok) update status = 'SENT'
```

This is a read-check-then-act with **no compare-and-set**. Two concurrent invocations both read
`QUEUED`, both pass the guard, and **both call the provider**. A double-clicked Retry, a
duplicated server action, or two workers will send the customer two emails.

It is latent today only because nothing in the UI issues concurrent sends. **EMP-3 adds a Send
button, which makes it trivially reachable.** The fix is a CAS transition to a new
non-terminal status before the provider call:

```sql
update communication_message set status='SENDING'
 where id = ? and status in ('QUEUED','FAILED')   -- returning id
```
No row returned ⇒ another caller owns the send ⇒ abort without calling the provider.
This requires adding `'SENDING'` to the status CHECK — additive.

**Decision required:** this changes the behaviour of the *existing* `sendMessage` /
`retryMessage` actions, which is beyond EMP-3's nominal scope. **Recommendation: fix it**, on
the grounds that shipping a Send button over a known duplicate-send path would be negligent.

### 4.2 HONESTY HAZARD: the no-op provider returns `{ ok: true }`

With no `COMMUNICATIONS_EMAIL_PROVIDER` configured — the default, and the current production
posture unless credentials are set — `sendEmail` returns success and `deliver()` marks the row
**`SENT`**. Nothing left the building.

The brief requires `CORRESPONDENCE_SENT` to mean *"the provider accepted the outbound
correspondence."* Emitting it on a stub's acceptance would write **false evidence into the
Decision Plane** — the ledger would assert a customer was written to when they were not. This
is precisely the class of claim the UT programme exists to prevent.

**Recommendation:** `isProviderConfigured()` already exists for this distinction. Persist the
accepting provider on the row, and **emit `CORRESPONDENCE_SENT` only when a real provider
accepted**. When the stub accepts, record a distinct, honestly-labelled state rather than
`SENT`, and say so in the UI. *(This also corrects the existing mislabelling, which is why it
is raised as a decision and not simply done.)*

**Decision required:** confirm that a stub acceptance must **not** emit and must **not** be
labelled `SENT`.

### 4.3 GAP: there is no outbound rollout flag

Ratified default #12 says *"A mailbox disabled by rollout configuration cannot send."* The only
EC rollout table is **`tenant_ec_inbound_rollout`**, whose semantics are *inbound capture*.
Three options:

* **(a) Reuse the inbound rollout row** as the tenant's EC posture — smallest, but conflates
  two capabilities: disabling inbound capture would silently disable sending.
* **(b) Add `tenant_ec_outbound_rollout`** — a new table, honest, but a broader migration and a
  new RLS surface.
* **(c) Gate on what already exists**: `ec_mailbox.is_active` (per-mailbox, EMP-1) **AND**
  `isProviderConfigured()` (tenant-independent). No migration, no new table.

**Recommendation: (c)**, plus a new `EFFITRANS_EC_OUTBOUND_ENABLED` environment flag to match
the platform's established two-layer pattern. It satisfies "an inactive mailbox cannot send"
exactly, and defers a per-tenant outbound rollout table until a second tenant needs one.

**Decision required:** choose (a), (b) or (c).

---

## 5. Proposed minimal additive migration (87) — NOT WRITTEN, pending approval

Only if §4 is approved. One migration, additive, forward-only, no data rewrite:

```
alter table public.communication_message
  alter column template_key drop not null,
  add column kind             text not null default 'TEMPLATE',
  add column mailbox_id       uuid references public.ec_mailbox (id),
  add column to_addresses     jsonb not null default '[]'::jsonb,
  add column cc_addresses     jsonb not null default '[]'::jsonb,
  add column bcc_addresses    jsonb not null default '[]'::jsonb,
  add column in_reply_to      text,
  add column references_header text,
  add column reply_to_message_id uuid references public.ec_inbound_message (id),
  add column attachments      jsonb not null default '[]'::jsonb,
  add column provider         text,
  add column provider_message_id text,
  add column idempotency_key  text,
  add column dispatched_at    timestamptz;

-- kind vocabulary + the template coupling
check (kind in ('TEMPLATE','COMPOSE','REPLY'))
check ((kind = 'TEMPLATE') = (template_key is not null))
-- status gains the CAS state
check (status in ('DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED'))
-- duplicate prevention
create unique index uq_comm_idempotency
  on public.communication_message (tenant_id, idempotency_key)
  where idempotency_key is not null;
```

**No RLS change** (SELECT-only stands; writes stay on the admin client). **No new table.**
**No new permission.** Existing rows: `kind='TEMPLATE'`, everything else NULL/empty — no row
changes meaning, and `recipient_email` stays authoritative for template mail.

Registry addition (code, not SQL):
`{ type: "CORRESPONDENCE_SENT", domain: "communication", version: 1, emission: "rpc",
metadataKeys: ["message_id","mailbox_id","thread_id"], clientSafe: false,
labelFr: "Correspondance envoyée" }` — **identifiers and codes only**, never subject, address
or body, matching the inbound eight.

**Emitter:** an **RPC** using the sanctioned `emit_business_event` path, called once after
provider acceptance. **No trigger** — a trigger on `communication_message` UPDATE would fire on
every status change and could not distinguish real acceptance from a stub's, and it must never
resemble the inbound `CORRESPONDENCE_RECEIVED` emitter, which stays untouched.

### 5.1 The transactional boundary — stated, not glossed

The brief asks for the send to be atomic. **It cannot be, and here is the exact boundary:** the
provider call is an external HTTP request, so no database transaction can span it. The honest
ordering is

1. CAS `QUEUED → SENDING` (transactional, single-winner);
2. provider call (external, outside any transaction);
3. on acceptance: persist `provider`, `provider_message_id`, `SENT` **and** emit
   `CORRESPONDENCE_SENT` in one transaction via the RPC.

The residual risk is a crash between (2) and (3): the email was accepted but the row still says
`SENDING`. That is **recoverable and non-duplicating** — a `SENDING` row is never re-dispatched
automatically, and an administrator resolves it explicitly. It is not atomicity, and this
report does not claim it is.

---

## 6. Security review of the proposal

No new table, no new RLS policy, no new permission, no broad write policy ⇒ **no STOP clause
triggered.** Tenant isolation unchanged (predicate + `enforce_communication_tenant`).
`SYSTEM_ADMIN` gains nothing and holds none of the six `communication:send` grants. Sent
evidence stays append-only in spirit: content columns are written once at dispatch and never
rewritten by draft edits. Attachments reference existing private storage; **no path is exposed
and no inbound attachment is mutated.** Customer visibility remains none —
`CORRESPONDENCE_SENT` is `clientSafe: false`, so the UT-5 projection continues to exclude mail.
No AI path is introduced.

---

## 7. What I need before implementing

1. **§4.1** — approve fixing the pre-existing duplicate-send defect (changes existing actions).
2. **§4.2** — confirm a stub acceptance must not emit `CORRESPONDENCE_SENT` nor be labelled
   `SENT`.
3. **§4.3** — choose the outbound gating option (recommend **(c)**).
4. **§5** — approve migration **87** as scoped, or direct a smaller cut.

Everything else in the brief is unambiguous and needs no further decision. On approval the
implementation order is: migration 87 → registry + RPC emitter → compose/reply/draft services →
idempotent dispatch → UI → tests → CI.

**EMP-4 has not begun. No code, SQL or migration was written by this audit.**
