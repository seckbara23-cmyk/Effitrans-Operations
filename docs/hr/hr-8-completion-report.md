# EFFITRANS-HR-8 — completion report & production UAT closure

**Date:** 2026-08-17 · **Audit:** `a13d604` (docs/hr/hr-8-offboarding-audit.md, verdict GO) ·
**HR-8A foundation:** `6865ddf` (CI #485) · **HR-8B workspace:** `b147deb` (CI #486) ·
**HR-8C/D/E — UAT findings & closure:** `1347969` (CI #488), `51f3b21` (CI #489),
`419217b`/`9439b95` (CI #491), and this document.
**Migration 111** `20260902000001` — applied and reconciled.
**Migration 112** `20260903000001` — applied in production (verified live from `pg_proc`);
ledger reconciliation outstanding (see below).

## Closure status

# **HR-8: COMPLETE / PRODUCTION-VALIDATED.**

The operator completed the full departure journey in production on a purpose-created
employee (EMP-0003 / « UAT Offboarding »), exercising every acceptance criterion —
including the three that only a live system can prove: the **template snapshot** (editing a
model did not rewrite an already-open case), the **evidence-required completion** (a
blocking step closed by citing a real document), and the **separation of the three
lifecycles** (HR closure left the login account untouched and said so; the suspension was
then performed independently in Administration). The observations are recorded verbatim
below and are corroborated by read-only production queries.

Five findings were raised across the UAT sessions (D-1…D-5). All are resolved; none remains
open against the shipped behaviour.

**Scope of the verdict:** HR-8A (foundation), HR-8B (workspace) and HR-8C/D/E (the UAT
findings) are closed. HR-8 never terminates an employee and never modifies a user account —
enforced in code, asserted in the database, and now **observed in production**.

**One housekeeping item, not a functional blocker:** migration 112's SQL is live in
production — verified directly from `pg_proc` that the HR816 provenance rule is present and
that the HR809 presence rule and the INV-7 authority check survived the replacement — but
the migration ledger still reads **local 112 / remote 111**, because the SQL was applied
through the editor. Reconcile with
`npx supabase migration repair --status applied 20260903000001`.

## Production UAT evidence — final session (operator-observed, recorded verbatim)

> Production UAT completed successfully:
>
> DEPART_STANDARD / Clôture de départ was created successfully in RH → Configuration.
> The template contained three steps:
> Restituer le badge — blocking/required.
> Entretien de départ — non-blocking.
> Remise du reçu de solde signé — blocking/required + supporting evidence required.
> A new employee EMP-0003 / UAT Offboarding was created and activated.
> The employee was linked to the existing account transit.demo@effitrans.sn.
> A departure case was successfully opened using DEPART_STANDARD.
> The open departure case correctly instantiated all three checklist steps.
> The template snapshot behavior was tested: editing the template after the case existed did not rewrite the already-open case.
> The required Solde de tout compte (signé) document was uploaded to the employee dossier.
> The evidence-required checklist step could then be completed using the supporting document.
> The departure checklist reached 3/3 étapes.
> The employee lifecycle was separately changed to Départ.
> The departure case was successfully closed and displayed Départ clôturé / Clôturé.
> After HR closure, the linked platform account remained active. The application explicitly warned that platform access had NOT been revoked.
> In Administration → Utilisateurs, transit.demo@effitrans.sn was then independently changed from Actif → Suspendu.
> The user detail page independently confirmed Suspendu, while the Chef de transit role remained attached.
>
> This confirms the intended separation between employee lifecycle, offboarding-case closure, and application-account access management.

**Independent corroboration** (read-only production query at classification time, not a
substitute for the observations above):

| Field | Value |
|---|---|
| Employee | `EMP-0003` — UAT Offboarding |
| Employee status | `TERMINATED` |
| Departure case | `COMPLETED` |
| Checklist | **3 of 3 steps DONE** |
| Linked account | `transit.demo@effitrans.sn` |
| Account status | `inactive` (« Suspendu ») — changed **after** closure, in Administration |

## Reconciliation against the HR-8 acceptance criteria

| # | Acceptance criterion | Operator evidence | Verdict |
|---|---|---|---|
| 1 | Tile « Départs » visible, no « À venir — HR-8 » | Workspace reached and used throughout the session | PASS |
| 2 | Open a case for an eligible employee; reason required; no termination | EMP-0003 created, activated, case opened with `DEPART_STANDARD`; lifecycle changed **separately**, later | PASS |
| 3 | Checklist instantiates; completion persists; evidence rule enforced | All three steps instantiated; completions persisted; evidence step closed **only** by citing the uploaded document | PASS |
| 4 | Equipment gate blocks closure; return via Équipements; no duplicated custody logic | No equipment held by EMP-0003 this session; gate proven in the earlier session (HR814 refusal → return in Équipements → cleared) and on every CI run | PASS (this session: not applicable) |
| 5 | Employment-status gate; HR-8 performs no termination | Closure only became possible after the lifecycle was moved to **Départ** in the registry — a separate act | PASS |
| 6 | Blocking step blocks; DONE / Sans objet handled | Case sat at 2/3 until the blocking evidence step was completed; non-blocking step needed no action | PASS |
| 7 | Closure succeeds when all conditions are met; case completed; history visible | « Départ clôturé » / **Clôturé**, case retained and readable | PASS |
| 8 | Account NOT disabled by closure; amber prompt; no `admin:users:*` for HR | Account **remained active** after closure; app **explicitly warned** access had not been revoked; suspension performed independently in Administration, where the role stayed attached | PASS |
| 9 | Cancellation requires a reason; case retained; lifecycle untouched | Proven in the SQL suite each CI run; not re-exercised this session (the case was closed, not cancelled) | PASS (covered by suite) |
| 10 | No SQLSTATEs, no HR8xx, no permission codes; French refusals | No code appeared at any point in the session | PASS |
| 11 | Counters reflect real rows | Workspace and hub read consistently through the session | PASS |
| 12 | RQ-8.1–8.8 untouched | No ratification question was answered in code or in configuration | PASS |

**The template snapshot criterion (I-8.4)** deserves its own line: the operator edited the
model *after* the case existed and confirmed the open case kept its original wording. That
is the invariant the whole checklist design rests on, and it is now proven in production,
not only in CI.

## UAT finding D-5 — a suspended account was still described as « encore actif »

Found while reconciling the operator's **final** step (Actif → Suspendu), not by the
operator. The account panel treated every non-archived status as "still active", so after
the suspension a revisited case would read « Le compte de connexion est encore actif » —
false: a suspended account cannot sign in. The closure-time warning the operator saw was
correct (the account *was* active then); the inaccuracy appears only when returning to the
case afterwards.

**Resolved:** three states, three truths, using the platform's own vocabulary
(`STAFF_STATUS_LABEL`, read never redefined): archived → archived; suspended → « la
connexion n'est plus possible », archival still outstanding; active → the original warning.
The post-closure banner likewise distinguishes "access not revoked" from "not yet archived".
No rule changed, no account write introduced, no migration.

## UAT finding D-4 — an evidence-required step could never be marked « Fait »

**Reported from production UAT** (EMP-0003 / `DEPART_STANDARD`): with « Solde de tout
compte (signé) » in the employee's file and Départs correctly reporting « Tous les
documents requis sont au dossier », the third step (blocking + pièce requise) still showed
**À faire** and offered only **Sans objet**. The case was stuck at 2/3.

**Verdict: defective — and the earlier D-1 decision was the cause.** The audit traced the
whole path:

| Layer | State before D-4 |
|---|---|
| RPC `hr_complete_offboarding_item` | **Presence enforced server-side**: `DONE` + `evidence_required` + null evidence → `HR809`. Never a UI courtesy. |
| RPC — *provenance* | **Not checked.** Any `hr_document` uuid was accepted, including **another employee's**, another tenant's, or a **soft-deleted** one. Only the foreign key constrained it. |
| Action `completeOffboardingItem` | Already accepted and forwarded `evidenceDocumentId`. Complete. |
| Départs UI | Never passed evidence, and **deliberately hid « Fait »** (finding D-1) on the premise that no evidence picker existed anywhere. |

So the answer to « intentionally hidden, incorrectly gated, or missing » is: **intentionally
hidden, on a premise that was wrong.** The model has always carried
`hr_offboarding_item.evidence_document_id` and the RPC has always taken `p_evidence`; what
was missing was the picker. The consequence was worse than an awkward screen — a blocking
step could only be resolved by **Sans objet**, which would record a falsehood about a
document that actually exists, so the case could never be closed truthfully.

**Correction (migration 112 + the picker), smallest within the existing model:**

* **Départs** now offers, on an evidence-required step, a picker of **that employee's own
  documents** (label = type + title, C3 hidden unless the reader holds
  `hr:sensitive:read`, reusing the employee-file rule rather than restating it).
  « Fait » appears when no evidence is required, or once a document is chosen.
* **Migration 112** (`20260903000001_hr_offboarding_evidence_provenance.sql`) replaces
  *one function* and nothing else, adding the rule the audit found missing:
  **HR816 — the cited document must belong to this tenant, to the case's own employee,
  and must not be soft-deleted**, checked whenever evidence is supplied whatever the
  target status. Every pre-existing rule (HR630, INV-7, HR807/808/809/810) is preserved,
  and the migration **asserts at apply time** both that the new rule is present and that
  none of the old ones was lost in the replacement — plus that the closure gate itself is
  untouched. The ledger event now records which document justified the step.
* The refusal reaches the user in French (« La pièce choisie n'appartient pas au dossier de
  cet employé. ») — never as a code.

**Answering the brief's verification question directly:** an evidence-required blocking
step can now be completed **only** when qualifying evidence exists, and **absence is
rejected server-side, not merely hidden** — `HR809` predates this fix and is proven live in
the SQL suite; `HR816` adds the provenance half. Both are exercised against a real database
on every CI run (a foreign employee's document, a soft-deleted document, and no document
at all are each refused; the employee's own live document succeeds and is recorded).

**Known parallel, deliberately out of scope:** the HR-4 **Intégration** studio still
withholds « Fait » for evidence-required steps for the same original reason. It has the
same model and could take the same picker; it is left untouched here rather than widening
an HR-8 UAT fix into HR-4, and is recorded as an open item.

### Production retest steps for D-4

**Migration 112 must be applied first** (SQL editor, then
`npx supabase migration repair --status applied 20260903000001`). Then, on the EMP-0003
case:

1. The third step now shows a « — Pièce justificative — » picker listing « Solde de tout
   compte (signé) — <titre> ». Choose it; **Fait** appears; click it → the step becomes
   **Fait** and the case reads **3/3 étapes**.
2. Reopen the step (**Rouvrir**) and try **Fait** without choosing a document: no button is
   offered, and the database would refuse it anyway (HR809).
3. Confirm in the employee's timeline that the completion event names the document.
4. Continue the closure protocol: mark the departure in the registry, then **Clôturer**.

## UAT finding D-3 — the « Nouveau départ » employee picker was empty

**Reported from production UAT:** after D-2 was deployed and a Départ model was authored,
the operator opened Départs → Nouveau départ to start a case for *Transit Demo* — a person
observed moments earlier in Administration as an **active account** with the role Chef de
transit — and found the **Employé picker empty**.

**Verdict: NOT a product defect in the eligibility rule.** Two independent, correct causes,
established by reading production (read-only) rather than inferred:

| Fact (production, tenant `…0001`) | Value |
|---|---|
| Active login accounts | **48** |
| Employee-registry records | **2** — `EMP-0001` Joe Doe, `EMP-0002` Chris Demo |
| Employees eligible for a departure (ACTIVE/SUSPENDED) | **0** |
| Status of both registry records | **TERMINATED** |
| Their departure cases | both **COMPLETED** (« Test UAT HR-8C », « Test UAT HR-8C matériel ») |
| `transit.demo@effitrans.sn` | active account, **no employee record, no link** |
| Offboarding templates | **1** (D-2's model, authored successfully) |

1. **Transit Demo has no employee-registry record at all.** The picker reads the HR
   employee registry, not the account list, so there is nothing to offer. The same is true
   of the other demo accounts (`ops.supervisor`, `recouvrement`, `transport`).
2. **Both registry records are TERMINATED** — closed by the earlier UAT session itself — so
   the eligible population is genuinely empty. Starting a departure for an
   already-departed person is exactly what RQ-8.6 leaves unratified, and the database
   refuses it (`HR803`) independently of the screen.

**Is an active operational user with no employee record expected architecture?** **Yes —
deliberately.** Employment records and login accounts are two lifecycles that the platform
keeps separate: `employee.linked_app_user_id` is optional in both directions, linking
grants nothing, and termination never silently revokes access (DEC-B26/B59/B62). Accounts
are provisioned in Administration; people are registered in the HR registry; the two lists
are distinct surfaces by design. What is **not** expected is the *ratio*: 48 accounts to 2
employees means the HR registry has never been populated — the mass-registration batch
`HR-IMP-MST7EF6P` still waits on a second HR Officer for its four-eyes approval. That is a
**data/rollout state, not a defect**, and eligibility must not be widened to paper over it.

**The one genuine defect found here (fixed):** the empty picker was **silent**. It rendered
an empty select and a disabled button with no explanation, which reads as a malfunction —
against the platform's own honest-state doctrine. « Nouveau départ » now states the reason
and distinguishes the two cases: no employee in the registry at all (« Un compte de
connexion n'est pas un employé… ») versus a registry whose people are already departing or
already gone. Eligibility itself is unchanged and pinned against widening.

### Production-safe UAT recovery (no data surgery, no weakened rules)

1. **Register the UAT subject as an employee** — RH → **Employés** → « Nouvel employé »
   (nom, prénom, département TRANSIT, poste, date d'embauche). The matricule is assigned by
   the platform (`EMP-0003`).
2. **Activate the record** — a new employee is created in **Brouillon**; move it to
   **Actif** from the employee's file. Only then is a departure possible.
3. *(Optional)* link the existing `transit.demo@effitrans.sn` account to that record — the
   link grants nothing and is not required for HR-8, but it makes the account-handoff step
   (flow 8) exercisable.
4. **Do not** reactivate `EMP-0001`/`EMP-0002` to free them up: `TERMINATED → ACTIVE` does
   not exist by design, and rehire is a new record (DEC-B26).
5. Resume the D-2 retest steps below with the new employee and the `DEPART_STANDARD` model.

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

**Recorded — see « Production UAT evidence — final session » at the top of this document**,
where the operator's observations are reproduced verbatim and reconciled criterion by
criterion. The sessions ran across 2026-08-16/17 and produced findings D-2, D-3 and D-4,
each resolved and then retested; the final session passed end to end.

Earlier sessions also left two **COMPLETED** departure cases in production (Joe Doe,
Chris Demo) whose closure exercised the equipment gate — the `HR814` refusal, the return
recorded in Équipements, and the subsequent successful closure.

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

## Open items carried out of HR-8 (none blocks the verdict)

1. **Ledger reconciliation** — `npx supabase migration repair --status applied 20260903000001`
   (migration 112's SQL is already live; only the ledger row is missing).
2. **HR-4 Intégration parity** — the onboarding studio still withholds « Fait » for
   evidence-required steps, the pre-D-4 behaviour. Same model, same fix would apply; left
   untouched rather than widening an HR-8 fix into HR-4.
3. **RQ-8.1–8.8** — unanswered, exactly as tabled by the audit.

## Next phase

**HR-9 — Reporting RH** is the remaining class-A capability (facts-only aggregates over
counters that already exist; the last SoonTile on the hub). **HR-10 — Guide utilisateur &
SOP RH** is registered after it (HR-0F §3 addendum). Both wait for an explicit GO; HR-7D/7E
and every seat grant remain blocked on their ratification questions.
