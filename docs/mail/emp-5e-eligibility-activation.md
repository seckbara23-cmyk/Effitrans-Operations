# EMP-5E — Department Eligibility Activation and Existing Mailbox Classification

**Phase:** EMP-5E · **Mode:** narrow implementation, audit first
**Baseline:** EMP-5D at SHA `b82283d`, CI run `31318755079` (#416), migrations aligned through
`20260818000001_mailbox_department_eligibility.sql`.

> Personal and customer data is deliberately absent from this document. The single production
> mailbox is referred to by its properties, never by its address.

---

## 1. The defect, restated

`ec_mailbox.purpose` was serving two concepts at once:

| Concept | What it is | Where it came from |
|---|---|---|
| **Usage** | A free-text tenant label (`GENERAL` by default, `QUOTATION` in use) | EC-1 |
| **Eligibility** | The key deciding which department's employees are *proposed* a mailbox | EMP-4A |

Two independent code paths compared that free-text column against the six-value department set
**by string equality**. A mailbox typed `Operations`, or with a trailing space, was therefore
proposed to **nobody** — while looking perfectly healthy in administration. Eligibility depended
on spelling.

EMP-5C could not fix this by constraining `purpose`: the proposed constraint outlawed the
column's own default and retroactively invalidated `QUOTATION`. EMP-5D added the controlled key
`department_eligibility` **dark**. EMP-5E switches the comparison onto it.

## 2. Complete eligibility call graph

```
User
 └─ roles (Phase 9.0A — departments are DERIVED, there is no user column)
     └─ ROLE_CANONICAL_DEPARTMENT
         └─ DEPARTMENT_MAILBOXES          ← lib/ec/mailboxes/eligibility.ts, SINGLE SOURCE
             └─ eligibleMailboxes(roles) → [{ eligibility, reason }]
                 ├─ (A) BULK PREVIEW      lib/ec/mailboxes/bulk.ts
                 │        fed by          lib/ec/mailboxes/bulk-actions.ts
                 │        └─ BULK EXECUTION recomputes the preview, inherits (A)
                 └─ (B) ONBOARDING / INDIVIDUAL SUGGESTIONS
                          app/users/[id]/enterprise-mail/page.tsx
```

**Exactly two comparison sites existed, (A) and (B), and both are converted.** No third
mechanism keys on `purpose` after this phase.

Paths that deliberately have **no** eligibility check, before or after:

* `grantMembership` / `revokeMembership` — explicit administrator acts.
* The manual "Accorder l'accès" picker — individual assignment is always available.

Legitimate readers of `purpose` that are **not** eligibility and are untouched:
`lib/ec/triage/model.ts` (`QUOTATION` → handoff suggestion), plus display in mailbox health, the
triage studio, and the mailbox detail page.

## 3. Architecture after this phase

| | `purpose` | `department_eligibility` |
|---|---|---|
| Label | « Usage de la boîte » | « Département éligible » |
| Vocabulary | Free tenant text | Constrained: 6 values or NULL |
| Constrained in DB | No (deliberately) | Yes (migration 96 CHECK) |
| Decides proposals | **No** | **Yes** |
| Editable after creation | No | Yes, via `setDepartmentEligibility` |
| NULL means | n/a (NOT NULL, default `GENERAL`) | Not a departmental mailbox — **not** `GENERAL`, **not** all departments |

A mistyped bucket is now **refused** rather than silently matching nobody: `isDepartmentEligibility`
rejects `Operations`, `OPERATIONS `, `operations`, `GENERAL`. The mistake surfaces when it is made.

## 4. Mailbox type semantics (frozen)

| Type | Meaning | May hold eligibility |
|---|---|---|
| `PERSONAL` | Primarily one natural person; delegation exceptional and explicit | **No** — refused by the write path |
| `SHARED` | Several authorised users; departmental workflow | Yes |
| `FUNCTIONAL` | A business function rather than a person or department | Yes |
| `ALIAS` (`ec_mailbox_alias.alias_type`) | Not an independent mailbox; resolves elsewhere | n/a |

These are **platform** semantics, not provider semantics: a department address may well be an
ordinary user mailbox at the provider with delegated access.

An alias cannot act as a membership container **by construction** — `ec_mailbox_member.mailbox_id`
references `ec_mailbox`, and every write path resolves the id against that table, so an alias id
yields `mailbox_not_found`.

## 5. Membership preservation

Changing or clearing `department_eligibility` **creates no membership, revokes none, changes no
capability, moves no default sender, and deletes no history**. The write path updates exactly one
column and contains no reference to `ec_mailbox_member` at all; it is audited under its own action
`ec.mailbox.classified`, distinct from the membership events.

Eligibility governs **proposals and bulk selection**. Access already granted came from an
administrator's recorded decision, and only a grant or a revocation moves it.

## 6. Preview and fingerprint

The preview → fingerprint → execute chain is unchanged in shape. The fingerprint's **head** now
binds `department_eligibility` and `mailbox_type` alongside the mailbox id, capabilities and the
eligibility filter.

Binding it in the head rather than relying on the decisions is necessary, not decorative: two
cases produce byte-identical decisions on a different authorization basis —

* an empty candidate list, where the body is empty; and
* candidates whose roles make them eligible for **both** the old and the new bucket.

A mailbox reclassified between preview and confirmation therefore invalidates the preview
(`preview_stale`) instead of executing under an approval nobody gave.

A new outcome, `SKIPPED_MAILBOX_NOT_DEPARTMENTAL`, reports the **mailbox-level** fact once rather
than telling the administrator that forty departments are individually at fault.

## 7. Readiness assessment

`lib/ec/mailboxes/readiness.ts` is pure, deterministic and **powerless** — it describes, and
nothing in it can change, disable or reclassify a mailbox. Codes:

`OWNERSHIP_UNKNOWN` · `CORPORATE_IDENTITY_UNCONFIRMED` · `ACTIVE_WITHOUT_VERIFICATION` ·
`PERSONAL_LOOKING_ADDRESS` · `PERSONAL_WITH_ELIGIBILITY` · `ELIGIBILITY_ON_INACTIVE_MAILBOX` ·
`ELIGIBLE_BUT_UNVERIFIED` · `NO_DEPARTMENT_ELIGIBILITY` (**info**) · `NO_MEMBERS`

`NO_DEPARTMENT_ELIGIBILITY` is `info`, never `warning`: manual assignment is a legitimate
arrangement, not a defect.

The personal-looking-address test uses a **whitelist** of functional local parts rather than
pattern-matching for names — the direction that fails into a dismissible note rather than a
confident wrong answer.

## 8. The existing production mailbox — audit

Read-only query against production. Observed facts:

| Field | Value |
|---|---|
| `ownership` | `UNKNOWN` |
| `mailbox_type` | `SHARED` |
| `purpose` | `GENERAL` |
| `department_eligibility` | `NULL` |
| `provisioning_status` / `is_active` | `ACTIVE` / `true` |
| Verification evidence (corporate identity, outbound, inbound) | none |
| Members (total and active) | 0 |
| Inbound messages | 0 |
| Aliases | 0 |
| Address shape | nominative (a person's given name) |

**Provenance evidence.** The row was created through the platform's own provisioning surface and
marked `ACTIVE` **19 seconds later**, with an empty confirmation note and `provisioning_attempts = 0`.
No external mailbox can be created and verified in 19 seconds, so `ACTIVE` here records a human
assertion made immediately after reserving the address — exactly the weakness EMP-5A identified.
This is evidence about **how the row was made**, not about whether an address exists at the
provider; the platform integrates with no provider and cannot observe that.

### Disposition options and the evidence for each

| | Option | Evidence for | Evidence against |
|---|---|---|---|
| **A** | PERSONAL corporate mailbox | Nominative address; zero members; zero messages | Address shape alone is not proof; no owner recorded, and PERSONAL requires naming a titulaire |
| **B** | SHARED delegated mailbox | Current stored type | Nothing supports it: no members, no delegation recorded, no evidence of multi-user intent |
| **C** | FUNCTIONAL mailbox | Now representable (EMP-5C) | A given name is not a business function |
| **D** | Deactivate pending verification | No verified provisioning; no members; no traffic — deactivating costs nothing observable | If a real corporate mailbox is behind it, deactivating is a platform-side change to a live corporate identity, which ZERO-DISRUPTION forbids without confirmation |
| **E** | Preserve as-is with warnings | Costs nothing; loses nothing; surfaces the uncertainty where an administrator reads it | Leaves an `ACTIVE`, unverified row in place |

**Applied in this phase: E.** The record is untouched and now carries « Classification à
confirmer » and « Boîte active sans preuve de vérification » in Administration Mail. A, B, C and
D all require external facts the platform does not hold and must not guess.

### External facts required before any disposition

1. Does a mailbox with this address exist at the corporate provider?
2. Does the named person personally own it?
3. Is it intended for several users?
4. Is it already carrying real company email?
5. Can it be modified safely, and by whom?

Until (1)–(5) are answered, **the platform must not retype, reclassify, deactivate or delete this
record**, and this phase does not.

## 9. Production impact

* Application eligibility behaviour changed; admin UI changed.
* **No migration.** Migration 96 already provided the column and its CHECK.
* No existing mailbox row changed. No membership changed. No permission, role, policy, provider,
  DNS, MX/SPF/DKIM/DMARC or Vercel variable changed. Inbound and outbound remain disabled.

### Before / after

```
BEFORE   purpose = "OPERATIONS"                → proposed to Operations users
         purpose = "Operations"                → proposed to NOBODY, silently

AFTER    department_eligibility = "OPERATIONS" → proposed to Operations users
         department_eligibility = "Operations" → REFUSED at the write path
         purpose = "Correspondance générale",
         department_eligibility = NULL         → manual assignment only
```

Live effect today is nil: the single production mailbox has `department_eligibility = NULL` and
`purpose = 'GENERAL'`, so it was proposed to nobody before this phase and is proposed to nobody
after it. The difference is that the reason is now visible and correctable.

## 10. Operator decisions still required

1. **Disposition of the existing mailbox** — needs external facts (1)–(5) above.
2. **Which departmental mailboxes to create**, and their eligibility buckets.
3. The 20-question Effitrans IT questionnaire from EMP-5B.1 — **Q8 (forwarding-rule support)
   still decides the inbound architecture**.
4. No domain verified at Resend; SPF/DKIM absent; `effitrans.sn` carries two SPF records
   (an RFC violation) — all unchanged and out of scope here.
