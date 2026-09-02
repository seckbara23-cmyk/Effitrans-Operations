# EFFITRANS — Final 26-step workflow reconciliation

**Date:** 2026-09-02 · **AUDIT ONLY** — no code, no migration, no mutation, no
role change. Every claim below was re-derived from source or live production
(read-only), attempting to disprove the candidate rather than confirm it.

**Sources actually consulted:** `EFFITRANS_PROCESS` + `MAKER_CHECKER_PAIRS` +
`PARALLEL_ACTIVITIES` (effitrans-process.ts) · `process_step_owning_role`
(production) · `process_step_execution` rows (production) ·
`handDossierToTransit` + `sendHandoff` call census + `submitStep`/`activateStep`
reception seam · `evaluateStepEvidence` + C-3 declarable set ·
`ROLE_CANONICAL_DEPARTMENT` (lib/organization/departments.ts — the Phase-9.0A
canonical registry) · role/holder counts (production) · `closureBlockers` +
`transitionFile` + `process:close` holders · file/transport state machines ·
C-4 CI journey · live EFT-IMP-2026-00009.

---

## Executive verdict

**MATCH WITH CORRECTIONS.** Structurally the candidate and the built machine
are the same 26-step process: every step exists, in order, with the join gates
and controls the candidate names — and the platform is stricter in three
places. Two corrections to the candidate's own text survive adversarial
review (C1's boundary phrasing, and one department attribution that the
platform's canonical registry contradicts provisionally), plus one role-label
ghost already known. **Match: 26/26 steps (100% structural); 24/26 candidate
rows verbatim, 2 rows corrected.**

---

## C1 — Step 3 → Step 4 boundary: **candidate text CORRECTED**

The engine disproves the candidate's phrasing "transmission is the governed
handoff that closes Step 3". `handDossierToTransit` (intake-actions.ts:479):

1. guards `process:handoff:send`;
2. refuses on open intake blockers;
3. **refuses unless step 3 is ALREADY terminal-done** (`am_opening_incomplete`
   — the D-2 comment: transmitting earlier "put a dossier in Transit's queue
   that Transit was then correctly forbidden to work — a deadlock");
4. only then `sendHandoff("am_dossier_opening" → "coordinator_reception")`.

**Corrected doctrine:** the transmission is a **distinct governed act that
FOLLOWS step 3's completion** and precedes step 4's reception. It is not a
numbered step, and it is not what closes step 3 — `submitStep` closes step 3.
This makes the roadmap's "Step 4 = a transmission act" *closer* to the engine
than the candidate admitted: the act exists separately; it is merely
unnumbered, and not reserved to the Coordinateur — `process:handoff:send` is
held by ACCOUNT_MANAGER, COORDINATOR, CHIEF_OF_TRANSIT, OPS_SUPERVISOR and
others, so the Coordinateur *may* perform it, as the roadmap assumes. Built
step 4 is the Transit-side reception (`coordinator_reception`,
CHIEF_OF_TRANSIT), started only by an explicit reception
(`handoff_reception_required` refused at both `activateStep` AND `submitStep`).

## C2 — Step 2 authority: **candidate CONFIRMED, every sub-claim proven**

| claim | production evidence |
|---|---|
| `OPERATIONS_MANAGER` role exists? | **0 rows** in `role` |
| holders | **0** |
| template | absent from `role-templates.ts` |
| where the label lives | `EFFITRANS_PROCESS.role` + `process_step_execution.assigned_role_code` — **documentary only** |
| actual authorization seam | `process_step_owning_role`: `operations_intake → OPS_SUPERVISOR` (9 holders), consumed by the engine's authorization; `stepPermission()` → `file:assign` |

## C3 — Four departments: **provable from the platform's own canonical registry**

`ROLE_CANONICAL_DEPARTMENT` (Phase 9.0A, parity with role-templates
test-enforced) already answers this. The registry defines five canonical
departments — the ratified four **plus HUMAN_RESOURCES flagged
`processesDossiers: false`** (support, outside the dossier flow) — with TRANSIT
and TRANSPORT rolling up to OPERATIONS **for org-chart display only, never a
merge**. The four operational departments are exactly the ratified four.

**DEPARTMENT → FUNCTIONS → ROLES → STEPS**

| Dept | Function (built `department`) | Role | Steps |
|---|---|---|---|
| 🟦 OPERATIONS | operations | OPS_SUPERVISOR | 2 |
| 🟦 OPERATIONS | account_management | ACCOUNT_MANAGER | 3, 16, 19 + 3 parallel activities |
| 🟦 OPERATIONS | coordination | COORDINATOR | 8, 10, 12, 17, 18 + the unnumbered transmit acts |
| 🟨 TRANSIT | transit | CHIEF_OF_TRANSIT | 4, 5, 7 |
| 🟨 TRANSIT | customs_declaration | CUSTOMS_DECLARANT | 6, 11 |
| 🟨 TRANSIT | customs_field | CUSTOMS_FIELD_AGENT | 13 |
| 🟩 TRANSPORT | transport | TRANSPORT_OFFICER | 14 |
| 🟩 TRANSPORT | pickup | PICKUP_AGENT | 15 |
| 🟪 FINANCE | finance_customs | CUSTOMS_FINANCE_OFFICER | 9 |
| 🟪 FINANCE | billing | BILLING_OFFICER | 20, 22 |
| 🟪 FINANCE | finance | FINANCE_OFFICER | 21 |
| 🟪 FINANCE | administration | ADMINISTRATIVE_OFFICER | 23, 25 *(registry: PROVISIONAL)* |
| 🟪 FINANCE | courier | COURIER | 24 *(registry: PROVISIONAL)* |
| 🟪 FINANCE | collections | COLLECTIONS_OFFICER | 26 |
| ❓ **RULING REQUIRED** | cotation | QUOTATION_MANAGER | 1 — see below |

**The COORDINATOR is already ruled**: `COORDINATOR → OPERATIONS` in the
canonical registry (« Coordinateur des opérations »). It *acts inside* the
Transit phase at steps 8/10/12 and the Operations phase at 17/18 — an
Operations seat working across phases, not a two-department role.

**⚠ BUSINESS RULING REQUIRED — Step 1's department.** The candidate (and the
roadmap) put Cotation in 🟦 OPERATIONS. The canonical registry says
`QUOTATION_MANAGER: "TRANSIT" // PROVISIONAL — cotation is Chef de Transit's
step T1 in the Guide`. Two first-party sources disagree; the registry itself
marks its answer provisional. Not guessed here — it changes only the
departmental rollup of step 1, nothing operational. *(Note the owning role for
step 1 is QUOTATION_MANAGER, 9 holders; the definition's `role:
COTATION_OFFICER` is documentary, same ghost class as C2.)*

The two PROVISIONAL Finance placements (ADMINISTRATIVE_OFFICER, COURIER) agree
with the ratified doctrine — the ratification effectively confirms what the
registry was awaiting.

## C4 — Step 9: **CONFIRMED, separation proven in production**

`CUSTOMS_FINANCE_OFFICER` holds `customs:read, customs:register, finance:read,
process:handoff:receive/send, process:read` — registration authority, **no
invoicing, no validation, no payment**. `FINANCE_OFFICER` holds the full
finance surface (`finance:create/issue/validate/payment/void`, expenses,
aging) — **no `customs:register`**. Zero overlap beyond `finance:read` and
process read/receive. « Chargé finance douane » ≠ « Chargé finance » is
structural, and the canonical registry places CUSTOMS_FINANCE_OFFICER in
FINANCE (« Guide étape 5 Enregistrement — Finance ») exactly as the candidate
claims.

## C5 — 9 + 10 → 11 join: **CONFIRMED verbatim**

`gainde_document_submission.prerequisites = ["coordinator_to_declarant",
"gainde_registration"]` — both must be terminal before step 11 promotes.

## C6 — 13 + 14 → 15 join: **CONFIRMED verbatim, twice over**

`pickup.prerequisites = ["customs_field_clearance", "transport_assignment"]` in
the engine — and independently, the transport plane refuses binding a
non-AVAILABLE vehicle (DB trigger), and `pickup` sits in `parallelGroup: main`
while step 14 runs in `transport_readiness` beside the customs chain.

## C7 — Maker/checker: **exactly three pairs, no omission**

The full `MAKER_CHECKER_PAIRS` array (all with `selfApprovalAllowed: false`,
`reasonRequired: true`, correction returning to the preparer step):

1. `customs_preparation → transit_validation` (correction → step 6)
2. `billing_draft → finance_invoice_validation` (correction → step 20)
3. `coordinator_completeness → am_completeness` (correction → step 18)

There is no fourth pair. (Payment verification maker/checker exists on the
finance plane — record vs verify — but is not a process-step pair; it
surfaces in closure, C10.)

## C8 — Parallel activities: **CONFIRMED, and they gate nothing**

| key | owner | prerequisites |
|---|---|---|
| `bon_a_delivrer` | ACCOUNT_MANAGER (account_management) | `am_dossier_opening` |
| `pre_gate` | ACCOUNT_MANAGER | `am_dossier_opening` |
| `transport_docs_transmission` | ACCOUNT_MANAGER | `pre_gate`, `bon_a_delivrer` |

No official step lists any of the three as a prerequisite (verified against
the whole `EFFITRANS_PROCESS` block) — they gate nothing on the 26-ladder.
**26 steps + 3 activities = the 29 execution rows** a dossier carries.

## C9 — Step 16 ownership: **CONFIRMED**

`am_delivery_followup`: department `account_management`, role ACCOUNT_MANAGER
(owning-role table agrees). Physical movement lives on the transport plane
(`transport_record` state machine, TRANSPORT_OFFICER/driver seats). The AM's
step-16 capability was ratified through its own test (C-4: the delivery
capability grant). Two planes, two owners, as the candidate states.

## C10 — Closure: **CONFIRMED, all conditions proven**

- Step 26 (`collections`, COLLECTIONS_OFFICER) completes only after **verified**
  payment and balance 0 — verification ≠ settlement is its own blocker.
- **Closure is NOT step 26.** The file-plane act is
  `transitionFile(→ CLOSED)`, guarded by `file:transition` + the pure
  `closureBlockers` rule, enforced server-side:
  `customs_not_released` (IMP/EXP with required record: RELEASED/CANCELLED
  only) · `delivery_incomplete` (transport DELIVERED/POD_RECEIVED/CANCELLED) ·
  `no_invoice` · `invoice_outstanding` (any balance > 0 or DRAFT) ·
  `payment_unverified`. The process-plane close (`process:close`) is held by
  **OPS_SUPERVISOR and SYSTEM_ADMIN only — deliberately NOT Collections**
  (documented in the action itself). **Nothing closes automatically anywhere**
  — both closure acts are explicit, guarded operator actions.

---

## The 26-row authoritative comparison

Legend: **M** = MATCH. All 26 steps are implemented (C-4 certified the full
Creation→Closure journey in CI); "Prod" column = what the C-4 journey +
production evidence established.

| # | Candidate name | Built key | Dept | Function | Auth role (owning) | Prereq | Evidence gate (requiredDocuments) | Handoff? | M/C? | ∥ | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cotation / governed skip | `cotation` | ❓(ruling) | cotation | QUOTATION_MANAGER | — (entry, skippable) | none — quotation plane | no | no | main | **M** (dept ruling pending) |
| 2 | Réception et affectation | `operations_intake` | OPERATIONS | operations | **OPS_SUPERVISOR** | cotation | **none** (submittable directly; `requiredEvidence` is documentary) | no | no | main | **M** + C2 ghost label |
| 3 | Ouverture et préparation | `am_dossier_opening` | OPERATIONS | account_management | ACCOUNT_MANAGER | step 2 | TRANSPORT_REQUEST · BORDEREAU_LIVRAISON · VENDOR_INVOICE · SPENDING_AUTHORIZATION (3 of 4 declarable-absent, BL never) | **after completion: transmit act** | no | main | **M** |
| — | *(roadmap 4: transmission)* | `handDossierToTransit` | OPERATIONS | coordination *(any send-holder)* | `process:handoff:send` | step 3 done + no blocking intake blocker | — | **YES → sendHandoff 3→4** | no | — | **corrected boundary (C1)** |
| 4 | Réception Transit (roadmap 5a) | `coordinator_reception` | TRANSIT | transit | CHIEF_OF_TRANSIT | step 3 | reception required (outstanding handoff refuses activate/submit) | receives | no | customs | **M** |
| 5 | Affectation Déclarant (roadmap 5b) | `transit_declarant_assignment` | TRANSIT | transit | CHIEF_OF_TRANSIT | step 4 | — | no | no | customs | **M** |
| 6 | Préparation douanière | `customs_preparation` | TRANSIT | customs_declaration | CUSTOMS_DECLARANT | step 5 | customs record + declaration docs | no | **maker** | customs | **M** |
| 7 | Validation douanière | `transit_validation` | TRANSIT | transit | CHIEF_OF_TRANSIT | step 6 | — | no | **checker of 6** | customs | **M** (PG-6: preparer never holds validate) |
| 8 | Transmission enregistrement | `coordinator_to_finance` | OPERATIONS | coordination | COORDINATOR | step 7 | — | no | no | customs | **M** |
| 9 | Enregistrement GAINDE | `gainde_registration` | **FINANCE** | finance_customs | CUSTOMS_FINANCE_OFFICER | step 8 | GAINDE declaration number recorded | **YES → sendHandoff 9→10** | no | customs | **M** (C4 proven) |
| 10 | Retour au Déclarant | `coordinator_to_declarant` | OPERATIONS | coordination | COORDINATOR | step 9 | reception of 9→10 handoff | receives | no | customs | **M** |
| 11 | Introduction GAINDE/ORBUS | `gainde_document_submission` | TRANSIT | customs_declaration | CUSTOMS_DECLARANT | **steps 9 AND 10 (join)** | submission evidence | no | no | customs | **M** (C5) |
| 12 | Suivi douanier | `customs_followup` | OPERATIONS | coordination | COORDINATOR | step 11 | circuit/inspection facts | no | no | customs | **M** |
| 13 | BAE / Mainlevée | `customs_field_clearance` | TRANSIT | customs_field | CUSTOMS_FIELD_AGENT | step 12 | BAE reference; governed release | no | no | customs | **M** |
| 14 | Préparation transport | `transport_assignment` | TRANSPORT | transport | TRANSPORT_OFFICER | (parallel entry) | vehicle + driver bound (AVAILABLE-only, DB-enforced) | no | no | **transport_readiness** | **M** |
| 15 | Enlèvement (JOIN) | `pickup` | TRANSPORT | pickup | PICKUP_AGENT | **13 AND 14 (join)** | pickup confirmation | no | no | main | **M** (C6) |
| 16 | Suivi de livraison | `am_delivery_followup` | OPERATIONS | account_management | ACCOUNT_MANAGER | step 15 | — (transport plane executes) | no | no | main | **M** (C9) |
| 17 | POD / BL signé | `transport_pod_handoff` | OPERATIONS | coordination | COORDINATOR | step 16 | verified delivery note → POD_RECEIVED auto-recorded on transport plane | no | no | main | **M** |
| 18 | Contrôle de complétude | `coordinator_completeness` | OPERATIONS | coordination | COORDINATOR | step 17 | receipts/proofs | no | **maker** | main | **M** |
| 19 | Validation finale | `am_completeness` | OPERATIONS | account_management | ACCOUNT_MANAGER | step 18 | — | no | **checker of 18** | main | **M** (candidate's "third pair" confirmed) |
| 20 | Préparation facture | `billing_draft` | FINANCE | billing | BILLING_OFFICER | step 19 | draft invoice | no | **maker** | main | **M** |
| 21 | Validation & émission | `finance_invoice_validation` | FINANCE | finance | FINANCE_OFFICER | step 20 | official invoice + immutable artifact | no | **checker of 20** | main | **M** |
| 22 | Envoi facture | `billing_dispatch` | FINANCE | billing | BILLING_OFFICER | step 21 | dispatch evidence (positive path operator-verified — no email seam) | **YES → sendHandoff 22→23** | no | main | **M** |
| 23 | Préparation dépôt | `administration_deposit_prep` | FINANCE | administration | ADMINISTRATIVE_OFFICER | step 22 | deposit pack + courier assigned | receives | no | main | **M** |
| 24 | Dépôt physique | `courier_deposit` | FINANCE | courier | COURIER | step 23 | proof of deposit (custody events on `invoice_deposit_event`) | no | no | main | **M** |
| 25 | Validation dépôt | `administration_proof_handoff` | FINANCE | administration | ADMINISTRATIVE_OFFICER | step 24 | validated proof | **YES → sendHandoff 25→26** | no | main | **M** |
| 26 | Recouvrement | `collections` | FINANCE | collections | COLLECTIONS_OFFICER | step 25 | verified payment, balance 0 | receives | no | main | **M** + closure separate (C10) |

## Handoff map — exactly four governed handoff edges

```
3 → 4    handDossierToTransit          (Operations → Transit)
9 → 10   gainde_registration → coordinator_to_declarant (Finance → Coordination)
22 → 23  billing_dispatch → administration_deposit_prep (Billing → Administration)
25 → 26  administration_proof_handoff → collections     (Administration → Recouvrement)
```

Reception is enforced (activate AND submit refuse `handoff_reception_required`)
wherever one of these is outstanding. Every other step advances by prerequisite
promotion without handoff ceremony — consistent with C-4's finding that
reception enforcement exists exactly where a handoff is actually sent.

## Prerequisite/join map — two joins

`gainde_document_submission ⇐ {coordinator_to_declarant, gainde_registration}` ·
`pickup ⇐ {customs_field_clearance, transport_assignment}`. All other steps:
single predecessor.

## Closure doctrine (C10, condensed)

26-step ladder ends at `collections` → file-plane `transitionFile(→CLOSED)`
gated by the five `closureBlockers` → process-plane close on `process:close`
(OPS_SUPERVISOR + SYSTEM_ADMIN only). Nothing automatic.

## EFT-IMP-2026-00009 — validated fresh (2026-09-02)

Step 1 SKIPPED · step 2 **still ACTIVE, not submitted** · step 3 PENDING ·
AM seat + Responsable client = Ouleye Diop (`operations@operations.com`,
ACCOUNT_MANAGER held) · 0 open blockers · step-3 documents required as in the
row above (only BORDEREAU_LIVRAISON is non-declarable and absent) ·
**Operations → Transit handoff NOT currently available** (step 3 not done —
correct refusal). Unchanged since the pilot audit; the two-act resolution
stands. Not mutated.

## Documentary / UI drift register

| # | drift | class |
|---|---|---|
| 1 | `assigned_role_code`/definition `role` say OPERATIONS_MANAGER (step 2) and COTATION_OFFICER (step 1) — neither exists; owning-role table is the authority | **DISPLAY ONLY** (fix worth its own slice) |
| 2 | Handoff refusal names step 3 while the screen names step 2 as current — both true, reads as contradiction | **UX DEFECT** (message should name the first actionable step) |
| 3 | `lib/users/departments.ts` header says the canonical registry has "exactly four departments — OPERATIONS, TRANSIT, FINANCE, HUMAN_RESOURCES" — stale: the registry has five incl. TRANSPORT (TMS-5C) | **DISPLAY ONLY** (stale comment) |
| 4 | Same file's UI taxonomy places COURIER under « Opérations » heading and CUSTOMS_FINANCE_OFFICER under « Transit & Douane » heading — both FINANCE in the canonical registry; file itself declares it is presentation-only | **DISPLAY ONLY** |
| 5 | File-plane « Livré » is reachable by hand (`IN_PROGRESS → DELIVERED`, guard exists only on CLOSED) while transport is NOT_STARTED and the process sits at step 2 — 00009 demonstrates it live | **GOVERNANCE — ruling required** (the two-plane split is ratified; whether DELIVERED should require transport/process evidence is not yet ruled) |
| 6 | Historical: 00003/00004 carry step 3 COMPLETED with step 2 open — unreachable via `submitStep` today; provenance not yet audited | **PROCESS DEFECT (historical)** — separate audit already flagged |

## Genuine contradictions found: **one**

Step 1's department: roadmap/candidate say OPERATIONS; the canonical registry
says TRANSIT (provisional, citing the Guide's T1). **BUSINESS RULING REQUIRED.**

## Business rulings still required

1. Step 1 / QUOTATION_MANAGER department (OPERATIONS vs TRANSIT).
2. Drift #5 — should file-plane DELIVERED require delivery evidence, or remain
   a free operator transition until CLOSED?
3. (Confirmatory only) ADMINISTRATIVE_OFFICER + COURIER → FINANCE: the
   ratified doctrine matches the registry's provisional mapping — a one-line
   confirmation would let the PROVISIONAL markers be removed.

## Required fixes (none blocking; all previously identified)

- Ghost role labels (drift #1) — correct `assigned_role_code` display to the
  owning-role source.
- Prerequisite message naming the first actionable step (drift #2).
- Stale registry comment (drift #3).

## Optional UX improvements

- Surface the parallel activities in the official-process screen's progress
  counter footnote (explaining 29 vs 26).
- Show « transmission » as an explicit labelled act between steps 3 and 4 in
  the timeline UI so the roadmap's mental model and the screen agree.

## Exact final recommended workflow text

The candidate v2 text stands **with two edits**:

1. Replace "the Operations → Transit transmission is a governed handoff that
   closes Step 3" with: **"Step 3 is closed by the Account Manager's
   submission. The Operations → Transit transmission is a separate governed
   act (permission-gated, blocker-checked, idempotent) that requires Step 3 to
   be complete and precedes Step 4's reception. It may be performed by the
   Coordinateur, the Account Manager, or any transmission-authorized seat."**
2. Step 1's department line becomes: **"Department: pending business ruling
   (OPERATIONS per roadmap; TRANSIT per the canonical registry's provisional
   reading of the Guide)."**

**FINAL VERDICT: MATCH WITH CORRECTIONS.**
