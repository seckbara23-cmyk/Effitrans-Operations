# Phase 9.0E — Finance Execution

**Date:** 2026-07-23 · **Status:** code-complete, dark-deployed (no tenant sees anything until the flag chain is on **and** the prerequisite migrations are applied)

Phase 9.0E builds the Finance execution seam between operational approval,
disbursement, customs-duty handling, invoicing and financial clearance —
activating the existing financial and workflow architecture, **not** a parallel
finance engine. The 9.0D boundaries stay intact and are test-pinned: Transit
never creates payments or invoices, Operations retains ownership, customs
clearance remains the once-only `releaseCustoms` milestone.

**The core rule, enforced everywhere: a process decision is not a payment.**
An approval authorizes execution; only the explicit disbursement action records
money out; only a real payment record ever marks anything paid; only the
customs release contract ever clears customs.

---

## 1. Architecture discovered (audit)

- **Money-in is complete**: `invoice` (DRAFT→VALIDATED→ISSUED→PARTIALLY_PAID→PAID→VOID,
  maker-checker columns), `payment` (invoice-bound, verification columns),
  `billing_charge` → `invoice_line` derivation, numbering RPC, balance derived
  never stored (`invoiceBalance`), the 5.0D billing chain
  (`prepareInvoiceDraft`/`approveInvoice`/`rejectInvoice`/`emailValidatedInvoice`)
  behind the billing gate, plus deposit custody and collections closure.
- **Money-out does not exist**: `payment.invoice_id` is NOT NULL (customer
  receipts only); there is no disbursement/supplier-payout/customs-duty ledger
  — the finance migration header explicitly excludes it. Duties appear only as
  read-only estimates in Customs Intelligence.
- **Authorization exists**: `process_decision` (CONTINUE_BEFORE_PAYMENT,
  immutable once finalized) + `process_blocker` (PAYMENT_PENDING/…): the 9.0D
  payment gate.
- **Evidence exists**: the `document` store (PAYMENT_RECEIPT, PROOF_OF_DEPOSIT
  types) with signed-URL access.
- Registry steps 20–26 (billing→collections) already map to the frozen
  registry and the existing 5.0D actions; the *missing* fact is the outbound
  disbursement between the Transit payment gate and those steps.

## 2. Migration decision — ONE additive table, fully justified

`supabase/migrations/20260723000002_finance_requests.sql` creates
**`finance_request`** — the outbound-money fact the existing model cannot
safely represent:

- `payment` cannot hold it (hard-bound to an invoice; money-in semantics);
- `billing_charge` cannot hold it (recording every expense there would make
  every disbursement customer-billable — explicitly forbidden);
- `process_decision.metadata` cannot hold it (a decision is not a payment, and
  generic JSON instead of proper modeling is forbidden).

One row carries the whole lifecycle — request → review → disbursement →
evidence → verification — with explicit FKs to the existing contracts
(`customs_record_id`, `process_decision_id`, `evidence_document_id`,
`billing_charge_id`). **No second invoice/payment table, no new approval
engine, no duplicate document storage, no new permission, no generic JSON.**
RLS: one SELECT policy (`finance:read` + tenant + `can_read_file`), **no
portal policy**; tenant-integrity trigger validates the dossier and every
referenced actor/record; a partial unique index on `dedup_key` backstops
duplicate requests. Typed customs-detail columns (ORBUS/GRED/manifest/
liquidation) were assessed and **not** added — no 9.0E behaviour needs them
(deferred; would be an independently justified migration).

## 3. The lifecycle (pure contracts — lib/finance/requests.ts)

**Request:** `REQUESTED → APPROVED | REJECTED | RETURNED | CANCELLED`;
`RETURNED → REQUESTED` (resubmission); `APPROVED → DISBURSED | CANCELLED`.
**The only edge into DISBURSED is from APPROVED** — that single CAS-enforced
edge is simultaneously the duplicate-execution guard and the
no-unauthorized-payment guard. REJECTED/DISBURSED/CANCELLED are terminal.

**Evidence:** `NONE → SUBMITTED → VERIFIED | REJECTED`; `REJECTED → SUBMITTED`.
Submission never implies verification.

**Categories:** droits de douane, frais d'autorité, dépense fournisseur, coût
interne, autre — each with an honest `reimbursableByDefault` (internal costs
and supplier expenses never default to billable).

## 4. Steps 20–26 as implemented (lib/finance/request-actions.ts)

| Step | Action | Permission (existing) | Boundary enforced |
|---|---|---|---|
| 20 Intake | `createFinanceRequest` | `process:decision:create` | creates the REQUEST fact only — no payment/invoice |
| 21 Review | `reviewFinanceRequest` (+ `resubmitFinanceRequest`) | `finance:validate` | maker-checker on identity (requester ≠ reviewer), note on reject/return, CAS; writes `finance_request` only |
| 22 Disbursement | `recordDisbursement` | `finance:payment` | CAS `APPROVED→DISBURSED`; valid method (payment vocabulary) + amount; never inferred from approval |
| 23 Customs-duty seam | category `CUSTOMS_DUTY` + `customs_record_id` link | — | module never writes `customs_record`, never calls `releaseCustoms` — **Finance payment ≠ customs authorization** |
| 24 Evidence | `attachDisbursementEvidence` / `verifyDisbursementEvidence` | `finance:update` / `finance:void` | same-tenant same-dossier document FK; SUBMITTED ≠ VERIFIED; verifier ≠ executor; note on reject |
| 25 Invoicing | `convertRequestToCharge` | `finance:create` | DISBURSED + reimbursable only, idempotent; inserts a `billing_charge` — the EXISTING chain (numbering/totals/PDF/validation/issue) takes over; never touches `invoice`, never marks paid |
| 26 Clearance | `clearFinance` | `finance:validate` | pure evaluator must pass; audited `FINANCE_CLEARED`; output = the engine's existing handoff `gainde_registration → coordinator_to_declarant` (permission-honest: degrades to a Coordinator notification) |

Financial clearance requires: no request awaiting review, no approved-but-
undisbursed request, VERIFIED evidence on every disbursement, no open
PAYMENT_PENDING/PAYMENT_REJECTED blocker, no pending CONTINUE_BEFORE_PAYMENT
decision, and an invoice (or an **explicit, reasoned** invoicing deferral). It
never completes delivery, never transfers ownership, never fabricates
settlement, never clears customs.

## 5. Ownership invariant (regression-pinned)

No finance action writes `owner_user_id`, `assigned_user_id`,
`assigned_team_code`, `account_manager_id`, `operational_file`, or
`process_step_execution` (test 44). Finance receives notifications and work
without ever becoming the dossier's business owner.

## 6. Permissions, RLS, audit

**Zero new permissions.** view=`finance:read` · review/approve=`finance:validate`
· disburse=`finance:payment` · attach evidence=`finance:update` ·
verify evidence=`finance:void` (the existing `verifyPayment` convention) ·
invoice=`finance:create`/`finance:validate`/`finance:issue` (untouched chain)
· clear=`finance:validate` · request=`process:decision:create` (the same
permission the Transit payment-gate request uses). RLS + tenant trigger + dedup
index proven by `supabase/tests/rls_finance_requests_test.sql` (wired into the
CI rls-tests job). Seven additive audit actions (`finance.request.*`,
`finance.cleared`) carry safe metadata — category/status/amount/reference,
never free-text notes, never an unsupported claim.

## 7. UI and French terminology

One contextual `FinancePanel` on the flag-gated `/files/[id]/process`
inspector (no disconnected CRUD module): request list with amounts/currency,
requester/reviewer/executor **names** (never UUIDs), review actions, the
disbursement form, evidence attach (picker over the dossier's financial
documents) and verify, billable conversion, invoice state, clearance readiness
with per-condition French explanations. Honest labels throughout: « Approuvé —
non décaissé » (never "Payé"), « Justificatif transmis — à vérifier » (never
"Vérifié" before verification), « Feu vert financier ».

## 8. Feature gating

```
EFFITRANS_FINANCE_EXECUTION_ENABLED=false     # .env.example default
financeExecution = ENGINE ∧ STRUCTURES ∧ INTAKE ∧ TRANSIT ∧ FINANCE  (then tenant-ANDed)
```

When any prerequisite is absent: the panel does not render, `getFinanceState`
returns null (including when migration 20260723000002 is not applied — the
table-missing error is caught), and every write fails closed
(`finance_disabled`). Production impact is zero while flags are off.

## 9. Production migration dependency — explicit

**Unapplied on the live database:** `20260722*`, `20260723000001_workflow_structures`,
and now `20260723000002_finance_requests`. Phase 9.0E is **code-complete and
dark-deployed, NOT production-ready**: do not enable
`EFFITRANS_FINANCE_EXECUTION_ENABLED` (or any 9.0B–9.0E flag) until
`/platform/operations` confirms the prerequisite structures
(`LATEST_MIGRATION = 20260723000002_finance_requests`, count 55). The clearance
reader tolerates the 9.0B tables' absence (blockers/decisions default to
none-visible) but the feature must not be enabled in that state.

## 10. Non-goals honored

No bank/Wave/Orange Money API calls (the method vocabulary records how a manual
payment was made; the existing payment_intent scaffold is untouched), no
reconciliation, no GL, no AP module, no payroll/budgeting/forecasting, no
simulated external confirmations.

## 11. Manual acceptance (after migrations + flags in a safe environment)

1. As Chef de Transit (holder of `process:decision:create`): « Nouvelle demande
   de fonds » — droits de douane, montant, objet, bénéficiaire → Finance is
   notified; status « Demandé ».
2. As the same user, attempt review → refused (self-review).
3. As FINANCE_OFFICER: approve → status « Approuvé — non décaissé »; verify no
   payment/invoice row exists.
4. Record the disbursement (amount/method/référence) → « Décaissé »; repeat →
   refused (no second edge).
5. Upload the receipt into the dossier documents; « Joindre le justificatif » →
   « transmis — à vérifier »; as the SAME user who disbursed, attempt « Vérifier »
   → refused; as another `finance:void` holder → « Justificatif vérifié ».
6. « Refacturer au client » on the reimbursable duty → a billing_charge appears;
   build/validate/issue the invoice through the EXISTING billing chain; confirm
   an internal-cost request shows no conversion button.
7. « Feu vert financier » with an open PAYMENT_PENDING blocker → refused with
   the French missing-list; resolve the blocker, finalize the pending decision,
   then clear → audit `finance.cleared` + the handoff/notification.
8. Portal user: sees nothing of any of this. Cross-tenant: nothing. Flags off:
   the panel disappears entirely.

## 12. Deferred / recommended Phase 9.0F

- Typed customs-detail columns (ORBUS/GRED status, manifest, note de détail,
  liquidation) as an independently justified additive migration — only after
  the 9.0B–9.0E migrations are confirmed applied in production.
- A Finance work queue surface (department-level list of pending
  requests across dossiers) on the existing queue architecture.
- T10 field-agent mobile execution (pickup/port-exit evidence/POD).
- Collections/dunning depth over the existing aging model.
