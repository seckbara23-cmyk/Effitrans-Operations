# EMP-5B — Provider and Domain Readiness

**Date:** 2026-08-09 · **Readiness plan only.** No implementation, no migration, no inbound
activation, no provider configuration change, no secret read or written. Measured read-only
against production and public DNS.

---

## 1. Readiness verdict

**NOT READY. Blocked on provider-side domain verification.**

The platform is ready; the *domain* is not. Nothing in the application needs to change to make the
first real send work — the provider seam is complete, fails closed, and records evidence
correctly. What is missing is entirely outside the codebase: **Resend has never been authorised to
send as any Effitrans address**, and public DNS confirms it.

This is the same wall the platform already hit once. The three FAILED messages carry
`last_error = resend_http_403`, and a 403 from Resend means the account is not permitted to send
from that address — not a bad key, which returns 401.

**The blocker, exactly:** no Effitrans domain is verified in the Resend account, and neither
domain's DNS carries Resend DKIM records or authorises Resend in SPF.

## 2. Domain evidence — both candidates are real, neither is Resend-ready

Public DNS, read without credentials:

| | `effitrans.com` | `effitrans.sn` |
|---|---|---|
| MX | `mail.effitrans.com` (LWS hosting) | **Microsoft 365** (prio 1) + OVH (prio 10–40) |
| SPF | `v=spf1 mx:effitrans.com a:mail.effitrans.com a:mailphp.lws-hosting.com **-all**` | `v=spf1 a mx include:mx.ovh.com include:spf.protection.outlook.com **-all**` |
| Resend authorised? | **No** | **No** |
| Staff accounts using it | **29** | 16 |

Both are live, actively-configured mail domains, so Effitrans evidently operates both. **I cannot
confirm from here that Effitrans controls their DNS zones** — that is the operator's to confirm,
and it is stop condition #1.

### 2.1 Two defects found in existing DNS, independent of this phase

1. **`effitrans.sn` publishes TWO SPF records.** RFC 7208 permits exactly one; multiple records
   are a `permerror`, and many receivers treat that as a failure. This is a pre-existing mail
   deliverability defect on a live domain and is worth fixing whether or not Enterprise Mail
   proceeds.
2. **Both domains end in `-all`** (hard fail). That is correct, strict practice — and it means
   adding a new sender is *not* optional configuration: mail sent by an unlisted service will be
   rejected outright rather than merely marked suspicious.

## 3. Current implementation — audited, and it does not need changing

**Provider seam** (`lib/comms/provider.ts`) is complete and honest:

- **Fails closed.** With no `COMMUNICATIONS_EMAIL_PROVIDER` it returns `provider_not_configured`;
  the message is FAILED and no event is emitted. The comment records that this used to return
  `{ ok: true }` and that the stub was "a lie told to every caller".
- **Blocks the testing sender in production.** `resend.dev` senders deliver only to the account
  owner, so they are refused when `NODE_ENV=production` and allowed in dev.
- **Sanitises errors.** `sanitizeResendError` caps length and redacts `re_…` keys and bearer
  tokens before anything reaches `last_error` or the logs.
- **Records real evidence.** `provider` and `providerMessageId` are set only from a genuine 2xx.
- **Emits a domain-only diagnostic** (`comms.resend_sender`) logging `fromValueDomain` — the
  sender *domain*, never the local part or the key. That is how the runtime's configured sender
  can be confirmed without exposing a value.

**From resolution:** `COMMUNICATIONS_EMAIL_FROM` only. `dispatch.ts` passes no `from`, so the
selected mailbox does **not** become the envelope sender. Send As stays deferred to EMP-4B, and
the pilot must not depend on it.

**Outbound gate:** `outboundEnabled()` is `EFFITRANS_EC_OUTBOUND_ENABLED === "true"` — **a single
env layer**. There is no `tenant_ec_outbound_rollout` table (confirmed absent), so unlike inbound
there is no per-tenant row to create.

**Can the provider be tested without touching code?** **Yes** — and it should be. Domain
verification and a test send are entirely provider-side (Resend dashboard, or a direct API call
from an operator's machine). Step 4 below deliberately proves the provider *before* the platform
is enabled, so a failure is unambiguous.

## 4. Current production state — the baseline moved since EMP-5A

| Fact | Value |
|---|---|
| Mailboxes | **1** — `aminata@effitrans.com` |
| …purpose / type | `GENERAL` / `SHARED` |
| …status | **`ACTIVE`, `is_active = true`, `provisioning_attempts = 0`** |
| Mailbox members | **0** |
| Provider acceptances ever recorded | **0** |
| Newest outbound message | 2026-07-28 |
| Inbound rollout rows / webhook events | 0 / 0 |
| Staff holding `communication:send` | 24 |

### 4.1 Three problems with the existing mailbox

1. **It reached `ACTIVE` with zero provisioning attempts.** This is precisely the gap EMP-5A
   named — `ACTIVE` currently means "an operator asserted it", not "the platform observed it" —
   and it is now instantiated in production. Ratification #3 fixes this going forward; the
   existing row remains unproven.
2. **`purpose = 'GENERAL'` is not a canonical purpose.** The recognised set is
   `OPERATIONS, TRANSIT, CUSTOMS, FINANCE, COMMERCIAL, SUPPORT`. `eligibleMailboxes()` filters to
   that list, so **this mailbox will never be proposed to anyone**. It is invisible to the
   suggestion engine while appearing healthy in administration. Ratification #4 would prevent a
   recurrence; the existing row needs correcting either way.
3. **It is named after a person but typed `SHARED`.** A personal name as a departmental mailbox
   invites exactly the ambiguity the SHARED/PERSONAL distinction exists to prevent.

## 5. Pilot recommendation — and a decision I will not make silently

The brief proposes `operations@effitrans.com`. `effitrans.com` is the right **domain** — 29 staff
accounts and the only existing mailbox are on it. The question is *how* to authorise Resend on it,
and the two options are not equivalent in risk.

**Option A — verify the root domain `effitrans.com`.**
Sending as `operations@effitrans.com` requires adding Resend DKIM records **and amending the live
SPF record** of the company's primary mail domain. That SPF currently ends `-all` and covers the
LWS-hosted production mail. Editing it incorrectly breaks *existing* company email, not just this
pilot.

**Option B — verify a dedicated sending subdomain (recommended).**
Verify e.g. `send.effitrans.com`. It gets its own SPF and DKIM, **touches nothing the current mail
flow depends on**, isolates sending reputation, and is Resend's own recommended pattern. Send as
`operations@send.effitrans.com` with `Reply-To: operations@effitrans.com`, so replies still land
in the real mailbox.

**Recommendation: Option B for the pilot**, on the principle that a first activation should not
require editing the DNS record that all existing company mail depends on. Option A remains
available later, deliberately, once the path is proven.

**This is RATIFY-EMP5B-1 and I have not assumed an answer.**

## 6. Operator checklist — provider and DNS

Stop at the first step that fails; do not proceed on a partial pass.

1. **Confirm domain control.** Someone must be able to add DNS records to the chosen zone
   (`effitrans.com` at LWS, or a subdomain of it). Without this, everything below is blocked.
2. **Create/confirm the Resend account** and note which domain it will verify.
3. **Add the Resend domain** in the Resend dashboard; it will produce DKIM records and an SPF
   value.
4. **Publish the DNS records.** For Option B this is a new subdomain zone — nothing existing is
   edited. For Option A, the existing SPF must be amended to include Resend **without dropping
   the current mechanisms**, and `-all` retained.
5. **Wait for propagation and confirm "Verified"** in Resend. Minutes to hours; it is the item
   with an external clock.
6. **Fix `effitrans.sn`'s duplicate SPF record** (§2.1) — unrelated to this pilot, but it is a
   live defect and now is when someone is looking at DNS.
7. **Provider-level test send, outside the platform** — Resend dashboard or a direct API call
   from an operator machine to a real inbox. **This must succeed before the platform is touched**,
   so that any later failure is unambiguously the platform's.

## 7. Vercel configuration — names only, no values

Set in **Production** scope. I have not read these and will not.

| Variable | Purpose | Note |
|---|---|---|
| `COMMUNICATIONS_EMAIL_PROVIDER` | selects the seam | must be exactly `resend` |
| `RESEND_API_KEY` | credential | **secret** — set in Vercel only, never committed, never echoed |
| `COMMUNICATIONS_EMAIL_FROM` | envelope sender | must be an address on the **verified** domain |
| `EFFITRANS_EC_OUTBOUND_ENABLED` | outbound feature gate | `true`; single layer, no tenant row |
| `COMMUNICATIONS_EMAIL_DEBUG` | optional diagnostics | leave unset unless diagnosing |

**Do NOT set this phase:** `EC_INBOUND_WEBHOOK_SECRET` and `EFFITRANS_EC_INBOUND_ENABLED` —
inbound stays off until outbound acceptance is proven (ratification #5).

A redeploy is required for new variables to take effect.

**Secret handling:** the API key is set only in Vercel's encrypted store. It never enters the
repository, a migration, a log line or a chat message. The code already redacts `re_…` patterns
from any error text before storage, so a leaked key cannot reach `last_error`.

## 8. Pilot mailbox and user prerequisites

- **Mailbox:** reserve a mailbox whose address matches the verified sender domain, with a
  **canonical purpose** — `OPERATIONS` or `SUPPORT`, not `GENERAL`.
- **The existing `aminata@effitrans.com` should not be the pilot** as it stands: unproven `ACTIVE`,
  non-canonical purpose, personal name on a SHARED box. Correct it or reserve a clean one.
- **Members:** at least one active user with `can_read` and `can_send`. There are currently **0
  memberships in the entire platform**, so this must be granted explicitly — and per EMP-4A,
  memberships should be assigned **before** `communication:inbound:read` is ever granted.
- **Sender:** the pilot user needs `communication:send` (24 staff hold it).
- **Send As is not required** and must not be needed — the envelope sender is
  `COMMUNICATIONS_EMAIL_FROM` regardless of mailbox (stop condition #6).

## 9. Production verification pack

Run **after** the first governed send. Read-only.

```sql
-- (a) THE decisive query: has a real provider ever accepted anything?
--     Before the pilot this returns 0 rows. One row means the seam is proven.
select id, status, provider, provider_message_id, idempotency_key,
       mailbox_id, kind, created_by, tenant_id, sent_at
from public.communication_message
where provider is not null
order by created_at desc limit 5;
-- EXPECT: provider='resend', provider_message_id NOT NULL, status='SENT'
```

```sql
-- (b) NO FALSE SENT: nothing may be SENT without a real provider acceptance.
--     Historical rows predate the provider column, so scope to the pilot window.
select count(*) as false_sent
from public.communication_message
where status = 'SENT' and provider is null and created_at > now() - interval '1 day';
-- EXPECT: 0
```

```sql
-- (c) Idempotency + mailbox linkage + attribution on the pilot row.
select (idempotency_key is not null) as has_idempotency_key,
       (mailbox_id is not null)      as linked_to_mailbox,
       (created_by is not null)      as has_actor,
       tenant_id
from public.communication_message
where provider is not null order by created_at desc limit 1;
-- EXPECT: all true; tenant_id = the Effitrans tenant
```

```sql
-- (d) NO DUPLICATE SEND: one idempotency key must map to exactly one message.
select idempotency_key, count(*) c
from public.communication_message
where idempotency_key is not null
group by idempotency_key having count(*) > 1;
-- EXPECT: no rows
```

```sql
-- (e) FAILED stays FAILED — a failure must not be quietly upgraded.
select status, provider, left(coalesce(last_error,'-'), 60) as err, count(*)
from public.communication_message
where status = 'FAILED' group by 1,2,3 order by 4 desc;
-- EXPECT: the 3 historical resend_http_403 rows, provider NULL, unchanged
```

```sql
-- (f) Inbound must still be untouched this phase.
select (select count(*) from public.ec_webhook_event)           as webhook_events,
       (select count(*) from public.tenant_ec_inbound_rollout)  as inbound_rollout_rows,
       (select count(*) from public.role_permission rp
          join public.permission p on p.id = rp.permission_id
         where p.code = 'communication:inbound:read')           as inbound_read_grants;
-- EXPECT: 0, 0, 0
```

**External confirmation:** the message arrives in a real inbox, and its headers show **SPF pass**
and **DKIM pass** for the verified domain. A delivered message that fails SPF is not a success —
it is a message that will start landing in spam as volume grows.

**Failure/retry validation:** send deliberately to an invalid recipient; the row must go `FAILED`
with a sanitized `resend_http_*` reason, and a retry must reuse the same `idempotency_key` without
producing a second provider acceptance.

## 10. Rollback / deactivation

Ordered least to most disruptive; none touches data or schema.

1. **Set `EFFITRANS_EC_OUTBOUND_ENABLED=false` and redeploy.** Dispatch stops; drafts remain.
2. **Unset `COMMUNICATIONS_EMAIL_PROVIDER`.** The seam fails closed — messages become FAILED with
   `provider_not_configured`, and *nothing is falsely marked SENT*.
3. **Disable the mailbox** (`setMailboxEnabled(false)` → `DISABLED`); membership history is kept.
4. **Revoke the Resend API key** in the provider dashboard if the credential is suspect.
5. **DNS:** leave the records. Removing DKIM breaks verification without undoing anything, and
   under Option B nothing existing was modified in the first place.

No migration was applied, so there is nothing to reverse in the database.

## 11. Prerequisites for Wave 1

Wave 1 (first governed platform send) may begin only when **all** of these hold:

1. Domain control confirmed and DNS access available (§6.1);
2. Resend reports the chosen domain **Verified**;
3. A provider-level test send succeeded **outside** the platform (§6.7);
4. `COMMUNICATIONS_EMAIL_FROM` is an address on that verified domain;
5. The four Vercel variables are set in Production and redeployed (§7);
6. A pilot mailbox exists with a **canonical purpose** and at least one member holding
   `can_read` + `can_send` (§8);
7. Inbound remains off — no webhook secret, no rollout row, no `communication:inbound:read` grant.

## 12. Ratifications required

1. **RATIFY-EMP5B-1 — root domain or sending subdomain** (§5). The one decision that changes the
   DNS risk profile. Recommended: subdomain for the pilot.
2. **RATIFY-EMP5B-2 — the exact pilot address**, once (1) is settled.
3. **RATIFY-EMP5B-3 — the existing `aminata@effitrans.com` mailbox** (§4.1): correct its purpose
   and status, retire it, or leave it and reserve a separate pilot box.
4. **RATIFY-EMP5B-4 — who fixes `effitrans.sn`'s duplicate SPF record** (§2.1). Out of scope
   here, but it is a live defect on a production mail domain.

## 13. Stop conditions — evaluated

| Condition | Status |
|---|---|
| Effitrans domain not confirmed | **Ownership strongly evidenced; DNS *control* unconfirmed — operator must confirm** |
| DNS access unavailable | **Unknown — blocking until confirmed** |
| Provider sender identity not authorised | **TRIGGERED — no Resend verification, no DKIM, SPF `-all` excludes Resend** |
| Platform uses an unverified from address | **TRIGGERED — 0 provider acceptances ever recorded** |
| Enabling outbound would require guessing env values | Avoided — names only, no values read or assumed |
| Send As required for the pilot | Not required; envelope sender is `COMMUNICATIONS_EMAIL_FROM` |
| Provider config indistinguishable from app code | Cleanly separated — §6 is provider/DNS only, §7 is configuration only |

**Two stop conditions are live, and both are provider/DNS-side.** No code change is required or
recommended. Nothing was implemented, no inbound step was taken, no lifecycle migration was
written, and no secret was read or exposed.
