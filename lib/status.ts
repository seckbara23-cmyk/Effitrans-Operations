/**
 * Operational status vocabulary. Each status maps to a French label and a
 * "tone" that the <Badge> component turns into colours. Logistics terms that
 * are commonly used in English on the floor (e.g. "BAE", mode codes) are kept
 * as-is.
 */
export type Tone =
  | "navy"
  | "teal"
  | "amber"
  | "red"
  | "green"
  | "slate"
  | "blue";

export type ShipmentStatus =
  | "new"
  | "docs_pending"
  | "in_transit"
  | "at_port"
  | "customs_pending"
  | "docs_missing"
  | "cleared"
  | "delivery_scheduled"
  | "delivered"
  | "delayed";

export const shipmentStatus: Record<
  ShipmentStatus,
  { label: string; tone: Tone }
> = {
  new: { label: "Nouveau dossier", tone: "slate" },
  docs_pending: { label: "Documents en attente", tone: "amber" },
  in_transit: { label: "En transit", tone: "navy" },
  at_port: { label: "Au port", tone: "blue" },
  customs_pending: { label: "Douane en attente", tone: "amber" },
  docs_missing: { label: "Documents manquants", tone: "red" },
  cleared: { label: "Dédouané", tone: "teal" },
  delivery_scheduled: { label: "Livraison planifiée", tone: "navy" },
  delivered: { label: "Livré", tone: "green" },
  delayed: { label: "En retard", tone: "red" },
};

/** Display order for filters / chips (operational flow, exception last). */
export const shipmentStatusOrder: ShipmentStatus[] = [
  "new",
  "docs_pending",
  "in_transit",
  "at_port",
  "customs_pending",
  "docs_missing",
  "cleared",
  "delivery_scheduled",
  "delivered",
  "delayed",
];

export type DeclarationStatus =
  | "draft"
  | "lodged"
  | "inspection"
  | "assessed"
  | "released";

export const declarationStatus: Record<
  DeclarationStatus,
  { label: string; tone: Tone }
> = {
  draft: { label: "Brouillon", tone: "slate" },
  lodged: { label: "Déclaration déposée", tone: "blue" },
  inspection: { label: "Visite douane", tone: "amber" },
  assessed: { label: "Liquidée", tone: "teal" },
  released: { label: "Bon à enlever (BAE)", tone: "green" },
};

export type CustomsStatus =
  | "nouveau"
  | "docs_a_completer"
  | "verif_doc"
  | "decl_preparee"
  | "decl_deposee"
  | "en_liquidation"
  | "paiement_attente"
  | "bae_obtenu"
  | "mainlevee"
  | "bloque"
  | "cloture";

export const customsStatus: Record<
  CustomsStatus,
  { label: string; tone: Tone }
> = {
  nouveau: { label: "Nouveau dossier", tone: "slate" },
  docs_a_completer: { label: "Documents à compléter", tone: "amber" },
  verif_doc: { label: "Vérification documentaire", tone: "blue" },
  decl_preparee: { label: "Déclaration préparée", tone: "navy" },
  decl_deposee: { label: "Déclaration déposée", tone: "blue" },
  en_liquidation: { label: "En liquidation", tone: "navy" },
  paiement_attente: { label: "Paiement en attente", tone: "amber" },
  bae_obtenu: { label: "BAE obtenu", tone: "teal" },
  mainlevee: { label: "Mainlevée accordée", tone: "green" },
  bloque: { label: "Bloqué", tone: "red" },
  cloture: { label: "Clôturé", tone: "slate" },
};

/** Display order for filters / chips (operational flow, exceptions near end). */
export const customsStatusOrder: CustomsStatus[] = [
  "nouveau",
  "docs_a_completer",
  "verif_doc",
  "decl_preparee",
  "decl_deposee",
  "en_liquidation",
  "paiement_attente",
  "bae_obtenu",
  "mainlevee",
  "bloque",
  "cloture",
];

export type CustomerStatus = "active" | "prospect" | "inactive";

export const customerStatus: Record<
  CustomerStatus,
  { label: string; tone: Tone }
> = {
  active: { label: "Actif", tone: "green" },
  prospect: { label: "Prospect", tone: "blue" },
  inactive: { label: "Inactif", tone: "slate" },
};

export type Priority = "high" | "medium" | "low";
export const priority: Record<Priority, { label: string; tone: Tone }> = {
  high: { label: "Haute", tone: "red" },
  medium: { label: "Moyenne", tone: "amber" },
  low: { label: "Basse", tone: "slate" },
};

export type TaskStatus = "todo" | "in_progress" | "overdue" | "done";
export const taskStatus: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "À faire", tone: "slate" },
  in_progress: { label: "En cours", tone: "blue" },
  overdue: { label: "En retard", tone: "red" },
  done: { label: "Terminé", tone: "green" },
};

export type TransportMode = "sea" | "air" | "road";
export const transportMode: Record<
  TransportMode,
  { label: string; code: string }
> = {
  sea: { label: "Maritime", code: "FCL" },
  air: { label: "Aérien", code: "AIR" },
  road: { label: "Routier", code: "ROAD" },
};
