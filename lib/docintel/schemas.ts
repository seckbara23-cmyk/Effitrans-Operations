/**
 * Document Intelligence — explicit field schemas per document class (Phase 7.4A). PURE.
 * The allowlist: a structured extractor may ONLY return these field keys for a class (extra
 * output is rejected). `applyTarget` names the EXISTING domain field a value may be applied
 * to (through that domain's service); null = extract/validate/review only, no authoritative
 * target (never invents an operational field). Keys are language-neutral; labels are French.
 */
import type { DocClass } from "./types";

export type FieldKind = "text" | "reference" | "date" | "number" | "currency" | "container" | "awb" | "unlocode" | "iata" | "imo" | "mmsi";
export type ApplyTarget = { domain: "shipping" | "air"; field: string };
export type FieldSchema = { key: string; labelFr: string; kind: FieldKind; required?: boolean; applyTarget?: ApplyTarget };

const BILL_OF_LADING: FieldSchema[] = [
  { key: "bl_number", labelFr: "N° connaissement (BL)", kind: "reference", required: true, applyTarget: { domain: "shipping", field: "masterBl" } },
  { key: "booking_reference", labelFr: "Référence réservation", kind: "reference", applyTarget: { domain: "shipping", field: "bookingReference" } },
  { key: "carrier", labelFr: "Transporteur", kind: "text" },
  { key: "vessel", labelFr: "Navire", kind: "text" },
  { key: "voyage", labelFr: "Voyage", kind: "reference" },
  { key: "port_of_loading", labelFr: "Port de chargement", kind: "unlocode" },
  { key: "port_of_discharge", labelFr: "Port de déchargement", kind: "unlocode" },
  { key: "container_numbers", labelFr: "N° conteneurs", kind: "container" },
  { key: "package_count", labelFr: "Nombre de colis", kind: "number" },
  { key: "gross_weight", labelFr: "Poids brut", kind: "number" },
  { key: "goods_description", labelFr: "Désignation des marchandises", kind: "text" },
  { key: "issue_date", labelFr: "Date d'émission", kind: "date" },
];

const AIR_WAYBILL: FieldSchema[] = [
  { key: "mawb", labelFr: "MAWB", kind: "reference", required: true, applyTarget: { domain: "air", field: "mawb" } },
  { key: "hawb", labelFr: "HAWB", kind: "reference", applyTarget: { domain: "air", field: "hawb" } },
  { key: "airline", labelFr: "Compagnie", kind: "text" },
  { key: "flight_number", labelFr: "N° vol", kind: "reference" },
  { key: "origin_airport", labelFr: "Aéroport origine", kind: "iata" },
  { key: "destination_airport", labelFr: "Aéroport destination", kind: "iata" },
  { key: "piece_count", labelFr: "Nombre de pièces", kind: "number" },
  { key: "gross_weight", labelFr: "Poids brut", kind: "number" },
  { key: "chargeable_weight", labelFr: "Poids taxable", kind: "number" },
  { key: "flight_date", labelFr: "Date de vol", kind: "date" },
];

const COMMERCIAL_INVOICE: FieldSchema[] = [
  { key: "invoice_number", labelFr: "N° facture", kind: "reference", required: true },
  { key: "invoice_date", labelFr: "Date facture", kind: "date" },
  { key: "currency", labelFr: "Devise", kind: "currency" },
  { key: "subtotal", labelFr: "Sous-total", kind: "number" },
  { key: "tax", labelFr: "Taxe", kind: "number" },
  { key: "total", labelFr: "Total", kind: "number" },
  { key: "incoterm", labelFr: "Incoterm", kind: "text" },
  { key: "country_of_origin", labelFr: "Pays d'origine", kind: "text" },
];

const PACKING_LIST: FieldSchema[] = [
  { key: "packing_list_number", labelFr: "N° liste de colisage", kind: "reference" },
  { key: "date", labelFr: "Date", kind: "date" },
  { key: "package_count", labelFr: "Nombre de colis", kind: "number" },
  { key: "net_weight", labelFr: "Poids net", kind: "number" },
  { key: "gross_weight", labelFr: "Poids brut", kind: "number" },
  { key: "volume", labelFr: "Volume", kind: "number" },
  { key: "container", labelFr: "Conteneur", kind: "container" },
];

const CERTIFICATE_OF_ORIGIN: FieldSchema[] = [
  { key: "certificate_number", labelFr: "N° certificat", kind: "reference" },
  { key: "exporter", labelFr: "Exportateur", kind: "text" },
  { key: "origin_country", labelFr: "Pays d'origine", kind: "text" },
  { key: "issue_date", labelFr: "Date d'émission", kind: "date" },
  { key: "issuing_authority", labelFr: "Autorité émettrice", kind: "text" },
];

const CUSTOMS_DECLARATION: FieldSchema[] = [
  { key: "declaration_number", labelFr: "N° déclaration", kind: "reference" },
  { key: "regime", labelFr: "Régime", kind: "text" },
  { key: "office", labelFr: "Bureau", kind: "text" },
  { key: "customs_value", labelFr: "Valeur en douane", kind: "number" },
  { key: "declaration_date", labelFr: "Date", kind: "date" },
];

const ARRIVAL_NOTICE: FieldSchema[] = [
  { key: "carrier", labelFr: "Transporteur", kind: "text" },
  { key: "bl_number", labelFr: "N° BL", kind: "reference" },
  { key: "vessel", labelFr: "Navire", kind: "text" },
  { key: "voyage", labelFr: "Voyage", kind: "reference" },
  { key: "arrival_port", labelFr: "Port d'arrivée", kind: "unlocode" },
  { key: "eta", labelFr: "ETA", kind: "date" },
  { key: "terminal", labelFr: "Terminal", kind: "text" },
];

const DELIVERY_ORDER: FieldSchema[] = [
  { key: "order_number", labelFr: "N° bon de livraison", kind: "reference" },
  { key: "bl_number", labelFr: "N° BL", kind: "reference" },
  { key: "container", labelFr: "Conteneur", kind: "container" },
  { key: "release_party", labelFr: "Partie de mainlevée", kind: "text" },
  { key: "validity", labelFr: "Validité", kind: "date" },
  { key: "issue_date", labelFr: "Date d'émission", kind: "date" },
];

export const SCHEMAS: Partial<Record<DocClass, FieldSchema[]>> = {
  BILL_OF_LADING, AIR_WAYBILL, COMMERCIAL_INVOICE, PACKING_LIST,
  CERTIFICATE_OF_ORIGIN, CUSTOMS_DECLARATION, ARRIVAL_NOTICE, DELIVERY_ORDER,
};

export function schemaFor(cls: DocClass): FieldSchema[] {
  return SCHEMAS[cls] ?? [];
}
export function fieldSchema(cls: DocClass, key: string): FieldSchema | null {
  return schemaFor(cls).find((f) => f.key === key) ?? null;
}
export function isAllowedField(cls: DocClass, key: string): boolean {
  return !!fieldSchema(cls, key);
}
