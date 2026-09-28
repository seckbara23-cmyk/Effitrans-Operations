/**
 * Operator labels for gate reason codes (FIN-TRN-DOC-01). PURE.
 * ---------------------------------------------------------------------------
 * Every gate requirement already carries a French `labelFr` saying WHAT is
 * required. Its `detail` says WHY it is not satisfied — and that half was
 * rendered raw:
 *
 *     ❌ Paiement intégral encaissé (balance_outstanding)
 *     ❌ Chaîne facturation / dépôt / recouvrement (post_delivery_context_unavailable)
 *
 * Those are engine identifiers. An operator reading `am_check_incomplete` has to
 * know our step keys to know the Account Manager's completeness review is
 * outstanding, and a code later renamed silently changes what they are told.
 * This is the same doctrine `lib/process/labels.ts` applies to step and document
 * keys; gate details are a separate closed vocabulary, so they get their own map
 * rather than being squeezed into that one.
 *
 * TWO RULES, both about not lying:
 *
 *   1. AN UNKNOWN CODE RENDERS NOTHING. `gateDetailLabelFr` returns null for a
 *      snake_case token it does not know, and the requirement line still states
 *      what is required. Falling back to the raw token is what we are removing;
 *      inventing a sentence for a code nobody has read would be worse.
 *   2. PROSE PASSES THROUGH. A declared evidence absence (C-3) already arrives
 *      as a French sentence carrying its motif. Dropping it would hide WHY a
 *      requirement was waived, so anything that is not a bare identifier is
 *      returned unchanged.
 *
 * A test enumerates the `detail:` literals in gates.ts, closure.ts and
 * evidence.ts and fails when one of them is missing from this map.
 */

/**
 * Every reason code the gate and closure evaluators emit.
 *
 * Phrased as a STATE, not an instruction: the requirement line says what is
 * needed, this says where it stands. Nothing here names an amount, a client or
 * a document's contents — a reason code is shown to whoever may see the gate,
 * and the gate is a verdict, never a disclosure.
 */
export const GATE_DETAIL_LABELS_FR: Readonly<Record<string, string>> = {
  // ---- pickup convergence -------------------------------------------------
  customs_not_released: "Mainlevée douane non obtenue",
  customs_released: "Mainlevée douane obtenue",
  no_customs_record: "Aucun dossier douane ouvert",
  no_bae_reference: "Aucune référence de Bon à Enlever enregistrée",
  no_vehicle_plate: "Aucun véhicule affecté",
  no_driver_assigned: "Aucun chauffeur affecté",
  no_field_agent: "Aucun Agent de Terrain affecté",
  field_agent_assigned: "Agent de Terrain affecté",

  // ---- evidence resolution ------------------------------------------------
  not_uploaded: "Document non téléversé",
  awaiting_approval: "Document téléversé, en attente de vérification",
  rejected_or_expired: "Document rejeté ou expiré",
  document_type_not_in_catalog: "Type de document absent du catalogue",
  no_assignment_data: "Affectation non renseignée",
  no_account_manager: "Aucun Account Manager sur le dossier",
  no_governed_assignment: "Désignation non enregistrée par le circuit officiel",
  no_gainde_reference: "Aucune référence GAINDE enregistrée",
  rattachement_recorded: "Rattachement GAINDE / ORBUS enregistré",

  // ---- billing readiness --------------------------------------------------
  no_approved_pod: "Bordereau de Livraison signé non reçu ou non vérifié",
  coordinator_check_incomplete: "Contrôle de complétude du Coordinateur non effectué",
  am_check_incomplete: "Contrôle de complétude de l'Account Manager non effectué",

  // ---- closure ------------------------------------------------------------
  not_delivered: "Livraison non effectuée",
  steps_incomplete: "Des étapes officielles restent à terminer",
  unverified_historical_steps: "Des étapes reprises d'un dossier ancien n'ont jamais été vérifiées",
  // FIN-TRN-DOC-01 — « aucune facture » and « facture impayée » are different
  // facts and used to share one code. See evaluateClosureGate.
  no_invoice: "Aucune facture émise",
  balance_outstanding: "Facture émise, solde restant dû",
  invoice_not_validated: "Facture non validée par la Finance",
  invoice_not_sent: "Facture non envoyée au client",
  dispute_open: "Litige ouvert sur la facture",
  proof_not_accepted: "Preuve de dépôt physique non validée",
  not_handed_to_collections: "Dossier non remis au Recouvrement",
  collections_incomplete: "Travail de recouvrement non terminé",
  corrections_outstanding: "Des corrections restent en suspens",
  deposit_not_required_for_this_client: "Dépôt physique non requis pour ce client",
  // Kept because the closure gate can still be evaluated without its
  // post-delivery context — on that view the requirements are reported as NOT
  // EVALUATED rather than as blocked. See evaluateClosureGate.
  post_delivery_context_unavailable:
    "Chaîne facturation / dépôt / recouvrement non évaluée sur cette vue",
};

/** A bare engine identifier: lowercase, digits and underscores only. */
const IS_CODE = /^[a-z0-9_]+$/;

/**
 * The operator-facing sentence for a gate detail, or null when there is none.
 *
 * Null means "say nothing extra" — never "show the raw code".
 */
export function gateDetailLabelFr(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const mapped = GATE_DETAIL_LABELS_FR[detail];
  if (mapped) return mapped;
  // Rule 2: already prose (a declared evidence absence carries its motif).
  return IS_CODE.test(detail) ? null : detail;
}
