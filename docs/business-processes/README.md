# Processus métier — documents sources de référence

Source business documents for the end-to-end dossier workflow (juillet 2026). These are the
authoritative business inputs for Phase 9 — they consolidate the Effitrans team interviews and
the Transit workflow documents, and they are the reference against which any change to
departments, roles, permissions, or the workflow engine must be validated (see the workflow
document's own « Décision d'implémentation », §14).

| File | Original title | Role |
|---|---|---|
| [Workflow_Complet_Effitrans_FR.pdf](Workflow_Complet_Effitrans_FR.pdf) | EFFITRANS — Architecture du Workflow Dossier | The consolidated end-to-end reference: principes directeurs, organisation cible, cycle de vie en 9 phases, workflows détaillés Operations (O1–O7) / Transit (T1–T10) / Finance (F1–F7), clôtures, statuts internes vs client, architecture fonctionnelle à implémenter, notifications, tableaux de bord par rôle, points restant à valider. **Version de travail — validation métier requise.** |
| [Guide_Processus_Transit.pdf](Guide_Processus_Transit.pdf) | Guide des Étapes Clés et Responsabilités — Processus Transit | Source document 1 (7 étapes): the Transit process step guide the workflow document consolidates. |
| [Tableau_Coordination_Transit.pdf](Tableau_Coordination_Transit.pdf) | Tableau de Bord — Coordination Transit : Suivi des Étapes Clés et Responsabilités | Source document 2 (10 étapes + répartition de l'équipe): the Transit coordination dashboard the workflow document consolidates. |

Engineering material derived from these sources lives in [`docs/workflow/`](../workflow/):
the Phase 9.0A organization audit and the Phase 9 dossier workflow architecture. The
currently-implemented 26-step process engine is documented in
`docs/phase-5.0a-workflow-traceability.md` and `lib/process/effitrans-process.ts`. The
workflow PDF is a **proposed target model awaiting business validation** — it does not
automatically supersede the implemented process registry; §14 of the PDF lists the open
points that must be decided by Operations, Transit, Finance and Direction first.
