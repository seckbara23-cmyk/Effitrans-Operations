# Phase 11.0A — Autorisation de Dépenses & Bon de Dépenses : Architecture Audit

**Date:** 2026-07-25 · **Type:** architecture & repository audit only — **no migration/table/permission/role/RLS/route/form/PDF/signature/workflow-state/payment/treasury change; no legal requirement fabricated**
**Repo state audited:** commit `46f82aa` (post-10.0F-2, CI green)
**Mission:** map the two real paper Finance documents onto the existing Finance-request, Caisse, workflow, audit, PDF, role and approval infrastructure — structured record as the authority, generated PDF as the artifact, visa records as authenticated approvals, versions immutable.

> **Template asset status:** the authoritative paper-template PDF is **NOT present in the repository** (verified: the only PDFs are the three `docs/business-processes/*` guides, none containing the forms — text-scanned for « Autorisation de Dépense », « Bon de Dépense », « Visa DAF/DGA », « Trésorière », « Visa Réception/Comptable » : zero hits). This audit uses the mission's field/visa transcription as the field authority. **Committing the original PDF (or a lossless scan) into the repo as the visual master is the first 11.0B prerequisite** — §9's fidelity plan and §29's pixel-comparison acceptance are defined against that asset.

---

## 1. Executive summary

Three structural verdicts drive everything:

1. **The two documents are NEW entities — the existing `finance_request` cannot carry them.** `finance_request` (migration `20260723000002`) models a *single-checker* maker-checker: exactly one `reviewed_by/reviewed_at/review_note` slot. The paper reality is a **7-visa chain** (Autorisation) and a **6-visa chain** (Bon), and six paper fields have **no column at all** (authorization number, account number, registration number, amount-in-words, type, weight — plus free-text agent name). Forcing the templates into `finance_request` would destroy its ratified « approval ≠ payment » semantics (§2). The documents become a new bounded context (`lib/finance/expense/`) that may *link* to a `finance_request` — never replace it.
2. **The generic workflow engine is the wrong host; a dedicated finance state machine is the platform's own precedent.** The engine's step registry is a hardcoded 26+3-node constant welded to `operational_file` (one `process_instance` per dossier, unique on `file_id`; closure math iterates ALL nodes) — an arbitrary 6-visa chain cannot be registered without editing the global registry and perturbing dossier closure. Meanwhile every comparable document lifecycle here was built as a **self-contained machine**: invoice (`DRAFT→VALIDATED→ISSUED` maker-checker columns + pure predicates + CAS), `finance_request` (pure transition table, one guarded `APPROVED→DISBURSED` edge), `invoice_deposit` (status enum + **append-only custody event chain** — the exact template for a visa ledger). 11.0B replicates the *doctrine* (pure transition table · CAS · maker-checker on identity · reject-creates-new-attempt · append-only events · safe audit), not the engine (§3, §18).
3. **The PDF engine needs ONE new capability, and then Option A (original-as-background + overlays) wins.** The hand-rolled `lib/reports/pdf.ts` is deterministic, draws A4 boxes/lines/Helvetica text at absolute coordinates — but has **no image support whatsoever** (no XObject), no font embedding, no PDF import, and renders `№` as `?`. Adding a minimal **JPEG Image XObject** primitive (DCTDecode passthrough — the smallest possible addition, in keeping with the hand-rolled doctrine) makes the recommended strategy feasible: each template page stored as a high-resolution raster of the original form, laid as the full-page background, with data values overlaid at calibrated coordinates. Fidelity is then *by construction* — the background IS the original (labels, lines, №, logo all come from the scan); overlays carry only values, dates and visa marks (§9). QR and future signature images ride the same primitive.

Actor reality check: of the ~10 distinct visa actors, only **Chef de Transit, Coordonnateur, Opération (≈ OPS_SUPERVISOR) and DG (≈ CEO, labelFr « Direction générale »)** exist as roles. **Trésorière, DAF, DGA, Réception and Comptable are absent** (DAF/DGA/Comptable absent even as labels), and no delegation mechanism exists anywhere (§4, §20). Signature ≠ decoration: the platform stores approvals as `(actor, timestamp, reason)` tuples and has **no signature-image asset, no document hash discipline, no signed-snapshot store** — §5 defines the *authenticated electronic approval* standard 11.0B implements (deliberately NOT claimed as a qualified e-signature).

**Recommendation: GO for 11.0B once DEC-C05…C24 are ratified** — foundation (entities, visa ledger, versions, counters, template registry, roles, permissions, RLS) → 11.0C Autorisation → 11.0D Bon → 11.0E payment gate → 11.0F Treasury → 11.0G verification/governance (§30).

## 2. Existing Finance architecture & the Finance-Request model

**`finance_request` (complete, migration `20260723000002:32-93`):** id, tenant_id, **file_id NOT NULL** (dossier-bound), customs_record_id?, process_decision_id?, category (5-value enum: CUSTOMS_DUTY/AUTHORITY_FEE/SUPPLIER_EXPENSE/INTERNAL_COST/OTHER), amount>0, currency (default XOF), purpose, beneficiary, reimbursable, status (REQUESTED/APPROVED/REJECTED/RETURNED/DISBURSED/CANCELLED — pure table `lib/finance/requests.ts:35-46`, the single `APPROVED→DISBURSED` CAS edge is the duplicate-payment guard), requested_by/at, **one** reviewed_by/at/note, disbursed_* (amount/method/reference/date/by), evidence_* (status NONE/SUBMITTED/VERIFIED/REJECTED + document + verifier), billing_charge_id, dedup_key. RLS = SELECT-only for `finance:read` + `can_read_file`; all writes via `lib/finance/request-actions.ts` (flag-gated `financeExecution`, identity self-review forbidden, CAS, audited).

**Mapping verdict (DEC-C05/C06):**
- An **Autorisation de Dépenses is NOT a finance_request** — one reviewer slot vs seven visas; six paper fields missing; `file_id NOT NULL` conflicts with general company expenses (§13). It is a **separate entity** with an optional `finance_request_id` link (a request raised through the workflow engine's steps 20–26 can *spawn* a formal Autorisation; the reverse import is also possible).
- A **Bon de Dépenses is generated from a fully-approved Autorisation** (§8) — payment-preparation is a distinct document with a distinct chain, exactly as the paper process separates them.
- Current statuses are reusable as *vocabulary inspiration* only; the documents get their own machines (§18). Conflicts with the paper process: no visa chain, no document number, no versioning, no amount-in-words, single evidence slot, dossier-mandatory.

**Existing UI/readers:** `/finance` (queue), `/finance/reconciliation`, `/finance/caisse` (shell), per-file finance panel (`getFinanceState`), tenant-wide `getFinanceRequestQueue` (10.0B), KPI/alert/copilot surfaces. None render the two documents.

## 3. Caisse/Treasury boundary & existing workflow capabilities

**Caisse:** `/finance/caisse` is a **foundation shell only** — the CASHIER role (24th) + `caisse:manage` exist; migration `20260724000001` explicitly creates **no treasury/cash/bank/wallet/cheque/transaction/reconciliation tables**. CASHIER holds `caisse:manage, finance:read, process:read, profile self` and **zero finance authorization** (no validate/payment) — segregation of duties by design. Payments exist (`payment` table: amount, method CASH/BANK_TRANSFER/CHEQUE/WAVE/ORANGE_MONEY/OTHER, paid_at DATE, reversed_at, verification_status; `payment_intent` for online providers; reconciliation reader) but only against **invoices** (customer receivables) — outbound expense execution has only the thin `finance_request.disbursed_*` columns. **Verdict:** payment *execution* for a Bon CAN be implemented before a full Treasury bounded context (11.0E: record execution facts on the Bon + evidence document, mirroring `disbursed_*`), with the real Treasury journal/accounts deferred to 11.0F. The five stages stay separate: authorization (Autorisation chain) → approval (its final DG visa) → payment preparation (Bon + six visas) → payment execution (Caisse, 11.0E) → reconciliation (11.0F). Approval is never payment (existing doctrine, preserved).

**Workflow engine capabilities (audited against the seven questions):** ordered approvals ✅ (per-step `prerequisites` + `prerequisitesMet`, `state.ts:93-130`); step-requires-role ⚠️ (role recorded as data `assigned_role_code`; hard gate is the step's *permission* — `actions.ts:312-313`); several users per role ✅ (role membership); delegation ❌ (none; `process:override` granted to no role); reject/return ✅ (REJECTED terminal per attempt; correction = NEW execution row `correction_of_id`, `actions.ts:382-458`); invalidate a completed signature after edits ❌ (forward-only; `APPROVED/COMPLETED` are dead-ends; no un-approve path); resume after correction ✅ (new attempt). **But** the registry is fixed and dossier-welded (§1.2). **Verdict (DEC-C23): dedicated finance state machine**, replicating the engine's doctrine and reusing its evidence shape (`process_step_execution`'s submitted/reviewed/rejected/override/correction columns) as the design template for the visa ledger.

## 4. Role & permission inventory (signature-actor mapping)

25 tenant roles exist (`lib/platform/role-templates.ts`). The actor-gap table:

| Paper visa | Existing role | Verdict |
|---|---|---|
| **Autorisation** — Visa Demandeur | any staff (requester identity, not a role) | field, not a signatory role |
| Chef de Transit | `CHIEF_OF_TRANSIT` (no finance permission today) | ✅ exists |
| Coordonnateur | `COORDINATOR` (no finance permission) | ✅ exists |
| Opération | `OPS_SUPERVISOR` « Superviseur opérations » | ✅ closest match — **confirm with business** |
| Trésorière | — (CASHIER is a cash *handler*, zero authorization) | ❌ **absent as authorizer** |
| DAF | — | ❌ **absent entirely** |
| DG | `CEO` (labelFr « Direction générale ») | ✅ exists as CEO |
| **Bon** — Visa Agent | `FINANCE_OFFICER` « Agent financier »? `ADMINISTRATIVE_OFFICER`? the Cashier? | ⚠️ ambiguous — **business must name the actor** (DEC-C11) |
| Visa Réception | — (reception exists only as a workflow-handoff concept) | ❌ absent |
| Visa Comptable | — | ❌ absent entirely |
| Visa DAF / Visa DGA | — | ❌ absent entirely |
| Visa DG (CEO signs) | `CEO` | ✅ |

Permission facts: `finance:validate` = FINANCE_OFFICER, OPS_SUPERVISOR, SYSTEM_ADMIN; `finance:payment` = SYSTEM_ADMIN, FINANCE_OFFICER, OPS_SUPERVISOR, COLLECTIONS_OFFICER; `finance:manage` **does not exist**; CEO is read-only governance (`finance:read` only — the DG visa will be its first write-class finance act, a deliberate governance change to surface). **No delegation/acting mechanism exists anywhere** (grep-verified) — §20.

**Proposal (11.0B, not now):** add the minimal missing roles — `TREASURER` (Trésorière), `DAF`, `DGA`, `ACCOUNTANT` (Comptable) — via the standard role-templates + seed parity machinery; map Réception and Agent only after business confirmation (they may be existing seats wearing labels). Visa→role binding lives in the **template signer map** (§10), not hardcoded, so a tenant can rebind without schema change.

## 5. Signature model — authenticated electronic approval

Audited: the platform stores **no signature images** (`workforce_profile` has photo + a signature-*variant* enum for email layouts — no signature asset; no `SIGNATURE` brand-asset kind), **no approval-time document hashes** (sha256 exists only in docintel ingestion; `brand_asset.checksum` nullable/unverified), **no signed snapshots** (append-only stores are event logs: `invoice_deposit_event`, `file_state_transition`, `audit_log`). Approvals today are `(actor_id, timestamp, reason)` tuples.

**The minimum authoritative standard (DEC-C12):** each visa is an **authenticated electronic approval** — explicitly NOT claimed as a qualified/legal e-signature (flagged for Senegal legal verification, §24) — recorded as an immutable `expense_visa` row:
`{ document_type, document_id, document_version, step_ordinal, step_code (e.g. VISA_DAF), signer_user_id, signer_role_code_at_signing, signer_display_name, decision (APPROVED/REJECTED/RETURNED), decided_at, comment?, signature_asset_id? (future), document_sha256, audit_event }` — the `process_step_execution` + `invoice_deposit_event` shapes fused. The five separations hold: decision ≠ identity ≠ signature evidence ≠ snapshot ≠ audit. The signed **PDF version** carries the same sha256; the visa row references the exact version signed.

## 6–7. Ordered chains · edit invalidation

**Order (DEC-C08/C09):** Bon = strictly sequential Agent→Réception→Comptable→DAF→DGA→DG — payment blocked until all six exist **on the same current version**. Autorisation = the printed order Demandeur→Chef de Transit→Coordonnateur→Opération→Trésorière→DAF→DG; whether Trésorière/Opération may run in parallel **cannot be resolved from repository evidence** (visual placement is not proof) — recommended default **strictly sequential**, parallelism only if the business states it. Enforcement mirrors the engine: pure `nextRequiredStep(visas, version)` evaluator + CAS on `(document_id, version, step_ordinal)` + identity rule (a signer cannot hold two visas on the same version unless business explicitly allows — surfaced in DEC-C11's mapping).

**Edit invalidation (DEC-C13):** material fields = amount, currency, beneficiary, account number, dossier link, registration, payment method, reason/purpose, authorization linkage, supporting-document set. Material change ⇒ **new version** (revision counter, invoice precedent) ⇒ visas **from the first affected step onward invalidated** (rows never mutated — new version simply requires new rows; old rows + old signed PDF stay immutable and retrievable) ⇒ chain resumes at the earliest invalidated step. Non-material metadata (internal notes) does not version. **No signed PDF is ever overwritten** — versioned immutable storage paths (brand-asset pattern) + sha256.

## 8. Relationship between the two documents (DEC-C06/C07)

Authoritative lifecycle: **Autorisation approved → Bon created (fields copied) → six visas → READY_FOR_PAYMENT → execution (11.0E) → evidence → reconciliation (11.0F) → closed.** Recommendations: every Bon **must** reference an APPROVED Autorisation (exceptions = a business decision; if allowed, an « urgence » flag + post-hoc Autorisation, audited); **separate number sequences** (N° Autorisation ≠ N° Bon; the Bon carries `N° Demande` = the Autorisation number as a copied reference); copied fields (amount, amount-in-words, beneficiary, account, dossier, registration, reason) are **snapshot-copied and then owned by the Bon** — a divergence beyond tolerance (esp. amount > authorized remainder) is blocked; **one Autorisation MAY generate multiple Bons** (partial payments) with Σ bons ≤ authorized amount — recommended ON (real cash operations pay in tranches) but surfaced for ratification; one Bon settles exactly ONE Autorisation (many-to-one across authorizations rejected — it would break the visa semantics of « this payment was authorized by that document »).

## 9. PDF strategy & template fidelity (DEC-C16)

Engine capability table (verified): A4 ✅ · absolute x/y text ✅ · rects/lines/RGB ✅ · deterministic ✅ · French accents ⚠️ (WinAnsi; `№`→`?`) · **images ❌ (no XObject)** · font embedding ❌ · PDF import/underlay ❌ · QR-in-PDF ❌ · storage of generated PDFs ❌ (streamed/base64 only) · fixed-coordinate form layout helper ❌ (only the flowing `ReportLayout`; `signatureBlock()` is a hardcoded 2-slot).

**Recommendation — Option A via one engine addition:** add a minimal **JPEG Image XObject** primitive to `lib/reports/pdf.ts` (DCTDecode is a raw-bytes passthrough — the smallest possible extension, preserving the hand-rolled no-dependency doctrine), then: template page = **high-resolution raster of the original form** (from the committed master PDF, ~300 dpi JPEG per page, checksummed, versioned) drawn as the full-page background; data values, dates, status marks and visa renderings **overlaid at calibrated coordinates** from the template registry's field map. Fidelity is by construction — labels, ruled lines, logo and `№` glyphs come from the original raster; overlays are values-only (Helvetica is acceptable for handwritten-style field VALUES on a printed form). QR (existing `qrcode` PNG path — convert to JPEG or add PNG XObject if needed) and future signature images ride the same primitive. **Option B** (programmatic redraw) rejected for v1: Helvetica-only + no logo + `№` breakage guarantees visual drift. **Option C** (AcroForm) rejected: no form-field tooling in the engine, and the PDF must be an artifact, not a data store. Storage change: signed/final PDFs must be **stored** (new — private bucket, immutable versioned paths, sha256), not only streamed.

**Fidelity acceptance (§29, DEC ratifiable):** same page size/orientation; all labels/lines/visa boxes from the original raster; field values inside their boxes, unclipped (overflow → font-size step-down rule, then reject); deterministic bytes for identical input; **automated rendered-image comparison against the committed master** (pixel-diff threshold on rasterized output) + manual Finance sign-off on printed copies.

## 10–12. Template registry · field catalogs · numbering

**Registry (11.0B, code-managed — DEC-C24-adjacent):** `EXPENSE_AUTHORIZATION` + `EXPENSE_VOUCHER`, each version = { code, version, source master reference, page raster asset(s), checksum, field-coordinate map, visa-box coordinate map, signer map (step→role), active_from, retired_at, status }. First release: **code-managed immutable assets** (the platform's registry idiom — process/queues/codes are code constants) — a DB registry only when tenants need divergent templates.

**Field catalogs** (classification: U=user-entered, C=copied, S=system, D=derived, G=signature-generated):

*Autorisation:* N° autorisation **S** (counter, at submission) · N° compte **U** (ambiguous — accounting vs treasury account: **business confirmation required**) · N° dossier **C** (from `operational_file.file_number`, optional per §13) · N° immatriculation **U/C** (ambiguous — vehicle plate (`transport_record.vehicle_plate` free text) vs registry number: **confirm**) · Montant **U** · Montant en lettres **D** (French number-to-words util — new, pure, tested) · Bénéficiaire **U** · Type **U** (map to/extend `FINANCE_CATEGORIES` or free text: **confirm**) · Poids **U/C** (shipment weight? **confirm**) · Motif **U** · Nom de l'agent **U/C** (requester display name) · Demandé par **S** (authenticated requester) · 7 visa areas **G**.

*Bon:* N° bon **S** · N° demande **C** (Autorisation number) · N° compte/dossier/immatriculation/montant/montant-en-lettres/bénéficiaire-destination/motif **C** (snapshot-copied, version-owned) · Mode de paiement **U-before-signatures** (§22) · Saisi par **S** · 6 visas **G**.

**Numbering (DEC-C14):** reuse the proven counter RPC pattern (`next_invoice_number`: per-tenant, year in PK ⇒ yearly reset, atomic ON CONFLICT, gaps allowed, never reused, service-role-only): `next_expense_authorization_number` → `EFT-AUT-YYYY-00001`, `next_expense_voucher_number` → `EFT-BON-YYYY-00001`. Assigned **at submission** (invoice-at-issuance precedent — drafts carry no number), immutable thereafter, unique per tenant+type, cancelled numbers never reused.

## 13–14. Dossier linkage · supporting documents

**Linkage (DEC-C15):** the templates carry dossier fields, but `finance_request.file_id NOT NULL` already forces every expense onto a shipment — the audit recommends the new entities support **both** `DOSSIER_LINKED` (file_id set, visible in dossier finance context) and `GENERAL_ADMINISTRATIVE` (file_id null — rent, utilities, supplies), because the paper form does not structurally forbid it and general expenses demonstrably exist in any operating company. Beneficiary is free text v1 (supplier registry = future); customer/supplier/treasury-account entities deferred to 11.0F.

**Supporting documents:** `document` is **strictly dossier-bound** (`file_id NOT NULL`, RLS inherits dossier visibility) — unsuitable for confidential Finance evidence on general expenses and wrong visibility class even for dossier-linked ones (all dossier readers would see supplier quotes). **Recommendation (DEC-C22):** a dedicated `expense_document` attachment table + a **finance-classified private path** (own prefix or dedicated private bucket, HR-2 precedent), server-mediated 60-s signed URLs (existing `lib/documents/storage.ts` idiom), finance-permission-gated, versioned by re-upload (immutable paths). Required attachments per category (invoice/quote/receipt; payment proof at execution) = business matrix confirmed in 11.0B.

## 15–17. Print/export · verification/QR · visa rendering

**Print/export:** preview + print + download at every stage; status treatment as controlled overlays on the faithful template: `BROUILLON` / `EN ATTENTE DE SIGNATURES` / `REJETÉ` / `ANNULÉ` as diagonal watermarks on draft/partial/terminal copies (DEC-C17 — recommended ON); the final approved copy **unwatermarked** except a small verification footer; every version retrievable (immutable stored artifacts).

**Verification/QR (DEC-C18):** the platform already has the ideal pattern — CSPRNG opaque token + uniform-404 public route + QR encoding only the URL (`workforce_profile.public_card_token` / `/card/[token]`). Recommended: **defer QR to 11.0G** (first release must not disturb template fidelity); when added, a small controlled footer (number · version · generated-at · sha256 prefix · QR to a `/verify/[token]` route) — never altering the form body.

**Visa-box rendering (DEC-C19):** smallest familiar rendering per signed box — **« Approuvé » mark + signer display name + date** (3 Helvetica lines, calibrated to each box), with the full evidence (role, comment, hash, audit) in the platform, not printed. Optional signature-image asset (a future `workforce_profile`/brand-asset addition) drops into the same box via the image primitive when available — evidence rows stay authoritative regardless (a signature image is never the approval).

## 18–19. State machines · rejection/return

**Autorisation:** `DRAFT → SUBMITTED (number minted) → IN_APPROVAL → APPROVED | REJECTED | CANCELLED`, with `RETURNED` → new version → re-enters at the first invalidated visa; `SUPERSEDED` marks replaced versions. **Bon:** `DRAFT → IN_SIGNATURE (number minted at submission) → FULLY_SIGNED → READY_FOR_PAYMENT → PAID → RECONCILED → CLOSED`, plus `RETURNED/REJECTED/CANCELLED/SUPERSEDED`. Two separate status fields on two separate tables (DEC-C05) — never one combined field. Both as pure transition tables + CAS actions (the `requests.ts` idiom), with DB CHECK constraints as backstop.

**Rejection/return (DEC-C13-adjacent):** any pending-step signer may REJECT (reason mandatory — the audit fail-closed rule already enforces reasons on overrides) or RETURN for correction; rejection is terminal for the version (document may be superseded by a corrected new version — the correction-as-new-attempt engine precedent); return creates the corrected version; visas before the changed step **remain valid on re-approval only if the change is immaterial to them** — recommended conservative default: material change invalidates from the first affected step (amount changes invalidate everything after Demandeur). All prior versions + visas retrievable forever.

## 20–22. Delegation · payment gate · payment methods

**Delegation (DEC-C20):** none exists; DAF/DGA/DG are single seats, so absence coverage is a real operational need. Recommendation: **defer to 11.0G** with an explicit, time-bounded, role-bound, audited `signer_delegation` record (grantor, grantee, step scope, from/to, reason) — never « any admin may sign »; v1 relies on the role having ≥1 active holder.

**Payment gate (DEC-C21):** `Bon.status = READY_FOR_PAYMENT` ⟺ current version + all six visas APPROVED on that version + not rejected/cancelled/superseded. The Cashier's `/finance/caisse` queue lists **only** eligible Bons (read + execute; `caisse:manage`); the Cashier holds **no visa** unless the business explicitly maps Visa Agent to the Cashier (DEC-C11 — do not infer; the CASHIER's zero-authorization design argues Agent is a Finance actor, not the Cashier).

**Payment methods (DEC-C10):** platform supports CASH/BANK_TRANSFER/CHEQUE/WAVE/ORANGE_MONEY/OTHER (payment + `finance_request.disbursement_method` checks); **Free Money is absent** → add to the method enum in 11.0B (additive check widening). Recommended: the approved method is **part of the signed Bon** (selected before signatures); execution records the **actual** method; a mismatch requires a controlled amendment (new version + re-approval from the first affected visa) — never a silent divergence.

## 23–26. Audit/redaction · retention · permissions · RLS

**Audit events (safe-metadata doctrine, existing `writeAudit` conventions):** created / submitted / visa-approved (step code + signer id) / returned / rejected / version-created / pdf-generated / exported-printed / fully-signed / payment-enabled / paid / reconciled / cancelled — payloads carry ids, step codes, statuses, hashes, durations; **never** signature bytes, banking references, supplier bank details, sensitive comments, raw PDF content or attachment contents.

**Retention (DEC-C24):** archive-not-delete for anything ≥ SUBMITTED (8.1A doctrine); cancellation logical-only; superseded versions retrievable; signed artifacts checksum-verified on read. **Senegal/OHADA accounting-retention durations are NOT encoded** — flagged for external legal verification (commercial-document retention, e-signature status, tax-evidence rules).

**Permissions (11.0B proposal, aligned with `resource:action` convention):** `finance:expense:read`, `finance:expense:create`, `finance:expense:submit`, `finance:expense:sign`, `finance:expense:export`, `finance:expense:execute` (execute → CASHIER; sign → the visa roles). Step authorization = **generic `finance:expense:sign` + the template signer map (step→role) enforced at sign time on role AND identity** — the engine's exact layering (permission gate, role as data, identity maker-checker), avoiding six per-step permissions.

**RLS:** every table tenant-scoped (`auth_tenant_id()`/`has_permission()` helpers suffice); reads gated `finance:expense:read` (+ dossier visibility only for dossier-linked docs — general expenses are finance-only); signers may read documents awaiting their step; cashier sees READY_FOR_PAYMENT; visa rows + version rows + stored PDFs append-only (`prevent_mutation` triggers, the `invoice_deposit_event` pattern); attachments in the finance-classified private path; all app_user FKs tenant-matched (invoice actor-tenant trigger precedent).

## 27–28. UI surfaces · notifications

**Routes (11.0C/D, not now):** `/finance/autorisations-depenses` + `/[id]`, `/finance/bons-depenses` + `/[id]` (French route naming matches `/finance/caisse` precedent; English equivalents acceptable if the repo prefers — decision left to 11.0C). Surfaces: list (status filters), create/edit form, detail with **approval timeline** (visa ledger), PDF preview (exact template), sign action (current-step holder), print/export (version picker), payment-eligibility banner. Cashier queue lives in `/finance/caisse`.

**Notifications:** the existing `createNotification` + comms infrastructure can notify the next signer (submitted / signature-required / returned / rejected / fully-signed / ready-for-payment / paid) — content = document number + step only; **never** amounts, signature images or beneficiary banking details in an email. Implementation deferred to 11.0C/D.

## 29. Security & privacy threat model

Cross-tenant leakage (tenant triggers + RLS + scoped storage paths) · finance data leaking to dossier readers (dedicated visibility class, §14) · forged visas (CAS on step ordinal + identity + role check + append-only ledger) · signed-PDF tampering (immutable paths + sha256 verify-on-read) · number forgery (service-role-only counters) · privilege escalation via UI (server actions re-assert; navigation is never authorization) · signature-image misuse (images decorative-only; approval = the ledger row) · export leakage (audited exports; watermarked non-final copies) · token/QR enumeration (CSPRNG + uniform 404, card precedent) · AI exposure (expense documents join copilot context only as counts, never amounts/beneficiaries — 10.0F redaction doctrine).

## 30. Decisions requiring ratification (DEC-C05 … DEC-C24)

| # | Decision | Recommendation |
|---|---|---|
| C05 | Two separate entities? | **Yes** — `expense_authorization` + `expense_voucher`, own tables/machines; optional `finance_request` link |
| C06 | Every Bon from an approved Autorisation? | **Yes**; exceptions only via an explicit audited « urgence » flow if business demands |
| C07 | One Autorisation → multiple Bons? | **Yes** (partial payments, Σ ≤ authorized); one Bon settles one Autorisation |
| C08 | Autorisation chain strictly sequential? | **Yes by default** — parallelism only on explicit business statement (not inferable from the form) |
| C09 | Bon six-visa chain strictly sequential? | **Yes** — payment gated on all six on the same version |
| C10 | Payment-method change after approval? | Method is part of the signed document; change ⇒ amendment + re-approval from affected step |
| C11 | Visa→role mapping | Chef de Transit→CHIEF_OF_TRANSIT, Coordonnateur→COORDINATOR, Opération→OPS_SUPERVISOR (confirm), DG→CEO; **create TREASURER, DAF, DGA, ACCOUNTANT roles (11.0B)**; **business must name Visa Agent + Réception** (Agent is likely NOT the Cashier) |
| C12 | Signature standard | **Authenticated electronic approval** (visa ledger row + version + sha256 + audit); NOT claimed as qualified e-signature pending legal review |
| C13 | Edit invalidation | Material edit ⇒ new version ⇒ visas from first affected step invalidated; signed PDFs immutable |
| C14 | Number assignment | At **submission**, counter-RPC pattern, `EFT-AUT-…`/`EFT-BON-…`, yearly reset, never reused |
| C15 | General non-dossier expenses? | **Allowed** (file_id nullable on the new entities; finance-only visibility) |
| C16 | PDF strategy | **Option A**: original-page raster background + coordinate overlays, via ONE engine addition (JPEG Image XObject); master PDF committed to repo first |
| C17 | Watermarks | Draft/partial/rejected/cancelled watermarked; final approved clean + verification footer |
| C18 | QR now? | **Deferred to 11.0G** (fidelity first); card-token pattern when added |
| C19 | Visa-box rendering | Mark + name + date; signature image optional later; ledger is the authority |
| C20 | Delegation | **Deferred to 11.0G**; explicit, time-bounded, role-bound, audited when built |
| C21 | Approval vs execution permissions | Separate: `finance:expense:sign` (visa roles) vs `finance:expense:execute` (CASHIER) |
| C22 | Supporting documents | Dedicated finance-classified attachment table + private path — NOT the dossier-bound `document` table |
| C23 | Engine vs dedicated machine | **Dedicated finance state machine** (engine registry-fixed + dossier-welded; invoice/request/deposit precedents) |
| C24 | Immutability/retention + legal | Archive-not-delete, checksum-verified, logical cancellation; **Senegal/OHADA retention + e-signature status = external legal verification before 11.0G** |

## 31. Exact implementation files for 11.0B · acceptance · roadmap

**11.0B (foundation):** migration `expense_documents` (expense_authorization, expense_voucher, expense_visa append-only, expense_document_version, expense_attachment, counters + RPCs, RLS, tenant/append-only triggers, +FREE_MONEY method) · `lib/finance/expense/{types,transitions,visa,actions,service,numbering}.ts` (pure tables + CAS actions + readers, request-actions idiom) · role-templates + seed: TREASURER/DAF/DGA/ACCOUNTANT + `finance:expense:*` permissions (parity-tested) · template assets: committed master PDF + page rasters + coordinate maps under `lib/finance/expense/templates/` · `lib/reports/pdf.ts` additive JPEG XObject primitive + fixed-coordinate form helper · amount-in-words pure util · tests (transitions, visa ordering, CAS, RLS suite additions, counter, pdf primitive, template checksum). **Explicitly not in 11.0B:** routes/forms (11.0C/D), payment execution (11.0E), treasury (11.0F), QR/delegation (11.0G).

**Audit acceptance (this phase):** all mission sections covered with file:line evidence ✅ · template-fidelity plan defined against the to-be-committed master ✅ · 20 decisions surfaced ✅ · documentation-only ✅ · gates green ✅.

**Roadmap confirmed as proposed:** 11.0A audit → **11.0B foundation** → 11.0C Autorisation (form/workflow/PDF) → 11.0D Bon (six visas/PDF) → 11.0E payment gate & Caisse execution → 11.0F Treasury foundation → 11.0G verification & governance (QR, hashes-verify route, delegation, retention after legal review). **Precondition for 11.0B: commit the original template PDF as the visual master and confirm the ambiguous fields (§10-12) + the Visa Agent / Réception / Opération actor identities with the business.**
