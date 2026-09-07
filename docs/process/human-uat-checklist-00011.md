# UAT humaine — EFT-IMP-2026-00011, de l'étape 6 à la clôture

**OPS-UAT-CONVERGENCE-01 · produit le 2026-09-07 · schéma de production 138**

> **ENGINEERING COMPLETE NE VEUT PAS DIRE BUSINESS UAT COMPLETE.**
> Les tests, le typecheck, la CI et le build sont passés. Cela n'établit
> qu'une chose : le code fait ce que nous avons écrit. Que le processus soit
> exécutable par du personnel Effitrans sur un dossier réel ne peut être
> établi que par vous, ici.

## État de départ — vérifié en lecture seule sur la production le 2026-09-07

| | |
|---|---|
| Dossier | `EFT-IMP-2026-00011` · type IMP · statut **OPENED** |
| Douane | `customs_record` présent · statut **INSPECTION** · BAE **absent** |
| Nœuds d'exécution | **29** = 26 étapes officielles + 3 activités parallèles |
| Étapes 1→5 | 1 `SKIPPED` (cotation) · 2, 3, 4, 5 `COMPLETED` |
| **Étape 6** | `customs_preparation` — **ACTIVE, déjà attribuée** (Déclarant Douane) |
| Étape 14 | `transport_assignment` — `AVAILABLE` (branche parallèle) |
| Activités | `bon_a_delivrer` et `pre_gate` — `AVAILABLE` · `transport_docs_transmission` — `PENDING` |
| Documents | `BILL_OF_LADING`, `COMMERCIAL_INVOICE`, `CUSTOMS_DECLARATION`, `PACKING_LIST` — tous **VERIFIED** |
| Transfert | Opérations → Transit : **RECEIVED** |
| Mission transport | **aucune** (`transport_record` absent) |
| Migrations | dépôt **140** · production **138** · #139 et #140 **NON APPLIQUÉES** |

**Ce que #139 non appliquée retire de cette UAT :** à l'étape 9, la Finance
douane enregistre **la référence GAINDE seule**. La saisie du détail fiscal
(quittance, montants, lignes DD/TVA/RS) arrive avec #139 et **le formulaire
n'est pas affiché** — pas grisé, pas vide : absent. C'est voulu.

**Ce que #140 non appliquée retire :** les cases « Services demandés » à la
création d'un dossier. Le périmètre reste **dérivé du type** — un IMP a une
branche douane, et le transport reste `UNKNOWN`, donc **aucune** étape n'est
retirée de ce dossier.

---

## Comment lire une fiche

**« Ce qui NE DOIT PAS bloquer »** est la colonne la plus importante de cette
campagne. Si l'un de ces points vous arrête, **c'est un échec de l'UAT** —
notez-le et poursuivez sur un autre point si possible.

**Recours en cas d'échec :** aucune étape franchie ne s'annule d'elle-même.
Le retour arrière gouverné est le **rejet** (`rejectStep`, avec motif
obligatoire), qui renvoie le travail à l'étape de correction déclarée par le
registre. Les flèches ← → de l'en-tête sont **de la navigation uniquement** :
elles ne défont rien.

---

## 1 — Déclarant Douane · étape 6

| | |
|---|---|
| **Rôle de connexion** | `CUSTOMS_DECLARANT` — **celui à qui l'étape est déjà attribuée** |
| **Écran** | `/files/<00011>` → bandeau **« Votre travail sur ce dossier »**, en haut |
| **Action attendue** | En-tête **« Votre action »** · étape 6 · bouton **Terminer** |
| **Action à mener** | Terminer l'étape 6 depuis le dossier — sans passer par `/process` |
| **Preuve réellement exigée MAINTENANT** | `CUSTOMS_DOSSIER` — le `customs_record` doit exister. Il existe (statut INSPECTION). **HARD_GATE** : maker/checker `customs_validation`, le Chef valide cet artefact à l'étape 7 |
| **Avertissements admis** | Toute ligne « Information à compléter ». Le Bon à Délivrer et le Pre-Gate apparaissent en **actions parallèles**, pas en blocages |
| **Ce qui NE DOIT PAS bloquer** | l'absence de BAE · l'absence de mission transport · l'étape 14 ouverte en parallèle · les panneaux Qualité (« Non suivi par la plateforme ») · toute exigence non classifiée |
| **Prochain détenteur** | `CHIEF_OF_TRANSIT` (10 titulaires) — étape 7 |
| **Audit attendu** | `process.step.submitted` (l'étape 6 a un checker : elle passe **SUBMITTED**, pas COMPLETED) + `evidence_summary` |
| **Recours** | Refus ⇒ lire la phrase française. Si elle nomme un document, c'est un HARD gate cité ; sinon c'est un défaut à signaler |
| **PASS** | ① le bandeau du haut nomme **l'étape 6**, pas le Transport ② le Détenteur affiche **une personne**, pas « non attribué » ③ le compteur lit **5/26 étapes officielles + 0/3 activités parallèles** ④ Terminer est accepté depuis le dossier |

## 2 — Chef de Transit · étape 7

| | |
|---|---|
| **Rôle** | `CHIEF_OF_TRANSIT` — **obligatoirement une autre personne que celle de l'étape 6** |
| **Écran** | Dossier → section **Dédouanement**, ou `/queues/transit` |
| **Action attendue** | **« À votre tour »** · étape 7 · Démarrer puis Terminer |
| **Preuve exigée** | `CUSTOMS_DOSSIER` (déjà satisfait). **HARD_GATE** |
| **Avertissements admis** | idem fiche 1 |
| **Ne doit pas bloquer** | l'absence de référence GAINDE (elle arrive à l'étape 9) |
| **Prochain détenteur** | `COORDINATOR` — étape 8 |
| **Audit** | `process.step.approved` + `process.step.completed` sur 6 |
| **PASS** | ⚠ **Le contrôle des quatre yeux est la vraie mesure ici** : reconnectez-vous en tant que **l'auteur de l'étape 6** et vérifiez que la validation est **refusée** (« Vous ne pouvez pas valider votre propre travail »). Ce refus DOIT tenir |

## 3 — Coordinateur · étape 8 (transmission vers la Finance douane)

| | |
|---|---|
| **Rôle** | `COORDINATOR` (16 titulaires) |
| **Écran** | Dossier → section **Coordination Transit** |
| **Action** | Terminer l'étape 8 — c'est la transmission à la Finance douane |
| **Preuve exigée** | aucune |
| **Ne doit pas bloquer** | l'absence de tout artefact documentaire |
| **Prochain détenteur** | `CUSTOMS_FINANCE_OFFICER` (10 titulaires) — étape 9 |
| **Audit** | `process.step.completed` + `process.handoff.sent` |
| **PASS** | l'étape 9 devient visible pour la Finance douane, et pour elle seule |

## 4 — Finance douane · étape 9 (enregistrement GAINDE)

| | |
|---|---|
| **Rôle** | `CUSTOMS_FINANCE_OFFICER` — ⚠ **PAS** `FINANCE_OFFICER`, qui ne détient aucune permission douane |
| **Écran** | Dossier → **Dédouanement** → bouton d'enregistrement GAINDE |
| **Action** | Saisir la **référence GAINDE** et enregistrer |
| **Preuve exigée** | la référence. **Rien d'autre** — schéma 138 |
| **Ne doit pas bloquer** | l'absence du détail fiscal. Le formulaire quittance/DD/TVA **n'existe pas** tant que #139 n'est pas appliquée, et son absence est correcte |
| **Prochain détenteur** | `COORDINATOR` — étape 10 |
| **Audit** | `customs.gainde.registered` + `process.step.completed` |
| **Recours** | `gainde_ledger_unavailable` ⇒ le code a tenté le chemin #139 : **arrêtez et signalez** |
| **PASS** | ① l'enregistrement aboutit ② aucun champ fiscal n'est affiché ③ **aucune** erreur `record_failed` |

## 5 — Coordinateur · étape 10 (retour vers le Déclarant)

| | |
|---|---|
| **Rôle** | `COORDINATOR` |
| **Action** | Terminer l'étape 10 |
| **Preuve exigée** | aucune |
| **Prochain détenteur** | `CUSTOMS_DECLARANT` — étape 11 |
| **PASS** | ⚠ **DEC-C40** : le retour va à la **Coordination**, qui transmet ensuite au Déclarant. Vérifiez que le libellé du transfert dit « à la Coordination » et non « au Déclarant » |

## 6 — Déclarant · étape 11 (rattachement électronique **et** sa vérification)

| | |
|---|---|
| **Rôle** | `CUSTOMS_DECLARANT` |
| **Action** | Téléverser la preuve d'introduction dans GAINDE, la faire **vérifier**, puis terminer l'étape 11 |
| **Preuve exigée** | `GAINDE_SUBMISSION_EVIDENCE` — un document du catalogue au statut **VERIFIED**. **HARD_GATE** (DEC-C40 : les étapes 12 et 13 reposent dessus) |
| **Ne doit pas bloquer** | rien d'autre |
| **Prochain détenteur** | `COORDINATOR` — étape 12 |
| **PASS** | ① un document seulement **téléversé** (non vérifié) ne suffit PAS et le message le dit ② une fois vérifié, Terminer est accepté ③ **DEC-C40** : le rattachement est fait ET vérifié par le Déclarant — aucun second contrôleur n'est demandé |

## 7 — Coordinateur · étape 12 (suivi douanier)

| | |
|---|---|
| **Rôle** | `COORDINATOR` · **Preuve** : aucune · **Suivant** : `CUSTOMS_FIELD_AGENT` |
| **Ne doit pas bloquer** | l'absence d'observation douanière enregistrée |
| **PASS** | l'étape 13 s'ouvre pour l'agent de terrain |

## 8 — Agent de terrain + Chef de Transit · étape 13 (BAE / mainlevée)

| | |
|---|---|
| **Rôles** | `CUSTOMS_FIELD_AGENT` enregistre · **`CHIEF_OF_TRANSIT` approuve** |
| **Action** | Enregistrer la référence BAE, **puis** la faire approuver par le Chef, **puis** terminer l'étape 13 |
| **Preuve exigée** | `BON_A_ENLEVER` — `customs_record.bae_reference`. **HARD_GATE** : la doctrine de souplesse exclut explicitement les contrôles BAE/mainlevée de toute dérogation |
| **Ne doit pas bloquer** | l'absence de mission transport — la branche transport est parallèle |
| **Prochain détenteur** | `PICKUP_AGENT` — étape 15, **mais** l'étape 15 attend aussi l'étape 14 |
| **PASS** | ⚠ **TRANSIT-CUSTODY-05** : une référence BAE **seule** ne doit PAS suffire. Vérifiez que l'enregistrement sans l'approbation du Chef est refusé (`release_not_approved`), et que **la même personne** ne peut pas faire les deux |

## 9 — Account Manager · Bon à Délivrer, Pre-Gate (activités parallèles)

> **⚠ C'EST LA CORRECTION LA PLUS VISIBLE DE CETTE LIVRAISON.** En production
> ces deux activités s'affichaient « **bloquante aujourd'hui ; sa
> classification est en attente de ratification** ». Elles sont désormais
> **SOFT**, avec leur échéance citée : la porte de convergence
> `PICKUP_READINESS` les exige à l'**étape 15**.

| | |
|---|---|
| **Rôle** | `ACCOUNT_MANAGER` (16 titulaires) |
| **Écran** | Dossier → section **Livraison**, et dans « Actions parallèles disponibles » |
| **Action** | Obtenir le BAD et le Pre-Gate, les téléverser, puis terminer les deux activités |
| **Preuve exigée MAINTENANT** | **aucune.** Les deux activités se terminent sans document |
| **Ne doit pas bloquer** | l'absence du BAD · l'absence du Pre-Gate · l'absence de BL |
| **PASS** | ① le message lit « **Information à compléter … À compléter avant l'enlèvement (étape 15) — vous pouvez poursuivre les opérations autorisées** » ② il ne contient **PAS** « Action requise » ③ il ne contient **PAS** « bloquante aujourd'hui » ni « ratification » ④ **Terminer est accepté sans document** ⑤ ces activités apparaissent sous « Actions parallèles », jamais comme « Prochaine action » tant que l'étape courante est ouverte |

## 10 — Service Transport · mission puis étape 14

> **⚠ DEUX ACTES DISTINCTS, DÉSORMAIS DEUX NOMS DISTINCTS.**

| | |
|---|---|
| **Rôle** | `TRANSPORT_OFFICER` (11 titulaires) |
| **Écran** | Dossier → section **Transport** |
| **Action a** | **« Créer la mission transport »** — crée l'enregistrement (`transport:create`) |
| **Action b** | Affecter véhicule + chauffeur, puis **terminer l'étape officielle 14** (`transport:assign`) |
| **Preuve exigée** | aucun document. L'étape 14 se termine sur l'acte |
| **Ne doit pas bloquer** | l'absence de BAE — la branche transport est parallèle et n'attend pas la douane |
| **PASS** | ① le bouton lit « **Créer la mission transport** » et **jamais** « Démarrer le transport » ② la phrase sous le bouton dit que l'étape officielle 14 reste à exécuter ③ pour un **Déclarant** qui regarde la même page, l'étape 14 lit « **Autre service** », **jamais « Bloquée »** ④ un Déclarant ne peut pas terminer l'étape 14 |

## 11 — Enlèvement et livraison · étapes 15, 16, 17

| | |
|---|---|
| **Rôles** | `PICKUP_AGENT` (4) · `ACCOUNT_MANAGER` · `COORDINATOR` |
| **Actions** | 15 enlèvement · 16 suivi jusqu'à réception client · 17 remise des justificatifs |
| **Preuve exigée** | **15** : aucune · **16** : `SIGNED_DELIVERY_NOTE` — **SOFT**, obligatoire à l'étape 17 · **17** : `SIGNED_DELIVERY_NOTE` **VERIFIED** — **HARD** |
| **Ne doit pas bloquer** | à l'étape 16, l'absence du BL signé |
| **PASS** | ① l'étape 15 s'ouvre une fois 13 **et** 14 terminées ② l'étape 16 se termine **sans** le BL signé, avec l'avertissement ③ l'étape 17 le **refuse** sans document vérifié — la chaîne 15→26 étant strictement séquentielle, c'est là que la preuve est tenue |

## 12 — Contrôles finaux et facturation · étapes 18 → 22

| | |
|---|---|
| **Rôles** | `COORDINATOR` (18) · `ACCOUNT_MANAGER` (19) · `BILLING_OFFICER` (20, 22) · `FINANCE_OFFICER` (21) |
| **Preuve exigée** | **18** : `RECEIPT` + `PAYMENT_PROOF` — ⚑ **non classifiées, ne bloquent pas** · **20/21** : aucune · **22** : `FINAL_INVOICE` (facture émise, non brouillon) — **HARD** |
| **Ne doit pas bloquer** | à l'étape 18, l'absence de reçus et de preuves de paiement tierces |
| **PASS** | ① l'étape 18 se termine avec les deux exigences ouvertes, en avertissement ② **maker/checker facturation** : le rédacteur de l'étape 20 ne peut PAS valider l'étape 21 ③ l'étape 22 est refusée tant qu'aucune facture n'est émise |

## 13 — Dépôt, remise et recouvrement · étapes 23 → 26

| | |
|---|---|
| **Rôles** | `ADMINISTRATIVE_OFFICER` (23, 25) · `COURIER` (24) · `COLLECTIONS_OFFICER` (26) |
| **Preuve exigée** | **23** : `FINAL_INVOICE` (HARD) · **24** et **25** : `PROOF_OF_DEPOSIT` (HARD — l'artefact **est** l'acte) · **26** : aucune |
| **PASS** | le dépôt physique ne peut être déclaré sans sa preuve |

## 14 — Clôture

| | |
|---|---|
| **Rôle** | `OPS_SUPERVISOR` (9 titulaires) — ⚠ **la clôture appartient aux Opérations, pas au Recouvrement** |
| **Écran** | Dossier → **Faire avancer** |
| **Action** | Clôturer le dossier |
| **Preuve exigée** | la porte de clôture : **chaque** nœud terminé ou délibérément sauté |
| **Ne doit pas bloquer** | une étape `SKIPPED` — sauté n'est ni terminé ni en échec, et la clôture l'accepte |
| **PASS** | ① la clôture est refusée tant qu'un nœud reste ouvert, en le **nommant** ② une fois clôturé, le bandeau du haut lit « Aucune action ouverte » ③ le compteur final lit **/26**, jamais /29 |

---

## Vérifications transversales — à faire une fois, n'importe quand

| # | À vérifier | PASS |
|---|---|---|
| T1 | **Une seule action courante.** Comparez le bandeau du dossier, le panneau « Parcours officiel », `/process` et la file du service | les quatre nomment la **même** étape courante |
| T2 | **Comptage.** Le bandeau et le panneau Parcours | « X/26 étapes officielles » **et**, séparément, « Y/3 activités parallèles ». Jamais « /29 » |
| T3 | **Navigation.** Liste dossiers → dossier → Documents → `/process` → ← ← → → | le retour ramène à la page précédente ; ← est **désactivé** au premier écran ; **Alt+←/→** font la même chose ; ⚠ **après un retour arrière, l'étape franchie reste franchie** |
| T4 | **Administrateur.** Connectez-vous en `SYSTEM_ADMIN` et ouvrez 00011 | l'étape 6 lit « **Travail en cours** » avec **aucun bouton**. Un admin n'est pas tous les métiers |
| T5 | **Qualité.** Section **Qualité**, en bas, repliée | les quatre panneaux QC y sont tous, complets ; aucun « Non renseigné » n'empêche quoi que ce soit |
| T6 | **Route dossier.** Ouvrez `EFT-IMP-2026-00003`, `00004`, `00011` et `EFT-TRP-2026-00001` | **aucune** « Une erreur est survenue » |
| T7 | **Création de dossier.** `/files/new` | **aucune** case « Services demandés » — #140 n'est pas appliquée, et une case dont la valeur ne peut pas être enregistrée serait un mensonge |

---

## Ce que cette campagne ne peut PAS établir

* **Les 108 exigences signalées** ne sont pas arbitrées. Elles ne bloquent
  plus ; elles restent visibles et en attente d'une décision Effitrans.
* **Le volet transport du périmètre de service** (`RQ-SS-1..3`) n'est pas
  ratifié. Aucune règle ne produit aujourd'hui « transport non applicable »,
  donc rien n'est retiré d'aucun dossier — mais les trois questions restent
  ouvertes.
* **#139 et #140** ne sont pas appliquées. Le détail fiscal GAINDE et le
  choix explicite des services ne peuvent pas être testés.
* **`EFT-TRP-2026-00001`** porte neuf étapes douane `PENDING` qui ne
  s'ouvriront jamais. Le code ne les compte plus comme prérequis, mais leurs
  **lignes** restent telles quelles : rien n'a été muté. Leur disposition
  (`skipStep` avec motif) est une décision d'exploitation.
