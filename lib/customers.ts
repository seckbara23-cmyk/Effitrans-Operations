import type { CustomerStatus } from "./status";
import { shipments, type ShipmentRecord } from "./shipments";
import {
  customsFiles,
  missingDocsCount as customsMissingDocs,
  type CustomsRecord,
} from "./customs";
import type { DocStatus } from "./shipments";

/* ----------------------------------------------------------------------------
 * Mock dataset for the Customers (Clients) module — operational directory for a
 * Dakar logistics company and licensed customs broker. Company names are shared
 * with the Shipments and Customs modules so open files can be derived live.
 * Static only — no backend, no persistence.
 * ------------------------------------------------------------------------- */

export const SECTORS = [
  "Agro-export",
  "Construction",
  "Pharmaceutique",
  "Équipement industriel",
  "Distribution",
  "Textile",
  "FMCG",
  "Automobile",
] as const;
export type Sector = (typeof SECTORS)[number];

export const CUSTOMER_TYPES = [
  "Importateur",
  "Exportateur",
  "Importateur & Exportateur",
  "Transit régulier",
  "Compte stratégique",
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type ContactChannel = "Téléphone" | "Email" | "WhatsApp";

export type CustomerContact = {
  name: string;
  role: string;
  phone: string;
  email: string;
  channel: ContactChannel;
  primary?: boolean;
};

export type CustomerDocType =
  | "ninea"
  | "rccm"
  | "tax"
  | "authorization"
  | "trade";

export type CustomerDocument = {
  type: CustomerDocType;
  label: string;
  status: DocStatus;
  ref?: string;
  date?: string;
};

export type CustomerNoteCategory = "operational" | "preference" | "reminder";

export type CustomerNote = {
  category: CustomerNoteCategory;
  author: string;
  time: string;
  text: string;
};

export type CustomerRecord = {
  /** Slug — also the route id. */
  id: string;
  /** Display / trade name (matches `customer` field in shipments & customs). */
  name: string;
  legalName: string;
  tradeName: string;
  ninea: string;
  rccm: string;
  sector: Sector;
  type: CustomerType;
  status: CustomerStatus;
  accountManager: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  since: string;
  contacts: CustomerContact[];
  documents: CustomerDocument[];
  notes: CustomerNote[];
};

/* ---- Note categories ----------------------------------------------------- */

export const noteCategoryMeta: Record<
  CustomerNoteCategory,
  { label: string; tone: "navy" | "teal" | "amber" }
> = {
  operational: { label: "Opérationnel", tone: "navy" },
  preference: { label: "Préférence", tone: "teal" },
  reminder: { label: "Rappel", tone: "amber" },
};

/* ---- Helpers ------------------------------------------------------------- */

export function getCustomer(id: string): CustomerRecord | undefined {
  return customers.find((c) => c.id === id);
}

export function getCustomerByName(name: string): CustomerRecord | undefined {
  return customers.find((c) => c.name === name);
}

/** Route to a customer's detail page from a shared company name, if known. */
export function customerHref(name: string): string | undefined {
  const c = getCustomerByName(name);
  return c ? `/customers/${c.id}` : undefined;
}

export function primaryContact(c: CustomerRecord): CustomerContact {
  return c.contacts.find((ct) => ct.primary) ?? c.contacts[0];
}

/** Open (non-delivered) shipments for a customer. */
export function openShipmentsFor(name: string): ShipmentRecord[] {
  return shipments.filter((s) => s.customer === name && s.status !== "delivered");
}

/** Open (non-closed) customs files for a customer. */
export function openCustomsFor(name: string): CustomsRecord[] {
  return customsFiles.filter((f) => f.customer === name && f.status !== "cloture");
}

export function customerMissingDocsCount(c: CustomerRecord): number {
  return c.documents.filter((d) => d.status === "missing").length;
}

/** Open files flagged as late: delayed shipments + blocked customs files. */
export function lateFilesFor(name: string): number {
  const lateShip = openShipmentsFor(name).filter(
    (s) => s.status === "delayed",
  ).length;
  const lateCustoms = openCustomsFor(name).filter(
    (f) => f.status === "bloque",
  ).length;
  return lateShip + lateCustoms;
}

export { customsMissingDocs };

/* ---- Data ---------------------------------------------------------------- */

export const customers: CustomerRecord[] = [
  {
    id: "dakar-agro-export",
    name: "Dakar Agro Export",
    legalName: "Dakar Agro Export SA",
    tradeName: "Dakar Agro Export",
    ninea: "0052418 2A7",
    rccm: "SN-DKR-2016-B-08421",
    sector: "Agro-export",
    type: "Compte stratégique",
    status: "active",
    accountManager: "Awa Ndiaye",
    city: "Dakar",
    address: "Zone industrielle, Km 9 Route de Rufisque",
    phone: "+221 33 839 12 40",
    email: "contact@dakaragro.sn",
    since: "Client depuis 2016",
    contacts: [
      {
        name: "Mariama Diallo",
        role: "Directrice des achats",
        phone: "+221 77 512 34 21",
        email: "m.diallo@dakaragro.sn",
        channel: "Téléphone",
        primary: true,
      },
      {
        name: "Abdou Sarr",
        role: "Responsable logistique",
        phone: "+221 76 220 11 08",
        email: "a.sarr@dakaragro.sn",
        channel: "WhatsApp",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0052418 2A7" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-DKR-2016-B-08421",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Renouvelée le 12 jan. 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "operational",
        author: "Awa Ndiaye",
        time: "02 juin 2026",
        text: "Compte stratégique — volumes agro réguliers via le Port de Dakar. Privilégier la déclaration anticipée pour limiter les surestaries.",
      },
      {
        category: "reminder",
        author: "Awa Ndiaye",
        time: "28 mai 2026",
        text: "Joindre systématiquement le certificat phytosanitaire pour les expéditions de matériel et intrants agricoles.",
      },
    ],
  },
  {
    id: "senmateriaux-sarl",
    name: "SenMatériaux SARL",
    legalName: "SenMatériaux SARL",
    tradeName: "SenMatériaux",
    ninea: "0061205 5C2",
    rccm: "SN-RUF-2018-B-03310",
    sector: "Construction",
    type: "Importateur",
    status: "active",
    accountManager: "Fatou Sarr",
    city: "Rufisque",
    address: "Quartier Keury Souf, Rufisque",
    phone: "+221 33 836 55 02",
    email: "info@senmateriaux.sn",
    since: "Client depuis 2018",
    contacts: [
      {
        name: "Cheikh Diouf",
        role: "Gérant",
        phone: "+221 77 644 90 15",
        email: "c.diouf@senmateriaux.sn",
        channel: "Téléphone",
        primary: true,
      },
      {
        name: "Ndèye Gueye",
        role: "Comptable",
        phone: "+221 76 118 70 33",
        email: "compta@senmateriaux.sn",
        channel: "Email",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0061205 5C2" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-RUF-2018-B-03310",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "pending",
        date: "À renouveler — expirée le 31 mai 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Renouvelée le 03 fév. 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "missing",
      },
    ],
    notes: [
      {
        category: "reminder",
        author: "Fatou Sarr",
        time: "Hier 16:50",
        text: "Attestation fiscale expirée — bloquante pour le prochain dédouanement. Relancer le client avant tout nouveau dépôt.",
      },
      {
        category: "operational",
        author: "Fatou Sarr",
        time: "30 mai 2026",
        text: "Documents fournisseurs souvent transmis en retard. Surveiller le risque de surestaries au Port de Dakar.",
      },
    ],
  },
  {
    id: "baobab-trading",
    name: "Baobab Trading",
    legalName: "Baobab Trading SUARL",
    tradeName: "Baobab Trading",
    ninea: "0048930 1B9",
    rccm: "SN-DKR-2015-B-06677",
    sector: "Distribution",
    type: "Transit régulier",
    status: "active",
    accountManager: "Cheikh Fall",
    city: "Dakar",
    address: "Avenue Léopold Sédar Senghor, Plateau, Dakar",
    phone: "+221 33 821 44 76",
    email: "ops@baobabtrading.sn",
    since: "Client depuis 2015",
    contacts: [
      {
        name: "Ousmane Ba",
        role: "Directeur commercial",
        phone: "+221 77 333 21 09",
        email: "o.ba@baobabtrading.sn",
        channel: "WhatsApp",
        primary: true,
      },
      {
        name: "Sokhna Mbaye",
        role: "Assistante import",
        phone: "+221 76 900 54 12",
        email: "import@baobabtrading.sn",
        channel: "Email",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0048930 1B9" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-DKR-2015-B-06677",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Permanente — renouvelée le 08 jan. 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "preference",
        author: "Cheikh Fall",
        time: "01 juin 2026",
        text: "Client en transit régulier — préfère les mises à jour par WhatsApp et un point hebdomadaire le lundi.",
      },
      {
        category: "operational",
        author: "Cheikh Fall",
        time: "29 mai 2026",
        text: "Marchandises diversifiées (textile, pièces auto, électronique). Bien vérifier les positions tarifaires à chaque dossier.",
      },
    ],
  },
  {
    id: "atlantic-pharma",
    name: "Atlantic Pharma",
    legalName: "Atlantic Pharma SA",
    tradeName: "Atlantic Pharma",
    ninea: "0070112 3D4",
    rccm: "SN-DKR-2017-B-09120",
    sector: "Pharmaceutique",
    type: "Compte stratégique",
    status: "active",
    accountManager: "Moussa Diop",
    city: "Dakar",
    address: "Mermoz Pyrotechnie, Dakar",
    phone: "+221 33 869 30 18",
    email: "supply@atlanticpharma.sn",
    since: "Client depuis 2017",
    contacts: [
      {
        name: "Dr. Fatou Ndoye",
        role: "Pharmacienne responsable",
        phone: "+221 77 401 65 88",
        email: "f.ndoye@atlanticpharma.sn",
        channel: "Email",
        primary: true,
      },
      {
        name: "Lamine Faye",
        role: "Responsable supply chain",
        phone: "+221 76 230 09 47",
        email: "l.faye@atlanticpharma.sn",
        channel: "WhatsApp",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0070112 3D4" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-DKR-2017-B-09120",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Autorisation d'importation (DPM)",
        status: "received",
        date: "Renouvelée le 15 jan. 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "operational",
        author: "Moussa Diop",
        time: "Aujourd'hui 11:25",
        text: "Produits sous chaîne du froid et dispositifs médicaux. Prioriser le dédouanement aérien à l'AIBD pour préserver la température dirigée.",
      },
      {
        category: "reminder",
        author: "Moussa Diop",
        time: "31 mai 2026",
        text: "Vérifier l'autorisation DPM et le certificat d'origine pour chaque importation de produits de santé.",
      },
    ],
  },
  {
    id: "teranga-import-services",
    name: "Teranga Import Services",
    legalName: "Teranga Import Services SARL",
    tradeName: "Teranga Import Services",
    ninea: "0039587 4E1",
    rccm: "SN-THS-2019-B-02245",
    sector: "FMCG",
    type: "Importateur & Exportateur",
    status: "active",
    accountManager: "Aïssatou Bâ",
    city: "Thiès",
    address: "Quartier Randoulène Nord, Thiès",
    phone: "+221 33 951 22 60",
    email: "contact@terangaimport.sn",
    since: "Client depuis 2019",
    contacts: [
      {
        name: "Awa Faye",
        role: "Gérante",
        phone: "+221 77 778 12 34",
        email: "a.faye@terangaimport.sn",
        channel: "Téléphone",
        primary: true,
      },
      {
        name: "Pape Samb",
        role: "Responsable approvisionnement",
        phone: "+221 76 442 88 21",
        email: "achats@terangaimport.sn",
        channel: "WhatsApp",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0039587 4E1" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-THS-2019-B-02245",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Renouvelée le 20 fév. 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "pending",
        date: "Mise à jour annuelle en cours",
      },
    ],
    notes: [
      {
        category: "preference",
        author: "Aïssatou Bâ",
        time: "Aujourd'hui 07:55",
        text: "Livraisons à organiser vers Thiès — prévoir le créneau client la veille. Contact privilégié : Awa Faye.",
      },
    ],
  },
  {
    id: "afrique-equipements",
    name: "Afrique Equipements",
    legalName: "Afrique Équipements SA",
    tradeName: "Afrique Équipements",
    ninea: "0083401 6F8",
    rccm: "SN-DKR-2020-B-11034",
    sector: "Équipement industriel",
    type: "Importateur",
    status: "active",
    accountManager: "Ibrahima Gueye",
    city: "Diamniadio",
    address: "Pôle industriel de Diamniadio",
    phone: "+221 33 877 41 09",
    email: "contact@afrique-equipements.sn",
    since: "Client depuis 2020",
    contacts: [
      {
        name: "Modou Kane",
        role: "Directeur technique",
        phone: "+221 77 902 33 71",
        email: "m.kane@afrique-equipements.sn",
        channel: "Téléphone",
        primary: true,
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0083401 6F8" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-DKR-2020-B-11034",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "pending",
        date: "Renouvellement demandé",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "operational",
        author: "Ibrahima Gueye",
        time: "27 mai 2026",
        text: "Importations d'équipements lourds et machines-outils. Prévoir transport spécialisé depuis le Port de Dakar vers Diamniadio.",
      },
    ],
  },
  {
    id: "sahel-distribution",
    name: "Sahel Distribution",
    legalName: "Sahel Distribution SARL",
    tradeName: "Sahel Distribution",
    ninea: "0091277 7G3",
    rccm: "SN-KLK-2018-B-04412",
    sector: "Distribution",
    type: "Importateur & Exportateur",
    status: "active",
    accountManager: "Awa Ndiaye",
    city: "Kaolack",
    address: "Avenue Cheikh Ibra Fall, Kaolack",
    phone: "+221 33 941 18 25",
    email: "info@saheldistribution.sn",
    since: "Client depuis 2021",
    contacts: [
      {
        name: "Bineta Sow",
        role: "Responsable approvisionnement",
        phone: "+221 77 215 60 44",
        email: "b.sow@saheldistribution.sn",
        channel: "WhatsApp",
        primary: true,
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0091277 7G3" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-KLK-2018-B-04412",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Renouvelée le 10 mars 2026",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "operational",
        author: "Awa Ndiaye",
        time: "22 mai 2026",
        text: "Distribution régionale (bassin arachidier). Regrouper les expéditions pour optimiser les coûts vers Kaolack.",
      },
    ],
  },
  {
    id: "casamance-fruits-export",
    name: "Casamance Fruits Export",
    legalName: "Casamance Fruits Export SUARL",
    tradeName: "Casamance Fruits",
    ninea: "0102998 8H5",
    rccm: "SN-MBR-2021-B-00781",
    sector: "Agro-export",
    type: "Exportateur",
    status: "active",
    accountManager: "Cheikh Fall",
    city: "Mbour",
    address: "Route de Saly, Mbour",
    phone: "+221 33 957 03 88",
    email: "export@casamancefruits.sn",
    since: "Client depuis 2022",
    contacts: [
      {
        name: "Ibrahima Sané",
        role: "Gérant",
        phone: "+221 77 660 47 90",
        email: "i.sane@casamancefruits.sn",
        channel: "Téléphone",
        primary: true,
      },
      {
        name: "Aminata Coly",
        role: "Responsable qualité export",
        phone: "+221 76 305 22 18",
        email: "qualite@casamancefruits.sn",
        channel: "Email",
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0102998 8H5" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-MBR-2021-B-00781",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "received",
        date: "Valide jusqu'au 31 déc. 2026",
      },
      {
        type: "authorization",
        label: "Agrément exportateur",
        status: "received",
        date: "Renouvelé le 05 fév. 2026",
      },
      {
        type: "trade",
        label: "Certificat phytosanitaire / documents export",
        status: "pending",
        date: "Délivré par campagne d'export",
      },
    ],
    notes: [
      {
        category: "operational",
        author: "Cheikh Fall",
        time: "18 mai 2026",
        text: "Exportateur de fruits — flux saisonnier (mangues). Certificat phytosanitaire et chaîne du froid indispensables à chaque envoi.",
      },
      {
        category: "preference",
        author: "Cheikh Fall",
        time: "15 mai 2026",
        text: "Préparer les dossiers export en amont de la campagne pour absorber les pics de volume.",
      },
    ],
  },
  {
    id: "west-africa-medical-supply",
    name: "West Africa Medical Supply",
    legalName: "West Africa Medical Supply SA",
    tradeName: "WA Medical Supply",
    ninea: "0114663 9J2",
    rccm: "SN-DKR-2024-B-13559",
    sector: "Pharmaceutique",
    type: "Importateur",
    status: "prospect",
    accountManager: "Moussa Diop",
    city: "Dakar",
    address: "Rue Carnot, Plateau, Dakar",
    phone: "+221 33 823 77 12",
    email: "hello@wamedicalsupply.sn",
    since: "En cours d'ouverture de compte",
    contacts: [
      {
        name: "Aïda Cissé",
        role: "Directrice",
        phone: "+221 77 188 25 63",
        email: "a.cisse@wamedicalsupply.sn",
        channel: "Email",
        primary: true,
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0114663 9J2" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-DKR-2024-B-13559",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "pending",
        date: "Demandée — en attente du client",
      },
      {
        type: "authorization",
        label: "Autorisation d'importation (DPM)",
        status: "missing",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "missing",
      },
    ],
    notes: [
      {
        category: "reminder",
        author: "Moussa Diop",
        time: "Aujourd'hui 09:30",
        text: "Prospect en cours d'onboarding. Dossier KYC incomplet : autorisation DPM et documents import à obtenir avant le premier dédouanement.",
      },
      {
        category: "operational",
        author: "Moussa Diop",
        time: "26 mai 2026",
        text: "Première importation envisagée pour juillet 2026 (consommables médicaux). Cadrer le régime douanier applicable.",
      },
    ],
  },
  {
    id: "touba-construction",
    name: "Touba Construction",
    legalName: "Touba Construction SARL",
    tradeName: "Touba Construction",
    ninea: "0127540 0K6",
    rccm: "SN-TBA-2017-B-05590",
    sector: "Construction",
    type: "Importateur",
    status: "inactive",
    accountManager: "Ibrahima Gueye",
    city: "Touba",
    address: "Darou Khoudoss, Touba",
    phone: "+221 33 976 40 51",
    email: "contact@toubaconstruction.sn",
    since: "Client depuis 2017 · inactif depuis mars 2026",
    contacts: [
      {
        name: "Serigne Fallou Mbacké",
        role: "Gérant",
        phone: "+221 77 509 13 27",
        email: "s.mbacke@toubaconstruction.sn",
        channel: "Téléphone",
        primary: true,
      },
    ],
    documents: [
      { type: "ninea", label: "NINEA", status: "received", ref: "0127540 0K6" },
      {
        type: "rccm",
        label: "RCCM",
        status: "received",
        ref: "SN-TBA-2017-B-05590",
      },
      {
        type: "tax",
        label: "Attestation fiscale (quitus)",
        status: "pending",
        date: "À actualiser avant réactivation",
      },
      {
        type: "authorization",
        label: "Lettre de mandat (dédouanement)",
        status: "received",
        date: "Expirée — à renouveler",
      },
      {
        type: "trade",
        label: "Documents import/export",
        status: "received",
      },
    ],
    notes: [
      {
        category: "reminder",
        author: "Ibrahima Gueye",
        time: "20 mars 2026",
        text: "Compte inactif depuis mars 2026 (aucun nouveau dossier). Recontacter pour réactivation et mise à jour des pièces administratives.",
      },
    ],
  },
];
