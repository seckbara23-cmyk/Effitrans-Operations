# Workflow Dossier — documents métier de référence

Source business documents for the end-to-end dossier workflow (juillet 2026). These are the
inputs for the business-validation cycle described in each document — they consolidate the
Effitrans team interviews and the Transit workflow documents, and they are the reference
against which any future change to departments, roles, permissions, or the workflow engine
must be validated (see the architecture document's own « Décision d'implémentation », §14).

| File | Original title | Role |
|---|---|---|
| [effitrans-architecture-workflow-dossier-template.pdf](effitrans-architecture-workflow-dossier-template.pdf) | EFFITRANS — Architecture du Workflow Dossier {Template} | The consolidated end-to-end reference: principes directeurs, organisation cible, cycle de vie en 9 phases, workflows détaillés Operations (O1–O7) / Transit (T1–T10) / Finance (F1–F7), clôtures, statuts internes vs client, architecture fonctionnelle à implémenter, notifications, tableaux de bord par rôle, points restant à valider. **Version de travail — validation métier requise.** |
| [guide-etapes-cles-responsabilites-processus-transit.pdf](guide-etapes-cles-responsabilites-processus-transit.pdf) | Guide des Étapes Clés et Responsabilités — Processus Transit | Source document 1 (7 étapes): the Transit process step guide the architecture document consolidates. |
| [tableau-de-bord-coordination-transit.pdf](tableau-de-bord-coordination-transit.pdf) | Tableau de Bord — Coordination Transit : Suivi des Étapes Clés et Responsabilités | Source document 2 (10 étapes + répartition de l'équipe): the Transit coordination dashboard the architecture document consolidates. |

Related engineering material: the currently-implemented 26-step process engine
(`lib/process/effitrans-process.ts`, `docs/phase-5.0a-workflow-traceability.md`) and the
business workshops in [`docs/workshops/`](../workshops/). The architecture PDF is a
**proposed target model awaiting business validation** — it does not automatically supersede
the implemented process registry; §14 of the PDF lists the open points that must be decided
by Operations, Transit, Finance and Direction first.
