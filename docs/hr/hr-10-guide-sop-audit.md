# EFFITRANS-HR-10 — Guide utilisateur & SOP RH: audit

**Date:** 2026-08-17 · **Status: AUDIT ONLY — nothing implemented.** ·
**Baseline:** HR-9 closed COMPLETE/PRODUCTION-VALIDATED at `bb4f09c` (CI #497); migration
parity 114 = 114. Governing scope: HR-0F §3 addendum — « HR-10 — Guide utilisateur & SOP
RH … in-platform, French, concise, non-technical, organised around the actual HR
workspaces, real production screenshots, numbered operating instructions, contextual
« Aide » access, printable/branded PDF optional ».

**Verdict: CONDITIONAL GO — four decisions required (RQ-10.1…RQ-10.4). One of them is not
a documentation question at all: a large part of the HR machine cannot currently be
operated by anybody, and a faithful SOP has to say so.**

---

## 1. What exists to document (verified from source and from production)

Thirteen HR surfaces, each with its authority:

| Workspace | Route | Gate (read / act) |
|---|---|---|
| Tableau de bord RH | `/departments/hr` | `hr:read` |
| Employés (registre) | `…/registre` + `…/[id]` | `hr:read` / `hr:manage`; C3 needs `hr:sensitive:read` |
| Organisation | `…/organisation` | `hr:read` |
| Configuration | `…/configuration` | `hr:config:manage` |
| Intégration | `…/onboarding` | `hr:read` / `hr:manage` |
| Départs | `…/departs` | `hr:read` / `hr:manage` |
| Équipements | `…/equipement` | `hr:read` / `hr:manage` |
| Congés & présence | `…/conges` | `hr:read` / `hr:manage`, decisions `hr:leave:approve` **or** the manager identity lane |
| Performance | `…/performance` | `hr:read` / `hr:manage`, finalisation `hr:performance:finalize` |
| Formation | `…/formation` | `hr:read` / `hr:manage` |
| Préparation de paie | `…/paie` | `hr:read`; facts `hr:manage` or `hr:payroll:read`; approve/lock `hr:payroll:approve` |
| Imports | `…/imports` | `hr:manage`; approval requires a **different** `hr:manage` holder |
| Reporting RH | `…/rapports` | `hr:reports:read` |

Plus two **administratively separate** acts the SOP must name without owning: creating or
archiving a login account (`admin:users:*`, Administration → Utilisateurs), and assigning
roles. HR triggers them; HR never performs them.

## 2. Precedents to reuse — HR-10 needs no new architecture

* **`/brand-center/guides`** is already an in-platform, French, numbered-step guide: a
  typed array of `{ client, steps[] }` rendered as `<ol>`, gated, and **audited on view**.
  That is exactly the HR-10 shape — content as data, no CMS, no markdown pipeline.
* **`lib/brand/document/pdf.ts`** already builds branded PDFs through `ReportLayout`
  (`lib/reports/templates`) — the printable version is a reuse, not a new engine.
* **`PageHeader`**, the `surface` styling, and the audit helper are the same everywhere.

**Nothing else in the platform offers contextual help today** — there is no « Aide »
affordance on any workspace. HR-10 introduces the first one, which is a UI addition, not a
new subsystem.

## 3. THE BLOCKING FINDING — most of the HR machine has nobody to operate it

Production, active accounts, at audit time:

| Authority | Active holders | Consequence for an SOP |
|---|---|---|
| `hr:read` | **1** | one person can see the registry |
| `hr:manage` | **1** | **every four-eyes step is unperformable** (see below) |
| `hr:config:manage` | **1** | configuration is single-handed |
| `hr:reports:read` | 6 | reporting is genuinely staffed (1 HR + 5 CEO) |
| `hr:leave:approve` | **0** | the org-wide leave lane is inert; DGA and DAF have **0 members** |
| `hr:performance:finalize` | **0** | reviews can be prepared, never finalised |
| `hr:payroll:read` | **0** | parked by ratification (Q7/Q8) |
| `hr:payroll:approve` | **0** | payroll preparation stops at **Vérifiée**, permanently |
| `hr:sensitive:read` | **0** | C3 documents are invisible to everyone, by design |

**The four-eyes consequence is the important one.** Three shipped controls each require a
*second distinct person* holding `hr:manage`: contract verification (verifier ≠ uploader),
import approval (approver ≠ preparer), and payroll adjustment decisions (decider ≠
proposer). With exactly **one** `hr:manage` holder, all three are **impossible to complete
today** — not broken, not misconfigured: correctly refusing, for want of a second person.
The pending import batch `HR-IMP-MST7EF6P` has been waiting on precisely this since HR-B3.

A guide that walks a user into a step that cannot complete is worse than no guide. So this
is a **product/organisational decision, surfaced not solved** (RQ-10.2).

Related: the registry holds **3 employees, 0 active**, and 1 org unit. The system is
correct and essentially empty.

## 4. Documentation gaps and contradictions found

1. **No user-facing documentation exists.** `docs/hr/` holds ~40 artifacts, all
   engineering-facing (audits, completion reports, briefs). Nothing is written for a
   Chargé RH, and nothing is in the product.
2. **Superseded roadmap, correctly marked.** `hr-erd-roadmap-decisions.md` still lists
   « HR-8 Self-service / HR-9 Reports », but carries an explicit *Superseded 2026-07-31*
   banner pointing at the ratified §11 numbering. No action needed beyond not quoting it.
3. **Stale process-registry metadata** (`implementation.verdict`) has misdirected two
   earlier phases; the SOP must be written from the **shipped surfaces**, never from that
   registry.
4. **Vocabularies that ship empty**, so the guide cannot enumerate them: termination
   reasons (RQ-8.1 unresolved — free text today), offboarding/onboarding checklist
   templates (tenant content), leave categories' `is_paid` (HR-7 Q4), adjustment kinds,
   competency catalogue and evaluation scales.
5. **Deliberately deferred figures** the guide must not imply exist: turnover rate
   (RQ-9.3), absence rate (no schedule model — HR-7 Q9), any monetary amount (DEC-B63).
6. **One workflow documented only in engineering prose**: the account handoff at departure
   — HR completes clearance, Administration archives the account. HR-8's UAT proved people
   need this spelled out; it is the single most confusable boundary in the product.

## 5. Proposed HR-10 structure (the guide itself)

Organised around the workspaces, as ratified. Each section answers the same five questions,
in the same order, because that is what makes an SOP usable:

> **Qui** peut le faire · **Quand** on le fait · **Étapes** numérotées · **Pièces requises**
> · **Ce que le système fait tout seul** — and, where relevant, **Ce qui se fait ailleurs**.

1. **Prise en main** — what the HR module is, the two lists that are not the same thing
   (employés vs comptes de connexion), and how authority works in plain terms.
2. **Registre des employés** — create, activate, modify, link an account, lifecycle.
3. **Organisation & configuration** — units, positions, locations, numbering, checklist
   templates, vocabularies.
4. **Intégration** — open a case, steps, evidence, provisioning.
5. **Congés & présence** — request, decide (both lanes), attendance entry.
6. **Équipements** — assign, return, condition.
7. **Documents & contrats** — upload, verify (four-eyes), expiry.
8. **Performance & formation** — cycles, objectives, reviews, sessions, certificates.
9. **Préparation de paie** — periods, collection, verification, adjustments; **and where it
   stops**.
10. **Départs** — the full clearance journey, including the account handoff.
11. **Reporting RH** — indicators, filters, export, and what the privacy floor means.
12. **Imports en masse** — template, staging, validation, four-eyes approval, application.
13. **Ce que le système ne fait pas** — one honest page: no payroll calculation, no
    automatic account revocation, no automatic termination, no invented rates.

Each section carries a **« Disponible aujourd'hui »** / **« Non disponible aujourd'hui »**
marker driven by §3, so the reader is never sent at a wall.

## 6. Material decisions required (HOLD)

| # | Decision | Recommendation |
|---|---|---|
| **RQ-10.1** | **Screenshots.** The freeze asks for « real production screenshots ». I cannot capture them, and today they would picture an empty registry of three departed test employees — misleading rather than helpful. Later, real screenshots contain real employees' personal data in a distributable document. | Ship **v1 without screenshots** (numbered text, exact French labels quoted from the UI). Add an operator-supplied screenshot pack afterwards, once the registry is populated, with a decision on anonymisation. |
| **RQ-10.2** | **Unperformable workflows.** One `hr:manage` holder means every four-eyes step is blocked; four authorities have zero holders. Does the SOP (a) document them with an explicit « non disponible aujourd'hui — il faut un second Chargé RH / un siège Direction », or (b) wait for staffing? | **(a)**. Naming the gap is the guide's most useful page; hiding it makes the document lie. This also gives Effitrans a single list of what staffing would unlock. |
| **RQ-10.3** | **Who may read the guide, and where does it live?** Gate on `hr:read` (the HR desk only), or make it visible to any authenticated staff member who might interact with HR (managers deciding leave, employees consulting their own file)? | A single route `/departments/hr/guide` gated on `hr:read` for v1; widen later only if Effitrans wants an employee-facing subset. Contextual « Aide » links from each HR workspace. |
| **RQ-10.4** | **Printable PDF in v1?** The engine exists (`ReportLayout`), but a PDF is a *distributed* artifact — it leaves the platform's permission model behind. | Defer to HR-10C, after the in-app guide is validated. Ship it only if Effitrans wants an offline copy, and then without screenshots unless RQ-10.1 resolves anonymisation. |

**Not decisions for HR-10, but named because the guide's completeness depends on them:**
RQ-8.1 (termination-reason vocabulary), RQ-8.2 (checklist content), HR-7 Q1/Q4–Q10,
RQ-9.3 (turnover). Each leaves a section of the guide describing a mechanism whose
*content* Effitrans has not yet supplied.

## 7. Proposed implementation plan (on GO, after RQ-10.1–10.4)

* **HR-10A — content model + guide route.** `lib/hr/guide/content.ts` (pure, typed:
  section → audience, when, steps, evidence, automatic, elsewhere, availability) +
  `/departments/hr/guide`, gated, audited on view, following the `/brand-center/guides`
  pattern exactly. **No migration** — the guide is content in code, and its availability
  markers are computed from the permission catalogue, not stored.
* **HR-10B — contextual « Aide ».** A small link on each HR workspace header that opens the
  guide at that section (anchor). One shared component; no per-page duplication.
* **HR-10C — printable PDF** (only if RQ-10.4 says yes), via the existing `ReportLayout`.
* **HR-10D — operator UAT + closure**, as every phase.

**Tests:** the content model is pure, so its structure is testable (every section has the
five required fields; every step is French; no technical code or SQLSTATE appears; every
claimed authority exists in the catalogue; every availability marker agrees with the live
grant census). Mutations: a section claiming an authority nobody holds without the
« non disponible » marker; a step naming a permission code; a broken workspace anchor.

**Scope discipline:** HR-10 adds documentation and one navigation affordance. It introduces
no HR feature, no permission, no migration, and answers no ratification question.

**After HR-10 closes: HOLD.** TMS is next and receives its own ratified roadmap.
