/**
 * HR-10A — Guide utilisateur & SOP RH: THE CONTENT. Pure and typed.
 *
 * Written for a Chargé RH, not for an engineer. Every section answers the same
 * questions in the same order — qui, quand, les étapes, les pièces, ce que le
 * système fait seul, ce qui se fait ailleurs — because an SOP is only usable if
 * its shape never surprises the reader.
 *
 * THREE RULES THIS FILE OBEYS:
 *
 * 1. Labels are quoted from the shipped interface, never paraphrased. If a
 *    button says « Marquer fait », the guide says « Marquer fait ».
 * 2. No permission code, no SQLSTATE, no table name reaches the page. Authority
 *    is described in words (« un second Chargé RH »); the machine-readable code
 *    lives only in `requires`, which drives the availability badge and is never
 *    rendered.
 * 3. No Effitrans business content is invented. Where a vocabulary ships empty
 *    — motifs de départ, modèles de check-list, catalogue de compétences, types
 *    d'ajustement — the guide explains the MECHANISM and marks the content as
 *    « à fournir par Effitrans ». RQ-8.1 and its siblings stay unanswered here.
 *
 * AVAILABILITY IS COMPUTED, NOT WRITTEN (RQ-10.2). A section declares the
 * authority its workflow needs and how many DISTINCT people must hold it — two,
 * where a maker-checker control requires a second pair of eyes. The page counts
 * the actual holders and renders « Non disponible aujourd'hui » with the reason.
 * The day Effitrans designates a second Chargé RH, the guide corrects itself:
 * capability implemented ≠ capability currently operable.
 */

/** An authority a workflow needs, and how many distinct people must hold it. */
export type GuideRequirement = {
  code: string;
  /** 2 where a maker-checker control needs a second, distinct person. */
  minHolders: number;
  /** Said in plain French when the requirement is unmet. */
  labelFr: string;
};

export type GuideSection = {
  /** Anchor — also the key used by a workspace's « Aide » link. */
  id: string;
  title: string;
  /** The workspace this section documents, when there is one. */
  route: string | null;
  /** Qui. */
  audience: string;
  /** Quand. */
  when: string;
  /** Les étapes, numérotées, dans l'ordre. */
  steps: string[];
  /** Les pièces / informations nécessaires. */
  evidence: string[];
  /** Ce que le système fait tout seul. */
  automatic: string[];
  /** Ce qui se fait ailleurs — les frontières, nommées. */
  elsewhere: string[];
  /** Ce qu'Effitrans doit encore fournir (contenu, pas logiciel). */
  toSupply: string[];
  requires: GuideRequirement[];
};

const HR_MANAGE: GuideRequirement = {
  code: "hr:manage", minHolders: 1,
  labelFr: "un Chargé RH (autorisation de gestion RH)",
};
const HR_MANAGE_TWO: GuideRequirement = {
  code: "hr:manage", minHolders: 2,
  labelFr: "DEUX Chargés RH distincts — le contrôle exige que le vérificateur ne soit pas l'auteur",
};
const HR_CONFIG: GuideRequirement = {
  code: "hr:config:manage", minHolders: 1,
  labelFr: "un Chargé RH habilité à la configuration",
};
const HR_LEAVE_APPROVE: GuideRequirement = {
  code: "hr:leave:approve", minHolders: 1,
  labelFr: "un siège Direction (DGA ou DAF) pour la décision hors ligne managériale",
};
const HR_PERF_FINAL: GuideRequirement = {
  code: "hr:performance:finalize", minHolders: 1,
  labelFr: "un siège Direction habilité à finaliser les évaluations",
};
const HR_PAYROLL_APPROVE: GuideRequirement = {
  code: "hr:payroll:approve", minHolders: 1,
  labelFr: "un siège d'approbation de paie — autorisation créée mais attribuée à personne, en attente de ratification",
};
const HR_REPORTS: GuideRequirement = {
  code: "hr:reports:read", minHolders: 1,
  labelFr: "un lecteur de rapports RH",
};

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: "prise-en-main",
    title: "Prise en main",
    route: null,
    audience: "Toute personne travaillant dans le module RH.",
    when: "À lire une fois, avant tout le reste.",
    steps: [
      "Ouvrez « Ressources humaines » depuis le menu : le tableau de bord affiche les effectifs, les alertes et un espace de travail par activité.",
      "Retenez la distinction essentielle : un EMPLOYÉ est une fiche du registre RH ; un COMPTE DE CONNEXION est un accès à la plateforme. Ce sont deux choses séparées.",
      "Une personne peut avoir une fiche employé sans compte, un compte sans fiche employé, ou les deux liés. Lier les deux ne donne aucun droit supplémentaire.",
      "Chaque espace de travail n'affiche que ce que votre autorisation permet. Une tuile grisée indique l'autorisation qui manque — ce n'est pas une panne.",
    ],
    evidence: [],
    automatic: [
      "Chaque action RH est enregistrée dans l'historique de l'employé et dans le journal d'audit ; rien ne s'efface.",
      "Les chiffres du tableau de bord sont calculés à l'ouverture de la page, à partir des dossiers réels.",
    ],
    elsewhere: [
      "La création, la suspension et l'archivage des comptes de connexion se font dans Administration → Utilisateurs, par l'administration des comptes.",
    ],
    toSupply: [],
    requires: [],
  },
  {
    id: "registre",
    title: "Registre des employés",
    route: "/departments/hr/registre",
    audience: "Chargé RH.",
    when: "À l'embauche, puis à chaque changement de situation.",
    steps: [
      "Employés → « Nouvel employé » : renseignez au minimum Nom, Prénom et Département ; le matricule est attribué automatiquement.",
      "La fiche est créée en « Brouillon » : elle n'est pas encore active.",
      "Complétez la fiche (fonction, date d'embauche, lieu de travail, contacts), puis passez le statut à « Actif » depuis la fiche de l'employé.",
      "Si la personne a besoin d'un accès à la plateforme, utilisez « Lier un compte de connexion… » après que l'administration a créé le compte.",
      "Les changements de statut suivent un ordre imposé : Brouillon → Actif → (Suspendu) → Départ → Archivé. Un départ ne revient jamais en actif : une réembauche est une nouvelle fiche.",
    ],
    evidence: [
      "Pour enregistrer un départ : un motif est obligatoire, et les documents de fin de contrat exigés doivent être au dossier.",
    ],
    automatic: [
      "Le matricule est généré par la plateforme et ne peut plus être modifié ensuite.",
      "Chaque changement de statut est daté, attribué à son auteur et conservé dans l'historique.",
      "Enregistrer un départ ne désactive JAMAIS le compte de connexion : la plateforme le signale et vous renvoie vers l'administration des comptes.",
    ],
    elsewhere: [
      "Créer, suspendre ou archiver le compte de connexion : Administration → Utilisateurs.",
    ],
    toSupply: [
      "La liste des motifs de départ (« motifs de départ ») n'est pas encore arrêtée : le motif se saisit aujourd'hui en texte libre. Une fois la liste ratifiée, elle sera proposée dans un menu.",
    ],
    requires: [HR_MANAGE],
  },
  {
    id: "organisation",
    title: "Organisation",
    route: "/departments/hr/organisation",
    audience: "Chargé RH ; consultation pour toute personne ayant accès au module RH.",
    when: "À consulter pour vérifier le rattachement d'une personne.",
    steps: [
      "Organisation affiche l'arbre des unités (direction, départements, sections, équipes) en lecture seule.",
      "Le rattachement d'un employé se lit sur sa fiche : c'est son affectation principale ouverte.",
      "Pour créer ou modifier une unité, passez par Configuration.",
    ],
    evidence: [],
    automatic: [
      "L'unité affichée pour un employé est toujours son affectation principale en cours ; les affectations passées sont conservées avec leurs dates.",
    ],
    elsewhere: [
      "La hiérarchie RH (qui rattache qui) est distincte des départements de la plateforme utilisés pour les dossiers d'exploitation.",
    ],
    toSupply: [],
    requires: [],
  },
  {
    id: "configuration",
    title: "Configuration",
    route: "/departments/hr/configuration",
    audience: "Chargé RH habilité à la configuration.",
    when: "À l'installation, puis à chaque évolution de la structure ou des vocabulaires.",
    steps: [
      "Configuration → créez les unités d'organisation, les postes et les sites de travail.",
      "Renseignez la numérotation des matricules et les vocabulaires (types d'emploi, motifs de départ).",
      "« Modèles de check-list » : créez un modèle en choisissant son type — « Intégration » ou « Départ » — puis « Créer le modèle ».",
      "Ouvrez le modèle et ajoutez ses étapes avec « Ajouter l'étape » : cochez « Bloquante (empêche la clôture) » pour une étape obligatoire, et « Pièce justificative requise » lorsqu'un document doit être fourni.",
      "Un modèle inutilisé se retire avec « Désactiver » ; il n'est jamais supprimé, car des dossiers ouverts peuvent s'y référer.",
    ],
    evidence: [],
    automatic: [
      "Les libellés des étapes sont RECOPIÉS dans le dossier au moment où il est ouvert : modifier un modèle ensuite ne réécrit jamais un dossier déjà ouvert.",
      "Une étape déjà utilisée dans un dossier ne peut plus être supprimée du modèle ; elle peut être corrigée.",
    ],
    elsewhere: [],
    toSupply: [
      "Le contenu des modèles de check-list (quelles étapes pour une intégration, lesquelles pour un départ) doit être défini par Effitrans.",
      "Le catalogue de compétences et les échelles d'évaluation restent à définir.",
      "Les types d'ajustement de paie restent à définir.",
    ],
    requires: [HR_CONFIG],
  },
  {
    id: "integration",
    title: "Intégration (onboarding)",
    route: "/departments/hr/onboarding",
    audience: "Chargé RH.",
    when: "Dès qu'une embauche est confirmée, avant l'arrivée si possible.",
    steps: [
      "Intégration → sélectionnez l'employé, un modèle de check-list et la date d'entrée prévue, puis « Créer le dossier ».",
      "Faites avancer le dossier avec « Démarrer » lorsque l'intégration commence réellement.",
      "Traitez les étapes une par une : « Marquer fait », ou « Sans objet » si l'étape ne s'applique pas.",
      "Pour une étape marquée « preuve requise », choisissez d'abord la pièce justificative dans la liste — elle provient des documents du dossier de l'employé — puis « Marquer fait ».",
      "Suivez les demandes d'accès (compte e-mail, compte plateforme, badge…) dans « Accès & comptes » : la RH les demande et les suit, l'administration les réalise.",
      "Quand tout est traité, « Clôturer ».",
    ],
    evidence: [
      "Les pièces justificatives doivent d'abord être déposées dans le dossier de l'employé ; seules les pièces de CET employé peuvent être citées.",
    ],
    automatic: [
      "Les étapes sont recopiées du modèle avec leurs libellés du jour.",
      "La clôture est refusée tant qu'une étape bloquante n'est pas traitée ; le message nomme les étapes concernées.",
    ],
    elsewhere: [
      "La création effective des comptes et l'attribution des rôles : Administration → Utilisateurs.",
    ],
    toSupply: [
      "Le modèle de check-list d'intégration (voir Configuration).",
    ],
    requires: [HR_MANAGE],
  },
  {
    id: "conges",
    title: "Congés & présence",
    route: "/departments/hr/conges",
    audience: "Chargé RH pour la saisie ; responsable hiérarchique ou siège Direction pour la décision.",
    when: "À chaque demande de congé et pour la saisie de présence.",
    steps: [
      "Congés & présence → « Nouvelle demande » : employé, catégorie, dates ; la demande part en brouillon.",
      "« Soumettre » transmet la demande pour décision.",
      "La décision se prend avec « Approuver » ou « Refuser ». Deux personnes peuvent décider : le responsable hiérarchique de l'employé (son manager sur l'affectation principale ouverte, s'il possède un compte lié), ou un siège Direction.",
      "Une personne ne peut jamais décider de sa propre demande, ni le demandeur de la demande qu'il a déposée.",
      "La présence se saisit dans le même espace : jour travaillé et minutes.",
    ],
    evidence: [],
    automatic: [
      "Une décision approuvée met à jour les droits à congés en une seule opération.",
      "Une demande décidée n'est plus modifiable ; une annulation après approbation restitue le droit.",
      "« En congé aujourd'hui » est calculé à partir des congés approuvés ; aucun statut « en congé » n'est stocké.",
    ],
    elsewhere: [],
    toSupply: [
      "Le caractère payé ou non payé de chaque catégorie de congé n'est pas encore arrêté ; la plateforme enregistre les faits sans en tirer de conclusion.",
    ],
    requires: [HR_MANAGE, HR_LEAVE_APPROVE],
  },
  {
    id: "equipements",
    title: "Équipements",
    route: "/departments/hr/equipement",
    audience: "Chargé RH.",
    when: "À chaque remise ou restitution de matériel.",
    steps: [
      "Équipements → « Nouvel équipement » pour enregistrer un matériel dans le parc.",
      "« Attribuer » : choisissez l'employé, et le cas échéant une date de retour prévue.",
      "À la restitution, enregistrez l'issue : « Restitué », « Restitué endommagé », « Perdu » ou « Non restitué ».",
    ],
    evidence: [],
    automatic: [
      "Un matériel ne peut être attribué qu'à une seule personne à la fois.",
      "L'historique de détention est conservé intégralement.",
      "Le matériel non restitué empêche la clôture d'un départ — c'est ici, et seulement ici, que la restitution s'enregistre.",
    ],
    elsewhere: [],
    toSupply: [],
    requires: [HR_MANAGE],
  },
  {
    id: "documents-contrats",
    title: "Documents & contrats",
    route: null,
    audience: "Chargé RH ; la vérification exige une seconde personne.",
    when: "À l'embauche, au renouvellement, et à chaque pièce reçue.",
    steps: [
      "Ouvrez la fiche de l'employé → « Documents » : déposez la pièce en choisissant son type.",
      "« Contrats » : enregistrez le contrat, puis faites-le vérifier.",
      "La vérification se fait avec « Vérifier », par une personne DIFFÉRENTE de celle qui a déposé le document.",
      "« Terminer » clôt un contrat arrivé à son terme.",
    ],
    evidence: [
      "Les types de documents exigés pour un départ doivent être au dossier avant d'enregistrer la sortie.",
    ],
    automatic: [
      "Les documents ne sont jamais supprimés définitivement ; ils sont retirés et conservés.",
      "Les échéances (contrats, documents) remontent automatiquement sur le tableau de bord.",
    ],
    elsewhere: [],
    toSupply: [],
    requires: [HR_MANAGE_TWO],
  },
  {
    id: "performance",
    title: "Performance",
    route: "/departments/hr/performance",
    audience: "Chargé RH ; la finalisation d'une évaluation exige un siège Direction.",
    when: "Aux campagnes d'évaluation, et au fil des formations.",
    steps: [
      "Performance → « Nouveau cycle d'évaluation » : période et périmètre.",
      "« Assigner un objectif » pour chaque employé concerné.",
      "L'employé renseigne son auto-évaluation ; son responsable renseigne la sienne.",
      "La finalisation est faite par une personne distincte du responsable évaluateur.",
    ],
    evidence: [],
    automatic: [
      "Le contenu d'une évaluation est confidentiel : seuls l'employé concerné et son responsable enregistré au moment du cycle y accèdent.",
    ],
    elsewhere: [],
    toSupply: [
      "Le catalogue de compétences, les échelles et la périodicité des cycles doivent être définis par Effitrans.",
    ],
    requires: [HR_MANAGE, HR_PERF_FINAL],
  },
  {
    id: "formation",
    title: "Formation",
    route: "/departments/hr/formation",
    audience: "Chargé RH.",
    when: "À la mise en place du catalogue, puis à chaque inscription.",
    steps: [
      "Formation → « Ajouter une formation au catalogue » : intitulé, modalité, prestataire, caractère obligatoire et durée de validité.",
      "« Assigner une formation » inscrit un employé à une session.",
      "À l'issue de la formation, enregistrez le résultat et déposez le certificat dans le dossier de l'employé.",
    ],
    evidence: [
      "Les certificats se déposent comme documents dans le dossier de l'employé.",
    ],
    automatic: [
      "Les certificats arrivant à expiration remontent sur le tableau de bord.",
      "Les formations obligatoires en retard sont signalées au tableau de bord.",
    ],
    elsewhere: [],
    toSupply: [
      "Le catalogue de formations et les obligations de recyclage doivent être définis par Effitrans.",
    ],
    requires: [HR_MANAGE],
  },
  {
    id: "paie",
    title: "Préparation de paie",
    route: "/departments/hr/paie",
    audience: "Chargé RH.",
    when: "À chaque période de paie, avant transmission à la comptabilité.",
    steps: [
      "Préparation de paie → créez la période (code, libellé, dates de début et de fin).",
      "Collectez les faits : la plateforme recopie, pour chaque employé, les présences, les congés approuvés et les mouvements de la période.",
      "Vérifiez les anomalies signalées (absence de présence, contrat manquant, congé à cheval sur la période…) : elles sont montrées, jamais corrigées d'office.",
      "Ajoutez si besoin des ajustements en quantité (jours, heures, occurrences) ; la décision sur un ajustement revient à une personne différente de celle qui l'a proposé.",
      "« Vérifier » fige les faits collectés.",
      "Si un fait change après vérification, utilisez « Rouvrir » puis « Recollecter » : la reprise est tracée.",
    ],
    evidence: [],
    automatic: [
      "Les faits sont RECOPIÉS au moment de la collecte : modifier une présence ensuite ne change pas une période déjà vérifiée.",
      "Aucun montant n'est calculé, stocké ni transmis : la plateforme prépare des faits, elle ne fait pas la paie.",
    ],
    elsewhere: [
      "Le calcul de la paie, les bulletins et les déclarations restent hors de la plateforme.",
    ],
    toSupply: [
      "Les types d'ajustement (voir Configuration) doivent être définis par Effitrans.",
      "Le calendrier de paie et le format d'export vers la comptabilité restent à arrêter.",
    ],
    requires: [HR_MANAGE, HR_PAYROLL_APPROVE],
  },
  {
    id: "departs",
    title: "Départs (offboarding)",
    route: "/departments/hr/departs",
    audience: "Chargé RH.",
    when: "Dès qu'un départ est décidé ou notifié.",
    steps: [
      "Départs → « Nouveau départ » : choisissez l'employé, saisissez le motif (obligatoire), la date de départ prévue et un modèle de clôture.",
      "Ouvrir le dossier ne met PAS fin au contrat : le statut d'emploi se change séparément, depuis la fiche de l'employé.",
      "Traitez les étapes : « Fait », ou « Sans objet ». Pour une étape « pièce requise », choisissez d'abord la pièce justificative du dossier de l'employé.",
      "Faites enregistrer la restitution du matériel dans Équipements ; le dossier affiche ce qui reste attribué.",
      "Vérifiez les documents de fin de contrat manquants, signalés dans le dossier.",
      "Quand le départ est enregistré au registre, que le matériel est restitué et que les étapes obligatoires sont traitées : « Clôturer le départ ».",
      "Si le départ est annulé, utilisez « Annuler le départ » avec un motif : le dossier reste dans l'historique et le contrat n'est pas affecté.",
    ],
    evidence: [
      "Les documents de fin de contrat exigés doivent être au dossier de l'employé.",
      "Les pièces justificatives citées par une étape doivent appartenir à cet employé.",
    ],
    automatic: [
      "La clôture est refusée tant que l'employé n'est pas enregistré comme sorti, qu'il détient du matériel, ou qu'une étape obligatoire reste à traiter — le message dit laquelle.",
      "Après la clôture, si un compte de connexion est encore actif, la plateforme le signale explicitement : l'accès n'est PAS désactivé automatiquement.",
      "Le dossier clôturé et son historique sont conservés définitivement.",
    ],
    elsewhere: [
      "La restitution du matériel s'enregistre dans Équipements.",
      "Le changement de statut d'emploi se fait sur la fiche de l'employé.",
      "La suspension ou l'archivage du compte de connexion se fait dans Administration → Utilisateurs.",
    ],
    toSupply: [
      "Le modèle de check-list de départ (voir Configuration).",
    ],
    requires: [HR_MANAGE],
  },
  {
    id: "rapports",
    title: "Reporting RH",
    route: "/departments/hr/rapports",
    audience: "Chargé RH et Direction.",
    when: "Pour un point d'effectifs, un suivi de mouvements ou une transmission.",
    steps: [
      "Reporting RH → choisissez la période (du / au) et éventuellement un département, puis « Appliquer ».",
      "Lisez les effectifs (situation actuelle), les mouvements de la période, et la charge opérationnelle.",
      "« Exporter (CSV) » télécharge exactement ce que la page affiche, pour le périmètre choisi.",
    ],
    evidence: [],
    automatic: [
      "Les chiffres proviennent directement du registre et des modules ; rien n'est recalculé ni stocké ailleurs.",
      "Pour un lecteur qui n'a pas accès aux dossiers individuels, les groupes de moins de cinq personnes sont masqués afin qu'un chiffre ne permette pas d'identifier quelqu'un.",
      "Aucun taux de rotation n'est calculé : la méthode de calcul n'est pas arrêtée.",
    ],
    elsewhere: [],
    toSupply: [
      "La méthode de calcul du taux de rotation (numérateur, dénominateur, période) reste à arrêter par Effitrans.",
    ],
    requires: [HR_REPORTS],
  },
  {
    id: "imports",
    title: "Imports en masse",
    route: "/departments/hr/imports",
    audience: "Chargé RH ; l'approbation exige une seconde personne.",
    when: "À la reprise initiale des effectifs, ou pour un ajout important.",
    steps: [
      "Imports → « Nouveau lot (Excel ou CSV) » : téléchargez d'abord le modèle fourni et remplissez-le.",
      "« Valider (correspondance + contrôles) » : la plateforme vérifie chaque ligne et signale les erreurs, ligne par ligne.",
      "Corrigez le fichier et revalidez jusqu'à ce qu'il n'y ait plus d'erreur.",
      "« Soumettre au visa » transmet le lot pour approbation.",
      "« Approuver → PRÊT » est fait par une personne DIFFÉRENTE de celle qui a préparé le lot ; « Rejeter » renvoie le lot avec un motif.",
      "Une fois approuvé, le lot peut être appliqué : les employés sont créés exactement comme s'ils avaient été saisis un par un.",
    ],
    evidence: [
      "Le fichier au format du modèle fourni par la plateforme.",
    ],
    automatic: [
      "Aucune ligne n'est appliquée avant l'approbation ; le contrôle à quatre yeux est structurel.",
      "Les matricules sont attribués par la plateforme, jamais repris du fichier.",
    ],
    elsewhere: [],
    toSupply: [],
    requires: [HR_MANAGE_TWO],
  },
  {
    id: "limites",
    title: "Ce que la plateforme ne fait pas",
    route: null,
    audience: "Toute personne travaillant dans le module RH.",
    when: "À lire une fois — cela évite d'attendre du système ce qu'il ne fera jamais seul.",
    steps: [
      "Elle ne calcule pas la paie : ni salaire, ni cotisation, ni bulletin, ni déclaration. Elle prépare des faits.",
      "Elle ne met fin à aucun contrat toute seule : un départ s'enregistre par une action explicite sur la fiche de l'employé.",
      "Elle ne désactive aucun compte de connexion toute seule : elle le signale, l'administration des comptes agit.",
      "Elle n'invente aucun taux : ni rotation, ni absentéisme, faute de méthode arrêtée et d'horaires de référence.",
      "Elle ne contourne aucun contrôle à quatre yeux : lorsqu'une seconde personne est exigée, aucune manipulation ne la remplace.",
      "Elle ne supprime rien : les dossiers, documents et historiques sont conservés, même après un départ.",
    ],
    evidence: [],
    automatic: [],
    elsewhere: [],
    toSupply: [],
    requires: [],
  },
];

/** Anchor lookup for a workspace's « Aide » link. */
export function guideAnchorForRoute(route: string): string | null {
  return GUIDE_SECTIONS.find((s) => s.route === route)?.id ?? null;
}
