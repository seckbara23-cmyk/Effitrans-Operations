import type {
  ShipmentStatus,
  DeclarationStatus,
  Priority,
  TaskStatus,
  TransportMode,
} from "./status";

/* ----------------------------------------------------------------------------
 * Static mock data for the Effitrans Operation Platform.
 * Locations, customers and references reflect real Dakar / West-Africa trade
 * lanes. No backend — everything here is illustrative only.
 * ------------------------------------------------------------------------- */

export const agents = [
  "Awa Ndiaye",
  "Moussa Diop",
  "Fatou Sarr",
  "Cheikh Fall",
  "Aïssatou Bâ",
  "Ibrahima Gueye",
];

export const customsOfficers = [
  "Insp. Mamadou Sow",
  "Insp. Coumba Diallo",
  "Insp. Ousmane Kane",
];

export const customers = [
  "Dakar Agro Export",
  "SenMatériaux SARL",
  "Baobab Trading",
  "Atlantic Pharma",
  "Teranga Import Services",
];

export type Shipment = {
  reference: string;
  customer: string;
  mode: TransportMode;
  origin: string;
  destination: string;
  status: ShipmentStatus;
  agent: string;
  container?: string;
};

export const shipments: Shipment[] = [
  {
    reference: "EFT-2026-0481",
    customer: "Dakar Agro Export",
    mode: "sea",
    origin: "Shanghai",
    destination: "Port de Dakar",
    status: "at_port",
    agent: "Awa Ndiaye",
    container: "MSKU 472108-3",
  },
  {
    reference: "EFT-2026-0479",
    customer: "Atlantic Pharma",
    mode: "air",
    origin: "Marseille",
    destination: "Aéroport Blaise Diagne (AIBD)",
    status: "customs_pending",
    agent: "Moussa Diop",
    container: "AWB 074-5521 8890",
  },
  {
    reference: "EFT-2026-0476",
    customer: "SenMatériaux SARL",
    mode: "sea",
    origin: "Casablanca",
    destination: "Port de Dakar",
    status: "docs_missing",
    agent: "Fatou Sarr",
    container: "TGHU 905512-7",
  },
  {
    reference: "EFT-2026-0470",
    customer: "Baobab Trading",
    mode: "sea",
    origin: "Dubai",
    destination: "Port de Dakar",
    status: "cleared",
    agent: "Cheikh Fall",
    container: "CMAU 318774-0",
  },
  {
    reference: "EFT-2026-0468",
    customer: "Teranga Import Services",
    mode: "road",
    origin: "Abidjan",
    destination: "Thiès",
    status: "delivery_scheduled",
    agent: "Aïssatou Bâ",
  },
  {
    reference: "EFT-2026-0465",
    customer: "Dakar Agro Export",
    mode: "road",
    origin: "Port de Dakar",
    destination: "Touba",
    status: "delayed",
    agent: "Ibrahima Gueye",
  },
  {
    reference: "EFT-2026-0461",
    customer: "Baobab Trading",
    mode: "air",
    origin: "Dubai",
    destination: "Aéroport Blaise Diagne (AIBD)",
    status: "delivered",
    agent: "Awa Ndiaye",
    container: "AWB 176-8841 2210",
  },
];

export type CustomsFile = {
  reference: string;
  declaration: DeclarationStatus;
  missingDocs: string[];
  officer: string;
  priority: Priority;
};

export const customsQueue: CustomsFile[] = [
  {
    reference: "EFT-2026-0479",
    declaration: "inspection",
    missingDocs: ["Certificat d'origine", "Facture commerciale"],
    officer: "Insp. Mamadou Sow",
    priority: "high",
  },
  {
    reference: "EFT-2026-0476",
    declaration: "lodged",
    missingDocs: ["Connaissement (B/L)", "Liste de colisage"],
    officer: "Insp. Coumba Diallo",
    priority: "high",
  },
  {
    reference: "EFT-2026-0481",
    declaration: "lodged",
    missingDocs: ["Certificat phytosanitaire"],
    officer: "Insp. Ousmane Kane",
    priority: "medium",
  },
  {
    reference: "EFT-2026-0473",
    declaration: "assessed",
    missingDocs: [],
    officer: "Insp. Mamadou Sow",
    priority: "low",
  },
  {
    reference: "EFT-2026-0470",
    declaration: "released",
    missingDocs: [],
    officer: "Insp. Coumba Diallo",
    priority: "low",
  },
];

export type Task = {
  task: string;
  file: string;
  assignedTo: string;
  deadline: string;
  status: TaskStatus;
};

export const tasksToday: Task[] = [
  {
    task: "Déposer la déclaration en douane (DDU)",
    file: "EFT-2026-0481",
    assignedTo: "Awa Ndiaye",
    deadline: "11:00",
    status: "in_progress",
  },
  {
    task: "Relancer le client pour le certificat d'origine",
    file: "EFT-2026-0479",
    assignedTo: "Moussa Diop",
    deadline: "12:30",
    status: "todo",
  },
  {
    task: "Programmer le positionnement camion vers Touba",
    file: "EFT-2026-0465",
    assignedTo: "Ibrahima Gueye",
    deadline: "09:00",
    status: "overdue",
  },
  {
    task: "Régler les frais de magasinage au port",
    file: "EFT-2026-0476",
    assignedTo: "Fatou Sarr",
    deadline: "15:00",
    status: "todo",
  },
  {
    task: "Confirmer le rendez-vous de livraison (Thiès)",
    file: "EFT-2026-0468",
    assignedTo: "Aïssatou Bâ",
    deadline: "16:30",
    status: "in_progress",
  },
  {
    task: "Archiver le dossier clôturé",
    file: "EFT-2026-0461",
    assignedTo: "Awa Ndiaye",
    deadline: "17:00",
    status: "done",
  },
];

export type Kpi = {
  key: string;
  label: string;
  value: number;
  /** signed delta vs. yesterday, in absolute units */
  delta: number;
  /** does a positive delta read as good ("up") or bad ("down")? */
  goodDirection: "up" | "down";
  tone: "navy" | "teal" | "amber" | "red";
};

export const kpis: Kpi[] = [
  {
    key: "activeFiles",
    label: "Dossiers actifs",
    value: 38,
    delta: 4,
    goodDirection: "up",
    tone: "navy",
  },
  {
    key: "shipmentsAtPort",
    label: "Expéditions au port",
    value: 12,
    delta: 2,
    goodDirection: "down",
    tone: "teal",
  },
  {
    key: "customsPending",
    label: "Dossiers douane en attente",
    value: 9,
    delta: -1,
    goodDirection: "down",
    tone: "amber",
  },
  {
    key: "delayed",
    label: "Opérations en retard",
    value: 3,
    delta: 1,
    goodDirection: "down",
    tone: "red",
  },
  {
    key: "tasksDue",
    label: "Tâches dues aujourd'hui",
    value: 17,
    delta: -3,
    goodDirection: "down",
    tone: "navy",
  },
  {
    key: "docsMissing",
    label: "Documents manquants",
    value: 6,
    delta: 0,
    goodDirection: "down",
    tone: "amber",
  },
];
