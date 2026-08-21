# Dossier de décision Effitrans — Indices ICTD / ICAM / IPAM

**Destinataires :** F.T. et la Direction Effitrans.
**Objet :** quatre décisions métier nécessaires avant toute mise en œuvre du
dispositif dans la plateforme. **Aucun développement n'a commencé et aucun ne
commencera avant ces réponses.**

Le travail de vérification (Phase 0) a confirmé que la note méthodologique et les
deux classeurs 2026 sont **cohérents entre eux** sur toutes les formules, tous les
coefficients et tous les exemples chiffrés. Les quatre points ci-dessous sont les
seuls où une décision d'Effitrans est indispensable. Les questions sont posées en
termes métier ; les références techniques sont en annexe.

---

## Décision 1 — Le type de déclaration « DPE »

**Ce qu'Effitrans doit décider :** le type « DPE » fait-il partie des types de
déclaration officiels, et si oui, avec quel coefficient de charge ?

**Situation actuelle :**
* La note méthodologique liste **quatre** types : SIMPLE (1,00), APE (1,40),
  DEP (1,30), OG (1,50).
* Le classeur ICTD 2026 en propose **cinq** : les quatre ci-dessus **plus DPE à
  1,30**.
* L'ancien fichier de suivi utilisait DPE à **1,40** et ne connaissait pas DEP.

**Options :**

| Option | Conséquence |
| --- | --- |
| **A — Ratifier DPE à 1,30** (comportement du classeur 2026) | Cinq types officiels ; un dossier DPE pèse comme un dossier DEP |
| B — Ratifier DPE à 1,40 (valeur de l'ancien fichier) | Cinq types ; un dossier DPE pèse comme un dossier APE |
| C — Supprimer DPE (liste stricte de la note) | Quatre types ; les dossiers actuellement saisis « DPE » devront être requalifiés |

**Pourquoi c'est important :** le coefficient multiplie la charge de tout le bloc
principal du dossier. Un type non reconnu laisse l'ICTD du dossier **vide** — le
dossier ne compte pas dans la charge du déclarant.

**Question complémentaire indispensable :** DEP et DPE sont-ils bien **deux types
réellement distincts** dans la pratique douanière d'Effitrans, ou s'agit-il de deux
écritures du même type ?

**Recommandation :** Option **A**, sous réserve que DPE soit un type réellement
utilisé. Le classeur 2026 est le paramétrage le plus récent et délibéré ; la valeur
1,40 de l'ancien fichier relève d'un modèle abandonné. Mais seule Effitrans sait si
DPE existe comme catégorie opérationnelle.

**Effet dans la plateforme selon la réponse :** la liste des types proposée aux
déclarants et le coefficient appliqué. Rien d'autre ne change.

---

## Décision 2 — Priorité des statuts de fiabilité

**Ce qu'Effitrans doit décider :** quand un collaborateur a À LA FOIS moins de
10 dossiers ET une couverture de données inférieure à 80 %, quel statut s'affiche ?

**Situation actuelle :** les deux classeurs 2026 répondent différemment.
* Classeur **déclarants** : la couverture est testée d'abord → statut
  **« Non classé »**.
* Classeur **Account Managers** : le volume est testé d'abord → statut
  **« Provisoire »**.
* La note méthodologique définit les statuts mais **pas leur ordre de priorité**.

**Options :**

| Option | Lecture |
| --- | --- |
| **A — La couverture prime** (ordre du classeur déclarants) | « Des données incomplètes ne se publient pas, quel que soit le volume » → Non classé |
| B — Le volume prime (ordre du classeur AM) | « Trop peu de dossiers pour juger, la couverture se lira plus tard » → Provisoire |

**Pourquoi c'est important :** le même mois, la même situation, donnerait deux
messages différents à un déclarant et à un Account Manager. « Non classé » et
« Provisoire » n'ont pas le même poids dans une revue d'équipe.

**Recommandation :** Option **A** (la couverture prime), pour les deux populations.
La note pose que le manque de données « peut empêcher le classement » : un résultat
construit sur moins de 80 % de données n'est pas fiable, même provisoirement. Mais
l'option B est défendable si Effitrans préfère un message moins sévère en phase
pilote.

**Effet dans la plateforme selon la réponse :** un seul ordre de statut, identique
pour déclarants et Account Managers. Aucun recalcul d'historique.

---

## Décision 3 — Calendrier officiel des jours ouvrés

**Ce qu'Effitrans doit décider :**
1. Quel est le **calendrier officiel** des jours non ouvrés : jours fériés légaux du
   Sénégal uniquement, ou également les fermetures propres à Effitrans (ponts,
   fermetures exceptionnelles) ?
2. **Qui** tient ce calendrier à jour et le valide (proposition : RH, validation
   Direction, mise à jour annuelle) ?
3. À partir de **quelle date** il s'applique (proposition : le 06/08/2026, début du
   suivi ICTD) ?

**Situation actuelle :** la table des jours fériés est **vide** dans les deux
classeurs. Conséquence concrète : un jour férié non enregistré est compté comme un
jour ouvré écoulé — **le délai calculé est plus long qu'en réalité, au détriment du
déclarant**, et un SLA peut apparaître dépassé à tort. Exemple chiffré : dossier
complet le vendredi, BAE le lundi férié → délai réel 0 jour ouvré ; avec la table
vide, 1 jour.

**Pourquoi c'est important :** l'équité du délai et du taux SLA — l'une des quatre
composantes du facteur de performance des déclarants — dépend directement de ce
calendrier.

**Recommandation :** jours fériés légaux sénégalais **plus** les fermetures
Effitrans validées ; tenue par RH avec validation Direction ; application au
06/08/2026 ; **aucune correction rétroactive** des délais déjà constatés sans
autorisation formelle (règle de non-rétroactivité de la note, §17.2).

**Effet dans la plateforme selon la réponse :** création d'un référentiel calendrier
(inexistant aujourd'hui) et calcul automatique des délais en jours ouvrés. Tant que
ce calendrier n'est pas validé, tout indicateur en jours ouvrés sera marqué « non
fiable ».

---

## Décision 4 — Les cinq faits douaniers à capter : source, preuve, validation, correction

La plateforme sait déjà fournir la majorité des données du dispositif (cotations,
BAE, documents, autorisations de dépense, factures fournisseurs, horodatages…).
**Cinq faits techniques douaniers n'existent nulle part aujourd'hui** et
conditionnent l'ICTD. Pour chacun, Effitrans doit confirmer : *qui le saisit, à quel
moment, sur quelle preuve, qui le valide, qui peut le corriger.*

| Fait | Ce qu'il pèse dans l'ICTD | Proposition (schéma de la note, §12) |
| --- | --- | --- |
| **Nombre de positions SH** du dossier | 0,30 unité par position, multipliée par l'origine du classement | Saisi par le **déclarant** au moment de la déclaration ; preuve : la déclaration ; validé par le **Chef de Transit** (acte de validation déjà existant) |
| **Type de déclaration** (SIMPLE/APE/DEP/OG, ±DPE selon Décision 1) | coefficient ×1,00 à ×1,50 sur tout le bloc | Fixé à la déclaration ; preuve : déclaration/GAINDE ; même circuit |
| **Prise en charge DPI** (4 cas : sans DPI · client-expédition · client-globale · EFFITRANS) | +0 / +0 / +0,50 / +1,00 unité | Déclaré par le **déclarant** ; preuve : la DPI ou son imputation ; validé Chef de Transit |
| **Titre d'exonération — préparé par** (EFFITRANS / client / sans objet) | +0,80 unité si EFFITRANS | idem |
| **Position tarifaire — fournie par** (client / EFFITRANS) | détermine le coefficient 0,60 ou 1,20 | idem |

**Questions à trancher :**
1. Ce circuit « le déclarant saisit, le Chef de Transit valide » convient-il pour
   ces cinq faits ? (C'est le schéma que la note prévoit déjà pour les faits de
   dossier.)
2. Quelle est la **preuve de référence** admise pour chacun (déclaration, GAINDE,
   autre) ?
3. **Correction** : avant la clôture mensuelle, correction par le superviseur ;
   après clôture, uniquement par correction formelle et traçable (§16.12 / §17.1 de
   la note). Confirmer.

**Pourquoi c'est important :** sans ces cinq faits, l'ICTD d'un dossier ne peut pas
être calculé du tout. Et s'ils sont saisis sans preuve ni validateur, l'indice perd
la traçabilité que la note exige (§3.2).

**Effet dans la plateforme selon la réponse :** ces faits deviennent des champs
structurés du dossier douane, saisis une seule fois dans la plateforme (jamais de
double saisie Excel), verrouillés par la validation, corrigés selon le circuit
confirmé.

---

## Ce qui n'est PAS demandé à Effitrans

* Les formules elles-mêmes : elles sont **conformes** entre note et classeurs, et
  gelées telles quelles (y compris arrondis).
* Les règles de gouvernance (vide ≠ réussite, imputabilité avant pénalité,
  couverture 80 %, minimum 10 dossiers, pilote de 3 mois, cibles vides) : déjà
  écrites et respectées.
* La reproductibilité des périodes passées lors d'un changement de coefficient :
  c'est un **invariant d'architecture** pris en charge par la plateforme, pas un
  choix à faire (voir `parameter-versioning-invariant.md`).
* Le sort de l'ancien fichier de suivi : il repose sur un modèle abandonné et ne
  sera pas copié ; son historique reste consultable en l'état.

---

## Annexe technique (références et preuves)

| Décision | Références |
| --- | --- |
| D1 — DPE | Note §5.2 (4 types) ; classeur ICTD `PARAMETRES!E2:F6` (5 types, DPE=1,30) et `LISTES!D2:D6` ; legacy : CDP hard-codé `DPE=1,40`, pas de DEP. Registre : DV-01, DV-09 ; contrat ICTD-D05 ; fixtures F-ICTD-05/06 |
| D2 — Statuts | ICTD `RECAP!Q` (couverture avant volume) vs AM `RECAP!AB` (volume avant couverture) ; note §11.1/§11.2 sans ordre. DV-02 ; contrats ICTD-R16, AM-R28 ; fixture F-STAT-05 |
| D3 — Fériés | `FERIES` vide (ICTD ; AM « volontairement vide ») ; délai = `MAX(0, NETWORKDAYS.INTL(Q,V,1,FERIES!A2:A50)−1)` (contrat ICTD-D11) ; DV-04 (sens corrigé le 2026-08-21 : table vide ⇒ délais PLUS LONGS, défavorables au déclarant) ; fixture F-SLA-06 |
| D4 — Faits douaniers | Colonnes de saisie ICTD I, J, K, L, N, AA ; contrats ICTD-D04…D08 ; carte des sources `platform-data-source-map.md` §B (NOT AVAILABLE) ; note §3.2 (traçabilité), §12 (rôles), §16.12/§17.1 (corrections) |

Phase 0 : parité gelée au commit `8161333` (7 documents, 124 contrats, 62 fixtures).
