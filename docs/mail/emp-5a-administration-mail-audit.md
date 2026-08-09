# EMP-5A — Administration Mail Completion Audit

**Date:** 2026-08-09 · **Audit only.** No implementation, no permission change, no provider
configuration change, no migration. Measured read-only against production.

---

## 0. The headline

**Enterprise Mail is built and has never been switched on.**

Production holds **zero mailboxes**, zero mailbox members, zero aliases, zero webhook events,
zero inbound messages and zero triage items. The tenant inbound-rollout table has **no rows at
all**. Every administrative surface, state machine and permission exists and works; nothing has
ever flowed through them.

This is therefore not a "finish the code" phase. Two things are actually missing: **an activation
that has never been performed**, and **a provider/domain readiness step that has already failed
once and left evidence**.

The evidence: the three FAILED outbound messages carry `last_error = resend_http_403`. Resend was
wired, was called, and rejected the send. A 403 from Resend is characteristically an unverified
sending domain or a `from` address the account is not authorised to use — not a bad API key,
which returns 401.

## 1. What already exists

### 1.1 Schema — complete, and there is exactly one mailbox model

| Table | Purpose | Rows in production |
|---|---|---|
| `ec_mailbox` | mailbox identity + lifecycle | **0** |
| `ec_mailbox_member` | per-user capabilities | **0** |
| `ec_mailbox_alias` | additional addresses | **0** |
| `ec_inbound_message` / `ec_inbound_attachment` | captured mail (append-only) | **0** |
| `ec_triage_item` | triage queue | **0** |
| `ec_webhook_event` | capture ledger (append-only) | **0** |
| `communication_message` | outbound queue + journal | 23 (20 SENT, 3 FAILED) |
| `tenant_ec_inbound_rollout` | per-tenant inbound flag | **0 of 1 tenants** |

`ec_mailbox` carries the full lifecycle column set — `provisioning_status`, `provisioning_note`,
`provisioning_attempts`, `provisioned_at`, `provisioned_by`, `owner_user_id`, `mailbox_type`,
`is_active` — and enforces address lowercase, address shape, `mailbox_type ∈ {SHARED, PERSONAL}`,
and a personal-mailbox-implies-owner rule.

**No parallel mailbox model exists and none is needed.** Everything below reuses these tables.

### 1.2 The lifecycle state machine

`provisioning_status ∈ {DRAFT, PENDING_EXTERNAL_SETUP, ACTIVE, DISABLED, SETUP_FAILED}`,
enforced by CHECK. Implemented transitions, all in `lib/ec/mailboxes/admin-actions.ts`:

| Action | Transition |
|---|---|
| `provisionMailbox` | *(insert)* → `PENDING_EXTERNAL_SETUP` |
| `recordSetupOutcome` | `PENDING_EXTERNAL_SETUP \| SETUP_FAILED` → `ACTIVE \| SETUP_FAILED` |
| `retryProvisioning` | `SETUP_FAILED` → `PENDING_EXTERNAL_SETUP` |
| `setMailboxEnabled` | `ACTIVE ↔ DISABLED` |

### 1.3 Administration surfaces

`/admin/enterprise-mail` (router) → `access`, `mailboxes`, `capture`, `journal`. Established by
EMP-IA-1 and relocated by ADMIN-MAIL-ROUTING. The employee workspace at `/mail` keeps its frozen
five tabs and shares no administrative surface.

### 1.4 Permissions — the separation holds

| Permission | Roles holding it |
|---|---|
| `communication:mailbox:provision` | **1** (MAIL_ADMIN) |
| `communication:membership:manage` | **1** (MAIL_ADMIN) |
| `communication:diagnostics:read` | **1** (MAIL_ADMIN) |
| `communication:manage` | 3 (SYSTEM_ADMIN, OPS_SUPERVISOR, MAIL_ADMIN) |
| `communication:inbound:read` | **0 — as RATIFY-EC1-1 requires** |

MAIL_ADMIN exists and **2 users hold it**. SYSTEM_ADMIN holds no mailbox-administration
permission, so the EMP-4A separation is intact in production, not merely in the templates.

### 1.5 Outbound engine

EMP-3 shipped CAS dispatch (`comm_acquire_send`, `comm_record_send_accepted/failed`,
`comm_reconcile_stuck_send`), idempotency keys, provider recording, threading headers and
attachments. The provider seam (`lib/comms/provider.ts`) is **dark by default**: with no
`COMMUNICATIONS_EMAIL_PROVIDER` it is a no-op that "accepts" everything.

## 2. What is partial

1. **"Vérifier" does not exist as a lifecycle step.** The ratified lifecycle is
   Réserver → Configurer → Vérifier → Activer. What the code implements is Réserver → Configurer
   → *assert* → Activer: `recordSetupOutcome('ACTIVE')` is a **human declaration** that setup
   worked. Nothing sends a test message, nothing confirms an inbound arrival, nothing checks the
   provider. A mailbox can reach `ACTIVE` while being incapable of sending or receiving.
2. **`DRAFT` is a dead state.** It is permitted by the CHECK and reachable by no action.
   Every mailbox begins at `PENDING_EXTERNAL_SETUP`.
3. **The EMP-3 dispatch path has never run in production.** All 23 messages are
   `kind = TEMPLATE`, with **0** idempotency keys, **0** `mailbox_id` links and **0** non-null
   providers, and the newest predates migration 87 (2026-08-11). Compose, reply, drafts and the
   CAS send path are unexercised outside CI.
4. **Send As does not function.** `dispatch.ts` passes no `from`; `provider.ts` uses
   `COMMUNICATIONS_EMAIL_FROM`. The mailbox a user selects does **not** become the envelope
   sender, and both the employee mailbox page and the composer say so. Sender identity is
   deliberately EMP-4B's subject.
5. **Inbound is off by construction.** The two-layer rule needs `EFFITRANS_EC_INBOUND_ENABLED`
   **and** a `tenant_ec_inbound_rollout` row. There are **no rows**, so inbound is disabled for
   every tenant regardless of the environment variable.

## 3. What is missing

1. **Any mailbox at all.** Zero rows. The lifecycle has never been started once.
2. **A real verification step** (§2.1) — the difference between "an operator says it works" and
   "the platform observed it working".
3. **Provider/domain readiness** — see §5. This is the blocking item.
4. **Inbound routing** — zero webhook events have ever been received, so the provider→
   `/api/ec/inbound` path has never delivered.
5. **A `purpose` CHECK constraint.** `ec_mailbox.purpose` is **free text** with no constraint,
   while `mailbox_type` and `provisioning_status` are both constrained. Eligibility rules key on
   purpose (`eligibleMailboxes`), so a typo produces a mailbox nobody is ever offered. Minor, but
   it is the one genuine schema gap found.

## 4. Exact schema / actions / routes involved

**Schema:** `ec_mailbox`, `ec_mailbox_member`, `ec_mailbox_alias`, `ec_webhook_event`,
`ec_inbound_message`, `ec_inbound_attachment`, `ec_triage_item`, `tenant_ec_inbound_rollout`,
`communication_message`.

**Actions:** `lib/ec/mailboxes/admin-actions.ts` (7 exports), `lib/ec/mailboxes/bulk-actions.ts`
(preview + fingerprint-gated execute), `lib/ec/mailboxes/membership.ts`,
`lib/ec/mailboxes/service.ts` (health/posture), `lib/ec/mailboxes/eligibility.ts`,
`lib/comms/dispatch.ts`, `lib/comms/provider.ts`, `lib/ec/inbound/capture.ts`.

**Routes:** `/admin/enterprise-mail{,/access,/mailboxes,/capture,/journal}`,
`/users/[id]/enterprise-mail`, `/mail{,/inbox,/compose,/drafts,/sent,/mailboxes}`,
plus the inbound webhook endpoint.

## 5. Provider / domain blockers

**This is the critical path, and it has already failed once with evidence.**

| Blocker | Evidence | Resolution |
|---|---|---|
| **Sending domain not verified** | `resend_http_403` on 3 messages, 2026-06-17, 1 retry each | Verify the domain in Resend: SPF + DKIM records, then DMARC |
| `COMMUNICATIONS_EMAIL_FROM` must be an address **on that verified domain** | all 23 rows have `provider = NULL` — no real acceptance has ever been recorded | Set to e.g. `Effitrans <ops@effitrans.sn>` once verified |
| `COMMUNICATIONS_EMAIL_PROVIDER` must be `resend` | provider seam is a no-op unless set | Set in Vercel production |
| `RESEND_API_KEY` | — | Set in Vercel production |
| **Inbound routing** never configured | `ec_webhook_event` = 0 rows, ever | Configure Resend inbound → `POST /api/ec/inbound` |
| `EC_INBOUND_WEBHOOK_SECRET` | capture rejects unsigned payloads | Set, and match the provider's configuration |
| Two-layer inbound flag | `EFFITRANS_EC_INBOUND_ENABLED` **and** a per-tenant row (0 exist) | Both required; either alone disables the module |

**I could not read Vercel's environment values from here, and deliberately did not try.** The
table above is inferred from the database's own evidence, which is stronger than a config listing
anyway: `provider = NULL` everywhere proves no real acceptance has ever been recorded, whatever
the variables currently say.

**A verified domain is a prerequisite for both directions**, and DNS propagation is measured in
hours. It should start before any engineering wave.

## 6. Is a migration needed?

**No — not to activate.** Every table, state and permission required already exists. Activation
is configuration plus data.

A migration becomes necessary only if two optional improvements are ratified:

1. adding a **verification state** (e.g. `PENDING_VERIFICATION`) to the `provisioning_status`
   CHECK — a widening change, so it validates for free;
2. adding a **`purpose` CHECK** (§3.5) — a narrowing change, so it needs `NOT VALID` if any row
   exists. Today there are none, which makes now the cheapest possible moment.

## 7. Recommended implementation waves

**Wave 0 — domain, before any code.** Verify the sending domain in Resend (SPF/DKIM, then
DMARC). Nothing else can be tested end-to-end until this is done, and it is the item with an
external clock.

**Wave 1 — outbound activation.** Set the four outbound variables, send one real message, and
confirm `provider = 'resend'` and a non-null `provider_message_id` appear in the journal. That
single row is what proves the seam, and today no such row exists.

**Wave 2 — mailbox lifecycle, for real.** Reserve the first mailbox, configure it at the
provider, activate it, assign members. This exercises `provisionMailbox` → `recordSetupOutcome`
→ `grantMembership` against production for the first time.

**Wave 3 — inbound activation.** Set the webhook secret, configure provider routing, insert the
tenant rollout row, then send a message *to* the mailbox and confirm an `ec_webhook_event` and an
`ec_inbound_message` appear.

**Wave 4 — close the verification gap** (§2.1), if ratified: make `ACTIVE` reachable only after
the platform has *observed* a successful send or receipt, rather than after an operator asserts
it. This is the only wave that needs a migration.

**Explicitly not in scope here:** Send As / sender identity (EMP-4B), and anything touching the
OPS-SEC trusted-actor work.

## 8. UAT checklist

Ordered so each step fails fast and independently.

**Outbound**
1. Journal shows a message with `provider = 'resend'` and a non-null `provider_message_id`.
2. The recipient actually receives it; headers show SPF and DKIM pass.
3. A deliberately bad recipient produces `FAILED` with a provider error, and the journal shows it.
4. A retry reuses the same `idempotency_key` and does not duplicate the send.
5. `Envoyés` shows the message with its state; the technical journal shows queue mechanics.

**Mailbox lifecycle**
6. Reserve a mailbox → status `PENDING_EXTERNAL_SETUP`, visible in Administration.
7. Record failure → `SETUP_FAILED`; retry → back to `PENDING_EXTERNAL_SETUP`.
8. Record success → `ACTIVE`, `provisioned_at` and `provisioned_by` populated.
9. Disable → `DISABLED`; re-enable → `ACTIVE`.

**Users and access**
10. Assign a user with `Lire` only; confirm they see the mailbox under `/mail/mailboxes` and
    cannot administer it.
11. Grant `Envoyer`; confirm the composer offers the mailbox.
12. Attempt a second default sender → refused as a previewed conflict, not a constraint error.
13. Revoke → membership shows revoked, `is_default_sender` cleared, history retained.
14. Bulk preview writes nothing; execution refuses a stale fingerprint.

**Inbound capture**
15. Send to the mailbox → `ec_webhook_event` recorded with outcome `CAPTURED`.
16. Replay the same provider event → `DUPLICATE`, no second message.
17. Send with a bad signature → `REJECTED`, nothing captured.
18. Send to an unknown address → quarantined, not attributed to a mailbox.
19. Capture health shows last-received, invalid-signature count and per-mailbox volume.

**Permissions**
20. MAIL_ADMIN reaches all four administrative surfaces.
21. SYSTEM_ADMIN sees **no** Administration Mail entry and 404s on the routes.
22. An ordinary mail user reaches `/mail` but no administrative surface.
23. `communication:inbound:read` remains granted to **0** roles; nobody can read captured mail
    until that is deliberately granted.

## 9. Ratifications needed before implementation

1. **RATIFY-EMP5A-1 — the provider and the sending domain.** Which domain, and which `from`
   address. Everything else waits on this, and the 403 shows it was previously attempted without
   a resolved answer.
2. **RATIFY-EMP5A-2 — does "Vérifier" become a real state?** Either accept that `ACTIVE` means
   "an operator asserted it", or add an observed-verification step (migration, §6.1).
3. **RATIFY-EMP5A-3 — the first mailbox.** Its address, purpose, type and initial members. The
   platform holds none, so this is a business decision, not an engineering one.
4. **RATIFY-EMP5A-4 — inbound enablement.** Whether inbound is switched on in the same window as
   outbound, and for which tenant. Requires the tenant rollout row and the webhook secret.
5. **RATIFY-EMP5A-5 — when `communication:inbound:read` is granted, and to whom.** It is
   deliberately held by nobody. Until it is granted, captured mail is unreadable by design —
   memberships should be assigned **before** the permission, not after.
6. **RATIFY-EMP5A-6 — the `purpose` CHECK** (§3.5). Cheapest to add now, while zero rows exist.

**No implementation performed. OPS-SEC-2E not begun. No permission or provider configuration was
changed by this audit.**
