# EC-2D — Triage Governance Freeze

**Date:** 2026-08-04 · **Decision freeze only — no code, migration, grant or UI.**
Inputs: management business confirmations (2026-08-04) · EC-0 `4e85756` · EC-1
`aa50fd9` · LOG-0 `a3fb111` · Digital LOS `9f94237`.

---

## 0. Two findings that must be read before the decisions

### FINDING-1 — "Quarantine" is not available as a triage outcome (conflict with shipped EC-1)

The target workflow lists **Quarantine** as triage outcome #4. **EC-1 already forbids
it.** `ec_triage_transition_guard` (migration 80) raises `EC602` — *« la quarantaine est
décidée à la capture, jamais après »* — on any transition *to* `QUARANTINED`.

That was deliberate: quarantine in EC-1 means *"this message could not be routed to a
tenant"*, and such a row carries `tenant_id = NULL`, making it invisible to every
tenant. A triager cannot quarantine a message they can see, because a message they can
see is already routed to their tenant. The two meanings are different states wearing one
word.

**Not silently resolved.** Options for management:
* **(a) Accept 4 triage outcomes** — attach · quotation-handoff · correspondence ·
  discard-with-reason. Unroutable mail keeps its separate capture-time quarantine, which
  no triager touches. *Recommended: it preserves EC-1 unchanged and loses nothing — a
  malicious or spam message is discarded with a reason, which is the honest description.*
* **(b) Introduce a distinct post-triage state** (e.g. `WITHHELD`) for "seen, and
  deliberately frozen rather than resolved". Additive; requires a new status value and a
  guard change. Only worth it if a real operational need exists for freezing without
  resolving.

**Freeze pending this answer → Q-EC2-1.**

### FINDING-2 — `QUOTATION_MANAGER` collapses maker and checker (affects EC-3, surfaced now)

`QUOTATION_MANAGER` holds `quotation:create`, `quotation:send` **and**
`quotation:approve`; `OPS_SUPERVISOR` holds the same three. Management's stated model is
that Operations *prepares* and the Operations Manager/Supervisor *approves* — i.e. two
different people. Today's catalog lets one role do both.

EC-2 does not touch quotations, so this blocks nothing now. **It must be resolved before
EC-3 grants anything** → Q-EC2-6.

---

## 1. EC-2 decision record

### DEC-EC-D1 — Initial inbound address strategy · **DECIDED: Option A, one address**

| Option | Assessment |
|---|---|
| **A. New tenant-owned shared address** | **RECOMMENDED.** Customer-visible, tenant-owned, and it is exactly what EC-1's router expects: an explicitly configured recipient address resolving to one tenant and one mailbox. |
| B. Forward selected employee mailboxes into EC | **REJECTED — two defects.** *Technical:* EC-1 routes on the **recipient address**; a plain forward that preserves the original `To:` (a personal address) matches no mailbox and **quarantines everything**. Registering an employee's personal address as a tenant mailbox would fix routing by making that person's entire inbox a tenant data source. *Confidentiality:* auto-forwarding an individual mailbox captures HR, personal and private mail into shared operational storage — a C3 exposure with no consent model. |
| C. Temporary platform-hosted address | **REJECTED.** A non-`effitrans.com` address is not credible to customers, must be re-migrated later (churning customer address books twice), and creates a platform-owned identity that sits awkwardly against tenant ownership. |

**Decision: create ONE new shared address — `operations@effitrans.com` — as the first and
only EC mailbox at go-live.**

Why `operations@` and not `devis@`: Operations owns the queue (DEC-EC-D3), and a single
operations address serves **both** primary outcomes — new inquiries *and* correspondence
about existing dossiers. `devis@` presupposes a quotation flow that **does not exist
until EC-3**; publishing it first creates a queue whose main outcome cannot be completed.
`devis@` is a fast-follow the day EC-3 lands.

**Multi-tenant rule preserved and already enforced.** No address or domain appears in any
migration or library file — EC-1 ships `ec_mailbox` rows as tenant configuration, and its
test suite pins that no domain is hardcoded. `operations@effitrans.com` is a **row**, not
a constant.

### DEC-EC-D3 — Triage ownership · **FROZEN: Operations owns the inbound commercial queue**

| Authority | Holder | Basis |
|---|---|---|
| **Primary triage** (read, assign to self, review, resolve) | **ACCOUNT_MANAGER** | owns the client relationship; already holds `communication:read/send`, `client:create/read/update`, `file:read:all`, and is one of only two roles with `file:create` |
| **Supervisory** (oversight of the queue) | **OPS_SUPERVISOR** | management's stated approver; already holds `communication:manage`, `file:assign`, `process:owner:assign` |
| **Assignment** (assign an item to a triager) | ACCOUNT_MANAGER (self-assign) · OPS_SUPERVISOR (assign anyone) | mirrors `file:assign` distribution |
| **Reassignment** (move an item off another person) | **OPS_SUPERVISOR only** | supervisory act |
| **Escalation** | ACCOUNT_MANAGER → OPS_SUPERVISOR → CEO (out of platform) | CEO gains **no** inbound permission — escalation is a conversation, not a grant |
| **Discard with mandatory reason** | ACCOUNT_MANAGER + OPS_SUPERVISOR | reason is mandatory (EC-1's `cancellation`-style discipline); the message itself remains immutable evidence |
| **Quarantine (capture-time)** | **nobody — machine-only** | per FINDING-1; unroutable mail belongs to no tenant |
| **Attach to existing dossier** | ACCOUNT_MANAGER + OPS_SUPERVISOR | both hold `file:read:all`; attaching requires seeing the dossier |
| **Initiate quotation request** | ACCOUNT_MANAGER + OPS_SUPERVISOR | **parked in EC-2** — the outcome is recorded as *intent*; the entity is EC-3 |

**COORDINATOR deliberately excluded** from the initial set: it is the operations control
tower for dossiers in flight, holds no `communication:read`, and the inbound *commercial*
queue is not its function. Revisit when departmental mailboxes (transit@, finance@) exist.

### RATIFY-EC1-1 — `communication:inbound:read` holders · **RECOMMENDED: 2 roles**

**ACCOUNT_MANAGER · OPS_SUPERVISOR.** Nothing else.

Explicitly excluded, with reasons:

| Role | Holds `communication:read` today? | Excluded because |
|---|---|---|
| **SYSTEM_ADMIN** | yes | **forbidden by standing direction** — administers accounts, not correspondence (the DEC-B25 doctrine applied to a second dataset; this is the very reason EC-1 minted a separate gate) |
| **CEO** | yes | oversight is not an operational need to read every customer email; escalation reaches the CEO as a conversation |
| **FINANCE_OFFICER** | yes | no `finance@` mailbox exists at go-live; grant when one does |
| **CLIENT_USER** | **yes (!)** | a **portal** role holding `communication:read` — see FINDING-3 below |
| COORDINATOR, DOCUMENTATION_OFFICER, ADMINISTRATIVE_OFFICER, all Transit/Finance/HR roles | no | no inbound need at go-live |

> **FINDING-3 (incidental, worth management's attention):** the role template grants
> `communication:read` and `communication:send` to **CLIENT_USER** and
> `COLLECTIONS_OFFICER`, beyond the five roles the migration grants. Portal visibility is
> RLS-scoped so this is not an active leak, but it is a wider distribution than the
> migration implies — and it is a second, independent vindication of EC-1's decision not
> to reuse `communication:read` for inbound. **No action in EC-2**; flagged for a
> permission-hygiene pass.

### RATIFY-EC2-1 — `communication:triage` holders · **RECOMMENDED: 2 roles, same set**

**ACCOUNT_MANAGER · OPS_SUPERVISOR.**

The mission's five separable acts, mapped to the **two permissions EC-1 already
catalogued** — no third permission is proposed:

| Act | Gate | Separation mechanism |
|---|---|---|
| Read correspondence | `communication:inbound:read` | permission |
| Assign to self / take an item | `communication:triage` | permission |
| **Reassign another person's item** | `communication:triage` **+ role check on OPS_SUPERVISOR** | **role, not permission** |
| Resolve / discard with reason | `communication:triage` | permission (reason mandatory) |
| Attach to existing dossier | `communication:triage` **+ `file:read:all`** | **permission composition** — you may not attach to a dossier you cannot see |
| Create quotation-request handoff | `communication:triage` today; **+ `quotation:create` when EC-3 lands** | permission composition, deferred |

**Why no third permission.** The platform's standing discipline is fewest codes, and
every act above is already separable by composing existing gates. The one act needing a
supervisory tier — reassignment — could have reused `communication:manage`, and
**deliberately does not**: that permission is held by SYSTEM_ADMIN, which would hand a
platform administrator authority over tenant correspondence through the back door. Role
membership carries that distinction instead.

---

## 2. Role and permission recommendation (summary)

| Permission | Grant to | Do NOT grant to |
|---|---|---|
| `communication:inbound:read` | ACCOUNT_MANAGER, OPS_SUPERVISOR | SYSTEM_ADMIN, CEO, CLIENT_USER, everyone else |
| `communication:triage` | ACCOUNT_MANAGER, OPS_SUPERVISOR | everyone else |

**No new role is proposed** — the mission's condition ("unless no existing Operations
role can safely hold the authority") is not met: ACCOUNT_MANAGER and OPS_SUPERVISOR fit
the stated business model exactly. **Both grants remain UNISSUED until management signs
this freeze.**

---

## 3. Initial mailbox strategy

| Stage | Address | Purpose value | When |
|---|---|---|---|
| **Go-live** | `operations@effitrans.com` | `OPERATIONS` | EC-2 activation |
| Fast-follow | `devis@effitrans.com` | `QUOTATION` | when EC-3 ships |
| Later, on demand | `transit@` / `finance@` | `TRANSIT` / `FINANCE` | when those departments own a queue |
| Not planned | `info@` | — | a general address invites unclassifiable volume; add only if a business need appears |

Each is one `ec_mailbox` row: tenant, address (globally unique), label, purpose, active.
The `purpose` value is **configuration that starts no workflow** — EC-1 shipped it that
way and EC-2 uses it only to *suggest* an outcome.

---

## 4. Personal-mailbox transition plan

**Scope discipline first: EC is not an email host.** It receives and manages *operational
correspondence*. Personal mailboxes continue to exist, are not migrated, and are not
replaced.

| Concern | Plan |
|---|---|
| **Forwarding** | **No server-side auto-forward of personal mailboxes** (DEC-EC-D1 rejection B). During transition, employees **manually forward** genuinely operational threads to `operations@`. |
| **Manual-forward caveat** | A forwarded message arrives with the **employee** as sender, not the customer — sender-matching and thread continuity degrade. Triagers must expect this; it is a transition artifact that disappears as customers adopt the new address. Recorded so nobody later reads it as a defect. |
| **Duplicate delivery** | A customer who Cc's both a person and `operations@` produces **one** capture — EC-1 is idempotent on `(provider, provider_event_id)`. The employee's own copy stays in their mailbox; no conflict. |
| **Reply-from identity** | **EC-2 has no reply capability** (replying is EC-4). Replies continue from personal mailboxes throughout EC-2. Stated explicitly so no one expects a reply button. |
| **Employee departure** | The problem this solves: today a departure takes the thread history with it. From go-live, anything routed through `operations@` survives departure as tenant evidence. Pre-existing personal threads do **not** — see below. |
| **Historical threads** | **No backfill. EC-1 captures forward-only.** Importing years of personal mailboxes would ingest private mail wholesale and is explicitly out of scope. Historical context stays in Outlook; the dossier timeline begins at go-live. |
| **Shared operational visibility** | The point of the phase: two roles see one queue instead of correspondence living in one person's inbox. |
| **Cutover** | Deliberately **soft, not a cutover**: publish the address, add it to signatures and the website, let volume migrate. No date on which personal addresses stop working. |
| **Customer announcement** | Effitrans-drafted, sent from existing channels: *"for quotation requests and shipment correspondence, please write to operations@effitrans.com."* Not a platform feature. |
| **Rollback** | Unset `EFFITRANS_EC_INBOUND_ENABLED` or the tenant rollout row → capture stops immediately; the endpoint 503s; already-captured evidence remains readable. Nothing to undo, nothing lost. |

---

## 5. Triage ownership matrix

| Act | ACCOUNT_MANAGER | OPS_SUPERVISOR | CEO | SYSTEM_ADMIN | Portal / others |
|---|:--:|:--:|:--:|:--:|:--:|
| View inbound queue | ✅ | ✅ | ❌ | ❌ | ❌ |
| Self-assign | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign to another | ❌ | ✅ | ❌ | ❌ | ❌ |
| Reassign another's item | ❌ | ✅ | ❌ | ❌ | ❌ |
| Mark IN_REVIEW | ✅ | ✅ | ❌ | ❌ | ❌ |
| Attach to dossier | ✅ | ✅ | ❌ | ❌ | ❌ |
| Record quotation-request intent | ✅ | ✅ | ❌ | ❌ | ❌ |
| Resolve as correspondence | ✅ | ✅ | ❌ | ❌ | ❌ |
| Discard (reason mandatory) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Quarantine after capture | ❌ | ❌ | ❌ | ❌ | ❌ (machine-only, at capture) |

---

## 6. Allowed outcome matrix

EC-1's state machine is **unchanged**: `NEW → ASSIGNED / IN_REVIEW / RESOLVED`,
`ASSIGNED ⇄ IN_REVIEW → RESOLVED`, `RESOLVED` terminal, `QUARANTINED` terminal and
capture-time only. EC-2 adds **outcome columns** additively (EC-1 deliberately omitted
them) — the terminal status stays `RESOLVED`; the *outcome* says what was decided.

| # | Outcome | Terminal status | Required | Creates a business object? |
|--:|---|---|---|---|
| 1 | **ATTACHED_TO_DOSSIER** | RESOLVED | dossier reference; `file:read:all` | **No** — links correspondence to an existing dossier |
| 2 | **QUOTATION_REQUEST_INTENT** | RESOLVED | — | **No** — records intent only; the entity is EC-3 |
| 3 | **CORRESPONDENCE** | RESOLVED | optional client reference | No |
| 4 | **DISCARDED** | RESOLVED | **mandatory reason** | No |
| — | ~~Quarantine~~ | — | see FINDING-1 / Q-EC2-1 | — |

**No outcome creates a dossier, client, quotation, document or invoice.** Outcome 1 links
to a dossier that already exists; promoting an attachment into a governed
`public.document` remains a **separate, explicit human act** under WES-4 (ADR-EC-5).

---

## 7. Digital-LOS event list for EC-2

The first phase designed under the standing question — *what operational event does this
module emit?* Tracking is never updated; it consumes.

| Event | Subject | Why it matters to the timeline |
|---|---|---|
| `ec.message.captured` | mailbox (tenant) | **already emitted by EC-1** conceptually via audit; EC-2 should ensure a business-event form exists for the communication dimension |
| `ec.triage.assigned` | triage item | queue accountability; feeds workload views |
| `ec.correspondence.attached` | **the DOSSIER** | **the key event.** A customer interaction becomes part of that shipment's history — the communication dimension of the Digital LOS. The dossier timeline shows "correspondence received" **without Tracking ever querying EC tables.** |
| `ec.triage.quotation_intent` | triage item (dossier-less) | the seam EC-3 consumes; becomes the provenance of a future quotation |
| `ec.triage.resolved` | triage item | includes outcome + actor; closes the loop |
| `ec.triage.discarded` | triage item | outcome + mandatory reason; auditable refusal |

**Rules honoured:** no duplicated state · no synchronization job · Tracking owns the
projection, EC owns the decision · C3 discipline unchanged — event payloads carry
identifiers, outcomes and classifications, **never subjects, bodies, addresses or
filenames** (EC-1's audit-redaction tests already pin this shape).

---

## 8. Open decisions

| Ref | Question | Blocks |
|---|---|---|
| **Q-EC2-1** | FINDING-1: accept **4 outcomes** (recommended) or introduce a post-triage `WITHHELD` state? | EC-2 outcome model — **must answer before implementation** |
| **Q-EC2-2** | Confirm `operations@effitrans.com` as the single go-live address, and who creates it in Google/Microsoft. | EC-2 activation |
| **Q-EC2-3** | Sign RATIFY-EC1-1 + RATIFY-EC2-1 (grant both permissions to ACCOUNT_MANAGER + OPS_SUPERVISOR). | EC-2 activation — **not** implementation |
| **Q-EC2-4** | **DEC-EC-D2 remains open**: which inbound provider, and is a DPA signed? EC-1's RESEND adapter is deliberately `not_configured`. | live traffic |
| **Q-EC2-5** | **EDGE-EC1-1**: edge rate limiting before the endpoint is publicly reachable. | live traffic |
| **Q-EC2-6** | FINDING-2: split `quotation:create` from `quotation:approve` (maker ≠ checker). | **EC-3**, not EC-2 |
| **Q-EC2-7** | FINDING-3: permission-hygiene pass on `communication:read`/`send` reaching CLIENT_USER + COLLECTIONS_OFFICER. | nothing — hygiene |
| Q-COMM-1/2 (LOG-0) | postal mail registration · legal response deadlines | EC-2 **scope** — if yes, they belong in this phase, not a later one |

---

## 10. Go / No-Go

**Implementation: GO — conditional on Q-EC2-1 only.**

EC-2 can be built the moment the outcome model is confirmed (4 outcomes vs 5). Everything
else it needs already exists: the immutable capture, the triage item with guarded
transitions, the mailbox purpose vocabulary, both permissions catalogued, and the audit
and event rails.

**Activation: NO-GO** until Q-EC2-2 (address), Q-EC2-3 (grants), Q-EC2-4 (provider + DPA)
and Q-EC2-5 (rate limiting) close. This is the intended shape — EC-2 is built dark and
lit later, exactly as EC-1 was.

**Sequencing note:** Q-EC2-3's grants are needed for *activation*, not implementation —
but a triage workspace nobody may open cannot be user-tested. Recommend closing Q-EC2-3
before EC-2 reaches UAT, not before it reaches `main`.
