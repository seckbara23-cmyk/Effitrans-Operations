# EC-3A — Commercial / Quotation: Governance Audit & Architecture Freeze

**Date:** 2026-08-05 · **Documentation only.** No code, SQL, migration, permission or UI.
Basis: EC-0 `4e85756` · EC-1 `aa50fd9` · EC-2 `6c12549` (ledger 81/81) · LOG-0 `a3fb111`
· Digital LOS `9f94237`. Every statement tagged **[O]** observed · **[R]** ratified ·
**[I]** inferred · **[MD]** management decision required.

---

## 0. Three findings that change the brief

### FINDING-1 — `quotation:approve` does **not** mean internal approval. The maker-checker gap is bigger than reported.

The permission catalogue (migration `20260713000001` §359-361) reads, verbatim **[O]**:

| Code | Description as shipped |
|---|---|
| `quotation:create` | *Prepare a quotation* |
| `quotation:send` | *Send a quotation to the client* |
| `quotation:approve` | ***Record the client's quotation approval*** |

Corroborated by the process registry **[R]**: step 1's `requiredEvidence` is
`["client_approval_actor", "client_approval_date"]` and its completion rule is
`quotation_approved_or_client_under_contract`.

So `quotation:approve` is **recording customer acceptance**, not internal validation.

**Therefore the ratified four-act model has no permission for act 2 at all:**

| Act | Ratified owner [R] | Permission today |
|---|---|---|
| 1. Prepare | Operations | `quotation:create` ✅ |
| 2. **Approve internally** | **Operations Manager / Supervisor** | ❌ **none exists** |
| 3. Send to customer | Operations | `quotation:send` ✅ |
| 4. Record customer acceptance | Operations | `quotation:approve` ✅ (mis-named) |

The problem is not only that approve is over-granted — it is that **internal validation is
unrepresented**, and the name `quotation:approve` actively invites the wrong reading. Any
fix that merely narrows the existing grants would leave act 2 still unimplementable.

### FINDING-2 — the over-grant is structural, not a judgement call

One grant block issues **all three codes to all three roles** in a single statement,
in both the migration and `seed.sql` **[O]**:

```sql
join public.permission p on p.code in ('quotation:create','quotation:send','quotation:approve')
where ... r.code in ('SYSTEM_ADMIN','OPS_SUPERVISOR','QUOTATION_MANAGER')
```

Nobody decided the maker may also check; the block never distinguished the verbs. It is
labelled *"catalog + grant only; the module is Phase 5.0D"* **[O]** — a placeholder that
outlived its phase. **SYSTEM_ADMIN holds all three**, which the standing direction
forbids for consequential authority.

### FINDING-3 — two registry "gaps" are stale; one asset is unused

The process registry lists as missing **[R, now outdated]**: *"no QUOTATION or
QUOTATION_APPROVAL document type"*. **Both exist** — migration `20260714000001` §54-55,
category `commercial`, sort 10 and 11 **[O]**. EC-3 inherits the document vocabulary it
needs; only the *entity* is missing.

Also present and unused by any quotation flow: **`billing_charge`** (per-dossier charge
lines: description, quantity, unit_amount, tax_rate, currency XOF) and **`invoice_line`**
**[O]**. LOG-0 independently found the tenant's own DEVIS and FACTURE sharing one line
shape **[O]**. The line model EC-3 needs already exists twice.

---

## 1. Existing quotation architecture — audit

| Layer | State | Evidence |
|---|---|---|
| Entity (`quotation`, `quotation_line`, `quotation_request`) | **absent** | 0 tables; EC-2's RLS suite asserts `quotation_tables_created = 0` [O] |
| Permissions | 3 catalogued, over-granted, act 2 missing | FINDING-1/2 |
| Document types | `QUOTATION`, `QUOTATION_APPROVAL` **exist** | [O] |
| Role | `QUOTATION_MANAGER` exists — **5 permissions total**, holds no `file:read`, no `client:read`, no `communication:read` | [O] — a stub seat |
| Process step | step 1 `cotation`, verdict **`missing`**, precedes `operations_intake` | [R] |
| SLA | `quotation_response` key exists, **state `unconfigured`** (no thresholds invented) | [O] |
| Lifecycle | `lib/files/lifecycle.ts` step `quote_approved` is **cosmetic** (derived from `status !== 'DRAFT'`) | [R] |
| Contract flag | `client.has_contract` **absent**; 9.0C intake already skips cotation by default | [O]/[R] |
| Inbound seam | EC-2 `HANDOFF_TO_QUOTATION` outcome + `CORRESPONDENCE_QUOTATION_HANDOFF` event, **intent only, no quotation column** | [R] |
| Money precedent | `invoice_line`/`billing_charge` use `numeric`; aging/HR/EC use **integer minor units** | [O] — see MD-Q9 |

## 2. Recommended maker-checker authority model

Four acts, four gates, **no actor may perform two consecutive acts on the same quotation**.

| Act | Proposed gate | Holder [MD] | Note |
|---|---|---|---|
| 1. Prepare / revise | `quotation:create` *(exists)* | ACCOUNT_MANAGER (+ QUOTATION_MANAGER if the seat is staffed) | **remove from OPS_SUPERVISOR and SYSTEM_ADMIN** |
| 2. **Validate internally** | **`quotation:validate` — NEW, the only new code proposed** | OPS_SUPERVISOR | catalogued then granted, per the `hr:leave:approve` / `hr:performance:finalize` precedent |
| 3. Send to customer | `quotation:send` *(exists)* | ACCOUNT_MANAGER + OPS_SUPERVISOR | sending is not deciding |
| 4. Record customer acceptance | `quotation:approve` *(exists, keep the code, correct the description)* | ACCOUNT_MANAGER + OPS_SUPERVISOR | recording a customer's decision ≠ making one |

**Structural separation, not merely role separation:** `validated_by <> prepared_by`
enforced as a CHECK, on the `contract_verifier_differs` / `evaluation_finalizer_differs`
precedent [R]. Role separation alone fails when one person holds both seats.

**SYSTEM_ADMIN holds none of the four** — the DEC-B25 doctrine applied to commercial
authority.

**Renaming `quotation:approve` is rejected**: permission codes are referenced by the
process registry and role templates, and a rename is a migration with blast radius for a
cosmetic gain. Correct its *description* instead, and let `quotation:validate` carry the
unambiguous name.

## 3. Quotation bounded context

**Commercial owns:** quotation request · quotation and its lines · revisions · internal
validation · customer acceptance evidence · conversion-to-dossier **as an act it
initiates but does not perform**.

**Commercial does NOT own:** correspondence (EC) · the dossier and its workflow
(Operations) · invoices, payments, tax posting (Finance) · timeline projection
(Tracking) · customer-facing surfaces (Portal). Each interaction is an **event or a
call across a boundary**, never a shared table.

## 4. Lifecycle [MD-Q1 to confirm]

```
DRAFT ──► PENDING_VALIDATION ──► VALIDATED ──► SENT ──┬─► ACCEPTED ──► CONVERTED
  ▲              │                    │               ├─► DECLINED
  └──────────────┴────────────────────┘               └─► SUPERSEDED
         (rejected back to DRAFT)                          WITHDRAWN (any pre-terminal)
```

**No expiry state, deliberately** — ratified: *no automatic expiration; a quotation
remains valid until business circumstances require a new one* [R]. A quotation therefore
leaves SENT only by an **act** (accepted, declined, withdrawn, superseded), never by the
passage of time. **No scheduler is introduced**, consistent with the standing absence of
one [R].

`SENT → ACCEPTED` and `→ CONVERTED` are distinct: acceptance is the customer's fact;
conversion is Operations opening a dossier. They may be seconds apart and must remain two
events [I].

## 5. Revision rules

**Immutable once sent.** A sent quotation is customer-facing evidence; correcting it
means **a new version**, never an edit — the `hr_template_version` / HR-6 objective
amendment idiom [R]. `version` + `supersedes_quotation_id`; the superseded row survives
as `SUPERSEDED`. Only one non-terminal version per request at a time (partial unique
index, the platform's standard invariant [R]). Pre-send DRAFT edits are free.

## 6. Approval workflow (internal)

`DRAFT → PENDING_VALIDATION` (preparer submits) → validator, **necessarily a different
person**, either `VALIDATED` or back to `DRAFT` with a **structured reason code**
(free text stays in the domain row, per WES-9C [R]). Whether validation is required for
*every* quotation or only above a threshold is **MD-Q3** — thresholds are pricing-adjacent
and must not be invented.

## 7. Customer acceptance workflow

Three ratified forms [R]: signed quotation · email acceptance · explicit written
agreement. Modelled as **evidence, not as a channel**: `acceptance_kind`
(SIGNED_QUOTATION | EMAIL | WRITTEN_AGREEMENT) + `accepted_on` + `recorded_by` + an
optional `evidence_document_id` (→ `QUOTATION_APPROVAL`, which already exists) and/or an
optional `ec_inbound_message_id` when the acceptance arrived by email **[I]** — the EC-2
seam, referenced, never copied.

**A human records acceptance. No inbound message is ever auto-interpreted as acceptance**
— the ADR-EC-1 doctrine [R]. **MD-Q4:** is documentary evidence mandatory for each kind?

## 8. Quotation → dossier conversion contract

**Preconditions:** status `ACCEPTED`; acceptance evidence recorded; no dossier already
converted from this quotation (one-to-one, unique index).

**Transactionally, in one RPC:** create `operational_file` via the existing Operations
path → stamp provenance on the dossier → set `CONVERTED` → emit both events. **Commercial
does not write dossier internals** — it calls Operations' creation path and stops. The
9.0C intake validation and its blocking/warning split remain the authority on whether a
dossier may open [R].

**Field transfer [I, confirm MD-Q5]:** client · origin/destination · mode · goods
description · packages/weight/volume · declared value + currency · Incoterm ·
references — the 9.0C intake spine, so conversion is a *projection*, not re-keying [O
per LOG-0]. **Quotation lines seed billing** (`billing_charge` already exists per dossier
[O]); whether the final invoice must equal the accepted quotation is **MD-Q6**.

**Contract customers:** ratified as *"handled similarly most of the time, with occasional
exceptions"* [R] — i.e. **no universal bypass**. Recommendation: `client.has_contract`
as a designation that makes cotation *skippable*, never *skipped*, with the skip recorded
as an act with an actor. **MD-Q7.**

## 9. Digital LOS events emitted by Commercial

Domain **`commercial`** (new; widen the CHECK by the WES-5 drop-and-recreate precedent
[R]). Metadata: identifiers and codes only — **no amounts, no prose** (WES-9C's deny-list
already blocks `amount`, `price`, `currency`, `reason` [O]).

| Event | Subject | Dossier | clientSafe |
|---|---|---|---|
| `QUOTATION_REQUEST_OPENED` | request | — | false |
| `QUOTATION_DRAFTED` | quotation | — | false |
| `QUOTATION_SUBMITTED_FOR_VALIDATION` | quotation | — | false |
| `QUOTATION_VALIDATED` / `_REJECTED` | quotation | — | false |
| `QUOTATION_SENT` | quotation | — | **true** *(the customer knows: they received it)* |
| `QUOTATION_ACCEPTED` / `_DECLINED` | quotation | — | true / false |
| `QUOTATION_SUPERSEDED` / `_WITHDRAWN` | quotation | — | false |
| **`QUOTATION_CONVERTED_TO_DOSSIER`** | **the DOSSIER** | **set** | true |

The last one is the Digital-LOS keystone: it makes the dossier's timeline begin with its
commercial provenance, **and Tracking learns it from the event — never by querying a
Commercial table** [R].

**Causation, not duplication:** `CORRESPONDENCE_QUOTATION_HANDOFF` (EC-2) → the request's
`causation_id`; the ledger already carries the column [O].

## 10. Boundary verification — no overlap

| Context | Boundary | Verified |
|---|---|---|
| **EC** | EC captures and triages; Commercial reads a triage reference. Sending a quotation goes through `lib/comms` `queueAndSend` — **no second comms engine** [R] | ✅ |
| **Operations** | Commercial calls the dossier-creation path; never writes `operational_file` internals, never touches `process_instance` | ✅ |
| **Finance** | Commercial produces a *commercial offer*; Finance owns invoices, payments, tax. Quotation lines **seed** billing; they are not invoice lines | ✅ |
| **Tracking** | Commercial emits; Tracking projects. No table read across | ✅ |
| **Portal** | Portal may *display* a quotation and *record* acceptance later (**EC-3D, MD-Q8**); it owns neither | ✅ |
| **Document** | `QUOTATION` / `QUOTATION_APPROVAL` are WES-4 governed documents; Commercial references, never re-implements | ✅ |

## 11. ADRs

**ADR-Q1 — `quotation:validate` is created; `quotation:approve` keeps its code and its
meaning.** Act 2 has no representation today (FINDING-1). One new code; the existing
three are re-granted correctly and `quotation:approve`'s description corrected. Renaming
is rejected as a high-blast-radius change for a cosmetic gain.

**ADR-Q2 — separation is structural.** `validated_by <> prepared_by` as a CHECK, plus
role separation. Precedent: `contract_verifier_differs` (HR-3),
`evaluation_finalizer_differs_from_manager` (HR-6) [R].

**ADR-Q3 — a sent quotation is immutable; revision is versioning.** New row, `version`,
`supersedes_quotation_id`, old row `SUPERSEDED`. Precedent: `hr_template_version`,
HR-6 objectives [R].

**ADR-Q4 — no expiry, no scheduler.** Validity ends by act, never by time [R]. Nothing
sweeps quotations; "stale" is a live-computed *display* concern if wanted at all.

**ADR-Q5 — acceptance is evidence, not a channel.** Three ratified kinds, optional
document and/or inbound-message reference. **Never auto-derived from an email** [R].

**ADR-Q6 — conversion is a call, not a write.** Commercial invokes the Operations
creation path in one transaction and emits `QUOTATION_CONVERTED_TO_DOSSIER` with the
dossier as subject. One-to-one, unique-indexed.

**ADR-Q7 — no pricing or tax logic in EC-3.** Lines carry description, quantity, unit
amount, an optional tax-rate *field*, currency. **No rate is defaulted, no total is
mandated, no Senegal rule is encoded.** LOG-0 observed the tenant's own DEVIS showing
TVA 18% + CA 5% [O] — that is an *observation of one tenant's document*, not a platform
rule, and in a multi-tenant platform it must be configuration [MD-Q9/Q10].

**ADR-Q8 — reuse the line shape, decide the money type once.** `billing_charge` and
`invoice_line` use `numeric`; aging, HR and EC use integer minor units. EC-3B must choose
deliberately (**MD-Q9**) — the recommendation is **integer minor units** for new tables,
converting at the Finance boundary, because it is the newer ratified discipline and
quotation→invoice arithmetic is money arithmetic.

**ADR-Q9 — `QUOTATION_MANAGER` is a stub; do not build on it silently.** It holds 5
permissions and cannot read a client, a dossier or a communication [O]. Either staff and
equip it, or assign act 1 to ACCOUNT_MANAGER **[MD-Q2]** — do not grant it quotation
authority while it cannot see the data a quotation needs.

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Pricing/tax invented under delivery pressure** | ADR-Q7; MD-Q9/Q10 block EC-3C, not EC-3B |
| R2 | Fixing grants breaks a live flow | none exists — the module was never built; the grant is a dormant placeholder [O] |
| R3 | Commercial writes dossier internals | ADR-Q6; pin by test that Commercial imports no dossier-internal writer |
| R4 | Quotation totals drift from invoice totals | MD-Q6 decides constraint vs copy; events carry no amounts either way |
| R5 | `QUOTATION_MANAGER` staffed with a blind seat | ADR-Q9 / MD-Q2 |
| R6 | Single-seat Operations cannot satisfy maker-checker | the HR-6 lesson, restated: **MD-Q3** must confront it before activation, not at first use |
| R7 | Auto-accepting an email | ADR-Q5; EC's capture-then-human-triage doctrine [R] |
| R8 | A second comms engine for sending | reuse `queueAndSend` [R] |

## 13. Management questions

| Ref | Question | Blocks |
|---|---|---|
| **MD-Q1** | Confirm the lifecycle states (§4), including that there is **no expiry state**. | EC-3B |
| **MD-Q2** | Is `QUOTATION_MANAGER` a staffed seat, or does ACCOUNT_MANAGER prepare? | grants |
| **MD-Q3** | Is internal validation required for **every** quotation, or above a threshold? And **who validates when only one Operations seat is available**? | EC-3B activation |
| **MD-Q4** | Is documentary evidence mandatory for each acceptance kind? | EC-3C |
| **MD-Q5** | Confirm the field set transferred at conversion (§8). | EC-3D |
| **MD-Q6** | Must the final invoice equal the accepted quotation (with governed amendment), or may they diverge? | EC-3D / Finance |
| **MD-Q7** | `client.has_contract`: one flag, or contract kinds? Skippable-not-skipped confirmed? | EC-3B |
| **MD-Q8** | Should the portal display quotations and accept them online? | EC-3D scope |
| **MD-Q9** | Money representation for new commercial tables: integer minor units (recommended) or `numeric` for Finance symmetry? | EC-3B schema |
| **MD-Q10** | Are tax rates per tenant, per client, or per service? **Nothing is defaulted until answered.** | EC-3C |
| **MD-Q11** | Quotation numbering scheme (per tenant, per year, reset?). | EC-3B |
| **MD-Q12** | Approve the **permission correction plan** (§2), including revoking quotation authority from SYSTEM_ADMIN. | EC-3B |

## 14. Implementation roadmap

**EC-3B — Commercial foundation (dark).** Permission correction (revoke the blanket
grant; add `quotation:validate` catalogued-ungranted; correct the `quotation:approve`
description) · `quotation_request`, `quotation`, `quotation_line` · lifecycle +
versioning + structural maker-checker CHECKs · `commercial` event domain + the type
registry · transactional RPCs · RLS from birth, no portal policy · consumes EC-2's
handoff as causation. **Blocked by MD-Q1, Q2, Q3, Q7, Q9, Q11, Q12.**

**EC-3C — Quotation preparation & customer acceptance.** Workspace: draft, line editing,
submit, validate/reject, send via `lib/comms`, record acceptance with evidence,
supersede/withdraw. `QUOTATION` PDF via the existing hand-rolled renderer [R].
**Blocked by MD-Q4, Q10** (tax display) — and it must render *without* inventing a tax
line if none is configured.

**EC-3D — Conversion to dossier.** The transactional conversion, provenance stamping,
`QUOTATION_CONVERTED_TO_DOSSIER`, and the 9.0C intake handoff. Optionally portal
acceptance. **Blocked by MD-Q5, Q6, Q8.**

**Order rationale:** EC-3B is the only phase whose blockers are purely governance;
EC-3C's depend on tax; EC-3D's on Finance and Operations contracts. **The permission
correction should land with EC-3B and not wait** — the current blanket grant is a live
misconfiguration even though the module is unbuilt.

---

## Freeze statement

The architecture above is frozen pending MD-Q1..Q12. **No implementation has begun**: no
code, no SQL, no migration, no permission, no UI. The existing quotation permissions were
**audited and not modified** — the correction is specified for EC-3B and requires MD-Q12.
