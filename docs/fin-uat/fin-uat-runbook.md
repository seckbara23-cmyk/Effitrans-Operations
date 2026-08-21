# FIN-UAT — Production Runbook (numbered)

**Method:** TMS-7. One operator step at a time; a green suite never marks a human
case PASS; defects found are classified, fixed with regression+mutation coverage,
CI'd and redeployed BEFORE the affected case re-runs. Every case: *precondition →
actor → action → expected UI → expected DB → expected audit/event → PASS/FAIL.*

**Test-object naming:** dossier/client ref `FIN-UAT`, invoice(s) issued on it only,
expense authorizations titled « FIN-UAT — … », proof PDF `FIN-UAT-PREUVE.pdf`.
Genuine records (2 invoices, 1 payment, 1 draft authorization) are read-only
baseline. No SQL state manufacturing. No role/permission changes by me — account
provisioning, if chosen, is done by the operator in `/users` (existing roles only).

## Category B — read-only production assertions (run at open, and re-run at close)

| # | Assertion | Expected at OPEN |
| --- | --- | --- |
| FB-1 | ledger head `20260912000001`; local=remote | ✔ verified |
| FB-2 | deposit tables 0/0; visas 0; vouchers 0; aging 0; follow-ups 0 | ✔ verified (the never-exercised baseline) |
| FB-3 | genuine records untouched: invoice DRAFT+PAID ids, payment VERIFIED, expense DRAFT — same ids/status at close | baseline captured |
| FB-4 | every deposit state transition row in `invoice_deposit_event` has actor + from→to + timestamp (run after FIN-1) | n/a at open |
| FB-5 | visa hash-chain intact: each `expense_visa` links prior hash (after FIN-2) | n/a |
| FB-6 | voucher ↔ authorization 1:1 (unique constraint holds under the happy path) | n/a |
| FB-7 | no cross-tenant leakage in any new finance row | standing |
| FB-8 | audit_log carries `deposit.*`, expense, collections, aging actions for every UAT act | n/a |

## Category C — human production UAT

### STEP 0 — Reachability & gates sweep (read-only; the TMS-7 lesson first)
Establishes the four unverifiable env flags empirically and proves each intended
actor can REACH their surface before any workflow runs. Detailed as the first
operator action (issued separately). Outputs: render/absent/forbidden matrix for
`/deposits`, `/courier`, `/collections`, `/finance/aging`, `/finance/caisse`,
`/finance/reconciliation` under SYSTEM_ADMIN and each demo actor.

### FIN-1 — Deposit / courier custody (13 cases)
Actors: FINANCE (issue) · ADMINISTRATION (`admin_service:manage`) · COURIER.
*Blocked-by-staffing note: B-2 — Administration/Courier seats are real employees;
operator decides demo accounts vs real actors before FIN-1-03.*

| # | Case | Expected |
| --- | --- | --- |
| FIN-1-01 | Create UAT dossier + invoice; **issue** it (`finance:issue`) | invoice ISSUED, numbered; audit `finance.*`; genuine invoices untouched |
| FIN-1-02 | Hand invoice to Administration | `invoice_deposit` row **PREPARATION_PENDING**; custody event; visible in `/deposits` |
| FIN-1-03 | Prepare package | → READY_FOR_COURIER; event row |
| FIN-1-04 | Assign courier (`courier:assign`) | → ASSIGNED; courier notified; appears in `/courier` for that courier ONLY |
| FIN-1-05 | Courier **declines** with reason (refusal path first) | back to READY_FOR_COURIER (per state machine); reason in event; no orphan |
| FIN-1-06 | Re-assign; courier **accepts** | → ASSIGNED accepted; event actor = courier |
| FIN-1-07 | Start run | → IN_TRANSIT |
| FIN-1-08 | Record deposit at bank/administration | → DEPOSITED with reference |
| FIN-1-09 | Upload proof `FIN-UAT-PREUVE.pdf` + submit | document type PROOF_OF_DEPOSIT status **UNDER_REVIEW** (canonical — d8a57b0); deposit → PROOF_SUBMITTED |
| FIN-1-10 | **Maker-checker:** the COURIER attempts accept/reject of own proof | UI: control absent or refused « self_review_forbidden »; server refuses; state unchanged — *current ratified deposit authority documented as-is (Decision 2 untouched)* |
| FIN-1-11 | Administration **rejects** proof with reason | → PROOF_REJECTED; reason stored; document NOT verified |
| FIN-1-12 | Courier re-uploads; Administration **accepts** | → PROOF_ACCEPTED; document **VERIFIED** with `reviewed_by`; custody event carries evidence id |
| FIN-1-13 | Hand to collections | → **HANDED_TO_COLLECTIONS** (terminal); FB-4 audit chain complete end-to-end |

### FIN-2 — Expense authorization / visa / voucher (8 cases)
*⛔ Gated by B-1: chain requires Trésorière → DAF → DG seats (0 holders). Cases
-01/-02 and refusals runnable now; -03..-08 after seats exist.*

| # | Case | Expected |
| --- | --- | --- |
| FIN-2-01 | FINANCE_OFFICER creates « FIN-UAT — » authorization (amount, beneficiary, dossier link) | DRAFT version 1; amount-in-words; genuine DRAFT row untouched |
| FIN-2-02 | Submit | status advances; version snapshot frozen |
| FIN-2-03..06 | Visa chain **in ratified order** (Chef de Transit → Coordonnateur → Opération → Trésorière → DAF → DG), one signer per step | each visa appends to hash chain (FB-5); out-of-order attempt refused; a signer cannot sign twice |
| FIN-2-07 | **Refusal path:** one seat rejects with reason | authorization enters rejected/returned state; chain preserved; no voucher possible |
| FIN-2-08 | On full approval: create voucher; CASHIER executes | voucher 1:1 (FB-6), numbered; caisse records execution; second voucher attempt → already_exists |

### FIN-3 — Collections (5 cases)

| # | Case | Expected |
| --- | --- | --- |
| FIN-3-01 | Reachability: `/collections` lists the UAT receivable (post FIN-1-13 / overdue UAT invoice) | genuine invoices listed read-only, untouched |
| FIN-3-02 | COLLECTIONS_OFFICER records a follow-up | `collection_follow_up` row; audit |
| FIN-3-03 | Second follow-up, different channel | history ordered; nothing overwritten |
| FIN-3-04 | Attempt by a non-holder (e.g. documentation.demo) | refused/hidden; server refuses regardless of UI |
| FIN-3-05 | Closure lane (engine `process:close` where applicable) | closure recorded with evidence; state machine honoured |

### FIN-4 — Aging Balance (7 cases — NEW capability, five required surfaces)
*Draft lane runnable with FINANCE_OFFICER; ⛔ finalize/validate/share gated by B-1.*

| # | Case | Expected |
| --- | --- | --- |
| FIN-4-01 | Reachability: `/finance/aging` for FINANCE_OFFICER; and **absent** for a non-holder | env flag AND permission proven |
| FIN-4-02 | **Tableau de Bord** renders with production totals consistent with invoices | integer-minor-unit money; no NaN |
| FIN-4-03 | **Données Brutes** matches invoice/payment reality row-for-row (spot-check) | whitelist guards hold |
| FIN-4-04 | **Analyse Clients** buckets sum to raw totals | bucket boundaries per engine tests |
| FIN-4-05 | **Dossiers Critiques** shows only qualifying rows | criteria as pinned |
| FIN-4-06 | **Graphiques** renders from the same dataset (no divergent recalculation) | |
| FIN-4-07 | Create DRAFT report; verify draft is mutable, NOT shared, NOT printable-as-final | finalize deliberately NOT attempted until B-1 resolves |

### FIN-5 — Caisse / reconciliation (5 cases)

| # | Case | Expected |
| --- | --- | --- |
| FIN-5-01 | Reachability: `/finance/caisse` for CASHIER (`caisse.demo`); refused elsewhere | |
| FIN-5-02 | Caisse records the FIN-2-08 execution (or a UAT movement if FIN-2 blocked) | balances update; audit |
| FIN-5-03 | `/finance/reconciliation`: run WES-5 reconcile on the UAT payment picture | convergent AND idempotent — second run changes nothing (the WES-5 invariant, live) |
| FIN-5-04 | Alerts surface (missing reference / pending) reflects reality | links land on the right rows |
| FIN-5-05 | Authority separation: CASHIER cannot validate/void invoices; FINANCE cannot execute caisse | server refuses both directions |

### Close-out
Re-run FB-2..FB-8; produce the evidence matrix; genuine-record hashes unchanged
(FB-3); ledger unchanged; only then verdicts per lane.

## Blockers / prerequisites (operator decisions before their gated cases)

| # | Blocker | Gates | Resolution (operator) |
| --- | --- | --- | --- |
| B-1 | TREASURER / DAF / DGA: **0 active holders** | FIN-2-03+, FIN-4 finalize lane | grant existing roles to demo accounts in `/users` (UAT-11b pattern) — or Effitrans names real officers |
| B-2 | COURIER / ADMINISTRATIVE_OFFICER: real employees only | FIN-1-03+ | `courier.demo`, `administration.demo` recommended; or proceed with real actors knowingly |
| B-3 | Env flags unverifiable from here | lane visibility | resolved empirically by STEP 0 |
| B-4 | ACCOUNTANT: 0 holders | none (FINANCE_OFFICER covers draft lane) | optional |

## Initial status

| Category | Status |
| --- | --- |
| A — automated | **GREEN** (suites listed in baseline §6; CI applies all 120 migrations per push) |
| B — DB assertions | FB-1/FB-2/FB-3 captured at open; rest pending their lanes |
| C — human | **0 of 38+STEP-0 executed** — begins with STEP 0 below |
