# EFFITRANS — HR operational readiness (staffing & content)

**Date:** 2026-08-17 · **Status: an Effitrans operational item, NOT a software defect.**
Recorded at HR-10 (RQ-10.2 ratified). The HR platform is built and production-validated
through HR-9; what follows is what Effitrans must still put in place for it to be
*operable*.

**The distinction this document exists to hold:** *capability implemented ≠ capability
currently operable by Effitrans staffing.* Every item below is a working control refusing
to run without the person it requires. None is a bug, and none may be weakened,
bypassed or redesigned to compensate.

## 1. Authority census — production, active accounts

| Authority (plain French) | Holders | What it unlocks |
|---|---|---|
| Chargé RH — lecture | **1** | seeing the registry at all |
| Chargé RH — gestion | **1** | every HR act; **and the blocker below** |
| Chargé RH — configuration | **1** | structure, postes, vocabulaires, modèles |
| Lecture des rapports RH | 6 | Reporting RH (1 RH + 5 Direction) |
| Décision de congé, siège Direction | **0** | the org-wide leave lane (DGA/DAF have no members) |
| Finalisation des évaluations | **0** | closing a performance review |
| Lecture des faits de paie | **0** | parked by ratification (HR-7 Q7/Q8) |
| Approbation de paie | **0** | a payroll period beyond « Vérifiée » |
| Lecture des données sensibles | **0** | C3 documents — invisible to everyone, by design |

## 2. The blocking item — one Chargé RH means no four-eyes control can complete

Three shipped controls each require a **second, distinct person** holding the HR
management authority:

| Control | Rule | Consequence today |
|---|---|---|
| Vérification de contrat | le vérificateur ≠ le déposant | a contract can be filed, never verified |
| Approbation d'import | l'approbateur ≠ le préparateur | batch `HR-IMP-MST7EF6P` has waited since HR-B3; **the registry cannot be populated** |
| Décision d'ajustement de paie | le décideur ≠ le proposant | an adjustment can be proposed, never decided |

With exactly one holder, all three refuse — correctly. **Designating a second Chargé RH is
the single highest-value action available to Effitrans**: it unblocks the mass registration
of employees, which in turn gives every other workspace, and the reporting, something real
to describe. Today the registry holds **3 employees, none active**.

## 3. Seats awaiting designation or ratification

* **DGA / DAF (Direction)** — 0 members. Leave decisions therefore rely entirely on the
  manager lane (a manager with a linked account, on an open primary assignment), and
  performance reviews cannot be finalised.
* **Approbation de paie** — the authority exists and is granted to nobody, pending HR-7 Q7.
  Payroll preparation legitimately stops at « Vérifiée ».
* **Lecture des données sensibles** — granted to nobody by design; C3 documents stay
  invisible until Effitrans decides who may see them.

## 4. Business content Effitrans must still supply

The mechanisms are built and empty. No content was invented on Effitrans' behalf.

| Vocabulary | Where it is configured | Consequence while empty |
|---|---|---|
| Motifs de départ | Configuration | the motive is free text (RQ-8.1 unresolved) |
| Modèles de check-list (Intégration / Départ) | Configuration → Modèles de check-list | cases open with no steps |
| Catalogue de compétences et échelles | Configuration | evaluations have nothing to score |
| Types d'ajustement de paie | Configuration | no adjustment can be proposed |
| Caractère payé des catégories de congé | Configuration | recorded as-is, no conclusion drawn (HR-7 Q4) |
| Méthode du taux de rotation | ratification | no rate is published (RQ-9.3) |
| Calendrier et format d'export de paie | ratification | no export exists (HR-7 Q5/Q6) |

## 5. How this document stays true

The in-platform guide (`/departments/hr/guide`) does not repeat these figures: it **counts
the holders live** and marks each activity « Disponible aujourd'hui » or « Non disponible
aujourd'hui » with the reason. The day a seat is filled, the guide corrects itself — and
so does the reality it describes. This file is the standing narrative; the guide is the
live instrument.
