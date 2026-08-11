# MAYA-P0.5-A — Proven Parity Foundation Architecture Audit

**Mode:** audit and plan only. No implementation, no migration, no production
data, no live MAYA, no Sage, no credentials. The MAYA Analysis workspace was
read, never modified.
**Inputs:** `C:\Projects\MAYA Analysis\reports\maya-0-parity-audit.md` (proven
MAYA capabilities) + this repository at `8aae636`.
**Purpose:** determine exactly what can be built BEFORE the Effitrans team
answers **Q1** (per-type stage matrix), **Q2** (acceptance/rejection
semantics) and **Q5** (groupage / remises documentaires).

---

## 0. Executive finding

**The foundation is in far better shape than MAYA-0 could see from the outside.**
Every structural primitive MAYA's workflow relies on already exists here, and
in most cases in a stronger form: a dossier spine with concurrency-safe
numbering, an append-only state history, a handoff table with acceptance,
rejection, return-to-step and idempotency, an append-only assignment ledger
with reason codes, an immutable business-event ledger with a single insertion
path, per-container and per-air-piece models, a dossier-linked expense
document engine with maker-checker visa chains, and — the discovery that most
changes the plan — **a complete legacy import + reconciliation pipeline
already in production use for receivables** (`legacy_import_batch` /
`legacy_import_staging_row` / `legacy_import_error` / `legacy_receivable_link`,
plus `invoice.provenance` + `invoice.legacy_file_reference`). MAYA migration
does not need new migration machinery; it needs the same pattern applied to
the dossier.

**What is genuinely missing is data, not architecture** — and almost all of it
is workflow-independent, which is precisely why it is safe to build before
Q1/Q2/Q5. Five field-level gaps carry every MAYA dossier regardless of type:
cargo declaration (quantity/unit/net weight/volume/packages), the parent-
dossier link, the client's own reference, the two operational dates, and the
MAYA lineage columns. None of them encodes a workflow rule.

**One trap is named up front.** `operational_file.type` (IMP/EXP/TRP/HND) is
not a free label: **seven code sites derive "does this dossier have a customs
leg" from it** (`lib/customs/gates.ts`, `lib/transport/gates.ts`,
`lib/files/closure.ts`, `lib/files/lifecycle.ts`, `lib/customs/actions.ts`,
`lib/handoffs/triggers.ts`, `lib/customer-notify/triggers.ts`), plus the
step registry, the applicability map and the DB `CHECK` — and the numbering
function `next_file_number` hard-validates the same four values in SQL, with a
trusted OPS-SEC-2A overload in front of it. **Replacing that vocabulary with
MAYA's eight compound types would be a high-blast-radius change with no
business benefit.** The correct convergence is decomposition (§2), which
leaves `type` doing exactly the job it already does correctly.

---

## 1. Classification summary

| # | Capability | Class | Where |
|---|---|---|---|
| 1 | Dossier identity, numbering, status history | **ALREADY EXISTS** | §2.1 |
| 2 | Shipment routing / vessel / BL-LTA / dates | **ALREADY EXISTS** | §2.2 |
| 3 | Customs regime attribute | **ALREADY EXISTS** | §2.3 |
| 4 | Containers (per unit) + air pieces | **ALREADY EXISTS** | §2.4 |
| 5 | Handoff with acceptance / rejection / idempotency | **ALREADY EXISTS (superior)** | §2.5 |
| 6 | Assignment history with reason codes | **ALREADY EXISTS (superior)** | §2.5 |
| 7 | Observations / activity / audit history | **ALREADY EXISTS (superior)** | §2.6 |
| 8 | Logistics execution + delivery evidence | **ALREADY EXISTS** | §2.7 |
| 9 | Demande de décaissement | **ALREADY EXISTS (superior)** | §2.8 |
| 10 | Client invoicing / charges / artifacts | **ALREADY EXISTS** | §2.8 |
| 11 | Documents + review + expiry | **ALREADY EXISTS** | §2.9 |
| 12 | Client notification primitive | **ALREADY EXISTS** | §2.10 |
| 13 | **Legacy import + reconciliation pipeline** | **ALREADY EXISTS** | §2.11 |
| 14 | Per-type step variance mechanism | **ALREADY EXISTS (empty for this purpose)** | §2.12 |
| 15 | Dossier taxonomy (direction × mode × cargo × regime) | **NEEDS CONVERGENCE** | §3.1 |
| 16 | Numbering prefix scheme | **NEEDS CONVERGENCE** | §3.2 |
| 17 | Container counts (Nb / TC20 / TC40) | **NEEDS CONVERGENCE** | §3.3 |
| 18 | Carrier/company on logistics tab | **NEEDS CONVERGENCE** | §3.4 |
| 19 | Cargo declaration block (qty/unit/weight/volume/packages) | **PROVEN GAP** | §4.1 |
| 20 | Parent dossier link (« Dossier mère ») | **PROVEN GAP** | §4.2 |
| 21 | Client's own reference + « P/C » | **PROVEN GAP** | §4.3 |
| 22 | Warehouse-entry + processing-deadline dates | **PROVEN GAP** | §4.4 |
| 23 | Dossier lineage columns (provenance / legacy ref) | **PROVEN GAP** | §4.5 |
| 24 | Supplier (fournisseur) registry | **PROVEN GAP** | §4.6 |
| 25 | Supplier/carrier invoice per dossier | **PROVEN GAP** | §4.7 |
| 26 | Avis d'arrivée as an assembled artifact | **PROVEN GAP (partly Q6)** | §4.8 |
| 27 | Per-type required/optional stage matrix | **BLOCKED — Q1** | §5 |
| 28 | Recevabilité / acceptance + rejection semantics | **BLOCKED — Q2** | §5 |
| 29 | Groupage sub-BL model | **BLOCKED — Q5** | §5 |
| 30 | Remises documentaires flow | **BLOCKED — Q5** | §5 |
| 31 | Transfer destination rules (who → whom) | **BLOCKED — Q2** | §5 |
| 32 | General ledger / journals / VAT accounting | **NOT A PARITY REQUIREMENT** | §6 |
| 33 | Fleet economics (trucks/fuel/zones/tariffs) | **NOT A REQUIREMENT until Q8** | §6 |
| 34 | Payroll | **NOT A MAYA REQUIREMENT** (HR-7 roadmap) | §6 |
| 35 | MAYA single-login / one-click transfer UX | **NOT A PARITY REQUIREMENT** | §6 |

---

## 2. ALREADY EXISTS — reuse verbatim, build nothing

### 2.1 Dossier spine
`supabase/migrations/20260614000002_create_operational_file.sql` —
`operational_file` (file_number, type, client_id, account_manager_id,
coordinator_id, assigned_to_user_id, status DRAFT→OPENED→IN_PROGRESS→
DELIVERED→CLOSED/CANCELLED, priority, opened_at, archived_at, created_by),
`file_counter` + `next_file_number()` (definer, service-role only,
concurrency-safe `ON CONFLICT … RETURNING`, gaps allowed), `file_state_transition`
(append-only, `prevent_mutation` trigger). Service layer `lib/files/*`
(actions, service, validate, status, lifecycle, closure, delete-policy,
assign-policy). **MAYA « N° dossier / Date d'ouverture / Ouvert par » map 1:1.**

### 2.2 Shipment
`shipment` 1:1 with tenant-match trigger — transport_mode (SEA/AIR/ROAD/
MULTIMODAL), incoterm, origin, destination, cargo_type, carrier_name,
**vessel_or_flight** (MAYA « Navire/Vol »), **bl_awb_ref** (MAYA « BL / LTA »),
container_ref, etd/atd/eta/ata, pickup/delivery planned/actual, plus
ocean_milestone / air_milestone state.

### 2.3 Customs regime — already present
`customs_record.regime` (free text) already exists alongside
declaration_number, customs_office, declaration_date, bae_reference,
release_date, inspection_status, external_ref (GAINDE/Orbus). **MAYA « TC
SUSPENSIF » needs a vocabulary, not a column.**

### 2.4 Containers and air units
`ocean_container` (container_number ISO-6346, iso_type, seal_number,
gross_weight_kg, status, vessel/voyage) — per-container rows, richer than
MAYA's counts. `air_awb` (mawb/hawb), `air_uld`, `air_cargo_piece`
(piece_count, weight_kg, volume_m3, dimensions, special_handling, DG,
temperature).

### 2.5 Handoff and assignment — stronger than MAYA
`process_handoff` (20260713000001): from_step_key → to_step_key, sent_by/
sent_at, received_by/received_at, status SENT/RECEIVED/**REJECTED**/CANCELLED,
**rejection_reason**, **returned_to_step_key**, **dedup_key** (idempotent
re-send). `assignment_event` (20260727000002): append-only, subject_type
(COMMERCIAL_OWNER/OPERATIONAL_OWNER/STEP/TASK), previous/new user, actor,
free-text `reason` kept out of the immutable ledger, structured `reason_code`,
workflow_step_key, pinned `policy_version_id`.
**MAYA's Transférer + acceptance + « Transféré par/le » are already modelled —
with rejection and idempotency MAYA does not have.** Only the *routing rules*
(who → whom, per type) are missing, and those are Q2.

### 2.6 Observations / activity / audit
`business_event` (20260726000004) — immutable, single insertion path
(`emit_business_event`), domains incl. dossier/document/customs/transport/
task/handoff/finance; `audit_log`; `file_state_transition`; UI
`components/files/unified-timeline-view.tsx`, `components/files/event-timeline.tsx`,
`components/portal/dossier-timeline.tsx`; canonical projection
`lib/workflow/projection.ts` (monotonic, pure).
**MAYA « Observations précédentes » = a stage-scoped read of this ledger — a
presentation, not a new store.**

### 2.7 Logistics execution
`transport_record` — pickup/delivery location + planned/actual, driver_name/
phone, vehicle_plate, trailer_or_container, transport_company, **delivery_reference**
(≈ MAYA « Bordereau de livraison N° »), **pod_document_id**, customs_override,
notes; plus WES-5 evidence/reconciliation and driver execution.

### 2.8 Finance
`expense_authorization` — **already carries `file_id`** (dossier link),
finance_request_id, beneficiary, amount + currency + amount_in_words, reason,
expense_type, weight_kg, DRAFT→SUBMITTED→IN_APPROVAL→RETURNED/REJECTED/
APPROVED/CANCELLED/SUPERSEDED, frozen versions, `expense_visa` chain,
`expense_approval_attempt`, counters; `expense_voucher` (+versions); caisse
execution (9.3A); `finance_request`. Client side: `billing_charge` (per
dossier), `invoice` + `invoice_line` + counters + payment/payment_intent +
`aging_*` + `collection_follow_up`.
**MAYA DEMANDE/DETAILDEMANDE has a stronger home already.**

### 2.9 Documents
`document` (file_id, type_code, status, version, supersedes_id, expiry_date,
storage_path, reviewed_by, soft delete) + `document_type` + `document_review`
(WES-4) + generated artifacts with byte integrity (20260727000004,
20260728000001).

### 2.10 Client notification primitive
`client_notification` — event_type, category, template_key, title, body,
**file_id**, invoice_id, **dedup_key**, read/archived. Plus customer-notify
triggers and the portal.

### 2.11 Legacy import + reconciliation — **the key reuse discovery**
`supabase/migrations/20260729000002_aging_balance_foundation.sql` already ships:
* `invoice.provenance` ∈ {PLATFORM_NATIVE, OPENING_IMPORT} + `invoice.legacy_file_reference`,
  with a CHECK making a legacy row valid only when it carries a dossier **or** a legacy reference;
* `legacy_import_batch` — batch_number, source_filename, **source_file_sha256**,
  STAGED→VALIDATED→APPROVED/REJECTED/CANCELLED, prepared_by/at, approved_by/at,
  rejection_reason, and a **`legacy_batch_approver_differs` CHECK (maker-checker in the schema)**;
* `legacy_import_staging_row` (+ per-batch uniqueness), `legacy_import_error`;
* `legacy_receivable_link` — invoice_id, previous_file_id → new_file_id,
  **preserved_legacy_reference**, linked_by/at, note.
**MAYA dossier migration reuses this shape exactly; it does not invent one.**
(HR's `hr_import_batch` is the same pattern, independently proven.)

### 2.12 Per-type step variance mechanism
`lib/process/applicability.ts` — definition-driven map of "steps that only
apply to listed dossier types", CI-validated against the 51-entry registry
(`lib/process/effitrans-process.ts`), currently scoped to the customs leg.
**This is the file Q1's answer will populate. The mechanism exists; the
content is blocked.**

---

## 3. EXISTS BUT NEEDS CONVERGENCE

### 3.1 Dossier taxonomy — decompose, do not re-enumerate
MAYA's eight types are compounds of four dimensions. Three already have homes:
**direction/leg** = `operational_file.type` (IMP/EXP/TRP/HND — keep; it
correctly drives the customs gates), **mode** = `shipment.transport_mode`,
**regime** = `customs_record.regime`. Only **cargo form** (TC / VRAC / COLIS /
GROUPAGE) has no typed home (`shipment.cargo_type` is free text).
*Smallest safe change:* a pure mapping module (e.g. `lib/files/taxonomy.ts`)
that (a) declares the cargo-form vocabulary, (b) renders the MAYA-equivalent
compound label from the four attributes, (c) maps each legacy MAYA type string
onto the tuple for migration. **Pure, no migration, no workflow.** Constraining
`cargo_type` to a vocabulary is a later, additive step once real values are seen.
*Do NOT* extend the `type` CHECK — §0 blast radius.

### 3.2 Numbering prefixes
Today `EFT-{TYPE}-{YEAR}-{00000}`; MAYA uses per-type prefixes (`EMV/2026/0039`,
`IMT2026/0250`). Continuity policy (MAYA-0 P7): migrated dossiers keep their
MAYA number as an immutable **reference**, never re-minted. Whether *new*
Effitrans dossiers should adopt MAYA-style prefixes is a business choice, not a
technical gap — and any change touches `next_file_number` **and** its
OPS-SEC-2A trusted overload. *Recommendation: leave numbering alone; carry the
legacy number in the lineage column (§4.5).*

### 3.3 Container counts
MAYA stores « Nb Conteneur / TC 20' / TC 40' »; Effitrans stores the containers
themselves. *Smallest safe change:* derive the counts from `ocean_container`
rows for display/migration reconciliation. Store nothing.

### 3.4 Logistics fields
`transport_record` covers bordereau (`delivery_reference`) and carrier
(`transport_company`); MAYA additionally shows « Compagnie » (shipping line,
already `shipment.carrier_name`/`carrier_id`) and « Instruction de livraison »
(today folded into `notes`). *Smallest safe change:* none required for parity;
if a distinct instruction field proves necessary it is one additive column —
defer until a real dossier shows the need.

---

## 4. PROVEN GAPS (workflow-independent — safe before Q1/Q2/Q5)

### 4.1 Cargo declaration block — **the largest real gap**
MAYA's opening form carries **Quantité, Unité, Poids Net (Kg), Volume** (and
« Nature / Désignation / Fournisseur ») for **every** dossier type. Effitrans
holds weight/volume only in mode-specific children (`ocean_container.gross_weight_kg`,
`air_cargo_piece.weight_kg/volume_m3`) — so a **vrac export, a road-only
dossier or a documentary file has nowhere to record its cargo at all.**
*Reuse:* `shipment` (already 1:1, tenant-guarded, tested).
*Smallest safe change:* additive nullable columns on `shipment` —
`quantity numeric`, `quantity_unit text`, `net_weight_kg numeric`,
`gross_weight_kg numeric`, `volume_m3 numeric`, `package_count int`,
`goods_description text`, `goods_nature text`, plus display in the existing
file form/detail. `UNITE` vocabulary from MAYA becomes a pure list.
**No workflow semantics. No CHECK that constrains existing rows.**

### 4.2 Parent dossier (« Dossier mère »)
`operational_file` has no self-reference; MAYA has `DOSSIERMERE` and shows the
field on the opening form for all types.
*Smallest safe change:* additive nullable `parent_file_id uuid references
public.operational_file(id)` + same-tenant trigger (copy the existing
`enforce_shipment_tenant` idiom) + a self/cycle guard, and read-only display.
**Structure only — no groupage semantics, which are Q5.** Building the link now
is what lets Q5 be answered as configuration rather than schema.

### 4.3 Client's own reference and « P/C »
MAYA's opening form: Réf. Client (the customer's own reference) and « P/C »
(pour le compte de). Effitrans has neither on the dossier.
*Reuse:* `operational_file`. *Smallest safe change:* additive nullable
`client_reference text` and `on_behalf_of text`. Both are labels, never
authorization, never routing.

### 4.4 Operational dates
« Date d'entrée en magasin » and « Date d'échéance traitement dossier ».
*Smallest safe change:* additive nullable `warehouse_entry_date date` on
`shipment` (a cargo fact) and `processing_due_date date` on `operational_file`
(a dossier fact). **Deadline display only — no SLA engine, no escalation.**

### 4.5 Dossier lineage
Invoices already carry `provenance` + `legacy_file_reference`; dossiers do not.
*Reuse:* the exact FIN-AGING pattern (§2.11).
*Smallest safe change:* additive `provenance text not null default
'PLATFORM_NATIVE'` (+ CHECK adding `MAYA_IMPORT`) and `legacy_reference text`
on `operational_file`, with a partial index. This is what makes migration
reversible and reconcilable, and what preserves MAYA numbers for Sage
traceability (SAGE-0 F6).

### 4.6 Supplier registry
MAYA's `TIERS` is one registry for clients *and* suppliers; Effitrans has
`client` only, and suppliers appear as free text in expenses/logistics.
*Options (decision, not a default):* (a) add `client.party_type` ∈
{CLIENT, SUPPLIER, BOTH} — smallest, reuses every existing read/RLS path; or
(b) a separate `supplier` table. **Recommend (a)**, but it is a business/RLS
decision — the portal must never expose supplier parties, so it is a
*sequenced* item, not a free one. Depends on §4.7's ratification.

### 4.7 Supplier/carrier invoice per dossier
MAYA « Suivi des Factures Compagnie » (Fournisseur / Motif / Date / Montant,
CRUD) + `*_LOGISTIK` invoice tables. Effitrans records outgoing money with
approval (expense docs) and billable charges — but has **no record of a
supplier invoice received against a dossier**.
*Reuse:* `billing_charge` shape, `expense_*` money/currency doctrine (integer
minor units where money is authoritative), document evidence.
*Smallest safe change:* a thin `supplier_invoice` record (dossier, supplier
party, reference, date, amount, currency, status, document evidence) feeding
cost tracking and billable conversion — **design in P0.5-D after F7/F18
answers**, not now.

### 4.8 Avis d'arrivée
All the pieces exist (notification primitive, document generation, portal) but
nothing assembles them into an arrival notice. **MAYA-0 Q6 defines the output
(print / PDF / send / persist).** Only the *data* half is safe now — and §4.1
supplies most of it (vessel, ETA, cargo, container). *Recommendation:* build
nothing until Q6; the fields land with §4.1 anyway.

---

## 5. BLOCKED BY Q1 / Q2 / Q5 — do not infer

| Item | Blocked by | Why it cannot be inferred |
|---|---|---|
| Per-type required/optional/skipped stage matrix (`applicability.ts` entries) | **Q1** | MAYA tabs were observed greyed; availability depends on type/state/assignment. Guessing writes a false process. |
| Recevabilité: is it a state, a date, or a permission gate? Rejection path? | **Q2** | Determines whether it is a new step, a `process_handoff` rejection, or an existing decision. |
| Transfer destination rules (derived vs chosen; who may transfer where) | **Q2** | `process_handoff` supports both; the rule is business. |
| Groupage sub-BL (master + sub-dossiers, per-sub client billing) | **Q5** | Whether §4.2's parent link carries groupage or something else. |
| Remises documentaires flow | **Q5** | Stages, documents and actor unknown. |
| Whether « Position » is a stage, a station, or a queue | **Q1** | Maps to projection stage vs department vs assignment. |

**Rule for P0.5-B..D: nothing in this table may be implemented, and no default
may be chosen that would encode an answer.**

---

## 6. NOT A PARITY REQUIREMENT

General ledger, journals, chart of accounts, trial balance, VAT accounting,
bank reconciliation, cheque/traite schedules — **Sage 100 Comptabilité i7**
(Q11 VERIFIED; SAGE-0 §24 do-not-rebuild list). MAYA's 21 GL tables are vendor
capability, not an Effitrans gap. · Fleet economics (CAMION/CARBURANT/ZONE/
TARIF) — not a requirement until Q8 confirms usage; tariffs are pricing rules
that must never be invented. · Payroll — existing HR-7 roadmap, not a MAYA
wave. · MAYA's shared DB login, client-side logic, mutable history, and
one-click unconfirmed Transférer — explicitly superseded.

---

## 7. Proposed implementation sequence (post-ratification)

Each phase is small, additive, and independently shippable. **Every phase ends
at a stop gate; none may proceed while its gate is open.**

### P0.5-B — Dossier fact convergence *(no workflow, no blocked item)*
* **Scope:** §4.1 cargo declaration block, §4.3 client_reference + on_behalf_of,
  §4.4 warehouse_entry_date + processing_due_date, §4.2 parent_file_id
  (structure + tenant/cycle guard only), §3.1 pure taxonomy module.
* **Reuse:** `shipment`, `operational_file`, `enforce_shipment_tenant` idiom,
  `lib/files/{types,validate,actions,service}.ts`,
  `components/files/file-form.tsx`, `app/files/[id]/page.tsx`.
* **Migration:** ONE additive migration (nullable columns + one FK + one
  trigger + indexes). No CHECK that can fail on existing rows; no default that
  rewrites data.
* **Tests:** additive-only assertion (no existing column altered); tenant-match
  and self/cycle refusal proven in SQL; taxonomy module unit tests incl. every
  MAYA legacy type string → tuple; form/detail render; no `type` CHECK change;
  no new permission.
* **Stop gate:** none of the §5 items touched; `applicability.ts` unchanged.

### P0.5-C — Migration lineage & staging *(reuses FIN-AGING pattern)*
* **Scope:** §4.5 `operational_file.provenance` + `legacy_reference`; a
  MAYA-scoped staging batch reusing the `legacy_import_batch` shape
  (maker-checker CHECK included); **no application/apply path** (staging stops
  at APPROVED, exactly as HR imports stop at READY).
* **Reuse:** `legacy_import_batch` / `_staging_row` / `_error` /
  `legacy_receivable_link`, `invoice.provenance` precedent.
* **Migration:** one additive migration.
* **Tests:** provenance CHECK; legacy row valid without a platform number;
  reconciliation link preserves the MAYA reference; **no apply path exists**;
  approver ≠ preparer.
* **Stop gate:** no MAYA data is read or moved in this phase — pipeline only.

### P0.5-D — Supplier & carrier-invoice foundation *(needs answers first)*
* **Blocked by:** MAYA-0 **F7/F18** (settlement in MAYA or accounting?) and the
  §4.6 party-model decision (RLS/portal impact).
* Not to be started before those.

### MAYA-P1 — Dossier workflow parity *(unchanged, still blocked)*
Q1 + Q2 + Q5 answers → per-type stage matrix in `applicability.ts`,
recevabilité modelling, transfer affordance on the dossier surface, carried
observations. **P0.5-B/C deliberately make P1 smaller, never pre-empt it.**

---

## 8. Expected migrations

| Phase | Migration | Nature |
|---|---|---|
| P0.5-B | `*_dossier_fact_convergence` | additive columns on `shipment` + `operational_file`, 1 FK, 1 trigger, indexes |
| P0.5-C | `*_dossier_legacy_lineage` | additive columns + MAYA staging tables (mirroring FIN-AGING) |
| P0.5-D | TBD | blocked |
| MAYA-P1 | possibly none | applicability is code, not schema |

Housekeeping per migration (standing rules): `LATEST_MIGRATION` /
`MIGRATION_COUNT` in `lib/platform/ops/build-info.ts`; new SQL suite wired
**last** in `ci.yml` with the runs-LAST pin moved; `lib/db/types.ts` updated;
new tenant-scoped tables registered in `TENANT_SCOPED_TABLES`.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Taxonomy work drifts into changing `operational_file.type` | §0/§3.1: decomposition only; a test pins the 4-value CHECK and the 7 customs-gate sites |
| Additive columns quietly become required | every column nullable; no NOT NULL, no data-rewriting default |
| Parent link is read as groupage before Q5 | ship structure + display only; a test asserts no groupage/billing logic reads it |
| Cargo fields duplicate container/air data | one direction only — dossier-level declaration is operator-entered; per-unit tables stay authoritative for their modes; reconciliation is display |
| Legacy staging becomes a back door into production dossiers | no apply path in P0.5-C (HR precedent), maker-checker CHECK, tests pin absence |
| Supplier registry widens portal visibility | P0.5-D gated on the party-model decision + RLS review |
| Building before answers | §5 table is the contract; each phase's stop gate names it |

---

*MAYA-P0.5-A is an audit. Nothing here is implemented. P0.5-B does not begin
until this audit is ratified; MAYA-P1 remains blocked on Q1/Q2/Q5.*
