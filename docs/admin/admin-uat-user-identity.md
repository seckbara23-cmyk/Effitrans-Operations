# UAT Administrateur — Identité professionnelle des utilisateurs

**ADMIN-USER-IDENTITY-01 / DBC-STAFF-IDENTITY-01 · 2026-09-07 · schéma de production 138**

> **PRÊT POUR L'UAT ADMINISTRATEUR.** Cela ne veut pas dire que l'UAT Effitrans
> est terminée. L'UAT opérationnelle reste **EN PAUSE** sur
> `EFT-IMP-2026-00011`, étape 6/26, Déclarant Douane — et n'a pas été touchée.

## ⚠ À lire avant de commencer

**Utilisez un employé de démonstration**, pas une identité critique. Les comptes
`*.demo@effitrans.sn` conviennent (`Chef Transit Demo`, `Account Manager Demo`,
`Caisse Demo`…).

**Deux des quatre champs ne sont pas encore disponibles.** La migration
`20261003000001` n'est **pas appliquée**. Sur cette base vous pouvez modifier :

| Champ | Aujourd'hui | Enregistré dans |
|---|---|---|
| **Nom complet** | ✅ modifiable | `app_user.name` |
| **Titre principal** | ✅ modifiable | `workforce_profile.job_title` |
| **Prénom** / **Nom** séparés | ⧗ après migration #141 | `workforce_profile.first_name` / `last_name` |
| **Fonction** | ⧗ après migration #141 | `workforce_profile.staff_function` |

Les deux champs différés **ne sont pas affichés** — pas grisés, pas ignorés — et
l'écran explique pourquoi. Si vous voyez un champ « Prénom », c'est que la
migration a été appliquée : **signalez-le**, elle ne devrait pas l'être.

---

## Séquence

### 1 — Connexion

| | |
|---|---|
| **Rôle** | `SYSTEM_ADMIN` (10 titulaires) |
| **PASS** | la connexion aboutit |

### 2 — Administration → Utilisateurs

| | |
|---|---|
| **Écran** | `/users` |
| **PASS** | ① la liste s'affiche ② chaque ligne montre le **nom**, l'e-mail et, en dessous, le **titre principal** ③ les **rôles** sont dans leur **propre colonne** — identité professionnelle et rôle système sont deux faits distincts et doivent se lire comme tels |

### 3 & 4 — Sélectionner l'employé de démonstration, puis **Modifier**

| | |
|---|---|
| **Action** | cliquer **« Modifier »** sur la ligne |
| **PASS** | ① le bouton dit bien **« Modifier »** et non « Détails » ② il ouvre `/users/<id>` ③ le premier bloc de la page est **« Identité et profil professionnel »** |

### 5 — Relever l'identité actuelle

Notez avant toute modification : **nom affiché · titre principal · rôle(s) ·
statut**. Vous en aurez besoin aux étapes 14 à 17.

| **PASS** | les valeurs affichées correspondent à ce que montrait la liste |
|---|---|

### 6 — Changer le nom

| | |
|---|---|
| **Action** | remplacer le nom complet — par exemple `Mamadou Diallo` → `Mamadou A. Diallo` |
| **PASS** | le champ accepte la saisie |

### 7 — Changer la Fonction

| | |
|---|---|
| **Attendu aujourd'hui** | **le champ n'existe pas**, et un encadré ambre explique que la migration `20261003000001` n'est pas appliquée |
| **PASS** | ① aucun champ Fonction n'est proposé ② le message le dit explicitement ③ il précise qu'**aucune donnée n'est perdue** |

### 8 — Changer le Titre principal

| | |
|---|---|
| **Action** | par exemple `Responsable des Opérations` → `Directeur des Opérations` |
| **PASS** | ① le champ est libre (pas de liste imposée) ② l'étiquette dit bien **« Titre principal »**, jamais « Fonction » |

### 9 — Enregistrer

| | |
|---|---|
| **PASS** | ① message **« Profil enregistré. »** ② aucune erreur ③ la page se rafraîchit sans déconnexion |

### 10 — Revenir à la liste

| | |
|---|---|
| **PASS** | ① le **nouveau nom** apparaît ② le **nouveau titre** apparaît sous l'e-mail ③ **le rôle est inchangé** |

### 11 — Digital Branding Center

| | |
|---|---|
| **Écran** | `/brand-center` → l'employé |
| **PASS** | ① le **nouveau titre** y figure **sans aucune ressaisie** ② l'étiquette dit **« Titre principal »** ③ une phrase renvoie vers *Administration → Utilisateurs* pour le nom et la fonction ④ ⚠ **il n'y a qu'une seule valeur** : le titre modifié à l'étape 8 est celui affiché ici. Si les deux écrans montrent des titres différents, **c'est un échec** |

### 12 — Carte de visite numérique

| | |
|---|---|
| **Écran** | `/brand-center/card/<userId>`, puis la carte publique si elle est activée |
| **PASS** | ① **nouveau nom** ② **nouveau titre** ③ la fonction n'apparaît pas — normal, migration #141 non appliquée ④ aucun titre saisi séparément dans la carte |

### 13 — Signature e-mail

| | |
|---|---|
| **Écran** | `/brand-center/signature/<userId>` |
| **PASS** | ① la signature **régénérée** porte le nouveau nom et le nouveau titre ② ⚠ **un e-mail déjà envoyé n'est pas réécrit** — c'est voulu : l'historique n'est pas falsifié |

### 14 & 15 — Rôle et permissions inchangés

| | |
|---|---|
| **PASS** | ① le ou les rôles relevés à l'étape 5 sont **identiques** ② ⚠⚠ **le titre « Directeur des Opérations » n'a accordé AUCUN droit** ③ l'employé de démonstration ne voit aucun écran nouveau ④ le statut du compte est inchangé |

### 16 — Les affectations opérationnelles survivent

| | |
|---|---|
| **Action** | ouvrir un dossier où l'employé est **Responsable client** ou détient une étape |
| **PASS** | ① le dossier référence **toujours la même personne** ② le nouveau nom s'affiche ③ aucune affectation n'a disparu |
| **Pourquoi** | les 204 clés étrangères qui référencent un utilisateur sont **toutes des UUID**. Aucune relation opérationnelle n'est indexée sur du texte : il n'y a rien à casser |

### 17 — Journal d'audit

| | |
|---|---|
| **Écran** | Administration → Journal d'audit |
| **PASS** | ① une entrée **`user.identity.updated`** ② elle nomme **l'administrateur** (acteur) ③ elle nomme **l'employé** (cible) ④ elle porte **l'ancienne et la nouvelle** valeur ⑤ ⚠ **aucun mot de passe, jeton ou donnée de session** ⑥ ce **n'est pas** un événement `user.role.*` — modifier une identité n'est pas un changement de privilège |

---

## Contrôles adverses — à tenter délibérément

| # | Tentative | Attendu |
|---|---|---|
| A1 | Se connecter en employé ordinaire et ouvrir `/users` | **refusé** |
| A2 | Mettre un titre de 200 caractères | **refusé**, message clair, rien enregistré |
| A3 | Enregistrer sans rien modifier | « Aucune modification à enregistrer. » |
| A4 | Modifier un utilisateur **archivé** | **refusé** — restaurez-le d'abord |
| A5 | Vider le titre puis enregistrer | accepté : un titre peut être retiré |
| A6 | Mettre `Chef de Transit` comme titre | ⚠⚠ **aucun rôle, aucune permission accordée** |

---

## Ce que cette campagne ne peut pas établir

* **Prénom, Nom séparés et Fonction** — migration `20261003000001` non appliquée.
* **La réconciliation avec le registre RH** (`employee`) — RQ-ID-1. Trois
  employés RH existent, deux sont liés à un compte, et les deux portent
  aujourd'hui un nom **différent** de celui du compte. Renommer un compte ne
  renomme pas la fiche RH, et inversement. Personne n'a tranché lequel fait foi.
* **L'UAT opérationnelle** reste en pause sur `EFT-IMP-2026-00011`, étape 6/26.
