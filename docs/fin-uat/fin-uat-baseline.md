# FIN-UAT — Baseline Audit (read-only, 2026-08-21)

**GO received. No fixes implemented.** Method: TMS-7. Every fact below was verified
read-only against production or the repository at `4028704`; nothing was granted,
created or modified.

## 1. Migration / schema state

Production ledger head = **`20260912000001` (migration 120)**, local = remote.
All Finance-domain schema is applied: deposits (invoice_deposit + event),
expense chain (authorization/version/visa/voucher, DEC-C06/C07/C08),
aging (migration 72 family: aging_report/row/totals/share/artifact,
aging_template_version, legacy_import_*), collections (`collection_follow_up`),
invoices/payments, WES-5 reconciliation RPC.

⚠ **Stale code comment found (recorded, not fixed):** `lib/finance/aging/rollout.ts`
still claims « migration 72 is unapplied … `finance:aging:read` DOES NOT EXIST in
the production database ». **False today** — the permission exists with a full role
matrix (verified below). The gate is therefore *env flag AND permission*, not
"permission absent". No behaviour bug; the comment misdescribes production.

## 2. Feature / environment gates

| Gate | Layer | State |
| --- | --- | --- |
| `tenant_process_rollout.physical_invoice_deposit` | tenant | **true** (verified) |
| `tenant_process_rollout.collections` | tenant | **true** (verified) |
| `EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED` | env | **unverifiable from here** (Vercel env unreadable) |
| `EFFITRANS_COLLECTIONS_ENABLED` | env | unverifiable |
| `EFFITRANS_FINANCE_AGING_ENABLED` | env | unverifiable — aging is env AND permission (single-layer by design; rollout.ts) |
| `EFFITRANS_FINANCE_EXECUTION_ENABLED` | env | unverifiable; quadruple-gated over engine chain |
| Caisse / reconciliation | none found | permission-gated only (`finance:expense:execute`, `finance:*`) |

**Consequence:** the four env values are established empirically by OPERATOR-STEP 0
(reachability sweep) — the TMS-7 lesson applied up front: we test what the intended
user can actually reach before testing what the code can do.

## 3. Production row inventory (never-exercised ≠ broken)

| Domain | Rows | Reading |
| --- | --- | --- |
| `invoice_deposit` / `invoice_deposit_event` | **0 / 0** | **Never exercised.** Not broken: 70 automated tests cover the module (Category A), and the custody chain's SQL suites run in CI on every push |
| `expense_authorization` | **1 (DRAFT)** | The chain has been ENTERED once but never advanced: 0 visas, 0 vouchers |
| `expense_visa` / `expense_voucher` | 0 / 0 | Never exercised past draft |
| `aging_report` (+rows/totals/shares/artifacts) | 0 | Never exercised |
| `collection_follow_up` | 0 | Never exercised |
| `invoice` | 2 (1 DRAFT, 1 PAID) | Genuine records — **read-only baseline, never modified by UAT** |
| `payment` | 1 (VERIFIED) | idem |

## 4. Actors — roles, permissions, and who actually holds them

Verified from the live `role_permission` map and active `user_role` holders.

| Lane step | Permission | Roles | Active holders / demo |
| --- | --- | --- | --- |
| FIN-1 hand invoice to Administration | `finance:issue` | AM, BILLING_OFFICER, FINANCE_OFFICER, OPS_SUP, SA | ✔ `finance.demo` |
| FIN-1 prepare package / accept-reject proof / hand to collections | `admin_service:manage` | **ADMINISTRATIVE_OFFICER**, OPS_SUP, SA | 3 active AO — **all real employees, no demo** |
| FIN-1 assign courier | `courier:assign` | ADMINISTRATIVE_OFFICER, OPS_SUP, SA | idem |
| FIN-1 courier lifecycle (accept→deposit→proof) | `courier:deposit` | **COURIER**, SA | 2 active COURIER — **real employees, no demo** |
| FIN-2 create/submit | `finance:expense:create/submit` | FINANCE_OFFICER, SA | ✔ `finance.demo` |
| FIN-2 visa chain (ratified DEC-C08: Demandeur → Chef de Transit → Coordonnateur → Opération → **Trésorière → DAF → DG**) | `finance:expense:sign` + seat identity | CEO, CHIEF_OF_TRANSIT, COORDINATOR, DAF, FINANCE_OFFICER, TREASURER | ⛔ **TREASURER 0 · DAF 0 · DGA 0 active holders** |
| FIN-2 execute (caisse) | `finance:expense:execute` | CASHIER, OPS_SUP, SA | ✔ `caisse.demo` |
| FIN-3 collections | `collections:manage` (+ engine `process:read/close` on the closure lane) | COLLECTIONS_OFFICER, FINANCE_OFFICER, OPS_SUP, SA | ✔ `recouvrement.demo` |
| FIN-4 aging draft | `finance:aging:draft_create/update` | ACCOUNTANT, DAF, FINANCE_OFFICER, SA | ✔ FINANCE_OFFICER (`finance.demo`); ACCOUNTANT 0 |
| FIN-4 finalize / validate / share / import-approve | `finance:aging:*` | **DAF, DGA only** | ⛔ **0 holders — nobody in production can finalize an aging report** |
| FIN-4 read/export/print | broad (incl. CEO, TREASURER) | | ✔ |
| FIN-5 caisse execution | `finance:expense:execute` | CASHIER | ✔ `caisse.demo` |
| FIN-5 reconciliation | `finance:payment` / `finance:validate` | COLLECTIONS/FINANCE_OFFICER, OPS_SUP, SA | ✔ |

### ⛔ B-1 / B-2 — the two structural blockers (staffing, not code)

* **B-1:** the ratified visa chain ends **Trésorière → DAF → DG**, and TREASURER,
  DAF and DGA have **zero active holders**. FIN-2 cannot complete its chain, and
  FIN-4 cannot finalize/validate/share, until those seats exist.
* **B-2:** FIN-1's Administration and Courier seats are held only by **real
  employees**. Usable, but the TMS-7 practice (clearly-identified demo actors, no
  notifications to real staff) argues for demo accounts.

**Resolution path (operator decision, never mine):** grant EXISTING roles to demo
accounts via `/users` — the exact UAT-11b pattern. No new role, no permission edit,
no SQL. Proposed set: `courier.demo`, `administration.demo`, `tresorerie.demo` (or
grant TREASURER to an existing demo), `daf.demo`, `dg.demo`.

## 5. Fixtures that can safely be created (application workflows only)

* One UAT invoice on a UAT dossier (`FIN-UAT` marking), ISSUED — feeds FIN-1.
* One UAT expense authorization (« FIN-UAT — … ») — feeds FIN-2 (the existing DRAFT
  row is a genuine record: observed, not reused).
* Collections follow-ups against the UAT invoice only.
* One aging DRAFT report (never finalized until B-1 resolves).
* Caisse entries only for the UAT voucher.
* PROOF_OF_DEPOSIT upload: a clearly-marked UAT PDF.
**Never touched:** the 2 genuine invoices, 1 payment, 1 draft expense authorization,
all TMS-7 artifacts, HR data.

## 6. Category A — automated evidence (initial status: GREEN)

CI #575-era full suite (7,26x tests) green; lane-relevant suites:
`process-deposit` (52) · `debt-deposit-canonical-status` (18) ·
`expense-authorization` · `expense-approval-chain` (green in CI; known
Windows-local CRLF pin) · `expense-documents` · `ops-sec-2c-expense-counters` ·
`caisse-foundation` · `wes-5-reconciliation` · `fin-aging-engine` ·
`fin-aging-schema` · `fin-aging-workspace` · `aging-preview-dataset-constraints` ·
`process-collections` · `finance` · `finance-hub` · `finance-execution` ·
`uat2a-finance-reporting`. The `rls-tests` CI job applies all 120 migrations to a
real Postgres and runs the SQL suites (incl. deposit custody and reconciliation
invariants) on every push.

## 7. Destructive / irreversible actions identified (flagged BEFORE any operator step)

| Action | Nature | Handling |
| --- | --- | --- |
| `finance:issue` on an invoice | numbering is consumed; issued invoices are immutable-by-design | UAT invoice only |
| `rejectProof` / `failDeposit` / `declineAssignment` | terminal-ish branches with reasons | exercised on UAT deposit only, AFTER the happy path is banked |
| Aging **finalize** | snapshot becomes immutable | blocked by B-1 anyway; runs LAST if unblocked |
| `handToCollections` | hands the dossier across a boundary | UAT records only |
| Voucher creation | 1:1 with authorization, numbered | UAT authorization only |
| Any deletion | none planned | not part of FIN-UAT |

## 8. Standing constraints honoured

Deposit authority = the **current ratified model** (`admin_service:manage`
accept/reject + module-internal maker-checker `self_review_forbidden`, CAS, custody
ledger, audit). **Decision 2 (generic verifier-seat governance for deposit proofs)
stays open; FIN-UAT documents behaviour, it does not convert it.** ICTD/ICAM/IPAM,
Phase 1.8 fossil, multi-leg road, W-items: untouched.
