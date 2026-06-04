import type { CustomsStatus, Priority, Tone } from "./status";
import { docStatusMeta, type DocStatus } from "./shipments";

/* ----------------------------------------------------------------------------
 * Mock dataset for the Customs Clearance (Dédouanement) module. Files reference
 * the same customers and shipment references as the Shipments module so a
 * customs dossier maps back to a real expédition. Senegal / Port Autonome de
 * Dakar context. Static only — no backend, no persistence.
 * ------------------------------------------------------------------------- */

export { docStatusMeta };
export type { DocStatus };

/** Customs offices (bureaux de douane) covered by the brokerage. */
export const CUSTOMS_OFFICES = [
  "Bureau Dakar Port Nord",
  "Bureau Dakar Port Sud",
  "Bureau Aéroport",
  "Bureau Frontière",
] as const;
export type CustomsOffice = (typeof CUSTOMS_OFFICES)[number];

/** Physical site where the goods are held. */
export type CustomsSite =
  | "Port Autonome de Dakar"
  | "AIBD Cargo"
  | "Terminal frontalier — Rosso";

export type CustomsDocType =
  | "invoice"
  | "packing"
  | "transport"
  | "origin"
  | "authorization"
  | "declaration";

export type CustomsDocument = {
  type: CustomsDocType;
  label: string;
  status: DocStatus;
  ref?: string;
  date?: string;
  /** Pièce conditionnelle (selon la nature de la marchandise). */
  optional?: boolean;
};

export type CustomsMilestoneKey =
  | "received"
  | "docs_verified"
  | "declaration_prepared"
  | "declaration_lodged"
  | "liquidation"
  | "payment"
  | "bae"
  | "release";

export type Duties = {
  /** Droits de douane */
  droitsDouane: number;
  /** TVA (18 %) */
  tva: number;
  /** Redevances (COSEC, redevance statistique, PCS…) */
  redevances: number;
  /** Frais portuaires / magasinage (PAD) */
  fraisPortuaires: number;
};

export type BlockingIssueType =
  | "missing_docs"
  | "inspection"
  | "payment_pending"
  | "client_validation";

export type BlockingIssue = {
  type: BlockingIssueType;
  label: string;
  detail: string;
  /** "red" = bloquant, "amber" = à surveiller. */
  severity: Extract<Tone, "red" | "amber">;
};

export type CustomsNote = {
  author: string;
  time: string;
  text: string;
};

export type CustomsRecord = {
  /** Customs file reference — also the route id. */
  reference: string;
  customer: string;
  /** Linked shipment reference (Shipments module). */
  relatedShipment: string;
  /** True when the related shipment still exists in the live dataset. */
  relatedShipmentArchived?: boolean;
  office: CustomsOffice;
  site: CustomsSite;
  declarationNumber: string;
  declarationType: "DDU" | "DDM";
  regime: string;
  baeRef?: string;
  status: CustomsStatus;
  /** Agent douane / déclarant en charge du dossier. */
  officer: string;
  priority: Priority;
  goods: string;
  lastUpdate: string;
  milestoneDates: Partial<Record<CustomsMilestoneKey, string>>;
  documents: CustomsDocument[];
  duties: Duties;
  blockingIssues: BlockingIssue[];
  notes: CustomsNote[];
};

/* ---- Timeline model ------------------------------------------------------ */

export const CUSTOMS_MILESTONES: { key: CustomsMilestoneKey; label: string }[] =
  [
    { key: "received", label: "Dossier reçu" },
    { key: "docs_verified", label: "Documents vérifiés" },
    { key: "declaration_prepared", label: "Déclaration préparée" },
    { key: "declaration_lodged", label: "Déclaration déposée" },
    { key: "liquidation", label: "Liquidation" },
    { key: "payment", label: "Paiement droits/taxes" },
    { key: "bae", label: "BAE obtenu" },
    { key: "release", label: "Mainlevée / livraison" },
  ];

/** Number of fully-completed milestones for each status. */
const COMPLETED_BY_STATUS: Record<CustomsStatus, number> = {
  nouveau: 1,
  docs_a_completer: 1,
  verif_doc: 1,
  decl_preparee: 3,
  decl_deposee: 4,
  en_liquidation: 4,
  paiement_attente: 5,
  bae_obtenu: 7,
  mainlevee: 8,
  bloque: 4,
  cloture: 8,
};

/** Current milestone shown with a warning (amber) tone. */
const AMBER_EXCEPTION: CustomsStatus[] = ["docs_a_completer", "paiement_attente"];
/** Current milestone shown with a blocking (red) tone. */
const RED_EXCEPTION: CustomsStatus[] = ["bloque"];

export type CustomsTimelineStep = {
  key: CustomsMilestoneKey;
  label: string;
  state: "done" | "current" | "upcoming";
  tone: Tone;
  date?: string;
};

export function buildCustomsTimeline(file: CustomsRecord): CustomsTimelineStep[] {
  const completed = COMPLETED_BY_STATUS[file.status];
  const amber = AMBER_EXCEPTION.includes(file.status);
  const red = RED_EXCEPTION.includes(file.status);

  return CUSTOMS_MILESTONES.map((m, i) => {
    let state: CustomsTimelineStep["state"];
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

    return { ...m, state, tone, date: file.milestoneDates[m.key] };
  });
}

/* ---- Blocking issues ----------------------------------------------------- */

export const blockingIssueMeta: Record<
  BlockingIssueType,
  { label: string }
> = {
  missing_docs: { label: "Documents manquants" },
  inspection: { label: "Visite douanière" },
  payment_pending: { label: "Paiement des droits/taxes" },
  client_validation: { label: "Validation client" },
};

/* ---- Helpers ------------------------------------------------------------- */

export function getCustomsFile(reference: string): CustomsRecord | undefined {
  return customsFiles.find((f) => f.reference === reference);
}

export function missingDocsCount(file: CustomsRecord): number {
  return file.documents.filter((d) => d.status === "missing").length;
}

export function dutiesTotal(d: Duties): number {
  return d.droitsDouane + d.tva + d.redevances + d.fraisPortuaires;
}

export function formatFCFA(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/* ---- Data ---------------------------------------------------------------- */

const PORT: CustomsSite = "Port Autonome de Dakar";
const AIBD: CustomsSite = "AIBD Cargo";
const ROSSO: CustomsSite = "Terminal frontalier — Rosso";

export const customsFiles: CustomsRecord[] = [
  {
    reference: "DD-2026-0488",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0488",
    office: "Bureau Dakar Port Nord",
    site: PORT,
    declarationNumber: "—",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "nouveau",
    officer: "Ousmane Ndour",
    priority: "medium",
    goods: "Équipements électroménagers",
    lastUpdate: "Aujourd'hui 08:50",
    milestoneDates: { received: "04 juin 2026" },
    documents: [
      { type: "invoice", label: "Facture commerciale", status: "pending" },
      { type: "packing", label: "Liste de colisage", status: "pending" },
      { type: "transport", label: "Connaissement (B/L)", status: "pending" },
      { type: "origin", label: "Certificat d'origine", status: "pending" },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "pending",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    duties: {
      droitsDouane: 5_000_000,
      tva: 5_400_000,
      redevances: 320_000,
      fraisPortuaires: 950_000,
    },
    blockingIssues: [
      {
        type: "missing_docs",
        label: "Documents d'expédition attendus",
        detail:
          "Facture, colisage et B/L non encore transmis par le fournisseur.",
        severity: "amber",
      },
    ],
    notes: [
      {
        author: "Ousmane Ndour",
        time: "Aujourd'hui 08:50",
        text: "Dossier de dédouanement ouvert à réception de l'expédition. En attente des documents pour préparer la DDU.",
      },
    ],
  },
  {
    reference: "DD-2026-0485",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0485",
    office: "Bureau Aéroport",
    site: AIBD,
    declarationNumber: "—",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "verif_doc",
    officer: "Khadija Bâ",
    priority: "high",
    goods: "Produits pharmaceutiques (chaîne du froid)",
    lastUpdate: "Aujourd'hui 10:20",
    milestoneDates: { received: "02 juin 2026" },
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-AP-118",
        date: "03 juin",
      },
      {
        type: "authorization",
        label: "Autorisation d'importation (DPM)",
        status: "pending",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    duties: {
      droitsDouane: 600_000,
      tva: 2_150_000,
      redevances: 150_000,
      fraisPortuaires: 280_000,
    },
    blockingIssues: [
      {
        type: "missing_docs",
        label: "Liste de colisage manquante",
        detail: "Relance client en cours pour finaliser la vérification.",
        severity: "amber",
      },
    ],
    notes: [
      {
        author: "Khadija Bâ",
        time: "Aujourd'hui 10:20",
        text: "Vérification documentaire en cours. Autorisation DPM requise (produits de santé) avant dépôt de la déclaration. Priorité chaîne du froid.",
      },
    ],
  },
  {
    reference: "DD-2026-0483",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0483",
    office: "Bureau Dakar Port Sud",
    site: PORT,
    declarationNumber: "DDU-2026-10488 (brouillon)",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "decl_preparee",
    officer: "Mamadou Sow",
    priority: "medium",
    goods: "Pièces détachées automobiles",
    lastUpdate: "Hier 17:35",
    milestoneDates: {
      received: "28 mai 2026",
      docs_verified: "31 mai 2026",
      declaration_prepared: "03 juin 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-BT-204",
        date: "31 mai",
      },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "received",
        date: "31 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    duties: {
      droitsDouane: 3_600_000,
      tva: 3_880_000,
      redevances: 230_000,
      fraisPortuaires: 720_000,
    },
    blockingIssues: [],
    notes: [
      {
        author: "Mamadou Sow",
        time: "Hier 17:35",
        text: "Déclaration anticipée préparée sur la base des documents reçus. Dépôt prévu à l'arrivée du navire (ETA 12 juin).",
      },
    ],
  },
  {
    reference: "DD-2026-0481",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0481",
    office: "Bureau Dakar Port Nord",
    site: PORT,
    declarationNumber: "DDU-2026-10481",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "decl_deposee",
    officer: "Bineta Diagne",
    priority: "medium",
    goods: "Matériel d'irrigation agricole",
    lastUpdate: "Aujourd'hui 09:10",
    milestoneDates: {
      received: "25 mai 2026",
      docs_verified: "29 mai 2026",
      declaration_prepared: "01 juin 2026",
      declaration_lodged: "03 juin 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-DAE-330",
        date: "29 mai",
      },
      {
        type: "authorization",
        label: "Certificat phytosanitaire",
        status: "pending",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10481",
        date: "03 juin",
      },
    ],
    duties: {
      droitsDouane: 800_000,
      tva: 2_900_000,
      redevances: 200_000,
      fraisPortuaires: 680_000,
    },
    blockingIssues: [
      {
        type: "missing_docs",
        label: "Certificat phytosanitaire",
        detail:
          "À joindre avant la visite. Demandé au service de la protection des végétaux.",
        severity: "amber",
      },
    ],
    notes: [
      {
        author: "Bineta Diagne",
        time: "Aujourd'hui 09:10",
        text: "Déclaration déposée via GAINDE. En attente d'affectation du circuit (vert/orange/rouge) et du certificat phytosanitaire.",
      },
    ],
  },
  {
    reference: "DD-2026-0479",
    customer: "Atlantic Pharma",
    relatedShipment: "EFT-2026-0479",
    office: "Bureau Aéroport",
    site: AIBD,
    declarationNumber: "DDU-2026-10455",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "bloque",
    officer: "Khadija Bâ",
    priority: "high",
    goods: "Dispositifs médicaux",
    lastUpdate: "Aujourd'hui 11:25",
    milestoneDates: {
      received: "30 mai 2026",
      docs_verified: "01 juin 2026",
      declaration_prepared: "02 juin 2026",
      declaration_lodged: "03 juin 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "missing",
      },
      {
        type: "authorization",
        label: "Autorisation d'importation (DPM)",
        status: "received",
        ref: "AUT-DPM-771",
        date: "02 juin",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10455",
        date: "03 juin",
      },
    ],
    duties: {
      droitsDouane: 450_000,
      tva: 1_620_000,
      redevances: 110_000,
      fraisPortuaires: 260_000,
    },
    blockingIssues: [
      {
        type: "inspection",
        label: "Circuit rouge — visite physique",
        detail:
          "Dossier orienté en visite. Inspecteur affecté : Insp. Mamadou Sow.",
        severity: "red",
      },
      {
        type: "missing_docs",
        label: "Certificat d'origine exigé",
        detail: "Réclamé par l'inspecteur pour lever le blocage.",
        severity: "red",
      },
    ],
    notes: [
      {
        author: "Khadija Bâ",
        time: "Aujourd'hui 11:25",
        text: "Déclaration déposée puis orientée circuit rouge. Visite douanière en cours, certificat d'origine demandé. Dossier bloqué jusqu'à régularisation.",
      },
    ],
  },
  {
    reference: "DD-2026-0476",
    customer: "SenMatériaux SARL",
    relatedShipment: "EFT-2026-0476",
    office: "Bureau Dakar Port Sud",
    site: PORT,
    declarationNumber: "—",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "docs_a_completer",
    officer: "Serigne Mbaye",
    priority: "high",
    goods: "Matériaux de construction (carrelage)",
    lastUpdate: "Hier 16:50",
    milestoneDates: {
      received: "24 mai 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "pending",
      },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "pending",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "pending",
      },
    ],
    duties: {
      droitsDouane: 4_400_000,
      tva: 4_750_000,
      redevances: 280_000,
      fraisPortuaires: 880_000,
    },
    blockingIssues: [
      {
        type: "missing_docs",
        label: "B/L original et liste de colisage",
        detail:
          "Non reçus du fournisseur. Déclaration impossible — risque de surestaries.",
        severity: "red",
      },
      {
        type: "client_validation",
        label: "Validation des frais de magasinage",
        detail: "En attente d'accord du client pour régler le magasinage PAD.",
        severity: "amber",
      },
    ],
    notes: [
      {
        author: "Serigne Mbaye",
        time: "Hier 16:50",
        text: "Conteneurs au port mais documents incomplets : B/L original et colisage manquants. Relance urgente fournisseur. Dossier en attente de pièces.",
      },
    ],
  },
  {
    reference: "DD-2026-0470",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0470",
    office: "Bureau Dakar Port Sud",
    site: PORT,
    declarationNumber: "DDU-2026-10318",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "en_liquidation",
    officer: "Mamadou Sow",
    priority: "medium",
    goods: "Textiles et confection",
    lastUpdate: "Aujourd'hui 09:40",
    milestoneDates: {
      received: "18 mai 2026",
      docs_verified: "21 mai 2026",
      declaration_prepared: "29 mai 2026",
      declaration_lodged: "31 mai 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-BT-188",
        date: "21 mai",
      },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "received",
        date: "21 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10318",
        date: "31 mai",
      },
    ],
    duties: {
      droitsDouane: 2_200_000,
      tva: 2_380_000,
      redevances: 140_000,
      fraisPortuaires: 520_000,
    },
    blockingIssues: [],
    notes: [
      {
        author: "Mamadou Sow",
        time: "Aujourd'hui 09:40",
        text: "Circuit vert. Liquidation des droits et taxes en cours auprès du bureau. Bulletin de liquidation attendu dans la journée.",
      },
    ],
  },
  {
    reference: "DD-2026-0465",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0465",
    office: "Bureau Frontière",
    site: ROSSO,
    declarationNumber: "DDU-2026-10260",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    status: "paiement_attente",
    officer: "Ndèye Fall",
    priority: "medium",
    goods: "Engrais agricoles",
    lastUpdate: "Hier 18:25",
    milestoneDates: {
      received: "19 mai 2026",
      docs_verified: "21 mai 2026",
      declaration_prepared: "27 mai 2026",
      declaration_lodged: "29 mai 2026",
      liquidation: "31 mai 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-DAE-301",
        date: "21 mai",
      },
      {
        type: "authorization",
        label: "Autorisation (engrais)",
        status: "received",
        date: "22 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10260",
        date: "29 mai",
      },
    ],
    duties: {
      droitsDouane: 400_000,
      tva: 1_500_000,
      redevances: 100_000,
      fraisPortuaires: 480_000,
    },
    blockingIssues: [
      {
        type: "payment_pending",
        label: "Paiement des droits et taxes",
        detail:
          "Bulletin de liquidation émis. En attente du virement client pour régler la quittance.",
        severity: "amber",
      },
    ],
    notes: [
      {
        author: "Ndèye Fall",
        time: "Hier 18:25",
        text: "Liquidation reçue. Quittance à régler pour obtenir le BAE. Client relancé pour le virement des droits et taxes.",
      },
    ],
  },
  {
    reference: "DD-2026-0468",
    customer: "Teranga Import Services",
    relatedShipment: "EFT-2026-0468",
    office: "Bureau Frontière",
    site: ROSSO,
    declarationNumber: "DDU-2026-10290",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    baeRef: "BAE-2026-04688",
    status: "bae_obtenu",
    officer: "Ndèye Fall",
    priority: "low",
    goods: "Produits cosmétiques",
    lastUpdate: "Aujourd'hui 07:58",
    milestoneDates: {
      received: "20 mai 2026",
      docs_verified: "22 mai 2026",
      declaration_prepared: "29 mai 2026",
      declaration_lodged: "31 mai 2026",
      liquidation: "31 mai 2026",
      payment: "01 juin 2026",
      bae: "01 juin 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-TIS-402",
        date: "22 mai",
      },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "received",
        date: "22 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10290",
        date: "31 mai",
      },
    ],
    duties: {
      droitsDouane: 2_000_000,
      tva: 2_160_000,
      redevances: 130_000,
      fraisPortuaires: 470_000,
    },
    blockingIssues: [],
    notes: [
      {
        author: "Ndèye Fall",
        time: "Aujourd'hui 07:58",
        text: "Droits et taxes réglés, Bon à enlever (BAE-2026-04688) obtenu. Marchandise enlevable, mainlevée en cours d'organisation.",
      },
    ],
  },
  {
    reference: "DD-2026-0461",
    customer: "Baobab Trading",
    relatedShipment: "EFT-2026-0461",
    office: "Bureau Aéroport",
    site: AIBD,
    declarationNumber: "DDU-2026-10180",
    declarationType: "DDU",
    regime: "Mise à la consommation",
    baeRef: "BAE-2026-04610",
    status: "mainlevee",
    officer: "Bineta Diagne",
    priority: "low",
    goods: "Électronique grand public",
    lastUpdate: "31 mai 16:45",
    milestoneDates: {
      received: "14 mai 2026",
      docs_verified: "16 mai 2026",
      declaration_prepared: "20 mai 2026",
      declaration_lodged: "22 mai 2026",
      liquidation: "22 mai 2026",
      payment: "23 mai 2026",
      bae: "24 mai 2026",
      release: "24 mai 2026",
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
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-BT-140",
        date: "16 mai",
      },
      {
        type: "authorization",
        label: "Attestation / autorisation",
        status: "received",
        date: "16 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDU)",
        status: "received",
        ref: "DDU-2026-10180",
        date: "22 mai",
      },
    ],
    duties: {
      droitsDouane: 1_900_000,
      tva: 2_050_000,
      redevances: 120_000,
      fraisPortuaires: 300_000,
    },
    blockingIssues: [],
    notes: [
      {
        author: "Bineta Diagne",
        time: "31 mai 16:45",
        text: "Mainlevée accordée et marchandise enlevée. Dossier douane soldé, transmis à la livraison.",
      },
    ],
  },
  {
    reference: "DD-2026-0444",
    customer: "Dakar Agro Export",
    relatedShipment: "EFT-2026-0444",
    relatedShipmentArchived: true,
    office: "Bureau Dakar Port Nord",
    site: PORT,
    declarationNumber: "DDU-2026-09980",
    declarationType: "DDM",
    regime: "Entrepôt fictif",
    baeRef: "BAE-2026-04440",
    status: "cloture",
    officer: "Ousmane Ndour",
    priority: "low",
    goods: "Riz importé (sacs 50 kg)",
    lastUpdate: "20 mai 11:30",
    milestoneDates: {
      received: "02 mai 2026",
      docs_verified: "05 mai 2026",
      declaration_prepared: "08 mai 2026",
      declaration_lodged: "10 mai 2026",
      liquidation: "11 mai 2026",
      payment: "13 mai 2026",
      bae: "14 mai 2026",
      release: "16 mai 2026",
    },
    documents: [
      {
        type: "invoice",
        label: "Facture commerciale",
        status: "received",
        ref: "FC-DAE-3120",
        date: "05 mai",
      },
      {
        type: "packing",
        label: "Liste de colisage",
        status: "received",
        date: "05 mai",
      },
      {
        type: "transport",
        label: "Connaissement (B/L)",
        status: "received",
        ref: "MSKU 410022-9",
        date: "04 mai",
      },
      {
        type: "origin",
        label: "Certificat d'origine",
        status: "received",
        ref: "CO-DAE-312",
        date: "05 mai",
      },
      {
        type: "authorization",
        label: "Autorisation (denrées)",
        status: "received",
        date: "06 mai",
        optional: true,
      },
      {
        type: "declaration",
        label: "Déclaration en douane (DDM)",
        status: "received",
        ref: "DDU-2026-09980",
        date: "10 mai",
      },
    ],
    duties: {
      droitsDouane: 2_600_000,
      tva: 2_800_000,
      redevances: 160_000,
      fraisPortuaires: 540_000,
    },
    blockingIssues: [],
    notes: [
      {
        author: "Ousmane Ndour",
        time: "20 mai 11:30",
        text: "Dossier soldé et archivé. BAE obtenu, mainlevée accordée et marchandise livrée. Expédition correspondante archivée.",
      },
    ],
  },
];
