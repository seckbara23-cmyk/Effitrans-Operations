/**
 * Document Intelligence — deterministic FR/EN text classification (Phase 7.4B). PURE.
 * A rule-based keyword classifier over already-extracted document text. NO model, NO AI — a
 * keyword match is SUGGESTIVE, never authoritative, so confidence tops out at MEDIUM. Its output
 * is fed to classifyDocument() as a PREDICTION: the operator-declared class stays authoritative,
 * and a disagreeing prediction only raises a review conflict — it never changes the class.
 * Document text is untrusted DATA.
 */
import type { DocClass, Confidence, DocLanguage } from "./types";

/** Fold accents + apostrophes so FR/EN keywords match regardless of diacritics/quotes. */
function fold(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(new RegExp("['\\u2018\\u2019`]", "g"), " ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** FR + EN keyword signatures per class (folded at match time). Order-independent. */
const CLASS_KEYWORDS: Record<Exclude<DocClass, "UNKNOWN">, string[]> = {
  BILL_OF_LADING: ["bill of lading", "b/l", "connaissement", "port of loading", "port of discharge", "port de chargement", "port de dechargement", "shipper", "consignee", "vessel", "navire", "ocean", "maritime"],
  AIR_WAYBILL: ["air waybill", "airwaybill", "lettre de transport aerien", "master awb", "house awb", "airport of departure", "aeroport", "flight", "vol", "iata"],
  COMMERCIAL_INVOICE: ["commercial invoice", "facture commerciale", "invoice no", "invoice number", "facture n", "incoterm", "unit price", "prix unitaire", "total amount", "montant total"],
  PACKING_LIST: ["packing list", "liste de colisage", "net weight", "gross weight", "poids net", "poids brut", "number of packages", "nombre de colis", "cartons"],
  CERTIFICATE_OF_ORIGIN: ["certificate of origin", "certificat d origine", "country of origin", "pays d origine", "exporter", "exportateur", "chamber of commerce", "chambre de commerce"],
  CUSTOMS_DECLARATION: ["customs declaration", "declaration en douane", "hs code", "code sh", "customs value", "valeur en douane", "bureau de douane", "regime douanier"],
  ARRIVAL_NOTICE: ["arrival notice", "avis d arrivee", "notify party", "estimated time of arrival", "free time", "demurrage", "terminal de dechargement"],
  DELIVERY_ORDER: ["delivery order", "bon de livraison", "mainlevee", "empty return", "retour a vide", "enlevement", "release of cargo"],
};

const FR_MARKERS = ["le ", "la ", "les ", " des ", " du ", "facture", "navire", "aeroport", "poids", "marchandise", "numero", "transporteur", "connaissement", "douane"];
const EN_MARKERS = [" the ", " of ", " and ", "invoice", "vessel", "airport", "weight", "goods", "number", "carrier", "shipper", "consignee", "customs"];

export type TextClassification = {
  predictedClass: DocClass;
  confidence: Confidence;
  language: DocLanguage;
  topScore: number;
  matched: string[];
};

function countMarkers(text: string, markers: string[]): number {
  return markers.reduce((n, m) => (text.includes(m) ? n + 1 : n), 0);
}

/** Detect FR/EN/BILINGUAL/UNKNOWN from marker-word density (never assumed). */
export function detectLanguage(text: string): DocLanguage {
  const t = ` ${fold(text)} `;
  const fr = countMarkers(t, FR_MARKERS);
  const en = countMarkers(t, EN_MARKERS);
  const strong = 3;
  if (fr >= strong && en >= strong) return "BILINGUAL";
  if (fr >= strong && fr > en) return "FR";
  if (en >= strong && en > fr) return "EN";
  return "UNKNOWN";
}

/**
 * Classify document text deterministically. Returns UNKNOWN (never a guess) when no signature
 * matches. Confidence is MEDIUM at most (a keyword match is suggestive, not a model assertion).
 */
export function classifyText(rawText: string): TextClassification {
  const text = fold(rawText);
  let bestClass: DocClass = "UNKNOWN";
  let best = 0;
  let second = 0;
  let bestMatched: string[] = [];

  for (const [cls, keywords] of Object.entries(CLASS_KEYWORDS) as [Exclude<DocClass, "UNKNOWN">, string[]][]) {
    const matched = keywords.filter((k) => text.includes(fold(k)));
    const score = matched.length;
    if (score > best) { second = best; best = score; bestClass = cls; bestMatched = matched; }
    else if (score > second) { second = score; }
  }

  let confidence: Confidence = "UNKNOWN";
  if (best === 0) { bestClass = "UNKNOWN"; confidence = "UNKNOWN"; }
  else if (best >= 2 && best > second) confidence = "MEDIUM";
  else confidence = "LOW";

  return { predictedClass: bestClass, confidence, language: detectLanguage(rawText), topScore: best, matched: bestMatched.slice(0, 8) };
}
