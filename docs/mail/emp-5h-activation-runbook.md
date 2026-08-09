# Enterprise Mail — first controlled mailbox pilot (operator runbook)

**Status: NOT YET EXECUTABLE.** Two things gate it — see *Prerequisites*. Written now so the
sequence is agreed before anyone is under pressure to improvise.

> **The governing constraint.** No step in this runbook replaces the corporate MX, changes existing
> mail routing, or makes Effitrans's email depend on this platform. If a step appears to require
> that, the step is wrong — stop and re-read §Stop conditions.

---

## Prerequisites

| # | Prerequisite | Status today |
|---|---|---|
| P1 | **Q8 answered** — can the provider copy/forward mail to an integration address? | **UNRESOLVED** |
| P2 | Domain and address list ratified (RATIFY-EMP5H-1) | open |
| P3 | Two active MAIL_ADMIN holders | ✅ satisfied (2) |
| P4 | Migrations applied and ledger reconciled | ✅ 98/98 |
| P5 | Resend (or chosen sender) domain verified | not done |
| P6 | The pilot address exists at the corporate provider | not done |

**P1 decides the shape of the pilot.** If forwarding is unavailable, the pilot is **outbound-only**
and every inbound step below is skipped — not faked.

## Choosing the pilot mailbox

Use a **new functional address** (`operations@` is the natural first). Do **not** pilot on:

* the existing legacy mailbox — its provenance is unestablished; and
* any address a person currently relies on.

A pilot that breaks somebody's working mailbox has failed before it starts.

## Maker / checker sequence

Two different people, both holding `communication:mailbox:provision`. The platform refuses if they
are the same person; this is not a formality to work around.

| Step | Who | Action | Result |
|---|---|---|---|
| 1 | **Maker** | Administration → Enterprise Mail → Boîtes → *Réserver* | state `RESERVED` |
| 2 | Operator (out of band) | Create the mailbox at the corporate provider | — |
| 3 | **Maker** | *Configurer* — ownership, provider, external id, integration address | `CONFIGURED` |
| 4 | **Maker** | *Soumettre à vérification* | `PENDING_VERIFICATION` |
| 5 | **Maker** | *Enregistrer le résultat* → IDENTITY, passed | `VERIFIED`, maker recorded |
| 6 | **Checker** | *Activer* | `ACTIVE`, activator recorded |

Steps 5 and 6 **must** be different people. The readiness table's *Séparation des tâches* column
tells you which state you are in before you try.

## Provider and DNS checks — observations, never changes

Record what you observe; change nothing.

* Confirm the mailbox exists and is reachable in the provider console.
* Note the current MX for the domain. **Do not modify it.**
* Note the existing SPF record. **Do not modify it.** For `effitrans.sn`, note that two SPF records
  exist — an RFC violation whose resolution belongs to the zone owner, not to this pilot.
* Note whether DKIM is published for the sending domain.

If sending requires an SPF or DKIM change, that is a **separate, authorised change** with its own
approval — never folded into a pilot.

## Platform verification evidence

Every capability check is **manual evidence**: this platform integrates with no mail provider and
must not claim otherwise. Each recorded result needs a reference pointing at something already
stored elsewhere.

| Capability | Evidence to record | Reference |
|---|---|---|
| Identity | a human confirmed the address exists at the provider | note who and when |
| Outbound | provider accepted a real message | `provider_message_id` |
| Inbound | a capture event was really observed | `ec_webhook_event.id` |

Capability evidence **expires after 90 days**. Identity evidence does not expire.

## Outbound test

1. Enable outbound for the tenant (`EFFITRANS_EC_OUTBOUND_ENABLED`) — a deliberate, reversible act.
2. Compose from the pilot mailbox to an address you control.
3. Expect: refused until outbound evidence is recorded — **that is the system working.** Record the
   evidence from the provider acceptance, then retry.
4. Confirm delivery and capture the `provider_message_id`.

## Reply-To test

Reply to the message you received. It must arrive **in the corporate mailbox**, read by the team
who already work there — not in any platform-only inbox. This is the coexistence property; if the
reply lands anywhere else, stop.

Confirm also that the **visible From, Return-Path and DKIM domain are unchanged**. Reply-To is the
only header this platform sets.

## Inbound test — **only if P1 allows it**

Skip entirely if the provider cannot copy mail. Do **not** substitute an MX change.

1. Configure the provider-side **copy** rule to the integration address. The corporate mailbox
   remains the delivery target; the platform sees a copy.
2. Enable inbound (env flag **and** the tenant rollout row — both, by design).
3. Send a test message to the pilot address.
4. Expect: quarantined as `mailbox_not_verified` until inbound evidence is recorded. Record it from
   the observed capture event, then retest.
5. Confirm the message appears in triage **and** that the corporate mailbox still received it.

## Rollback

Every step is reversible, and none touches corporate mail:

| Undo | How | Effect |
|---|---|---|
| Stop sending | unset `EFFITRANS_EC_OUTBOUND_ENABLED` | outbound off platform-wide |
| Stop capturing | disable the tenant rollout row (or the env flag) | inbound off |
| Take the mailbox out of service | *Désactiver* | routing stops; **evidence and history are kept** |
| Undo the copy rule | remove it at the provider | corporate delivery unaffected throughout |

There is no rollback step for MX, SPF, DKIM or DMARC, because no step changed them.

## Evidence to retain

Provider acceptance id; capture event id; who verified and when; who activated and when; the
observed MX/SPF/DKIM values before and after (expected: identical); the audit rows
(`ec.mailbox.configured`, `verification_submitted`, `verification_passed`, `ec.mailbox.activated`).

## Stop conditions — halt and report

* Any corporate mailbox stops receiving, or a user reports missing mail.
* The reply to a platform message does **not** arrive in the corporate mailbox.
* A step would require changing MX, SPF, DKIM, DMARC or the delivery target.
* The provider cannot copy mail and someone proposes pointing MX at the platform instead.
* Activation is refused and someone proposes bypassing the guard, granting themselves the second
  role, or editing the database directly.
* Evidence cannot be referenced to something real and someone proposes recording it anyway.

The last three are the ones that matter most: each is a shortcut that would trade a verified
system for one that merely claims to be.
