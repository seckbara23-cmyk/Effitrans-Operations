# Phase 11.0C — Autorisation de Dépenses : workflow & exact-template PDF

**Date:** 2026-07-26 · **Depends on:** 11.0A (architecture audit), 11.0B (foundation — data model, state machines, permissions, roles, RLS, JPEG XObject primitive)
**Scope:** the first *usable* Finance document — create → edit → save → submit, supporting documents, and a printable A4 reproduction of the paper form.
**Out of scope (11.0D+):** the six/seven-visa signing workflow, visa-ledger writes, DAF/DGA/DG/Comptable approval, payment execution, cashier queue, QR, delegation, watermarking, electronic signatures.

---

## 1. Open conflict — the master template asset (MUST READ)

**The authoritative paper-template asset is still NOT in the repository.**

| Source | What it says |
|---|---|
| 11.0A §8 | « Committing the original PDF (or a lossless scan) into the repo as the visual master is the **first 11.0B prerequisite** » |
| 11.0A §31 | Listed under *Business blockers* as a prerequisite; 11.0A §209 repeats it under « still outstanding » |
| 11.0B `templates.ts` | Ships `EXPENSE_TEMPLATES = []` — « the master template PDF is not yet in the repo (an 11.0C prerequisite) » |
| Repo, verified 2026-07-26 | `git ls-files` finds three unrelated process guides and five app icons; no untracked candidate either |

The 11.0C mission statement instructed « use the master template committed for 11.0B ». **No such asset was ever committed.** Per the phase constraint (« if an implementation decision conflicts with the existing finance doctrine, stop and document the conflict »), this was raised before any renderer code was written, and the ratified direction is recorded here.

**Resolution taken (operator decision, 2026-07-26):** build the full DEC-C16 coordinate engine now, with the raster background as a registered, currently-empty slot.

The renderer draws in three layers:

| Layer | Source | Today |
|---|---|---|
| 1 · background | the registered raster of the original page, via the 11.0B JPEG Image XObject primitive | **absent** — `EXPENSE_TEMPLATES[0].background === null` |
| 2 · chrome | frame, ruled cells, printed captions, visa grid — drawn from the coordinate map | **active**, standing in for the scan |
| 3 · values | the document's data — drawn from the **same** coordinate map | active |

**Why this is not a redesign.** Layers 2 and 3 read one map (`lib/finance/expense/template-map.ts`). Registering the scan turns layer 1 on and layer 2 off; **no value coordinate moves**. Recalibrating against the real form is then a data edit in that one file — never a change to the renderer, the document code or the schema.

**What is consequently still owed** (carried into 11.0D, not silently dropped):
1. Commit the master scan (≈300 dpi baseline JPEG per page) and register it — `checksum` + `background` on the registry entry and on the `expense_template` row.
2. Calibrate the field/visa coordinates against it.
3. Run the 11.0A §29 acceptance: automated pixel-diff of the rendered page against the master, plus manual Finance sign-off on printed copies.

Until step 3 passes, the claim is **« structurally faithful — every paper field, in the paper's order, on A4 at 1:1 »**, not « pixel-identical to the original ». Stating that distinction is the point of this section.

**Also outstanding, unchanged:** BLK-FIN-1 (VISA_RECEPTION signer) and BLK-FIN-2 (VISA_OPERATIONS signer). Neither blocks 11.0C — no visa is written in this phase — and both are surfaced in the UI as « Signataire non configuré » rather than hidden.

---

## 2. What shipped

### Workflow — draft lifecycle

```
create draft ──► edit ──► save ──► submit ──► read-only (SUBMITTED)
   no number        (in place)      mint N°, freeze v1, CAS
   no version                        │
                                     └─► RETURNED ──► save ⇒ NEW immutable version
```

`saveExpenseAuthorization` is the single entry point and owns the versioning rule, so the UI cannot get it wrong:

* **before** the first frozen version exists → the working head is updated **in place**, CAS-guarded on status. A draft carries no number and no version (DEC-C14, invoice-at-issuance precedent): an author's typing does not mint history.
* **once** a version exists (the RETURNED correction path) → the call is routed to the existing `createExpenseAuthorizationVersion`, which freezes a NEW immutable version and supersedes any open approval attempt (DEC-C13).

Nothing is duplicated: one freeze implementation, one supersede implementation, both from 11.0B.

### Fields — the complete paper form

| Paper field | Storage | Class |
|---|---|---|
| N° autorisation | `authorization_number` (minted at submission) | S |
| Date | `created_at` | S |
| N° compte | `account_number` (flexible text, DEC-C25) | U |
| N° dossier | `file_id` → `operational_file.file_number` | C |
| N° immatriculation | `registration_number` (flexible text) | U |
| Type | `expense_type` (flexible text, DEC-C25) | U |
| Poids (KG) | `weight_kg` (optional decimal ≥ 0) | U |
| Bénéficiaire | `beneficiary` | U |
| Montant / Devise | `amount`, `currency` | U |
| **Montant en lettres** | `amount_in_words` | **D — derived** |
| Nom de l'agent / Demandé par | `requested_by` → display name | S |
| Observations / Motif | `reason` | U |
| Pièces jointes | `expense_attachment` (new) | U |
| 7 visa boxes | printed empty; ledger is 11.0D | G |

**« Montant en lettres » is derived, not typed.** `amountInWordsFr(amount, currency)` is the single source: the form previews it, the action stores it, the PDF prints it. `amountInWords` was removed from the action's input contract so no caller can set it — a changed amount can never leave stale words behind on a payment document. The French orthography that actually matters is unit-tested (70/80/90 forms, `cent`/`vingt` plurals, `mille` invariable, and the rule that drops the -s before `mille` but keeps it before `millions`).

**« N° dossier » is entered as the human key**, exactly as on paper, and resolved tenant-scoped to `file_id`. An unknown number is rejected loudly (`unknown_file`); an empty one clears the link, which is the general-administrative expense DEC-C15 allows.

### Supporting documents (DEC-C22)

A dedicated `expense_attachment` table plus its own private `finance-expense` bucket — deliberately **not** `public.document`, whose `file_id NOT NULL` cannot carry a general expense and whose RLS would show supplier quotes to every dossier reader. The storage doctrine is the platform's existing one, unchanged: deny-by-default bucket with no authenticated-facing policies, service-role-mediated uploads, tenant-partitioned UUID object keys, 60-second signed download URLs minted per request. Attachments are **retired, never deleted**, and may only change while the parent document may change. The table already carries the `voucher_id` parent + one-parent CHECK, so 11.0D reuses it with no schema change.

### PDF

Rendered by the hand-rolled engine — no HTML-to-PDF, no headless browser, no screenshot. A4 portrait at 1:1 with no scaling factor anywhere, deterministic (identical input ⇒ byte-identical output), values confined to their cells with a font-size step-down before any truncation, and every truncation **reported** to the caller (`overflowedFields`) rather than silently clipped. Status is stated plainly in the title band; no watermark machinery ships (DEC-C17 is 11.0D).

---

## 3. Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | **3297 passed / 159 files** (+66 new, +1 modified suite) |
| Production build | compiled; 4 new routes emitted |
| RLS | `supabase/tests/rls_expense_attachments_test.sql`, wired into CI |

Notable guards added: no drawn text may land outside the form frame (parsed out of the content stream); the coordinate map's boxes must tile the frame without overlap; no 11.0C audit payload may contain amount / beneficiary / account / registration data; every scoped finance permission used must exist in the catalog.

---

## 4. Decisions

Recorded in `docs/decision-register.md` as **DEC-C26 … DEC-C29**.
