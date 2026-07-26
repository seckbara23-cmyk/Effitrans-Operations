# Phase 11.0D — Autorisation de Dépenses : circuit de visas (approval chain)

**Date:** 2026-07-26 · **Depends on:** 11.0A (audit), 11.0B (ledger, attempts, state machines, permissions), 11.0C (document, versions, PDF, attachments)
**Scope:** from a SUBMITTED authorization to APPROVED or REJECTED, via the seven-visa chain.
**Out of scope:** the Bon de Dépenses chain, payment execution, the cashier queue, QR, delegation, watermarking.

---

## 1. Architectural conflict found in the mission brief — and how it was resolved

The 11.0D brief specified an **eight-step** chain: Agent → Réception → Opération → Accountant → Treasurer → DAF → DGA → DG. Audit showed this is a **merge of the two ratified chains**, not either of them:

| Chain | Source of truth | Steps |
|---|---|---|
| Autorisation (DEC-C08) | `AUTHORIZATION_VISA_STEPS` | Demandeur → Chef de Transit → Coordonnateur → **Opération** → Trésorière → DAF → DG |
| Bon de Dépenses (DEC-C09) | `VOUCHER_VISA_STEPS` | Agent → **Réception** → Comptable → DAF → DGA → DG |
| Mission brief | — | four steps exclusive to the *Bon*, two exclusive to the *Autorisation*, and three ratified Autorisation steps dropped |

Three consequences made this blocking rather than cosmetic:

1. **The paper form has seven visa areas** (11.0A §11), and 11.0C already prints them in the ratified order. An eight-step chain containing Agent/Réception/Comptable/DGA cannot be signed on the real document — and not redesigning the paper form is this workstream's founding constraint.
2. **The brief's chain could never complete.** Its unbound signers (BLK-FIN-1 Réception, BLK-FIN-2 Opération) sit at positions **2 and 3**, so every document would halt at stage 2 permanently and APPROVED would be unreachable. The ratified chain's single blocker is at ordinal 4, so stages 1–3 run end-to-end and it halts honestly at Opération — which is what the brief actually asked for.
3. **`READY_FOR_PAYMENT` is not an Authorization status.** It exists only in `VOUCHER_STATUSES`, reachable solely `FULLY_SIGNED → READY_FOR_PAYMENT` (DEC-C21, "approval is never payment"). An Authorization terminates at APPROVED / REJECTED / CANCELLED / SUPERSEDED.

**Ratified 2026-07-26 (DEC-C30):** implement the ratified seven-step Autorisation chain; terminal states APPROVED / REJECTED. Recorded rather than silently reconciled.

---

## 2. What shipped

### The chain

```
1 Demandeur       -> the document's REQUESTER (identity, not a role)
2 Chef de Transit -> CHIEF_OF_TRANSIT
3 Coordonnateur   -> COORDINATOR
4 Opération       -> UNBOUND (BLK-FIN-2)   <-- halts here, honestly
5 Trésorière      -> TREASURER
6 DAF             -> DAF
7 DG              -> CEO
```

Every eligibility decision is made by **one pure, total function** — `evaluateSign` in `lib/finance/expense/visa.ts`. The server action executes its verdict, the timeline renders it, and the approval queue filters on it, so no surface can disagree with another about where a document is or who may act. This is the process engine's `state.ts` discipline and `lib/finance/requests.ts`, applied to visas.

The captions printed in the PDF's seven visa boxes now come from the **same vocabulary** the chain evaluates (11.0C had its own copy) — the form and the workflow cannot drift apart.

### Rules enforced

| Rule | Mechanism |
|---|---|
| Sequential only, no skipping | `nextRequiredStep` — the lowest ordinal without an APPROVED visa |
| Cannot sign twice | one signer holds at most one visa per version; **plus** a UNIQUE index on `(attempt_id, step_ordinal)` |
| Cannot sign an earlier step | an `intendedStepCode` that isn't the next step is refused |
| Cannot approve a superseded version | signing targets `current_version_id`; a stale attempt is refused |
| Cannot approve without permission | `finance:expense:sign` + the mapped role (or requester identity) |
| Cannot approve another tenant's document | every query tenant-scoped; DB tenant triggers; RLS |
| Unbound signer | halts the chain — never auto-signed, never skipped, never grantable |

### Rejection, return and versions

A refusal **appends** a visa and **closes** the attempt with the matching outcome. Nothing is deleted or rewritten: prior attempts, prior versions and prior visas remain exactly as recorded. A material edit after a return creates a new immutable version and supersedes the open attempt (11.0B's `supersedeAndReopenAttempt`, unchanged), so approval restarts on the new version with full provenance.

Only APPROVED visas advance the chain — a rejection can never leave a half-advanced chain behind.

### The concurrency backstop (refinement worth noting)

The approved plan was a unique index on `(authorization_id, version_id, step_ordinal)`. Implementation showed that would be **wrong**: after a RETURNED round, a fresh attempt on the *same* version must be able to re-collect step 1, and that index would reject it. The shipped index is **`(attempt_id, step_ordinal)`** — an attempt is exactly one approval round on one version, so it delivers the same "no double-signed step" guarantee, permits the correction path, and covers the Bon's chain in the next phase for free.

### Permissions — no new permission introduced

`finance:expense:sign` existed in the catalog since 11.0B, granted to nobody. 11.0D grants it to exactly the six seats that sign this chain, plus `finance:expense:read` to the three that could not otherwise see what they sign.

**Deliberately not granted:** CASHIER (execution-only, DEC-C21) · SYSTEM_ADMIN (the finance convention — an administrator must never be able to manufacture an approval) · ACCOUNTANT and DGA (they sign the *Bon's* chain; their capability stays withheld until it is wired) · anything for VISA_OPERATIONS.

> **Governance note:** CEO held only `finance:read`. The DG visa is the role's first write-class finance capability — the change 11.0A §4 flagged as one to surface deliberately.

---

## 3. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3359 passed / 160 files** (+62 new) |
| Production build | compiled; approval-queue route emitted |
| CI build | see commit status |
| CI RLS | `supabase/tests/rls_expense_approval_test.sql`, wired into CI |

The chain evaluator is pure, so the workflow rules are tested as **behaviour** — call it, assert the verdict — rather than as source text. The RLS suite proves what must hold in the database rather than the action: append-only ledger, the unique-step index, that a *different* attempt may legitimately re-collect a step, tenant isolation, and portal invisibility.

---

## 4. Remaining roadmap

* **BLK-FIN-2 (Opération)** — still unnamed. Documents halt there; the UI says so. One line in the signer map when the business decides.
* **BLK-FIN-1 (Réception)** — unchanged, blocks the *Bon's* chain.
* **11.0E** — Bon de Dépenses: its six-visa chain (reusing this evaluator), then `READY_FOR_PAYMENT` and cashier execution.
* **11.0F/G** — treasury, then QR/verification/delegation/retention after legal review.
* Still outstanding from 11.0C: the **master template scan** (DEC-C26) — the PDF remains structurally faithful, not pixel-verified.

Decisions recorded in `docs/decision-register.md` as **DEC-C30 / DEC-C31**.
