/**
 * Human labels for process internals (Phase 5.0E-2C, Deliverable 7). PURE.
 * ---------------------------------------------------------------------------
 * Staff must never be shown a raw key.
 *
 * Until now `blockerSummary` was built by joining the internal identifiers straight
 * into a sentence, and the queue table rendered it verbatim:
 *
 *     "Preuves manquantes : BORDEREAU_LIVRAISON, BILL_OF_LADING"
 *     "Prérequis manquants : declaration_preparation, chief_transit_validation"
 *
 * Those are database keys. A Déclarant reading "BORDEREAU_LIVRAISON" has to know our
 * schema to know they need the bordereau de livraison, and a key that is later renamed
 * silently changes what the user is told. Both registries already carry a French
 * label; nothing here invents one.
 *
 * FAILS LOUDLY-ISH, NOT SILENTLY: an unknown key falls back to a de-snake-cased,
 * sentence-cased version of itself rather than to the raw token. It will read a bit
 * awkwardly, which is the point — an awkward label is a bug report, whereas a raw
 * SCREAMING_KEY just looks like the product.
 */
import { getStep } from "./effitrans-process";
import { DOCUMENT_MAPPINGS } from "./documents";

const DOC_LABEL = new Map<string, string>(DOCUMENT_MAPPINGS.map((d) => [d.key, d.labelFr]));

// Documents are referenced by official KEY in the registry but by document_type.CODE
// in the database, so both must resolve.
//
// The mapping is many-to-one, deliberately: "Reçu" and "Preuve de paiement" are two
// official artefacts that share the single PAYMENT_RECEIPT document type (the portal's
// payment-proof upload already uses it). Looking a shared code up is therefore
// genuinely ambiguous, and we resolve it to the FIRST registry entry that claims it —
// deterministic, and stable under reordering only insofar as the registry is. Last-
// write-wins would have made the label depend on declaration order, which is the kind
// of thing that changes under an innocent edit and is never noticed.
for (const d of DOCUMENT_MAPPINGS) {
  if (d.typeCode && !DOC_LABEL.has(d.typeCode)) DOC_LABEL.set(d.typeCode, d.labelFr);
}

/** Last resort. Never returns the raw token unchanged. */
function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An official step key → its French label. */
export function stepLabel(key: string): string {
  return getStep(key)?.labelFr ?? humanize(key);
}

/** A document key OR a document_type.code → its French catalog label. */
export function documentLabel(key: string): string {
  return DOC_LABEL.get(key) ?? humanize(key);
}

/**
 * The blocker sentence a human actually reads.
 *
 * Returns `null` when nothing is blocked — the caller must not render an empty
 * "Étape bloquée" badge for a step that is merely waiting its turn.
 */
export function blockerSentence(input: {
  blocked: boolean;
  missingPrerequisites: string[];
  missingEvidence: string[];
}): string | null {
  if (!input.blocked) return null;

  if (input.missingPrerequisites.length > 0) {
    return `Prérequis manquants : ${input.missingPrerequisites.map(stepLabel).join(", ")}`;
  }
  if (input.missingEvidence.length > 0) {
    return `Pièces manquantes : ${input.missingEvidence.map(documentLabel).join(", ")}`;
  }
  return "Étape bloquée";
}
