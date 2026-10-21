/**
 * Customs regime SUGGESTIONS — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Extracted from the customs panel (CEO-ALIGNMENT WP1-C) so the Déclarant's
 * « Régime » field and the Account Manager's « Régime douanier prévu » offer
 * the same words.
 *
 * SUGGESTIONS, NOT A VOCABULARY. Both fields stay free text: the platform has
 * no canonical regime code list (migration 155 records the same finding), and
 * one is the Customs department's to publish, not ours to invent. A datalist
 * proposes; it never refuses.
 */
export const CUSTOMS_REGIME_SUGGESTIONS: readonly string[] = [
  "Mise à la consommation",
  "Exportation",
  "Transit",
  "Admission temporaire",
  "Entrepôt",
  "Réexportation",
];
