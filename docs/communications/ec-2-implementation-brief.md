# EC-2 — Triage Workspace: Implementation-Ready Brief

**Status: BRIEF ONLY.** No EC-2 code, migration, grant or UI exists. Implementation
begins on explicit approval, after **Q-EC2-1** (outcome model) is answered.
Governance: [ec-2-governance-freeze.md](ec-2-governance-freeze.md).

## What EC-2 is

The human decision layer over EC-1's immutable captures: a queue where an Operations
triager turns each captured message into exactly one recorded outcome — and, when the
outcome is *attach*, adds a customer interaction to a shipment's history.

## What EC-2 is not

Not a mail client · not a reply surface (EC-4) · not a quotation engine (EC-3) · not a
dossier creator (nothing here creates a business object) · not a second inbox.

## Scope

### Schema (one additive migration, 81)

**No new table for the queue** — `ec_triage_item` exists and was deliberately shipped
without outcome columns for exactly this phase. EC-2 adds, additively and nullable:

* `outcome` — CHECK over the ratified set (pending Q-EC2-1)
* `outcome_file_id` — FK to `operational_file`, set only for `ATTACHED_TO_DOSSIER`
* `outcome_client_id` — optional, for `CORRESPONDENCE`
* `discard_reason` — mandatory when `outcome = DISCARDED` (CHECK-enforced)
* `outcome_recorded_by` / `outcome_recorded_at`
* a guard extending `ec_triage_transition_guard`: reaching `RESOLVED` **requires** an
  outcome; an outcome is immutable once set (a correction is a new decision on a new
  message, never a rewrite — the EC-1 doctrine).

**Zero new permissions.** Both were catalogued in migration 80.

### Services & UI

* `lib/ec/triage/` — read model (queue, filters by mailbox/status/assignee) + actions
  (assign, reassign, review, resolve-with-outcome, discard-with-reason). Actions are
  transactional RPCs where a state change and an event must commit together.
* Signed-URL access to raw evidence and attachments — reusing the private-bucket idiom;
  **short TTL, server-minted, never a public URL**.
* Route: extends `/communications` (one canonical route — the HR-5A rule), a triage tab
  gated on `communication:inbound:read`; actions gated on `communication:triage`;
  reassignment additionally on OPS_SUPERVISOR membership.
* Attention items computed live (untriaged count, oldest age) — **no scheduler**, the
  standing pattern.

### Events (the Digital-LOS obligation)

Emit per §7 of the freeze — above all **`ec.correspondence.attached` with the dossier as
subject**, so the shipment timeline gains the communication dimension without Tracking
ever reading an EC table.

### Tests

Outcome exclusivity · discard requires a reason · outcome immutability · attach requires
`file:read:all` and a real dossier · **no business object created by any outcome** (the
EC-1 FK-target test, extended) · SYSTEM_ADMIN and portal see nothing · reassignment
refused without the supervisory role · event emission per outcome · audit payloads carry
no prose · RLS suite appended **last** in CI.

## Sequence

1. Answer **Q-EC2-1**.
2. Migration 81 (additive) + service layer, dark.
3. Workspace + attention items.
4. CI green, **zero skipped**, per-step verified (DEV-HR6-01 control).
5. Operator applies; activation waits on Q-EC2-2..5.

## Explicitly deferred

Reply/compose (EC-4) · quotation entity (EC-3) · AI suggestions (EC-5) · postal-mail
registration and response deadlines (Q-COMM-1/2 — **in scope only if management says
yes**, and better decided now than retrofitted) · promoting attachments into
`public.document` (a separate human act under WES-4).
