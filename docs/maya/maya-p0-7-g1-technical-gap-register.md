# MAYA-P0.7-G1 — Quality Register, Platform Gaps, and G2 Readiness

**Mode:** audit and documentation only. No application code, no schema, no
migration, no test change. **Baseline verified, not assumed:** `7275743`, clean
tree, in sync with `origin/main`, 102 migration files, `MIGRATION_COUNT = 102`,
`LATEST_MIGRATION = "20260824000001_customs_receivability"`, CI **#443**
(`31629283891`) GREEN — build 10/0/0, rls-tests 92/0/0.

---

## A. Correction to the running count: the register is **21**, not 17

The P0.7-D/E/F reports carried a running total of 17. Reconstructing it from
the shipped source rather than from those summaries — every `QC*_NO_*` constant
and every `QC1_DEFERRED` key — yields **21**.

Two QC4 items were **described in the P0.7-D phase report but omitted from its
count**, one QC5 item was described without being registered, and QC3 was
recorded as having **zero** open items when its criteria had never been defined:

| Missed | Where it lives in code | Why it was missed |
|---|---|---|
| QC4 — no Transit checklist référentiel | `QC4_NO_CHECKLIST` | reported in prose, not counted |
| QC4 — « transmission rapide » names no recipient | `QC4_NO_TRANSMISSION_FACT` | reported in prose, not counted |
| QC5 — departure unobtainable without GPS tracking | `QC5_NO_DEPARTURE_WITHOUT_TRACKING` | treated as a platform note, not a question |
| QC3 — receivability criteria never defined | no constant — ownership was settled, criteria were not | ownership being settled read as the whole item being closed |

The count is corrected here rather than carried forward. The distribution is
now **QC1 ×3 · QC2 ×4 · QC3 ×1 · QC4 ×4 · QC5 ×4 · QC6 ×5 = 21**.

---

## B. The complete register (21)

**Class** — **BUS** = business semantics only Effitrans can settle ·
**PLAT** = platform gap, meaning is clear enough to build ·
**CONF** = conflicting first-party evidence.

| ID | QC | Control | Platform fact today | Missing | Class | Blocks |
|---|---|---|---|---|---|---|
| R-01 | 1 | Accusé de réception | nothing recorded | what act counts; deadline | BUS | that control |
| R-02 | 1 | Relance | nothing recorded | one control or two; traced or not | BUS | that control |
| R-03 | 1 | Pièces reçues | EC attachments, narrower ACL; no dossier yet | expected pieces; pre-dossier linkage | BUS+PLAT | that control |
| R-04 | 2 | Transmission aux opérations | two mechanisms, neither expresses it | **the direction itself** | **CONF** | that control |
| R-05 | 2 | Account Manager identity | `account_manager_id = creator`, never changed | designation rule, reassignment, history | BUS+PLAT | AM attribution everywhere |
| R-06 | 2 | Ouverture correcte | opening fact proven | what "correct" means | BUS | verdict only |
| R-07 | 2 | Respect des procédures | none | référentiel | BUS | that control |
| R-08 | 3 | Recevabilité criteria | decision recorded (owner, date, motive) | what makes a file receivable; « sous réserve »; gating | BUS | criteria assistance + gating |
| R-09 | 4 | Respect checklist | none | which checklist | BUS | that control |
| R-10 | 4 | Exactitude des informations | `customs:validate` granted; **no action consumes it**; `reviewed_by` never written | the validation **event** | **PLAT** | that control + audit trail |
| R-11 | 4 | Transmission rapide | client sharing only | recipient; "rapide" | BUS | that control |
| R-12 | 4 | Délai interne | durations measured | every threshold | BUS | all timeliness verdicts |
| R-13 | 5 | Camion conforme | plate only; **no vehicle table at all** | conformity definition + store | BUS+PLAT | that control |
| R-14 | 5 | Heure de chargement | `pickup_actual` recorded | start vs completion vs enlèvement | BUS | naming precision |
| R-15 | 5 | Heure de départ | only GPS `DEPARTED` | manual capture when tracking off | BUS+PLAT | that control off-GPS |
| R-16 | 5 | POD signé | 4 states via `isVerified` | what proves a signature | BUS | that control |
| R-17 | 6 | Vérification des frais | `billing_charge` has no status/reviewer/date | verifier, scope, reject/correct | BUS+PLAT | that control |
| R-18 | 6 | Bon de Recettes | **no object anywhere** | purpose, trigger, lifecycle | BUS+PLAT | the object |
| R-19 | 6 | Archivage | `archived_at` **reserved, deferred** | archive definition + event | BUS+PLAT | that control |
| R-20 | 6 | Dossier complet | none | finance completeness criterion | BUS | that control |
| R-21 | 6 | Respect procédure | none | référentiel | BUS | that control |

Plus one **standing platform blocker** predating the QC programme, restated
because Q6.6 of the pack asks for it: **`VISA_RECEPTION` and `VISA_OPERATIONS`
have no signer role** (BLK-FIN-1/2). A document reaching them halts honestly.

---

## C. Platform gaps — engineering register

These are **not** questions for staff. The meaning is clear; the capability is
missing. Each is scoped here so P0.8 can pick them up without re-deriving.

### PG-1 — The Chef de Transit validation event (from R-10)

| | |
|---|---|
| **Authority affected** | `customs_record`, RBAC, `business_event` |
| **Current** | `customs:validate` is granted to CHIEF_OF_TRANSIT and two admin roles and is deliberately **absent** from CUSTOMS_DECLARANT — the maker-checker separation is real and enforced. But **no action calls `assertPermission("customs:validate")`**, and `customs_record.reviewed_by` is never written. |
| **Missing** | An action that records the validation: actor, instant, outcome, optional reason — plus a ledger event. |
| **Security** | The preparer must never satisfy it. If implemented as an RPC taking `p_actor`, OPS-SEC-2A **INV-7** requires `assert_actor_authority(p_actor, tenant, 'customs:validate', 'SERVICE')` — omitting it fails CI. |
| **Schema** | Likely none: `reviewed_by` exists. A `validated_at` column may be needed; `reviewed_by` alone cannot carry an instant. |
| **UI** | A control in `CustomsPanel`, gated on `customs:validate`. |
| **Migration** | Probably one narrow additive column. |
| **Depends on business** | **No.** This is the cleanest gap in the register — it can be built before any answer returns. |
| **Recommended phase** | **P0.8, first item.** |

### PG-2 — Bon de Recettes (from R-18)

| | |
|---|---|
| **Authority affected** | Finance — `payment`, `invoice`, cash |
| **Current** | No object. Zero occurrences of "recette"; no receipt-voucher table in 102 migrations. `payment` records money received but is not a document. |
| **Missing** | The document object, numbering, visa chain if any, print. |
| **Depends on business** | **Yes — blocking.** Q6.2 must be answered first; whether it is proof-of-collection or authorisation-to-collect changes its position in the lifecycle entirely. |
| **Recommended phase** | **P0.9**, after Q6.2. |

### PG-3 — Charge verification (from R-17)

| | |
|---|---|
| **Current** | `billing_charge` carries description, quantity, unit amount, tax rate — and no status, reviewer or verification instant. |
| **Missing** | A verification fact, and a decision on scope (per line vs per dossier). |
| **Security** | If verification gates invoicing, it becomes a maker-checker boundary and the preparer must not self-verify. |
| **Depends on business** | **Partly.** Q6.1 settles who and what; the *shape* (status + actor + instant on the charge) is predictable either way. |
| **Recommended phase** | **P0.9**, or P0.8 if Q6.1 returns early. |

### PG-4 — Finance visa signer mapping (BLK-FIN-1/2)

| | |
|---|---|
| **Current** | `UNBOUND_VISA_STEPS = [VISA_RECEPTION, VISA_OPERATIONS]`. Documents halt with « signataire non configuré ». |
| **Missing** | A role per step. Deliberately never guessed. |
| **Depends on business** | **Yes — blocking.** Q6.6. |
| **Note** | This is **configuration, not schema** — mapping a step to an existing role. Cheap once answered. |

### PG-5 — Vehicle authority (from R-13)

| | |
|---|---|
| **Current** | `transport_record.vehicle_plate`, free text. No vehicle, fleet, or inspection table anywhere. |
| **Missing** | Everything, if conformity is to be checked rather than asserted. |
| **Depends on business** | **Yes — blocking.** Q5.1 decides whether this is a small checklist or a fleet module. The two differ by an order of magnitude. |
| **Note** | MAYA-0 recorded fleet economics as **out of scope until Q8**. Do not let a QC5 checkbox pull a fleet module forward. |

### PG-6 — Pre-dossier attachment linkage (from R-03)

| | |
|---|---|
| **Current** | `document.file_id` is NOT NULL, so a document cannot exist before its dossier. Pre-dossier pieces live in `ec_inbound_attachment`, gated on `communication:inbound:read` **plus mailbox membership** — narrower than Commercial. |
| **Missing** | A path from a triaged attachment to the dossier created later. |
| **Depends on business** | **Partly** — Q1.3 decides whether it is wanted at all. |

### PG-7 — Manual departure capture (from R-15)

| | |
|---|---|
| **Current** | Departure exists only as the GPS `tracking_event` type `DEPARTED`. |
| **Missing** | A manual departure instant for dossiers without tracking. |
| **Depends on business** | **Yes** — Q5.3 may answer "departure = loading", which closes this at zero cost. **Ask before building.** |

---

## D. Configurability recommendation for P0.8

The user asked to proceed on best evidence now and adjust later. That is
achievable **only if the answers land as configuration**, not as code edits.

**Should become configuration (versioned, tenant-scoped, admin-editable):**

* **SLA thresholds** — the registry already models this correctly
  (`unconfigured` / `unratified` / `ratified` with a doctrine that unconfigured
  never produces a late status). Answers to Q4.3 populate values; **no code
  changes**. This is the model to copy.
* **Required-document / checklist définitions** — `document_type.required_for`
  already does this for documents.
* **Visa step → signer role mapping** (PG-4) — a mapping table, not logic.
* **Quality criteria per control** — receivability criteria, "ouverture
  correcte", "dossier complet": a versioned criterion list per control.

**Must stay in code (true invariants, never configurable):**

tenant isolation · maker-checker identity separation · actor authority
verification (OPS-SEC-2A) · append-only audit and ledger semantics ·
permission enforcement · RLS · lifecycle integrity · authoritative ownership
(one fact, one owner).

**Do not build a generic rules engine.** Three of the four configurable
families already have a home. Recommend extending those rather than creating a
fifth abstraction.

---

## E. SAFE NOW vs WAIT FOR RATIFICATION — P0.7-G2 matrix

### Safe to build now

| Capability | Why safe |
|---|---|
| One QC1–QC6 projection per dossier | All six derive from facts already shipped; no new judgement |
| Preserving the four evidence states | `observed` / `absent` / `restricted` / `not_represented` are already the doctrine |
| **Restricted ≠ absent** across the aggregate | The per-QC gates already enforce it; the aggregate must not weaken it — an aggregate that renders "restricted" as "missing" would leak by implication |
| Navigation Quality → dossier → control | Pure routing |
| Tenant-safe aggregation | Every underlying read is already tenant-scoped |
| A **coverage** count ("4 of 7 evidenced") | Counts what the platform knows; not a quality judgement |
| Listing open clarifications in-product | Turns the register into something operators can see |

### Must wait

| Capability | Blocked by |
|---|---|
| Any compliance score or percentage | Q7.4 — **no scoring doctrine exists** |
| Pass/fail per control | Criteria (R-06, R-08, R-09, R-20, R-21) |
| SLA late/on-time verdicts | Q4.3 — every relevant threshold `unconfigured` |
| Automatic non-conformity creation | Q7.1 |
| CAPA | Q7.2 — Effitrans may not practise it |
| Quality closure | Q7.3 |
| Department performance scoring | Q7.4 + R-05 (attributing work needs a real AM) |

**The central warning for G2.** A screen that aggregates six panels will be
dominated by *« non évalué »* until the pack returns. That is the honest state,
not a defect — but it means **G2's value is the coverage view and the
clarification list, not a dashboard of verdicts**. Building scoring first would
produce a confident-looking screen with nothing behind it.

---

## F. Artifact-required items

These cannot be answered by reading the repository, and **were not** attempted
from generic templates:

* real Effitrans **FACTURE** — field and layout parity, numbering
* **Bon de Dépenses** filled — which visas are actually signed in practice
* **Bon de Recettes** filled — the whole of Q6.2
* handwritten **Finance / Facturation notes**
* Transit checklist · Account Manager procedure · Facturation procedure ·
  customs receivability criteria — if they exist as documents

The `docs/Logistic Pack/` files are a **generic commercial kit**, not Effitrans
artifacts, and were deliberately not used as evidence.

---

## G. Validation performed

No code, schema, test or migration changed — documentation only.

* All **21** register items traced to a named constant or a named column in the
  shipped source; none inferred from a prior summary.
* No QC silently dropped: QC1–QC6 each still export their gap constants, and
  each QC suite still pins them open.
* Every business question carries its evidence provenance and **no preselected
  answer**; "Autre" is open everywhere and the current implementation is never
  presented as the expected reply.
* Business semantics and platform gaps are in **separate documents** — staff
  are not asked to answer engineering questions.
* Migration ledger unchanged: **102/102**.

---

*P0.7-G1 is documentation. Nothing was implemented. P0.7-G2 does not begin
until the ratification pack has been reviewed.*
