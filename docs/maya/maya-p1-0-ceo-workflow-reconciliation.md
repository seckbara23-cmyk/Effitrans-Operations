# MAYA-P1.0 — CEO Workflow Reconciliation Audit

**Mode:** audit only. No application code, no schema, no migration, no workflow,
no permission, no QC, no CRUD change.
**Baseline verified, not assumed:** `cae8fff`, clean tree, in sync with
`origin/main`, 104 migration files, `MIGRATION_COUNT = 104`,
`LATEST_MIGRATION = "20260826000001_customs_editor_attribution"`, migrations
**103 and 104 both present on disk**, CI **#447** GREEN — build 10/0/0,
rls-tests 93/0/0.

---

## A. Executive verdict — three findings decide this phase

**1. The CEO workflow is already the platform's canonical process, at a coarser
granularity.** `lib/process/effitrans-process.ts` — sourced from « PROCESSUS
OPÉRATIONNEL – EFFITRANS » — defines 26 steps that map onto the CEO's 18 almost
one-for-one, in the same order, with the same owners. The CEO document is
explicitly a *« workflow simplifié »*; the registry is the detailed form of the
same process. **No new workflow engine, and no re-sequencing, is warranted.**

**2. The CEO document RESOLVES the longest-standing contradiction in the
register.** QC2's transmission direction (R-04) had two first-party sources
disagreeing. The CEO document sides with the registry, decisively — see §C.

**3. The registry's own `implementation.verdict` metadata is STALE and must not
be used to classify anything.** It was written in Phase 5.0A on 2026-07-13 and
has not been maintained since. It says step 7 (`transit_validation`) is
`missing` — PG-1 built it on 2026-08-12. It says step 1 (`cotation`) is
`missing` — EC-3B/3C shipped quotations. Classifying from that field would have
produced a confidently wrong audit. Every classification below traces the actual
authority instead.

---

## B. CEO authority interpretation

The document is authoritative for **sequence and ownership where it is
explicit**, and for nothing else. It says Finance records the declaration in
GAINDE; it supplies no API contract, so **no GAINDE integration is inferred**
(the provider config still reports GAINDE `unsupported`, BLK-1 open). It says
Transport assigns a vehicle; it defines no conformity criteria, so **QC5's
« camion conforme » stays open**. It says the Account Manager obtains BAD and
Delivery Order; it defines no approval criteria for them, so none are invented.

---

## C. The resolved conflict — R-04, and exactly what was wrong

| Source | Claim |
|---|---|
| Manuel de Contrôle Qualité, QC2 | Account Manager assures « **transmission aux opérations** » |
| PROCESSUS OPÉRATIONNEL (registry, steps 2→3→4) | Opérations **assigns to** the AM; the AM transmits to the **Coordonnateur** |
| **CEO workflow (new, primary)** | **Cotation → Responsable des Opérations → Account Manager → Coordonnateur** |

**Two of three first-party sources now agree, and the CEO document is the
primary authority.** R-04 is **ANSWERED**: the direction is
Opérations → AM → Coordonnateur.

**What was actually wrong.** The Quality Manual's QC2 label « Transmission aux
opérations » does not describe a handoff *to* Operations. Operations is *upstream*
of the Account Manager. Read against the CEO sequence, the QC2 control is most
plausibly about the AM transmitting the prepared dossier *onward into operational
handling* — i.e. to the Coordonnateur. **That reading is not certain, and P1.0
does not adopt it silently**: QC2's panel should be corrected only once §P's
residual question is confirmed, because the platform would otherwise be labelling
a control with a recipient the manual never named.

---

## D. Ratification register reconciliation (21 items, rebuilt from source)

| ID | Item | Status after the CEO document |
|---|---|---|
| R-01 | QC1 accusé de réception | **STILL OPEN** — CEO names no acknowledgement act |
| R-02 | QC1 relance | **STILL OPEN** |
| R-03 | QC1 pièces reçues | **STILL OPEN** |
| **R-04** | **QC2 transmission direction** | ✅ **ANSWERED** — Opérations → AM → Coordonnateur (§C) |
| **R-05** | **QC2 Account Manager identity** | ⚠ **PARTIALLY ANSWERED** — CEO step 2: the **Responsable des Opérations assigns** the AM. That settles *designation*. Reassignment, history and the portfolio question remain open |
| R-06 | QC2 « ouverture correcte » | ⚠ **PARTIALLY** — CEO step 3 lists what the AM prepares (OT, BL, débours). Whether their presence *defines* correctness is not stated |
| R-07 | QC2 procedure référentiel | **STILL OPEN** |
| R-08 | QC3 recevabilité criteria | **STILL OPEN** — CEO does not mention recevabilité at all |
| R-09 | QC4 Transit checklist | **STILL OPEN** |
| R-10 | QC4 exactitude / validation event | ✅ **CLOSED as a platform gap** (PG-1). CEO steps 6–7 **confirm** the design. Criterion still open |
| R-11 | QC4 transmission rapide | ⚠ **PARTIALLY** — CEO step 7 has Chef Transit return to the Coordonnateur; whether QC4's control means that transmission is unconfirmed |
| R-12 | QC4 SLA thresholds | **STILL OPEN** — CEO gives sequence, no durations |
| R-13 | QC5 camion conforme | **STILL OPEN** — CEO says "assign vehicle", defines no conformity |
| R-14 | QC5 heure de chargement | **STILL OPEN** |
| R-15 | QC5 heure de départ | ⚠ **PARTIALLY** — CEO step 13 names « sortie du port » as a distinct act from pickup, which suggests the two instants are genuinely different. Not sufficient to define capture |
| R-16 | QC5 POD signé | ⚠ **PARTIALLY** — CEO step 14: the AM **recovers the SIGNED BL**, so a signature is expected. What *evidences* it is still undefined |
| R-17 | QC6 charge verification | **STILL OPEN** |
| R-18 | QC6 Bon de Recettes | **STILL OPEN** — CEO never mentions it |
| R-19 | QC6 archivage | ⚠ **PARTIALLY** — CEO step 17: **Administratif** sends the invoice and archives. Ownership answered; the *definition* of archived is not |
| R-20 | QC6 dossier complet | ⚠ **PARTIALLY** — registry steps 18–19 already model completeness checkpoints (Coordonnateur then AM); criteria still undefined |
| R-21 | QC6 procedure référentiel | **STILL OPEN** |

**Net: 1 answered, 8 partially answered, 12 still open.** The CEO document is a
*sequence and ownership* authority; almost none of the open items are sequence
questions, which is why it moves so few of them to closed.

---

## E. The 18-step matrix

Columns compressed for readability; every row was traced to the named authority.

| CEO | Owner | Registry step | Authority (table · action · permission) | Class | Gap |
|---|---|---|---|---|---|
| 1 Cotation | Service Cotation | 1 `cotation` | `quotation_request`/`quotation` · `quotation_*` RPCs · `quotation:create` (QUOTATION_MANAGER), `quotation:validate` (OPS_SUPERVISOR) | **A** | — |
| 2 Affectation AM | Resp. Opérations | 2 `operations_intake` | `operational_file.account_manager_id` · `assignFile` · `file:assign` (OPS_SUPERVISOR) | **C** | `account_manager_id` is set to the CREATOR and no action changes it (R-05) |
| 3 Ouverture dossier + OT/BL/débours | Account Manager | 3 `am_dossier_opening` | `operational_file` · `createFile` · `file:create`; docs via `document` | **B** | OT and « débours » have no dedicated types; BL exists |
| 4 Contrôle + transmission | Coordonnateur | 4 `coordinator_reception` | `process_handoff` (engine) | **C** | engine-gated; see §F |
| 5 Affectation Déclarant | Chef Transit | 5 `transit_declarant_assignment` | `listEligibleTransitAssignees` · `customs:assign` | **C** | exists but behind the kill switch + `transitExecution` tenant flag |
| 6 Préparation déclaration | Déclarant | 6 `customs_preparation` | `customs_record` · `updateCustoms` · `customs:update` | **A** | — |
| 7 Validation | Chef Transit | 7 `transit_validation` | `customs_record.reviewed_by/at` · `record_customs_validation` · `customs:validate` | **A** | ✅ PG-1 + PG-6; CEO confirms the design |
| 8 GAINDE | Service Finance | 8–9 `coordinator_to_finance`, `gainde_registration` | `customs_record.external_ref` · **no action** · **`customs:register`** (CUSTOMS_FINANCE_OFFICER, OPS_SUPERVISOR) | **E** | **`customs:register` exists, is catalogued as "Register the declaration in GAINDE (Finance, step 9)", is granted to the right role — and NOTHING CONSUMES IT.** Identical to PG-1's pattern |
| 9 Rattachement | Déclarant | 10–11 | `customs_record` · `updateCustoms` | **F** | « rattachement » is undefined as a durable fact |
| 10 BAE + formalités | Agent de Terrain | 12–13 | `bae_reference`, `release_date` · `recordBaeReference`, `recordCustomsRelease` · `customs:update`/`customs:release` | **A** | CUSTOMS_FIELD_AGENT holds `customs:update` |
| 11 BAD + Delivery Order | Account Manager | — | **`BON_A_DELIVRER` document type EXISTS** (« Bon à Délivrer (BAD) / Delivery Order ») | **B** | the type exists; no AM-facing action names it |
| 12 Affectation véhicule | Transport | 14 `transport_assignment` | `transport_record.vehicle_plate`, `driver_user_id` · `TransportPanel`, `DriverAssign` · `transport:assign` | **A** | conformity undefined (R-13) |
| 13 Enlèvement + sortie port | Agent d'Enlèvement | 15 `pickup` | `transport_record.pickup_actual` · `transport:update` | **C** | « sortie du port » has no distinct fact (R-15) |
| 14 Info client + suivi + BL signé | Account Manager | 16–17 | `DELIVERY_NOTE` doc + `delivery_actual` + customer-notify | **B** | signature evidence undefined (R-16) |
| 15 Facturation | Facturation | 20 `billing_draft` | `invoice`, `invoice_line`, `billing_charge` · `finance:create`/`finance:issue` (BILLING_OFFICER) | **A** | — |
| 16 Validation facture | Finance | 21 `finance_invoice_validation` | `invoice.status = VALIDATED` · `finance:validate` (FINANCE_OFFICER) | **A** | — |
| 17 Envoi + archivage | Administratif | 22–25 | invoice send exists; **archive does not** — `archived_at` is « reserved » | **E** | archive is a real missing capability (R-19) |
| 18 Recouvrement + clôture | Recouvrement | 26 `collections` | `collection_follow_up`, aging, `payment` · `collections:manage`; closure via `lib/files/closure.ts` | **A** | — |

**Distribution: A ×7 · B ×4 · C ×4 · E ×2 · F ×1 — and no class D.**
**The CEO document contradicts the platform nowhere.** That is the strongest
single result of this audit: an 18-step first-party workflow was reconciled
against the existing architecture without finding one place the platform does the
wrong thing.

---

## F. Process-engine reconciliation

The engine already models every CEO handoff — `process_handoff` carries
`from_step_key → to_step_key`, `sent_by`/`received_by`, status
SENT/RECEIVED/REJECTED/CANCELLED, a rejection reason, a return-to step and a
`dedup_key`. **That is a richer handoff model than the CEO document asks for.**

Two things gate it rather than block it:

* **A global kill switch plus a per-tenant `transitExecution` flag.** Transit
  execution paths return empty when either is off. So capability exists and may
  be dark in production — an *activation* question, not a build question.
* **`task.handoff_type` is a second, older mechanism** with four values
  (CUSTOMS/TRANSPORT/FINANCE/ARCHIVE). It cannot express the CEO chain and should
  not be extended to; `process_handoff` is the one that can.

**No structural change is required to represent the CEO sequence.**

---

## G. Role reconciliation — all 15 CEO actors map

| CEO actor | Platform role |
|---|---|
| Service Cotation | `QUOTATION_MANAGER` (create) + `OPS_SUPERVISOR` (validate) |
| Responsable des Opérations | `OPS_SUPERVISOR` — the registry itself records it as "semantically equivalent to OPERATIONS_MANAGER" |
| Account Manager · Coordonnateur · Chef Transit · Déclarant · Finance · Agent de Terrain · Transport · Agent d'Enlèvement · Facturation · Administratif · Recouvrement · Courier | `ACCOUNT_MANAGER`, `COORDINATOR`, `CHIEF_OF_TRANSIT`, `CUSTOMS_DECLARANT`, `CUSTOMS_FINANCE_OFFICER`/`FINANCE_OFFICER`, `CUSTOMS_FIELD_AGENT`, `TRANSPORT_OFFICER`, `PICKUP_AGENT`, `BILLING_OFFICER`, `ADMINISTRATIVE_OFFICER`, `COLLECTIONS_OFFICER`, `COURIER` |

**No role needs creating.** Two differ in name only, and inventing
`COTATION_OFFICER`/`OPERATIONS_MANAGER` would duplicate a working identity.

**And there is no permission mismatch either — a correction to my own first
reading.** I initially recorded row 8 as class **D** (contradiction) because
`CUSTOMS_FINANCE_OFFICER` lacks `customs:update`. Tracing further showed that is
the wrong diagnosis: the role holds **`customs:register`**, catalogued in
migration `20260713000001` as *« Register the declaration in GAINDE (Finance,
step 9) »* — the CEO's step, named exactly, granted to the CEO's owner.

**Nothing consumes it.** Row 8 is therefore class **E**, and it is the same
pattern PG-1 closed: a permission that names a control precisely, held by the
right role, with no action behind it. There is **no contradiction and no grant
decision to make** — the authority is already correct and narrowly scoped.

(`lib/process/roles.ts` still carries a note proposing to "create this role or
grant FINANCE_OFFICER a narrow customs:register". The role *was* created and the
narrow permission *was* granted; only the consumer is missing. That note is
stale in the same way the registry verdicts are.)

---

## H. QC1–QC6 reconciliation

QC panels remain an **evidence layer** and must not become a workflow authority.
Mapping: QC1 ← CEO 1 · QC2 ← CEO 2–4 · QC3 ← (not in the CEO document) ·
QC4 ← CEO 6–10 · QC5 ← CEO 12–14 · QC6 ← CEO 15–18.

**QC4 already reads the correct authoritative fact** — PG-1's validation — and
still refuses the verdict, which stays correct because R-10's *criterion* is
open. **QC3 is notable for its absence from the CEO document:** recevabilité is
not a CEO step. That does not invalidate QC3 (the Quality Manual is authoritative
for controls); it does mean recevabilité is a control, not a workflow stage.

**One QC panel may need correcting later, and deliberately not now:** QC2's
transmission control — see §C and §P.

---

## I. PG-1 / PG-6 verification

CEO steps 6–7 are exactly *Déclarant prepares → Chef Transit validates*. The
shipped design matches and is **strengthened, not challenged**: `customs:validate`
withheld from the preparer, both authorship halves disqualified, actor authority
verified, `reviewed_by`/`reviewed_at` recorded, and **no manufactured status
transition** — which the CEO document also does not ask for. **Nothing to change.**

---

## J. Finance / Facturation reconciliation (CEO 15–18)

Everything except archiving already exists: invoice creation, issuance,
`VALIDATED` state, sending, `payment`, aging, `collection_follow_up`, and dossier
closure. **The one genuine missing capability is the archive fact** (R-19) — and
the CEO document answers only its *owner* (Administratif), not its *definition*.
The Bon de Dépenses visa architecture is untouched, and **Bon de Recettes remains
unmentioned by the CEO document**, so it stays blocked on Q6.2.

---

## K. CRUD census — can the named operator actually act?

**FULL:** 1 Cotation · 6 Déclaration · 7 Validation · 10 BAE · 12 Véhicule ·
15 Facturation · 16 Validation facture · 18 Recouvrement/clôture.
**PARTIAL:** 3 Ouverture (OT/débours types absent) · 4 Coordination and
5 Affectation Déclarant (engine-flag gated) · 11 BAD (type exists, no named
action) · 13 Enlèvement (no port-exit fact) · 14 BL signé (no signature fact).
**MISSING:** 17 Archivage.
**BLOCKED BY OWNERSHIP:** 8 GAINDE — the action exists, the CEO's owner lacks
the permission.
**UNDEFINED:** 9 Rattachement.

---

## L. UI / workspace reconciliation

The dossier workspace already carries `ProcessJourneyPanel`, `LifecycleTracker`,
`OwnershipPanel` (four separated responsibility concepts), `SlaPanel`,
`EventTimeline` and the six QC panels. Between them an operator can already
answer *where is this dossier*, *who owns the next action* and *what evidence
exists*. **A new 18-step component is not the first move** — the journey should be
expressed by composing what exists, and only after the P1.1 corrections, or it
would render a sequence the platform cannot yet fully advance.

---

## M–N. Security and migration assessment

No proposed change alters tenant isolation, RLS, maker-checker, actor authority
or audit. **No migration is justified by P1.0**, and none was created — the ledger
stays **104/104**. The archive fact (row 17) is the only candidate, and its
definition is unratified, so it fails the "sufficiently defined" test.

---

## O–Q. Recommended phases — collapsed, because most of the work exists

The suggested P1.1–P1.8 structure over-fits: seven of eighteen steps are already
class A, and four more need wiring rather than building.

**P1.1 — Give `customs:register` a consumer (row 8).** Not a contradiction and
not a permission decision: the authority already exists, correctly scoped, and
is simply unwired. This is PG-1's shape exactly, and PG-1 is the proof it can be
done safely in one bounded slice.

**P1.2 — Engine activation review.** Steps 4 and 5 exist behind a kill switch and
a tenant flag. Determine whether they should be on. **Zero code.**

**P1.3 — Missing document types** (OT, débours, and naming BAD/DO in an AM action).

**P1.4 — Archive capability** (row 17) — *blocked on R-19's definition*.

**P1.5 — Journey visualisation**, composed from existing panels, last.

### R. Exact first implementation slice — recommended

**P1.1 — record the GAINDE registration, consuming `customs:register`.**

It is the cleanest slice available, for the same reasons PG-1 was: the business
meaning is settled by the CEO document (Finance registers the declaration in
GAINDE), the permission already exists and already names that act, the right
role already holds it, and the durable field already exists
(`customs_record.external_ref`, documented as the manual GAINDE/Orbus number).

**No business answer is required, and no permission decision is needed** — which
is what makes it safe to start before ratification returns.

Design constraints, carried from PG-1:
* the action asserts `customs:register` and nothing wider — recording a reference
  must not become a licence to edit the declaration;
* if an RPC takes a caller-declared actor, INV-7 requires
  `assert_actor_authority(..., 'customs:register', 'SERVICE')`;
* it moves **no** customs status — the CEO document does not ask for one, and
  PG-1 established that recording a fact is not a lifecycle transition;
* provenance stays honest: `provider_code` remains `manual`, so QC4 continues to
  report « source : saisie manuelle » and never claims synchronisation. **No
  GAINDE integration is implied**, per §B.

**S. Files that slice would touch:** `lib/customs/actions.ts` (a new narrowly
gated action), `lib/customs/service.ts`/`types.ts` if the reference needs
exposing, `components/customs/customs-panel.tsx`, `lib/i18n.ts`, a new test
suite, and an RLS/SQL suite section. A migration is needed **only** if an RPC is
required for the actor contract; if the action can write through the existing
admin-client path with an app-level gate, the ledger stays 104/104.

**T. Tests/UAT:** a `CUSTOMS_FINANCE_OFFICER` records a GAINDE reference; a
Déclarant with `customs:update` **cannot** use the new action; cross-tenant and
forged actors refused; the customs status is unchanged before and after; QC4
still reports provenance as manual; QC1–QC6, PG-1 and PG-6 regress clean.

**U. Migration count: 104/104, unchanged. V. STOP.**

---

## P. Remaining business questions

The 12 still-open and 8 partially-answered register items above, plus two the CEO
document newly raises:

* **What is « rattachement »** as a durable fact (CEO step 9)?
* **Is « sortie du port » a distinct recorded instant** from pickup (CEO step 13)?

And one confirmation, not a new question: **does QC2's « transmission aux
opérations » mean the AM's transmission to the Coordonnateur?** §C explains why
the platform should not assume it.

---

*P1.0 is an audit. Nothing was implemented, and no migration was created.
Implementation does not begin until this reconciliation is approved.*
