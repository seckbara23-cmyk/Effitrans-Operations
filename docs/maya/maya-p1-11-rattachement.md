# MAYA-P1.11 — Rattachement (CEO step 9): implemented

**Date:** 2026-08-14 · **Baseline:** `3fcb01e` · **Migration 106** · **Ledger 105 → 106.**

**Classification after census: D — fully defined missing durable capability.**
The step, its owner, its permission and its evidence document type all existed.
Only the fact was missing.

---

## 1. The business authority

Effitrans answered the eight questions P1.3 raised:

| | |
|---|---|
| Documents | « **Facture, BL, toutes autorisations nécessaires** » |
| Actor | « **Le déclarant** » |
| Nature | « Il scanne les documents et **fait lui-même le rattachement** » |
| Systems | « **Dans GAINDE et dans ORBUS** » |
| Success | « Tous les documents rattachés sont **visibles dans le système** » |
| Evidence | « **Peut-être** faire une capture d'écran » |
| Failure | « la déclaration sera bloquée … recevabilité, **le déclarant rattache de nouveau** » |
| API | « **Non** » |

## 2. The mapping conflict P1.3 could not resolve — resolved

P1.3 stopped partly because two artifacts disagreed on which step CEO 9 is: the
phase-9 architecture doc mapped it to an engine step **`electronic_attachment`
that was never built**.

The ratified answers settle it. Registry step 11 `gainde_document_submission`
already says all of it:

* `role: CUSTOMS_DECLARANT` — « le déclarant »
* label « **Déclarant — introduire les documents dans GAINDE** »
* internalLabel « **jalon MANUEL** » — matches « Non » to synchronisation
* `prerequisites: ["coordinator_to_declarant", "gainde_registration"]` — after
  CEO step 8 (Finance), exactly as the CEO chain orders it
* `nextSteps: ["customs_followup"]` — then the BAE at CEO step 10
* `requiredDocuments: ["GAINDE_SUBMISSION_EVIDENCE"]` — the screenshot slot,
  already in the catalog
* `permissions: ["customs:update"]` — which CUSTOMS_DECLARANT already holds

**There was never a missing step. Only a missing fact.**

## 3. What was added, and why nothing existing would do

Migration 106 adds three columns to `customs_record`:

| Column | Registry's requiredEvidence |
|---|---|
| `attachment_completed_at` | `submission_date` |
| `attachment_completed_by` | `submitted_by` |
| `attachment_systems text[]` | the ratified GAINDE / ORBUS context |

Every existing candidate was rejected for cause — reusing any would be the proxy
MAYA-P1.2 removed:

| Field | Why not |
|---|---|
| `declaration_number` / `external_ref` | the Declarant's paperwork and the GAINDE reference — neither is an attachment |
| `gainde_registered_at/_by` | **Finance's** act (CEO step 8, P1.1) |
| `submitted_at` | the Customs **Intelligence** provider clock (7.1B) — inviting and unrelated |
| `bae_reference` / `release_date` | CEO step 10, downstream |

Two CHECKs: the instant and its author move together, and `attachment_systems`
is non-empty and a subset of `{GAINDE, ORBUS}`.

## 4. Authority — `customs:update`, and nothing new

It is the permission **registry step 11 already declares**, held by
`CUSTOMS_DECLARANT` — the actor Effitrans named. No permission was created, no
role widened: every holder of `customs:update` could already edit this record.
The RPC re-asserts it in the database through `assert_actor_authority` (INV-7).

**No maker-checker.** Effitrans described the Declarant doing this himself; a
second signature would be invented authority.

## 5. Retry — the ratified failure path

`record_gainde_registration` refuses a duplicate reference. This RPC
**deliberately does not**, because a second attempt after a recevabilité
rejection is normally the *same* documents in the *same* systems — refusing an
identical repeat would block the exact retry Effitrans described.

Every attempt emits `CUSTOMS_ATTACHMENT_RECORDED` with `repeated: true|false`,
so **history is preserved rather than overwritten**.

**Recevabilité does not mutate the attachment**, and the attachment does not
decide recevabilité. Separation of concerns is intact: a rejection is recorded
where it happens (`receivability_status = NON_RECEVABLE`, P0.7-A), and the
Declarant re-records the attachment when he has redone it.

## 6. Process projection

`gainde_document_submission` becomes the **sixth** fact-provable step, through
the existing WES-5 reconciliation — no second completion mechanism. The rule
reads `attachmentCompletedAt` **and nothing else**, so none of the declaration,
the GAINDE registration, the BAE or the release can complete it. `started` reads
the GAINDE registration, because that is the prerequisite the registry names —
and IN_PROGRESS completes nothing.

## 7. Screenshot evidence — supported, never required

`GAINDE_SUBMISSION_EVIDENCE` (« Preuve de dépôt des documents GAINDE ») already
exists and is already step 11's `requiredDocument`, so a screenshot attaches
through the ordinary document path. **It is never a precondition of recording
the act** — « peut-être » is not a rule, and no new evidence subsystem was built.

## 8. What it does not do

No status transition · no `provider_code` / `provider_synced_at` · no
`intel_status` · no other customs act touched · **no claim of synchronisation**.
BLK-1 stands, and the UI says so in French: « la plateforme enregistre
l'opération déclarée ; elle ne la vérifie pas et ne se synchronise avec aucun
système douanier ».

## 9. Legacy dossiers

**Nothing back-filled.** No declaration number, external ref, customs status,
GAINDE registration, BAE, release date or `updated_at` proves this act.
Historical unknown stays unknown. Production carries **zero** attachments today,
so no dossier is affected and no conflict is created.

## 10. Operator action

Migration 106 must be applied — see the phase report. It is re-run safe.
