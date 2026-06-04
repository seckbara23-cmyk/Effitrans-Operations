import type { ShipmentStatus, TransportMode, TaskStatus, Tone } from "./status";

/* ----------------------------------------------------------------------------
 * Canonical mock dataset for the Shipments module. References are aligned with
 * the dashboard so a row there maps to a real detail page here. Static only —
 * no backend, no persistence.
 * ------------------------------------------------------------------------- */

export type DocStatus = "received" | "pending" | "missing";

export type ShipmentDocument = {
  type: "invoice" | "packing" | "transport" | "customs";
  label: string;
  status: DocStatus;
  ref?: string;
  date?: string;
};

export type ShipmentTask = {
  label: string;
  assignee: string;
  due: string;
  status: TaskStatus;
};

export type ShipmentNote = {
  author: string;
  time: string;
  text: string;
};

export type MilestoneKey =
  | "opened"
  | "docs_received"
  | "at_port"
  | "customs"
  | "cleared"
  | "delivery_scheduled"
  | "delivered";

export type ShipmentRecord = {
  reference: string;
  customer: string;
  mode: TransportMode;
  origin: string;
  destination: string;
  status: ShipmentStatus;
  agent: string;
  /** B/L, AWB or CMR number depending on mode */
  transportRef?: string;
  incoterm: string;
  eta: string;
  lastUpdate: string;
  weight: string;
  packages: string;
  goods: string;
  milestoneDates: Partial<Record<MilestoneKey, string>>;
  documents: ShipmentDocument[];
  tasks: ShipmentTask[];
  notes: ShipmentNote[];
};

/* ---- Timeline model ------------------------------------------------------ */

export const MILESTONES: { key: MilestoneKey; label: string }[] = [
  { key: "opened", label: "Dossier ouvert" },
  { key: "docs_received", label: "Documents reçus" },
  { key: "at_port", label: "Au port / aéroport" },
  { key: "customs", label: "Dédouanement" },
  { key: "cleared", label: "Dédouané" },
  { key: "delivery_scheduled", label: "Livraison planifiée" },
  { key: "delivered", label: "Livré" },
];

/** Number of fully-completed milestones for each status. */
const COMPLETED_BY_STATUS: Record<ShipmentStatus, number> = {
  new: 1,
  docs_pending: 1,
  in_transit: 2,
  at_port: 3,
  customs_pending: 3,
  docs_missing: 3,
  cleared: 5,
  delivery_scheduled: 6,
  delivered: 7,
  delayed: 3,
};

/** Statuses where the current milestone is an exception (warning tone). */
const EXCEPTION_STATUSES: ShipmentStatus[] = [
  "docs_pending",
  "customs_pending",
  "docs_missing",
  "delayed",
];

export type TimelineStep = {
  key: MilestoneKey;
  label: string;
  state: "done" | "current" | "upcoming";
  tone: Tone;
  date?: string;
};

export function buildTimeline(shipment: ShipmentRecord): TimelineStep[] {
  const completed = COMPLETED_BY_STATUS[shipment.status];
  const isException = EXCEPTION_STATUSES.includes(shipment.status);

  return MILESTONES.map((m, i) => {
    let state: TimelineStep["state"];
    if (i < completed) state = "done";
    else if (i === completed) state = "current";
    else state = "upcoming";

    const tone: Tone =
      state === "done"
        ? "teal"
        : state === "current"
          ? isException
            ? "amber"
            : "navy"
          : "slate";

    return { ...m, state, tone, date: shipment.milestoneDates[m.key] };
  });
}

/* ---- Helpers ------------------------------------------------------------- */

export function getShipment(reference: string): ShipmentRecord | undefined {
  return shipments.find((s) => s.reference === reference);
}

export const docStatusMeta: Record<DocStatus, { label: string; tone: Tone }> = {
  received: { label: "Reçu", tone: "green" },
  pending: { label: "En attente", tone: "amber" },
  missing: { label: "Manquant", tone: "red" },
};

/* ---- Data ---------------------------------------------------------------- */

const PORT = "Port de Dakar";
const AIBD = "Aéroport Blaise Diagne (AIBD)";

export const shipments: ShipmentRecord[] = [
  {
    reference: "EFT-2026-0488",
    customer: "Teranga Import Services",
    mode: "sea",
    origin: "Shanghai",
    destination: PORT,
    status: "new",
    agent: "Aïssatou Bâ",
    transportRef: "B/L en attente",
    incoterm: "FOB Shanghai",
    eta: "21 juin 2026",
    lastUpdate: "Aujourd'hui 08:42",
    weight: "18 400 kg",
    packages: "1 × 40' HC",
    goods: "Équipements électroménagers",
    milestoneDates: { opened: "04 juin 2026" },
    documents: [
      { type: "invoice", label: "Facture commerciale", status: "pending" },
      { type: "packing", label: "Liste de colisage", status: "pending" },
      { type: "transport", label: "Connaissement (B/L)", status: "pending" },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    tasks: [
      {
        label: "Vérifier les documents",
        assignee: "Aïssatou Bâ",
        due: "06 juin",
        status: "todo",
      },
      {
        label: "Confirmer le booking armateur",
        assignee: "Aïssatou Bâ",
        due: "07 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Aïssatou Bâ",
        time: "Aujourd'hui 08:42",
        text: "Dossier ouvert à la demande du client. En attente des documents d'expédition fournisseur.",
      },
    ],
  },
  {
    reference: "EFT-2026-0485",
    customer: "Atlantic Pharma",
    mode: "air",
    origin: "Marseille",
    destination: AIBD,
    status: "docs_pending",
    agent: "Moussa Diop",
    transportRef: "AWB 074-5588 1204",
    incoterm: "CIP Dakar",
    eta: "09 juin 2026",
    lastUpdate: "Aujourd'hui 10:15",
    weight: "640 kg",
    packages: "12 colis",
    goods: "Produits pharmaceutiques (chaîne du froid)",
    milestoneDates: { opened: "02 juin 2026" },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-AP-2291",
        date: "02 juin",
      },
      { type: "packing", label: "Liste de colisage", status: "pending" },
      {
        type: "transport",
        label: "Lettre de transport aérien (AWB)",
        status: "received",
        ref: "074-5588 1204",
        date: "03 juin",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    tasks: [
      {
        label: "Relancer le client pour la liste de colisage",
        assignee: "Moussa Diop",
        due: "Aujourd'hui 14:00",
        status: "in_progress",
      },
      {
        label: "Vérifier les documents",
        assignee: "Moussa Diop",
        due: "05 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Moussa Diop",
        time: "Aujourd'hui 10:15",
        text: "AWB et facture reçus. Liste de colisage manquante — relance client en cours. Marchandise sous température dirigée, priorité au dédouanement.",
      },
    ],
  },
  {
    reference: "EFT-2026-0483",
    customer: "Baobab Trading",
    mode: "sea",
    origin: "Dubai",
    destination: PORT,
    status: "in_transit",
    agent: "Cheikh Fall",
    transportRef: "B/L CMAU 4471920",
    incoterm: "CIF Dakar",
    eta: "12 juin 2026",
    lastUpdate: "Hier 17:30",
    weight: "26 100 kg",
    packages: "2 × 20'",
    goods: "Pièces détachées automobiles",
    milestoneDates: {
      opened: "28 mai 2026",
      docs_received: "31 mai 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-BT-1180",
        date: "31 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "31 mai",
      },
      {
        type: "transport",
        label: "Connaissement (B/L)",
        status: "received",
        ref: "CMAU 4471920",
        date: "30 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    tasks: [
      {
        label: "Préparer la déclaration anticipée",
        assignee: "Cheikh Fall",
        due: "10 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Cheikh Fall",
        time: "Hier 17:30",
        text: "Navire en transit, ETA 12 juin au Port de Dakar. Documents complets, déclaration à préparer en anticipé.",
      },
    ],
  },
  {
    reference: "EFT-2026-0481",
    customer: "Dakar Agro Export",
    mode: "sea",
    origin: "Shanghai",
    destination: PORT,
    status: "at_port",
    agent: "Awa Ndiaye",
    transportRef: "B/L MSKU 472108-3",
    incoterm: "CIF Dakar",
    eta: "Arrivé · 03 juin 2026",
    lastUpdate: "Aujourd'hui 09:05",
    weight: "22 750 kg",
    packages: "1 × 40'",
    goods: "Matériel d'irrigation agricole",
    milestoneDates: {
      opened: "25 mai 2026",
      docs_received: "29 mai 2026",
      at_port: "03 juin 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-DAE-3320",
        date: "29 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "29 mai",
      },
      {
        type: "transport",
        label: "Connaissement (B/L)",
        status: "received",
        ref: "MSKU 472108-3",
        date: "28 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    tasks: [
      {
        label: "Déposer la déclaration en douane (DDU)",
        assignee: "Awa Ndiaye",
        due: "Aujourd'hui 11:00",
        status: "in_progress",
      },
      {
        label: "Régler les frais de magasinage",
        assignee: "Awa Ndiaye",
        due: "06 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Awa Ndiaye",
        time: "Aujourd'hui 09:05",
        text: "Conteneur déchargé au terminal. Certificat phytosanitaire à joindre avant dépôt de la déclaration.",
      },
    ],
  },
  {
    reference: "EFT-2026-0479",
    customer: "Atlantic Pharma",
    mode: "air",
    origin: "Marseille",
    destination: AIBD,
    status: "customs_pending",
    agent: "Moussa Diop",
    transportRef: "AWB 074-5521 8890",
    incoterm: "CIP Dakar",
    eta: "Arrivé · 02 juin 2026",
    lastUpdate: "Aujourd'hui 11:20",
    weight: "410 kg",
    packages: "8 colis",
    goods: "Dispositifs médicaux",
    milestoneDates: {
      opened: "30 mai 2026",
      docs_received: "01 juin 2026",
      at_port: "02 juin 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-AP-2287",
        date: "01 juin",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "01 juin",
      },
      {
        type: "transport",
        label: "Lettre de transport aérien (AWB)",
        status: "received",
        ref: "074-5521 8890",
        date: "01 juin",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10455",
        date: "03 juin",
      },
    ],
    tasks: [
      {
        label: "Suivre la visite douane (Insp. Sow)",
        assignee: "Moussa Diop",
        due: "Aujourd'hui 15:00",
        status: "in_progress",
      },
      {
        label: "Fournir le certificat d'origine",
        assignee: "Moussa Diop",
        due: "Aujourd'hui 12:30",
        status: "overdue",
      },
    ],
    notes: [
      {
        author: "Moussa Diop",
        time: "Aujourd'hui 11:20",
        text: "Déclaration déposée, dossier en visite douane. Certificat d'origine demandé par l'inspecteur.",
      },
    ],
  },
  {
    reference: "EFT-2026-0476",
    customer: "SenMatériaux SARL",
    mode: "sea",
    origin: "Casablanca",
    destination: PORT,
    status: "docs_missing",
    agent: "Fatou Sarr",
    transportRef: "B/L TGHU 905512-7",
    incoterm: "FOB Casablanca",
    eta: "Arrivé · 01 juin 2026",
    lastUpdate: "Hier 16:48",
    weight: "31 200 kg",
    packages: "2 × 40'",
    goods: "Matériaux de construction (carrelage)",
    milestoneDates: {
      opened: "24 mai 2026",
      docs_received: "27 mai 2026",
      at_port: "01 juin 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-SM-0907",
        date: "27 mai",
      },
      { type: "packing", label: "Liste de colisage", status: "missing" },
      { type: "transport", label: "Connaissement (B/L)", status: "missing" },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    tasks: [
      {
        label: "Obtenir le B/L original et la liste de colisage",
        assignee: "Fatou Sarr",
        due: "Aujourd'hui 15:00",
        status: "overdue",
      },
      {
        label: "Régler les frais de magasinage au port",
        assignee: "Fatou Sarr",
        due: "06 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Fatou Sarr",
        time: "Hier 16:48",
        text: "Conteneurs au port mais B/L original et liste de colisage non reçus du fournisseur. Risque de frais de surestaries — relance urgente.",
      },
    ],
  },
  {
    reference: "EFT-2026-0470",
    customer: "Baobab Trading",
    mode: "sea",
    origin: "Dubai",
    destination: PORT,
    status: "cleared",
    agent: "Cheikh Fall",
    transportRef: "B/L CMAU 318774-0",
    incoterm: "CIF Dakar",
    eta: "Arrivé · 28 mai 2026",
    lastUpdate: "Hier 14:10",
    weight: "14 900 kg",
    packages: "1 × 20'",
    goods: "Textiles et confection",
    milestoneDates: {
      opened: "18 mai 2026",
      docs_received: "21 mai 2026",
      at_port: "28 mai 2026",
      customs: "31 mai 2026",
      cleared: "02 juin 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-BT-1166",
        date: "21 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "21 mai",
      },
      {
        type: "transport",
        label: "Connaissement (B/L)",
        status: "received",
        ref: "CMAU 318774-0",
        date: "20 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10318",
        date: "31 mai",
      },
    ],
    tasks: [
      {
        label: "Planifier l'enlèvement et la livraison",
        assignee: "Cheikh Fall",
        due: "05 juin",
        status: "todo",
      },
    ],
    notes: [
      {
        author: "Cheikh Fall",
        time: "Hier 14:10",
        text: "Bon à enlever (BAE) obtenu. Dossier prêt pour l'organisation de la livraison vers l'entrepôt client.",
      },
    ],
  },
  {
    reference: "EFT-2026-0468",
    customer: "Teranga Import Services",
    mode: "road",
    origin: "Abidjan",
    destination: "Thiès",
    status: "delivery_scheduled",
    agent: "Aïssatou Bâ",
    transportRef: "CMR 2026-0771",
    incoterm: "DAP Thiès",
    eta: "06 juin 2026",
    lastUpdate: "Aujourd'hui 07:55",
    weight: "9 800 kg",
    packages: "14 palettes",
    goods: "Produits cosmétiques",
    milestoneDates: {
      opened: "20 mai 2026",
      docs_received: "22 mai 2026",
      at_port: "29 mai 2026",
      customs: "31 mai 2026",
      cleared: "01 juin 2026",
      delivery_scheduled: "03 juin 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-TIS-4402",
        date: "22 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "22 mai",
      },
      {
        type: "transport",
        label: "Lettre de voiture (CMR)",
        status: "received",
        ref: "CMR 2026-0771",
        date: "22 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10290",
        date: "31 mai",
      },
    ],
    tasks: [
      {
        label: "Confirmer le rendez-vous de livraison (Thiès)",
        assignee: "Aïssatou Bâ",
        due: "Aujourd'hui 16:30",
        status: "in_progress",
      },
    ],
    notes: [
      {
        author: "Aïssatou Bâ",
        time: "Aujourd'hui 07:55",
        text: "Camion affrété, livraison programmée le 06 juin à l'entrepôt de Thiès. En attente de confirmation du créneau client.",
      },
    ],
  },
  {
    reference: "EFT-2026-0465",
    customer: "Dakar Agro Export",
    mode: "road",
    origin: PORT,
    destination: "Touba",
    status: "delayed",
    agent: "Ibrahima Gueye",
    transportRef: "CMR 2026-0763",
    incoterm: "DAP Touba",
    eta: "Reprogrammé · 05 juin 2026",
    lastUpdate: "Hier 18:20",
    weight: "12 300 kg",
    packages: "20 palettes",
    goods: "Engrais agricoles",
    milestoneDates: {
      opened: "19 mai 2026",
      docs_received: "21 mai 2026",
      at_port: "27 mai 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-DAE-3301",
        date: "21 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "21 mai",
      },
      {
        type: "transport",
        label: "Lettre de voiture (CMR)",
        status: "received",
        ref: "CMR 2026-0763",
        date: "21 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10260",
        date: "29 mai",
      },
    ],
    tasks: [
      {
        label: "Reprogrammer le positionnement camion vers Touba",
        assignee: "Ibrahima Gueye",
        due: "Aujourd'hui 09:00",
        status: "overdue",
      },
    ],
    notes: [
      {
        author: "Ibrahima Gueye",
        time: "Hier 18:20",
        text: "Livraison retardée — indisponibilité transporteur. Nouveau créneau visé le 05 juin. Client informé.",
      },
    ],
  },
  {
    reference: "EFT-2026-0461",
    customer: "Baobab Trading",
    mode: "air",
    origin: "Dubai",
    destination: AIBD,
    status: "delivered",
    agent: "Awa Ndiaye",
    transportRef: "AWB 176-8841 2210",
    incoterm: "CIP Dakar",
    eta: "Livré · 31 mai 2026",
    lastUpdate: "31 mai 16:40",
    weight: "520 kg",
    packages: "6 colis",
    goods: "Électronique grand public",
    milestoneDates: {
      opened: "14 mai 2026",
      docs_received: "16 mai 2026",
      at_port: "20 mai 2026",
      customs: "22 mai 2026",
      cleared: "24 mai 2026",
      delivery_scheduled: "28 mai 2026",
      delivered: "31 mai 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-BT-1140",
        date: "16 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "16 mai",
      },
      {
        type: "transport",
        label: "Lettre de transport aérien (AWB)",
        status: "received",
        ref: "176-8841 2210",
        date: "16 mai",
      },
      {
        type: "customs",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10180",
        date: "22 mai",
      },
    ],
    tasks: [
      {
        label: "Archiver le dossier clôturé",
        assignee: "Awa Ndiaye",
        due: "31 mai",
        status: "done",
      },
    ],
    notes: [
      {
        author: "Awa Ndiaye",
        time: "31 mai 16:40",
        text: "Marchandise livrée et réceptionnée par le client. Dossier clôturé et archivé.",
      },
    ],
  },
];
