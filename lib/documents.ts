import type { DocumentStatus, Tone } from "./status";
import { getShipment, type DocStatus } from "./shipments";
import { getCustomsFile } from "./customs";

/* ----------------------------------------------------------------------------
 * Mock dataset for the Documents module — operations document tracker for a
 * Dakar logistics company and licensed customs broker. Documents link to the
 * existing customers, shipments and customs files. Static only — no backend,
 * no real uploads.
 * ------------------------------------------------------------------------- */

export type DocType =
  | "invoice"
  | "packing"
  | "bl"
  | "awb"
  | "origin"
  | "sanitary"
  | "tax"
  | "ninea"
  | "rccm"
  | "mandate"
  | "import_auth"
  | "declaration"
  | "bae"
  | "delivery"
  | "insurance";

export type DocSource = "client" | "customs" | "internal" | "carrier";

export const docSourceLabel: Record<DocSource, string> = {
  client: "Client",
  customs: "Douane",
  internal: "Interne",
  carrier: "Transporteur",
};

export type ValidationStage =
  | "received"
  | "checked"
  | "approved"
  | "rejected"
  | "missing_info";

export const validationStageMeta: Record<
  ValidationStage,
  { label: string; tone: Tone }
> = {
  received: { label: "Reçu", tone: "blue" },
  checked: { label: "Vérifié", tone: "navy" },
  approved: { label: "Validé", tone: "green" },
  rejected: { label: "Rejeté", tone: "red" },
  missing_info: { label: "Informations manquantes", tone: "amber" },
};

export type ValidationEvent = {
  stage: ValidationStage;
  actor: string;
  time: string;
  note?: string;
};

export type DocNote = {
  author: string;
  time: string;
  text: string;
};

export type DocumentRecord = {
  /** Reference — also the route id. */
  id: string;
  reference: string;
  name: string;
  type: DocType;
  status: DocumentStatus;
  customer: string;
  relatedShipment?: string;
  relatedCustomsFile?: string;
  owner: string;
  source: DocSource;
  format: "PDF" | "JPEG" | "PNG" | "XLSX";
  issueDate?: string;
  receivedDate?: string;
  expiryDate?: string;
  notes: DocNote[];
};

/* ---- Type metadata ------------------------------------------------------- */

export const docTypeMeta: Record<DocType, { label: string }> = {
  invoice: { label: "Facture commerciale" },
  packing: { label: "Packing list" },
  bl: { label: "Bill of Lading (B/L)" },
  awb: { label: "Air Waybill (AWB)" },
  origin: { label: "Certificat d'origine" },
  sanitary: { label: "Certificat sanitaire" },
  tax: { label: "Attestation fiscale" },
  ninea: { label: "NINEA" },
  rccm: { label: "RCCM" },
  mandate: { label: "Lettre de mandat" },
  import_auth: { label: "Autorisation d'importation" },
  declaration: { label: "Déclaration douane" },
  bae: { label: "BAE" },
  delivery: { label: "Bon de livraison" },
  insurance: { label: "Assurance transport" },
};

/** Ordered list for the type filter. */
export const docTypeOrder: DocType[] = [
  "invoice",
  "packing",
  "bl",
  "awb",
  "origin",
  "sanitary",
  "tax",
  "ninea",
  "rccm",
  "mandate",
  "import_auth",
  "declaration",
  "bae",
  "delivery",
  "insurance",
];

/* ---- Helpers ------------------------------------------------------------- */

export function getDocument(id: string): DocumentRecord | undefined {
  return documents.find((d) => d.id === id);
}

export type ChecklistItem = { label: string; status: DocStatus };

/**
 * Completeness checklist for the file a document belongs to. Prefers the
 * related customs file (richest: 6 pieces + BAE), else the related shipment.
 */
export function relatedChecklist(
  doc: DocumentRecord,
): { items: ChecklistItem[]; percent: number; source: string } | null {
  let items: ChecklistItem[] | null = null;
  let source = "";

  if (doc.relatedCustomsFile) {
    const f = getCustomsFile(doc.relatedCustomsFile);
    if (f) {
      items = f.documents.map((d) => ({ label: d.label, status: d.status }));
      items.push({
        label: "Bon à enlever (BAE)",
        status: f.baeRef ? "received" : "pending",
      });
      source = `Dossier douane ${f.reference}`;
    }
  }

  if (!items && doc.relatedShipment) {
    const s = getShipment(doc.relatedShipment);
    if (s) {
      items = s.documents.map((d) => ({ label: d.label, status: d.status }));
      source = `Expédition ${s.reference}`;
    }
  }

  if (!items) return null;

  const received = items.filter((i) => i.status === "received").length;
  const percent = Math.round((received / items.length) * 100);
  return { items, percent, source };
}

/** Validation trail derived from the document's status and dates. */
export function buildHistory(doc: DocumentRecord): ValidationEvent[] {
  const who = doc.owner;
  const clientActor = doc.source === "client" ? "Client" : docSourceLabel[doc.source];
  const recv = doc.receivedDate ?? doc.issueDate ?? "—";

  if (doc.status === "missing") {
    return [
      {
        stage: "missing_info",
        actor: who,
        time: "En cours",
        note: "Document demandé — en attente de transmission.",
      },
    ];
  }
  if (doc.status === "pending") {
    return [
      {
        stage: "missing_info",
        actor: who,
        time: "En cours",
        note: "Relance émise — pièce attendue prochainement.",
      },
    ];
  }

  const events: ValidationEvent[] = [
    { stage: "received", actor: clientActor, time: recv },
  ];

  if (doc.status === "received") return events;

  events.push({ stage: "checked", actor: who, time: recv });

  if (doc.status === "to_validate") return events;

  if (doc.status === "rejected") {
    events.push({
      stage: "rejected",
      actor: who,
      time: recv,
      note: "Informations incohérentes — pièce à corriger et renvoyer.",
    });
    return events;
  }

  // validated, expiring, expired
  events.push({ stage: "approved", actor: who, time: recv });
  if (doc.status === "expiring") {
    events[events.length - 1].note = `Validé — expire le ${doc.expiryDate ?? "—"}, renouvellement à prévoir.`;
  }
  if (doc.status === "expired") {
    events[events.length - 1].note = `Validé à l'époque — expiré depuis le ${doc.expiryDate ?? "—"}, à renouveler.`;
  }
  return events;
}

/* ---- Data ---------------------------------------------------------------- */

export const documents: DocumentRecord[] = [
  // — Atlantic Pharma · EFT-2026-0485 / DD-2026-0485 —
  {
    id: "INV-2026-0418",
    reference: "INV-2026-0418",
    name: "Facture commerciale — Atlantic Pharma",
    type: "invoice",
    status: "validated",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    owner: "Moussa Diop",
    source: "client",
    format: "PDF",
    issueDate: "30 mai 2026",
    receivedDate: "02 juin 2026",
    notes: [],
  },
  {
    id: "AWB-MRS-55881",
    reference: "AWB-MRS-55881",
    name: "Air Waybill — Atlantic Pharma",
    type: "awb",
    status: "received",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    owner: "Moussa Diop",
    source: "carrier",
    format: "PDF",
    issueDate: "03 juin 2026",
    receivedDate: "03 juin 2026",
    notes: [],
  },
  {
    id: "PKL-2026-0485",
    reference: "PKL-2026-0485",
    name: "Packing list — Atlantic Pharma",
    type: "packing",
    status: "to_validate",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    owner: "Moussa Diop",
    source: "client",
    format: "XLSX",
    receivedDate: "03 juin 2026",
    notes: [
      {
        author: "Moussa Diop",
        time: "Aujourd'hui 10:20",
        text: "Reçue tardivement — vérifier la cohérence des quantités avec la facture avant validation.",
      },
    ],
  },
  {
    id: "AUTI-AP-2026",
    reference: "AUTI-AP-2026",
    name: "Autorisation d'importation (DPM) — Atlantic Pharma",
    type: "import_auth",
    status: "pending",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    relatedCustomsFile: "DD-2026-0485",
    owner: "Khadija Bâ",
    source: "customs",
    format: "PDF",
    expiryDate: "31 déc. 2026",
    notes: [],
  },

  // — Atlantic Pharma · EFT-2026-0479 / DD-2026-0479 (bloqué) —
  {
    id: "DDU-2026-10455",
    reference: "DDU-2026-10455",
    name: "Déclaration en douane — Atlantic Pharma",
    type: "declaration",
    status: "to_validate",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0479",
    relatedCustomsFile: "DD-2026-0479",
    owner: "Khadija Bâ",
    source: "customs",
    format: "PDF",
    issueDate: "03 juin 2026",
    receivedDate: "03 juin 2026",
    notes: [],
  },
  {
    id: "CO-2026-0290",
    reference: "CO-2026-0290",
    name: "Certificat d'origine — Atlantic Pharma",
    type: "origin",
    status: "missing",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0479",
    relatedCustomsFile: "DD-2026-0479",
    owner: "Khadija Bâ",
    source: "client",
    format: "PDF",
    notes: [
      {
        author: "Khadija Bâ",
        time: "Aujourd'hui 11:25",
        text: "Réclamé par l'inspecteur (circuit rouge). Bloquant pour la levée du dossier — relance client urgente.",
      },
    ],
  },

  // — Dakar Agro Export · EFT-2026-0481 / DD-2026-0481 —
  {
    id: "INV-2026-0421",
    reference: "INV-2026-0421",
    name: "Facture commerciale — Dakar Agro Export",
    type: "invoice",
    status: "validated",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0481",
    relatedCustomsFile: "DD-2026-0481",
    owner: "Awa Ndiaye",
    source: "client",
    format: "PDF",
    issueDate: "27 mai 2026",
    receivedDate: "29 mai 2026",
    notes: [],
  },
  {
    id: "BL-SHA-47210",
    reference: "BL-SHA-47210",
    name: "Bill of Lading — Dakar Agro Export",
    type: "bl",
    status: "received",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0481",
    relatedCustomsFile: "DD-2026-0481",
    owner: "Bineta Diagne",
    source: "carrier",
    format: "PDF",
    issueDate: "28 mai 2026",
    receivedDate: "28 mai 2026",
    notes: [],
  },
  {
    id: "CSAN-2026-0044",
    reference: "CSAN-2026-0044",
    name: "Certificat phytosanitaire — Dakar Agro Export",
    type: "sanitary",
    status: "missing",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0481",
    relatedCustomsFile: "DD-2026-0481",
    owner: "Bineta Diagne",
    source: "client",
    format: "PDF",
    notes: [
      {
        author: "Bineta Diagne",
        time: "Aujourd'hui 09:10",
        text: "À joindre avant la visite. Demandé au service de la protection des végétaux.",
      },
    ],
  },

  // — Baobab Trading · EFT-2026-0483 / DD-2026-0483 —
  {
    id: "INV-2026-0410",
    reference: "INV-2026-0410",
    name: "Facture commerciale — Baobab Trading",
    type: "invoice",
    status: "validated",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0483",
    relatedCustomsFile: "DD-2026-0483",
    owner: "Cheikh Fall",
    source: "client",
    format: "PDF",
    issueDate: "30 mai 2026",
    receivedDate: "31 mai 2026",
    notes: [],
  },
  {
    id: "BL-DXB-44719",
    reference: "BL-DXB-44719",
    name: "Bill of Lading — Baobab Trading",
    type: "bl",
    status: "received",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0483",
    relatedCustomsFile: "DD-2026-0483",
    owner: "Cheikh Fall",
    source: "carrier",
    format: "PDF",
    issueDate: "30 mai 2026",
    receivedDate: "30 mai 2026",
    notes: [],
  },
  {
    id: "CO-2026-0330",
    reference: "CO-2026-0330",
    name: "Certificat d'origine — Baobab Trading",
    type: "origin",
    status: "received",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0483",
    relatedCustomsFile: "DD-2026-0483",
    owner: "Mamadou Sow",
    source: "client",
    format: "PDF",
    receivedDate: "31 mai 2026",
    notes: [],
  },

  // — SenMatériaux SARL · EFT-2026-0476 / DD-2026-0476 —
  {
    id: "INV-2026-0405",
    reference: "INV-2026-0405",
    name: "Facture commerciale — SenMatériaux SARL",
    type: "invoice",
    status: "received",
    customer: "SenMatériaux SARL",
    relatedShipment: "EFT-2026-0476",
    relatedCustomsFile: "DD-2026-0476",
    owner: "Fatou Sarr",
    source: "client",
    format: "PDF",
    issueDate: "26 mai 2026",
    receivedDate: "27 mai 2026",
    notes: [],
  },
  {
    id: "PKL-2026-0476",
    reference: "PKL-2026-0476",
    name: "Packing list — SenMatériaux SARL",
    type: "packing",
    status: "missing",
    customer: "SenMatériaux SARL",
    relatedShipment: "EFT-2026-0476",
    relatedCustomsFile: "DD-2026-0476",
    owner: "Fatou Sarr",
    source: "client",
    format: "XLSX",
    notes: [],
  },
  {
    id: "BL-CAS-90551",
    reference: "BL-CAS-90551",
    name: "Bill of Lading — SenMatériaux SARL",
    type: "bl",
    status: "missing",
    customer: "SenMatériaux SARL",
    relatedShipment: "EFT-2026-0476",
    relatedCustomsFile: "DD-2026-0476",
    owner: "Fatou Sarr",
    source: "carrier",
    format: "PDF",
    notes: [
      {
        author: "Fatou Sarr",
        time: "Hier 16:50",
        text: "B/L original non reçu du fournisseur. Bloquant pour la déclaration — risque de surestaries.",
      },
    ],
  },

  // — Teranga Import Services · EFT-2026-0468 / DD-2026-0468 —
  {
    id: "DDU-2026-10290",
    reference: "DDU-2026-10290",
    name: "Déclaration en douane — Teranga Import Services",
    type: "declaration",
    status: "validated",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    relatedCustomsFile: "DD-2026-0468",
    owner: "Ndèye Fall",
    source: "customs",
    format: "PDF",
    issueDate: "31 mai 2026",
    receivedDate: "31 mai 2026",
    notes: [],
  },
  {
    id: "BAE-2026-0468",
    reference: "BAE-2026-0468",
    name: "Bon à enlever (BAE) — Teranga Import Services",
    type: "bae",
    status: "validated",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    relatedCustomsFile: "DD-2026-0468",
    owner: "Ndèye Fall",
    source: "customs",
    format: "PDF",
    issueDate: "01 juin 2026",
    receivedDate: "01 juin 2026",
    notes: [],
  },
  {
    id: "BLV-2026-0468",
    reference: "BLV-2026-0468",
    name: "Bon de livraison — Teranga Import Services",
    type: "delivery",
    status: "received",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    owner: "Aïssatou Bâ",
    source: "internal",
    format: "PDF",
    receivedDate: "02 juin 2026",
    notes: [],
  },

  // — Baobab Trading · EFT-2026-0461 / DD-2026-0461 (mainlevée) —
  {
    id: "BAE-2026-0183",
    reference: "BAE-2026-0183",
    name: "Bon à enlever (BAE) — Baobab Trading",
    type: "bae",
    status: "validated",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0461",
    relatedCustomsFile: "DD-2026-0461",
    owner: "Bineta Diagne",
    source: "customs",
    format: "PDF",
    issueDate: "24 mai 2026",
    receivedDate: "24 mai 2026",
    notes: [],
  },
  {
    id: "ASSU-2026-0077",
    reference: "ASSU-2026-0077",
    name: "Assurance transport — Baobab Trading",
    type: "insurance",
    status: "received",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0461",
    relatedCustomsFile: "DD-2026-0461",
    owner: "Cheikh Fall",
    source: "internal",
    format: "PDF",
    issueDate: "16 mai 2026",
    receivedDate: "16 mai 2026",
    expiryDate: "31 déc. 2026",
    notes: [],
  },

  // — Administrative / customer-level documents —
  {
    id: "ATF-SM-2025",
    reference: "ATF-SM-2025",
    name: "Attestation fiscale — SenMatériaux SARL",
    type: "tax",
    status: "expired",
    customer: "SenMatériaux SARL",
    owner: "Fatou Sarr",
    source: "client",
    format: "PDF",
    issueDate: "01 juin 2025",
    receivedDate: "03 juin 2025",
    expiryDate: "31 mai 2026",
    notes: [
      {
        author: "Fatou Sarr",
        time: "Hier 16:50",
        text: "Attestation expirée — bloquante pour le prochain dédouanement. À renouveler avant tout nouveau dépôt.",
      },
    ],
  },
  {
    id: "LDM-WAMS-2026",
    reference: "LDM-WAMS-2026",
    name: "Lettre de mandat — West Africa Medical Supply",
    type: "mandate",
    status: "missing",
    customer: "West Africa Medical Supply",
    owner: "Moussa Diop",
    source: "client",
    format: "PDF",
    notes: [
      {
        author: "Moussa Diop",
        time: "Aujourd'hui 09:30",
        text: "Onboarding — mandat de dédouanement à signer avant le premier dossier.",
      },
    ],
  },
  {
    id: "AUTI-WAMS-2026",
    reference: "AUTI-WAMS-2026",
    name: "Autorisation d'importation (DPM) — West Africa Medical Supply",
    type: "import_auth",
    status: "missing",
    customer: "West Africa Medical Supply",
    owner: "Moussa Diop",
    source: "customs",
    format: "PDF",
    notes: [],
  },
  {
    id: "ATF-TC-2025",
    reference: "ATF-TC-2025",
    name: "Attestation fiscale — Touba Construction",
    type: "tax",
    status: "expiring",
    customer: "Touba Construction",
    owner: "Ibrahima Gueye",
    source: "client",
    format: "PDF",
    issueDate: "01 juil. 2025",
    receivedDate: "05 juil. 2025",
    expiryDate: "30 juin 2026",
    notes: [
      {
        author: "Ibrahima Gueye",
        time: "20 mars 2026",
        text: "À actualiser avant toute réactivation du compte.",
      },
    ],
  },
  {
    id: "ATF-CFE-2026",
    reference: "ATF-CFE-2026",
    name: "Attestation fiscale — Casamance Fruits Export",
    type: "tax",
    status: "expiring",
    customer: "Casamance Fruits Export",
    owner: "Cheikh Fall",
    source: "client",
    format: "PDF",
    issueDate: "01 juil. 2025",
    receivedDate: "02 juil. 2025",
    expiryDate: "28 juin 2026",
    notes: [],
  },
  {
    id: "NINEA-DAE-2026",
    reference: "0052418 2A7",
    name: "NINEA — Dakar Agro Export",
    type: "ninea",
    status: "validated",
    customer: "Dakar Agro Export",
    owner: "Awa Ndiaye",
    source: "client",
    format: "PDF",
    receivedDate: "12 jan. 2026",
    notes: [],
  },
  {
    id: "INV-2026-0399",
    reference: "INV-2026-0399",
    name: "Facture commerciale — Sahel Distribution",
    type: "invoice",
    status: "rejected",
    customer: "Sahel Distribution",
    owner: "Awa Ndiaye",
    source: "client",
    format: "PDF",
    issueDate: "20 mai 2026",
    receivedDate: "22 mai 2026",
    notes: [
      {
        author: "Awa Ndiaye",
        time: "23 mai 2026",
        text: "Montant total incohérent avec le détail des lignes. Renvoyée au client pour correction.",
      },
    ],
  },
];
