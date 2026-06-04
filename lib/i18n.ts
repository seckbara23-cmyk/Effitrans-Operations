/**
 * Centralised UI strings. French is the default operating language for
 * Effitrans (Dakar). Keeping every label here means a future locale layer
 * (e.g. next-intl) can swap this object out without touching components.
 */
export const t = {
  app: {
    name: "Effitrans Operations",
    short: "Effitrans Operations",
    tagline: "Pilotage des opérations logistiques & douane",
    company: "Effitrans — Transit & Logistique, Dakar",
  },
  nav: {
    section_pilotage: "Pilotage",
    section_operations: "Opérations",
    section_administration: "Administration",
    controlTower: "Centre d'opérations",
    customers: "Clients",
    shipments: "Expéditions",
    customs: "Dédouanement",
    documents: "Documents",
    tasks: "Tâches",
    finance: "Finance",
    reports: "Rapports",
    users: "Utilisateurs",
    settings: "Paramètres",
  },
  topbar: {
    search: "Rechercher un dossier, client, conteneur…",
    newFile: "Nouveau dossier",
    notifications: "Notifications",
  },
  dashboard: {
    title: "Centre d'opérations",
    subtitle: "Vue d'ensemble des opérations du jour",
    period: "Aujourd'hui · Dakar (GMT)",
    kpi: {
      activeFiles: "Dossiers actifs",
      shipmentsAtPort: "Expéditions au port",
      customsPending: "Dossiers douane en attente",
      delayed: "Opérations en retard",
      tasksDue: "Tâches dues aujourd'hui",
      docsMissing: "Documents manquants",
    },
    panels: {
      recentShipments: "Dossiers d'expédition récents",
      customsQueue: "File de dédouanement",
      tasksToday: "Tâches dues aujourd'hui",
      viewAll: "Tout voir",
    },
    columns: {
      reference: "Référence",
      customer: "Client",
      mode: "Mode",
      origin: "Origine",
      destination: "Destination",
      status: "Statut",
      agent: "Agent assigné",
      fileRef: "Réf. dossier",
      declaration: "Déclaration",
      missingDocs: "Docs manquants",
      officer: "Agent douane",
      priority: "Priorité",
      task: "Tâche",
      file: "Dossier",
      assignedTo: "Assigné à",
      deadline: "Échéance",
    },
  },
  common: {
    none: "—",
    placeholderTitle: "Module en préparation",
    backToDashboard: "Retour au centre d'opérations",
    emptyHint:
      "Ce module fait partie de la feuille de route Effitrans. La structure visuelle est prête ; les données et la logique métier seront ajoutées prochainement.",
  },
} as const;
