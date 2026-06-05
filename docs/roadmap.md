# Feuille de route — Effitrans Operations Platform

Ce document met en correspondance **chaque métier Effitrans** avec un **module SaaS**
de la plateforme, et indique son état : **✅ Implémenté** (maquette UI fonctionnelle,
données simulées) ou **🔜 Planifié**.

> Contexte technique actuel : maquette UI uniquement — pas de base de données,
> pas d'authentification, pas d'API, données simulées (`lib/*.ts`). Les modules
> « Implémenté » désignent une interface opérationnelle complète prête à être
> branchée sur un back-end (Supabase, API douane GAINDE, etc.).

---

## 1. Socle déjà livré (transverse)

Modules fondations qui servent tous les métiers ci-dessous :

| Module | Route | État |
|---|---|---|
| Centre d'opérations (tableau de bord) | `/dashboard` | ✅ Implémenté |
| Clients (répertoire, contacts, pièces) | `/customers` | ✅ Implémenté |
| Documents (suivi & validation des pièces) | `/documents` | ✅ Implémenté |
| Tâches & workflow (exécution opérationnelle) | `/tasks` | ✅ Implémenté |
| Finance | `/finance` | 🔜 Planifié (route placeholder) |
| Rapports | `/reports` | 🔜 Planifié (route placeholder) |
| Utilisateurs | `/users` | 🔜 Planifié (route placeholder) |
| Paramètres | `/settings` | 🔜 Planifié (route placeholder) |

---

## 2. Métiers Effitrans → Modules SaaS

| Métier Effitrans | Module SaaS cible | Route | État |
|---|---|---|---|
| **Dédouanement** | Dédouanement (déclarations, BAE, liquidations) | `/customs` | ✅ Implémenté |
| **Fret aérien et maritime** | Expéditions — multimodal (maritime / aérien / routier) | `/shipments` | ✅ Implémenté |
| **Freight Forwarding** | Socle Expéditions + Dédouanement + Documents | `/shipments` · `/customs` · `/documents` | ✅ Implémenté (socle) |
| **Transport routier** | Transport routier (flotte, tournées, suivi camions) | `/road` *(à créer)* | 🔜 Planifié |
| **Entreposage** | Entreposage / WMS léger (stocks, emplacements) | `/warehousing` *(à créer)* | 🔜 Planifié |
| **Manutention** | Manutention (opérations terminal, équipes, engins) | `/handling` *(à créer)* | 🔜 Planifié |
| **Groupage et dégroupage** | Groupage / Consolidation (LCL, plans de chargement) | `/consolidation` *(à créer)* | 🔜 Planifié |
| **Consignation de navire** | Consignation maritime (escales, manifestes, ETA/ETD) | `/ship-agency` *(à créer)* | 🔜 Planifié |
| **Déménagement** | Déménagement (devis, inventaire, planning) | `/moving` *(à créer)* | 🔜 Planifié |

---

## 3. Détail des modules planifiés

### 🔜 Transport routier — `/road`
Gestion du post-acheminement et du transport national/sous-régional.
- Flotte (camions, remorques, disponibilité) et chauffeurs
- Tournées et affectations, positionnement des camions
- Suivi des livraisons (corridors Sénégal ↔ Mali / Guinée / Mauritanie)
- Lettres de voiture (CMR), frais et états de route
- **Liens** : Expéditions (segment routier), Clients, Tâches

### 🔜 Entreposage — `/warehousing`
WMS léger pour les marchandises sous douane et hors douane.
- Entrées/sorties, emplacements, niveaux de stock
- Magasinage sous douane (lien régime / entrepôt fictif)
- Inventaires, mouvements, frais de stockage
- **Liens** : Dédouanement (régime entrepôt), Expéditions, Documents

### 🔜 Manutention — `/handling`
Opérations physiques au terminal / sur site.
- Ordres de manutention, équipes et engins (grues, chariots)
- Empotage / dépotage de conteneurs, pesées
- Bons de travaux et facturation des prestations
- **Liens** : Entreposage, Groupage, Expéditions

### 🔜 Groupage et dégroupage — `/consolidation`
Consolidation LCL et organisation des envois groupés.
- Plans de groupage (master / house), plans de chargement conteneur
- Dégroupage à l'arrivée et ventilation par client/HBL
- Optimisation du remplissage (volume / poids)
- **Liens** : Expéditions, Dédouanement, Entreposage

### 🔜 Consignation de navire — `/ship-agency`
Représentation des armateurs au Port Autonome de Dakar.
- Escales (ETA/ETD), avis d'arrivée, manifestes
- Coordination pilotage / remorquage / accostage
- Suivi des conteneurs et débours d'escale
- **Liens** : Expéditions, Dédouanement, Finance

### 🔜 Déménagement — `/moving`
Déménagements nationaux et internationaux (porte-à-porte).
- Demandes & devis, visite technique, inventaire des biens
- Planning des équipes, emballage, assurance
- Suivi porte-à-porte et dédouanement effets personnels
- **Liens** : Clients, Transport routier, Dédouanement

---

## 4. Phasage proposé (post-socle)

| Phase | Module | Priorité | Justification |
|---|---|---|---|
| 8 | Finance | Haute | Liquidations, débours, facturation — déjà référencés par Dédouanement |
| 9 | Transport routier | Haute | Post-acheminement déjà visible dans Expéditions |
| 10 | Entreposage | Moyenne | Lié au magasinage sous douane |
| 11 | Groupage / dégroupage | Moyenne | Complète le freight forwarding |
| 12 | Manutention | Moyenne | S'appuie sur Entreposage + Groupage |
| 13 | Consignation de navire | Moyenne | Métier distinct, fort lien Port de Dakar |
| 14 | Déménagement | Basse | Métier autonome, faible dépendance |
| — | Rapports · Utilisateurs · Paramètres | Continue | Transverses, livrés en parallèle |

---

## 5. Principes directeurs

- **Réutiliser le design system** existant (cartes KPI, badges de statut, tables
  responsive, timelines, chips agents) pour chaque nouveau module.
- **Tout relier** : chaque module se rattache aux Clients, Expéditions, Dédouanement,
  Documents et Tâches existants.
- **French-first**, ton opérations/logistique sérieux, contexte Sénégal / Dakar.
- **Données simulées d'abord**, puis branchement back-end (Supabase + APIs métier)
  sans refonte de l'UI.

_Dernière mise à jour : 5 juin 2026._
