# Phase 9 — Canonical Dossier Workflow Architecture

**Status: SPECIFICATION. Nothing in this document is active.** It defines the target
architecture for the end-to-end dossier workflow, grounded in the business sources
([`docs/business-processes/`](../business-processes/)) and the Phase 9.0A audit
([`phase-9.0a-organization-audit.md`](phase-9.0a-organization-audit.md)). The governing
constraint, verified by the audit: **the existing 26-step process engine is extended
additively, never replaced** — its step-key vocabulary is a wide contract (queues, journeys,
closure, my-work, SLA, compatibility mapper and the test suite all depend on it), and it
already provides most of what this workflow needs.

---

## 1. Organizational model

Four real departments (implemented in `lib/organization/departments.ts`, Phase 9.0A):

```
OPERATIONS  (Opérations)          — owns every dossier, opening → operational completion
└── TRANSIT (Transit)             — real department, operationally under Operations
      teams: AIBD · MARITIME
FINANCE     (Finance)             — payments, invoicing, financial closure
HUMAN_RESOURCES (Ressources humaines) — support; processesDossiers: false
```

- Transit is **independently selectable** everywhere (assignment, tasks, queues, reports,
  dashboards, messaging rollup); the parent link drives org-chart **rollup only**.
- Maritime and AIBD are **teams**, never departments (`TRANSIT_TEAMS`).
- Documentation is an **Operations function** (role `DOCUMENTATION_OFFICER`).
- Transport coordination is a **Transit function** (role `TRANSPORT_OFFICER`).
- « Direction » is governance, not a department; CEO/COMPLIANCE_HSSE/SYSTEM_ADMIN map to no
  department. Department metadata is **never authorization** — roles + permissions remain the
  only access-control source.

## 2. Dossier ownership model

Business rule: *« Le dossier est un objet unique, créé et possédé par Operations. Il n'est
jamais dupliqué lorsqu'il passe entre les équipes. »*

- **One dossier, one owner department (OPERATIONS), for the whole lifecycle.** Transit and
  Finance receive *tasks, validations and responsibilities* on the same dossier — never a copy.
- Today's `operational_file` has three competing ownership columns (`account_manager_id`
  auto-set to creator, `coordinator_id`, `assigned_to_user_id`) and the engine has **no
  instance-level owner** (read-model `currentOwner` collapses to null under parallelism).
- **Target (9.0C, additive):** an explicit `owner_user_id` (the Coordinateur Operations
  accountable for the dossier) on `process_instance` — or a reconciliation of the three file
  columns into one accountable owner + per-step assignees, decided after the 9.0B design
  spike. Existing columns are preserved; nothing is dropped.

## 3. Department visibility model

Business rule: Operations, Transit and Finance see what their missions require; each team
modifies only what falls under its responsibility; HR sees no dossiers; the customer sees only
their simplified progression.

- Visibility remains **permission-driven** (RLS `user_readable_file_ids` + `*:read` /
  `*:read:all` scopes) — the audit confirmed department metadata affects no authorization, and
  that stays true. "All authorized departments have appropriate dossier visibility" is realized
  through the existing role→permission grants, with the canonical registry providing the
  *reporting* rollup (which department a queue/conversation/step belongs to).
- No per-dossier department ACL is introduced; if a future need appears (e.g. restricting one
  dossier to a subset), that is a new decision, not an assumption.

## 4. Role responsibility matrix

| Canonical dept | Roles (code — French label) | Dossier responsibilities |
|---|---|---|
| OPERATIONS | `COORDINATOR` — Coordinateur des opérations | Opens dossiers, transversal coordination (O5), **final control + operational completion (O6-O7)** |
| | `OPS_SUPERVISOR` — Superviseur opérations | Supervision, milestone validation, closure authority (`process:close`) |
| | `ACCOUNT_MANAGER` — Account Manager | Client relationship; **missing-document returns (T3)**; portfolio |
| | `DOCUMENTATION_OFFICER` — Agent de documentation | Dossier document set |
| | `WAREHOUSE_COORDINATOR` (provisional) | Site/handling |
| TRANSIT | `CHIEF_OF_TRANSIT` — Chef de transit | Réception/vérification sommaire/cotation (T1), contrôle-validation-signature (T5) |
| | `CUSTOMS_DECLARANT` — Déclarant en douane | Analyse/conformité ORBUS-GRED (T2), manifeste + note de détail + **saisie GAINDE** (T4), rattachement électronique (T7) |
| | `CUSTOMS_FIELD_AGENT` — Agent de terrain douane | Dépôt, suivi, **BAE** (T8 support), sorties |
| | `TRANSPORT_OFFICER` — Coordinateur transport | Dispatch terrain (T9), organisation enlèvements/livraisons |
| | `PICKUP_AGENT`, `DRIVER` | Exécution terrain (T10), transport |
| | `QUOTATION_MANAGER` (provisional) | Cotation |
| FINANCE | `FINANCE_OFFICER` — Agent financier | Vérification/décision/paiement (F1-F4), validation |
| | `CUSTOMS_FINANCE_OFFICER` | Enregistrement GAINDE (Guide étape 5 / T6) |
| | `BILLING_OFFICER` — Facturation | Facture client (F5) |
| | `COLLECTIONS_OFFICER` — Recouvrement | Suivi règlement (F6), clôture financière (F7) |
| | `ADMINISTRATIVE_OFFICER`, `COURIER` (provisional) | Dépôt physique des factures |
| HUMAN_RESOURCES | *(no roles exist yet)* | None — outside the dossier flow |
| — (no dept) | `SYSTEM_ADMIN`, `CEO`, `COMPLIANCE_HSSE` | Governance/administration, not dossier-processing |

Missing roles (9.0B+ candidates, additive): a dedicated **Coordinateur Transit** if the business
distinguishes it from Chef de Transit; **Agent Maritime / Agent AIBD** are *team memberships*,
not new roles (see §23).

## 5. End-to-end lifecycle (canonical, 20 steps)

The approved high-level lifecycle, with its mapping to the EXISTING 26-step registry
(`lib/process/effitrans-process.ts` — keys never renamed):

| # | Canonical step | Existing engine step(s) | Dept |
|---|---|---|---|
| 1 | Dossier opening by Operations | 2 `file_opening` (+ 1 `cotation` when quoted) | OPERATIONS |
| 2 | Transfer of work to Transit | 3 `coordinator_handoff` (process_handoff) | OPERATIONS → TRANSIT |
| 3 | Transit reception + summary verification | 4 `transit_reception` (explicit reception) | TRANSIT |
| 4 | Document analysis and compliance | 5 `document_analysis` (ORBUS/GRED) | TRANSIT |
| 5 | Missing-document return via Operations/AM | rejection → correction (`rejectsTo`), AM contact client | TRANSIT → OPERATIONS |
| 6 | Declaration preparation by Déclarant | 6 `customs_preparation` (manifeste, note de détail, saisie GAINDE) | TRANSIT |
| 7 | Chef de Transit validation + signature | 7 `transit_validation` (maker-checker pair with 6) | TRANSIT |
| 8 | Finance registration/payment intervention | 9 `gainde_registration` + payment steps | FINANCE |
| 9 | Electronic attachment verification | 10 `electronic_attachment` (rattachement) | TRANSIT |
| 10 | Declaration filing + customs follow-up | 11 `customs_deposit`, 12 `customs_followup` | TRANSIT |
| 11 | BAE acquisition | 13 `bae_obtained` | TRANSIT |
| 12 | Dispatch to AIBD or Maritime | 14 `field_dispatch` (**team dimension = gap, 9.0D**) | TRANSIT |
| 13 | Field operations | 15 `pickup` (join gate), field steps | TRANSIT |
| 14 | Transport coordination | 16 `delivery_transport` | TRANSIT |
| 15 | Supporting-document recovery | 17 `pod_collection` + evidence | TRANSIT/OPERATIONS |
| 16 | Final control by Coordinateur Operations | 18 `coordinator_completeness` / 19 `am_completeness` (maker-checker) | OPERATIONS |
| 17 | Transmission to Finance for invoicing | 20 `billing_draft` handoff | OPERATIONS → FINANCE |
| 18 | Invoice issuance | 21 `finance_invoice_validation`, 22 `invoice_dispatch` | FINANCE |
| 19 | Customer-payment confirmation | 26 `collections` (+ 23-25 deposit chain when required) | FINANCE |
| 20 | Final dossier closure | `closeDossier` (`process:close`, closure evaluator) | FINANCE + OPERATIONS |

(Exact step-key correspondence to be pinned in 9.0B against the registry; numbers here follow
the audited registry structure. Any divergence found during 9.0B is resolved by *extending* the
registry, never renaming keys.)

## 6. Transit detailed workflow

Source terminology preserved verbatim (Guide + Tableau, consolidated in the Workflow PDF T1-T10):

1. **T1 Réception, vérification sommaire et cotation** — Chef de Transit. Indicateur: dossier
   reçu, complet ou en attente.
2. **T2 Analyse, conformité documentaire, ORBUS / GRED** — Déclarant. Liste des pièces
   conformes/manquantes.
3. **T3 Relation client en cas de manque** — Account Manager / Operations: informer le client,
   obtenir la pièce ou la correction, recharger dans le dossier. (Backward return, §9.)
4. **T4 Préparation et saisie** — Déclarant: manifeste, note de détail, déclaration, **saisie
   dans GAINDE**.
5. **T5 Contrôle et validation** — Chef de Transit: contrôle, validation et **signature du devis**
   avant enregistrement. (Maker-checker: préparer ≠ valider.)
6. **T6 Intervention Finance** — Finance: **enregistrement**, vérification et/ou traitement
   financier requis. Confirmation ou blocage motivé.
7. **T7 Rattachement électronique** — Déclarant: **vérification du rattachement via liens
   électroniques**.
8. **T8 Dépôt, suivi et BAE** — Coordinateur Transit + terrain + **Bureau des Douanes**: dépôt,
   suivi des observations, inspections, corrections, **obtention du BAE**.
9. **T9 Dispatch terrain** — Coordinateur Transit: affecter **Maritime**, **AIBD** ou Transport
   selon localisation, urgence et charge.
10. **T10 Exécution terrain** — Agents Maritime / AIBD / Transport: visite, enlèvement, sortie
    conteneur, livraison et collecte des preuves.

## 7. Finance intervention

F1-F7 (Workflow PDF §8) — joint participation confirmed by the business:

- **Operations validates the operational need and urgency** (F1: « Operations valide le besoin
  opérationnel »); **Finance validates and executes** the financial action (F2-F4).
- F2 Vérification → retour motivé si incomplet (backward return). F3 Décision → approuver /
  rejeter / demander correction; le dossier peut être **bloqué ou continuer selon décision
  formalisée** (§11). F4 Paiement → preuve jointe; Transit notifié et reprend.
- F5 Facturation client (après clôture opérationnelle), F6 Suivi du règlement, F7 Clôture
  financière (exige également la clôture opérationnelle).
- Engine mapping: the existing billing/validation/deposit/collections steps (20-26) already
  implement F5-F7 including maker-checker on the invoice; F1-F4 in-flow payment requests are a
  9.0E extension (a payment-task structure + the decision record of §11).

## 8. Parallel tasks

Confirmed capability (audit D.1): `ParallelGroup` branches evaluated independently, multiple
simultaneously-ACTIVE steps, join gates for convergence (`PICKUP_READINESS`). The business
example — Transit traite une observation douanière pendant qu'Operations demande une pièce,
Finance vérifie un paiement et le terrain prépare un enlèvement — is representable today.
9.0F extends, additively: more branch groups if the 9.0B design requires them, and an
instance-level owner so `currentOwner` stays meaningful under parallelism (§2).

## 9. Returns and resumptions

Business rule: *« Un retour doit toujours comporter un motif, une action attendue, un
responsable, une date et une trace dans l'historique. Il ne doit jamais annuler le travail déjà
effectué. »*

The engine already satisfies every clause (audit D.3): rejection freezes the attempt
(REJECTED is terminal, history preserved by the partial unique index), a correction row is
created with `correction_of_id` lineage, reason is mandatory, both sides are audited, and
handoffs can be rejected with `returned_to_step_key` + reason. **Reused as-is.** Manager
approval for backward transitions is deliberately NOT assumed — it stays configurable (§23,
unresolved by the business).

## 10. Blockers

Today blockers are derived (BLOCKED step state + computed missing prerequisites/evidence) —
adequate for engine-internal gating, insufficient for the business's named blocker types
(document, douane, paiement, transport, client, fournisseur) and for « waiting on client ».

**9.0F additive gap:** a `process_blocker` record (instance-scoped: type, reason, raised_by,
raised_at, resolved_by/at, expected action + owner) — visible in dashboards, NEVER
customer-visible (the portal timeline contract already refuses blocked states). Until then,
derived blockers remain the truth.

## 11. Conditional continuation before payment

Business decision 8: work MAY continue before payment confirmation — as a **recorded operational
decision, never an automatic rule**. Required record (Workflow PDF §8.1): one of « Bloquer
jusqu'au paiement » / « Continuer provisoirement » / « Continuer avec approbation manager »,
with **auteur, motif, risque, conditions et échéance**.

Audit D.4: no such structure exists — the only override is maker-checker self-validation
(scoped, granted to no role). **9.0E additive gap:** a `process_decision` record
(decision type, author, reason, risk, conditions, deadline, audited) consulted by the
payment-adjacent gates. The closure evaluator's hard payment requirement is NOT weakened —
the decision governs *continuing work*, never *closing the dossier*.

## 12. Operational closure

Business decision 12, already the engine's shape: the Coordinateur Operations declares
operational completion after final control (18/19 completeness maker-checker), recovery of
supporting documents (evidence requirements), and transmission for invoicing (billing handoff).
`PROCESS_OPERATIONALLY_COMPLETED` is audited with `dossier_closed: false` — « Livré ne vaut pas
clôturé ». 9.0G may additionally write the declared-but-unused instance status
`COMPLETED_OPERATIONALLY` so dashboards can segment without recomputing.

## 13. Financial closure

Business decision 13: financial closure occurs when customer payment is confirmed. The engine's
closure evaluator is the authoritative model and is kept: full payment is one requirement among
~12, closure requires `process:close` (SYSTEM_ADMIN/OPS_SUPERVISOR only), no webhook can close
as a side effect, and closure routes the legacy status through the existing `transitionFile`
seam. **The legacy `canCloseFile()` (customs-release-only) is a documented defect** — 9.0G
retires the legacy close path in favor of the evaluator once the workflow is live.

## 14. Customer-visible milestone mapping

Simplified customer progression (Workflow PDF §10, statuts internes → affichage client):

Dossier reçu · Documents en vérification · Action client requise · Déclaration en préparation ·
Déclaration déposée · Formalités douanières en cours · Autorisation obtenue · Enlèvement en
préparation · Livraison en cours · Livré · Dossier terminé

Never exposed: staff names (unless explicitly intended), internal transfers/handoffs, internal
notes, supplier amounts, payment debates, manager approvals, internal blockers, GAINDE
technical detail.

**Convergence requirement (audit gap #8):** two disconnected customer-progress systems exist —
the production portal timeline (`lib/portal/progress-map.ts`, over the legacy lifecycle) and
the dark engine `clientStage`/`CLIENT_JOURNEY`. **9.0H converges on the engine's `clientStage`**
(extended to the 11 labels above) with the portal map kept as the fallback for
non-engine-rollout tenants — same pattern as every other engine feature (flag-gated, legacy
preserved).

## 15. Audit requirements

Reuse the existing `PROCESS_*` audit vocabulary (append-only audit_log, actor-attributed,
safe-metadata-only). Additive events needed: decision records (§11), blocker raise/resolve
(§10), team dispatch (§23). Rule preserved: every transition, validation, return, blockage and
important decision is historized; message/step BODIES are never in the audit payload.

## 16. Notification requirements

The Workflow PDF §12 event table maps onto existing infrastructure: staff `notification` table
+ bell (extended types as needed), customer `client_notification`, and the Messaging Center
(Phase 8.7) for dossier-linked conversations. « Canal recommandé: visibles dans la plateforme,
dans la messagerie liée au dossier et, plus tard, en temps réel dans la PWA. Le dossier reste
la source de vérité. » Realtime push remains out of scope (documented polling decision).

## 17. Dashboard requirements

Role dashboards (Workflow PDF §13) largely exist: control tower, department cards, 15 queues,
my-work, collections, executive dashboard. 9.0I additions: canonical-department rollups (via
`QUEUE_DEPARTMENT_TO_CANONICAL`), Transit coordination view (T8 indicators: BAE delay,
blocages), Finance payment-request queue (9.0E), Direction volumes/délais/taux de clôture.

## 18. Reuse of the existing process engine

Reused unchanged (audit D.8): step-registry shape and the 26 keys · pure state core ·
the single transition service with its 8-step guard pattern and CAS concurrency · snapshot +
read-model · queue registry/service · `process_handoff` with explicit reception · rollout
model (`env AND tenant_row`, engine never writes `operational_file`) · closure evaluator ·
`CLIENT_JOURNEY` + milestones · `PROCESS_*` audit vocabulary. **No second engine. No step-key
renames. No replacement.**

## 19. Schema gaps (all additive)

1. `process_decision` (conditional continuation, §11).
2. `process_blocker` (§10).
3. Instance-level owner (`process_instance.owner_user_id`) or file-ownership reconciliation (§2).
4. Team dimension for dispatch (AIBD/MARITIME on step execution or a dispatch record, §23).
5. Per-type step skipping — assign `SKIPPED` at initialization by file type (TRP/HND customs).
6. Intermediate instance statuses — start writing `COMPLETED_OPERATIONALLY`/`UNDER_BILLING`/
   `UNDER_COLLECTION`.
7. Missing evidence document types (~10, enumerated per-step in the registry's
   `implementation.gaps`).
8. Client-stage extension to the 11 customer labels (§14).

## 20. Migration strategy

- **No destructive migration, ever.** All schema gaps above are additive columns/tables.
- No production user/role/dossier data is renamed: departments are derived, role codes and
  permission codes frozen, legacy lifecycle keeps operating for non-rollout tenants.
- Legacy dossiers enter the engine only through the EXISTING read-only compatibility mapper
  (`mapDossierToOfficialStep`, `mutateFileStatus: false`).

## 21. Rollout strategy

Identical to every engine feature: dark by default behind `EFFITRANS_PROCESS_*` env kill
switches AND per-tenant `tenant_process_rollout` — nothing activates in production during
Phase 9 development; per-tenant pilot first; the customer-visible mapping change (9.0H) gets
its own sub-flag so internal workflow rollout never silently changes what customers see.

## 22. Rollback strategy

`rollbackTenantRollout` (one click, audited, everything off) already exists; the env kill
switch works even when the DB is the thing that is broken. Because the engine never writes
`operational_file`, turning it off returns a tenant to the legacy lifecycle with zero data
repair. New additive tables simply stop being written; nothing needs deleting.

## 23. Open decisions

1. **Manager approval for backward transitions** — unresolved by the business; must remain
   configurable (per-transition policy), never assumed (business decision 15).
2. **Provisional role mappings** — QUOTATION_MANAGER→TRANSIT, WAREHOUSE_COORDINATOR→OPERATIONS,
   ADMINISTRATIVE_OFFICER/COURIER→FINANCE (and the `cotation`/`administration`/`courier` queue
   rollups) await business confirmation.
3. **Coordinateur Transit** — dedicated role, or covered by CHIEF_OF_TRANSIT?
4. **Team membership modeling** (Agent Maritime / Agent AIBD): per-user team attribute vs.
   dispatch-time team tag; blocked on 9.0D design.
5. **Nav « Départements » section relabel** — frozen 5.0E contract; renaming the category (it
   lists modules, not departments) needs a deliberate UX decision.
6. **Ownership reconciliation** — which of the three file ownership columns becomes the
   accountable owner (§2).
7. **Mandatory justificatifs per dossier type** (maritime/aérien/route/import/export) — open
   in the business doc (§14 of the PDF).
8. **SLA targets per step** — open in the business doc; `slaPolicyKey` seam exists.
9. **Which steps may be skipped per service purchased** — open in the business doc.
10. **HR roles** — none exist; create only when HR onboarding needs them.

## Phase 9 roadmap

| Phase | Scope |
|---|---|
| **9.0B** | Dossier workflow engine extensions design + additive schema: `process_decision`, `process_blocker`, instance owner, per-type SKIPPED assignment, evidence doc types. Pin the §5 lifecycle↔step-key mapping against the registry. |
| 9.0C | Operations intake + dossier ownership (O1-O7; owner reconciliation) |
| 9.0D | Transit execution workflow (T1-T10; team dispatch AIBD/Maritime) |
| 9.0E | Finance tasks + conditional payment decisions (F1-F4; §11 decision record) |
| 9.0F | Parallel tasks, returns and blockers hardening (§8-10) |
| 9.0G | Operational + financial closure (intermediate statuses; retire legacy canCloseFile) |
| 9.0H | Customer-visible progress convergence (§14, 11 labels, sub-flag) |
| 9.0I | Dashboards + production rollout (per-tenant pilot) |
