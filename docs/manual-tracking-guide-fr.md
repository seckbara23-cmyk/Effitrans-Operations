# Suivi manuel — guide de l'opérateur (français)

Le Studio de suivi manuel permet aux opérateurs autorisés d'enregistrer la position et les
étapes d'une expédition lorsqu'aucun fournisseur externe (AIS, transporteur) n'est connecté.

**Toute donnée saisie ici est une SAISIE MANUELLE.** Elle n'est jamais présentée comme
« confirmée par le transporteur » ni « en direct ». La carte et le journal affichent toujours la
source et l'âge de chaque information.

## Permissions

- Enregistrer une position/étape : **`transport:update`** (Coordinateur, Agent transport,
  Superviseur, Administrateur système, Agent d'enlèvement).
- Gérer les ports/aéroports et leurs coordonnées : **`transport:manage`** (Coordinateur, Agent
  transport, Superviseur, Administrateur système).

## Prérequis pour une carte

Une expédition n'apparaît sur la carte que si des **coordonnées** existent :
1. le port/aéroport d'origine et de destination ont une latitude/longitude (page Ports /
   Aéroports — champs Lat/Lon) ; **ou**
2. une position manuelle avec latitude/longitude a été saisie.
Sans coordonnées, la carte affiche honnêtement « Carte indisponible ».

## Enregistrer une position

1. Ouvrir l'expédition → Studio de suivi manuel.
2. Type d'évènement : « Mise à jour de position » (ou une étape).
3. Saisir la date/heure, la latitude et la longitude (décimales), le nom du lieu.
4. **Aperçu** : vérifier l'effet affiché et l'éventuel avertissement d'ordre chronologique.
5. Si l'évènement précède une étape déjà enregistrée, cocher la case de correction.
6. **Confirmer**. Un évènement audité est écrit ; la carte et le journal se mettent à jour.

## Règles

- Coordonnées valides uniquement : latitude −90 à 90, longitude −180 à 180 (rejet applicatif
  ET base de données).
- Le journal est **immuable** : une erreur se corrige par un nouvel évènement qui supplante
  l'ancien, jamais par modification.
- Une position plus ANCIENNE ne remplace jamais une position actuelle plus récente.
- Chaque ligne du journal affiche sa **source** (« Saisie manuelle », « GPS routier »…) et,
  pour la position actuelle, son **âge** (« il y a 2 h »).
