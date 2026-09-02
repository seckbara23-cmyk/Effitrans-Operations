# Departmental roadmap ↔ built Effitrans process — mapping

**Date:** 2026-09-02 · Read-only comparison. Source of truth on the built side:
`lib/process/effitrans-process.ts` (EFFITRANS_PROCESS, 26 steps),
`process_step_owning_role` (authorization), MAKER_CHECKER_PAIRS,
PARALLEL_ACTIVITIES — the ladder C-4 certified end-to-end in CI (92/92,
Creation→Closure).

## Verdict up front

**26 of 26 steps match, in order, including the join gate and both named
maker≠checker controls.** The differences are: one step whose *boundary* sits
differently (roadmap step 4), one role label that is documentary rather than
real (step 2), one control the platform enforces that the roadmap doesn't name
(steps 18/19), one join the platform adds (step 11), and three parallel AM
activities the platform tracks that the roadmap omits. Nothing in the roadmap
contradicts the built machine.

## Step-by-step

| # | Roadmap | Built step key | Dept (built) | Role (authorization) | Match |
|---|---|---|---|---|---|
| 1 | Cotation / skip | `cotation` | cotation | QUOTATION_MANAGER¹ | ✅ incl. governed skip (« Sans devis », QO-1) — 00009: SKIPPED ✅ |
| 2 | Réception et affectation — Responsable des Opérations | `operations_intake` | operations | **OPS_SUPERVISOR** (label says OPERATIONS_MANAGER — see D2) | ✅ — 00009: current |
| 3 | Ouverture et préparation — Account Manager | `am_dossier_opening` | account_management | ACCOUNT_MANAGER | ✅ — and « Ouleye Diop » **is** the AM seat holder on 00009 (`operations@operations.com`), also its Responsable client |
| 4 | Coordination / Transmission au Transit — **Coordinateur (Operations)** | — | — | — | ⚠ **D1: boundary differs.** Built has no Operations-Coordinateur transmit step: the transmission IS the governed act that closes step 3 (`handDossierToTransit`, `process:handoff:send`), and built step 4 is the **Transit-side reception** |
| 5 | Réception Transit & affectation — Chef de Transit | `coordinator_reception` (4) **+** `transit_declarant_assignment` (5) | transit | CHIEF_OF_TRANSIT | ✅ split in two on purpose: reception (the C-2 reception invariant — receiving is an act) and déclarant assignment are separate audited acts |
| 6 | Préparation douanière — Déclarant | `customs_preparation` | customs_declaration | CUSTOMS_DECLARANT | ✅ |
| 7 | Validation — Chef de Transit, cannot self-validate | `transit_validation` | transit | CHIEF_OF_TRANSIT | ✅ maker≠checker pair **enforced structurally** (PG-6: preparer never holds `customs:validate`; engine refuses identity match) |
| 8 | Transmission pour enregistrement — Coordinateur | `coordinator_to_finance` | coordination | COORDINATOR | ✅ |
| 9 | GAINDE — **FINANCE**, Customs Finance Officer | `gainde_registration` | **finance_customs** | CUSTOMS_FINANCE_OFFICER | ✅ exactly as noted: customs chain, Finance organization. Platform even distinguishes « Chargé finance douane » from « Chargé finance » (they share no permissions) |
| 10 | Retour au Déclarant — Coordinateur | `coordinator_to_declarant` | coordination | COORDINATOR | ✅ |
| 11 | Introduction GAINDE/ORBUS — Déclarant | `gainde_document_submission` | customs_declaration | CUSTOMS_DECLARANT | ✅ + **built is stricter**: explicit JOIN prerequisite on BOTH 9 and 10 |
| 12 | Suivi douanier (circuit vert/orange/rouge) — Coordinateur | `customs_followup` | coordination | COORDINATOR | ✅ |
| 13 | BAE / Mainlevée — Agent de Terrain | `customs_field_clearance` | customs_field | CUSTOMS_FIELD_AGENT | ✅ BAE reference recorded; governed release |
| 14 | Préparation transport 🔀 parallel | `transport_assignment` | transport | TRANSPORT_OFFICER | ✅ own parallel group (`transport_readiness`), runs beside the customs chain |
| 15 | **JOIN GATE** 13+14 → Enlèvement | `pickup` | pickup | PICKUP_AGENT | ✅ the join is **encoded**: `prerequisites: [customs_field_clearance, transport_assignment]` — exactly your diagram |
| 16 | Suivi de livraison — Account Manager (Operations) | `am_delivery_followup` | account_management | ACCOUNT_MANAGER | ✅ incl. your distinction: Transport moves the goods, AM owns the customer follow-up (the delivery capability was ratified through its own test) |
| 17 | POD / BL signé — Coordinateur | `transport_pod_handoff` | coordination | COORDINATOR | ✅ POD enters as a document whose **verification** is the independent check; verified delivery note auto-records POD_RECEIVED on the transport plane |
| 18 | Contrôle de complétude — Coordinateur | `coordinator_completeness` | coordination | COORDINATOR | ✅ |
| 19 | Validation finale avant facturation — Account Manager | `am_completeness` | account_management | ACCOUNT_MANAGER | ✅ + **built adds a control the roadmap doesn't name**: 18→19 is the third maker≠checker pair — the Coordinateur's completeness is validated by a different pair of eyes |
| 20 | Préparation facture — Billing Officer | `billing_draft` | billing | BILLING_OFFICER | ✅ |
| 21 | Validation & émission — Finance Officer, maker≠checker | `finance_invoice_validation` | finance | FINANCE_OFFICER | ✅ pair enforced; immutable invoice artefact |
| 22 | Envoi facture — Billing Officer | `billing_dispatch` | billing | BILLING_OFFICER | ✅ (positive send path operator-verified — no email test seam) |
| 23 | Préparation du dépôt — Administrative Officer | `administration_deposit_prep` | administration | ADMINISTRATIVE_OFFICER | ✅ |
| 24 | Dépôt physique — Coursier | `courier_deposit` | courier | COURIER | ✅ custody events on their own plane (`invoice_deposit_event`) |
| 25 | Validation du dépôt — Administrative Officer | `administration_proof_handoff` | administration | ADMINISTRATIVE_OFFICER | ✅ |
| 26 | Recouvrement — Collections Officer → Closure | `collections` | collections | COLLECTIONS_OFFICER | ✅ + ratified nuance: step 26 completes only after **verified** payment and balance 0, and **closure is a separate supervisory act owned by Operations, not Recouvrement** (your "Step 27" in CEO numbering) |

¹ `process_step_owning_role` is the authorization source; the definition's
`role` field is documentary (see D2).

## The divergences, honestly stated

**D1 — Roadmap step 4 (Operations Coordinateur transmits) has no counterpart
step.** In the built model, transmission to Transit is not a step someone
completes — it is the governed **handoff act** that closes step 3
(`sendHandoff(am_dossier_opening → coordinator_reception)`, guarded by
`process:handoff:send`, idempotent, audited, blocked by open intake blockers).
Built step 4 is the *Transit-side* reception by the Chef de Transit, and
receiving is itself an act (the reception invariant: promotion opens a step,
reception starts it). Your steps 4+5 and built steps 4+5 cover the same ground
with the cut in a different place: roadmap cuts at *transmit | receive+assign*,
platform cuts at *receive | assign* with transmit folded into step 3's close.
Same actors, same order, same evidence — numbering re-synchronizes at step 6.
The COORDINATOR seat first acts at step 8 in the built model.

**D2 — Step 2's role label is a ghost.** Execution rows display
`OPERATIONS_MANAGER`, a role that exists nowhere (0 holders, no template).
Authorization actually flows from `process_step_owning_role` →
**OPS_SUPERVISOR** (« Superviseur opérations », 9 holders). Blocks nothing —
« Responsable des Opérations » in your roadmap = OPS_SUPERVISOR in the
platform. The display string deserves its own small fix.

**D3 — Department granularity.** The roadmap's four departments roll up the
platform's finer functions: 🟦 OPERATIONS = {cotation, operations,
account_management, coordination(¹⁶⁻¹⁹), pickup?}, 🟨 TRANSIT = {transit,
customs_declaration, coordination(⁸,¹⁰,¹²), customs_field}, 🟩 TRANSPORT =
{transport, pickup}, 🟪 FINANCE = {finance_customs, billing, finance,
administration, courier, collections}. The only seat that sits in two roadmap
departments is the **Coordinateur** (Transit phase at 8/10/12, Operations phase
at 17/18) — the platform models coordination as one function; your org chart
splits it by phase. No conflict, but worth deciding which department the
Coordinateur reports to before HR org data and process metadata are ever
joined.

**D4 — The platform tracks three parallel AM activities the roadmap omits**:
« Bon à Délivrer » (carrier), « Pre-Gate » (terminal), and transport-docs
transmission — run by the Account Manager concurrently with the customs chain
(this is why a dossier carries 29 execution rows, not 26). They gate nothing in
your list but exist on the record.

**D5 — Two joins, not one.** Your diagram encodes the 13+14→15 join gate; the
platform also enforces 9+10→11 (the déclarant may not introduce documents
until GAINDE registration **and** the coordinator's return both landed). Your
linear 9→10→11 is satisfied by it — the platform is merely stricter.

## Where EFT-IMP-2026-00009 sits on this map

Exactly where the pilot audit found it: step 1 SKIPPED ✅ (as your roadmap
records), step 2 **current** (awaiting an OPS_SUPERVISOR submit — no documents
required), step 3 next (Ouleye Diop; needs BORDEREAU_LIVRAISON + three
declarable-absent motifs), then the step-3-closing handoff replaces your
step 4, and the Chef de Transit receives at built step 4.
