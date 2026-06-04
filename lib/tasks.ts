import type {
  TaskWorkflowStatus,
  TaskWorkflowPriority,
  Tone,
} from "./status";
import { getShipment } from "./shipments";
import { getCustomsFile } from "./customs";
import { documents, type DocumentRecord } from "./documents";

/* ----------------------------------------------------------------------------
 * Mock dataset for the Tasks & Workflow module — the operational execution
 * layer that connects customers, shipments, customs files and documents. Tasks
 * reference the existing datasets so every link resolves. Static only.
 * ------------------------------------------------------------------------- */

export type TaskModule = "shipments" | "customs" | "documents" | "customers";

export const taskModuleMeta: Record<TaskModule, { label: string }> = {
  shipments: { label: "Expéditions" },
  customs: { label: "Dédouanement" },
  documents: { label: "Documents" },
  customers: { label: "Clients" },
};

export const taskModuleOrder: TaskModule[] = [
  "shipments",
  "customs",
  "documents",
  "customers",
];

/** Relative due state — drives KPIs and the date colour hint. */
export type DueFlag = "overdue" | "today" | "soon";

export type TaskActivity = {
  actor: string;
  time: string;
  text: string;
};

export type TaskNote = {
  author: string;
  time: string;
  text: string;
};

export type TaskRecord = {
  /** Reference — also the route id. */
  id: string;
  title: string;
  description: string;
  status: TaskWorkflowStatus;
  priority: TaskWorkflowPriority;
  module: TaskModule;
  assignee: string;
  customer?: string;
  relatedShipment?: string;
  relatedCustomsFile?: string;
  relatedDocument?: string;
  createdDate: string;
  assignedDate?: string;
  startedDate?: string;
  doneDate?: string;
  dueDate: string;
  dueFlag: DueFlag;
  activity: TaskActivity[];
  notes: TaskNote[];
};

/* ---- Timeline model ------------------------------------------------------ */

export type TaskMilestoneKey = "created" | "assigned" | "started" | "resolved";

export const TASK_MILESTONES: { key: TaskMilestoneKey; label: string }[] = [
  { key: "created", label: "Créée" },
  { key: "assigned", label: "Assignée" },
  { key: "started", label: "En cours" },
  { key: "resolved", label: "Résolue" },
];

/** Number of fully-completed milestones for each status. */
const COMPLETED_BY_STATUS: Record<TaskWorkflowStatus, number> = {
  todo: 1,
  in_progress: 2,
  blocked: 2,
  awaiting_client: 2,
  awaiting_customs: 2,
  overdue: 2,
  done: 4,
};

const AMBER_EXCEPTION: TaskWorkflowStatus[] = [
  "awaiting_client",
  "awaiting_customs",
];
const RED_EXCEPTION: TaskWorkflowStatus[] = ["blocked", "overdue"];

export type TaskTimelineStep = {
  key: TaskMilestoneKey;
  label: string;
  state: "done" | "current" | "upcoming";
  tone: Tone;
  date?: string;
};

export function buildTaskTimeline(task: TaskRecord): TaskTimelineStep[] {
  const completed = COMPLETED_BY_STATUS[task.status];
  const amber = AMBER_EXCEPTION.includes(task.status);
  const red = RED_EXCEPTION.includes(task.status);
  const dates: Record<TaskMilestoneKey, string | undefined> = {
    created: task.createdDate,
    assigned: task.assignedDate,
    started: task.startedDate,
    resolved: task.doneDate,
  };

  return TASK_MILESTONES.map((m, i) => {
    let state: TaskTimelineStep["state"];
    if (i < completed) state = "done";
    else if (i === completed) state = "current";
    else state = "upcoming";

    const tone: Tone =
      state === "done"
        ? "teal"
        : state === "current"
          ? red
            ? "red"
            : amber
              ? "amber"
              : "navy"
          : "slate";

    return { ...m, state, tone, date: dates[m.key] };
  });
}

/* ---- Helpers ------------------------------------------------------------- */

export function getTask(id: string): TaskRecord | undefined {
  return tasks.find((t) => t.id === id);
}

export function isOpen(task: TaskRecord): boolean {
  return task.status !== "done";
}

/** Documents tied to this task — by explicit link or shared related file. */
export function relatedDocumentsForTask(task: TaskRecord): DocumentRecord[] {
  const seen = new Set<string>();
  const out: DocumentRecord[] = [];
  for (const d of documents) {
    const match =
      d.id === task.relatedDocument ||
      (task.relatedCustomsFile &&
        d.relatedCustomsFile === task.relatedCustomsFile) ||
      (task.relatedShipment && d.relatedShipment === task.relatedShipment);
    if (match && !seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  }
  // Surface the explicitly-linked document first.
  out.sort((a, b) =>
    a.id === task.relatedDocument ? -1 : b.id === task.relatedDocument ? 1 : 0,
  );
  return out;
}

export { getShipment, getCustomsFile };

/* ---- Data ---------------------------------------------------------------- */

export const tasks: TaskRecord[] = [
  {
    id: "TSK-2026-0001",
    title: "Obtenir le certificat d'origine manquant",
    description:
      "Le dossier DD-2026-0479 (Atlantic Pharma) est en circuit rouge. L'inspecteur exige le certificat d'origine pour lever le blocage. Relancer le client et transmettre la pièce au bureau Aéroport.",
    status: "blocked",
    priority: "critical",
    module: "documents",
    assignee: "Khadija Bâ",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0479",
    relatedCustomsFile: "DD-2026-0479",
    relatedDocument: "CO-2026-0290",
    createdDate: "02 juin 2026",
    assignedDate: "02 juin 2026",
    startedDate: "03 juin 2026",
    dueDate: "Aujourd'hui 12:00",
    dueFlag: "today",
    activity: [
      {
        actor: "Khadija Bâ",
        time: "03 juin 09:15",
        text: "Dossier orienté circuit rouge — certificat d'origine réclamé par l'inspecteur.",
      },
      {
        actor: "Khadija Bâ",
        time: "Aujourd'hui 08:40",
        text: "Relance client envoyée, en attente de la pièce.",
      },
    ],
    notes: [
      {
        author: "Khadija Bâ",
        time: "Aujourd'hui 08:42",
        text: "Bloquant pour la mainlevée. Escalader si non reçu avant midi.",
      },
    ],
  },
  {
    id: "TSK-2026-0002",
    title: "Suivre la visite douanière (circuit rouge)",
    description:
      "Assurer le suivi de la visite physique du dossier DD-2026-0479 et coordonner la présence sur site avec l'inspecteur affecté.",
    status: "awaiting_customs",
    priority: "high",
    module: "customs",
    assignee: "Khadija Bâ",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0479",
    relatedCustomsFile: "DD-2026-0479",
    createdDate: "03 juin 2026",
    assignedDate: "03 juin 2026",
    startedDate: "03 juin 2026",
    dueDate: "Aujourd'hui 15:00",
    dueFlag: "today",
    activity: [
      {
        actor: "Khadija Bâ",
        time: "Aujourd'hui 11:25",
        text: "Visite programmée — en attente du créneau de l'inspecteur.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0003",
    title: "Valider la facture commerciale",
    description:
      "Contrôler la cohérence de la facture INV-2026-0418 (Atlantic Pharma) avec la liste de colisage et la valeur en douane, puis valider la pièce.",
    status: "done",
    priority: "normal",
    module: "documents",
    assignee: "Moussa Diop",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    relatedDocument: "INV-2026-0418",
    createdDate: "02 juin 2026",
    assignedDate: "02 juin 2026",
    startedDate: "02 juin 2026",
    doneDate: "02 juin 2026",
    dueDate: "02 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Moussa Diop",
        time: "02 juin 16:30",
        text: "Facture vérifiée et validée — montants conformes.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0004",
    title: "Obtenir le BAE",
    description:
      "Finaliser la liquidation du dossier DD-2026-0470 (Baobab Trading) et obtenir le Bon à enlever après règlement des droits et taxes.",
    status: "in_progress",
    priority: "high",
    module: "customs",
    assignee: "Mamadou Sow",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0470",
    relatedCustomsFile: "DD-2026-0470",
    createdDate: "31 mai 2026",
    assignedDate: "31 mai 2026",
    startedDate: "Aujourd'hui 09:40",
    dueDate: "Demain 12:00",
    dueFlag: "soon",
    activity: [
      {
        actor: "Mamadou Sow",
        time: "Aujourd'hui 09:40",
        text: "Circuit vert — liquidation en cours auprès du bureau Port Sud.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0005",
    title: "Relancer le paiement client (droits & taxes)",
    description:
      "Le bulletin de liquidation du dossier DD-2026-0465 (Dakar Agro Export) est émis. Relancer le client pour le virement afin d'obtenir la quittance et le BAE.",
    status: "awaiting_client",
    priority: "high",
    module: "customs",
    assignee: "Ndèye Fall",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0465",
    relatedCustomsFile: "DD-2026-0465",
    createdDate: "31 mai 2026",
    assignedDate: "31 mai 2026",
    startedDate: "01 juin 2026",
    dueDate: "Hier 17:00",
    dueFlag: "overdue",
    activity: [
      {
        actor: "Ndèye Fall",
        time: "Hier 18:25",
        text: "Relance envoyée — virement non encore reçu.",
      },
    ],
    notes: [
      {
        author: "Ndèye Fall",
        time: "Hier 18:25",
        text: "Risque de magasinage supplémentaire si le règlement tarde.",
      },
    ],
  },
  {
    id: "TSK-2026-0006",
    title: "Téléverser la liste de colisage",
    description:
      "Récupérer la liste de colisage manquante (PKL-2026-0485, Atlantic Pharma) auprès du client et l'ajouter au dossier pour finaliser la vérification documentaire.",
    status: "in_progress",
    priority: "normal",
    module: "documents",
    assignee: "Moussa Diop",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    relatedDocument: "PKL-2026-0485",
    createdDate: "03 juin 2026",
    assignedDate: "03 juin 2026",
    startedDate: "Aujourd'hui 10:20",
    dueDate: "Demain 10:00",
    dueFlag: "soon",
    activity: [
      {
        actor: "Moussa Diop",
        time: "Aujourd'hui 10:20",
        text: "Pièce reçue — à vérifier avant validation.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0007",
    title: "Confirmer la mainlevée / sortie du conteneur",
    description:
      "Confirmer l'enlèvement de la marchandise pour le dossier DD-2026-0468 (Teranga Import Services) après obtention du BAE.",
    status: "done",
    priority: "normal",
    module: "customs",
    assignee: "Ndèye Fall",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    relatedCustomsFile: "DD-2026-0468",
    createdDate: "01 juin 2026",
    assignedDate: "01 juin 2026",
    startedDate: "01 juin 2026",
    doneDate: "Aujourd'hui 07:58",
    dueDate: "Aujourd'hui 08:00",
    dueFlag: "soon",
    activity: [
      {
        actor: "Ndèye Fall",
        time: "Aujourd'hui 07:58",
        text: "BAE obtenu, sortie confirmée — dossier transmis à la livraison.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0008",
    title: "Vérifier l'autorisation d'importation (DPM)",
    description:
      "Obtenir et contrôler l'autorisation d'importation DPM (West Africa Medical Supply) requise pour le premier dédouanement de produits de santé.",
    status: "awaiting_client",
    priority: "high",
    module: "documents",
    assignee: "Moussa Diop",
    customer: "West Africa Medical Supply",
    relatedDocument: "AUTI-WAMS-2026",
    createdDate: "26 mai 2026",
    assignedDate: "26 mai 2026",
    startedDate: "27 mai 2026",
    dueDate: "10 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Moussa Diop",
        time: "Aujourd'hui 09:30",
        text: "Onboarding en cours — autorisation DPM toujours en attente du client.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0009",
    title: "Planifier la livraison (Thiès)",
    description:
      "Organiser le créneau de livraison vers l'entrepôt de Thiès pour l'expédition EFT-2026-0468 (Teranga Import Services) et confirmer avec le client.",
    status: "in_progress",
    priority: "normal",
    module: "shipments",
    assignee: "Aïssatou Bâ",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    relatedCustomsFile: "DD-2026-0468",
    createdDate: "Aujourd'hui 07:55",
    assignedDate: "Aujourd'hui 07:55",
    startedDate: "Aujourd'hui 08:10",
    dueDate: "Aujourd'hui 16:30",
    dueFlag: "today",
    activity: [
      {
        actor: "Aïssatou Bâ",
        time: "Aujourd'hui 08:10",
        text: "Camion affrété — en attente de confirmation du créneau client.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0010",
    title: "Relancer le transporteur (repositionnement camion)",
    description:
      "Reprogrammer le positionnement du camion vers Touba pour l'expédition EFT-2026-0465 (Dakar Agro Export) après l'indisponibilité du transporteur.",
    status: "overdue",
    priority: "high",
    module: "shipments",
    assignee: "Ibrahima Gueye",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0465",
    createdDate: "Hier 09:00",
    assignedDate: "Hier 09:00",
    startedDate: "Hier 10:00",
    dueDate: "Aujourd'hui 09:00",
    dueFlag: "overdue",
    activity: [
      {
        actor: "Ibrahima Gueye",
        time: "Hier 18:20",
        text: "Nouveau créneau visé le 05 juin — confirmation transporteur en attente.",
      },
    ],
    notes: [
      {
        author: "Ibrahima Gueye",
        time: "Hier 18:20",
        text: "Client informé du retard. Échéance dépassée — à traiter en priorité ce matin.",
      },
    ],
  },
  {
    id: "TSK-2026-0011",
    title: "Obtenir le B/L original et la liste de colisage",
    description:
      "Récupérer le B/L original (BL-CAS-90551) et la liste de colisage manquants pour le dossier DD-2026-0476 (SenMatériaux SARL). Bloquant pour la déclaration.",
    status: "blocked",
    priority: "critical",
    module: "documents",
    assignee: "Fatou Sarr",
    customer: "SenMatériaux SARL",
    relatedShipment: "EFT-2026-0476",
    relatedCustomsFile: "DD-2026-0476",
    relatedDocument: "BL-CAS-90551",
    createdDate: "01 juin 2026",
    assignedDate: "01 juin 2026",
    startedDate: "01 juin 2026",
    dueDate: "Hier 15:00",
    dueFlag: "overdue",
    activity: [
      {
        actor: "Fatou Sarr",
        time: "Hier 16:50",
        text: "Relance urgente fournisseur — documents toujours non reçus.",
      },
    ],
    notes: [
      {
        author: "Fatou Sarr",
        time: "Hier 16:50",
        text: "Conteneurs au port. Risque de surestaries — escalade nécessaire.",
      },
    ],
  },
  {
    id: "TSK-2026-0012",
    title: "Régulariser l'attestation fiscale expirée",
    description:
      "Obtenir l'attestation fiscale à jour de SenMatériaux SARL (ATF-SM-2025 expirée) avant tout nouveau dépôt en douane.",
    status: "awaiting_client",
    priority: "high",
    module: "customers",
    assignee: "Fatou Sarr",
    customer: "SenMatériaux SARL",
    relatedDocument: "ATF-SM-2025",
    createdDate: "Hier 16:50",
    assignedDate: "Hier 16:50",
    startedDate: "Hier 17:00",
    dueDate: "06 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Fatou Sarr",
        time: "Hier 16:55",
        text: "Demande de mise à jour transmise au client.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0013",
    title: "Préparer la déclaration anticipée",
    description:
      "Préparer la déclaration anticipée du dossier DD-2026-0483 (Baobab Trading) pour un dépôt dès l'arrivée du navire (ETA 12 juin).",
    status: "todo",
    priority: "normal",
    module: "customs",
    assignee: "Mamadou Sow",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0483",
    relatedCustomsFile: "DD-2026-0483",
    createdDate: "Hier 17:35",
    dueDate: "10 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Cheikh Fall",
        time: "Hier 17:35",
        text: "Tâche créée — documents complets, déclaration à préparer.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0014",
    title: "Déposer la déclaration en douane",
    description:
      "Déposer la déclaration DDU-2026-10481 (Dakar Agro Export) via GAINDE et suivre l'affectation du circuit.",
    status: "in_progress",
    priority: "high",
    module: "customs",
    assignee: "Bineta Diagne",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0481",
    relatedCustomsFile: "DD-2026-0481",
    createdDate: "01 juin 2026",
    assignedDate: "01 juin 2026",
    startedDate: "03 juin 2026",
    dueDate: "Aujourd'hui 11:00",
    dueFlag: "today",
    activity: [
      {
        actor: "Bineta Diagne",
        time: "Aujourd'hui 09:10",
        text: "Déclaration déposée — en attente d'affectation du circuit et du phytosanitaire.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0015",
    title: "Confirmer le booking armateur",
    description:
      "Confirmer la réservation auprès de l'armateur pour l'expédition EFT-2026-0488 (Teranga Import Services) au départ de Shanghai.",
    status: "todo",
    priority: "normal",
    module: "shipments",
    assignee: "Aïssatou Bâ",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0488",
    createdDate: "Aujourd'hui 08:42",
    dueDate: "07 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Aïssatou Bâ",
        time: "Aujourd'hui 08:42",
        text: "Tâche créée à l'ouverture du dossier.",
      },
    ],
    notes: [],
  },
  {
    id: "TSK-2026-0016",
    title: "Vérifier les documents d'expédition",
    description:
      "Contrôler les documents d'expédition fournisseur attendus pour le dossier EFT-2026-0488 / DD-2026-0488 (Teranga Import Services) dès réception.",
    status: "todo",
    priority: "low",
    module: "documents",
    assignee: "Aïssatou Bâ",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0488",
    relatedCustomsFile: "DD-2026-0488",
    createdDate: "Aujourd'hui 08:42",
    dueDate: "08 juin 2026",
    dueFlag: "soon",
    activity: [
      {
        actor: "Aïssatou Bâ",
        time: "Aujourd'hui 08:42",
        text: "Tâche créée — en attente des documents fournisseur.",
      },
    ],
    notes: [],
  },
];
