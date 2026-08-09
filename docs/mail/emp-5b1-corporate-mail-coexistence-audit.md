# EMP-5B.1 — Corporate Mail Coexistence & Zero-Disruption Audit

**Date:** 2026-08-09 · **Audit and architecture only.** No implementation, no DNS change, no
provider change, no production mail change, no migration. Nothing was modified, including
`aminata@effitrans.com`. Measured read-only against the repository, the production database and
public DNS.

---

## 1. Discovered current architecture

### 1.1 The good news, stated first

**The platform does not hardcode a mail domain anywhere.** A repository sweep of `lib/`, `app/`
and `components/` found exactly one occurrence of `effitrans.com` in shipped code, and it is a
*placeholder* in a branding form field. Every mail address is data, not a constant.

**Inbound routing is inherently additive.** `capture.ts` resolves a message by matching its
recipients against `ec_mailbox.address`, and anything unmatched is **quarantined, never
black-holed**. Registering `operations@effitrans.com` in the platform therefore reroutes nothing;
it only means that *if a copy arrives*, the platform knows where to file it. No MX change is
implied by the platform's design.

**Provider identifiers are retained on both sides** — `ec_inbound_message` keeps
`provider, provider_event_id, provider_message_id, message_id, thread_key`, and
`communication_message` keeps `provider, provider_message_id, idempotency_key,
message_id_header, thread_id`. That is enough to reconcile platform records against a corporate
system later, which most integrations cannot do.

### 1.2 What currently assumes the platform is the primary mail provider

Four things, and they are the substance of this audit.

**(a) `provisioning_status` frames the platform as the owner.**
`DRAFT → PENDING_EXTERNAL_SETUP → ACTIVE | SETUP_FAILED | DISABLED` describes *the platform
provisioning a mailbox*. There is no state meaning "this mailbox already exists at the corporate
provider and the platform is a participant in it". `provisionMailbox` **inserts a row** — the verb
and the vocabulary both say "we are creating this".

**(b) `ec_mailbox` cannot record an external owner.** Confirmed against the live catalog: there is
**no column matching `provider|external|imap|sync|forward`**. The platform can express *that* an
address exists, but not *where it lives*, *who owns it*, *which external identifier it has*, or
*how a copy reaches us*. This is the central representational gap.

**(c) `Reply-To` is declared but never populated.** `buildResendPayload` supports `reply_to`;
nothing in `dispatch.ts` or `outbound-actions.ts` ever sets it. So a message the platform sends
would carry only its envelope `From`, and **a customer's reply would go to the sending identity,
not to the corporate mailbox** — where the department actually reads mail. In a coexistence
model this is the single largest disruption risk in outbound, and it is a small gap, not a
structural one.

**(d) One global sender.** `dispatch.ts` passes no `from`; `provider.ts` uses
`COMMUNICATIONS_EMAIL_FROM`. Send As is deferred to EMP-4B, so every message leaves as one
identity regardless of the mailbox selected — and both the composer and the employee mailbox page
already say so in French.

### 1.3 Inventory of audited elements

| Element | State | Coexistence-relevant finding |
|---|---|---|
| Sender/from config | `COMMUNICATIONS_EMAIL_FROM` only | single global identity |
| Reply-To | supported by payload builder, **never set** | §1.2(c) |
| Resend integration | complete, fails closed, redacts keys | no domain verified yet |
| Outbound dispatch | CAS + idempotency + provider evidence | never exercised in production |
| Inbound capture | recipient → `ec_mailbox.address`, else quarantine | additive by construction |
| Webhook processing | signature-verified, replay-safe on `(provider, event_id)` | dedup before tenant routing |
| Mailbox provisioning | `provisionMailbox` **inserts** | assumes platform ownership |
| Aliases | `ec_mailbox_alias(address, is_active)` | **no alias *type*** |
| Memberships | 4 capabilities + revocation | 0 rows in production |
| Mailbox types | `SHARED \| PERSONAL` | no FUNCTIONAL, no ALIAS |
| Mailbox purpose | **unconstrained free text** | `GENERAL` in production is non-canonical |
| Idempotency / retry | key derived from message row id | retry reuses identity by design |
| Tenant rollout | inbound: env **+** per-tenant row; outbound: env only | asymmetric, deliberate |
| Env vars | 8 (§EMP-5B) | none imply domain ownership |

## 2. Conceptual model — seven concerns, currently conflated

The core of a safe coexistence design is refusing to treat these as one thing.

| Concern | System of record | Today |
|---|---|---|
| **Mail hosting** (where a mailbox physically lives) | Corporate provider | *not represented in the platform at all* |
| **Mail delivery** (outbound to the internet) | Corporate provider **or** Resend | Resend only, unverified |
| **Mail receiving** (MX, who accepts inbound) | Corporate provider | **must not change** |
| **Mail authentication** (SPF/DKIM/DMARC) | DNS zone owner | `-all` on both domains, Resend absent |
| **Application correspondence** (dossier-linked) | **Effitrans Platform** | `communication_message`, `ec_inbound_message` |
| **Mailbox identity** (what an address *is*) | Corporate provider | `ec_mailbox` asserts it locally |
| **Platform access control** (who may read/send) | **Effitrans Platform** | `ec_mailbox_member` — correct as is |

**The two rows the platform legitimately owns are the last two-and-a-half: application
correspondence, platform access control, and its own copy of mailbox identity.** Everything above
belongs to the corporate provider, and the architecture should say so explicitly.

## 3. Existing mailbox inventory — and whether the schema can hold it

The brief requires classifying each `@effitrans.com` address as one of: EXISTING PERSONAL, EXISTING
SHARED, EXISTING ALIAS, EXISTING DISTRIBUTION LIST, DOES NOT EXIST, UNKNOWN.

**The current schema cannot represent that.** It offers `mailbox_type ∈ {SHARED, PERSONAL}` and an
alias table with no type. There is no way to record DISTRIBUTION LIST, no way to record UNKNOWN
(the honest default before IT answers), and no way to record DOES NOT EXIST as distinct from
"not yet reserved here".

**Safe inventory process** — no contents, no credentials, no mailbox access:

1. Effitrans IT exports the *address list* only: address, type (mailbox/alias/list), owner where
   applicable, and whether it is active. No message bodies, no passwords, no tokens.
2. The list is classified **outside the platform first**, as a reviewed document.
3. Only classified, ratified addresses are ever reserved in the platform.
4. **No address is reserved before its classification is known.** Reserving an address that is
   really a distribution list, for instance, would attach dossier correspondence to something
   that fans out to many people.

## 4. Personal vs shared vs functional vs alias

The model needs four notions and currently has two.

| Notion | Meaning | Representable today? |
|---|---|---|
| PERSONAL | one human's mailbox | yes (`PERSONAL` + `owner_user_id`) |
| SHARED / DEPARTMENTAL | a team reads it | yes (`SHARED`) |
| FUNCTIONAL | a role address (`noreply@`, `billing@`) that is not a department | **no** |
| ALIAS | forwards elsewhere; not a mailbox | partially — `ec_mailbox_alias` exists but is untyped |

### 4.1 `aminata@effitrans.com` — what it should represent

Observed: `mailbox_type = SHARED`, `purpose = GENERAL`, `status = ACTIVE`, `is_active = true`,
`provisioning_attempts = 0`, **zero memberships**. Not modified by this audit.

Architecturally it is **almost certainly a PERSONAL corporate mailbox that was registered as
SHARED**, and it demonstrates three defects at once:

1. It reached `ACTIVE` with no provisioning evidence — the "ACTIVE means an operator said so" gap,
   now instantiated in production.
2. `purpose = GENERAL` is **not** in the canonical set
   (`OPERATIONS, TRANSIT, CUSTOMS, FINANCE, COMMERCIAL, SUPPORT`), so `eligibleMailboxes()`
   filters it out and **it will never be proposed to any user** — it looks healthy in
   administration while being invisible to the suggestion engine.
3. A personal name typed `SHARED` is precisely the ambiguity the type distinction exists to
   prevent.

**Recommendation (ratification, not action):** treat it as a *test artefact*, not the pilot.
Either retype it `PERSONAL` with an owner, or disable it. It should not be deleted — it is the
only real evidence of how the lifecycle behaves in production.

## 5. Department mailbox model

The canonical derivation already exists and **must not be duplicated**:

```
User → Roles → ROLE_CANONICAL_DEPARTMENT → DEPARTMENT_MAILBOXES → eligible purposes
                                                                    → membership → capabilities
```

`DEPARTMENT_MAILBOXES` maps `OPERATIONS → [OPERATIONS, SUPPORT]`, `TRANSIT → [TRANSIT, CUSTOMS,
SUPPORT]`, `FINANCE → [FINANCE, SUPPORT]`, `HUMAN_RESOURCES → [SUPPORT]`, and deliberately does
**not** imply COMMERCIAL from OPERATIONS.

**How this coexists with real corporate identity:** the derivation decides *who may use a mailbox
inside the platform*. It says nothing about who can open it in Outlook. Those are different
grants, owned by different systems, and the architecture must keep them separate — a user removed
from a corporate shared mailbox does not automatically lose platform membership, and vice versa.
That divergence is a **reconciliation concern**, and it should be surfaced rather than hidden.

Note `direction@` and `rh@` map to no canonical purpose today (`SHARED_MAILBOX_PURPOSES` has no
DIRECTION; HR maps only to SUPPORT). Extending that list is a ratification, not an implementation
detail.

## 6. Zero-disruption inbound options

**MX must not change.** Every option below leaves the corporate provider as the receiving system
of record.

| # | Pattern | Original mailbox still receives? | Platform down ⇒ corporate mail OK? | Dup risk | Loop risk | Latency | Complexity |
|---|---|---|---|---|---|---|---|
| **A** | Provider **forward/redirect rule** to an integration address | **Yes** (copy) | **Yes** | low (dedup on provider event id) | low if the integration address never replies | seconds | **low** |
| **B** | Provider **journaling / BCC copy** | **Yes** | **Yes** | low | none | seconds | medium (licensing) |
| **C** | **Mailbox API sync** (Graph/IMAP poll) | **Yes** (untouched) | **Yes** | medium (needs cursor) | none | minutes | high |
| **D** | **IMAP integration** | Yes | Yes | medium | none | minutes | high |
| **E** | **Dedicated integration alias** (`ops-platform@…`) fed by a rule | **Yes** | **Yes** | low | low | seconds | low |
| **F** | Webhook bridge from provider | Yes | Yes | depends | low | seconds | medium |
| **G** | **Point MX at the provider that webhooks us** | **NO** | **NO** | — | — | — | **prohibited** |

**Recommended: A combined with E** — a provider-side rule that *copies* mail for the pilot
department to a dedicated integration address which the platform captures. The original mailbox
keeps every message, Outlook/webmail/mobile are untouched, and **if the platform, Vercel, Supabase
or Resend is down, corporate mail continues completely unaffected** because the platform was never
in the delivery path.

**Option G is exactly what the brief forbids** and is listed only to name it as prohibited.

Attachments, threading, and dedup all survive A/E: capture stores raw content and `raw_sha256`,
preserves `message_id`/`in_reply_to`/`references_header` for threading, and dedups replay on
`(provider, provider_event_id)` before tenant routing.

## 7. Zero-disruption outbound — four different "from"s

The single most useful distinction in this document:

| Header | What it is | Recommended pilot value |
|---|---|---|
| **Visible From** | what the recipient sees | `EFFITRANS Operations <operations@send.effitrans.com>` |
| **Envelope From / Return-Path** | where bounces go; what SPF checks | the sending domain (Resend) |
| **Reply-To** | where replies land | **`operations@effitrans.com`** — the real corporate mailbox |
| **DKIM signing domain** | who cryptographically vouches | the verified sending domain |

**These need not be identical, and insisting they are is what forces risky DNS edits.** Setting
`Reply-To` to the corporate address means a customer replying to platform mail lands in the real
mailbox, read by the real team, in Outlook — which is the whole point of coexistence.

**`Reply-To` is currently never populated (§1.2c).** Closing that gap is the smallest and highest-
value outbound change, and it is a prerequisite for any pilot that sends to customers.

## 8. Resend role options

| | Disruption | Deliverability | Ownership | Auditability | Send As | Inbound | DNS | Lock-in |
|---|---|---|---|---|---|---|---|---|
| **A** transactional only, subdomain | **lowest** | good (isolated reputation) | platform | strong (provider ids) | not needed | independent | additive only | low |
| **B** Resend sends as `@effitrans.com` | **high** — edits live SPF | good | shared | strong | required later | independent | **modifies existing** | medium |
| **C** subdomain + `@effitrans.com` Reply-To | **low** | good | platform | strong | not needed | independent | additive only | low |
| **D** send via corporate provider (SMTP/Graph) | low–medium | inherits corporate reputation | **corporate IT** | weaker (fewer ids) | native | independent | none | low |

**Recommendation: C for the pilot** — a dedicated sending subdomain with corporate Reply-To. It
requires **no modification of any existing DNS record**, keeps replies in the corporate system,
and preserves the provider-acceptance evidence the platform is built around.

**D deserves genuine consideration later** and should not be dismissed: sending through the
corporate provider gives perfect alignment and no new DNS at all. It is deferred only because it
depends on capabilities nobody has confirmed yet (§11), and because the platform's evidence model
(`provider`, `provider_message_id`) is already shaped for an API provider.

**No option is selected until §11 is answered** — that is the brief's own constraint and it is
correct.

## 9. DNS change classification

| Change | Class | Rollback |
|---|---|---|
| Add DKIM records for a **new subdomain** | **SAFE / ADDITIVE** | delete the records; nothing existing referenced them |
| Add SPF TXT on a **new subdomain** | **SAFE / ADDITIVE** | delete; parent zone unaffected |
| Add a subdomain MX (only if inbound via subdomain) | REQUIRES REVIEW | delete; parent MX untouched |
| **Modify root-domain SPF** to include Resend | **HIGH RISK** | restore exact prior string — **capture it verbatim first** |
| Add/modify root DKIM selectors | REQUIRES REVIEW | remove selector |
| Add or tighten DMARC | REQUIRES REVIEW | restore prior policy; start `p=none` |
| **Change existing MX** | **PROHIBITED DURING PILOT** | — |
| Remove/replace any working record | **PROHIBITED** | — |
| Fix `effitrans.sn`'s duplicate SPF | REQUIRES REVIEW *(pre-existing defect, §10)* | restore both records |

**Rollback requirement for every class:** the exact prior record value must be captured verbatim
**before** any edit, and stored where the operator can reach it without the platform.

## 10. Failure-mode matrix

Under the recommended architecture (inbound A+E, outbound C).

| Failure | Corporate email still works? | Platform effect |
|---|---|---|
| Platform down | **YES** | no capture; copies queue at provider or are simply not fetched |
| Vercel down | **YES** | webhook returns error; provider retries |
| Supabase down | **YES** | capture fails; provider retries; nothing lost at the mailbox |
| Resend down | **YES** | platform *sending* fails; row stays FAILED; corporate sending unaffected |
| Webhook unavailable | **YES** | provider retries; dedup on `(provider, event_id)` prevents doubles |
| Forwarding rule broken | **YES** | platform stops seeing copies — **silent**, see below |
| Provider API unavailable | **YES** | as above |
| Duplicate webhook | YES | dedup ⇒ `DUPLICATE`, no second message |
| DNS misconfiguration on the **subdomain** | **YES** | only platform sending degrades |
| Invalid DKIM (subdomain) | **YES** | platform mail may be filtered; corporate mail unaffected |
| SPF failure (subdomain) | **YES** | same |
| DMARC rejection (subdomain) | **YES** | same |
| Membership misconfigured | YES | wrong platform users see a mailbox; no mail-flow effect |
| Unauthorised Send As | YES | not applicable — Send As is not in the pilot |
| Provider credential revoked | **YES** | platform sending fails closed (`provider_not_configured`) |

**Every row answers YES**, which is the design's central property: the platform is never in the
delivery path.

**One asymmetry worth naming:** "forwarding rule broken" degrades *silently* — the platform simply
stops receiving copies and nothing raises an alarm. The capture-health surface already tracks
"last received", so a **staleness alert** is the natural mitigation and should be part of inbound
activation rather than an afterthought.

## 11. Effitrans IT questionnaire

Factual answers required before any option is selected. **I have not guessed any of these.**

1. Who hosts `@effitrans.com` email? *(public DNS suggests LWS; `effitrans.sn` suggests Microsoft
   365 + OVH — this must be confirmed, not inferred)*
2. Who controls `effitrans.com` DNS, and how are changes requested?
3. Which service manages MX?
4. Which service manages employee mailboxes?
5. Which clients are in use — Outlook desktop, webmail, mobile, IMAP?
6. Does the provider support **shared mailboxes**?
7. Does it support **aliases**?
8. Does it support **forwarding / routing rules**? *(this is the pivot for inbound option A/E)*
9. Does it expose **SMTP**?
10. Does it expose an **API**?
11. Does it support **OAuth / service accounts**?
12. Does it support **journaling / copy rules**?
13. Does it support **Send As / delegation**?
14. Is **DKIM** currently enabled, and with which selectors?
15. Is **DMARC** currently enabled, and at what policy?
16. Who approves DNS and mail-provider changes?
17. Which **departmental** addresses already exist?
18. Which **employee** addresses already exist? *(list only — no contents, no credentials)*
19. Are any applications **already sending** as `@effitrans.com`?
20. Is there an existing backup/rollback process for mail configuration?

**Question 8 is the one that decides the inbound architecture.** If forwarding rules are
unavailable, options A and E collapse and the design moves to C/D (API sync), which is materially
more complex.

## 12. Recommended pilot

**One departmental mailbox, one small membership set, no Send As.**

- **Business identity:** `operations@effitrans.com` — but **do not assume it is available**.
  - *If it already exists* (mailbox, alias or list): the platform must **register, not create**.
    Classify it first (§3); reserve it in the platform only with an accurate `mailbox_type`; add a
    provider-side copy rule to the integration address.
  - *If it does not exist:* corporate IT provisions it **first**, in the corporate system, as a
    real shared mailbox with real members. Only then does the platform register it. The platform
    must never be the reason a corporate mailbox comes into existence.
- **Integration address:** a dedicated alias (e.g. `ops-platform@effitrans.com`) that receives the
  copy. Isolating it means the pilot can be switched off by deleting one provider rule.
- **Sending:** `operations@send.effitrans.com` visible From, **Reply-To `operations@effitrans.com`**.
- **Membership:** 2–3 users from the OPERATIONS department, `can_read` + `can_send`.
- **Rollback:** delete the provider copy rule; set `EFFITRANS_EC_OUTBOUND_ENABLED=false`; disable
  the mailbox. **None of these touch corporate mail**, and none require DNS changes.

## 13. Lifecycle alignment

Mapping the ratified lifecycle onto coexistence — the crucial change is that **RÉSERVER must stop
meaning "create"**.

| State | Means | Evidence required |
|---|---|---|
| **RÉSERVER** | the platform records an *intent* to participate in an address. It does **not** create a corporate mailbox and does not imply one exists. | classification from §3 |
| **CONFIGURER** | the **external relationship** is established: the corporate mailbox exists, and a copy rule / API grant points at the platform. | the provider-side artefact identified |
| **VÉRIFIER** | the platform has **observed** it working: a real inbound copy captured, and/or a real provider acceptance recorded. | `ec_webhook_event` row and/or `communication_message.provider` non-null |
| **ACTIVER** | operationally proven and released to members. | verification evidence referenced, not asserted |

**ACTIVER must cite evidence, not a human declaration.** `aminata@effitrans.com` is the proof of
why: it is `ACTIVE` today with `provisioning_attempts = 0` and no evidence of anything.

## 14. Schema implications

**The current schema cannot represent coexistence.** Confirmed against the live catalog:
`ec_mailbox` has **no** column matching `provider|external|imap|sync|forward`.

Smallest additive change that would suffice — **proposed, not created**:

| Addition | Purpose |
|---|---|
| `ec_mailbox.external_provider text` | who really hosts it (`microsoft365`, `lws`, `google`, …) |
| `ec_mailbox.external_mailbox_id text` | the provider's own identifier, for reconciliation |
| `ec_mailbox.ownership text` | `PLATFORM_MANAGED` \| `CORPORATE_EXISTING` \| `UNKNOWN` — **the key field**; it is what stops the platform assuming it owns an address |
| `ec_mailbox.integration_address text` | the alias that actually feeds capture |
| `ec_mailbox_alias.alias_type text` | `ALIAS` \| `DISTRIBUTION_LIST` \| `FORWARD` |
| `ec_mailbox.verified_at`, `verified_by`, `verification_evidence` | makes ACTIVER provable (§13) |
| `purpose` CHECK | constrain to the canonical set (zero-cost today: 1 row, and it is non-canonical) |

All are **additive and nullable**, so they cannot break the existing row. Extending
`provisioning_status` with `CONFIGURATION_REQUIRED / CONFIGURED / PENDING_VERIFICATION / VERIFIED`
is a **widening** CHECK change and validates for free. The `purpose` CHECK is *narrowing* and
would need `NOT VALID` — or, better, correcting the single `GENERAL` row first.

**No migration is created by this phase.**

## 15. Recommended target architecture

```
                         ┌──────────────────────────────────────────┐
   DNS (effitrans.com)   │  MX ── UNCHANGED ──► CORPORATE PROVIDER  │
   zone owner = Effitrans│                      (system of record   │
                         │                       for delivery,      │
   ┌───────────────┐     │                       receiving,         │
   │ send.effitrans│     │                       mailbox identity)  │
   │ .com (NEW,    │     │   ┌──────────────┐  ┌──────────────┐     │
   │ additive:     │     │   │ employee     │  │ operations@  │     │
   │ SPF + DKIM)   │     │   │ mailboxes    │  │ (shared)     │     │
   └───────┬───────┘     │   └──────┬───────┘  └──────┬───────┘     │
           │             │          │ Outlook/webmail/mobile        │
           │             │          │ UNCHANGED       │             │
           │             └──────────┼─────────────────┼─────────────┘
           │                        │                 │
           │                        │        provider COPY rule
           │                        │                 │ (deletable = instant rollback)
           │                        │                 ▼
           │                        │        ops-platform@effitrans.com
           │                        │        (dedicated integration alias)
           │                        │                 │
           │  outbound              │                 │ inbound copy
           ▼  (Resend)              │                 ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                  EFFITRANS PLATFORM                            │
   │   system of record for: application correspondence,            │
   │   platform access control, dossier linkage, audit trail        │
   │                                                                │
   │   Visible From : operations@send.effitrans.com                 │
   │   Return-Path  : sending domain (SPF/DKIM aligned)             │
   │   Reply-To     : operations@effitrans.com  ◄── replies go home │
   │                                                                │
   │   ec_mailbox (ownership=CORPORATE_EXISTING)                    │
   │   ec_mailbox_member → who may read/send IN THE PLATFORM        │
   │   communication_message / ec_inbound_message → correspondence  │
   └───────────────────────────────────────────────────────────────┘

   PLATFORM DOWN  ⇒  corporate mail unaffected: it was never in the path.
```

**Systems of record, explicitly:** corporate mailbox identity and message delivery/receiving →
**corporate provider**. Platform authorization, dossier correspondence, audit trail, outbound
provider acceptance, inbound capture → **Effitrans Platform**. DNS → **the zone owner**. User
identity → **the platform's `app_user`**, which is *not* the same as a corporate mailbox.

## 16. GO / NO-GO gates

| Gate | Requires |
|---|---|
| **Touch DNS** | §11 answered; zone owner identified; prior record values captured verbatim; change classified SAFE/ADDITIVE (§9) |
| **Authorize Resend** | option chosen (§8) after §11; subdomain verified; no existing record modified |
| **Create/register departmental mailboxes** | address classified (§3); corporate mailbox exists first; `ownership` recordable (§14) |
| **Enable outbound** | domain verified; provider-level test send succeeded outside the platform; **`Reply-To` implemented** (§1.2c) |
| **Enable inbound** | outbound acceptance proven; forwarding capability confirmed (Q8); integration alias exists; staleness alerting agreed (§10) |
| **Implement Send As** | EMP-4B; corporate provider delegation confirmed; DMARC alignment understood |
| **Broad departmental rollout** | one pilot mailbox operationally proven for an agreed period; reconciliation between corporate and platform membership defined (§5) |

## 17. Ratifications required

1. **RATIFY-EMP5B1-1 — the corporate provider is confirmed by Effitrans IT**, not inferred from
   DNS. Everything downstream depends on it.
2. **RATIFY-EMP5B1-2 — inbound pattern**: provider copy rule to a dedicated integration alias
   (recommended A+E), or an API/IMAP sync if forwarding is unavailable.
3. **RATIFY-EMP5B1-3 — outbound pattern**: sending subdomain with corporate Reply-To
   (recommended C), or send via the corporate provider (D).
4. **RATIFY-EMP5B1-4 — `ownership` and the lifecycle vocabulary**: RÉSERVER stops meaning
   "create"; ACTIVER requires evidence (§13, §14).
5. **RATIFY-EMP5B1-5 — `aminata@effitrans.com`**: retype as PERSONAL, or disable. Not deleted.
6. **RATIFY-EMP5B1-6 — canonical purposes**: whether DIRECTION (and an explicit HR purpose) join
   the ratified list, since `direction@` and `rh@` map to nothing today.

## 18. Recommended next implementation phase

**EMP-5C — Coexistence Schema Foundation (dark).** Additive, nullable columns from §14 plus the
widened `provisioning_status`, with **no behaviour change and no call-site activation** — the same
expand-then-activate discipline that OPS-SEC-2A/2B proved. It can be built and CI-verified while
Effitrans IT answers §11, because the schema shape does not depend on which provider they name.

**Not** next: touching DNS, authorizing Resend, enabling either direction, or Send As. Each is
gated in §16 on answers nobody has yet.

---

**Nothing was implemented. No DNS, provider, Vercel, MX, SPF, DKIM or DMARC change was made. No
production mailbox was modified, including `aminata@effitrans.com`. No migration was created.
EMP-5C and OPS-SEC-2E were not begun.**
