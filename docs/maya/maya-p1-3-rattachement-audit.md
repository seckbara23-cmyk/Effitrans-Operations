# MAYA-P1.3 — Rattachement (CEO step 9): audit

**Date:** 2026-08-13 · **Baseline:** `61a2845` (P1.2) · **Ledger:** 105/105 · **No migration.**

**Classification: E — BUSINESS DEFINITION REQUIRED**, with a secondary **F** on
which registry step CEO step 9 maps to at all.

Nothing was implemented. This document records what the evidence does and does
not establish, so the next attempt starts from here rather than from the name.

---

## 1. What is ratified

Only three things, all from the CEO workflow:

| | |
|---|---|
| **Owner** | Déclarant |
| **Order** | after Finance records the GAINDE registration, before the BAE / field stage |
| **Act** | « rattachement » |

Everything else had to be discovered. Most of it was not found.

## 2. The one substantive definition in the repository

`docs/workflow/phase-9-dossier-workflow-architecture.md` §6, which preserves the
Guide + Tableau terminology from the Workflow PDF (T1–T10):

> **T7 Rattachement électronique** — Déclarant: **vérification du rattachement via
> liens électroniques**.

This is the only place any source says anything about the substance of the act.
It establishes three things and withholds the decisive one:

* the medium is **electronic links**;
* the act is a **verification** — the Déclarant confirms a rattachement that
  already exists, rather than performing one;
* the owner is the **Déclarant**, consistent with the CEO document.

**It never says what is attached to what.** Declaration to manifest, declaration
to BL, dossier to declaration, document to declaration — the source distinguishes
none of these, and the P1.3 brief forbids inferring any of them.

## 3. The conflict — CEO step 9 may or may not already exist in the registry

Two first-party-derived artifacts disagree.

**Reading A — P1.0 reconciliation.** CEO 9 maps to registry steps 10–11:
`coordinator_to_declarant` then `gainde_document_submission` (« Déclarant —
introduire les documents dans GAINDE », `CUSTOMS_DECLARANT`, evidence
`submitted_document_list / submission_date / submitted_by`, permission
`customs:update`). On this reading rattachement ≈ submitting the documents, and
the step already exists — it simply has no durable completion fact.

**Reading B — the phase-9 architecture doc.** Its mapping table gives canonical
step 9 « Electronic attachment verification » → engine step
**`10 electronic_attachment` (rattachement)**. That key **does not exist** in
`lib/process/effitrans-process.ts`, and neither does `customs_deposit`, the key
the same table gives for canonical step 10. The document flags its own column as
provisional: *« Exact step-key correspondence to be pinned in 9.0B against the
registry »* — and 9.0B never pinned it.

The two readings are **not the same act**. The phase-9 doc places the *saisie*
into GAINDE — manifeste, note de détail, déclaration — at **T4**
(`customs_preparation`, registry step 6), and rattachement three steps later at
**T7**. If T4 already covers submitting into GAINDE, then T7 is a distinct act
that was never built, and registry step 11 is something else again.

Nothing available resolves this. It is a question for Effitrans, not a question
for the repository.

## 4. What the platform has today

| Probe | Result |
|---|---|
| Column on `customs_record` | **none** — 35 columns, no attachment/link/rattachement fact |
| Permission in the catalog | **none** |
| Server action / RPC | **none** |
| Business event type | **none** |
| Process step | `gainde_document_submission` (step 11) — exists, no completion fact |
| MAYA evidence | **none** — no manifest or lien-électronique material in the MAYA corpus |

### The P1.1 pattern does **not** repeat

Steps 7 and 9 were each unblocked by finding a permission that had existed since
the process engine shipped with no consumer — `customs:validate`, then
`customs:register`. The catalog census here returns nothing equivalent: the only
customs permissions are `read / create / update / delete / release / assign /
validate / register`, and all are consumed. Whoever enumerated the official steps
in Phase 5.0B created a permission for step 7 and for step 9, and **created none
for rattachement**. That is itself evidence: the act was not understood then
either.

### `customs_record.submitted_at` is not a candidate

It exists, and its name is inviting. It is the **Customs Intelligence** provider
clock from 7.1B (« the clearance-time numerator »), bound to `intel_status` and
`provider_*`, and never written in practice because BLK-1 leaves no provider
wired. Reusing it would rebuild exactly the proxy MAYA-P1.2 has just removed from
the neighbouring step.

## 5. One piece of good news

`gainde_document_submission` is **absent from `FACT_RULES`**, so WES-5 treats it
as human-only by default and no proxy fact can complete it. The defect P1.2 found
on step 9 — a Finance step silently completed by the Declarant's paperwork — does
**not** exist on step 11. A regression guard now pins that, so the step stays
human-only until Effitrans defines what would prove it.

The Control Tower already reads it (« Documents GAINDE en attente » →
`/queues/customs_declaration`). The surface is built; only the fact is missing.

## 6. Legacy data

Nothing to reconcile and nothing to back-fill. No historical column carries this
act, and none of `updated_at`, customs status, `declaration_number`,
`external_ref`, `bae_reference` or `release_date` is first-party-established as
equivalent to it. Historical rattachement truth is **unrecoverable** and stays
unknown — which is the correct record, not a gap to be filled.

## 7. The questions that would unblock this

Ordered so that the first one alone may be enough.

1. **What is attached to what?** In « rattachement électronique », name the two
   objects — e.g. « la déclaration est rattachée au manifeste dans GAINDE ».
2. **Is it a verification or an action?** T7 says the Déclarant *verifies* a
   rattachement. Does the Déclarant perform it, or confirm that it happened
   elsewhere? A verification is a human judgement and belongs with
   `transit_validation`; an action may be recordable as a fact.
3. **Is it the same act as « introduire les documents dans GAINDE »**
   (registry step 11), or a separate later act? This is the §3 conflict, and
   Effitrans is the only authority that can settle it.
4. **What would the Déclarant type or attach?** A reference, a date, a
   confirmation, a screenshot? This determines whether there is any durable fact
   at all, or only a signed assertion.
5. **What is the consequence of failure?** If the rattachement cannot be
   verified, does the dossier stop, return to Finance, or continue?

Until (1) and (2) are answered, no column, permission, action or reconciliation
rule can be designed without inventing business meaning — which is the one thing
this programme has consistently refused to do.

## 8. Recommendation

Do not build rattachement. Two candidates for the next phase, both fully defined
today:

* **CEO step 11 — BAD / Delivery Order** (P1.0 class **B**): the
  `BON_A_DELIVRER` document type already exists (« Bon à Délivrer (BAD) /
  Delivery Order ») and no AM-facing action names it. The object is known.
* **R-19 — archive** (P1.0 class **E**): `archived_at` is « reserved » and the
  capability is genuinely missing.

Neither requires Effitrans to define anything first.
