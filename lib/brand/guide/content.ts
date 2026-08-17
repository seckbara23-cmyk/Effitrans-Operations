/**
 * BCG-A — Guide Centre de Marque: THE CONTENT. Pure and typed.
 *
 * Written for the person who administers the brand, not for an engineer, and
 * shaped exactly like the HR guide so the platform has ONE documentation idiom:
 * qui · quand · étapes numérotées · éléments nécessaires · ce que la plateforme
 * fait toute seule · ce qui se fait ailleurs · à définir par Effitrans.
 *
 * THE DISTINCTION THIS GUIDE EXISTS TO HOLD (RQ-BC.1, ratified). Three acts are
 * routinely confused, and only the third is governance:
 *
 *   ÉDITER   une information de marque — effet immédiat, aucune approbation.
 *   GÉNÉRER  un livrable (PDF, DOCX, PPTX, PNG, SVG, HTML) — dérivé à la
 *            demande à partir de la marque ; générer n'est PAS gouverner.
 *   GOUVERNER un modèle — décision de cycle de vie Brouillon → Approuvé →
 *            Publié → Retiré, soumise à la complétude de la marque.
 *
 * RULES THIS FILE OBEYS:
 *
 * 1. Labels and limitations are QUOTED from production, never re-described.
 *    Where the product already states a contract — « Aucun envoi, aucune
 *    programmation, aucun suivi » — that exact sentence is reused.
 * 2. No permission code, no SQLSTATE, no table name reaches the page.
 * 3. Nothing about the brand's CONTENT is invented: the guide explains where a
 *    colour, a logo or a slogan comes from, never what it should be.
 * 4. Availability is NOT written here. Sections declare whether the workflow
 *    depends on brand completeness; the page computes N/11 from live product
 *    state and names the missing items.
 */

export type BrandGuideSection = {
  /** Anchor — also the key used by a workspace's « Aide » link. */
  id: string;
  title: string;
  /** The workspace this section documents, when there is one. */
  route: string | null;
  /** Additional production routes covered by this section (sub-surfaces). */
  alsoCovers?: string[];
  audience: string;
  when: string;
  steps: string[];
  /** Les éléments / pièces nécessaires. */
  needs: string[];
  automatic: string[];
  elsewhere: string[];
  toSupply: string[];
  /**
   * True when the documented workflow is affected by brand completeness —
   * publication (governance) and the generators, which degrade to
   * « Marque incomplète » until the eleven items are satisfied. Editing
   * sections are never gated: they are HOW the brand becomes complete.
   */
  completenessDependent: boolean;
};

export const BRAND_GUIDE_SECTIONS: readonly BrandGuideSection[] = [
  {
    id: "prise-en-main",
    title: "Prise en main",
    route: null,
    audience: "Toute personne administrant la marque Effitrans.",
    when: "À lire une fois, avant tout le reste.",
    steps: [
      "Ouvrez « Centre de marque » : la page d'accueil affiche la complétude de l'identité et un espace de travail par activité.",
      "Retenez les trois actes, souvent confondus. ÉDITER une information de marque (une couleur, un logo, une fonction) : l'effet est immédiat. GÉNÉRER un livrable (PDF, DOCX, PPTX, PNG, SVG, HTML) : le fichier est produit à la demande à partir de la marque. GOUVERNER un modèle : c'est une décision de cycle de vie, pas une modification de contenu.",
      "Un livrable n'est jamais « approuvé » parce qu'il a été téléchargé : ce sont les MODÈLES qui suivent un cycle de vie, dans Gouvernance.",
      "Avoir l'autorisation d'accéder au Centre de marque ne signifie pas que la marque est complète : la complétude se lit sur la page d'accueil, élément par élément.",
    ],
    needs: [],
    automatic: [
      "Chaque livrable est régénéré à partir des valeurs de marque du moment : il n'existe pas de copie figée à mettre à jour.",
      "La complétude est recalculée à chaque ouverture de la page d'accueil, à partir des informations réellement saisies et des ressources réellement publiées.",
    ],
    elsewhere: [
      "Les comptes de connexion, les noms, les e-mails et les rôles restent gérés dans Administration → Utilisateurs.",
    ],
    toSupply: [],
    completenessDependent: false,
  },
  {
    id: "completude",
    title: "Complétude de l'identité de marque (les 11 éléments)",
    route: "/brand-center",
    audience: "Administrateur du Centre de marque.",
    when: "Au démarrage, puis chaque fois qu'un livrable signale « Marque incomplète ».",
    steps: [
      "La page d'accueil liste onze éléments et indique combien sont complétés, sous la forme « N éléments sur 11 complétés ».",
      "Chaque élément indique ce qui le rend complet : une valeur saisie, ou une ressource publiée.",
      "Traitez les éléments manquants dans leur espace de travail respectif : Identité de marque pour les couleurs, la typographie, le slogan, la proposition de valeur, le site, l'adresse et l'URL de signalement ; Ressources visuelles pour les deux logos ; Réseaux internationaux pour l'adhésion ; Identité collaborateurs pour la fonction d'au moins un collaborateur.",
      "Revenez sur la page d'accueil : le décompte se met à jour tout seul.",
    ],
    needs: [
      "Les valeurs officielles fournies par la Direction (couleurs, slogan, proposition de valeur, adresse, site, URL de signalement).",
      "Les fichiers de logo au format PNG.",
    ],
    automatic: [
      "Aucun pourcentage n'est affiché : le décompte est exprimé en éléments complétés sur onze, avec la preuve de chacun.",
      "La complétude conditionne la publication d'un modèle et la génération sans avertissement — elle n'est jamais supposée.",
    ],
    elsewhere: [],
    toSupply: [],
    completenessDependent: false,
  },
  {
    id: "identite",
    title: "Identité de marque",
    route: "/brand-center/identity",
    audience: "Administrateur du Centre de marque.",
    when: "À la mise en place, puis à chaque décision de la Direction sur l'identité.",
    steps: [
      "Identité de marque → renseignez la « Palette de marque » : Vert, Or et Anthracite, au format hexadécimal.",
      "Renseignez la « Typographie » : police de titre, police de corps et police de repli pour Outlook.",
      "Renseignez l'« Identité d'entreprise » : slogan, proposition de valeur, site web et adresse.",
      "Renseignez la section « Conformité & durabilité », dont l'URL du portail de signalement.",
      "Enregistrez : les valeurs sont reprises immédiatement par tous les livrables générés ensuite.",
    ],
    needs: [
      "Les valeurs officielles validées par la Direction — la plateforme ne les invente pas.",
    ],
    automatic: [
      "Une valeur hexadécimale invalide est refusée à la saisie (« Hex invalide. »).",
      "Les couleurs et polices sont injectées dans les documents, présentations, signatures et e-mails sans ressaisie.",
    ],
    elsewhere: [],
    toSupply: [
      "« Les couleurs restent vides tant que la Direction ne les a pas fournies. » — les valeurs officielles relèvent d'Effitrans, pas de la plateforme.",
    ],
    completenessDependent: false,
  },
  {
    id: "ressources",
    title: "Ressources visuelles",
    route: "/brand-center/assets",
    audience: "Administrateur du Centre de marque.",
    when: "À la publication d'un logo ou d'une image approuvée.",
    steps: [
      "Ressources visuelles → choisissez le fichier PNG et le type de ressource (logo principal, logo e-mail, variantes…).",
      "Renseignez le « Texte alternatif (obligatoire) » ; le « Titre (facultatif) » aide au classement.",
      "Publiez : la ressource devient utilisable par les livrables.",
      "« Retirer » retire une ressource de l'usage sans effacer son historique.",
    ],
    needs: [
      "Un fichier PNG de 100 Ko au maximum.",
      "Un texte alternatif — il est obligatoire, pour l'accessibilité et pour les e-mails.",
    ],
    automatic: [
      "Le logo principal et le logo e-mail publiés satisfont deux des onze éléments de complétude.",
      "Les livrables reprennent automatiquement la version publiée : rien à recoller ailleurs.",
    ],
    elsewhere: [],
    toSupply: [
      "« Le SVG n'est pas accepté ; les logos partenaires nécessitent l'accord d'usage. » — obtenir cet accord relève d'Effitrans.",
    ],
    completenessDependent: false,
  },
  {
    id: "reseaux-internationaux",
    title: "Réseaux internationaux",
    route: "/brand-center/memberships",
    audience: "Administrateur du Centre de marque.",
    when: "À l'adhésion à un réseau, à son renouvellement, ou à sa fin.",
    steps: [
      "Réseaux internationaux → sous « Ajouter une adhésion », renseignez le réseau, le numéro d'adhésion, l'URL officielle et les dates de validité, puis cliquez sur « Ajouter ».",
      "Ordonnez les adhésions selon l'affichage souhaité.",
      "« Désactiver » retire une adhésion de l'affichage sans effacer son historique.",
    ],
    needs: [
      "Le certificat ou la référence d'adhésion, et l'URL officielle du réseau.",
    ],
    automatic: [
      "Au moins une adhésion active satisfait l'un des onze éléments de complétude.",
    ],
    elsewhere: [],
    toSupply: [
      "« Saisissez uniquement des informations approuvées ; les logos partenaires ne peuvent être ni modifiés ni recolorés. »",
    ],
    completenessDependent: false,
  },
  {
    id: "collaborateurs",
    title: "Identité collaborateurs",
    route: "/brand-center/people",
    audience: "Administrateur des comptes utilisateurs.",
    when: "À l'arrivée d'un collaborateur, puis à chaque changement de fonction ou de coordonnées.",
    steps: [
      "Identité collaborateurs → la liste reprend les comptes de la plateforme.",
      "Renseignez la « Fonction », le « Tél. » et la « Photo » de chaque collaborateur.",
      "Choisissez la variante de signature souhaitée pour la personne.",
      "Activez, si nécessaire, sa carte de visite publique.",
    ],
    needs: [
      "La fonction exacte du collaborateur et ses coordonnées professionnelles.",
    ],
    automatic: [
      "Au moins un collaborateur pourvu d'une fonction satisfait l'un des onze éléments de complétude.",
      "La liste suit les comptes existants : aucun collaborateur n'est créé ici.",
    ],
    elsewhere: [
      "« Le nom, l'e-mail et les rôles restent gérés par le module Utilisateurs. »",
    ],
    toSupply: [],
    completenessDependent: false,
  },
  {
    id: "cartes-signatures",
    title: "Cartes de visite et signatures",
    route: null,
    alsoCovers: ["/brand-center/card/[userId]", "/brand-center/signature/[userId]"],
    audience: "Administrateur des comptes utilisateurs.",
    when: "Après avoir renseigné la fonction et les coordonnées du collaborateur.",
    steps: [
      "Depuis Identité collaborateurs, ouvrez la signature d'une personne : la signature est composée à partir de la marque et de ses coordonnées.",
      "Copiez la signature, puis installez-la dans le client de messagerie de la personne.",
      "Les instructions d'installation, client par client (Outlook, Gmail, Apple Mail, mobile, plateformes d'e-mailing), figurent dans « Guides d'installation des signatures » — elles ne sont pas répétées ici.",
      "Ouvrez la carte de visite d'une personne pour la prévisualiser et, si elle est activée, la partager.",
    ],
    needs: [
      "La fonction et les coordonnées du collaborateur, renseignées au préalable.",
    ],
    automatic: [
      "La signature et la carte sont régénérées à partir de la marque : une couleur ou un logo modifié se répercute sans ressaisie.",
    ],
    elsewhere: [
      "L'installation dans le client de messagerie se fait sur le poste de la personne, en suivant les guides d'installation.",
      "« Le rendu final peut varier ; aucune compatibilité pixel-perfect n'est garantie. »",
    ],
    toSupply: [],
    completenessDependent: false,
  },
  {
    id: "documents",
    title: "Modèles de documents",
    route: "/brand-center/documents",
    alsoCovers: ["/brand-center/documents/[type]"],
    audience: "Administrateur du Centre de marque.",
    when: "À chaque document d'entreprise à produire.",
    steps: [
      "Modèles de documents → choisissez le type de document.",
      "Saisissez le « Contenu du document » et ses « Lignes ».",
      "Cliquez sur « Aperçu » pour générer le rendu.",
      "« Télécharger PDF » ou « Télécharger DOCX » selon l'usage.",
    ],
    needs: [
      "Le contenu du document — la plateforme fournit la forme, jamais le fond.",
    ],
    automatic: [
      "« L'en-tête, les couleurs, le pied de page et la conformité sont injectés automatiquement. »",
      "Si la marque est incomplète, l'écran l'indique et propose « Compléter le Centre de marque → » : le livrable reste possible, mais l'avertissement est explicite.",
    ],
    elsewhere: [],
    toSupply: [
      "Le contenu rédactionnel de chaque document relève d'Effitrans.",
    ],
    completenessDependent: true,
  },
  {
    id: "presentations",
    title: "Présentations",
    route: "/brand-center/presentations",
    audience: "Administrateur du Centre de marque.",
    when: "À chaque présentation d'entreprise à produire.",
    steps: [
      "Présentations → saisissez le « Contenu du deck ».",
      "Cliquez sur « Aperçu » pour prévisualiser les diapositives.",
      "« Télécharger PPTX » produit un PowerPoint éditable.",
    ],
    needs: [
      "Le contenu des diapositives.",
    ],
    automatic: [
      "Le deck est mis aux couleurs, polices et logos de la marque sans intervention.",
      "Une marque incomplète est signalée (« Marque incomplète : ») avec le lien « Compléter le Centre de marque → ».",
    ],
    elsewhere: [],
    toSupply: [
      "Le contenu des présentations relève d'Effitrans.",
    ],
    completenessDependent: true,
  },
  {
    id: "reseaux-sociaux",
    title: "Réseaux sociaux",
    route: "/brand-center/social",
    audience: "Administrateur du Centre de marque.",
    when: "À chaque visuel de réseau social à produire.",
    steps: [
      "Réseaux sociaux → choisissez le « Modèle de communication » (bannière LinkedIn, publication, annonce).",
      "Renseignez la composition : titre, sous-titre et, le cas échéant, la personne mise en avant.",
      "Cliquez sur « Aperçu ».",
      "« Télécharger SVG » ou « Télécharger PNG » selon la plateforme visée.",
    ],
    needs: [
      "Le texte à afficher, aux dimensions du modèle choisi.",
    ],
    automatic: [
      "Le visuel est composé à partir de la marque : couleurs, typographie et logo approuvé.",
      "Le SVG et le PNG sont produits à partir de la MÊME composition : les deux fichiers ne peuvent pas diverger.",
    ],
    elsewhere: [
      "« Pas de campagne, pas de programmation. » — la publication sur les réseaux se fait en dehors de la plateforme.",
    ],
    toSupply: [
      "Les messages et le calendrier de publication relèvent d'Effitrans.",
    ],
    completenessDependent: true,
  },
  {
    id: "emailing",
    title: "E-mailing marketing",
    route: "/brand-center/marketing",
    audience: "Administrateur du Centre de marque.",
    when: "À chaque e-mail marketing à préparer pour une plateforme d'envoi.",
    steps: [
      "E-mailing marketing → saisissez la « Composition » de l'e-mail.",
      "Cliquez sur « Aperçu » pour vérifier le rendu.",
      "« Copier HTML » place le modèle dans le presse-papiers.",
      "Collez le HTML dans la plateforme d'envoi (Mailchimp, HubSpot, Dynamics) : les balises de personnalisation et de désabonnement sont déjà présentes.",
    ],
    needs: [
      "Le texte de l'e-mail et la plateforme d'envoi cible.",
    ],
    automatic: [
      "Le HTML est portable et déjà aux couleurs de la marque.",
      "Les balises de personnalisation attendues par chaque plateforme sont insérées.",
    ],
    elsewhere: [
      "« Aucun envoi, aucune programmation, aucun suivi. » — l'envoi, les listes et les statistiques restent gérés par la plateforme d'e-mailing.",
    ],
    toSupply: [
      "Le contenu des campagnes et la gestion des listes relèvent d'Effitrans.",
    ],
    completenessDependent: true,
  },
  {
    id: "gouvernance",
    title: "Gouvernance de la marque",
    route: "/brand-center/governance",
    audience: "Administrateur du Centre de marque, agissant comme responsable de la marque.",
    when: "Lorsqu'un modèle doit être approuvé, publié, corrigé ou retiré.",
    steps: [
      "Gouvernance → le tableau liste les modèles par catégorie, avec leur « État » et leur « Version ».",
      "Un modèle suit un cycle de vie : Brouillon → Approuvé → Publié → Retiré.",
      "Approuvez un modèle en Brouillon lorsqu'il est jugé conforme ; un modèle Approuvé peut être renvoyé en Brouillon s'il doit être repris.",
      "Publiez un modèle Approuvé pour le rendre utilisable en production. « Un modèle ne peut être publié que si la marque est complète. »",
      "Retirez un modèle Publié lorsqu'il ne doit plus servir ; un modèle Retiré peut repartir en Brouillon.",
    ],
    needs: [
      "Une marque complète — sans quoi la publication est refusée.",
      "Une décision de la personne responsable de la marque : approuver est un acte, pas une formalité.",
    ],
    automatic: [
      "Seul un modèle « Publié » est utilisable en production.",
      "Les passages d'état sont contraints : la plateforme n'autorise que les transitions prévues, dans les deux sens.",
      "La complétude est vérifiée au moment de publier ; elle n'est jamais supposée acquise.",
    ],
    elsewhere: [
      "Gouverner un modèle n'est PAS modifier une information de marque : les couleurs, logos et textes se modifient dans leurs espaces de travail respectifs, et ces modifications ne passent par aucun cycle d'approbation.",
      "Générer un livrable n'est pas non plus un acte de gouvernance : un PDF téléchargé n'est ni approuvé ni publié.",
    ],
    toSupply: [
      "Qui, chez Effitrans, est responsable de l'approbation des modèles — la plateforme applique le cycle, elle ne désigne pas la personne.",
    ],
    completenessDependent: true,
  },
  {
    id: "telechargements",
    title: "Centre de téléchargement",
    route: "/brand-center/downloads",
    audience: "Administrateur du Centre de marque ou des comptes utilisateurs.",
    when: "Pour récupérer un livrable déjà préparé.",
    steps: [
      "Centre de téléchargement → repérez le livrable souhaité.",
      "Téléchargez-le : il est produit à partir de l'état actuel de la marque.",
    ],
    needs: [],
    automatic: [
      "« Point d'accès unique à tous les livrables de marque. Chaque livrable est généré à partir du Centre de marque. »",
      "Un livrable téléchargé reflète la marque au moment du téléchargement : il n'existe pas d'archive à resynchroniser.",
    ],
    elsewhere: [],
    toSupply: [],
    completenessDependent: false,
  },
  {
    id: "limites",
    title: "Ce que le Centre de Marque ne fait pas",
    route: null,
    audience: "Toute personne administrant la marque.",
    when: "À lire une fois — cela évite d'attendre du Centre de marque ce qu'il ne fera jamais.",
    steps: [
      "Il n'envoie aucun e-mail marketing : « Aucun envoi, aucune programmation, aucun suivi. »",
      "Il ne publie sur aucun réseau social : « Pas de campagne, pas de programmation. »",
      "Il n'accepte pas le SVG en entrée : « Le SVG n'est pas accepté » — les ressources se déposent en PNG.",
      "Il ne gère ni les comptes, ni les noms, ni les e-mails, ni les rôles : « Le nom, l'e-mail et les rôles restent gérés par le module Utilisateurs. »",
      "Il ne décide pas des valeurs de la marque : les couleurs et les textes officiels viennent de la Direction.",
      "Il ne garantit pas un rendu identique partout : « aucune compatibilité pixel-perfect n'est garantie » selon les clients de messagerie.",
      "Il ne considère jamais un livrable comme approuvé : seuls les MODÈLES sont gouvernés, dans Gouvernance.",
    ],
    needs: [],
    automatic: [],
    elsewhere: [],
    toSupply: [],
    completenessDependent: false,
  },
];

/** Anchor lookup for a workspace's « Aide » link, including sub-surfaces. */
export function brandGuideAnchorForRoute(route: string): string | null {
  const direct = BRAND_GUIDE_SECTIONS.find((s) => s.route === route);
  if (direct) return direct.id;
  return BRAND_GUIDE_SECTIONS.find((s) => s.alsoCovers?.includes(route))?.id ?? null;
}

/** Every production route this guide claims to document. */
export function documentedBrandRoutes(): string[] {
  return BRAND_GUIDE_SECTIONS.flatMap((s) => [
    ...(s.route ? [s.route] : []), ...(s.alsoCovers ?? []),
  ]);
}
