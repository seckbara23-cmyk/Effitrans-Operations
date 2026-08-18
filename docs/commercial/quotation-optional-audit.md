# Devis facultatif — audit d'impact (QO-0)

**Date:** 2026-08-18 · **Statut: AUDIT ONLY — nothing implemented.**
**Business rule ratified by Effitrans:** a dossier may be created WITH or WITHOUT a
quotation; creation must never be blocked solely because no quotation exists; the
quotation workflow is preserved; a dossier without quotation must read as
« Sans devis », not as missing data; later Finance/billing requirements do not
disappear because the dossier began without a quotation.

## 1. Verdict first

**GO — and the architecture already ratifies ~90 % of this rule.** Creating a
dossier without a quotation is the *native* path today: nothing in the schema, in
`createFile`, in the process engine, or in Finance requires a quotation to exist.
The audit found **two real gaps**, both presentational/audit-honesty, **zero
schema change** required, and **no interaction with TMS-1 migration 115 or its
UAT** — this is a separate upstream workflow correction that can safely land
*after* TMS-1 production UAT.

## 2. Trace — what the platform actually does

| Surface | Finding |
| --- | --- |
| **DB constraints** | `operational_file` has **no quotation column at all**. The only dossier↔devis link is `quotation.converted_file_id` (nullable, partial-unique, `references operational_file`) — recorded on the *quotation* side, EC-3D rule « Commercial never owns Operations ». The only `NOT NULL` FKs touching quotation are internal to the commercial aggregate (`quotation.request_id`, `quotation_line.quotation_id`). `invoice` has **no quotation FK**. `client_notification.quotation_id` is nullable. |
| **createFile** | Signature `{type, clientId, priority}` — no quotation parameter, no quotation check. Unchanged by TMS-1 except that it no longer crowns the creator as Responsable client. |
| **Dossier creation UI** | `app/files/new` creates directly; the form never mentions a devis and blocks nothing. |
| **Quotation → dossier conversion** | EC-3D `convertQuotationToDossier` calls the *same* `createFile`, then `quotation_record_conversion` (QT616 refuses non-ACCEPTED, QT617 cross-tenant). This lane is preserved untouched by the new rule. |
| **Process gates** | Registry step 1 `cotation` says itself: « Étape applicable uniquement aux clients SANS contrat »; completion rule `quotation_approved_or_client_under_contract`. The engine's `openDossierWorkflow` **skips cotation by default** via `skipStep(fileId, "cotation", {reason, source: "MANUAL"})` → state `SKIPPED` (counts as done for prerequisites), audited `PROCESS_STEP_SKIPPED`, reversible `SKIPPED → PENDING` with its own reasoned, audited reopen. |
| **Finance / invoicing** | Facturation and the two completeness controls require `FINAL_INVOICE`, `RECEIPT`, `PAYMENT_PROOF` — never `QUOTATION`. Document types `QUOTATION`/`QUOTATION_APPROVAL` are `conditional: true`, `required_for: '{}'`, referenced only by step 1. Deposit/collections gates do not read them. **The caution in the rule holds by construction**: Finance obligations are anchored to the dossier and its invoices, not to the devis. |
| **Permissions / RLS** | No change needed to create without a quotation. Constraint for the display fix: quotation reads from the dossier page must respect commercial read (DEC-C32) or use an admin-client read behind its own app gate (EC-3C rule). |
| **State machine** | `SKIPPED` is a first-class terminal-ish state with reopen; nothing treats an unperformed cotation as an error. |
| **Tests / assumptions** | `tests/operations-intake.test.ts` case 37 pins the current hard-coded skip wording (`"sans cotation préalable"`); `tests/intake-entry-step.test.ts` exercises both `skipCotation` branches. No test assumes a quotation is mandatory for a dossier. |
| **TMS-1 / migration 115** | **No interaction.** Migration 115 touches `account_manager_id`, `assignment_event`, `permission`/`role_permission` — none of the quotation tables. TMS-1 UAT step 1 (direct creation) *is* the sans-devis path and already works end-to-end. A dossier converted from a devis now also arrives « À affecter », which is exactly the ratified invariant (the Ops Manager designates, whatever the origin). |

## 3. Existing mechanism — the reuse answer

**An appropriate, auditable reason/exception mechanism already exists and must be
reused, not duplicated:** `skipStep` records `SKIPPED` + a free-text reason + a
source on the cotation `process_step_execution`, writes the
`PROCESS_STEP_SKIPPED` audit row, and supports a reasoned, audited reopen. No new
table, column, flag, or event type is needed to record *why* a dossier has no
devis.

## 4. The two real gaps

**Gap A — the recorded reason is presumptuous.** `openDossierWorkflow` hard-codes
one wording for every skip: « Ouverture directe — dossier sans cotation préalable
**(client sous contrat)** ». Under the clarified rule, contract clients are only
*one* legitimate cause. Worse, a dossier converted from an ACCEPTED devis gets the
same wording — recorded as a contract-client case when a devis in fact exists.
The audit trail is honest in mechanism but wrong in content.

**Gap B — « Sans devis » is invisible.** No dossier-side surface shows commercial
origin. A sans-devis dossier is indistinguishable from missing data (the exact
condition the rule forbids), and a converted dossier's devis is only visible from
`/commercial/quotations/[id]`, never from the dossier.

## 5. Smallest-change plan (QO-1, when ratified — code only)

1. **Honest skip reason, derived not asked** (`lib/process/engine/intake-actions.ts`):
   at opening, reverse-look-up `quotation where converted_file_id = fileId`
   (admin client, tenant-scoped). If found → skip reason « Devis N°X accepté —
   cotation réalisée côté commercial ». Else → neutral « Ouverture directe —
   dossier sans devis. » plus an *optional* operator-supplied precision from the
   intake panel (free text lands in the step execution's reason, the platform's
   existing quarantine for free text). No new UI mode; one optional field.
2. **« Origine commerciale » on `/files/[id]`**: one line in the dossier header
   area — « Devis N°X » (linked only for readers holding commercial read,
   DEC-C32) or an explicit « Sans devis » badge with the recorded reason.
   Admin-client read behind the page's existing gate (EC-3C). The customer
   portal shows **nothing new** (internal reasons are withheld — same doctrine
   as TMS-Q7).
3. **Historical dossiers**: step executions already written keep their wording —
   history is never rewritten (WES-9A doctrine). The origin line still renders
   correctly for them (reverse lookup is state-based, not wording-based).

**Explicitly NOT done:** no `quotation_id` column on `operational_file` (the
EC-3D direction of ownership is preserved); no new permission; no new event
type; no change to `quotation_record_conversion`, QT616/617, or the conversion
action; no weakening of any quotation feature.

## 6. Affected invariants — all preserved

Commercial-never-owns-Operations (EC-3D) · QT616/617 conversion guards ·
skip-with-reason mechanism (reused, not replaced) · history never rewritten ·
portal withholds internal notes · TMS-1 invariant (creator ≠ Responsable client;
designation via the one RPC) untouched.

## 7. Migration implications

**None.** No schema change, no seed change, no RPC change, no RLS change.
QO-1 is TypeScript + UI + tests only. Migration 115 remains the pending operator
apply, unaffected.

## 8. Tests / UAT required for QO-1

- Move the wording pin in `tests/operations-intake.test.ts` case 37 to the new
  derived reasons (both branches: converted vs sans devis) — a deliberate pin
  move, dated, like the six TMS-1 moves.
- New vitest: origin line renders « Devis N°X » for a converted dossier,
  « Sans devis » + reason otherwise; portal projection unchanged; commercial
  link gated on commercial read.
- No SQL suite change (no schema/RPC change).
- Operator UAT: create direct → « Sans devis » visible with honest reason;
  convert an ACCEPTED devis → origin shows the devis number from the dossier;
  one historical dossier → origin renders, history wording untouched.

## 9. Sequencing determination

**This does NOT need to be resolved before TMS-1 production UAT.** Different
tables, different UI blocks, no shared migration. Recommended order: operator
applies migration 115 → TMS-1 production UAT → QO-1 as its own small phase on
explicit GO.
