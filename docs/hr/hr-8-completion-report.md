# EFFITRANS-HR-8 — completion report & production UAT closure

**Date:** 2026-08-16 · **Audit:** `a13d604` (docs/hr/hr-8-offboarding-audit.md, verdict GO) ·
**HR-8A foundation:** `6865ddf` (CI #485) · **HR-8B workspace:** `b147deb` (CI #486) ·
**HR-8C closure:** this document. **Migration 111**
`20260902000001_hr_offboarding_foundation.sql` — applied and reconciled in production;
`npx supabase migration list --linked` shows local = remote through `20260902000001`.
Production serves `b147deb` (`/api/version`, verified at closure time).

## Closure status

**Repository-side closure: VERIFIED. Production UAT: PENDING operator evidence.**

HR-8 is **not yet classified COMPLETE / PRODUCTION-VALIDATED** — that classification is
reserved for evidence, and no operator-observed session has been recorded here yet. The
repository-grounded half of the closure audit is complete and is recorded below, together
with the UAT protocol the operator executes. When the observations arrive they are
recorded verbatim in §UAT evidence and the classification is settled in the same place.

**Open UAT finding:** D-2 (checklist templates had no authoring surface) was reported
from the production session and is resolved below; it must be **retested in production**
before any closure verdict. UAT flow 3 could not be exercised at all until it was fixed.

## UAT finding D-2 — checklist templates had no authoring surface (root cause)

**Reported from production UAT:** Départs states « Aucun modèle de clôture n'est
configuré », Intégration says the models « se configurent dans le centre de
configuration », and RH → Configuration contains no such section.

**Root cause — genuinely missing, not merely unreachable.** A census of every reference to
`hr_checklist_template` / `hr_checklist_item_template` across the repository found
**reads only**: `listChecklistTemplates` (Intégration), `listOffboardingTemplates`
(Départs), and the item read that instantiates a case. **No INSERT or UPDATE existed
anywhere** — not in a server action, not in `seed.sql`, not in the setup wizard, not in
the import pipeline. HR-4 shipped the template *engine* and both *consumers* but never an
*authoring surface*, so « Aucun modèle » was permanent and unfixable from inside the
platform. HR-8B inherited the gap and made it visible; the onboarding studio's pointer to
the configuration center had never been true. The defect predates HR-8 and belongs to HR-4.

**Resolution — the smallest surface that closes it, no new model, no new permission, no
migration.** A « Modèles de check-list » panel in the existing configuration center
(`hr:config:manage`, the permission HR_OFFICER already holds under HR-A1), writing the
same two HR-4 tables for both kinds:

* create a template (code, libellé, **Intégration** or **Départ**);
* rename it; retire and restore it by deactivation — templates are never deleted,
  because instantiated cases point at them;
* add, correct and remove steps, with « bloquante », « pièce justificative requise »,
  responsible function and a due-date offset; positions are assigned by the server;
* `kind` and `code` are immutable after creation — a case was opened under that identity;
* a step already used by a case cannot be deleted: the foreign key refuses, and the
  refusal is translated (« Cette étape a déjà été utilisée dans un dossier… ») instead of
  being swallowed;
* both workspaces now name the place that exists: « Configuration → Modèles de check-list ».

Editing a template still never rewrites an open case — instantiation copies labels (I-8.4),
and the panel says so in French.

## Pre-UAT defect found and fixed (D-1)

The closure audit found one genuine defect **before** the operator met it, in the HR-8B
workspace only. No migration was required and none was created; the database rules are
untouched.

| # | Defect | Where | Resolution |
|---|---|---|---|
| D-1 | A checklist step marked « pièce requise » offered a **« Fait »** button whose only possible outcome was a refusal — no evidence picker exists in any checklist surface. The shipped onboarding studio (HR-4, live since migration 76) deliberately **withholds** that button in the same situation; HR-8B diverged from the established idiom. | `components/hr/offboarding-studio.tsx` | The affordance is withheld and the reason is stated in French (« pièce requise — à joindre au dossier de l'employé »). « Sans objet » and « Rouvrir » remain. The database rule (evidence required for DONE) is unchanged and still enforced. Pinned by test. |

D-1 is a UI affordance defect, not a security or governance one: the rule it exposed was
already enforced in the database and remains so.

## Repository-grounded closure audit

Verified from source at closure time, one line per UAT flow:

| Flow | What the repository guarantees | Evidence in repo |
|---|---|---|
| 1 · Tile | « Départs » is a live `WorkspaceTile`; no `SoonTile` and no « À venir — HR-8 » remains; exactly one entry point | hub + pins in 4 suites |
| 2 · Open case | Reason mandatory (`HR802`), employee must be ACTIVE/SUSPENDED (`HR803`), one live case (`HR806`); **no lifecycle write exists in the path** | `hr_open_offboarding_case`, I-8.12 pin |
| 3 · Checklist | Items instantiate from an OFFBOARDING-kind template with **snapshot labels**; DONE carries actor + timestamp (CHECK); evidence rule enforced at `HR809` and now honestly surfaced (D-1) | migration 111 §2/§3, SQL case E |
| 4 · Equipment | Open custody displayed from the authoritative table; completion refused at `HR814`; **no custody logic in HR-8** (mutation N3) | `offboardingGates`, SQL case D |
| 5 · Employment status | Completion refused at `HR813` until the registry marks the employee departed; HR-8 never transitions anyone (mutation N6) | SQL case D, I-8.12 |
| 6 · Blocking steps | Completion refused at `HR815`, naming the pending steps; NOT_APPLICABLE resolves a blocking step | SQL cases D/E |
| 7 · Completion | Succeeds only with TERMINATED + zero open custody + blocking steps resolved, **re-derived inside the transaction**; case becomes COMPLETED with a timestamp; history retained (no delete path) | `hr_complete_offboarding`, SQL case F |
| 8 · Account handoff | Completion emits the advisory event and returns `promptAccountHandoff`; **no account write exists anywhere in HR-8**; no role holds both `hr:manage` and `admin:users:*` (asserted in migration, SQL suite, and role templates) | assertions 6d, SQL case J, mutation N2 |
| 9 · Cancellation | Reason mandatory (CHECK); cancelled case retained; ledger event compensated on failure; **lifecycle untouched** | migration 111 §2, SQL case G2 |
| 10 · Security / copy | No SQLSTATE, `HR8xx`, or permission code in rendered output; refusals are French sentences | leak pins (comment-stripped, gate calls and type positions excluded), mutation N1 |
| 11 · Counters | Composed from live case rows, their employees' open custody, and their PENDING items — no analytics layer | `offboardingCounts` |
| 12 · RQ-8.1–8.8 | Untouched: reason free text, templates ship empty, account/contract advisory, no dual control, TERMINATED employees refused a case, termination date still stamps today | audit §16 unchanged |

## UAT protocol (operator, production, as Chargé RH)

Exact labels to expect, so an observation can be recorded without interpretation.

1. **Tile** — RH hub shows **Départs** / « Sorties, restitution, clôture ». No « À venir — HR-8 ».
2. **Open a case** — Départs → *Nouveau départ*: pick an active employee, type a **Motif**
   (the button stays disabled without one), optional date, optional model → *Ouvrir le
   dossier*. Expect the case at **Ouvert** and the employee still active in the registry.
3. **Checklist** — if a model was chosen, steps appear in order with snapshot labels.
   *Fait* / *Sans objet* persist and the case moves to **En cours**. A step marked
   « pièce requise » offers only *Sans objet* (see D-1) — the document itself goes on the
   employee's file.
4. **Equipment gate** — a holder of company equipment shows « Matériel : n à restituer ».
   *Clôturer le départ* → « Du matériel est encore attribué à cet employé. Enregistrez la
   restitution dans Équipements. » Record the return in **Équipements**, return to Départs:
   the badge clears.
5. **Employment-status gate** — before the registry marks the departure, *Clôturer* →
   « L'employé doit d'abord être marqué comme ayant quitté l'entreprise, dans sa fiche du
   registre. » Then mark the departure **in the registry** (its own « solde de tout compte »
   document rule applies there, unchanged by HR-8).
6. **Blocking steps** — with a mandatory step still *À faire*, *Clôturer* → « Certaines
   étapes obligatoires ne sont pas terminées. » followed by the step names.
7. **Completion** — all three conditions met → **Clôturé**, « Départ clôturé. », the case
   stays visible with its history.
8. **Account handoff** — if the employee has an active linked account, an amber panel
   states the access was **not** disabled and links to Administration → Utilisateurs.
   Verify in Administration that the account status is **unchanged**.
9. **Cancellation** — on another case, *Annuler le départ* without a motif is refused;
   with one, the case shows **Annulé** with its reason and the employee is untouched.
10. **Copy** — no code, SQLSTATE or permission name anywhere on screen.
11. **Counters** — hub shows « Départs en cours », and in the attention list « Matériel à
    restituer (départs) » and « Étapes de clôture à terminer », consistent with the rows.

### Retest steps for D-2 (production)

0. **Configure a model first** — RH → **Configuration** → « Modèles de check-list » :
   create `DEPART_STANDARD` / « Clôture de départ » of kind **Départ**; open it and add
   steps, e.g. « Restituer le badge » (bloquante), « Entretien de départ » (décochez
   *bloquante*), « Remise du reçu de solde signé » (bloquante + *pièce requise*).
   Create an **Intégration** model the same way to prove both kinds.
1. **Départs → Nouveau départ** now offers « Clôture de départ » in the model list; the
   « Aucun modèle » notice is gone (and while it showed, it named this exact place).
2. Open the case: the three steps appear in order with their flags; the « pièce requise »
   step offers only *Sans objet* (D-1).
3. Back in Configuration, rename a step and confirm the **already-open case keeps its
   original wording** — the snapshot rule, visible.
4. Try to delete a step that the open case used: refused in French; deleting an unused
   step succeeds. Deactivate the model and confirm it disappears from the pickers while
   the open case is unaffected.
5. Resume the standard protocol at step 3 above.

## UAT evidence (operator-observed)

*Awaiting the operator session. Observations are recorded here verbatim — human-observed,
never fabricated or inferred — and the classification below is settled at that point.*

| # | Test | Observed | Verdict |
|---|---|---|---|
| — | — | *pending* | — |

## Boundaries confirmed (repository-side)

* **HR-8 never terminates an employee.** No HR-8 file writes `employee.status`; the
  registry's `transitionEmployee` is unmodified, still reason-gated and still
  document-gated. Mutation N6 proves the workspace cannot claim otherwise.
* **HR-8 never modifies a user account.** No `app_user` write exists in the HR-8 domain;
  the account step is a prompt to Administration → Utilisateurs. No HR role holds
  `admin:users:*` — asserted in migration 111 (6d), in the SQL suite (case J), and against
  the role templates. Mutation N2 proves the screen cannot act on an account.
* **No four-eyes** was introduced (RQ-8.5 remains open), and **no new permission** exists
  (assertion 6f): `hr:manage` operates HR-8.

## Ratification gates — preserved, unanswered

**RQ-8.1** termination-reason vocabulary · **RQ-8.2** clearance checklist content ·
**RQ-8.3** account archive blocking vs advisory · **RQ-8.4** un-ended contract blocking vs
advisory · **RQ-8.5** dual control on clôture · **RQ-8.6** regularization of already-departed
employees · **RQ-8.7** future-dated termination · **RQ-8.8** « quitus Finance » item.
None is answered here or in code.

## Next phase

**HR-9 — Reporting RH** is the remaining class-A capability (facts-only aggregates over
counters that already exist; the last SoonTile on the hub). **HR-10 — Guide utilisateur &
SOP RH** is registered after it (HR-0F §3 addendum). Both wait for an explicit GO; HR-7D/7E
and every seat grant remain blocked on their ratification questions.
