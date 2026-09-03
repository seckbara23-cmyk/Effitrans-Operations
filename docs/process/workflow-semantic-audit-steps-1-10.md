# WORKFLOW SEMANTIC AUDIT — official steps 1–10

**Date:** 2026-09-03 · **Mode:** audit / discovery only · **Baseline:** `dcca27c` (production READY, CI 33811619835 green).
**Nothing implemented, no migration, no production data touched, EFT-IMP-2026-00009 untouched.**
The UAT-00009 diagnostic fix (`4672b01`, `dcca27c`) is valid and is **not** in question here; this audit asks whether the *business rules* it now explains are the right rules.

Evidence labels: **PROVEN** (read from source / migration / test) · **RATIFIED** (a recorded decision) · **INFERRED** (reasoned from evidence, not stated anywhere) · **SUSPECT** · **RULING REQUIRED**.

---

## A. Executive verdict

**Steps 1–10 are moderately over-constrained in one place and incorrectly assigned in two.**

* **Over-constrained:** the Operations → Account Manager seam. Step 3 cannot even *appear* in the Account Manager's queue until step 2 is submitted, and step 2 is an administrative click with no evidence behind it (`requiredDocuments: []`, its `completionRule` is prose the engine never reads). Step 3 then demands four documents, three of which Transit never reads and one of which belongs to a lane that starts at step 14. The one thing that must stay strict — the 3→4 transmission — is strict; the strictness *upstream* of it is what the UAT tripped on.
* **Incorrectly assigned:** `SPENDING_AUTHORIZATION` sits under the Account Manager at step 3 while the platform's real « Autorisation de dépense » is a Finance entity with a seven-visa chain the Account Manager cannot even open; and « cotation » is wired into Transit's T1 stage, its queue and its role's department by three explicitly *PROVISIONAL* mappings that contradict both DEC-C32 and the clarified business position.
* **Appropriately governed:** steps 4–10, the customs chain. Explicit reception, a maker-checker validation whose preparer can never hold the validating permission, a Finance-only GAINDE milestone, and a second governed handoff. None of it should be loosened.

The dossier itself is already a living record in the code: no step or status locks a field, documents can be uploaded and verified at any stage, and the owner and Account-Manager seats are re-assignable with audited before/after. Two gaps keep it from fully honouring the ratified principle: the general edit audit keeps *no previous values*, and the Operations Supervisor holds no `file:update` at all.

---

## B. Step-by-step matrix (1–10)

Sources: `lib/process/effitrans-process.ts` (registry), `process_step_owning_role` (migrations `20260914000001`, `20260917000001` — the **authoritative** owning role), `lib/process/engine/state.ts` (state machine), `lib/process/engine/promote.ts` (promotion), `lib/process/engine/actions.ts` (activate/submit/handoff), `lib/process/engine/evidence.ts` (evidence), `lib/process/applicability.ts` (scope), `lib/process/queues/registry.ts` (UI queues).

Engine facts that apply to every row (PROVEN):
* A step reaches `AVAILABLE` only by promotion when **all** its prerequisites are terminal-done (`promoteSuccessors` → `prerequisitesMet`), by explicit handoff reception, or — for `operations_intake` alone — by the entry-step exception. `activateStep` refuses `prerequisites_unmet`. **Work cannot begin before predecessors complete**, for every step here.
* Completion of a step freezes **nothing** on the dossier: no engine path writes `operational_file` except `openDossierWorkflow` (`DRAFT → OPENED`), and no document action reads the step ladder.
* Only `permissions[0]`, `prerequisites` and `requiredDocuments` are executable. `role`, `requiredEvidence`, `completionRule` are documentary (memory `registry-role-field-documentary`; integrity audit R-4).
* Every completion writes `process_step_execution` (actor, timestamps) plus an `audit_log` row; later dossier edits are audited by `updateFile` **without** previous values (see §F).

| # | key | French label | Owning role (authoritative) / registry `role` | Dept | Prereqs | Required evidence (executable) | Advisory | Blockers | Handoff | UI | Permission | Downstream |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `cotation` | Service Cotation — établir et faire valider le devis | QUOTATION_MANAGER / `COTATION_OFFICER` (ghost) | `cotation` → mapped **TRANSIT (PROVISIONAL)** | — | QUOTATION, QUOTATION_APPROVAL — but the step is **SKIPPED by default** with a derived reason (QO-1) | — | — | no | `/queues/cotation`; « Origine commerciale » on the dossier | quotation:create/send/approve | step 2 prerequisite; satisfied by SKIPPED |
| 2 | `operations_intake` | Responsable des Opérations — réception et affectation | OPS_SUPERVISOR / `OPERATIONS_MANAGER` (ghost, 7th sighting) | operations | cotation | **none** | `requiredEvidence: account_manager_id, assignment_actor, assignment_date` — not read | none | no | `/queues/operations`; « Ouvrir le dossier » activates it, never completes it | file:assign | promotes step 3 |
| 3 | `am_dossier_opening` | Account Manager — ouverture et préparation du dossier | ACCOUNT_MANAGER | account_management | **step 2** | TRANSPORT_REQUEST · BORDEREAU_LIVRAISON · VENDOR_INVOICE · SPENDING_AUTHORIZATION, each **APPROVED** (`isVerified`) or declared absent (3 of 4 declarable, **no UI**) | file_number, client_acknowledgment_sent, vendor_invoices_verified — not read | intake blockers (MISSING_DOCUMENT / CUSTOMER_RESPONSE_REQUIRED) block the *handoff*, not the step | **from-step of 3→4** | `/queues/account_management` (invisible while PENDING) | file:create | promotes 4 **and 14** (transport lane); D-2 gate for transmission |
| — | `handDossierToTransit` | Transmettre au Transit | any `process:handoff:send` holder | — | step 3 done + no blocking blocker | — | — | — | **sends 3→4** | dossier page + process screen | process:handoff:send | opens Transit's queue |
| 4 | `coordinator_reception` | Chef de Transit — réceptionner le dossier transmis | CHIEF_OF_TRANSIT (+OPS_SUPERVISOR oversight) / `CHIEF_TRANSIT` (ghost) | transit (RATIFIED 2026-08-23) | step 3 | none | reception_confirmed_by/at | — | **receives**; `handoff_reception_required` at activate and submit | `/queues/transit` (RECEIVING) | process:handoff:receive/send | promotes 5 |
| 5 | `transit_declarant_assignment` | Chef de Transit — affectation du Déclarant | CHIEF_OF_TRANSIT | transit | step 4 | none (assignment RPC, append-only `assignment_event`) | declarant_id | — | no | `/queues/transit` | customs:assign | promotes 6 |
| 6 | `customs_preparation` | Déclarant — préparer le dossier de dédouanement | CUSTOMS_DECLARANT | customs_declaration | step 5 | CUSTOMS_DOSSIER (structured `customs_record`); constituent documents gated by `document_type.gates_customs` | — | CUSTOMS_OBSERVATION | no | `/queues/customs_declaration` | customs:create/update | **maker** of 6→7 |
| 7 | `transit_validation` | Chef de Transit — vérifier et valider le dossier douane | CHIEF_OF_TRANSIT | transit | step 6 | CUSTOMS_DOSSIER; **distinct actor** (`self_validation_forbidden`; PG-6: preparer never holds `customs:validate`) | validated_by/at | — | no | `/queues/transit` (REVIEWING) | customs:validate | rejects → 6 with structured reason |
| 8 | `coordinator_to_finance` | Coordinateur — transmettre à la Finance | COORDINATOR | coordination (→ OPERATIONS) | step 7 | none | handoff_sent_at | — | prerequisite promotion (no explicit sender) | `/queues/coordination` | process:handoff:send | promotes 9 |
| 9 | `gainde_registration` | Finance (fonction douane) — enregistrer dans GAINDE | CUSTOMS_FINANCE_OFFICER | finance_customs (→ FINANCE) | step 8 | GAINDE reference non-empty (`customs_record.external_ref`) + GAINDE_REGISTRATION_EVIDENCE upload; reconciliation reads the **Finance** milestone only (MAYA-P1.2) | registration_date/by | — | **sends 9→10** | `/queues/finance_customs` | customs:register | promotes 10 and (join) 11 |
| 10 | `coordinator_to_declarant` | Coordinateur — retourner au Déclarant | COORDINATOR (+CUSTOMS_DECLARANT receives) | coordination | step 9 | none | handoff_sent_at | — | **receives 9→10** | `/queues/coordination` | process:handoff:send | join with 9 → 11 |

Scope (PROVEN, `lib/process/applicability.ts`): steps 5–10 apply to IMP/EXP only; steps 1–4 apply to every dossier type. The applicability machinery is **dormant** (zero callers — memory `service-scope-audit`), so a TRP dossier today still materialises the customs steps.

### Editability across the matrix (§17–19 of the brief, PROVEN)

| Stage | Dossier fields editable? | Locked? | By whom | Audit |
|---|---|---|---|---|
| any status incl. CLOSED | yes — `updateFile` has **no status check** | none | `file:update` = SYSTEM_ADMIN, ACCOUNT_MANAGER, COORDINATOR. **Not OPS_SUPERVISOR** | `FILE_UPDATED` with `after: {type, client_id}` only — **no previous values, no shipment diff, no reason** |
| status ladder | DRAFT→OPENED→IN_PROGRESS→DELIVERED→CLOSED, forward only | terminal at CLOSED | `file:transition` | `file_state_transition` keeps from/to/actor/note |
| documents | upload/verify/reject at any status | none | document:create / document:approve (uploader ≠ verifier) | `DOCUMENT_UPLOADED/VERIFIED/REJECTED`; rejection reason code mandatory |
| replacing a verified document | **not reachable**: re-upload creates a new row; `supersede_document` RPC exists (WES-4) with **no app caller** | — | — | — |
| process owner | re-assignable | none | process:owner:assign | before/after + reason |
| Responsable client (AM seat) | re-assignable | none | file:assign:commercial | before/after + reason_code |
| skipped step | reopenable | — | process:step:skip | reason mandatory |

---

## C. Operations → Account Manager → Transit analysis

### C.1 What actually blocks, and where (PROVEN)

1. **Step 3 is invisible and un-startable until step 2 is terminal-done.** `am_dossier_opening.prerequisites = ["operations_intake"]`; `promoteSuccessors` promotes only when `prerequisitesMet`; queues list `OPEN_STATES ∪ handoff targets`, never bare PENDING. So the Account Manager's queue shows nothing for a dossier whose supervisor has not pressed « Terminer » on step 2.
2. **Step 2 carries no evidence.** `requiredDocuments: []`; `completionRule: "account_manager_assigned"` is not enforced (integrity audit R-4). « Ouvrir le dossier » already assigns the canonical Operations owner, and the Account-Manager seat is designated by `assignCommercialOwner` — both audited facts recorded *independently of* step 2's submission. Step 2's submission is therefore a click that certifies a fact the platform already holds.
3. **Uploading and verifying is not blocked by the ladder.** `uploadDocument` gates on `document:create` + file visibility; verification on `document:approve` with uploader ≠ verifier. The UAT narrative — AM prepares and uploads, Supervisor reviews and verifies — is *already possible and already governed* at the document plane, regardless of steps 2–3.
4. **Completing step 3 requires four APPROVED documents** (or declarations, which have no UI). The customs chain (4–13) reads **none** of them: its evidence is `CUSTOMS_DOSSIER`, GAINDE references, BAE, and the `gates_customs` documents (BL, commercial invoice, packing list…). `BORDEREAU_LIVRAISON` is read again only at `transport_docs_transmission` / pickup (`gates.ts:67`, registry line 968).
5. **Transmission is refused until step 3 is done** (D-2 at the call site, C-2 generically in `sendHandoff`).

### C.2 Is the 2→3 dependency technical or ratified?

* The **engine mechanism** (prerequisites gate promotion) is technical and generic — C-1/D-1, PROVEN.
* The **declaration** `prerequisites: ["operations_intake"]` comes from the Phase 5.0A registry, sourced from the numbered *PROCESSUS OPÉRATIONNEL – EFFITRANS* (INFERRED: numbering was read as dependency). No decision in `docs/decision-register.md` ratifies "the Account Manager may not begin before the Supervisor submits intake" as a control. **Not separately ratified.**
* **D-2 (2026-08-24, `step3-routing-diagnosis.md` §C RC-2)** is a different rule and *is* ratified "from the canon": the 3→4 transmission must follow step 3's completion, because step 4's prerequisite is step 3 and an early send manufactured a deadlock (Transit held a dossier it was forbidden to work). C-2 generalised it to every handoff. **D-2/C-2 say nothing about 2→3.**

### C.3 Does the engine support overlap?

Yes (PROVEN): parallel groups exist (`customs` ∥ `transport_readiness`; step 14 opens from step 3 while 4–13 run), any number of steps may be ACTIVE, and there is no single-active constraint. Letting step 3 open alongside step 2 is a **registry/opening-path change, not an engine change**, with one subtlety: a step with no prerequisite still needs an opener — either the closed `ENTRY_STEP_KEYS` list gains `am_dossier_opening`, or « Ouvrir le dossier » promotes it directly (it already promotes step 2).

### C.4 What would have to change if parallel preparation is ratified (NOT done)

* Registry: `am_dossier_opening.prerequisites` — drop `operations_intake`, or make step 2 a *fact-completed* step (its completion derived from the recorded assignment, the R-4 direction) so the ladder stays linear but the click disappears.
* Opening path: `openDossierWorkflow` promotes step 3 as it promotes step 2 (or `ENTRY_STEP_KEYS` widens by one key).
* Keep: step 4's prerequisite on step 3; D-2/C-2; reception.
* Tests that would fail and must be re-ratified in place: `successor-promotion.test.ts:107–111`, `process-registry.test.ts`, `handoff-diagnostics.test.ts` (first-actionable derivation would then point at step 3 — correct), the C-4 journey harness (walks 2 then 3).
* Diagnostic: `firstActionableStepFor` needs no change — it derives from whatever the graph says.

### C.5 Is Supervisor verification the real control point?

It already is, at the document plane: `document:approve` with maker-checker (uploader ≠ verifier). Step 2's click adds no control the platform does not already hold. **INFERRED, for ruling:** the control Effitrans wants is « the Supervisor verified what the AM assembled » — which is document verification — followed by « Operations formally hands the dossier to Transit » — which is the 3→4 transmission. Both exist. The step-2 click sits between them certifying nothing.

---

## D. Misplaced responsibilities

### D.1 `SPENDING_AUTHORIZATION` — **E (wrong owner and stage)**, per the new ruling

| Where | Evidence |
|---|---|
| Defined | `document_type` row, migration `20260714000001` line 59: `'Autorisation de dépense'`, category **financial**, `required_for '{}'`, `conditional true` |
| Mapped | `lib/process/documents.ts:79–84`, `steps: ["am_dossier_opening"]`, note "Zero occurrences repo-wide. Never customer-visible." |
| Required | registry step 3 `requiredDocuments` (`effitrans-process.ts:119`) — the **only** step referencing it |
| Declarable absent | `evidence-absence.ts:20`; migration `20260915000001` CHECK — but **no operator UI** |
| UI surfaces | none specific; generic document upload (type list) and the evidence refusal in the queue |
| Permissions | none of its own |
| The real « Autorisation de dépense » | Phase 11.0B/C `expense_authorization` + seven-visa chain **DEC-C08**: Demandeur → Chef Transit → Coordonnateur → Opérations → Trésorière → DAF → DG (`lib/finance/expense/types.ts:181–187`); created under `finance:expense:create`, held by **FINANCE_OFFICER and SYSTEM_ADMIN only** — the Account Manager cannot raise one |
| Provenance of the step-3 placement | `docs/workflow/effitrans-business-workflow.md` §2 step 3 / §3.3: the AM "collects … spending authorization" as a *received document* — a description of paperwork flow, not a ruling that the AM authorises spending |
| ICAM | counted as **NAD** (autorisations de dépense) against the `expense_authorization` chain, not the document type (`platform-data-source-map.md:59`) |

**Finding (PROVEN + RATIFIED-by-brief):** two objects carry the same French name. The *entity* is Finance's and is governed; the *document type* is an unverified upload slot with no consumer other than step 3's gate. Requiring the upload from the AM before Transit reception enforces a Finance act at the wrong stage under the wrong role. Where it belongs, if anywhere on the dossier: as a **consequence** of the Finance chain (a `SPENDING_AUTHORIZATION` document could be the *generated artefact* of an APPROVED `expense_authorization`, on the WES-4G pattern), read at step 18 completeness or by Finance — **RULING REQUIRED (H-3)**.

### D.2 `VENDOR_INVOICE` — **D (conditional) + E (stage)**, suspect, not ruled

| Facet | Evidence |
|---|---|
| Catalogue | `'Facture tierce payable'`, category **financial**, `required_for '{}'`, `conditional true` |
| Who receives it | third-party (vendor) invoices payable *for the client* — débours; they arise as services are consumed across the dossier's life, not at opening (INFERRED from the label and the "no accounts-payable model" note) |
| AM's ratified role | **ICAM-1 NFACT = verified `VENDOR_INVOICE` documents**, an Account-Manager performance term ("factures fournisseurs contrôlées", AM-S01) — the AM *controls* them (RATIFIED, `icam-slice2-rulings-reconciliation.md:62`) |
| Does Transit need it | no consumer in steps 4–13 (PROVEN) |
| Finance | Finance is scoped "no supplier bills"; no AP model; the invoice is a *client-rebillable cost* |
| Later arrival | nothing prevents upload later; the only thing that prevents *progress* is step 3's gate |
| Current placement | universal, at step 3, before Transit — **misplaced by stage** |

**Finding:** the Account Manager plausibly owns the *control* of vendor invoices (ICAM), but "before Transit starts" is the wrong moment. Candidates: step 18/19 completeness (Coordinator/AM), or a continuous requirement checked at billing readiness — **RULING REQUIRED (H-4)**.

### D.3 `TRANSPORT_REQUEST` — **D (conditional on transport scope)**, possibly duplicative

* Catalogue `'Demande de transport'`, category transport, `conditional true`. Registry step 3 only. Declarable.
* MAYA-P1.10: an inbound document the AM *collects*; the permission `transport:request` has zero consumers.
* The transport plane also has `DEMANDE_TRANSPORT` as a **generated artefact** and step 14 `transport_assignment` opens from step 3 in parallel.
* On a customs-only dossier it is R1d of the service-scope audit — **RULING REQUIRED (H-5)**, and only meaningful once scope exists.

### D.4 `BORDEREAU_LIVRAISON` — **C for the pickup lane; E as a Transit-handoff prerequisite**

* Meaning is settled and must not be reinterpreted: the **unsigned operational delivery slip** (5.0D split; `DELIVERY_NOTE` is the signed POD).
* Non-declarable (RATIFIED, C-3).
* Consumers: `transport_docs_transmission` (registry line 968) and the pickup gate (`gates.ts:67`) — i.e. **step 15's lane**, not Transit's clearance. Nothing in 4–13 reads it.
* Finding: it is genuinely hard **for pickup**; as a *precondition of transmitting to Transit* it is inherited. **RULING REQUIRED (H-6):** keep it hard, but at which gate.

### D.5 Cotation / T1 — **E (placement) + wording defects**, RULING REQUIRED

PROVEN facts:
* Step 1 is already optional: `openDossierWorkflow` skips it with a **derived** reason — « Devis N° … accepté » when a converted quotation exists, else « Ouverture directe — dossier sans devis » (QO-1, RATIFIED 2026-08-18). « Sans devis » waives nothing. **Consistent with the clarified business position.**
* Three explicitly **PROVISIONAL** mappings put cotation under Transit: `ROLE_CANONICAL_DEPARTMENT.QUOTATION_MANAGER = "TRANSIT" // PROVISIONAL — cotation is Chef de Transit's step T1 in the Guide`; `QUEUE_DEPARTMENT_TO_CANONICAL.cotation = "TRANSIT" // PROVISIONAL`; `TRANSIT_SOURCE_MAP.T1 = { "Réception, vérification sommaire et cotation", stepKeys: ["cotation", "coordinator_reception"] }`.
* `TRANSIT_STAGES.T1` keeps the label but maps only `coordinator_reception`; the Transit source table (`phase-9.0d-transit-execution.md` §3) lists T1 the same way.
* **T5** reads « Contrôle, validation et signature **du devis** » while mapping `transit_validation` — the customs-dossier maker-checker step. « devis » there is a wording defect on a customs control.
* **DEC-C32 (RATIFIED 2026-08-06)** says quotation agents prepare and the **Operations Manager/Supervisor validates** (`quotation:validate` = OPS_SUPERVISOR only). That places the *commercial* cotation under Operations supervision — not Transit.
* Registry step 1 `role: "COTATION_OFFICER"` is a ghost label; the owning role is `QUOTATION_MANAGER`; department `❓(ruling)` in the final reconciliation.

INFERRED (not proven): the Transit Guide's « cotation » in T1 most likely denotes Transit's own **clearance cost estimate** on receipt of a dossier — a different act from the commercial devis — which the 9.0D mapping conflated with registry step 1. Nothing in the repository records such an act or its evidence.

**Alternatives for ruling (not chosen):**
1. T1 becomes « Réception et vérification sommaire » — cotation leaves Transit's stage map; QUOTATION_MANAGER and the `cotation` queue re-home under OPERATIONS per DEC-C32; step 1 stays optional as today.
2. T1 keeps « cotation » but *defined* as Transit's clearance estimate, distinct from the commercial devis — then it needs its own evidence and step, which do not exist.
3. Status quo with the provisional markers left in place — recorded here as the least defensible, since it contradicts a ratified decision.

### D.6 Other placements found

* `operations_intake.role = "OPERATIONS_MANAGER"` — a role with zero holders and no template; the authoritative owner is OPS_SUPERVISOR. Display-only ghost (7th sighting). Fix in the registry-clarification slice (C-6), not here.
* Two first-party documents still disagree on AM transmission direction (Quality Manual: AM → Opérations; registry: Opérations → AM → Transit) — memory `maya-p07c-qc2-account-manager`; unresolved, bears on H-1.

---

## E. Transit handoff minimum

**What `handDossierToTransit` requires today (PROVEN):**

| Requirement | Class |
|---|---|
| engine + tenant intake flags on; `process:handoff:send`; file visible | A — technically required (platform) |
| process instance exists (dossier « ouvert ») | A |
| no OPEN/ACKNOWLEDGED blocker in MISSING_DOCUMENT / CUSTOMER_RESPONSE_REQUIRED | **B — ratified** (Phase 9.0C: "an incomplete dossier does not travel") |
| step 3 terminal-done (D-2, C-2) | **B — ratified from the canon** (2026-08-24) *as a sequencing rule* |
| ⇒ step 2 terminal-done | **C — inherited** (registry numbering) |
| ⇒ TRANSPORT_REQUEST approved/declared | **D — belongs to the transport lane (14)** / E — safe later |
| ⇒ BORDEREAU_LIVRAISON approved | **D — belongs to pickup (15)** / E — safe later for Transit |
| ⇒ VENDOR_INVOICE approved/declared | **D — belongs to completeness (18/19)** / E — safe later |
| ⇒ SPENDING_AUTHORIZATION approved/declared | **D — belongs to Finance** / E — safe later |
| explicit reception by Transit before work starts | **B — ratified** (C-4 Option 1) |

**What is NOT required, and is striking (PROVEN):** the documents Transit actually works from — those flagged `document_type.gates_customs` (BL, commercial invoice, packing list, …) — are **not** a transmission prerequisite. They are gated later, at step 6, through `CUSTOMS_DOSSIER`. ETA, origin/destination, transport mode, client contract, Responsable-client identity and the transport record are likewise not required. So today's gate demands four documents Transit does not use and none of the ones it does.

**Proven business minimum for the 3→4 transmission:** an opened dossier, no blocking intake blocker, an explicit send and an explicit reception. Everything else in the current gate is inherited or belongs downstream. Whether « readiness for Transit » should *add* a customs-document check is **RULING REQUIRED (H-2)** — it would be a new control, not a restoration.

---

## F. Dossier leniency findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| F-1 | The Operations Supervisor **cannot edit dossier data** — OPS_SUPERVISOR holds no `file:update` (nor `file:create`). Editors are SYSTEM_ADMIN, ACCOUNT_MANAGER, COORDINATOR. | PROVEN | `lib/platform/role-templates.ts` lines 86/184/207 vs block 355–406 |
| F-2 | Edits are audited **without previous values**: `FILE_UPDATED.after = {type, client_id}` only; shipment fields (origin, destination, incoterm, cargo…) are overwritten with no before/after and no reason. `audit_log` *has* a `before` column — unused here. | PROVEN | `lib/files/actions.ts:238–246`; `lib/audit/log.ts` |
| F-3 | No status or step locks any field; a CLOSED dossier is editable by the same permission. Lenient — but with F-2 it is lenient *without* history. | PROVEN | `updateFile` has no status read |
| F-4 | ETA cannot be entered by hand: `shipmentRow` carries no `eta`; only the air-intelligence sync writes it. « ETA non renseignée » is unresolvable from the dossier form. | PROVEN | `lib/files/actions.ts shipmentRow`; `lib/air/intelligence/*` |
| F-5 | Step 3 is invisible to the AM until step 2 is clicked (PENDING never listed). The practical UAT block. | PROVEN | queues list OPEN_STATES only |
| F-6 | Declared absence (C-3) has **no UI**; three of step 3's documents can be waived only from code. | PROVEN | `declareEvidenceAbsence` callers = journey tests only |
| F-7 | Replacing a verified document is not reachable: re-upload creates a new row; `supersede_document` RPC has no caller; a later rejection does not reopen a completed step. | PROVEN | `lib/documents/actions.ts`; migration `20260727000003` |
| F-8 | Owner and Responsable-client seats are re-assignable with before/after + reason — the model the rest of the dossier should follow. | PROVEN | `assignProcessOwner`, `assignCommercialOwner` |
| F-9 | Downstream departments are **not notified** of dossier edits (no notification in `updateFile`). | PROVEN | — |
| F-10 | Editing does not invalidate evidence: evidence is evaluated live at submit; nothing re-opens a completed step. Acceptable for data; a business question for documents (F-7). | PROVEN | `submitStep` |

Verdict on the ratified principle: **editable operational record — largely yes; immutable audit history — partially.** The gaps are F-1 (who), F-2 (what was changed), F-4 (ETA), F-6/F-7 (documents).

---

## G. Governance controls to preserve (hard)

1. **3→4 explicit send and explicit reception** — D-2/C-2 sequencing and C-4 Option 1. The strict consequential handoff.
2. **Blocking intake blockers stop travel** (MISSING_DOCUMENT, CUSTOMER_RESPONSE_REQUIRED).
3. **6→7 maker-checker**: validator ≠ preparer; preparer never holds `customs:validate` (PG-6); rejection with structured reason.
4. **GAINDE registration is Finance's milestone**, reference non-empty, never the Declarant's fact (MAYA-P1.2).
5. **9→10 governed handoff + reception**; 11 joins on 9 and 10.
6. **Document verification**: an upload is not an approval; uploader ≠ verifier; rejection reason codes.
7. **BORDEREAU_LIVRAISON non-declarable** for the pickup lane; **DELIVERY_NOTE** stays the signed POD.
8. **Audited skip with mandatory reason**, reversible; no NULL-actor writes (RATIFY-OPSSEC2-2A).
9. **Tenant scoping and RLS**; portal exposure unchanged.
10. **Finance authorization chain** (DEC-C08) untouched; « Sans devis » waives nothing.

---

## H. Business rulings needed

| # | Ruling | Options on the table |
|---|---|---|
| **H-1** | May the Account Manager's preparation (step 3) begin before the Supervisor submits step 2? | (a) parallel — step 3 opens at « Ouvrir le dossier »; (b) step 2 becomes fact-completed from the recorded assignment; (c) keep sequential |
| **H-2** | What is « readiness for Transit »? Today: step 3's four documents. | (a) opened + no blocking blocker only; (b) plus the customs-gating documents present/verified (per scope); (c) keep as is |
| **H-3** | `SPENDING_AUTHORIZATION`: drop from step 3? Where does it live? | (a) remove from the dossier document set; the Finance entity is the fact; (b) keep as a generated artefact of an APPROVED authorization, read at 18; (c) keep at 3 (contradicts the brief) |
| **H-4** | `VENDOR_INVOICE`: when and by whom? | (a) AM control at 18/19 completeness; (b) continuous, checked at billing readiness; (c) keep at 3 |
| **H-5** | `TRANSPORT_REQUEST`: document or transport-plane fact? Conditional on transport scope? | (a) the transport record/order is the fact; drop the upload; (b) conditional document at 14; (c) keep at 3 |
| **H-6** | `BORDEREAU_LIVRAISON`: hard at pickup only, or also before Transit? | (a) pickup lane only; (b) both |
| **H-7** | Transit T1 wording and the cotation placement (see D.5 alternatives 1–3). | — |
| **H-8** | T5 « signature du devis » on the customs validation stage — relabel? | — |
| **H-9** | Should OPS_SUPERVISOR hold `file:update`? (and `file:create`?) | — |
| **H-10** | Edit audit: capture before/after for every dossier/shipment field; reason mandatory for which fields? | — |
| **H-11** | Should a C-3 absence declaration have an operator UI, and who may declare (AM? Supervisor?) | — |
| **H-12** | Should replacing a verified document be reachable (supersession), and does it reopen anything? | — |
| **H-13** | Explicit send/receive for the seventeen promotion-only transitions (C-4 R-1) — none in 1–10 except 8→9 by promotion; confirm 8→9 needs no explicit act. | — |
| **H-14** | The AM-transmission direction conflict between the Quality Manual and the registry (QC2). | — |

---

## I. Proposed target model (high-level, no code)

```
Client email / request  ──►  Operations receives
                                   │
                    « Ouvrir le dossier » — ONE act:
                    instance · Operations owner · Account-Manager seat
                                   │
              ┌────────────────────┴────────────────────┐
              │  Step 2 = the ASSIGNMENT FACT            │  Step 3 = AM preparation, OPEN AT ONCE
              │  (recorded by the opening act;           │  documents uploaded as they arrive;
              │   no separate click, or auto-complete)   │  declared-absent where ratified (UI)
              └────────────────────┬────────────────────┘
                                   │
                 Supervisor VERIFIES documents (document plane, maker-checker)
                                   │
                  ══ Transmettre au Transit — THE HARD GATE ══
                  readiness = opened + no blocking blocker
                            + (ruling H-2) customs-gating documents per scope
                  explicit send → explicit reception (unchanged)
                                   │
                  Steps 4–10 exactly as today (maker-checker, Finance GAINDE, 9→10)

Dossier fields stay editable throughout — every change audited with before/after,
reason where ruled sensitive, downstream notified where ruled.
The four AM documents move to their real stages:
  TRANSPORT_REQUEST → transport lane (14) or replaced by the transport fact
  BORDEREAU_LIVRAISON → hard at pickup (15) [already]
  VENDOR_INVOICE → completeness 18/19, AM control (ICAM NFACT)
  SPENDING_AUTHORIZATION → Finance chain; at most a generated artefact
```

Principle honoured: **allow the work + control the consequential handoff + keep the history.**

---

## J. Change impact map (if the target model is ratified — not implemented)

| Area | Likely change | Migration? |
|---|---|---|
| Process registry (`effitrans-process.ts`) | step 3 prerequisites; step 3 `requiredDocuments` reduced/moved; step 18/19 and 14 gain the moved requirements; T1/T5 labels (`transit.ts`, `lifecycle-map.ts`); step 1 `role`/dept ghost cleanup (C-6) | none — data lives in code |
| Owning roles / departments | `QUOTATION_MANAGER` dept and `cotation` queue re-home (remove PROVISIONAL); `process_step_owning_role` row for step 1 if re-homed | **one small migration** only if step 1's owning role row changes |
| Opening path | `openDossierWorkflow` promotes step 3 (or `ENTRY_STEP_KEYS` widens); optional fact-completion of step 2 | none |
| Readiness evaluator (`evaluateTransitHandoffReadiness`) | new rule set per H-2; scope-aware via `applicability.ts` once scope exists | none |
| Evidence | catalogue `steps` in `documents.ts`; possibly `document_type.required_for` / stage doctrine rows for the four types; SPENDING_AUTHORIZATION as WES-4G artefact if H-3(b) | migration only if `document_type` rows change |
| Engine | none for parallelism (already supported); a fact-completion rule for step 2 if H-1(b) | none |
| UI | queue visibility follows the registry; prerequisite wording follows the evaluator; **C-3 declaration surface** (H-11); edit form audit; supersession (H-12) | none |
| RBAC | `file:update` (and `file:create`?) for OPS_SUPERVISOR across the three grant sources (template, seed, migration — parity rule) | **one migration** for existing tenants |
| Audit | `updateFile` records before/after per field + reason (column exists) | none |
| Tests | `successor-promotion`, `process-registry`, `handoff-diagnostics`, `evidence-absence`, `operations-intake`, C-4 journey harness, role-template parity | — |
| Data | **no production repair**; in-flight dossiers recover through the UI as today | — |

---

## Constraint compliance

No code changed. No migration. No production data read or written in this session (the read-only probe remains blocked by the permission classifier). EFT-IMP-2026-00009 untouched. The DELIVERED / 1-of-26 divergence is referenced only for state semantics and is **not** used to explain the handoff failure — see `finding-dossier-status-vs-official-process.md`.
