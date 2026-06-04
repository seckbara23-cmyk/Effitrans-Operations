import type { ComponentType, SVGProps } from "react";
import {
  IconBuilding,
  IconContact,
  IconHistory,
  IconContainer,
  IconShip,
  IconPin,
  IconUsers,
  IconStamp,
  IconDocument,
  IconWorkflow,
  IconShield,
  IconTask,
  IconClock,
  IconBlock,
  IconQuote,
  IconCard,
  IconCoins,
  IconScale,
  IconReport,
  IconRoute,
  IconDepartment,
  IconList,
  IconGear,
  IconTag,
  IconCertificate,
  IconFinance,
} from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export type Feature = {
  icon: Icon;
  title: string;
  description: string;
};

export type ModuleConfig = {
  /** sidebar section eyebrow */
  eyebrow: string;
  /** page icon (matches sidebar) */
  icon: Icon;
  title: string;
  /** one-line business summary under the title */
  subtitle: string;
  /** what this module will eventually handle */
  features: Feature[];
  /** empty-state title + description */
  emptyTitle: string;
  emptyDescription: string;
};

export const modules: Record<string, ModuleConfig> = {
  customers: {
    eyebrow: "Opérations",
    icon: IconUsers,
    title: "Clients",
    subtitle:
      "Annuaire des sociétés clientes, contacts et historique des opérations import/export.",
    features: [
      {
        icon: IconBuilding,
        title: "Sociétés clientes",
        description:
          "Fiches entreprises, secteur d'activité, NINEA et coordonnées à Dakar et à l'international.",
      },
      {
        icon: IconContact,
        title: "Contacts",
        description:
          "Interlocuteurs, fonctions et canaux de communication par société.",
      },
      {
        icon: IconHistory,
        title: "Historique client",
        description:
          "Dossiers passés, volumes traités et suivi de la relation commerciale.",
      },
      {
        icon: IconContainer,
        title: "Dossiers import / export",
        description:
          "Opérations d'importation et d'exportation rattachées à chaque client.",
      },
    ],
    emptyTitle: "Le répertoire clients arrive bientôt",
    emptyDescription:
      "La gestion des sociétés clientes, contacts et historiques sera disponible dans une prochaine étape. La structure visuelle est déjà en place.",
  },

  shipments: {
    eyebrow: "Opérations",
    icon: IconContainer,
    title: "Expéditions",
    subtitle:
      "Dossiers de transport maritime, aérien et routier, avec suivi des statuts et affectation des agents.",
    features: [
      {
        icon: IconContainer,
        title: "Dossiers d'expédition",
        description:
          "Création et pilotage des dossiers de transport, du booking à la livraison.",
      },
      {
        icon: IconShip,
        title: "Transport maritime, aérien & routier",
        description:
          "Modes FCL/LCL, fret aérien et acheminement routier vers l'intérieur du pays.",
      },
      {
        icon: IconPin,
        title: "Statuts de suivi",
        description:
          "Position du dossier en temps réel : au port, dédouané, en livraison, livré.",
      },
      {
        icon: IconUsers,
        title: "Agents assignés",
        description:
          "Affectation des agents d'exploitation et répartition de la charge.",
      },
    ],
    emptyTitle: "Le suivi des expéditions arrive bientôt",
    emptyDescription:
      "Les dossiers de transport multimodal et le suivi des statuts seront ajoutés prochainement. La maquette reflète déjà l'organisation cible.",
  },

  customs: {
    eyebrow: "Opérations",
    icon: IconStamp,
    title: "Dédouanement",
    subtitle:
      "Déclarations en douane, pièces manquantes, workflow de dédouanement et statut Bon à enlever (BAE).",
    features: [
      {
        icon: IconStamp,
        title: "Déclarations en douane",
        description:
          "Saisie et dépôt des déclarations (DDU) auprès de la Douane sénégalaise.",
      },
      {
        icon: IconDocument,
        title: "Documents manquants",
        description:
          "Pièces à fournir avant dédouanement : facture, origine, B/L, phytosanitaire.",
      },
      {
        icon: IconWorkflow,
        title: "Workflow de dédouanement",
        description:
          "Étapes de la visite douanière à la liquidation des droits et taxes.",
      },
      {
        icon: IconShield,
        title: "Bon à enlever (BAE)",
        description:
          "Statut de mainlevée, autorisation de sortie et affectation de l'inspecteur.",
      },
    ],
    emptyTitle: "Le module de dédouanement arrive bientôt",
    emptyDescription:
      "Le suivi des déclarations, des pièces manquantes et du BAE sera disponible dans une prochaine étape.",
  },

  documents: {
    eyebrow: "Opérations",
    icon: IconDocument,
    title: "Documents",
    subtitle:
      "Bibliothèque documentaire des dossiers : commerciaux, transport, douane et certificats.",
    features: [
      {
        icon: IconDocument,
        title: "Factures & listes de colisage",
        description:
          "Factures commerciales et listes de colisage rattachées aux dossiers.",
      },
      {
        icon: IconShip,
        title: "Connaissements & LTA",
        description:
          "Connaissements maritimes (B/L) et lettres de transport aérien (AWB).",
      },
      {
        icon: IconStamp,
        title: "Documents douaniers",
        description:
          "Déclarations, quittances et autorisations liées au dédouanement.",
      },
      {
        icon: IconCertificate,
        title: "Certificats",
        description:
          "Certificats d'origine, phytosanitaires et de conformité.",
      },
    ],
    emptyTitle: "La bibliothèque documentaire arrive bientôt",
    emptyDescription:
      "Le classement et la consultation des documents par dossier seront ajoutés prochainement.",
  },

  tasks: {
    eyebrow: "Opérations",
    icon: IconTask,
    title: "Tâches",
    subtitle:
      "Tâches opérationnelles, échéances, affectations et suivi des dossiers bloqués.",
    features: [
      {
        icon: IconTask,
        title: "Tâches opérationnelles",
        description:
          "Actions à mener par dossier : dépôt déclaration, relance, positionnement camion.",
      },
      {
        icon: IconClock,
        title: "Échéances",
        description:
          "Délais et rappels pour éviter les frais de magasinage et les retards.",
      },
      {
        icon: IconUsers,
        title: "Employés assignés",
        description:
          "Attribution des tâches aux agents et visibilité sur la charge de chacun.",
      },
      {
        icon: IconBlock,
        title: "Dossiers bloqués",
        description:
          "Identification des opérations en attente d'une pièce ou d'une validation.",
      },
    ],
    emptyTitle: "La gestion des tâches arrive bientôt",
    emptyDescription:
      "Le planning des tâches, échéances et dossiers bloqués sera disponible dans une prochaine étape.",
  },

  finance: {
    eyebrow: "Administration",
    icon: IconFinance,
    title: "Finance",
    subtitle:
      "Devis, factures, paiements, suivi des droits et taxes et facturation client.",
    features: [
      {
        icon: IconQuote,
        title: "Devis",
        description:
          "Établissement et suivi des devis de transit et de transport.",
      },
      {
        icon: IconCard,
        title: "Factures & paiements",
        description:
          "Facturation client, encaissements et suivi des règlements.",
      },
      {
        icon: IconScale,
        title: "Droits & taxes",
        description:
          "Suivi des droits de douane, TVA et redevances avancés pour le client.",
      },
      {
        icon: IconCoins,
        title: "Facturation client",
        description:
          "Récapitulatif des débours et honoraires par dossier et par client.",
      },
    ],
    emptyTitle: "Le module finance arrive bientôt",
    emptyDescription:
      "Les devis, factures et le suivi des droits et taxes seront ajoutés prochainement.",
  },

  reports: {
    eyebrow: "Administration",
    icon: IconReport,
    title: "Rapports",
    subtitle:
      "Indicateurs d'activité : dossiers actifs, délais de dédouanement et charge par agent.",
    features: [
      {
        icon: IconContainer,
        title: "Dossiers actifs",
        description:
          "Volume de dossiers en cours par mode, client et statut.",
      },
      {
        icon: IconClock,
        title: "Délais de dédouanement",
        description:
          "Temps moyen de traitement et identification des goulots d'étranglement.",
      },
      {
        icon: IconUsers,
        title: "Charge par agent",
        description:
          "Répartition de l'activité et performance par agent d'exploitation.",
      },
      {
        icon: IconRoute,
        title: "Opérations en retard",
        description:
          "Dossiers traités par mois et suivi des opérations en retard.",
      },
    ],
    emptyTitle: "Les rapports arrivent bientôt",
    emptyDescription:
      "Les tableaux de bord analytiques et exports seront disponibles dans une prochaine étape.",
  },

  users: {
    eyebrow: "Administration",
    icon: IconUsers,
    title: "Utilisateurs",
    subtitle:
      "Employés, départements, rôles et contrôle des accès à la plateforme.",
    features: [
      {
        icon: IconContact,
        title: "Employés",
        description:
          "Comptes des collaborateurs Effitrans et informations de profil.",
      },
      {
        icon: IconDepartment,
        title: "Départements",
        description:
          "Organisation par service : exploitation, douane, finance, service client.",
      },
      {
        icon: IconTag,
        title: "Rôles",
        description:
          "Profils manager, agent d'exploitation, douane, finance, service client.",
      },
      {
        icon: IconShield,
        title: "Contrôle d'accès",
        description:
          "Permissions par module et niveau d'accès aux dossiers.",
      },
    ],
    emptyTitle: "La gestion des utilisateurs arrive bientôt",
    emptyDescription:
      "La création des comptes, rôles et permissions sera ajoutée prochainement.",
  },

  settings: {
    eyebrow: "Administration",
    icon: IconGear,
    title: "Paramètres",
    subtitle:
      "Profil de l'entreprise, configuration des workflows, statuts et types de documents.",
    features: [
      {
        icon: IconBuilding,
        title: "Profil entreprise",
        description:
          "Coordonnées Effitrans, agrément de commissionnaire en douane et mentions légales.",
      },
      {
        icon: IconWorkflow,
        title: "Paramètres de workflow",
        description:
          "Étapes des processus d'exploitation et de dédouanement.",
      },
      {
        icon: IconList,
        title: "Configuration des statuts",
        description:
          "Personnalisation des statuts de dossiers et de leurs couleurs.",
      },
      {
        icon: IconDocument,
        title: "Types de documents",
        description:
          "Catalogue des pièces gérées : factures, B/L, AWB, certificats.",
      },
    ],
    emptyTitle: "Les paramètres arrivent bientôt",
    emptyDescription:
      "La configuration de l'entreprise et des workflows sera disponible dans une prochaine étape.",
  },
};
